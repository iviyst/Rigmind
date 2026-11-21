// Space and memory explorer: what's filling the drive, what's eating RAM, and safe fixes.
// Rules: nothing is deleted without a preview and a click; your own files only ever go to the
// Recycle Bin; system cleanup always goes through Windows' own tools.
import { EventEmitter } from "node:events";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { totalmem } from "node:os";
import { hw } from "./hw";
import { runPs, runPsJson, psq } from "./ps";
import { telemetry } from "./telemetry";
import { history } from "./history";
import { listSessions } from "./sessions";
import { isProtected } from "./winsys";
import type { AppMemory, CleanupPreview, DirNode, DiskInfo, DiskMap, MemoryView, SpaceHog, StartupItem } from "../shared/types";

const L = () => process.env.LOCALAPPDATA ?? "";
const HOME = () => process.env.USERPROFILE ?? "";
const WIN = () => process.env.windir ?? "C:\\Windows";
const GB = 1024 ** 3;

const FRIENDLY: Record<string, string> = {
  chrome: "Chrome", msedge: "Edge", firefox: "Firefox", brave: "Brave", opera: "Opera", "ms-teams": "Teams", teams: "Teams", olk: "Outlook", outlook: "Outlook",
  excel: "Excel", winword: "Word", powerpnt: "PowerPoint", code: "VS Code", devenv: "Visual Studio", discord: "Discord", slack: "Slack", spotify: "Spotify",
  steam: "Steam", steamwebhelper: "Steam", epicgameslauncher: "Epic Games", onedrive: "OneDrive", zoom: "Zoom", vmmem: "WSL / Docker", vmmemwsl: "WSL", "memory compression": "Windows memory compression",
};
const appName = (proc: string) => FRIENDLY[proc.toLowerCase()] ?? proc;

const sizeOf = (p: string) =>
  runPs(`$s=(Get-ChildItem -LiteralPath ${psq(p)} -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum; if($s){[int64]$s}else{0}`, 120_000)
    .then((o) => Number(o.trim()) || 0)
    .catch(() => 0);

/** Send files to the Recycle Bin (never a permanent delete for the user's own files). */
const recycle = (paths: string[]) =>
  runPs(`Add-Type -AssemblyName Microsoft.VisualBasic
foreach($p in @(${paths.map(psq).join(",")})){ if(Test-Path -LiteralPath $p){ [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin') } }`, 10 * 60_000);
const removeDirContents = (p: string) => runPs(`Get-ChildItem -LiteralPath ${psq(p)} -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue`, 10 * 60_000);
const freeOnC = () => runPs("(Get-PSDrive C).Free").then((o) => Number(o.trim()) || 0).catch(() => 0);

interface HogImpl {
  hog: SpaceHog;
  items?: { path: string; bytes: number }[];
  clean?: () => Promise<unknown>;
}

const DEV_CACHES = [
  { id: "npm", name: "npm cache", path: () => join(L(), "npm-cache") },
  { id: "nuget", name: "NuGet packages", path: () => join(HOME(), ".nuget", "packages") },
  { id: "pip", name: "pip cache", path: () => join(L(), "pip", "Cache") },
  { id: "gradle", name: "Gradle caches", path: () => join(HOME(), ".gradle", "caches") },
  { id: "cargo", name: "Cargo downloads", path: () => join(HOME(), ".cargo", "registry", "cache") },
  { id: "yarn", name: "Yarn cache", path: () => join(L(), "Yarn", "Cache") },
];
export const devCaches = () => DEV_CACHES.map((c) => ({ ...c, path: c.path() }));

const BROWSER_CACHES = [
  { name: "Chrome", exe: "chrome", root: () => join(L(), "Google", "Chrome", "User Data") },
  { name: "Edge", exe: "msedge", root: () => join(L(), "Microsoft", "Edge", "User Data") },
  { name: "Brave", exe: "brave", root: () => join(L(), "BraveSoftware", "Brave-Browser", "User Data") },
];
function browserCacheDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  let profs: string[] = [];
  try {
    profs = readdirSync(root).filter((d) => d === "Default" || /^Profile \d+$/.test(d));
  } catch {
    return [];
  }
  return profs.flatMap((p) => ["Cache", "Code Cache", "GPUCache"].map((c) => join(root, p, c))).filter((d) => existsSync(d));
}

