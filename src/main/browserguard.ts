// Browser Guard: finds risky or malicious browser extensions and hijacked browser settings.
// Reads extension manifests and browser settings files that are already on this PC. It never opens
// history, cookies, saved passwords or page content, and sends nothing anywhere.
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { clipboard } from "electron";
import { dataDir } from "./store";
import { runPs, runPsJson, psq } from "./ps";
import { history } from "./history";
import { mode } from "./mode";
import { intel } from "./intel";
import type { BrowserExtension, BrowserGuardState, HijackFinding, RiskLevel } from "../shared/types";

type Browser = BrowserExtension["browser"];
const LOCAL = () => process.env.LOCALAPPDATA ?? "";
const ROAMING = () => process.env.APPDATA ?? "";

const CHROMIUM: { browser: Exclude<Browser, "Firefox">; dir: () => string; policy: string; exe: string; page: string }[] = [
  { browser: "Chrome", dir: () => join(LOCAL(), "Google", "Chrome", "User Data"), policy: "SOFTWARE\\Policies\\Google\\Chrome", exe: "chrome.exe", page: "chrome://extensions/?id=" },
  { browser: "Edge", dir: () => join(LOCAL(), "Microsoft", "Edge", "User Data"), policy: "SOFTWARE\\Policies\\Microsoft\\Edge", exe: "msedge.exe", page: "edge://extensions/?id=" },
  { browser: "Brave", dir: () => join(LOCAL(), "BraveSoftware", "Brave-Browser", "User Data"), policy: "SOFTWARE\\Policies\\BraveSoftware\\Brave", exe: "brave.exe", page: "brave://extensions/?id=" },
];
const FIREFOX_POLICY = "SOFTWARE\\Policies\\Mozilla\\Firefox";
const STORE_UPDATE = /clients2\.google\.com\/service\/update2\/crx|edge\.microsoft\.com\/extensionwebstorebase|go-updater\.brave\.com/i;
const NORMAL_SEARCH = /google\.|bing\.com|duckduckgo\.com|yahoo\.|ecosia\.org|search\.brave\.com|startpage\.com|qwant\.com|yandex\.|baidu\.com|naver\.com|kagi\.com/i;
const ALL_SITES = /^(<all_urls>|\*:\/\/\*\/\*|https?:\/\/\*\/\*|\*:\/\/\*\/)$/;

// Signal weights from the design doc. 0-29 OK, 30-59 Review, 60+ Risky.
const W = { allSites: 25, cookiesOrRequests: 20, nativeOrDebugger: 25, proxyOrManagement: 20, sideloaded: 25, forcedUnmanaged: 40, newPermissions: 20, obfuscated: 20, newAndBroad: 10 };

