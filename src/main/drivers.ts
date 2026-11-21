// Driver & firmware checks.
// - GPU: NVIDIA latest Game Ready version from NVIDIA's driver lookup service; AMD/Intel via their tools.
// - Device drivers: Windows Update's driver catalog (search + one-click install).
// - Firmware (BIOS, SSD): checked and reported only. Rigmind never flashes firmware.
import { createWriteStream, existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { runPsJson, runPs, psq } from "./ps";
import { dataDir } from "./store";
import type { DriverScan, DriverItem, FirmwareItem, WindowsUpdateDriver } from "../shared/types";

const SCAN = String.raw`
$ErrorActionPreference='SilentlyContinue'
function D($d){ if($d){ try { ([Management.ManagementDateTimeConverter]::ToDateTime($d)).ToString('yyyy-MM-dd') } catch { $null } } }
$gpus=@(Get-CimInstance Win32_VideoController | ForEach-Object { [ordered]@{ name=$_.Name; version=$_.DriverVersion; date=(D $_.DriverDate); pnp=$_.PNPDeviceID } })
$classes='NET','MEDIA','SYSTEM','HDC','SCSIADAPTER','USB','BLUETOOTH','BIOMETRIC'
$devs=@(Get-CimInstance Win32_PnPSignedDriver | Where-Object { $classes -contains $_.DeviceClass -and $_.DriverProviderName -and $_.DriverProviderName -notmatch '^Microsoft' -and $_.DeviceName } |
  Sort-Object DeviceName -Unique | Select-Object -First 40 | ForEach-Object { [ordered]@{ name=$_.DeviceName; cls=$_.DeviceClass; provider=$_.DriverProviderName; version=$_.DriverVersion; date=(D $_.DriverDate) } })
$bb=Get-CimInstance Win32_BaseBoard; $bios=Get-CimInstance Win32_BIOS
$disks=@(Get-PhysicalDisk | ForEach-Object { [ordered]@{ name=$_.FriendlyName; fw=$_.FirmwareVersion; media="$($_.MediaType)"; bus="$($_.BusType)" } })
$wu=@(); $wuErr=$null
try {
  $s=New-Object -ComObject Microsoft.Update.Session
  $r=$s.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Driver'")
  foreach($u in $r.Updates){ $wu+=[ordered]@{ id=$u.Identity.UpdateID; title=$u.Title; cls="$($u.DriverClass)"; mfr="$($u.DriverManufacturer)"; date=$(if($u.DriverVerDate){$u.DriverVerDate.ToString('yyyy-MM-dd')}else{$null}) } }
} catch { $wuErr=$_.Exception.Message }
[ordered]@{
  gpus=$gpus; devices=$devs; disks=$disks; wu=$wu; wuErr=$wuErr
  board=[ordered]@{ mfr=$bb.Manufacturer; product=$bb.Product }
  bios=[ordered]@{ version=$bios.SMBIOSBIOSVersion; date=$(if($bios.ReleaseDate){$bios.ReleaseDate.ToString('yyyy-MM-dd')}else{$null}); vendor=$bios.Manufacturer }
} | ConvertTo-Json -Compress -Depth 4`;

interface RawScan {
  gpus: { name: string; version: string; date: string | null; pnp: string }[];
  devices: { name: string; cls: string; provider: string; version: string; date: string | null }[];
  disks: { name: string; fw: string; media: string; bus: string }[];
  wu: { id: string; title: string; cls: string; mfr: string; date: string | null }[];
  wuErr: string | null;
  board: { mfr: string; product: string };
  bios: { version: string; date: string | null; vendor: string };
}

const scanFile = () => join(dataDir("drivers"), "last-scan.json");
let cached: DriverScan | null = null;

export function lastScan(): DriverScan | null {
  if (cached) return cached;
  try {
    if (existsSync(scanFile())) cached = JSON.parse(readFileSync(scanFile(), "utf8"));
  } catch {
    /* ignore */
  }
  return cached;
}

const search = (q: string) => "https://www.google.com/search?q=" + encodeURIComponent(q);
const ageDays = (d: string | null) => (d ? Math.round((Date.now() - new Date(d).getTime()) / 86_400_000) : null);
const arr = <T>(x: T | T[] | null | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);

/** Windows driver version 32.0.15.6614 -> NVIDIA version 566.14 */
export function nvidiaVersionFromWindows(v: string): string | null {
  const digits = v.split(".").slice(-2).join("");
  if (digits.length < 5) return null;
  const last5 = digits.slice(-5);
  return `${last5.slice(0, 3)}.${last5.slice(3)}`;
}

async function nvidiaLatest(): Promise<{ version: string; url: string; date: string } | null> {
  // GeForce Game Ready drivers are unified across current cards, so one product id
  // (pfid 933 = RTX 3070, osID 57 = Windows 10/11 64-bit, DCH) returns the current release.
  const url = "https://gfwsl.geforce.com/services_toolkit/services/com/nvidia/services/AjaxDriverService.php?func=DriverManualLookup&pfid=933&osID=57&languageCode=1033&isWHQL=1&dch=1&sort1=0&numberOfResults=1";
  const res = await fetch(url);
  if (!res.ok) return null;
  const j: any = await res.json();
  const info = j?.IDS?.[0]?.downloadInfo;
  if (!info?.Version) return null;
  return { version: String(info.Version), url: decodeURIComponent(String(info.DownloadURL)), date: String(info.ReleaseDateTime ?? "") };
}

/** Safe, vendor-specific BIOS update steps. Rigmind never flashes firmware itself. */
function biosGuide(mfr: string): { vendor: string; tool: string; steps: string[] } {
  const m = mfr.toLowerCase();
  const [vendor, tool, enter] = m.includes("gigabyte")
    ? ["Gigabyte", "Q-Flash", "press End during startup, or Delete for the BIOS and choose Q-Flash"]
    : m.includes("asus")
    ? ["ASUS", "EZ Flash", "press Delete during startup, go to Advanced Mode > Tool > EZ Flash"]
    : m.includes("micro-star") || m.includes("msi")
    ? ["MSI", "M-Flash", "press Delete during startup and choose M-Flash"]
    : m.includes("asrock")
    ? ["ASRock", "Instant Flash", "press F6 during startup, or Delete and go to Tool > Instant Flash"]
    : [mfr || "your board maker", "the BIOS's built-in flash tool", "enter the BIOS (usually Delete or F2 at startup) and find its update tool"];
  return {
    vendor,
    tool,
    steps: [
      `Download the newest BIOS for your exact board and revision from ${vendor}'s official support page. Read the notes: some updates can't be rolled back, and some need an in-between version first.`,
      "Write down or photograph your BIOS settings you changed: XMP/EXPO memory profile, fan curves, boot order, virtualization, overclocks. The update resets them.",
      "If you use BitLocker, find your recovery key first (account.microsoft.com/devices/recoverykey). A BIOS update can trigger a recovery prompt.",
      "Extract the download and copy the BIOS file to the root of a USB stick formatted as FAT32.",
      `Restart and ${enter}. Pick the file from the USB stick and start the update.`,
      "Don't turn off or restart the PC while it flashes. It can take several minutes and may reboot more than once by itself.",
      "When it's done, load optimized defaults, then turn your settings back on (XMP/EXPO first). Then open Rigmind and run a stress test.",
    ],
  };
}

function ssdTool(name: string): { tool: string; link: string } {
  const n = name.toLowerCase();
  if (n.includes("samsung")) return { tool: "Samsung Magician", link: search("Samsung Magician download") };
  if (/\bwd|western digital|sandisk/.test(n)) return { tool: "WD Dashboard", link: search("WD Dashboard download") };
  if (/crucial|\bct\d/.test(n)) return { tool: "Crucial Storage Executive", link: search("Crucial Storage Executive download") };
  if (n.includes("kingston")) return { tool: "Kingston SSD Manager", link: search("Kingston SSD Manager download") };
  if (n.includes("seagate")) return { tool: "Seagate SeaTools", link: search("Seagate SeaTools SSD firmware") };
  if (/sk ?hynix|solidigm/.test(n)) return { tool: "the maker's SSD toolbox", link: search(name + " SSD firmware toolbox") };
  return { tool: "the maker's SSD tool", link: search(name + " SSD firmware update") };
}

export async function scanDrivers(progress: (m: string) => void): Promise<DriverScan> {
  progress("Reading installed drivers and asking Windows Update for driver updates (this can take a minute)...");
  const errors: string[] = [];
  const raw = await runPsJson<RawScan>(SCAN, 240_000);
  progress("Checking NVIDIA for the latest driver...");
  const hasNvidia = arr(raw.gpus).some((g) => /nvidia/i.test(g.name));
  const nv = hasNvidia ? await nvidiaLatest().catch((e) => (errors.push("NVIDIA lookup failed: " + e.message), null)) : null;

  const gpu: DriverItem[] = arr(raw.gpus)
    .filter((g) => !/Microsoft Basic|Virtual|Parsec|Remote/i.test(g.name))
    .map((g) => {
      if (/nvidia/i.test(g.name)) {
        const inst = nvidiaVersionFromWindows(g.version) ?? g.version;
        const update = !!nv && parseFloat(nv.version) > parseFloat(inst);
        return { name: g.name, category: "Graphics", installedVersion: inst, installedDate: g.date, latestVersion: nv?.version ?? null, status: nv ? (update ? "update" : "current") : "unknown", note: update ? `Game Ready ${nv!.version} is available.` : undefined } as DriverItem;
      }
      if (/amd|radeon/i.test(g.name))
        return { name: g.name, category: "Graphics", installedVersion: g.version, installedDate: g.date, status: "check", note: "AMD doesn't publish a version API. Use AMD Software: Adrenalin Edition > Check for updates.", link: "https://www.amd.com/en/support/download/drivers.html" } as DriverItem;
      return { name: g.name, category: "Graphics", installedVersion: g.version, installedDate: g.date, status: "check", note: "Use Intel Driver & Support Assistant for the latest Intel graphics driver.", link: search("Intel Driver & Support Assistant download") } as DriverItem;
    });

  if (raw.wuErr) errors.push("Windows Update search failed: " + raw.wuErr);
  const windowsUpdate: WindowsUpdateDriver[] = arr(raw.wu).map((u) => ({
    id: u.id,
    title: u.title,
    driverClass: u.cls,
    manufacturer: u.mfr,
    date: u.date,
    isFirmware: /firmware/i.test(u.cls + " " + u.title),
  }));
  const wuTitles = windowsUpdate.map((w) => w.title.toLowerCase());

  const devices: DriverItem[] = arr(raw.devices).map((d) => {
    const age = ageDays(d.date);
    const hasWu = wuTitles.some((t) => t.includes(d.provider.toLowerCase().split(" ")[0]));
    return {
      name: d.name,
      category: d.cls,
      installedVersion: d.version,
      installedDate: d.date,
      status: hasWu ? "update" : age != null && age > 730 ? "check" : "current",
      note: hasWu ? "An update from this maker is listed in Windows Update below." : age != null && age > 730 ? `Driver is ${Math.round(age / 365)} years old - check ${d.provider}'s site.` : undefined,
      link: age != null && age > 730 ? search(`${d.provider} ${d.name} driver download`) : undefined,
    };
  });

  const firmware: FirmwareItem[] = [];
  const biosAge = ageDays(raw.bios.date);
  const boardName = `${raw.board.mfr ?? ""} ${raw.board.product ?? ""}`.trim();
  const guide = biosGuide(raw.board.mfr ?? "");
  firmware.push({
    kind: "bios",
    name: boardName || "Motherboard BIOS",
    version: raw.bios.version ?? "unknown",
    date: raw.bios.date,
    ageDays: biosAge,
    advice:
      biosAge != null && biosAge > 365
        ? `Your BIOS is ${Math.floor(biosAge / 30)} months old. Newer versions often fix stability, memory compatibility (XMP/EXPO) and CPU microcode issues. Check the support page and update with the board's own tool (e.g. Q-Flash, EZ Flash, M-Flash) from a USB stick.`
        : "BIOS is reasonably recent. Only update if the release notes fix something you need.",
    link: search(`${boardName} BIOS download support`),
    guide,
  });
  for (const d of arr(raw.disks).filter((d) => /ssd|nvme/i.test(d.media + d.bus))) {
    const t = ssdTool(d.name);
    firmware.push({ kind: "ssd", name: d.name, version: d.fw, date: null, ageDays: null, advice: `Check for SSD firmware updates with ${t.tool}. Back up first.`, link: t.link });
  }

  cached = { scannedAt: Date.now(), gpu, nvidiaLatest: nv, devices, windowsUpdate, firmware, errors };
  writeFileSync(scanFile(), JSON.stringify(cached));
  progress("Scan complete.");
  return cached;
}

/** Install selected Windows Update drivers (restore point first). */
export async function installWindowsUpdate(ids: string[], progress: (m: string) => void): Promise<{ ok: boolean; message: string }> {
  if (!ids.length) return { ok: false, message: "Nothing selected." };
  progress("Creating a restore point...");
  progress(`Downloading and installing ${ids.length} driver update(s)...`);
  const list = ids.map(psq).join(",");
  const out = await runPs(
    String.raw`
$ErrorActionPreference='SilentlyContinue'
try { Checkpoint-Computer -Description 'Rigmind driver update' -RestorePointType DEVICE_DRIVER_INSTALL } catch {}
$ids=@(${list})
$s=New-Object -ComObject Microsoft.Update.Session
$r=$s.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Driver'")
$col=New-Object -ComObject Microsoft.Update.UpdateColl
foreach($u in $r.Updates){ if($ids -contains $u.Identity.UpdateID){ if(-not $u.EulaAccepted){ $u.AcceptEula() }; [void]$col.Add($u) } }
if($col.Count -eq 0){ 'NONE'; exit }
$dl=$s.CreateUpdateDownloader(); $dl.Updates=$col; [void]$dl.Download()
$ins=$s.CreateUpdateInstaller(); $ins.Updates=$col; $res=$ins.Install()
"RESULT $($res.ResultCode) REBOOT $($res.RebootRequired)"`,
    1_800_000
  );
  if (out.includes("NONE")) return { ok: false, message: "Those updates are no longer offered (maybe already installed)." };
  const m = out.match(/RESULT (\d) REBOOT (\w+)/);
  const ok = m?.[1] === "2" || m?.[1] === "3"; // 2 = succeeded, 3 = succeeded with errors
  const reboot = m?.[2] === "True";
  return { ok, message: ok ? `Installed.${reboot ? " Restart your PC to finish." : ""}` : "Windows Update reported a failure. Try again from Settings > Windows Update." };
}

/** Download the latest NVIDIA driver and launch its installer. */
/** Download the latest NVIDIA driver package (once). Returns its path and version. */
export async function downloadNvidia(progress: (m: string) => void): Promise<{ ok: boolean; message: string; path?: string; version?: string }> {
  const nv = lastScan()?.nvidiaLatest ?? (await nvidiaLatest());
  if (!nv) return { ok: false, message: "Couldn't find the latest NVIDIA driver." };
  const dest = join(tmpdir(), `nvidia-${nv.version}.exe`);
  if (!existsSync(dest)) {
    progress(`Downloading NVIDIA ${nv.version}...`);
    const res = await fetch(nv.url);
    if (!res.ok || !res.body) return { ok: false, message: `Download failed (${res.status}).` };
    const total = Number(res.headers.get("content-length") ?? 0);
    let got = 0;
    let lastPct = -1;
    const body = Readable.fromWeb(res.body as any);
    body.on("data", (c: Buffer) => {
      got += c.length;
      const pct = total ? Math.floor((got / total) * 100) : 0;
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct;
        progress(`Downloading NVIDIA ${nv.version}... ${pct}%`);
      }
    });
    try {
      await pipeline(body, createWriteStream(dest));
    } catch (e: any) {
      if (existsSync(dest)) unlinkSync(dest);
      return { ok: false, message: "Download failed: " + e.message };
    }
  }
  return { ok: true, message: `NVIDIA ${nv.version} is downloaded.`, path: dest, version: nv.version };
}