class Space extends EventEmitter {
  private hogs = new Map<string, HogImpl>();
  private memHistory = new Map<string, number[]>();

  init() {
    hw.on("diskprogress", (p) => this.emit("progress", p));
    // One memory point per app every 10 minutes, for 24 hours.
    setInterval(() => this.sampleMemory(), 10 * 60_000);
    setTimeout(() => this.sampleMemory(), 60_000);
    history.registerUndo("startup-toggle", async (d: { id: string; enabled: boolean }) => {
      await this.setStartup(d.id, d.enabled, false);
      return d.enabled ? "Turned back on at startup." : "Turned off at startup.";
    });
  }

  async disks(): Promise<DiskInfo[]> {
    return runPsJson<DiskInfo[]>(
      "ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { [ordered]@{drive=$_.DeviceID;label=[string]$_.VolumeName;totalBytes=[int64]$_.Size;freeBytes=[int64]$_.FreeSpace} })"
    ).catch(() => []);
  }

  async scan(drive: string): Promise<DiskMap> {
    if (!/^[A-Z]:$/i.test(drive)) throw new Error("Pick a drive like C:");
    if (!hw.built) throw new Error("The disk map needs Rigmind's hardware helper. Run npm run build:hw before building.");
    if (!hw.running) throw new Error("The hardware helper isn't running yet. Try again in a few seconds.");
    const r = await hw.diskScan(drive.toUpperCase() + "\\");
    if (!r) throw new Error("The scan didn't finish. Try again.");
    const fix = (n: any): DirNode => ({ name: n.name || n.path, path: n.path, bytes: n.bytes, files: n.files, children: n.children?.map(fix) });
    return { drive: drive.toUpperCase(), scannedAt: Date.now(), seconds: r.seconds, root: fix(r.root), bigFiles: r.bigFiles };
  }