interface Snapshot {
  [key: string]: { version: string; perms: string[]; firstSeen: number };
}
const snapFile = () => join(dataDir("browserguard"), "snapshot.json");
const stateFile = () => join(dataDir("browserguard"), "state.json");
const readJson = (p: string) => {
  try {
    return JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
};

/** Resolve "__MSG_name__" placeholders from the extension's default locale. */
function localName(dir: string, manifest: any): string {
  const raw: string = manifest?.name ?? "";
  const m = raw.match(/^__MSG_(.+)__$/);
  if (!m) return raw || "Unnamed extension";
  for (const loc of [manifest.default_locale, "en", "en_US"].filter(Boolean)) {
    const msgs = readJson(join(dir, "_locales", loc, "messages.json"));
    if (!msgs) continue;
    const hit = Object.entries(msgs).find(([k]) => k.toLowerCase() === m[1].toLowerCase()) as [string, any] | undefined;
    if (hit?.[1]?.message) return hit[1].message;
  }
  return raw;
}

/** Cheap check for obfuscated or remotely-loaded code in up to 12 script files. */
function looksObfuscated(dir: string, manifest: any): boolean {
  const csp = JSON.stringify(manifest?.content_security_policy ?? "");
  if (/unsafe-eval|https?:\/\/(?!localhost)/i.test(csp)) return true;
  const files: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 3 || files.length >= 12) return;
    let names: string[] = [];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(d, n);
      try {
        const st = statSync(p);
        if (st.isDirectory()) walk(p, depth + 1);
        else if (/\.js$/i.test(n) && st.size < 3_000_000) files.push(p);
      } catch {
        /* skip */
      }
      if (files.length >= 12) return;
    }
  };
  walk(dir, 0);
  for (const f of files) {
    let src = "";
    try {
      src = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const escapes = (src.match(/\\x[0-9a-f]{2}/gi) ?? []).length;
    if (escapes > 2000 && escapes / Math.max(1, src.length) > 0.05) return true;
    if (/eval\s*\(\s*(atob|unescape|decodeURIComponent)\s*\(/.test(src) || /new\s+Function\s*\(\s*atob\s*\(/.test(src)) return true;
  }
  return false;
}

interface RawExt {
  browser: Browser;
  profile: string;
  id: string;
  name: string;
  version: string;
  perms: string[];
  fromStore: boolean;
  forced: boolean;
  enabled: boolean;
  dir: string | null;
  manifest: any;
}

function chromiumExtensions(): RawExt[] {
  const out: RawExt[] = [];
  for (const b of CHROMIUM) {
    const root = b.dir();
    if (!existsSync(root)) continue;
    const names: Record<string, { name?: string }> = readJson(join(root, "Local State"))?.profile?.info_cache ?? {};
    let profiles: string[] = [];
    try {
      profiles = readdirSync(root).filter((d) => d === "Default" || /^Profile \d+$/.test(d));
    } catch {
      continue;
    }
    for (const prof of profiles) {
      const pdir = join(root, prof);
      const settings = { ...(readJson(join(pdir, "Preferences"))?.extensions?.settings ?? {}), ...(readJson(join(pdir, "Secure Preferences"))?.extensions?.settings ?? {}) };
      for (const [id, s] of Object.entries<any>(settings)) {
        const loc = Number(s.location);
        if (loc === 5 || loc === 10 || s.was_installed_by_default) continue; // built into the browser
        let dir: string | null = null;
        if (loc === 4 && s.path) dir = s.path;
        else {
          const base = join(pdir, "Extensions", id);
          try {
            const versions = readdirSync(base).sort((a, z) => z.localeCompare(a, undefined, { numeric: true }));
            if (versions[0]) dir = join(base, versions[0]);
          } catch {
            /* not on disk */
          }
        }
        const manifest = (dir && readJson(join(dir, "manifest.json"))) || s.manifest;
        if (!manifest || (manifest.type && manifest.type !== "extension")) continue;
        if (manifest.theme) continue; // themes have no code
        const perms = [
          ...(manifest.permissions ?? []),
          ...(manifest.host_permissions ?? []),
          ...(manifest.optional_host_permissions ?? []),
          ...((manifest.content_scripts ?? []) as any[]).flatMap((c) => c.matches ?? []),
        ].filter((p) => typeof p === "string");
        const disabled = (Array.isArray(s.disable_reasons) ? s.disable_reasons.length > 0 : Number(s.disable_reasons ?? 0) > 0) || s.state === 0;
        out.push({
          browser: b.browser,
          profile: names[prof]?.name ?? prof,
          id,
          name: localName(dir ?? "", manifest),
          version: String(manifest.version ?? ""),
          perms: [...new Set(perms)],
          fromStore: !!s.from_webstore || STORE_UPDATE.test(manifest.update_url ?? ""),
          forced: loc === 7 || loc === 9,
          enabled: !disabled,
          dir,
          manifest,
        });
      }
    }
  }
  return out;
}

function firefoxExtensions(): RawExt[] {
  const root = join(ROAMING(), "Mozilla", "Firefox", "Profiles");
  const out: RawExt[] = [];
  let profiles: string[] = [];
  try {
    profiles = readdirSync(root);
  } catch {
    return out;
  }
  for (const prof of profiles) {
    const data = readJson(join(root, prof, "extensions.json"));
    for (const a of data?.addons ?? []) {
      if (a.type !== "extension" || /^app-(builtin|system)/.test(a.location ?? "")) continue;
      const perms = [...(a.userPermissions?.permissions ?? []), ...(a.userPermissions?.origins ?? []), ...(a.optionalPermissions?.origins ?? [])];
      out.push({
        browser: "Firefox",
        profile: prof.replace(/^[^.]+\./, ""),
        id: a.id,
        name: a.defaultLocale?.name ?? a.id,
        version: a.version ?? "",
        perms,
        fromStore: a.signedState >= 2 && !a.temporarilyInstalled,
        forced: a.location === "app-system-policy" || a.installTelemetryInfo?.source === "enterprise-policy",
        enabled: !!a.active,
        dir: null,
        manifest: null,
      });
    }
  }
  return out;
}

// Registry, DNS, hosts file and shortcut checks in one PowerShell call.
const SYSTEM_CHECK = String.raw`
$ErrorActionPreference='SilentlyContinue'
function Vals($hive,$path){ $o=[ordered]@{}; $k=Get-Item -LiteralPath "$($hive):\$path"; if($k){ foreach($n in $k.GetValueNames()){ $o[$n]=[string]$k.GetValue($n) } }; $o }
$pol=@{}
foreach($b in @(@{n='Chrome';p='SOFTWARE\Policies\Google\Chrome'},@{n='Edge';p='SOFTWARE\Policies\Microsoft\Edge'},@{n='Brave';p='SOFTWARE\Policies\BraveSoftware\Brave'},@{n='Firefox';p='SOFTWARE\Policies\Mozilla\Firefox'})){
  $pol[$b.n]=[ordered]@{
    hklm=(Vals 'HKLM' $b.p); hkcu=(Vals 'HKCU' $b.p)
    force=(Vals 'HKLM' "$($b.p)\ExtensionInstallForcelist"); forceU=(Vals 'HKCU' "$($b.p)\ExtensionInstallForcelist")
    block=(Vals 'HKLM' "$($b.p)\ExtensionInstallBlocklist")
  }
}
$inet=Vals 'HKCU' 'Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$dns=@(Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses.Count -gt 0 } | ForEach-Object { [ordered]@{alias=$_.InterfaceAlias;servers=@($_.ServerAddresses)} })
$hostsPath="$env:windir\System32\drivers\etc\hosts"
$hosts=@(Get-Content $hostsPath | Where-Object { $_ -match '^\s*[^#\s]' })
$sh=New-Object -ComObject WScript.Shell
$links=@()
$dirs=@([Environment]::GetFolderPath('Desktop'),"$env:PUBLIC\Desktop","$env:APPDATA\Microsoft\Windows\Start Menu\Programs","$env:ProgramData\Microsoft\Windows\Start Menu\Programs","$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar")
foreach($d in $dirs){ foreach($f in Get-ChildItem $d -Filter *.lnk -Recurse -Depth 2){ $l=$sh.CreateShortcut($f.FullName); if($l.TargetPath -match '(chrome|msedge|brave|firefox|opera)\.exe$' -and $l.Arguments -match 'https?://'){ $links+=[ordered]@{path=$f.FullName;target=$l.TargetPath;args=$l.Arguments} } } }
[ordered]@{policies=$pol;inet=$inet;dns=$dns;hosts=$hosts;links=$links} | ConvertTo-Json -Depth 6 -Compress`;

const PUBLIC_DNS = /^(1\.1\.1\.[13]|1\.0\.0\.[13]|8\.8\.[48]\.[48]|9\.9\.9\.\d+|149\.112\.112\.\d+|208\.67\.22[02]\.22[02]|94\.140\.1[45]\.1[45]|76\.76\.(2|10)\.\d+|185\.228\.16[89]\.\d+|4\.2\.2\.\d)$/;
const isPrivate = (ip: string) => /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip);

class BrowserGuard {
  private st: BrowserGuardState = { scannedAt: null, scanning: false, managedPc: false, extensions: [], hijacks: [] };
  private sys: any = null;

  init() {
    const saved = readJson(stateFile());
    if (saved) this.st = { ...saved, scanning: false };
    history.registerUndo("browser-block", async (d: { hive: string; key: string; name: string }) => {
      await runPs(`Remove-ItemProperty -LiteralPath ${psq(`${d.hive}:\\${d.key}`)} -Name ${psq(d.name)} -ErrorAction SilentlyContinue`);
      return "Unblocked. The extension can be turned back on in the browser.";
    });
    history.registerUndo("firefox-block", async (d: { json: string | null }) => {
      await runPs(d.json == null ? `Remove-ItemProperty -LiteralPath 'HKLM:\\${FIREFOX_POLICY}' -Name ExtensionSettings -ErrorAction SilentlyContinue` : `Set-ItemProperty -LiteralPath 'HKLM:\\${FIREFOX_POLICY}' -Name ExtensionSettings -Value ${psq(d.json)}`);
      return "Unblocked in Firefox.";
    });
    history.registerUndo("reg-value", async (d: { hive: string; key: string; name: string; value: string; kind: string }) => {
      await runPs(`New-Item -Path ${psq(`${d.hive}:\\${d.key}`)} -Force | Out-Null; New-ItemProperty -LiteralPath ${psq(`${d.hive}:\\${d.key}`)} -Name ${psq(d.name)} -Value ${psq(d.value)} -PropertyType ${d.kind} -Force | Out-Null`);
      return "Setting restored.";
    });
    history.registerUndo("hosts-restore", async (d: { backup: string }) => {
      copyFileSync(d.backup, join(process.env.windir ?? "C:\\Windows", "System32", "drivers", "etc", "hosts"));
      return "Hosts file restored.";
    });
    history.registerUndo("dns-restore", async (d: { alias: string; servers: string[] }) => {
      await runPs(`Set-DnsClientServerAddress -InterfaceAlias ${psq(d.alias)} -ServerAddresses @(${d.servers.map(psq).join(",")})`);
      return "DNS servers restored.";
    });
    history.registerUndo("shortcut-args", async (d: { path: string; args: string }) => {
      await runPs(`$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${psq(d.path)}); $s.Arguments=${psq(d.args)}; $s.Save()`);
      return "Shortcut restored.";
    });
  }

  state(): BrowserGuardState {
    return this.st;
  }

  async scan(): Promise<BrowserGuardState> {
    this.st = { ...this.st, scanning: true };
    try {
      this.sys = await runPsJson<any>(SYSTEM_CHECK, 90_000).catch(() => null);
      const raw = [...chromiumExtensions(), ...firefoxExtensions()];
      const snap: Snapshot = readJson(snapFile()) ?? {};
      const firstScan = !Object.keys(snap).length;
      const managed = mode.isManaged;
      const blocked = (b: Browser) => {
        if (b === "Firefox") return Object.keys(readJsonSafe(this.sys?.policies?.Firefox?.hklm?.ExtensionSettings));
        return Object.values<string>(this.sys?.policies?.[b]?.block ?? {});
      };
      const exts: BrowserExtension[] = raw.map((r) => {
        const key = `${r.browser}|${r.profile}|${r.id}`;
        const reasons: string[] = [];
        let score = 0;
        const add = (pts: number, why: string) => {
          score += pts;
          reasons.push(why);
        };
        const p = r.perms;
        const all = p.some((x) => ALL_SITES.test(x));
        if (all) add(W.allSites, "Can read and change every website you visit, including email and banking.");
        if (p.includes("cookies") || p.includes("webRequest") || p.includes("webRequestBlocking") || p.includes("declarativeNetRequestWithHostAccess"))
          add(W.cookiesOrRequests, "Can read your cookies or see and change your web traffic.");
        if (p.includes("nativeMessaging") || p.includes("debugger")) add(W.nativeOrDebugger, p.includes("debugger") ? "Uses the browser debugger, which gives it control of any tab." : "Can talk to programs installed on your PC.");
        if (p.includes("proxy") || p.includes("management")) add(W.proxyOrManagement, p.includes("proxy") ? "Can change your proxy settings and reroute your traffic." : "Can turn other extensions on and off.");
        if (!r.fromStore && !r.forced) add(W.sideloaded, "Wasn't installed from an official extension store.");
        if (r.forced && !managed) add(W.forcedUnmanaged, "Was force-installed by a policy, but this PC isn't managed by a company. This is a common malware trick.");
        const prev = snap[key];
        const newPerms = prev ? p.filter((x) => !prev.perms.includes(x)) : [];
        if (newPerms.length && prev!.version !== r.version) add(W.newPermissions, `Asked for new permissions in its last update: ${newPerms.slice(0, 4).join(", ")}.`);
        if (r.dir && looksObfuscated(r.dir, r.manifest)) add(W.obfuscated, "Its code is heavily scrambled or loads code from a website, which official stores don't allow.");
        const firstSeen = prev?.firstSeen ?? Date.now();
        if (!firstScan && Date.now() - firstSeen < 3 * 86400_000 && all) add(W.newAndBroad, "New on this PC and already has access to every site.");
        const knownBad = intel.isBadExtension(r.id);
        if (knownBad) reasons.unshift("On the known-bad extension list.");
        const level: RiskLevel = knownBad || score >= 60 ? "risky" : score >= 30 ? "review" : "ok";
        snap[key] = { version: r.version, perms: p, firstSeen };
        return {
          key,
          id: r.id,
          name: r.name,
          version: r.version,
          browser: r.browser,
          profile: r.profile,
          permissions: p,
          fromStore: r.fromStore,
          forced: r.forced,
          enabled: r.enabled,
          score,
          level,
          reasons,
          knownBad,
          blocked: blocked(r.browser).some((v) => v === r.id || v.startsWith(r.id + ";")),
          newPermissions: newPerms,
        };
      });
      writeFileSync(snapFile(), JSON.stringify(snap));
      const order = { risky: 0, review: 1, ok: 2 };
      exts.sort((a, b) => order[a.level] - order[b.level] || b.score - a.score || a.name.localeCompare(b.name));
      this.st = { scannedAt: Date.now(), scanning: false, managedPc: managed, extensions: exts, hijacks: this.hijacks(raw, managed) };
      writeFileSync(stateFile(), JSON.stringify(this.st));
      return this.st;
    } finally {
      this.st.scanning = false;
    }
  }

  private hijacks(raw: RawExt[], managed: boolean): HijackFinding[] {
    const out: HijackFinding[] = [];
    const sys = this.sys;
    if (!sys) return out;
    // Search engine and homepage set to something unusual (Chromium Preferences).
    for (const b of CHROMIUM) {
      const root = b.dir();
      if (!existsSync(root)) continue;
      for (const prof of ["Default"]) {
        const prefs = readJson(join(root, prof, "Preferences"));
        const search: string = prefs?.default_search_provider_data?.template_url_data?.url ?? "";
        if (search && !NORMAL_SEARCH.test(search))
          out.push({ id: `search|${b.browser}`, kind: "search", title: `${b.browser} searches with an unusual search engine`, detail: `Searches go to ${host(search)}. If you didn't choose this, change it in ${b.browser}'s settings under Search engine.`, fixable: false });
        const home: string = prefs?.homepage ?? "";
        const startup: string[] = prefs?.session?.startup_urls ?? [];
        const odd = [home, ...startup].filter((u) => u && /^https?:/.test(u) && !NORMAL_SEARCH.test(u));
        if (odd.length) out.push({ id: `home|${b.browser}`, kind: "homepage", title: `${b.browser} opens an unusual start page`, detail: `${odd.slice(0, 2).map(host).join(", ")}. If you didn't set this, change it in ${b.browser}'s settings under On startup.`, fixable: false });
      }
    }
    // Windows proxy settings.
    const inet = sys.inet ?? {};
    if (inet.ProxyEnable === "1" && inet.ProxyServer) out.push({ id: "proxy|ProxyServer", kind: "proxy", title: "Windows sends your web traffic through a proxy", detail: `Proxy: ${inet.ProxyServer}. If you or your company didn't set this, it may be watching your browsing.`, fixable: true });
    if (inet.AutoConfigURL) out.push({ id: "proxy|AutoConfigURL", kind: "proxy", title: "A proxy script controls where your web traffic goes", detail: `Script: ${inet.AutoConfigURL}. Malware often uses this to reroute browsing.`, fixable: true });
    // Browser policies on a PC no company manages.
    for (const [browser, pol] of Object.entries<any>(sys.policies ?? {})) {
      for (const [hive, vals] of [["HKLM", pol.force], ["HKCU", pol.forceU]] as const)
        for (const [name, val] of Object.entries<string>(vals ?? {}))
          if (!managed)
            out.push({ id: `force|${browser}|${hive}|${name}`, kind: "policy", title: `A policy forces an extension into ${browser}`, detail: `Extension ${String(val).split(";")[0]} is force-installed. This PC isn't managed by a company, so this is suspicious.`, fixable: true });
      if (!managed) {
        const risky = ["ProxyMode", "ProxyServer", "ProxyPacUrl", "ProxySettings", "DefaultSearchProviderSearchURL", "DefaultSearchProviderEnabled", "HomepageLocation", "RestoreOnStartupURLs", "NewTabPageLocation"];
        for (const hive of ["hklm", "hkcu"] as const)
          for (const name of Object.keys(pol[hive] ?? {}))
            if (risky.includes(name))
              out.push({ id: `pol|${browser}|${hive.toUpperCase()}|${name}`, kind: "policy", title: `A policy controls ${browser}'s ${/Proxy/.test(name) ? "proxy" : /Search/.test(name) ? "search engine" : "start page"}`, detail: `${name} = ${pol[hive][name]}. This shows "Managed by your organization" and stops you changing it.`, fixable: true });
      }
    }
    // DNS servers that aren't the router's or a known public provider.
    for (const d of sys.dns ?? []) {
      const odd = (d.servers as string[]).filter((s) => !isPrivate(s) && !PUBLIC_DNS.test(s));
      if (odd.length && !managed) out.push({ id: `dns|${d.alias}`, kind: "dns", title: `${d.alias} uses unfamiliar DNS servers`, detail: `${odd.join(", ")}. DNS decides which site a name like your bank's goes to. If you didn't set these, switch back to automatic.`, fixable: true });
    }
    // Hosts file lines that redirect sites.
    const hostLines = (sys.hosts ?? []).filter((l: string) => !/^\s*(127\.0\.0\.1|::1|0\.0\.0\.0)\s+(localhost|.*\.localhost)\s*$/i.test(l));
    const redirects = hostLines.filter((l: string) => !/^\s*(0\.0\.0\.0|127\.0\.0\.1)\s/.test(l)); // blocking lists point at 0.0.0.0 or 127.0.0.1
    if (redirects.length) out.push({ id: "hosts", kind: "hosts", title: `Your hosts file redirects ${redirects.length} site${redirects.length > 1 ? "s" : ""}`, detail: redirects.slice(0, 3).join("; ") + (redirects.length > 3 ? " …" : ""), fixable: true });
    // Browser shortcuts with a website tacked on.
    for (const l of sys.links ?? []) out.push({ id: `link|${l.path}`, kind: "shortcut", title: "A browser shortcut opens a website by itself", detail: `${l.path.split("\\").pop()} adds: ${l.args}`, fixable: true });
    return out;
  }

  private ext(key: string) {
    const e = this.st.extensions.find((x) => x.key === key);
    if (!e) throw new Error("Run a scan first.");
    return e;
  }

  async block(key: string): Promise<{ ok: boolean; message: string }> {
    const e = this.ext(key);
    if (mode.isManaged) return { ok: false, message: "This PC is managed by your company's IT, so Rigmind won't change browser policies. Ask IT to block it." };
    if (e.browser === "Firefox") {
      const cur = await runPs(`(Get-ItemProperty -LiteralPath 'HKLM:\\${FIREFOX_POLICY}' -ErrorAction SilentlyContinue).ExtensionSettings`).catch(() => "");
      const prev = cur.trim() || null;
      const obj = readJsonSafe(prev);
      obj[e.id] = { installation_mode: "blocked" };
      await runPs(`New-Item -Path 'HKLM:\\${FIREFOX_POLICY}' -Force | Out-Null; Set-ItemProperty -LiteralPath 'HKLM:\\${FIREFOX_POLICY}' -Name ExtensionSettings -Value ${psq(JSON.stringify(obj))}`);
      history.record(`Blocked ${e.name} in Firefox`, "you", { type: "firefox-block", data: { json: prev } });
    } else {
      const b = CHROMIUM.find((x) => x.browser === e.browser)!;
      const key = `${b.policy}\\ExtensionInstallBlocklist`;
      const name = (
        await runPs(`New-Item -Path 'HKLM:\\${key}' -Force | Out-Null; $k=Get-Item -LiteralPath 'HKLM:\\${key}'; $n=1; while($k.GetValueNames() -contains [string]$n){ $n++ }; New-ItemProperty -LiteralPath 'HKLM:\\${key}' -Name ([string]$n) -Value ${psq(e.id)} -PropertyType String -Force | Out-Null; $n`)
      ).trim();
      history.record(`Blocked ${e.name} in ${e.browser}`, "you", { type: "browser-block", data: { hive: "HKLM", key, name } });
    }
    this.st.extensions = this.st.extensions.map((x) => (x.id === e.id && x.browser === e.browser ? { ...x, blocked: true } : x));
    writeFileSync(stateFile(), JSON.stringify(this.st));
    return { ok: true, message: `${e.name} is blocked. ${e.browser} turns it off the next time it starts, and will show "Managed by your organization". Undo any time in Settings > Change history.` };
  }

  /** Open the browser so the user can remove the extension themselves. */
  async open(key: string): Promise<{ ok: boolean; message: string }> {
    const e = this.ext(key);
    const url = e.browser === "Firefox" ? "about:addons" : CHROMIUM.find((x) => x.browser === e.browser)!.page + e.id;
    clipboard.writeText(url);
    const exe = e.browser === "Firefox" ? "firefox.exe" : CHROMIUM.find((x) => x.browser === e.browser)!.exe;
    // explorer.exe starts the browser as you, not as administrator.
    const path = (await runPs(`(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}' -ErrorAction SilentlyContinue).'(default)'`).catch(() => "")).trim();
    if (path) await runPs(`Start-Process explorer.exe -ArgumentList ${psq(path)}`).catch(() => {});
    return { ok: true, message: `Opened ${e.browser}. Paste into the address bar (Ctrl+V) to go straight to ${e.name}, then click Remove.` };
  }

  async fix(id: string): Promise<{ ok: boolean; message: string }> {
    const f = this.st.hijacks.find((h) => h.id === id);
    if (!f || !f.fixable) return { ok: false, message: "Nothing to fix here." };
    if (mode.isManaged && f.kind !== "shortcut") return { ok: false, message: "This PC is managed by your company's IT, so Rigmind won't change this. Ask IT about it." };
    const [kind, ...rest] = id.split("|");
    const removeValue = async (hive: string, key: string, name: string, label: string) => {
      const value = (await runPs(`(Get-ItemProperty -LiteralPath ${psq(`${hive}:\\${key}`)} -ErrorAction SilentlyContinue).${psq(name)}`).catch(() => "")).trim();
      const kindOf = (await runPs(`(Get-Item -LiteralPath ${psq(`${hive}:\\${key}`)}).GetValueKind(${psq(name)})`).catch(() => "String")).trim() || "String";
      await runPs(`Remove-ItemProperty -LiteralPath ${psq(`${hive}:\\${key}`)} -Name ${psq(name)} -ErrorAction Stop`);
      history.record(label, "you", { type: "reg-value", data: { hive, key, name, value, kind: kindOf } });
    };
    if (kind === "proxy") {
      const key = "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
      if (rest[0] === "ProxyServer") {
        await runPs(`Set-ItemProperty -LiteralPath 'HKCU:\\${key}' -Name ProxyEnable -Value 0`);
        history.record("Turned off the Windows proxy", "you", { type: "reg-value", data: { hive: "HKCU", key, name: "ProxyEnable", value: "1", kind: "DWord" } });
      } else await removeValue("HKCU", key, "AutoConfigURL", "Removed the proxy script");
    } else if (kind === "force") {
      const [browser, hive, name] = rest;
      const base = browser === "Firefox" ? FIREFOX_POLICY : CHROMIUM.find((b) => b.browser === browser)!.policy;
      await removeValue(hive, `${base}\\ExtensionInstallForcelist`, name, `Removed a forced ${browser} extension policy`);
    } else if (kind === "pol") {
      const [browser, hive, name] = rest;
      const base = browser === "Firefox" ? FIREFOX_POLICY : CHROMIUM.find((b) => b.browser === browser)!.policy;
      await removeValue(hive, base, name, `Removed the ${browser} policy ${name}`);
    } else if (kind === "dns") {
      const alias = rest.join("|");
      const d = (this.sys?.dns ?? []).find((x: any) => x.alias === alias);
      await runPs(`Set-DnsClientServerAddress -InterfaceAlias ${psq(alias)} -ResetServerAddresses`);
      history.record(`Set ${alias} DNS back to automatic`, "you", { type: "dns-restore", data: { alias, servers: d?.servers ?? [] } });
    } else if (kind === "hosts") {
      const hosts = join(process.env.windir ?? "C:\\Windows", "System32", "drivers", "etc", "hosts");
      const backup = join(dataDir("browserguard"), `hosts-${Date.now()}.bak`);
      copyFileSync(hosts, backup);
      const lines = readFileSync(hosts, "utf8").split(/\r?\n/).map((l) => (/^\s*[^#\s]/.test(l) && !/^\s*(0\.0\.0\.0|127\.0\.0\.1|::1)\s/.test(l) ? `# disabled by Rigmind: ${l}` : l));
      writeFileSync(hosts, lines.join("\r\n"));
      history.record("Turned off redirects in the hosts file", "you", { type: "hosts-restore", data: { backup } });
    } else if (kind === "link") {
      const path = rest.join("|");
      const l = (this.sys?.links ?? []).find((x: any) => x.path === path);
      await runPs(`$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${psq(path)}); $s.Arguments=''; $s.Save()`);
      history.record(`Cleaned the shortcut ${path.split("\\").pop()}`, "you", { type: "shortcut-args", data: { path, args: l?.args ?? "" } });
    }
    this.st.hijacks = this.st.hijacks.filter((h) => h.id !== id);
    writeFileSync(stateFile(), JSON.stringify(this.st));
    return { ok: true, message: "Fixed. Undo any time in Settings > Change history." };
  }

}

function readJsonSafe(s: string | null | undefined): Record<string, any> {
  try {
    const v = s ? JSON.parse(s) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
const host = (u: string) => {
  try {
    return new URL(u.replace("{searchTerms}", "x")).host;
  } catch {
    return u.slice(0, 60);
  }
};

export const browserGuard = new BrowserGuard();
