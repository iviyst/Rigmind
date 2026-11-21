// Work tools: "Why is it slow?", Hang detective, laptop battery care, backup check and dev mode.
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { telemetry } from "./telemetry";
import { incidents } from "./incidents";
import { runPs, runPsJson, psq } from "./ps";
import { dataDir } from "./store";
import { mode } from "./mode";
import { devCaches } from "./space";
import { holdUpdates } from "./tune";
import * as win from "./winsys";
import type { BackupStatus, BatteryInfo, DevInfo, HangPattern, Incident, PortOwner, SlowCause, WhySlow } from "../shared/types";

const SYNC = /^(onedrive|googledrivefs|dropbox|box|icloudservices|icloudDrive)$/i;
const BROWSERS: Record<string, string> = { chrome: "Chrome", msedge: "Edge", firefox: "Firefox", brave: "Brave", opera: "Opera" };
const UPDATERS = /^(tiworker|trustedinstaller|mousocoreworker|wuauclt|usoclient)$/i;

// ---------- Why is it slow? ----------
export async function whySlow(): Promise<WhySlow> {
  const recent = telemetry.history.slice(-10);
  const avg = (f: (t: (typeof recent)[number]) => number) => (recent.length ? recent.reduce((a, t) => a + f(t), 0) / recent.length : 0);
  const cpu = avg((t) => t.cpu.load);
  const ramUsed = recent.at(-1)?.ram.usedGB ?? 0;
  const ramTotal = recent.at(-1)?.ram.totalGB ?? 1;
  const disk = avg((t) => t.disk.readMBs + t.disk.writeMBs);
  const procs = telemetry.procs;
  const sum = (re: RegExp, k: "cpu" | "memMB") => procs.filter((p) => re.test(p.name)).reduce((a, p) => a + p[k], 0);
  const causes: SlowCause[] = [];

  const extra = await runPsJson<{ free: number; size: number; battery: number | null }>(
    "$c=Get-PSDrive C; $b=(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1).BatteryStatus; [ordered]@{free=[int64]$c.Free;size=[int64]($c.Free+$c.Used);battery=$b} | ConvertTo-Json -Compress"
  ).catch(() => ({ free: 1, size: 1, battery: null }));

  const syncCpu = sum(SYNC, "cpu");
  if (syncCpu > 3 || (disk > 40 && procs.some((p) => SYNC.test(p.name) && p.cpu > 1))) {
    const name = procs.find((p) => SYNC.test(p.name))?.name ?? "Cloud sync";
    causes.push({ title: `${name === "GoogleDriveFS" ? "Google Drive" : name} is syncing`, detail: `It's using ${Math.round(syncCpu)}% CPU${disk > 40 ? ` while the disk moves ${Math.round(disk)} MB/s` : ""}.`, fix: { label: "Pause sync for 1 hour", action: "pause-sync" } });
  }
  for (const [exe, label] of Object.entries(BROWSERS)) {
    const mem = sum(new RegExp(`^${exe}$`, "i"), "memMB");
    const tabs = procs.filter((p) => p.name.toLowerCase() === exe).length;
    if (mem > 4000 || mem / 1024 > ramTotal * 0.3)
      causes.push({ title: `${label} is using ${(mem / 1024).toFixed(1)} GB of memory`, detail: `Across about ${tabs} processes (roughly one per tab and extension). Its memory saver puts unused tabs to sleep.`, fix: { label: "Open memory saver", action: "browser-memory", target: exe } });
  }
  if (sum(/^msmpeng$/i, "cpu") > 10) causes.push({ title: "Microsoft Defender is scanning", detail: "A scan is using a lot of CPU and disk. It finishes on its own.", fix: null });
  if (sum(UPDATERS, "cpu") > 8) causes.push({ title: "Windows is installing updates", detail: "Update installers are busy in the background.", fix: { label: "Pause until tonight", action: "hold-updates" } });
  const wsl = sum(/^vmmem(wsl)?$/i, "memMB");
  if (wsl > 4000) causes.push({ title: `WSL or Docker is holding ${(wsl / 1024).toFixed(1)} GB`, detail: "Linux and container tools keep memory until they're shut down. A memory cap stops this.", fix: { label: "Set a memory cap", action: "open-dev" } });
  if (extra.size > 1 && extra.free / extra.size < 0.1) causes.push({ title: `C: has ${Math.round((extra.free / extra.size) * 100)}% free`, detail: "Windows slows down when the system drive is nearly full.", fix: { label: "See what's using space", action: "open-space" } });
  if (extra.battery === 1) causes.push({ title: "Running on battery", detail: "Windows slows the CPU on battery to save power.", fix: { label: "Use best performance", action: "power-high" } });
  if (ramUsed / ramTotal > 0.9) {
    const top = [...procs].sort((a, b) => b.memMB - a.memMB).slice(0, 3).map((p) => p.name).join(", ");
    causes.push({ title: `Memory is ${Math.round((ramUsed / ramTotal) * 100)}% full`, detail: `The biggest users are ${top}. Windows starts using the disk as memory, which is slow.`, fix: { label: "See memory by app", action: "open-memory" } });
  }
  const hog = [...procs].sort((a, b) => b.cpu - a.cpu)[0];
  if (hog && hog.cpu > 50 && !causes.some((c) => c.title.toLowerCase().includes(hog.name.toLowerCase())))
    causes.push({ title: `${hog.name} is using ${Math.round(hog.cpu)}% of your CPU`, detail: "One app is taking most of the processor.", fix: win.isProtected(hog.name) ? null : { label: `Close ${hog.name}`, action: "close", target: hog.name } });

  const verdict = causes.length ? `Found ${causes.length} thing${causes.length > 1 ? "s" : ""} slowing your PC down` : cpu < 60 && ramUsed / ramTotal < 0.8 ? "Nothing looks wrong right now" : "Your PC is busy, but no single cause stands out";
  return { t: Date.now(), verdict, causes };
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
export async function whySlowFix(action: string, target?: string): Promise<{ ok: boolean; message: string }> {
  if (action === "pause-sync") {
    const paused = await win.suspendByName(["OneDrive", "GoogleDriveFS", "Dropbox", "box"]);
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => void win.resumePids(paused.map((p) => p.pid)), 3600_000);
    return { ok: true, message: "Sync paused for an hour. It picks up where it left off." };
  }
  if (action === "hold-updates") {
    await holdUpdates(true);
    return { ok: true, message: "Updates paused. They continue tonight or after a restart." };
  }
  if (action === "power-high") {
    await win.setPowerScheme(win.HIGH_PERF);
    return { ok: true, message: "Switched to the high performance plan. Battery drains faster." };
  }
  if (action === "close" && target) {
    if (win.isProtected(target)) return { ok: false, message: "That's part of Windows and can't be closed." };
    await runPs(`Get-Process -Name ${psq(target)} -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow() }`);
    return { ok: true, message: `Asked ${target} to close. If it has unsaved work, it will ask you first.` };
  }
  return { ok: false, message: "Unknown fix." };
}