  // ---------- Space hogs ----------
  async findHogs(): Promise<SpaceHog[]> {
    const next = new Map<string, HogImpl>();
    const add = (h: HogImpl) => h.hog.bytes > 50 * 1024 ** 2 && next.set(h.hog.id, h);

    const sys = await runPsJson<any>(String.raw`
$ErrorActionPreference='SilentlyContinue'
function S($p){ $s=(Get-ChildItem -LiteralPath $p -Recurse -Force -File | Measure-Object Length -Sum).Sum; if($s){[int64]$s}else{0} }
$rb=0; $sh=New-Object -ComObject Shell.Application; foreach($i in $sh.NameSpace(10).Items()){ $rb+=[int64]$i.Size }
$vss=(vssadmin list shadowstorage /for=C: | Select-String 'Used Shadow Copy Storage space:\s*([\d.,]+)\s*(KB|MB|GB|TB)')
$vssB=0; if($vss){ $n=[double]($vss.Matches[0].Groups[1].Value -replace ',',''); $u=$vss.Matches[0].Groups[2].Value; $vssB=[int64]($n*@{KB=1KB;MB=1MB;GB=1GB;TB=1TB}[$u]) }
$disp=@(Get-WindowsDriver -Online | Where-Object { $_.ClassName -eq 'Display' } | ForEach-Object { [ordered]@{inf=$_.Driver;orig=$_.OriginalFileName;provider=$_.ProviderName;version=[string]$_.Version;date=$_.Date.ToString('o')} })
[ordered]@{
  wu=(S "$env:windir\SoftwareDistribution\Download")
  winold=$(if(Test-Path 'C:\Windows.old'){ S 'C:\Windows.old' }else{ 0 })
  temp=(S $env:TEMP)+(S "$env:windir\Temp")
  recycle=$rb
  vss=$vssB
  hiber=$(if(Test-Path 'C:\hiberfil.sys' ){ (Get-Item 'C:\hiberfil.sys' -Force).Length }else{0})
  nvidia=$(if(Test-Path 'C:\NVIDIA'){ S 'C:\NVIDIA' }else{0})
  amd=$(if(Test-Path 'C:\AMD'){ S 'C:\AMD' }else{0})
  display=$disp
} | ConvertTo-Json -Depth 4 -Compress`, 240_000).catch(() => ({}));

    add({
      hog: { id: "winupdate", label: "Old Windows Update files", bytes: sys.wu ?? 0, detail: "Downloaded update files Windows no longer needs. Cleaned with Windows' own component cleanup.", fix: "Clean up", needsPreview: false },
      clean: () => runPs(`Stop-Service wuauserv,BITS -Force -ErrorAction SilentlyContinue; Get-ChildItem "$env:windir\\SoftwareDistribution\\Download" -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; Start-Service BITS,wuauserv -ErrorAction SilentlyContinue; Dism.exe /Online /Cleanup-Image /StartComponentCleanup /Quiet`, 60 * 60_000),
    });
    add({ hog: { id: "winold", label: "Previous Windows installation (Windows.old)", bytes: sys.winold ?? 0, detail: "Kept after a Windows upgrade so you can go back. Windows removes it on its own after 10 days; Disk Cleanup can remove it sooner.", fix: "Open Disk Cleanup", needsPreview: false }, clean: () => runPs("Start-Process cleanmgr.exe -ArgumentList '/d C:'") });
    add({
      hog: { id: "temp", label: "Temp files and Recycle Bin", bytes: (sys.temp ?? 0) + (sys.recycle ?? 0), detail: "Leftovers from installers and apps, plus what's in the Recycle Bin.", fix: "Empty", needsPreview: false },
      clean: () => runPs(`Get-ChildItem $env:TEMP -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; Get-ChildItem "$env:windir\\Temp" -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; Clear-RecycleBin -Force -ErrorAction SilentlyContinue`, 10 * 60_000),
    });
    add({ hog: { id: "vss", label: "System Restore storage", bytes: sys.vss ?? 0, detail: "Restore points let you undo a bad driver or update. Capping the space at 5% keeps recent ones and frees the rest.", fix: "Cap at 5%", needsPreview: false }, clean: () => runPs("vssadmin resize shadowstorage /for=C: /on=C: /maxsize=5%") });
    add({ hog: { id: "hiber", label: "Hibernation file", bytes: sys.hiber ?? 0, detail: "Holds your RAM while the PC hibernates. Turning hibernation off frees it, but that's your call: it also turns off Fast Startup.", fix: null, needsPreview: false } });

    // GPU driver packages: keep the newest two per maker, plus installer leftovers.
    const display = (sys.display ?? []) as { inf: string; orig: string; provider: string; version: string; date: string }[];
    const old: { inf: string; dir: string }[] = [];
    for (const prov of new Set(display.map((d) => d.provider))) {
      const pkgs = display.filter((d) => d.provider === prov).sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
      for (const p of pkgs.slice(2)) old.push({ inf: p.inf, dir: p.orig.replace(/\\[^\\]+$/, "") });
    }
    const oldItems = await Promise.all(old.map(async (o) => ({ path: o.dir, bytes: await sizeOf(o.dir), inf: o.inf })));
    const leftovers = [sys.nvidia ? { path: "C:\\NVIDIA", bytes: sys.nvidia } : null, sys.amd ? { path: "C:\\AMD", bytes: sys.amd } : null].filter(Boolean) as { path: string; bytes: number }[];
    add({
      hog: { id: "gpudrivers", label: "Old GPU driver packages and installer leftovers", bytes: oldItems.reduce((a, b) => a + b.bytes, 0) + leftovers.reduce((a, b) => a + b.bytes, 0), detail: "Copies of graphics drivers you've already replaced. Rigmind keeps your current driver and the one before it.", fix: "Remove old copies", needsPreview: true },
      items: [...oldItems.map(({ path, bytes }) => ({ path, bytes })), ...leftovers],
      clean: async () => {
        // pnputil refuses to remove a driver that's in use, so the current one is always safe.
        for (const o of oldItems) await runPs(`pnputil.exe /delete-driver ${psq(o.inf)}`).catch(() => {});
        for (const l of leftovers) await runPs(`Remove-Item -LiteralPath ${psq(l.path)} -Recurse -Force -ErrorAction SilentlyContinue`);
      },
    });

    // Browser caches (only cleaned while the browser is closed).
    for (const b of BROWSER_CACHES) {
      const dirs = browserCacheDirs(b.root());
      if (!dirs.length) continue;
      const bytes = (await Promise.all(dirs.map(sizeOf))).reduce((a, x) => a + x, 0);
      add({
        hog: { id: `browser-${b.exe}`, label: `${b.name} cache`, bytes, detail: `Saved copies of web pages and images. ${b.name} rebuilds what it needs. Close ${b.name} first.`, fix: "Clear", needsPreview: false },
        clean: async () => {
          if (telemetry.procs.some((p) => p.name.toLowerCase() === b.exe)) throw new Error(`Close ${b.name} first, then try again.`);
          for (const d of dirs) await removeDirContents(d);
        },
      });
    }

    // Developer caches.
    for (const c of devCaches()) {
      if (!existsSync(c.path)) continue;
      add({ hog: { id: `dev-${c.id}`, label: c.name, bytes: await sizeOf(c.path), detail: "Downloaded packages your build tools can fetch again when needed.", fix: "Clean", needsPreview: false }, clean: () => removeDirContents(c.path) });
    }

    // Steam games not played in 90+ days.
    for (const g of await this.unplayedGames()) {
      add({ hog: { id: `game-${g.appId}`, label: `${g.name} (not played in ${g.days} days)`, bytes: g.bytes, detail: "Uninstalled through Steam, so your saves and cloud data stay safe. You can reinstall any time.", fix: "Uninstall in Steam", needsPreview: false }, clean: () => runPs(`Start-Process ${psq(`steam://uninstall/${g.appId}`)}`) });
    }

    // Big old downloads and duplicates: user files, preview + Recycle Bin only.
    const user = await runPsJson<{ old: { path: string; bytes: number }[]; dupe: { path: string; bytes: number; mod: number }[] }>(String.raw`
$ErrorActionPreference='SilentlyContinue'
$cut=(Get-Date).AddDays(-60)
$old=@(Get-ChildItem "$env:USERPROFILE\Downloads" -File -Recurse -Depth 2 -Force | Where-Object { $_.Length -gt 200MB -and $_.LastWriteTime -lt $cut } | Sort-Object Length -Descending | Select-Object -First 40 | ForEach-Object { [ordered]@{path=$_.FullName;bytes=$_.Length} })
$roots=@("$env:USERPROFILE\Downloads",[Environment]::GetFolderPath('MyDocuments'),[Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('MyVideos'),[Environment]::GetFolderPath('MyPictures'))
$big=@(foreach($r in $roots){ Get-ChildItem $r -File -Recurse -Depth 4 -Force | Where-Object { $_.Length -gt 20MB } })
$dupe=@($big | Group-Object Length | Where-Object Count -gt 1 | ForEach-Object { $_.Group } | ForEach-Object { [ordered]@{path=$_.FullName;bytes=$_.Length;mod=[int64]($_.LastWriteTimeUtc - [datetime]'1970-01-01').TotalMilliseconds} })
[ordered]@{old=$old;dupe=$dupe} | ConvertTo-Json -Depth 3 -Compress`, 180_000).catch(() => ({ old: [], dupe: [] }));
    if (user.old?.length)
      add({ hog: { id: "olddownloads", label: "Large old downloads", bytes: user.old.reduce((a, b) => a + b.bytes, 0), detail: "Files over 200 MB in Downloads that haven't changed in 60 days. Pick what to remove; they go to the Recycle Bin.", fix: "Review", needsPreview: true }, items: user.old, clean: () => recycle(user.old.map((x) => x.path)) });
    if (user.dupe?.length) {
      // Same size isn't proof: hash the candidates and keep the oldest copy of each.
      const hashed = await hw.hashFiles(user.dupe.map((d) => d.path));
      const byHash = new Map<string, { path: string; bytes: number; mod: number }[]>();
      for (const h of hashed) {
        const d = user.dupe.find((x) => x.path === h.path)!;
        byHash.set(h.sha256, [...(byHash.get(h.sha256) ?? []), d]);
      }
      const extra = [...byHash.values()].filter((g) => g.length > 1).flatMap((g) => g.sort((a, b) => a.mod - b.mod).slice(1).map(({ path, bytes }) => ({ path, bytes })));
      if (extra.length)
        add({ hog: { id: "duplicates", label: "Duplicate files", bytes: extra.reduce((a, b) => a + b.bytes, 0), detail: "Exact copies of the same file. Rigmind keeps the oldest copy of each and offers the rest; they go to the Recycle Bin.", fix: "Review", needsPreview: true }, items: extra, clean: () => recycle(extra.map((x) => x.path)) });
    }

    this.hogs = next;
    return [...next.values()].map((h) => h.hog).sort((a, b) => b.bytes - a.bytes);
  }

  private async unplayedGames(): Promise<{ appId: string; name: string; bytes: number; days: number }[]> {
    const steam = (await runPs("(Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' -ErrorAction SilentlyContinue).SteamPath").catch(() => "")).trim().replace(/\//g, "\\");
    if (!steam || !existsSync(steam)) return [];
    const libs = new Set([join(steam, "steamapps")]);
    try {
      const vdf = readFileSync(join(steam, "steamapps", "libraryfolders.vdf"), "utf8");
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(join(m[1].replace(/\\\\/g, "\\"), "steamapps"));
    } catch {
      /* single library */
    }
    // Last played times from every Steam account's localconfig.vdf.
    const lastPlayed = new Map<string, number>();
    try {
      for (const u of readdirSync(join(steam, "userdata"))) {
        const cfg = join(steam, "userdata", u, "config", "localconfig.vdf");
        if (!existsSync(cfg)) continue;
        const txt = readFileSync(cfg, "utf8");
        for (const m of txt.matchAll(/"(\d+)"\s*\{[^{}]*?"LastPlayed"\s+"(\d+)"/g)) lastPlayed.set(m[1], Math.max(lastPlayed.get(m[1]) ?? 0, Number(m[2]) * 1000));
      }
    } catch {
      /* no user data */
    }
    const played = new Map<string, number>();
    for (const s of listSessions()) played.set(s.game.toLowerCase(), Math.max(played.get(s.game.toLowerCase()) ?? 0, s.end));
    const out: { appId: string; name: string; bytes: number; days: number }[] = [];
    for (const lib of libs) {
      let files: string[] = [];
      try {
        files = readdirSync(lib).filter((f) => /^appmanifest_\d+\.acf$/.test(f));
      } catch {
        continue;
      }
      for (const f of files) {
        const txt = readFileSync(join(lib, f), "utf8");
        const appId = txt.match(/"appid"\s+"(\d+)"/)?.[1];
        const name = txt.match(/"name"\s+"([^"]+)"/)?.[1];
        const bytes = Number(txt.match(/"SizeOnDisk"\s+"(\d+)"/)?.[1] ?? 0);
        if (!appId || !name || bytes < 5 * GB || appId === "228980") continue; // skip Steamworks redistributables
        const last = Math.max(lastPlayed.get(appId) ?? 0, played.get(name.toLowerCase()) ?? 0);
        const days = last ? Math.floor((Date.now() - last) / 86400_000) : 999;
        if (days >= 90) out.push({ appId, name, bytes, days: Math.min(days, 999) });
      }
    }
    return out.sort((a, b) => b.bytes - a.bytes).slice(0, 8);
  }

  preview(id: string): CleanupPreview {
    const h = this.hogs.get(id);
    if (!h) throw new Error("Refresh the list first.");
    const items = h.items ?? [];
    return { hogId: id, items, totalBytes: h.hog.bytes };
  }

  async clean(id: string): Promise<{ ok: boolean; message: string }> {
    const h = this.hogs.get(id);
    if (!h?.clean) return { ok: false, message: "There's no automatic fix for this one." };
    const before = await freeOnC();
    try {
      await h.clean();
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e) };
    }
    const freed = Math.max(0, (await freeOnC()) - before);
    this.hogs.delete(id);
    history.record(`Cleanup: ${h.hog.label}`, "you");
    if (id === "winold" || id.startsWith("game-")) return { ok: true, message: id === "winold" ? "Disk Cleanup is open. Tick \"Previous Windows installation(s)\"." : "Steam will ask you to confirm the uninstall." };
    return { ok: true, message: freed > 0 ? `Freed ${(freed / GB).toFixed(freed > GB ? 1 : 2)} GB.` : "Done. Windows may take a minute to show the freed space." };
  }

  // ---------- Memory ----------
  private grouped(): Map<string, { memMB: number; procs: number }> {
    const m = new Map<string, { memMB: number; procs: number }>();
    for (const p of telemetry.procs) {
      const name = appName(p.name);
      const cur = m.get(name) ?? { memMB: 0, procs: 0 };
      cur.memMB += p.memMB;
      cur.procs++;
      m.set(name, cur);
    }
    return m;
  }

  private sampleMemory() {
    const g = this.grouped();
    for (const [name, v] of g) {
      const arr = this.memHistory.get(name) ?? [];
      arr.push(v.memMB);
      if (arr.length > 144) arr.shift();
      this.memHistory.set(name, arr);
    }
    for (const name of [...this.memHistory.keys()]) if (!g.has(name)) this.memHistory.delete(name);
  }

  async memory(): Promise<MemoryView> {
    const c = await runPsJson<any>(String.raw`
$m=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
$mc=(Get-Process -Name 'Memory Compression' -ErrorAction SilentlyContinue).WorkingSet64
[ordered]@{avail=[int64]$m.AvailableMBytes;standby=[int64](($m.StandbyCacheCoreBytes+$m.StandbyCacheNormalPriorityBytes+$m.StandbyCacheReserveBytes)/1MB);free=[int64]($m.FreeAndZeroPageListBytes/1MB);comp=[int64]($mc/1MB)} | ConvertTo-Json -Compress`).catch(() => ({ avail: 0, standby: 0, free: 0, comp: 0 }));
    const totalMB = Math.round(totalmem() / 1024 ** 2);
    const apps: AppMemory[] = [...this.grouped().entries()]
      .map(([app, v]) => {
        const hist = this.memHistory.get(app) ?? [];
        const last3h = hist.slice(-18);
        let growth: number | null = null;
        let leak = false;
        if (last3h.length >= 18) {
          growth = Math.round(last3h[last3h.length - 1] - last3h[0]);
          const drops = last3h.slice(1).filter((v, i) => v < last3h[i] * 0.95).length;
          leak = growth > 1000 && drops <= 2;
        }
        return { app, memMB: Math.round(v.memMB), procs: v.procs, growthMB: growth, leak, history: hist.slice(-144) };
      })
      .filter((a) => a.memMB >= 50)
      .sort((a, b) => b.memMB - a.memMB)
      .slice(0, 25);
    return { totalMB, inUseMB: Math.max(0, totalMB - c.avail), compressedMB: c.comp, standbyMB: c.standby, freeMB: c.free, apps, startup: await this.startupItems() };
  }

  /** Close an app the polite way (it can ask to save), optionally starting it again. */
  async memoryAct(action: "restart" | "close", app: string): Promise<{ ok: boolean; message: string }> {
    const procs = telemetry.procs.filter((p) => appName(p.name) === app);
    if (!procs.length) return { ok: false, message: `${app} isn't running.` };
    if (procs.some((p) => isProtected(p.name))) return { ok: false, message: `${app} is part of Windows and can't be closed from here.` };
    const exe = procs.find((p) => p.path)?.path ?? null;
    const name = procs[0].name;
    const out = await runPs(`$p=@(Get-Process -Name ${psq(name)} -ErrorAction SilentlyContinue); foreach($x in $p){ [void]$x.CloseMainWindow() }; $t=0; while($t -lt 15 -and @(Get-Process -Name ${psq(name)} -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0).Count){ Start-Sleep 1; $t++ }; @(Get-Process -Name ${psq(name)} -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0).Count`, 30_000).catch(() => "1");
    if (Number(out.trim()) > 0) return { ok: false, message: `${app} is still open. It may be asking you to save something; check its window.` };
    if (action === "restart" && exe) {
      await new Promise((r) => setTimeout(r, 2000));
      await runPs(`Start-Process explorer.exe -ArgumentList ${psq(exe)}`).catch(() => {});
      return { ok: true, message: `Restarted ${app}.` };
    }
    return { ok: true, message: `Closed ${app}.` };
  }

  private async startupItems(): Promise<StartupItem[]> {
    return runPsJson<StartupItem[]>(String.raw`
$ErrorActionPreference='SilentlyContinue'
$out=@()
$sources=@(
  @{hive='HKCU';run='Software\Microsoft\Windows\CurrentVersion\Run';ap='Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run';kind='Run'},
  @{hive='HKLM';run='Software\Microsoft\Windows\CurrentVersion\Run';ap='Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run';kind='Run'},
  @{hive='HKLM';run='Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run';ap='Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32';kind='Run32'}
)
foreach($s in $sources){
  $k=Get-Item -LiteralPath "$($s.hive):\$($s.run)"; if(-not $k){continue}
  $ap=Get-Item -LiteralPath "$($s.hive):\$($s.ap)"
  foreach($n in $k.GetValueNames()){ if(-not $n){continue}
    $b=$null; if($ap){ $b=$ap.GetValue($n) }
    $cmd=[string]$k.GetValue($n); $exe=[regex]::Match($cmd,'^"?([^"]+?\.exe)').Groups[1].Value
    $pub=$null; if($exe -and (Test-Path $exe)){ $pub=(Get-Item $exe).VersionInfo.CompanyName }
    $out+=[ordered]@{id="$($s.hive)|$($s.kind)|$n";name=$n;command=$cmd;location="$($s.hive)\$($s.run)";enabled=(-not $b -or ($b[0] -band 1) -eq 0);publisher=$pub} } }
foreach($f in @(@{dir=[Environment]::GetFolderPath('Startup');hive='HKCU'},@{dir="$env:ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp";hive='HKLM'})){
  $ap=Get-Item -LiteralPath "$($f.hive):\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder"
  foreach($i in Get-ChildItem $f.dir -File | Where-Object Name -ne 'desktop.ini'){ $b=$null; if($ap){ $b=$ap.GetValue($i.Name) }
    $out+=[ordered]@{id="$($f.hive)|StartupFolder|$($i.Name)";name=$i.BaseName;command=$i.FullName;location=$f.dir;enabled=(-not $b -or ($b[0] -band 1) -eq 0);publisher=$null} } }
ConvertTo-Json -InputObject @($out) -Compress`).catch(() => []);
  }

  /** Turn a startup item on or off the same way Task Manager does (StartupApproved). */
  async setStartup(id: string, enabled: boolean, record = true): Promise<{ ok: boolean; message: string }> {
    const [hive, kind, ...rest] = id.split("|");
    const name = rest.join("|");
    if (!["HKCU", "HKLM"].includes(hive) || !["Run", "Run32", "StartupFolder"].includes(kind) || !name) return { ok: false, message: "Unknown startup item." };
    const key = `${hive}:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\${kind}`;
    const bytes = enabled ? "2,0,0,0,0,0,0,0,0,0,0,0" : "3,0,0,0,0,0,0,0,0,0,0,0";
    await runPs(`New-Item -Path ${psq(key)} -Force | Out-Null; New-ItemProperty -LiteralPath ${psq(key)} -Name ${psq(name)} -PropertyType Binary -Value ([byte[]](${bytes})) -Force | Out-Null`);
    if (record) history.record(`${enabled ? "Turned on" : "Turned off"} ${name} at startup`, "you", { type: "startup-toggle", data: { id, enabled: !enabled } });
    return { ok: true, message: `${name} will ${enabled ? "" : "no longer "}start with Windows.` };
  }

  /** Is a path safe to open in Explorer from the UI? (only folders and files that exist) */
  openable(p: string) {
    try {
      return typeof p === "string" && /^[A-Z]:\\/i.test(p) && existsSync(p) && !!statSync(p);
    } catch {
      return false;
    }
  }
}

export const space = new Space();
