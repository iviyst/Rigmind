// Types for Rigmind 1.3: modes, Ready to Play / Ready to Work, App Boost, Meeting Mode,
// Browser Guard, antivirus teamwork + threat lists, Space and memory, Printer Finder, work tools.

export type WorkMode = "gaming" | "work" | "both";
export type ActiveProfile = "game" | "call" | "work" | "normal";

export interface ModeState {
  mode: WorkMode;
  chosenAt: "installer" | "app" | "default";
  active: ActiveProfile;
  detail: string | null; // e.g. "Teams call", "Premiere Pro exporting"
  override: ActiveProfile | null;
  pcType: "desktop" | "laptop";
  managed: boolean; // domain or Intune joined: hands off what IT controls
}

// ---------- Ready to Play / Ready to Work (the night engine) ----------
export type ReadyStageId = "preflight" | "games" | "apps" | "system" | "warmup" | "maintenance" | "backup" | "prewarm" | "restore";
export type StageStatus = "pending" | "running" | "done" | "skipped" | "failed";

export interface ReadySettings {
  enabled: boolean;
  dryRunDone: boolean; // the first run is always a dry run
  from: string; // "03:00"
  to: string; // "06:00"
  weekdaysOnly: boolean; // Ready to Work default
  gameUpdates: boolean;
  appUpdates: boolean; // winget + self-updating apps (work)
  warmup: "off" | "top3" | "top5" | "all";
  windowsUpdates: boolean;
  gpuDriver: "off" | "download" | "install";
  restarts: "never" | "safe";
  prewarm: boolean;
  fanCapPct: number;
  downloadCapGB: number; // 0 = no cap
  phoneReport: boolean;
  gpuLimitC: number;
  cpuLimitC: number;
  alwaysWarm: string[]; // Steam app ids
  neverTouch: string[]; // Steam app ids
}

export interface ReadyStage {
  id: ReadyStageId;
  label: string;
  status: StageStatus;
  note: string | null;
}

export interface WarmResult {
  appId: string;
  game: string;
  seconds: number;
  cacheMB: number;
  outcome: "warmed" | "timed_out" | "needs_you" | "no_gain" | "skipped";
}

export interface ReadyReport {
  id: string;
  start: number;
  end: number | null;
  trigger: "night" | "manual" | "catchup";
  dryRun: boolean;
  stages: ReadyStage[];
  gamesUpdated: string[];
  appsUpdated: string[];
  warmed: WarmResult[];
  downloadedGB: number;
  minutesSaved: number;
  restartNeeded: boolean;
  needsYou: string[];
  backup: BackupStatus | null;
  stoppedBy: "input" | "heat" | "battery" | "call" | null;
  log: string[];
}

export interface ReadyState {
  running: boolean;
  current: ReadyReport | null;
  last: ReadyReport | null;
  history: { id: string; start: number; minutesSaved: number; dryRun: boolean }[];
  settings: ReadySettings;
  scheduled: boolean;
  wakeIssues: string[]; // why waking may not work
  topGames: { appId: string; name: string; score: number; warm: boolean }[];
  weekMinutesSaved: number;
}

// ---------- App Boost ----------
export interface WorkApp {
  exe: string; // lower case, no .exe
  name: string;
  kind: "video" | "3d" | "code" | "office" | "gis" | "custom";
}

export interface AppJob {
  id: string;
  app: string;
  exe: string;
  start: number;
  end: number;
  seconds: number;
  vsAvgPct: number | null; // negative = faster than average
}

export interface AppBoostState {
  enabled: boolean;
  active: { app: string; exe: string; since: number; paused: string[] } | null;
  jobs: AppJob[];
  apps: WorkApp[];
}

// ---------- Meeting Mode ----------
export interface MeetingState {
  enabled: boolean;
  inCall: boolean;
  app: string | null;
  since: number | null;
  paused: string[];
  health: { level: "good" | "warn" | "bad"; message: string | null; jitterMs: number | null; lossPct: number | null; wifiSignal: number | null; cpu: number | null };
  dnd: boolean;
}