// ---------- Hang detective ----------
interface HangSnap { t: number; app: string; freeRamPct: number; diskMBs: number; topCpu: string[]; sync: boolean }
const hangFile = () => join(dataDir("hangs"), "hangs.json");
const readHangs = (): HangSnap[] => {
  try {
    return existsSync(hangFile()) ? JSON.parse(readFileSync(hangFile(), "utf8")) : [];
  } catch {
    return [];
  }
};

/** Save what the PC was doing when an app froze. */
export function initHangDetective() {
  incidents.on("incident", (i: Incident) => {
    if (i.kind !== "app_hang" || !i.app) return;
    const last = telemetry.history.at(-1);
    const snap: HangSnap = {
      t: i.t,
      app: i.app,
      freeRamPct: last ? Math.round((1 - last.ram.usedGB / last.ram.totalGB) * 100) : 50,
      diskMBs: last ? Math.round(last.disk.readMBs + last.disk.writeMBs) : 0,
      topCpu: [...telemetry.procs].sort((a, b) => b.cpu - a.cpu).slice(0, 3).map((p) => p.name),
      sync: telemetry.procs.some((p) => SYNC.test(p.name) && p.cpu > 1),
    };
    writeFileSync(hangFile(), JSON.stringify([snap, ...readHangs()].slice(0, 300)));
  });
}

export function hangPatterns(): HangPattern[] {
  const fromLog = incidents.all().filter((i) => i.kind === "app_hang" && i.app);
  const snaps = readHangs();
  const apps = new Map<string, { count: number; lastAt: number }>();
  for (const i of fromLog) {
    const cur = apps.get(i.app!) ?? { count: 0, lastAt: 0 };
    apps.set(i.app!, { count: cur.count + 1, lastAt: Math.max(cur.lastAt, i.t) });
  }
  return [...apps.entries()]
    .map(([app, v]) => {
      const s = snaps.filter((x) => x.app === app);
      let pattern: string | null = null;
      if (v.count >= 3 && s.length >= 3) {
        const share = (f: (x: HangSnap) => boolean) => s.filter(f).length / s.length;
        const reasons: string[] = [];
        if (share((x) => x.sync) >= 0.6) reasons.push("while cloud sync was busy");
        if (share((x) => x.freeRamPct < 10) >= 0.6) reasons.push("while memory was almost full");
        if (share((x) => x.diskMBs > 100) >= 0.6) reasons.push("while the disk was very busy");
        if (share((x) => x.topCpu.some((n) => /msmpeng/i.test(n))) >= 0.6) reasons.push("while Defender was scanning");
        pattern = reasons.length ? `${app} froze ${v.count} times, usually ${reasons.join(" and ")}.` : `${app} froze ${v.count} times with no common cause yet.`;
      }
      return { app, count: v.count, lastAt: v.lastAt, pattern };
    })
    .sort((a, b) => b.lastAt - a.lastAt);
}

