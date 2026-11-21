// Ready to Play / Ready to Work: the night engine.
// A Windows scheduled task wakes the PC, Rigmind works with the screen off and the sound muted,
// then puts everything back and sleeps again. Rules that are never broken:
//   - a person always wins: any keyboard or mouse input stops the run within 2 seconds
//   - no restart over unsaved work, another signed-in user, a call or a game
//   - every stage saves a checkpoint, so a crash or power cut resumes instead of starting over
//   - plugged in only, with temperature limits, and the first night is always a dry run
import { EventEmitter } from "node:events";
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { cpus, freemem, tmpdir } from "node:os";
import { load, save, dataDir } from "./store";
import { runPs, runPsJson, psq } from "./ps";
import { hw } from "./hw";
import { telemetry } from "./telemetry";
import { boost } from "./boost";
import { fans } from "./fans";
import { rgb } from "./rgb";
import { meeting } from "./meeting";
import { mode, gameFeatures, workFeatures } from "./mode";
import { history } from "./history";
import { listSessions } from "./sessions";
import { listProfiles } from "./profiles";
import { security } from "./security";
import { clearShaderCaches, currentDriver } from "./tune";
import { backupStatus } from "./worktools";
import * as drivers from "./drivers";
import * as win from "./winsys";
import type { ReadyReport, ReadySettings, ReadyStage, ReadyStageId, ReadyState, WarmResult } from "../shared/types";

const TASK = "Rigmind Ready";
const CORES = Math.max(1, cpus().length);
const L = () => process.env.LOCALAPPDATA ?? "";
const reportsFile = () => join(dataDir("ready"), "reports.json");
const warmFile = () => join(dataDir("ready"), "warm.json");
const checkpointFile = () => join(dataDir("ready"), "checkpoint.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STAGES: { id: ReadyStageId; label: string }[] = [
  { id: "preflight", label: "Preflight" },
  { id: "games", label: "Game updates" },
  { id: "apps", label: "App updates" },
  { id: "system", label: "Windows and driver updates" },
  { id: "warmup", label: "Shader warm-up" },
  { id: "maintenance", label: "Maintenance" },
  { id: "backup", label: "Backup check" },
  { id: "prewarm", label: "Pre-warm" },
  { id: "restore", label: "Restore and sleep" },
];

// Shader caches written by GPU drivers and by Windows (DirectX).
const shaderDirs = () => [join(L(), "NVIDIA", "DXCache"), join(L(), "NVIDIA", "GLCache"), join(L(), "D3DSCache"), join(L(), "AMD", "DxCache"), join(L(), "AMD", "DxcCache"), join(L(), "AMD", "VkCache"), join(L(), "Intel", "ShaderCache")];
function dirBytes(dir: string, depth = 0): number {
  if (depth > 4 || !existsSync(dir)) return 0;
  let total = 0;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const n of names) {
    const p = join(dir, n);
    try {
      const st = statSync(p);
      total += st.isDirectory() ? dirBytes(p, depth + 1) : st.size;
    } catch {
      /* in use */
    }
  }
  return total;
}
const shaderBytes = () => shaderDirs().reduce((a, d) => a + dirBytes(d), 0);

interface SteamGame { appId: string; name: string; installDir: string; buildId: string; needsUpdate: boolean; bytesToDownload: number; bytesDownloaded: number; sizeOnDisk: number }
interface WarmStat { buildId: string; driver: string | null; lastMB: number; lowRuns: number; timeouts: number; needsYou: boolean; at: number }