// ---------- Browser Guard ----------
export type RiskLevel = "ok" | "review" | "risky";

export interface BrowserExtension {
  key: string; // browser|profile|id
  id: string;
  name: string;
  version: string;
  browser: "Chrome" | "Edge" | "Brave" | "Firefox";
  profile: string;
  permissions: string[];
  fromStore: boolean;
  forced: boolean;
  enabled: boolean;
  score: number;
  level: RiskLevel;
  reasons: string[];
  knownBad: boolean;
  blocked: boolean;
  newPermissions: string[];
}

export interface HijackFinding {
  id: string;
  kind: "search" | "homepage" | "proxy" | "dns" | "hosts" | "shortcut" | "policy";
  title: string;
  detail: string;
  fixable: boolean;
}

export interface BrowserGuardState {
  scannedAt: number | null;
  scanning: boolean;
  managedPc: boolean;
  extensions: BrowserExtension[];
  hijacks: HijackFinding[];
}

// ---------- Antivirus teamwork and threat lists ----------
export interface AvProduct {
  name: string;
  enabled: boolean;
  upToDate: boolean;
  isDefender: boolean;
}

export interface IntelStatus {
  version: string | null;
  builtAt: number | null;
  checkedAt: number | null;
  counts: { hashes: number; extensions: number; domains: number };
  stale: boolean; // older than 48 hours
  error: string | null;
  clam: { installed: boolean; path: string | null; dbUpdated: number | null };
}

export interface FileFinding {
  id: string;
  path: string;
  sha256: string;
  threat: string;
  source: "threat list" | "ClamAV";
  found: number;
  status: "found" | "handed_off" | "removed_by_av" | "av_says_clean" | "held" | "ignored" | "restored";
  av: string | null;
}

export interface ThreatScanState {
  products: AvProduct[];
  intel: IntelStatus;
  scanning: boolean;
  lastScan: number | null;
  scanned: number;
  findings: FileFinding[];
}

// ---------- Space and memory ----------
export interface DirNode {
  name: string;
  path: string;
  bytes: number;
  files: number;
  children?: DirNode[];
}

export interface DiskInfo {
  drive: string;
  label: string;
  totalBytes: number;
  freeBytes: number;
}

export interface DiskMap {
  drive: string;
  scannedAt: number;
  seconds: number;
  root: DirNode;
  bigFiles: { path: string; bytes: number; modified: number }[];
}

export interface SpaceHog {
  id: string;
  label: string;
  bytes: number;
  detail: string;
  fix: string | null; // button label, null = explain only
  needsPreview: boolean;
}

export interface CleanupPreview {
  hogId: string;
  items: { path: string; bytes: number }[];
  totalBytes: number;
}

export interface AppMemory {
  app: string;
  memMB: number;
  procs: number;
  growthMB: number | null; // over the last 3 hours
  leak: boolean;
  history: number[]; // one point per 10 minutes, last 24 h
}

export interface MemoryView {
  totalMB: number;
  inUseMB: number;
  compressedMB: number;
  standbyMB: number;
  freeMB: number;
  apps: AppMemory[];
  startup: StartupItem[];
}

export interface StartupItem {
  id: string;
  name: string;
  command: string;
  location: string; // registry key or folder
  enabled: boolean;
  publisher: string | null;
}

// ---------- Printer Finder ----------
export interface PrinterInfo {
  key: string;
  name: string;
  installed: boolean;
  status: string; // Online, Offline, Error...
  isDefault: boolean;
  host: string | null;
  port: string | null;
  model: string | null;
  location: string | null;
  color: boolean | null;
  ippUrl: string | null;
  adminUrl: string | null;
  jobs: number;
  managedByIt: boolean;
  problem: string | null;
}

// ---------- Why is it slow, Hang detective, work tools ----------
export interface SlowCause {
  title: string;
  detail: string;
  fix: { label: string; action: string; target?: string } | null;
}

export interface WhySlow {
  t: number;
  verdict: string;
  causes: SlowCause[];
}

