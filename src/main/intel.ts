// Threat lists and antivirus teamwork.
// Rigmind never quarantines files itself. It finds suspicious files using open threat lists
// (a signed list built from abuse.ch feeds every 4 hours, plus ClamAV if installed), then hands
// each file to the antivirus already on the PC and shows what that antivirus decided.
import { EventEmitter } from "node:events";
import { createPublicKey, verify, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { execFile } from "node:child_process";
import { shell } from "electron";
import { dataDir } from "./store";
import { runPs, runPsJson, psq } from "./ps";
import { hw } from "./hw";
import { INTEL_PUBLIC_KEY, INTEL_URL, INTEL_SIG_URL } from "./intel-key";
import type { AvProduct, FileFinding, IntelStatus, ThreatScanState } from "../shared/types";

interface Feed {
  version: string;
  builtAt: number;
  sha256: string[];
  extensions: string[];
  domains: string[];
  names?: Record<string, string>; // sha256 -> malware family, when known
}

const dir = () => dataDir("intel");
const feedFile = () => join(dir(), "intel.json");
const stateFile = () => join(dir(), "state.json");
const CLAM_PATHS = ["C:\\Program Files\\ClamAV\\clamscan.exe", "C:\\Program Files (x86)\\ClamAV\\clamscan.exe"];

// Vendors' own "submit a sample" pages. Unknown vendors get general guidance instead of a guess.
const SUBMIT: [RegExp, string][] = [
  [/defender|microsoft/i, "https://www.microsoft.com/en-us/wdsi/filesubmission"],
  [/avast|avg/i, "https://www.avast.com/submit-a-sample"],
  [/norton|symantec/i, "https://submit.norton.com/"],
  [/bitdefender/i, "https://www.bitdefender.com/submit/"],
];

const CANDIDATES = String.raw`
$ErrorActionPreference='SilentlyContinue'
$ext='\.(exe|dll|scr|msi|com|bat|cmd|ps1|vbs|js|jse|wsf|hta|jar|zip|rar|7z|iso|img|docm|xlsm|pptm|lnk)$'
$roots=@([Environment]::GetFolderPath('Desktop'),"$env:USERPROFILE\Downloads",$env:TEMP,"$env:APPDATA","$env:LOCALAPPDATA\Temp","$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup","$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup","$env:PUBLIC")
$files=New-Object System.Collections.Generic.List[string]
foreach($r in $roots){ if(Test-Path $r){ foreach($f in Get-ChildItem -LiteralPath $r -File -Recurse -Depth 3 -Force){ if($f.Name -match $ext -and $f.Length -lt 300MB){ $files.Add($f.FullName); if($files.Count -ge 5000){break} } } } }
# Programs that start with Windows, wherever they live.
foreach($k in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run','HKLM:\Software\Microsoft\Windows\CurrentVersion\Run')){
  $p=Get-ItemProperty $k; if($p){ foreach($n in $p.PSObject.Properties){ if($n.Name -notlike 'PS*'){ $m=[regex]::Match([string]$n.Value,'^"?([A-Za-z]:\\[^"]+?\.exe)'); if($m.Success -and (Test-Path $m.Groups[1].Value)){ $files.Add($m.Groups[1].Value) } } } }
}
$dns=@(Get-DnsClientCache | Select-Object -ExpandProperty Entry -Unique)
[ordered]@{files=@($files | Select-Object -Unique);dns=$dns} | ConvertTo-Json -Compress`;

const AV_QUERY = String.raw`
$ErrorActionPreference='SilentlyContinue'
$l=@(foreach($a in Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct){ $s=[int]$a.productState
  [ordered]@{name=$a.displayName;enabled=((($s -shr 12) -band 0xF) -eq 1);upToDate=((($s -shr 4) -band 0xF) -eq 0);isDefender=($a.displayName -match 'Defender')} })
ConvertTo-Json -InputObject @($l) -Compress`;

class ThreatIntel extends EventEmitter {
  private feed: Feed | null = null;
  private hashes = new Set<string>();
  private badExt = new Set<string>();
  private badDomains = new Set<string>();
  private st: ThreatScanState = {
    products: [],
    intel: { version: null, builtAt: null, checkedAt: null, counts: { hashes: 0, extensions: 0, domains: 0 }, stale: true, error: null, clam: { installed: false, path: null, dbUpdated: null } },
    scanning: false,
    lastScan: null,
    scanned: 0,
    findings: [],
  };

  init() {
    try {
      if (existsSync(stateFile())) this.st = { ...this.st, ...JSON.parse(readFileSync(stateFile(), "utf8")), scanning: false };
    } catch {
      /* start fresh */
    }
    try {
      if (existsSync(feedFile())) this.use(JSON.parse(readFileSync(feedFile(), "utf8")));
    } catch {
      /* fetch again */
    }
    void this.refreshProducts();
    setTimeout(() => void this.update(), 60_000);
    setInterval(() => void this.update(), 4 * 3600_000);
  }

  private use(f: Feed) {
    this.feed = f;
    this.hashes = new Set(f.sha256.map((h) => h.toLowerCase()));
    this.badExt = new Set(f.extensions);
    this.badDomains = new Set(f.domains.map((d) => d.toLowerCase()));
  }

  isBadExtension(id: string) {
    return this.badExt.has(id);
  }

  private persist() {
    writeFileSync(stateFile(), JSON.stringify({ ...this.st, scanning: false }));
    this.emit("state", this.state());
  }

  state(): ThreatScanState {
    const clamPath = CLAM_PATHS.find((p) => existsSync(p)) ?? null;
    let dbUpdated: number | null = null;
    if (clamPath) {
      const db = join(clamPath, "..", "database", "daily.cvd");
      const dbc = join(clamPath, "..", "database", "daily.cld");
      for (const f of [dbc, db]) if (existsSync(f)) dbUpdated = Math.max(dbUpdated ?? 0, statSync(f).mtimeMs);
    }
    const intel: IntelStatus = {
      ...this.st.intel,
      version: this.feed?.version ?? null,
      builtAt: this.feed?.builtAt ?? null,
      counts: { hashes: this.hashes.size, extensions: this.badExt.size, domains: this.badDomains.size },
      stale: !this.feed || Date.now() - this.feed.builtAt > 48 * 3600_000,
      clam: { installed: !!clamPath, path: clamPath, dbUpdated },
    };
    return { ...this.st, intel };
  }

  async refreshProducts() {
    this.st.products = await runPsJson<AvProduct[]>(AV_QUERY).catch(() => []);
    this.emit("state", this.state());
    return this.st.products;
  }

  /** Download the newest signed list. Anything unsigned or altered is rejected. */
  async update(): Promise<{ ok: boolean; message: string }> {
    this.st.intel.checkedAt = Date.now();
    if (INTEL_PUBLIC_KEY.includes("REPLACE_WITH")) {
      this.st.intel.error = "The threat list isn't connected yet. See the README section \"Threat list feed\".";
      this.persist();
      return { ok: false, message: this.st.intel.error };
    }
    try {
      const [gz, sig] = await Promise.all([fetchBuf(INTEL_URL), fetchBuf(INTEL_SIG_URL)]);
      const key = createPublicKey(INTEL_PUBLIC_KEY);
      const signature = Buffer.from(sig.toString("utf8").trim(), "base64");
      if (!verify(null, gz, key, signature)) throw new Error("The threat list's signature didn't match, so Rigmind ignored it.");
      const feed = JSON.parse(gunzipSync(gz).toString("utf8")) as Feed;
      if (!Array.isArray(feed.sha256) || typeof feed.builtAt !== "number") throw new Error("The threat list was in an unexpected format.");
      writeFileSync(feedFile(), JSON.stringify(feed));
      this.use(feed);
      this.st.intel.error = null;
      this.persist();
      return { ok: true, message: `Threat list updated: ${feed.sha256.length.toLocaleString()} known malware files.` };
    } catch (e: any) {
      this.st.intel.error = e?.message ?? String(e);
      this.persist();
      return { ok: false, message: this.st.intel.error! };
    }
  }

  async scan(): Promise<{ ok: boolean; message: string }> {
    if (this.st.scanning) return { ok: false, message: "A scan is already running." };
    this.st.scanning = true;
    this.emit("state", this.state());
    try {
      await this.refreshProducts();
      const c = await runPsJson<{ files: string[]; dns: string[] }>(CANDIDATES, 180_000);
      const files = c.files ?? [];
      const found: FileFinding[] = [];
      const known = new Set(this.st.findings.map((f) => f.path.toLowerCase() + f.sha256));
      // 1) Hashes against the threat list.
      if (this.hashes.size) {
        const hashed = await hw.hashFiles(files);
        for (const h of hashed)
          if (this.hashes.has(h.sha256)) found.push(this.finding(h.path, h.sha256, this.feed?.names?.[h.sha256] ?? "Known malware file", "threat list"));
      }
      // 2) ClamAV, if the user installed it.
      const clam = CLAM_PATHS.find((p) => existsSync(p));
      if (clam && files.length) for (const f of await clamScan(clam, files)) found.push(this.finding(f.path, "", f.name, "ClamAV"));
      // 3) Recent connections to known malware sites.
      const hits = (c.dns ?? []).filter((d) => this.badDomains.has(String(d).toLowerCase()));
      for (const f of found) if (!known.has(f.path.toLowerCase() + f.sha256)) this.st.findings.unshift(f);
      this.st.lastScan = Date.now();
      this.st.scanned = files.length;
      this.persist();
      if (hits.length) this.emit("domains", hits);
      const fresh = found.filter((f) => !known.has(f.path.toLowerCase() + f.sha256)).length;
      return {
        ok: true,
        message: `Checked ${files.length.toLocaleString()} files. ${fresh ? `${fresh} suspicious file${fresh > 1 ? "s" : ""} found; hand them to your antivirus below.` : "Nothing suspicious found."}${hits.length ? ` This PC recently looked up ${hits.length} known malware site${hits.length > 1 ? "s" : ""}: ${hits.slice(0, 3).join(", ")}.` : ""}`,
      };
    } finally {
      this.st.scanning = false;
      this.emit("state", this.state());
    }
  }

  private finding(path: string, sha256: string, threat: string, source: FileFinding["source"]): FileFinding {
    return { id: randomUUID(), path, sha256, threat, source, found: Date.now(), status: "found", av: null };
  }

  async act(id: string, action: "hand_off" | "hold" | "restore" | "ignore" | "report"): Promise<{ ok: boolean; message: string }> {
    const f = this.st.findings.find((x) => x.id === id);
    if (!f) return { ok: false, message: "That finding is gone." };
    const products = this.st.products.length ? this.st.products : await this.refreshProducts();
    const av = products.find((p) => p.enabled) ?? null;
    let message = "";
    if (action === "hand_off") {
      f.av = av?.name ?? null;
      if (!av) return { ok: false, message: "No antivirus is turned on. Turn Microsoft Defender back on in Windows Security first." };
      if (av.isDefender) {
        await runPs(`Start-MpScan -ScanType CustomScan -ScanPath ${psq(f.path)}`, 10 * 60_000).catch(() => {});
      } else {
        // Reading the file makes any antivirus with real-time protection scan it on the spot.
        await runPs(`$s=[IO.File]::Open(${psq(f.path)},'Open','Read','ReadWrite'); $b=New-Object byte[] 65536; while($s.Read($b,0,$b.Length) -gt 0){}; $s.Close()`, 120_000).catch(() => {});
        await new Promise((r) => setTimeout(r, 6000));
      }
      const gone = !existsSync(f.path);
      f.status = gone ? "removed_by_av" : "av_says_clean";
      message = gone ? `${av.name} removed it.` : `${av.name} didn't act on it. You can report it to ${av.name}, hold it so it can't run, or ignore it.`;
    } else if (action === "hold") {
      if (!existsSync(f.path)) return { ok: false, message: "The file is already gone." };
      const holdDir = join(dataDir("hold"), f.id);
      mkdirSync(holdDir, { recursive: true });
      const held = join(holdDir, basename(f.path) + ".held");
      renameSync(f.path, held);
      writeFileSync(join(holdDir, "origin.txt"), f.path);
      // Nobody may run it while it's held.
      await new Promise<void>((r) => execFile("icacls.exe", [held, "/deny", "*S-1-1-0:(X)"], { windowsHide: true }, () => r()));
      f.status = "held";
      message = "Held. The file can't run, and you can restore it from here any time.";
    } else if (action === "restore") {
      const holdDir = join(dataDir("hold"), f.id);
      const held = join(holdDir, basename(f.path) + ".held");
      if (!existsSync(held)) return { ok: false, message: "Rigmind isn't holding this file." };
      await new Promise<void>((r) => execFile("icacls.exe", [held, "/remove:d", "*S-1-1-0"], { windowsHide: true }, () => r()));
      renameSync(held, f.path);
      f.status = "restored";
      message = "Restored to where it was.";
    } else if (action === "ignore") {
      f.status = "ignored";
      message = "Ignored. Rigmind won't flag this file again.";
    } else if (action === "report") {
      const url = SUBMIT.find(([re]) => re.test(av?.name ?? "Defender"))?.[1];
      if (url) await shell.openExternal(url);
      message = url ? `Opened ${av?.name ?? "Microsoft"}'s page for submitting a missed file. The file is at ${f.path}.` : `Use ${av?.name ?? "your antivirus"}'s "submit a sample" option and send it ${f.path}.`;
    }
    this.persist();
    return { ok: true, message };
  }
}

function fetchBuf(url: string): Promise<Buffer> {
  return fetch(url, { redirect: "follow" }).then(async (r) => {
    if (!r.ok) throw new Error(`Couldn't download the threat list (HTTP ${r.status}).`);
    return Buffer.from(await r.arrayBuffer());
  });
}

/** Run clamscan over a file list. Updates ClamAV's own signatures first if they're over a day old. */
async function clamScan(clam: string, files: string[]): Promise<{ path: string; name: string }[]> {
  const fresh = join(clam, "..", "freshclam.exe");
  const daily = [join(clam, "..", "database", "daily.cld"), join(clam, "..", "database", "daily.cvd")].find((f) => existsSync(f));
  if (existsSync(fresh) && (!daily || Date.now() - statSync(daily).mtimeMs > 86400_000))
    await new Promise<void>((r) => execFile(fresh, [], { windowsHide: true, timeout: 15 * 60_000 }, () => r()));
  const list = join(dir(), "clam-files.txt");
  writeFileSync(list, files.join("\r\n"));
  const out = await new Promise<string>((r) => execFile(clam, ["--no-summary", "--infected", `--file-list=${list}`], { windowsHide: true, timeout: 60 * 60_000, maxBuffer: 20 * 1024 * 1024 }, (_e, so) => r(so ?? "")));
  return out
    .split(/\r?\n/)
    .map((l) => l.match(/^(.*): (.+) FOUND$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ path: m[1], name: m[2] }));
}

export const intel = new ThreatIntel();