export async function installNvidia(progress: (m: string) => void): Promise<{ ok: boolean; message: string }> {
  const d = await downloadNvidia(progress);
  if (!d.ok || !d.path) return d;
  progress("Starting the NVIDIA installer. Choose Express or Custom > Clean install.");
  spawn(d.path, [], { detached: true, stdio: "ignore" }).unref();
  return { ok: true, message: `NVIDIA ${d.version} installer is open. Close your games before installing.` };
}

/**
 * Unattended install for Ready to Play. Uses the package's own silent switches and keeps your
 * NVIDIA settings (no clean install). Rigmind checks the new version with nvidia-smi afterwards.
 */
export async function installNvidiaSilent(progress: (m: string) => void): Promise<{ ok: boolean; message: string; version?: string }> {
  const d = await downloadNvidia(progress);
  if (!d.ok || !d.path) return d;
  progress(`Installing NVIDIA ${d.version} silently...`);
  const code = await new Promise<number | null>((resolve) => {
    const p = spawn(d.path!, ["-s", "-noreboot", "-noeula"], { windowsHide: true });
    const t = setTimeout(() => {
      p.kill();
      resolve(-1);
    }, 25 * 60_000);
    p.on("exit", (c) => {
      clearTimeout(t);
      resolve(c);
    });
    p.on("error", () => resolve(-2));
  });
  if (code !== 0 && code !== 1) return { ok: false, message: `The NVIDIA installer stopped with code ${code}.` };
  return { ok: true, message: `NVIDIA ${d.version} installed.`, version: d.version };
}