// ---------- Laptop battery ----------
export async function battery(): Promise<BatteryInfo> {
  const out = join(dataDir("worktools"), "battery.xml");
  const r = await runPsJson<{ present: boolean; maker: string; tools: string[] }>(String.raw`
$b=@(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue).Count -gt 0
if($b){ powercfg /batteryreport /xml /output ${psq(out)} | Out-Null }
$t=@(Get-AppxPackage -Name *LenovoCompanion*,*LenovoVantage*,*ASUSPCAssistant*,*ArmouryCrate*,*DellOptimizer*,*DellPowerManager*,*HPSupportAssistant*,*myHP* -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
[ordered]@{present=$b;maker=(Get-CimInstance Win32_ComputerSystem).Manufacturer;tools=$t} | ConvertTo-Json -Compress`).catch(() => ({ present: false, maker: "", tools: [] }));
  let designWh: number | null = null;
  let fullWh: number | null = null;
  let cycles: number | null = null;
  if (r.present && existsSync(out)) {
    const xml = readFileSync(out, "utf8");
    designWh = Number(xml.match(/<DesignCapacity>(\d+)</)?.[1] ?? NaN) / 1000 || null;
    fullWh = Number(xml.match(/<FullChargeCapacity>(\d+)</)?.[1] ?? NaN) / 1000 || null;
    cycles = Number(xml.match(/<CycleCount>(\d+)</)?.[1] ?? NaN) || null;
  }
  const tools = (r.tools ?? []).join(" ");
  const maker = r.maker ?? "";
  const vendorTool = /lenovo/i.test(tools + maker)
    ? { name: "Lenovo Vantage", hint: "Open Lenovo Vantage > Power > Charge threshold (or Conservation mode) to stop charging at 80%." }
    : /asus/i.test(tools + maker)
    ? { name: "MyASUS", hint: "Open MyASUS > Customization > Battery Health Charging and pick Balanced (80%)." }
    : /dell/i.test(tools + maker)
    ? { name: "Dell Power Manager / Optimizer", hint: "Open Dell's power app > Battery Settings and pick Primarily AC use or a custom limit." }
    : /hp|hewlett/i.test(tools + maker)
    ? { name: "HP Support Assistant", hint: "HP sets Adaptive Battery Optimizer in the BIOS (Advanced > Power Management)." }
    : null;
  return { present: r.present, designWh, fullWh, wearPct: designWh && fullWh ? Math.max(0, Math.round((1 - fullWh / designWh) * 100)) : null, cycles, vendorTool };
}

// ---------- Backup check ----------
export async function backupStatus(): Promise<BackupStatus> {
  const r = await runPsJson<{ docs: string; desk: string; onedrive: boolean; services: string[] }>(String.raw`
$sf=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -ErrorAction SilentlyContinue
$svc=@(Get-Service -Name bzserv,MacriumService,VeeamEndpointBackupSvc,AcronisCyberProtectionService,'Acronis*',CrashPlanService,CarboniteService,IDriveService -ErrorAction SilentlyContinue | Where-Object Status -eq 'Running' | Select-Object -ExpandProperty DisplayName)
[ordered]@{docs=[Environment]::ExpandEnvironmentVariables([string]$sf.Personal);desk=[Environment]::ExpandEnvironmentVariables([string]$sf.Desktop);onedrive=[bool](Get-Process OneDrive -ErrorAction SilentlyContinue);services=$svc} | ConvertTo-Json -Compress`).catch(() => ({ docs: "", desk: "", onedrive: false, services: [] }));
  // File History updates its local catalog after every backup.
  const fh = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "Windows", "FileHistory", "Configuration");
  let fhLast: number | null = null;
  if (existsSync(fh)) {
    try {
      for (const f of readdirSync(fh)) fhLast = Math.max(fhLast ?? 0, statSync(join(fh, f)).mtimeMs);
    } catch {
      /* ignore */
    }
  }
  const age = (t: number) => Date.now() - t;
  if (fhLast) {
    const level = age(fhLast) < 86400_000 ? "good" : age(fhLast) < 7 * 86400_000 ? "warn" : "bad";
    return { kind: "File History", lastRun: fhLast, level, detail: level === "good" ? "Backed up in the last 24 hours." : "File History hasn't run recently. Check the backup drive is plugged in." };
  }
  const oneDriveFolders = /onedrive/i.test(r.docs) || /onedrive/i.test(r.desk);
  if (oneDriveFolders)
    return r.onedrive
      ? { kind: "OneDrive folder backup", lastRun: null, level: "good", detail: "Your Desktop and Documents live in OneDrive and OneDrive is running, so they're backed up as you work." }
      : { kind: "OneDrive folder backup", lastRun: null, level: "warn", detail: "Your folders are in OneDrive, but OneDrive isn't running, so new changes aren't being backed up." };
  if (r.services?.length) return { kind: r.services[0], lastRun: null, level: "unknown", detail: `${r.services[0]} is running. Rigmind can't read its schedule, so check its app for the last backup time.` };
  return { kind: "None found", lastRun: null, level: "bad", detail: "Rigmind couldn't find a backup. Turn on OneDrive folder backup or File History so a dead drive doesn't take your files with it." };
}