export interface HangPattern {
  app: string;
  count: number;
  lastAt: number;
  pattern: string | null; // null until 3+ hangs
}

export interface BatteryInfo {
  present: boolean;
  designWh: number | null;
  fullWh: number | null;
  wearPct: number | null;
  cycles: number | null;
  vendorTool: { name: string; hint: string } | null;
}

export interface BackupStatus {
  kind: string; // "File History", "OneDrive folder backup", "None found"
  lastRun: number | null;
  level: "good" | "warn" | "bad" | "unknown";
  detail: string;
}

export interface DevInfo {
  wsl: { installed: boolean; capGB: number | null; usingMB: number | null };
  docker: boolean;
  caches: { name: string; path: string; bytes: number }[];
}

export interface PortOwner {
  port: number;
  protocol: string;
  process: string;
  pid: number;
}

type Res = { ok: boolean; message: string };

export interface Api13 {
  getMode(): Promise<ModeState>;
  setMode(mode: WorkMode): Promise<ModeState>;
  setProfileOverride(p: ActiveProfile | null): Promise<ModeState>;
  onMode(cb: (m: ModeState) => void): () => void;

  readyState(): Promise<ReadyState>;
  readySave(patch: Partial<ReadySettings>): Promise<ReadyState>;
  readyRunNow(dryRun: boolean): Promise<Res>;
  readyCancel(): Promise<Res>;
  readyTestWake(): Promise<Res>;
  onReady(cb: (s: ReadyState) => void): () => void;

  appBoostState(): Promise<AppBoostState>;
  appBoostSave(patch: { enabled?: boolean; addExe?: string; removeExe?: string }): Promise<AppBoostState>;
  onAppBoost(cb: (s: AppBoostState) => void): () => void;
  meetingState(): Promise<MeetingState>;
  meetingSave(patch: { enabled?: boolean; dnd?: boolean }): Promise<MeetingState>;
  meetingCheck(): Promise<{ mic: string | null; speakers: string | null; camera: boolean; net: string }>;
  onMeeting(cb: (s: MeetingState) => void): () => void;

  browserState(): Promise<BrowserGuardState>;
  browserScan(): Promise<BrowserGuardState>;
  browserBlock(key: string): Promise<Res>;
  browserOpen(key: string): Promise<Res>;
  browserFix(id: string): Promise<Res>;

  threatState(): Promise<ThreatScanState>;
  threatScan(): Promise<Res>;
  threatAct(id: string, action: "hand_off" | "hold" | "restore" | "ignore" | "report"): Promise<Res>;
  intelUpdate(): Promise<Res>;
  onThreats(cb: (s: ThreatScanState) => void): () => void;

  disks(): Promise<DiskInfo[]>;
  diskScan(drive: string): Promise<DiskMap>;
  onDiskProgress(cb: (p: { drive: string; files: number; bytes: number }) => void): () => void;
  spaceHogs(): Promise<SpaceHog[]>;
  spacePreview(id: string): Promise<CleanupPreview>;
  spaceClean(id: string): Promise<Res>;
  openPath(path: string): Promise<void>;
  memoryView(): Promise<MemoryView>;
  memoryAct(action: "restart" | "close", app: string): Promise<Res>;
  startupToggle(id: string, enabled: boolean): Promise<Res>;

  printers(refresh?: boolean): Promise<PrinterInfo[]>;
  printerAdd(key: string): Promise<Res>;
  printerIdentify(key: string): Promise<Res>;
  printerFix(key: string, fix: "queue" | "default" | "port" | "remove"): Promise<Res>;

  whySlow(): Promise<WhySlow>;
  whySlowFix(action: string, target?: string): Promise<Res>;
  hangPatterns(): Promise<HangPattern[]>;
  battery(): Promise<BatteryInfo>;
  backupStatus(): Promise<BackupStatus>;
  devInfo(): Promise<DevInfo>;
  devAct(action: "wslcap" | "cleancache", arg: string): Promise<Res>;
  portOwners(): Promise<PortOwner[]>;
}