let cachedSteamRoot: string | null | undefined;
async function steamRoot(): Promise<string | null> {
  if (cachedSteamRoot !== undefined && (cachedSteamRoot === null || existsSync(cachedSteamRoot))) return cachedSteamRoot;
  const p = (await runPs("(Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' -ErrorAction SilentlyContinue).SteamPath").catch(() => "")).trim().replace(/\//g, "\\");
  cachedSteamRoot = p && existsSync(p) ? p : null;
  setTimeout(() => (cachedSteamRoot = undefined), 10 * 60_000); // look again later in case Steam gets installed
  return cachedSteamRoot;
}
function steamLibraries(root: string): string[] {
  const libs = new Set([join(root, "steamapps")]);
  try {
    const vdf = readFileSync(join(root, "steamapps", "libraryfolders.vdf"), "utf8");
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(join(m[1].replace(/\\\\/g, "\\"), "steamapps"));
  } catch {
    /* one library */
  }
  return [...libs].filter((l) => existsSync(l));
}
function steamGames(root: string): SteamGame[] {
  const out: SteamGame[] = [];
  for (const lib of steamLibraries(root)) {
    let files: string[] = [];
    try {
      files = readdirSync(lib).filter((f) => /^appmanifest_\d+\.acf$/.test(f));
    } catch {
      continue;
    }
    for (const f of files) {
      let t = "";
      try {
        t = readFileSync(join(lib, f), "utf8");
      } catch {
        continue;
      }
      const get = (k: string) => t.match(new RegExp(`"${k}"\\s+"([^"]*)"`, "i"))?.[1] ?? "";
      const appId = get("appid");
      if (!appId || ["228980", "250820", "1070560", "1391110", "1628350"].includes(appId)) continue; // redistributables, VR runtime, Proton-like tools
      const flags = Number(get("StateFlags") || 0);
      const toDl = Number(get("BytesToDownload") || 0);
      const dl = Number(get("BytesDownloaded") || 0);
      out.push({
        appId,
        name: get("name") || `App ${appId}`,
        installDir: join(lib, "common", get("installdir")),
        buildId: get("buildid"),
        // StateFlags 4 = fully installed; 2 = update required; 1024 = update started.
        needsUpdate: (flags & 2) !== 0 || (flags & 1024) !== 0 || (toDl > 0 && dl < toDl),
        bytesToDownload: toDl,
        bytesDownloaded: dl,
        sizeOnDisk: Number(get("SizeOnDisk") || 0),
      });
    }
  }
  return out;
}

/** Start something as the signed-in user (not as administrator) through a temporary shortcut. */
async function startAsUser(target: string, args = "") {
  const lnk = join(tmpdir(), `rigmind-${randomUUID()}.lnk`);
  await runPs(`$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${psq(lnk)}); $s.TargetPath=${psq(target)}; $s.Arguments=${psq(args)}; $s.WindowStyle=7; $s.Save(); Start-Process explorer.exe -ArgumentList ${psq(lnk)}`);
  setTimeout(() => {
    try {
      unlinkSync(lnk);
    } catch {
      /* already gone */
    }
  }, 30_000);
}
const openAsUser = (url: string) => runPs(`Start-Process explorer.exe -ArgumentList ${psq(url)}`);

class Abort extends Error {}

class ReadyEngine extends EventEmitter {
  private current: ReadyReport | null = null;
  private abortReason: ReadyReport["stoppedBy"] = null;
  private yieldTimer: ReturnType<typeof setInterval> | null = null;
  private lastIdle = Infinity;
  private reports: ReadyReport[] = [];
  private warm: Record<string, WarmStat> = {};
  private scheduled = false;
  private wakeIssues: string[] = [];
  private saved: { muted: boolean | null; volume: number | null; rgbMode: string | null; toasts: number | null } = { muted: null, volume: null, rgbMode: null, toasts: null };

  init() {
    try {
      this.reports = existsSync(reportsFile()) ? JSON.parse(readFileSync(reportsFile(), "utf8")) : [];
      this.warm = existsSync(warmFile()) ? JSON.parse(readFileSync(warmFile(), "utf8")) : {};
    } catch {
      this.reports = [];
    }
    void this.refreshSchedule();
    // If the last run crashed or Rigmind restarted the PC, finish it, and always put things back.
    void this.recover();
    // Catch-up pass when the PC was shut down at night (wake timers can't start a powered-off PC).
    setInterval(() => void this.maybeCatchUp(), 5 * 60_000);
  }

  settings(): ReadySettings {
    return load().ready;
  }

  private topGames(games: SteamGame[]): ReadyState["topGames"] {
    const sessions = listSessions().filter((s) => Date.now() - s.start < 60 * 86400_000);
    const profiles = listProfiles();
    const s = this.settings();
    const today = new Date().getDay();
    const scored = games
      .filter((g) => !s.neverTouch.includes(g.appId))
      .map((g) => {
        const dirLc = g.installDir.toLowerCase();
        const exes = profiles.filter((p) => p.installDir && p.installDir.toLowerCase().startsWith(dirLc)).map((p) => p.exe.toLowerCase());
        const mine = sessions.filter((x) => exes.includes(x.exe.toLowerCase()) || x.game.toLowerCase() === g.name.toLowerCase());
        const last = mine.length ? Math.max(...mine.map((x) => x.end)) : 0;
        const days = last ? (Date.now() - last) / 86400_000 : 99;
        const recency = 1 / (1 + days / 3);
        const freq = mine.filter((x) => Date.now() - x.start < 30 * 86400_000).length;
        const weekday = mine.filter((x) => new Date(x.start).getDay() === today).length;
        const score = Math.round((recency * 50 + Math.min(freq, 20) * 2 + Math.min(weekday, 5) * 2 + (s.alwaysWarm.includes(g.appId) ? 100 : 0)) * 10) / 10;
        return { appId: g.appId, name: g.name, score, warm: false };
      })
      .sort((a, b) => b.score - a.score);
    const n = s.warmup === "top3" ? 3 : s.warmup === "top5" ? 5 : s.warmup === "all" ? 999 : 0;
    let picked = 0;
    for (const g of scored) {
      const st = this.warm[g.appId];
      const off = st && st.lowRuns >= 3 && st.driver === currentDriver();
      if ((g.score > 0 || s.alwaysWarm.includes(g.appId)) && picked < n && !off && !st?.needsYou) {
        g.warm = true;
        picked++;
      }
    }
    return scored.slice(0, 15);
  }

  private cachedTop: ReadyState["topGames"] = [];
  private topAt = 0;

  async state(): Promise<ReadyState> {
    // Re-rank games at most once a minute; state() is called on every progress update.
    if (Date.now() - this.topAt > 60_000) {
      this.topAt = Date.now();
      const root = gameFeatures() ? await steamRoot() : null;
      if (root) this.cachedTop = this.topGames(steamGames(root));
    }
    const last = this.reports[0] ?? null;
    const weekAgo = Date.now() - 7 * 86400_000;
    return {
      running: !!this.current,
      current: this.current,
      last,
      history: this.reports.slice(0, 30).map((r) => ({ id: r.id, start: r.start, minutesSaved: r.minutesSaved, dryRun: r.dryRun })),
      settings: this.settings(),
      scheduled: this.scheduled,
      wakeIssues: this.wakeIssues,
      topGames: this.cachedTop,
      weekMinutesSaved: Math.round(this.reports.filter((r) => r.start > weekAgo && !r.dryRun).reduce((a, r) => a + r.minutesSaved, 0)),
    };
  }

  private async push() {
    this.emit("state", await this.state());
  }

  async saveSettings(patch: Partial<ReadySettings>): Promise<ReadyState> {
    this.topAt = 0; // pins and warm-up count change the ranking
    const before = this.settings();
    const clean: Partial<ReadySettings> = { ...patch };
    if (clean.from && !/^\d{2}:\d{2}$/.test(clean.from)) delete clean.from;
    if (clean.to && !/^\d{2}:\d{2}$/.test(clean.to)) delete clean.to;
    if (clean.fanCapPct != null) clean.fanCapPct = Math.min(100, Math.max(40, Number(clean.fanCapPct)));
    if (clean.enabled && !before.enabled) clean.dryRunDone = false; // first night after turning it on is a practice run
    save({ ready: { ...before, ...clean } });
    if (patch.enabled !== undefined || patch.from || patch.weekdaysOnly !== undefined) await this.refreshSchedule();
    return this.state();
  }

  // ---------- Scheduling and waking ----------
  private async refreshSchedule() {
    const s = this.settings();
    if (!app.isPackaged) {
      this.scheduled = false;
      this.wakeIssues = ["Scheduling works in the installed app only."];
      return;
    }
    if (!s.enabled) {
      await runPs(`Unregister-ScheduledTask -TaskName ${psq(TASK)} -Confirm:$false -ErrorAction SilentlyContinue`).catch(() => {});
      this.scheduled = false;
      await this.push();
      return;
    }
    const trigger = s.weekdaysOnly ? `New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At ${psq(s.from)}` : `New-ScheduledTaskTrigger -Daily -At ${psq(s.from)}`;
    const out = await runPs(String.raw`
$a=New-ScheduledTaskAction -Execute ${psq(process.execPath)} -Argument '--ready'
$t=${trigger}
$st=New-ScheduledTaskSettingsSet -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 4) -MultipleInstances IgnoreNew
$st.DisallowStartIfOnBatteries=$true; $st.StopIfGoingOnBatteries=$true
$p=New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName ${psq(TASK)} -Action $a -Trigger $t -Settings $st -Principal $p -Force | Out-Null
# Wake timers must be allowed in the active power plan or the task can't wake the PC.
$q=powercfg /query SCHEME_CURRENT SUB_SLEEP BD3B718A-0680-4D9D-8AB2-E1D2B4AC806D
$ac=[regex]::Match(($q -join "\n"),'Current AC Power Setting Index:\s*0x([0-9a-f]+)').Groups[1].Value
"ac=$ac"
"sleep=" + ((powercfg /a) -join ' ')`, 60_000).catch((e) => "error=" + String(e));
    const issues: string[] = [];
    if (/^error=/m.test(out)) issues.push("Windows wouldn't create the wake-up task: " + out.replace(/^error=/, "").slice(0, 160));
    const ac = out.match(/ac=([0-9a-f]+)/i)?.[1];
    if (ac !== undefined && parseInt(ac, 16) === 0) {
      await runPs("powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP BD3B718A-0680-4D9D-8AB2-E1D2B4AC806D 1; powercfg /setactive SCHEME_CURRENT").catch(() => {});
      history.record("Allowed wake timers in the power plan (needed for Ready to Play)", "you");
    }
    const sleepLine = out.match(/sleep=(.*)/)?.[1] ?? "";
    if (sleepLine && !/Standby \((S3|S0 Low Power Idle)\)/i.test(sleepLine.split(/not available/i)[0])) issues.push("This PC doesn't offer sleep, so it can't be woken at night. Rigmind will catch up after it starts instead.");
    if (mode.isLaptop) issues.push("On a laptop, Ready only runs while plugged in.");
    this.scheduled = !issues.some((i) => i.startsWith("Windows wouldn't"));
    this.wakeIssues = issues;
    await this.push();
  }

  /** Schedule a one-off wake in 5 minutes so the user can check sleep and wake work. */
  async testWake(): Promise<{ ok: boolean; message: string }> {
    if (!app.isPackaged) return { ok: false, message: "The wake test works in the installed app only." };
    const at = new Date(Date.now() + 5 * 60_000);
    const hhmm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
    await runPs(String.raw`
$a=New-ScheduledTaskAction -Execute ${psq(process.execPath)} -Argument '--wake-test'
$t=New-ScheduledTaskTrigger -Once -At ${psq(hhmm)}
$st=New-ScheduledTaskSettingsSet -WakeToRun -DeleteExpiredTaskAfter (New-TimeSpan -Minutes 30)
$t.EndBoundary=(Get-Date).AddMinutes(20).ToString('s')
$p=New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName 'Rigmind Wake Test' -Action $a -Trigger $t -Settings $st -Principal $p -Force | Out-Null`);
    return { ok: true, message: `Put the PC to sleep now. It should wake at ${hhmm}, and Rigmind will say "Wake test worked".` };
  }

  // ---------- Running ----------
  private stage(id: ReadyStageId): ReadyStage {
    return this.current!.stages.find((s) => s.id === id)!;
  }
  private log(line: string) {
    if (!this.current) return;
    this.current.log.push(`${new Date().toLocaleTimeString()} ${line}`);
    void this.push();
  }
  private set(id: ReadyStageId, status: ReadyStage["status"], note: string | null = null) {
    const st = this.stage(id);
    st.status = status;
    if (note != null) st.note = note;
    this.checkpoint();
    void this.push();
  }
  private checkpoint() {
    if (this.current) writeFileSync(checkpointFile(), JSON.stringify({ report: this.current, savedAt: Date.now(), restarting: false }));
  }
  private check() {
    if (this.abortReason) throw new Abort(this.abortReason);
  }

  private startYieldWatch(enabled: boolean) {
    this.lastIdle = Infinity;
    if (!enabled) return;
    // Any keyboard or mouse input means a person is here: stop within 2 seconds.
    this.yieldTimer = setInterval(async () => {
      const idle = await hw.idleMs();
      if (idle == null) return;
      if (idle < 1500 && this.lastIdle !== Infinity && idle < this.lastIdle) {
        this.abortReason = "input";
        await this.closeWarmGame();
      }
      this.lastIdle = idle;
      // Heat and battery checks ride on the same timer.
      const gpu = hw.gpuTemp();
      const cpu = hw.cpuTemp();
      const s = this.settings();
      if ((gpu != null && gpu >= s.gpuLimitC) || (cpu != null && cpu >= s.cpuLimitC)) {
        this.log(`Too hot (GPU ${gpu ?? "?"}°C, CPU ${cpu ?? "?"}°C): closing the warm-up game.`);
        await this.closeWarmGame();
      }
      if (meeting.active) this.abortReason = "call";
    }, 1000);
  }

  /** Main entry: from the scheduled task (--ready), the catch-up pass, or "Run Ready now". */
  async run(trigger: ReadyReport["trigger"], forceDryRun = false): Promise<{ ok: boolean; message: string }> {
    if (this.current) return { ok: false, message: "Ready is already running." };
    const s = this.settings();
    if (trigger !== "manual" && !s.enabled) return { ok: false, message: "Ready is off." };
    if (boost.state.active) return { ok: false, message: "A game is running. Ready waits until you're done." };
    if (meeting.active) return { ok: false, message: "You're on a call. Ready waits until it ends." };
    const dryRun = forceDryRun || (trigger === "night" && !s.dryRunDone);
    const unattended = trigger !== "manual";
    this.current = {
      id: randomUUID(),
      start: Date.now(),
      end: null,
      trigger,
      dryRun,
      stages: STAGES.map((x) => ({ ...x, status: "pending", note: null })),
      gamesUpdated: [],
      appsUpdated: [],
      warmed: [],
      downloadedGB: 0,
      minutesSaved: 0,
      restartNeeded: false,
      needsYou: [],
      backup: null,
      stoppedBy: null,
      log: [],
    };
    this.abortReason = null;
    void this.execute(unattended, dryRun);
    return { ok: true, message: dryRun ? "Dry run started. Rigmind will only log what it would do." : "Ready is running." };
  }

  async resumeFrom(report: ReadyReport) {
    this.current = { ...report, log: [...report.log, `${new Date().toLocaleTimeString()} Resumed after a restart.`] };
    this.abortReason = null;
    void this.execute(true, report.dryRun);
  }

  private async execute(unattended: boolean, dryRun: boolean) {
    const r = this.current!;
    const s = this.settings();
    const wokeFromSleep = unattended && r.trigger === "night" ? await this.wokeRecently() : false;
    let restarting = false;
    boost.suppressed = true; // warm-up launches aren't play sessions
    try {
      // 1. Preflight
      if (this.stage("preflight").status !== "done") {
        this.set("preflight", "running");
        const power = await runPs("$b=Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1; if($b){ $b.BatteryStatus } else { 'ac' }").catch(() => "ac");
        if (power.trim() !== "ac" && power.trim() !== "2") {
          this.abortReason = "battery";
          throw new Abort("battery");
        }
        if (unattended && r.trigger === "night") {
          const idle = await hw.idleMs();
          if (idle != null && idle < 60_000) {
            this.log("Someone was using the PC, so Ready skipped tonight.");
            this.abortReason = "input";
            throw new Abort("input");
          }
        }
        if (unattended) await this.goQuiet(r.trigger === "night");
        this.startYieldWatch(unattended);
        this.set("preflight", "done", dryRun ? "Dry run: nothing will be changed." : unattended ? "Screen off, sound muted, lights off." : "Running with the screen on.");
      } else {
        // Resuming after Rigmind's own restart: go dark and quiet again.
        if (unattended) await this.goQuiet(true);
        this.startYieldWatch(unattended);
      }
      this.check();

      // 2. Game updates
      await this.stageGames(dryRun);
      this.check();
      // 3. App updates (work)
      await this.stageApps(dryRun);
      this.check();
      // 4. Windows and drivers, with a safe restart
      restarting = await this.stageSystem(dryRun, unattended);
      if (restarting) return;
      this.check();
      // 5. Shader warm-up
      await this.stageWarmup(dryRun);
      this.check();
      // 6. Maintenance
      await this.stageMaintenance(dryRun);
      this.check();
      // 7. Backup check (work)
      if (workFeatures()) {
        this.set("backup", "running");
        r.backup = await backupStatus().catch(() => null);
        if (r.backup && r.backup.level === "bad") r.needsYou.push(`Backup: ${r.backup.detail}`);
        this.set("backup", "done", r.backup ? `${r.backup.kind}: ${r.backup.detail}` : "Couldn't check.");
      } else this.set("backup", "skipped", "Gaming mode");
      // 8. Pre-warm
      await this.stagePrewarm(dryRun, wokeFromSleep);
    } catch (e: any) {
      if (!(e instanceof Abort)) this.log("Stopped by an error: " + (e?.message ?? String(e)));
      r.stoppedBy = this.abortReason;
      for (const st of r.stages) if (st.status === "running" || st.status === "pending") st.status = st.id === "restore" ? "pending" : "skipped";
      if (this.abortReason === "input") this.log("You started using the PC, so Ready stopped and handed it back.");
      if (this.abortReason === "call") this.log("A call started, so Ready stopped.");
      if (this.abortReason === "battery") this.log("The PC is on battery, so Ready didn't run.");
    } finally {
      if (!restarting) await this.finish(unattended, dryRun, wokeFromSleep);
    }
  }

  private async wokeRecently(): Promise<boolean> {
    const n = await runPs("@(Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Microsoft-Windows-Power-Troubleshooter';Id=1;StartTime=(Get-Date).AddMinutes(-20)} -ErrorAction SilentlyContinue).Count").catch(() => "0");
    return Number(n.trim()) > 0;
  }

  /** Screen off, sound muted, lights off, quiet fans, no notifications, stay awake. */
  private async goQuiet(dark: boolean) {
    hw.keepAwake(true);
    fans.night = true;
    if (!dark) return;
    hw.monitorOff();
    const m = await hw.mute(true);
    if (m?.ok) this.saved = { ...this.saved, muted: m.wasMuted, volume: m.volume };
    const rs = rgb.settings();
    if (rs.enabled && rs.mode !== "off") {
      this.saved.rgbMode = rs.mode;
      rgb.saveSettings({ mode: "off" as any });
    }
    const key = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings";
    const was = (await runPs(`(Get-ItemProperty '${key}' -ErrorAction SilentlyContinue).NOC_GLOBAL_SETTING_TOASTS_ENABLED`).catch(() => "")).trim();
    this.saved.toasts = was === "" ? 1 : Number(was);
    await runPs(`New-Item -Path '${key}' -Force | Out-Null; Set-ItemProperty '${key}' NOC_GLOBAL_SETTING_TOASTS_ENABLED 0 -Type DWord`).catch(() => {});
  }

  /** Put everything back exactly as it was. Also runs at startup if the last run crashed. */
  private async restoreQuiet() {
    if (this.yieldTimer) clearInterval(this.yieldTimer);
    this.yieldTimer = null;
    hw.keepAwake(false);
    fans.night = false;
    boost.suppressed = false;
    if (this.saved.muted != null) await hw.mute(this.saved.muted, this.saved.volume ?? undefined);
    if (this.saved.rgbMode) rgb.saveSettings({ mode: this.saved.rgbMode as any });
    if (this.saved.toasts != null)
      await runPs(`Set-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings' NOC_GLOBAL_SETTING_TOASTS_ENABLED ${this.saved.toasts ? 1 : 0} -Type DWord`).catch(() => {});
    this.saved = { muted: null, volume: null, rgbMode: null, toasts: null };
    writeFileSync(join(dataDir("ready"), "quiet.json"), "{}");
  }

  private saveQuietState() {
    writeFileSync(join(dataDir("ready"), "quiet.json"), JSON.stringify(this.saved));
  }

  private async finish(unattended: boolean, dryRun: boolean, wokeFromSleep: boolean) {
    const r = this.current!;
    this.set("restore", "running");
    await this.closeWarmGame();
    await this.restoreQuiet();
    r.minutesSaved = Math.round((r.warmed.filter((w) => w.outcome === "warmed").reduce((a, w) => a + w.seconds, 0) / 60 + r.downloadedGB * 1.5) * 10) / 10;
    const sleepAgain = unattended && r.trigger === "night" && wokeFromSleep && r.stoppedBy !== "input";
    this.set("restore", "done", sleepAgain ? "Settings restored. Going back to sleep." : "Settings restored.");
    r.end = Date.now();
    if (dryRun && r.trigger === "night") save({ ready: { ...this.settings(), dryRunDone: true } });
    this.reports.unshift(r);
    this.reports = this.reports.slice(0, 60);
    writeFileSync(reportsFile(), JSON.stringify(this.reports));
    try {
      unlinkSync(checkpointFile());
    } catch {
      /* none */
    }
    this.current = null;
    await this.push();
    this.emit("report", r);
    if (sleepAgain) {
      await sleep(15_000);
      const idle = await hw.idleMs();
      if (idle == null || idle > 15_000) await hw.sleepNow();
    }
  }

  // ---------- Stages ----------
  private async stageGames(dryRun: boolean) {
    const s = this.settings();
    if (this.stage("games").status === "done") return;
    if (!gameFeatures() || !s.gameUpdates) return this.set("games", "skipped", gameFeatures() ? "Turned off" : "Work mode");
    const root = await steamRoot();
    if (!root) return this.set("games", "skipped", "Steam isn't installed.");
    this.set("games", "running");
    const pending = steamGames(root).filter((g) => g.needsUpdate && !s.neverTouch.includes(g.appId));
    if (!pending.length) return this.set("games", "done", "All Steam games are up to date.");
    const gb = pending.reduce((a, g) => a + Math.max(0, g.bytesToDownload - g.bytesDownloaded), 0) / 1024 ** 3;
    this.log(`${pending.length} game${pending.length > 1 ? "s" : ""} need updates (${gb.toFixed(1)} GB): ${pending.map((g) => g.name).join(", ")}.`);
    if (dryRun) return this.set("games", "done", `Would update ${pending.length} game(s), about ${gb.toFixed(1)} GB.`);
    if (!telemetry.procs.some((p) => p.name.toLowerCase() === "steam")) {
      await startAsUser(join(root, "steam.exe"), "-silent");
      this.log("Started Steam in the background.");
    }
    const startBytes = new Map(pending.map((g) => [g.appId, g.bytesDownloaded]));
    let lastProgress = Date.now();
    let lastTotal = -1;
    const deadline = this.windowEnd() - 60 * 60_000; // leave an hour for the rest
    while (Date.now() < deadline) {
      await sleep(30_000);
      this.check();
      const now = steamGames(root).filter((g) => startBytes.has(g.appId));
      const left = now.filter((g) => g.needsUpdate);
      const total = now.reduce((a, g) => a + g.bytesDownloaded, 0);
      if (total !== lastTotal) {
        lastTotal = total;
        lastProgress = Date.now();
      }
      const doneNames = now.filter((g) => !g.needsUpdate).map((g) => g.name);
      const downloaded = now.reduce((a, g) => a + Math.max(0, g.bytesDownloaded - (startBytes.get(g.appId) ?? 0)), 0) + now.filter((g) => !g.needsUpdate).reduce((a, g) => a + g.bytesToDownload, 0);
      this.current!.downloadedGB = Math.round((downloaded / 1024 ** 3) * 10) / 10;
      this.stage("games").note = `${doneNames.length} of ${pending.length} updated, ${this.current!.downloadedGB} GB so far.`;
      if (!left.length) break;
      if (s.downloadCapGB > 0 && this.current!.downloadedGB >= s.downloadCapGB) {
        this.log(`Reached tonight's ${s.downloadCapGB} GB download cap.`);
        break;
      }
      if (Date.now() - lastProgress > 10 * 60_000) {
        for (const g of left) this.log(`Steam didn't download ${g.name}. It may need you to open it once.`);
        break;
      }
      void this.push();
    }
    const after = steamGames(root);
    this.current!.gamesUpdated = pending.filter((p) => after.find((a) => a.appId === p.appId && !a.needsUpdate)).map((p) => p.name);
    this.set("games", "done", `${this.current!.gamesUpdated.length} of ${pending.length} game(s) updated.`);
  }

  private async stageApps(dryRun: boolean) {
    const s = this.settings();
    if (this.stage("apps").status === "done") return;
    if (!workFeatures() || !s.appUpdates) return this.set("apps", "skipped", workFeatures() ? "Turned off" : "Gaming mode");
    this.set("apps", "running");
    const raw = await runPs("winget upgrade --accept-source-agreements --disable-interactivity", 180_000).catch(() => "");
    const list = parseWinget(raw);
    if (!list.length) return this.set("apps", "done", "All apps are up to date.");
    const running = new Set(telemetry.procs.map((p) => p.name.toLowerCase()));
    // An app that's open is skipped: updating it would close it, and it may have unsaved work.
    const isOpen = (name: string) => [...running].some((r) => r.length > 3 && name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(r.replace(/[^a-z0-9]/g, "")));
    const todo = list.filter((a) => !isOpen(a.name));
    const skipped = list.filter((a) => isOpen(a.name));
    if (dryRun) return this.set("apps", "done", `Would update ${todo.length} app(s): ${todo.map((a) => a.name).slice(0, 6).join(", ")}${skipped.length ? `. Would skip ${skipped.length} open app(s).` : ""}`);
    for (const a of todo) {
      this.check();
      this.stage("apps").note = `Updating ${a.name}...`;
      void this.push();
      const out = await runPs(`winget upgrade --id ${psq(a.id)} -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity`, 20 * 60_000).catch((e) => String(e));
      if (/Successfully installed|successfully/i.test(out)) this.current!.appsUpdated.push(a.name);
      else this.log(`${a.name} didn't update: ${out.split("\n").filter(Boolean).pop()?.slice(0, 120) ?? "no reason given"}`);
    }
    for (const a of skipped) this.log(`Skipped ${a.name} because it was open.`);
    this.set("apps", "done", `${this.current!.appsUpdated.length} app(s) updated${skipped.length ? `, ${skipped.length} skipped because they were open` : ""}.`);
  }

  /** Returns true if the PC is restarting (the run continues after the restart). */
  private async stageSystem(dryRun: boolean, unattended: boolean): Promise<boolean> {
    const s = this.settings();
    if (this.stage("system").status === "done") return false;
    if (mode.isManaged) {
      this.set("system", "skipped", "Your company's IT manages Windows Update and drivers on this PC.");
      return false;
    }
    if (!s.windowsUpdates && s.gpuDriver === "off") {
      this.set("system", "skipped", "Turned off");
      return false;
    }
    this.set("system", "running");
    const notes: string[] = [];
    let reboot = false;
    let driverChanged = false;
    const wu = s.windowsUpdates
      ? await runPsJson<{ titles: string[] }>(String.raw`
$S=New-Object -ComObject Microsoft.Update.Session
$r=$S.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Software' and IsHidden=0")
ConvertTo-Json -Compress -InputObject @{titles=@(foreach($u in $r.Updates){ $u.Title })}`, 300_000).catch(() => ({ titles: [] }))
      : { titles: [] };
    const scan = drivers.lastScan();
    const nv = s.gpuDriver !== "off" ? scan?.gpu.find((g) => g.status === "update") : null;
    if (dryRun) {
      if (wu.titles.length) notes.push(`Would install ${wu.titles.length} Windows update(s)`);
      if (nv) notes.push(s.gpuDriver === "install" ? `Would install GPU driver ${nv.latestVersion}` : `Would download GPU driver ${nv.latestVersion}`);
      this.set("system", "done", notes.join(". ") || "Nothing to install.");
      return false;
    }
    if (wu.titles.length || (nv && s.gpuDriver === "install")) {
      const rp = await runPs(String.raw`
$k='HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore'
$old=(Get-ItemProperty $k -ErrorAction SilentlyContinue).SystemRestorePointCreationFrequency
Set-ItemProperty $k SystemRestorePointCreationFrequency 0 -Type DWord
try { Checkpoint-Computer -Description ('Rigmind Ready to Play ' + (Get-Date -Format 'yyyy-MM-dd')) -RestorePointType MODIFY_SETTINGS -ErrorAction Stop; 'ok' } catch { $_.Exception.Message }
if($old -ne $null){ Set-ItemProperty $k SystemRestorePointCreationFrequency $old -Type DWord } else { Remove-ItemProperty $k SystemRestorePointCreationFrequency -ErrorAction SilentlyContinue }`, 300_000).catch((e) => String(e));
      const restoreOk = rp.trim().endsWith("ok");
      this.log(restoreOk ? "Created a System Restore point." : "Couldn't create a restore point, so driver installs are skipped tonight.");
      if (wu.titles.length) {
        this.stage("system").note = `Installing ${wu.titles.length} Windows update(s)...`;
        void this.push();
        const res = await runPs(String.raw`
$S=New-Object -ComObject Microsoft.Update.Session
$r=$S.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Software' and IsHidden=0")
$c=New-Object -ComObject Microsoft.Update.UpdateColl
foreach($u in $r.Updates){ if(-not $u.EulaAccepted){ $u.AcceptEula() }; [void]$c.Add($u) }
if($c.Count -eq 0){ 'none'; return }
$d=$S.CreateUpdateDownloader(); $d.Updates=$c; [void]$d.Download()
$i=$S.CreateUpdateInstaller(); $i.Updates=$c; $res=$i.Install()
"code=$($res.ResultCode) reboot=$($res.RebootRequired)"`, 2 * 3600_000).catch((e) => String(e));
        reboot ||= /reboot=True/i.test(res);
        notes.push(/code=2/.test(res) ? `Installed ${wu.titles.length} Windows update(s)` : `Windows updates finished with problems (${res.trim().slice(0, 60)})`);
      }
      if (nv && s.gpuDriver === "install" && restoreOk) {
        const before = currentDriver();
        const res = await drivers.installNvidiaSilent((m) => (this.stage("system").note = m));
        driverChanged = res.ok && currentDriver() !== before;
        notes.push(res.ok ? `Installed GPU driver ${res.version}` : `GPU driver didn't install: ${res.message}`);
        if (res.ok) this.emit("note", `GPU driver ${res.version} installed. If anything looks wrong, undo it with the restore point from tonight.`);
      }
    }
    if (nv && s.gpuDriver === "download") {
      const d = await drivers.downloadNvidia((m) => (this.stage("system").note = m));
      if (d.ok) this.current!.needsYou.push(`GPU driver ${d.version} is downloaded. Install it with one click on the Drivers page.`);
    }
    // Old shaders are useless after a driver change: clear them now so the warm-up rebuilds them.
    if (driverChanged) clearShaderCaches("autopilot");
    if (reboot) {
      if (s.restarts === "safe" && unattended && (await this.safeToRestart())) {
        writeFileSync(checkpointFile(), JSON.stringify({ report: { ...this.current!, stages: this.current!.stages.map((x) => (x.id === "system" ? { ...x, status: "done", note: notes.join(". ") } : x)) }, savedAt: Date.now(), restarting: true }));
        this.saveQuietState();
        this.log("Restarting to finish updates. Ready picks up again after the restart.");
        await runPs(`shutdown.exe /r /t 30 /c "Rigmind is restarting to finish updates. Move the mouse within 30 seconds to cancel." /d p:2:17`);
        // A person can still cancel: if they touch the PC, abort the restart.
        for (let i = 0; i < 28; i++) {
          await sleep(1000);
          const idle = await hw.idleMs();
          if (idle != null && idle < 1500) {
            await runPs("shutdown.exe /a").catch(() => {});
            this.current!.restartNeeded = true;
            this.log("You moved the mouse, so the restart was cancelled.");
            this.abortReason = "input";
            throw new Abort("input");
          }
        }
        return true;
      }
      this.current!.restartNeeded = true;
      this.current!.needsYou.push("Restart needed to finish Windows updates.");
    }
    this.set("system", "done", notes.join(". ") || "Nothing to install.");
    return false;
  }

  /** No unsaved-looking windows, Office documents, other signed-in users, calls or games. */
  private async safeToRestart(): Promise<boolean> {
    if (boost.state.active || meeting.active) return false;
    const r = await runPsJson<{ titles: string[]; users: number }>(String.raw`
$t=@(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object { "$($_.ProcessName)|$($_.MainWindowTitle)" })
$u=@(quser 2>$null | Select-Object -Skip 1).Count
ConvertTo-Json -Compress -InputObject @{titles=$t;users=$u}`).catch(() => ({ titles: ["unknown|unknown"], users: 2 }));
    if (r.users > 1) {
      this.log("Another user is signed in, so Rigmind won't restart.");
      return false;
    }
    const risky = (r.titles ?? []).filter((x) => {
      const [proc, title] = x.split("|");
      return /^\*|\*\s|●|•|unsaved|untitled/i.test(title) || /^(winword|excel|powerpnt|outlook|onenote|acrobat|photoshop|afterfx|premiere|blender|resolve|devenv|code|notepad\+\+)$/i.test(proc);
    });
    if (risky.length) {
      this.log(`Didn't restart because these may have unsaved work: ${risky.map((x) => x.split("|")[0]).slice(0, 4).join(", ")}.`);
      return false;
    }
    return true;
  }

  private warmPids: number[] = [];

  private async stageWarmup(dryRun: boolean) {
    const s = this.settings();
    if (this.stage("warmup").status === "done") return;
    if (!gameFeatures() || s.warmup === "off") return this.set("warmup", "skipped", gameFeatures() ? "Turned off" : "Work mode");
    const root = await steamRoot();
    if (!root) return this.set("warmup", "skipped", "Steam isn't installed.");
    this.set("warmup", "running");
    const games = steamGames(root);
    const top = this.topGames(games).filter((g) => g.warm);
    const driver = currentDriver();
    const need = top.filter((g) => {
      const st = this.warm[g.appId];
      const game = games.find((x) => x.appId === g.appId)!;
      return !game.needsUpdate && (!st || st.buildId !== game.buildId || st.driver !== driver);
    });
    if (!need.length) return this.set("warmup", "done", top.length ? "Your top games are already warm." : "No games to warm yet. Play a few sessions so Rigmind learns your favorites.");
    if (dryRun) return this.set("warmup", "done", `Would warm up: ${need.map((g) => g.name).join(", ")}.`);
    for (const g of need) {
      this.check();
      const game = games.find((x) => x.appId === g.appId)!;
      this.stage("warmup").note = `Warming up ${g.name}...`;
      void this.push();
      const res = await this.warmOne(game);
      this.current!.warmed.push(res);
      const st: WarmStat = this.warm[g.appId] ?? { buildId: "", driver: null, lastMB: 0, lowRuns: 0, timeouts: 0, needsYou: false, at: 0 };
      st.at = Date.now();
      if (res.outcome === "warmed" || res.outcome === "no_gain") {
        st.buildId = game.buildId;
        st.driver = driver;
        st.lastMB = res.cacheMB;
        st.lowRuns = res.cacheMB < 50 ? st.lowRuns + 1 : 0;
      }
      if (res.outcome === "timed_out") st.timeouts++;
      if (res.outcome === "needs_you") {
        st.needsYou = true;
        this.current!.needsYou.push(`${g.name} needs you: it stopped at a sign-in or prompt. Open it once, then Rigmind can warm it again.`);
      }
      this.warm[g.appId] = st;
      writeFileSync(warmFile(), JSON.stringify(this.warm));
      this.log(`${g.name}: ${res.outcome.replace("_", " ")} in ${Math.round(res.seconds)} s, shader cache +${res.cacheMB} MB.`);
    }
    const ok = this.current!.warmed.filter((w) => w.outcome === "warmed").length;
    this.set("warmup", "done", `${ok} of ${need.length} game(s) warmed.`);
  }

  /** Launch a game to its menu, wait for the shader compile to finish, close it gently. */
  private async warmOne(g: SteamGame): Promise<WarmResult> {
    const started = Date.now();
    const result = (outcome: WarmResult["outcome"], cacheMB = 0): WarmResult => ({ appId: g.appId, game: g.name, seconds: Math.round((Date.now() - started) / 1000), cacheMB, outcome });
    const before = shaderBytes();
    const dir = g.installDir.toLowerCase();
    await openAsUser(`steam://rungameid/${g.appId}`);
    // Wait up to 3 minutes for the game's process to appear.
    let pids: number[] = [];
    for (let i = 0; i < 36 && !pids.length; i++) {
      await sleep(5000);
      if (this.abortReason) return result("skipped");
      pids = telemetry.procs.filter((p) => p.path?.toLowerCase().startsWith(dir)).map((p) => p.pid);
    }
    if (!pids.length) return result("needs_you");
    this.warmPids = pids;
    hw.monitorOff();
    let lastBytes = shaderBytes();
    let stableSince = Date.now();
    let quietSince: number | null = null;
    const limit = started + 20 * 60_000;
    while (Date.now() < limit) {
      await sleep(5000);
      if (this.abortReason) {
        await this.closeWarmGame();
        return result("skipped", Math.round((shaderBytes() - before) / 1024 ** 2));
      }
      const procs = telemetry.procs.filter((p) => p.path?.toLowerCase().startsWith(dir));
      if (!procs.length) break; // the game closed on its own
      this.warmPids = procs.map((p) => p.pid);
      const bytes = shaderBytes();
      if (bytes !== lastBytes) {
        lastBytes = bytes;
        stableSince = Date.now();
      }
      const coreLoad = procs.reduce((a, p) => a + (p.cpu * CORES) / 100, 0);
      if (coreLoad < 0.15) quietSince ??= Date.now();
      else quietSince = null;
      const grownMB = (bytes - before) / 1024 ** 2;
      // Stuck at a sign-in or prompt: nothing compiling and nothing happening after 3 minutes.
      if (Date.now() - started > 3 * 60_000 && grownMB < 1 && quietSince && Date.now() - quietSince > 60_000) {
        await this.closeWarmGame();
        return result("needs_you");
      }
      // Done: the cache stopped growing for 60 s and the game sat idle at its menu for 30 s.
      if (Date.now() - stableSince >= 60_000 && quietSince && Date.now() - quietSince >= 30_000) {
        await this.closeWarmGame();
        const mb = Math.round((shaderBytes() - before) / 1024 ** 2);
        return result(mb < 50 ? "no_gain" : "warmed", mb);
      }
    }
    await this.closeWarmGame();
    const mb = Math.round((shaderBytes() - before) / 1024 ** 2);
    return Date.now() >= limit ? result("timed_out", mb) : result(mb < 50 ? "no_gain" : "warmed", mb);
  }

  /** Close the warm-up game: ask its window to close, wait up to 30 s, then end the process tree. */
  private async closeWarmGame() {
    const pids = this.warmPids;
    if (!pids.length) return;
    this.warmPids = [];
    await runPs(`foreach($i in @(${pids.join(",")})){ $p=Get-Process -Id $i -ErrorAction SilentlyContinue; if($p){ [void]$p.CloseMainWindow() } }
$t=0; while($t -lt 30 -and @(Get-Process -Id @(${pids.join(",")}) -ErrorAction SilentlyContinue).Count){ Start-Sleep 1; $t++ }
foreach($i in @(${pids.join(",")})){ taskkill.exe /PID $i /T /F 2>$null | Out-Null }`, 60_000).catch(() => {});
  }

  private async stageMaintenance(dryRun: boolean) {
    if (this.stage("maintenance").status === "done") return;
    this.set("maintenance", "running");
    if (dryRun) return this.set("maintenance", "done", "Would run a Defender quick scan, clear temp files and TRIM the SSD.");
    const notes: string[] = [];
    const def = await security.scan("QuickScan").catch(() => null);
    if (def?.ok) notes.push("Defender quick scan done");
    this.check();
    const t = await win.clearTempFiles().catch(() => "");
    if (t) notes.push(t);
    this.check();
    await runPs("Get-Volume -DriveLetter C | Where-Object { $_.FileSystemType -eq 'NTFS' } | Out-Null; Optimize-Volume -DriveLetter C -ReTrim -ErrorAction SilentlyContinue", 30 * 60_000).catch(() => {});
    notes.push("SSD TRIM done");
    this.set("maintenance", "done", notes.join(". "));
  }

  private async stagePrewarm(dryRun: boolean, wokeFromSleep: boolean) {
    const s = this.settings();
    if (!s.prewarm || !gameFeatures()) return this.set("prewarm", "skipped", "Turned off");
    // Only RAM survives sleep; hibernate and shutdown empty it.
    if (!wokeFromSleep && this.current!.trigger === "night") return this.set("prewarm", "skipped", "The PC wasn't sleeping, so there's nothing to keep warm in memory.");
    const free = freemem() / 1024 ** 3;
    if (free < 8) return this.set("prewarm", "skipped", `Only ${free.toFixed(1)} GB of RAM free.`);
    const root = await steamRoot();
    const top = root ? this.topGames(steamGames(root)).find((g) => g.warm) : null;
    const game = root && top ? steamGames(root).find((g) => g.appId === top.appId) : null;
    if (!game) return this.set("prewarm", "skipped", "No game to pre-warm.");
    if (dryRun) return this.set("prewarm", "done", `Would load ${game.name}'s main files into memory.`);
    this.set("prewarm", "running", `Loading ${game.name}...`);
    // Reading the biggest files once puts them in Windows' standby cache (given back instantly if needed).
    const files: { p: string; size: number }[] = [];
    const walk = (d: string, depth: number) => {
      if (depth > 3) return;
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
          else if (st.size > 50 * 1024 ** 2) files.push({ p, size: st.size });
        } catch {
          /* skip */
        }
      }
    };
    walk(game.installDir, 0);
    files.sort((a, b) => b.size - a.size);
    const budget = Math.min(6, free - 6) * 1024 ** 3;
    let used = 0;
    const buf = Buffer.alloc(4 * 1024 ** 2);
    for (const f of files) {
      if (used + f.size > budget) continue;
      this.check();
      try {
        const fd = openSync(f.p, "r");
        while (readSync(fd, buf, 0, buf.length, null) > 0) {
          /* read through */
        }
        closeSync(fd);
        used += f.size;
      } catch {
        /* locked */
      }
    }
    this.set("prewarm", "done", `Loaded ${(used / 1024 ** 3).toFixed(1)} GB of ${game.name} into memory.`);
  }

  async cancel(): Promise<{ ok: boolean; message: string }> {
    if (!this.current) return { ok: false, message: "Ready isn't running." };
    this.abortReason = "input";
    await this.closeWarmGame();
    return { ok: true, message: "Stopping. Everything is being put back." };
  }

  // ---------- Recovery and catch-up ----------
  private async recover() {
    // Put audio, lights and notifications back if the last run crashed.
    try {
      const q = JSON.parse(readFileSync(join(dataDir("ready"), "quiet.json"), "utf8"));
      if (q && (q.muted != null || q.rgbMode || q.toasts != null)) {
        this.saved = q;
        await sleep(15_000); // let the helper and RGB connect
        await this.restoreQuiet();
      }
    } catch {
      /* nothing saved */
    }
    if (!existsSync(checkpointFile())) return;
    try {
      const cp = JSON.parse(readFileSync(checkpointFile(), "utf8"));
      if (cp.restarting && Date.now() - cp.savedAt < 3 * 3600_000) {
        await sleep(60_000); // let Windows finish starting up
        await this.resumeFrom(cp.report);
      } else unlinkSync(checkpointFile());
    } catch {
      /* stale */
    }
  }

  private windowEnd(): number {
    const [h, m] = this.settings().to.split(":").map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    return Math.min(d.getTime(), Date.now() + 4 * 3600_000);
  }

  private async maybeCatchUp() {
    const s = this.settings();
    if (!s.enabled || !s.dryRunDone || this.current || boost.state.active || meeting.active) return;
    const lastNight = this.reports.find((r) => r.trigger !== "manual");
    if (lastNight && Date.now() - lastNight.start < 26 * 3600_000) return;
    const idle = await hw.idleMs();
    if (idle == null || idle < 10 * 60_000) return;
    this.log("Catching up: the PC was off at the scheduled time.");
    await this.run("catchup");
  }

  summaryLine(): string | null {
    const r = this.reports[0];
    if (!r) return null;
    const parts = [r.gamesUpdated.length ? `${r.gamesUpdated.length} game(s) patched` : null, r.warmed.filter((w) => w.outcome === "warmed").length ? `${r.warmed.filter((w) => w.outcome === "warmed").length} warmed` : null, r.appsUpdated.length ? `${r.appsUpdated.length} app(s) updated` : null].filter(Boolean);
    return `${r.dryRun ? "Practice run: " : "Ready: "}${parts.join(", ") || "nothing needed"}${r.minutesSaved ? `, ~${Math.round(r.minutesSaved)} min saved` : ""}${r.needsYou.length ? `. ${r.needsYou.length} thing(s) need you.` : "."}`;
  }
}

/** Parse `winget upgrade` table output into name + id pairs. */
export function parseWinget(out: string): { name: string; id: string }[] {
  // winget redraws a spinner with carriage returns; keep only what's left on each line.
  const lines = out.split(/\n/).map((l) => l.split("\r").filter(Boolean).pop() ?? "");
  const head = lines.findIndex((l) => /\bName\s+Id\s+Version\b/.test(l));
  if (head < 0) return [];
  const start = lines[head].indexOf("Name");
  const idCol = lines[head].indexOf("Id", start + 4) - start;
  const verCol = lines[head].indexOf("Version") - start;
  const res: { name: string; id: string }[] = [];
  for (const raw of lines.slice(head + 1)) {
    if (/^-{5,}/.test(raw.trim()) || !raw.trim() || /upgrades? available|package\(s\) have|require explicit/i.test(raw)) continue;
    const l = raw.slice(start);
    const name = l.slice(0, idCol).trim();
    const id = l.slice(idCol, verCol).trim();
    if (name && /^[\w.+-]+$/.test(id)) res.push({ name, id });
  }
  return res;
}

export const ready = new ReadyEngine();