// ---------- Dev mode ----------
const wslConfig = () => join(process.env.USERPROFILE ?? "", ".wslconfig");
export async function devInfo(): Promise<DevInfo> {
  const r = await runPsJson<{ wsl: boolean; docker: boolean; sizes: Record<string, number> }>(String.raw`
$ErrorActionPreference='SilentlyContinue'
function S($p){ $s=(Get-ChildItem -LiteralPath $p -Recurse -Force -File | Measure-Object Length -Sum).Sum; if($s){[int64]$s}else{0} }
$sizes=@{}
${devCaches().map((c) => `if(Test-Path ${psq(c.path)}){ $sizes[${psq(c.id)}]=(S ${psq(c.path)}) }`).join("\n")}
[ordered]@{wsl=([bool](Test-Path "$env:windir\System32\wsl.exe") -and [bool](wsl.exe -l -q 2>$null));docker=(Test-Path "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe");sizes=$sizes} | ConvertTo-Json -Compress`, 180_000).catch(() => ({ wsl: false, docker: false, sizes: {} as Record<string, number> }));
  let capGB: number | null = null;
  if (existsSync(wslConfig())) {
    const m = readFileSync(wslConfig(), "utf8").match(/^\s*memory\s*=\s*(\d+)\s*GB/im);
    capGB = m ? Number(m[1]) : null;
  }
  const using = telemetry.procs.filter((p) => /^vmmem(wsl)?$/i.test(p.name)).reduce((a, p) => a + p.memMB, 0);
  return {
    wsl: { installed: !!r.wsl, capGB, usingMB: using || null },
    docker: !!r.docker,
    caches: devCaches().filter((c) => r.sizes?.[c.id] != null).map((c) => ({ name: c.name, path: c.path, bytes: r.sizes[c.id] })),
  };
}

export async function devAct(action: "wslcap" | "cleancache", arg: string): Promise<{ ok: boolean; message: string }> {
  if (action === "wslcap") {
    const gb = Math.round(Number(arg));
    if (!(gb >= 2 && gb <= 256)) return { ok: false, message: "Pick a cap between 2 and 256 GB." };
    let txt = existsSync(wslConfig()) ? readFileSync(wslConfig(), "utf8") : "";
    if (/^\s*memory\s*=.*$/im.test(txt)) txt = txt.replace(/^\s*memory\s*=.*$/im, `memory=${gb}GB`);
    else if (/^\s*\[wsl2\]\s*$/im.test(txt)) txt = txt.replace(/^\s*\[wsl2\]\s*$/im, `[wsl2]\nmemory=${gb}GB`);
    else txt = `${txt.trimEnd()}\n[wsl2]\nmemory=${gb}GB\n`.trimStart();
    writeFileSync(wslConfig(), txt);
    return { ok: true, message: `WSL is capped at ${gb} GB. It takes effect the next time WSL starts (run "wsl --shutdown" to apply it now).` };
  }
  const c = devCaches().find((x) => x.name === arg || x.id === arg);
  if (!c) return { ok: false, message: "Unknown cache." };
  await runPs(`Get-ChildItem -LiteralPath ${psq(c.path)} -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue`, 10 * 60_000);
  return { ok: true, message: `Cleaned the ${c.name}. Your tools download what they need again.` };
}

export async function portOwners(): Promise<PortOwner[]> {
  return runPsJson<PortOwner[]>(
    "$p=@{}; foreach($x in Get-Process){ $p[$x.Id]=$x.ProcessName }; ConvertTo-Json -Compress -InputObject @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Sort-Object LocalPort -Unique | ForEach-Object { [ordered]@{port=[int]$_.LocalPort;protocol='TCP';process=[string]$p[[int]$_.OwningProcess];pid=[int]$_.OwningProcess} })"
  ).catch(() => []);
}

export const managedNote = () => (mode.isManaged ? "This PC is managed by your company's IT." : null);
