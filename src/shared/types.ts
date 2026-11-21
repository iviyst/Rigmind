import type { Api13 } from "./types13";
export * from "./types13";
// Types shared between the Electron main process and the React UI.

export interface ProcInfo {
  pid: number;
  name: string;
  path?: string;
  cpu: number; // % of total CPU
  memMB: number;
}

export interface GpuStats {
  name: string;
  load: number; // %
  temp: number | null; // °C
  vramUsedMB: number | null;
  vramTotalMB: number | null;
  clockMHz: number | null;
  powerW: number | null;
}

export interface FpsStats {
  fps: number;
  low1: number; // 1% low fps
  frametimeMs: number; // average frame time over the last second
  frametimes: number[]; // last second of raw frame times (ms)
}

export interface Telemetry {
  t: number; // epoch ms
  cpu: { load: number; temp: number | null; clockMHz: number | null };
  gpu: GpuStats | null;
  ram: { usedGB: number; totalGB: number };
  disk: { readMBs: number; writeMBs: number };
  net: { downMbps: number; upMbps: number };
  fps: FpsStats | null;
}

export interface GameState {
  active: boolean;
  game: string | null; // friendly name
  exe: string | null;
  pid: number | null;
  since: number | null;
  boosted: boolean;
  fpsCapture: "off" | "running" | "unavailable";
  suspended: string[]; // names of paused background apps
}

export interface BoostSettings {
  enabled: boolean;
  raisePriority: boolean;
  highPerformancePower: boolean;
  pauseBackground: boolean;
  suspendList: string[]; // process names (without .exe)
  overlay: boolean;
  overlayCorner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  sessionReports: boolean;
  autoAnalyze: boolean;
  customGames: string[]; // extra exe names treated as games
  ignoredExes: string[]; // never treat as a game
}

export interface Settings {
  model: string;
  hasApiKey: boolean;
  aiProvider: "claude" | "local";
  localModel: string;
  aiReady: boolean; // the chosen AI engine is set up
  startWithWindows: boolean;
  presentMonPath: string;
  boost: BoostSettings;
  driverCheckHours: number;
}

export type StutterCause = "vram" | "thermal" | "background" | "loading" | "cpu" | "shader" | "unknown";

export const CAUSE_LABELS: Record<StutterCause, string> = {
  shader: "Likely shader compiling",
  loading: "Loading from disk",
  background: "Background app",
  cpu: "CPU maxed out",
  vram: "Video memory full",
  thermal: "Overheating",
  unknown: "Unclear",
};

export interface StutterEvent {
  t: number;
  frametimeMs: number;
  cpuLoad: number;
  gpuLoad: number | null;
  ramUsedGB: number;
  diskMBs: number;
  topProc: string | null; // busiest non-game process at the time
  cause?: StutterCause;
  why?: string; // one-line evidence for the cause
  snapshot?: string | null; // file name of a screenshot taken at the hitch
}

export interface SessionSummary {
  id: string;
  game: string;
  exe: string;
  start: number;
  end: number;
  avgFps: number | null;
  low1: number | null;
  stutters: number;
  maxCpuTemp: number | null;
  maxGpuTemp: number | null;
  avgCpuLoad: number;
  avgGpuLoad: number | null;
  peakRamGB: number;
  analysis: string | null;
  causes?: Partial<Record<StutterCause, number>>;
  driver?: string | null; // GPU driver version during the session
  energyWh?: number | null;
  anomaly?: string | null; // "Ran 14% slower than your usual"
  pingAvg?: number | null;
}

export interface SessionPoint {
  t: number;
  fps: number | null;
  low1: number | null;
  ft: number | null; // avg frametime
  ftMax: number | null; // worst frametime in that second
  cpu: number;
  gpu: number | null;
  cpuTemp: number | null;
  gpuTemp: number | null;
  ram: number;
  gpuClock?: number | null;
  disk?: number | null; // read MB/s
  ping?: number | null;
}

export interface SessionDetail extends SessionSummary {
  points: SessionPoint[];
  stutterEvents: StutterEvent[];
}

export interface DriverItem {
  name: string;
  category: string;
  installedVersion: string;
  installedDate: string | null;
  latestVersion?: string | null;
  status: "current" | "update" | "unknown" | "check";
  note?: string;
  link?: string;
}

export interface WindowsUpdateDriver {
  id: string;
  title: string;
  driverClass: string;
  manufacturer: string;
  date: string | null;
  isFirmware: boolean;
}

export interface FirmwareItem {
  kind: "bios" | "ssd";
  name: string;
  version: string;
  date: string | null;
  ageDays: number | null;
  advice: string;
  link: string;
  guide?: { vendor: string; tool: string; steps: string[] };
}

export interface BiosLookup {
  board: string;
  current: string;
  latest: string | null;
  latestDate: string | null;
  newer: boolean | null;
  notes: string; // markdown: what the newer versions fix, warnings like "can't downgrade"
  url: string | null;
}

export interface DriverScan {
  scannedAt: number;
  gpu: DriverItem[];
  nvidiaLatest: { version: string; url: string; date: string } | null;
  devices: DriverItem[];
  windowsUpdate: WindowsUpdateDriver[];
  firmware: FirmwareItem[];
  errors: string[];
}

// ---------- Hardware helper (LibreHardwareMonitor) ----------
export interface FanInfo {
  controlId: string;
  name: string; // e.g. "Fan #2" or "GPU Fan"
  hardware: string; // e.g. "Nuvoton NCT6799D" or "NVIDIA GeForce RTX 4070"
  rpm: number | null;
  percent: number | null; // current duty from the control sensor
  min: number;
  max: number;
}

export interface TempReading {
  id: string;
  name: string;
  hardware: string;
  value: number;
}

export interface HwStatus {
  running: boolean; // helper process is up
  built: boolean; // rigmind-hw.exe exists
  pawnio: boolean; // driver installed (needed for motherboard fans)
  error: string | null;
  fans: FanInfo[];
  temps: TempReading[];
}

// ---------- Fan control ----------
export type FanProfileName = "quiet" | "balanced" | "performance";
export type FanSource = "cpu" | "gpu" | "max" | "liquid";
export interface CurvePoint { t: number; p: number } // °C -> %

export interface FanControlCfg {
  label: string;
  mode: "auto" | "profile" | "custom" | "fixed";
  source: FanSource;
  fixed: number;
  custom: CurvePoint[];
  minPct: number; // never go below (from calibration)
  calibration?: { at: number; startPct: number; points: { p: number; rpm: number }[] } | null;
}

export interface FanSettings {
  enabled: boolean;
  riskAccepted: boolean;
  desktopProfile: FanProfileName;
  gameProfile: FanProfileName;
  preRamp: boolean;
  controls: Record<string, FanControlCfg>;
}

export interface FanRuntime {
  active: boolean;
  failsafe: string | null; // reason all fans are at 100%
  targets: Record<string, number>; // controlId -> % being applied
  profile: FanProfileName;
  calibrating: { controlId: string; step: string } | null;
}

// ---------- RGB ----------
export interface RgbSettings {
  enabled: boolean;
  mode: "status" | "static" | "off" | "screen";
  color: string; // hex
  brightness: number; // 0-100
  alerts: boolean;
  gameScenes: boolean;
  schedule: { enabled: boolean; from: string; to: string }; // lights off between from-to (HH:MM)
  idleOffMin: number; // 0 = never
  openRgbPath: string;
}

export interface RgbStatus {
  connected: boolean;
  installed: boolean;
  devices: { id: number; name: string; type: string; leds: number; state: "direct" | "static" | "no-leds" | "unsupported" }[];
  current: string; // hex currently shown
  gameEvent?: string | null; // e.g. "Bomb planted" when game lighting is active
  reason: string; // why that color ("CPU 64°C", "Lights off on schedule"...)
  error: string | null;
}

// ---------- Per-game profiles ----------
export interface GameProfile {
  exe: string;
  name: string;
  pauseMode: "global" | "custom";
  pauseList: string[];
  priority: "High" | "AboveNormal" | "Normal";
  power: "high" | "keep";
  affinity: "all" | "cache-ccd";
  fanProfile: "default" | FanProfileName;
  rgbColor: string | null;
  suggestedPause: string[]; // learned from background-app stutters
  sessions: number;
  lastPlayed: number | null;
  installDir?: string | null;
}

// ---------- Before/after tests ----------
export type TestChangeKind = "power_high" | "pause_app" | "game_dvr_off" | "affinity_cache" | "priority_high" | "fan_profile";

export interface PhaseStats {
  fps: number;
  low1: number;
  stutters: number;
  seconds: number;
}

export interface TestRun {
  id: string;
  game: string;
  exe: string;
  change: TestChangeKind;
  target?: string;
  label: string;
  started: number;
  phase: "before" | "after" | "before-again" | "done" | "aborted";
  progress: number; // 0-1
  a1?: PhaseStats;
  b?: PhaseStats;
  a2?: PhaseStats;
  verdict?: "better" | "same" | "worse";
  summary?: string;
  kept?: boolean;
}

export interface UpdateStatus {
  state: "idle" | "dev" | "checking" | "current" | "downloading" | "ready" | "error";
  current: string;
  version: string | null;
  progress: number;
  error: string | null;
  checkedAt: number | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  actions?: ProposedAction[];
}

export type ActionKind =
  | "set_power_plan_high"
  | "set_power_plan_balanced"
  | "end_process"
  | "add_to_pause_list"
  | "enable_game_mode"
  | "disable_game_dvr"
  | "clear_temp_files"
  | "enable_gpu_scheduling"
  | "open_windows_setting"
  | "scan_drivers"
  | "set_game_affinity_cache"
  | "raise_game_priority"
  | "apply_fan_profile"
  | "set_refresh_rate"
  | "add_defender_exclusion"
  | "clear_shader_cache"
  | "block_app_firewall"
  | "quick_scan"
  | "remove_threat"
  | "disable_startup_review";

export interface ProposedAction {
  id: string;
  kind: ActionKind;
  target?: string;
  label: string;
  reason: string;
  state?: "pending" | "done" | "failed" | "testing";
  result?: string;
  testable?: boolean; // can be measured with a before/after test
}

export interface ToolStatus {
  presentMon: boolean;
  cpuTempSensor: boolean;
  nvidiaSmi: boolean;
}

export interface SystemInfo {
  os: string;
  cpu: string;
  cores: number;
  threads: number;
  ramGB: number;
  ramSticks: string[];
  gpus: string[];
  board: string;
  bios: string;
  disks: string[];
  powerPlan: string;
  gameMode: boolean;
  gameDvr: boolean;
  gpuScheduling: boolean;
  displays: string[];
}

export interface LocalAiStatus {
  installed: boolean;
  running: boolean;
  models: string[];
  recommended: string;
  vramGB: number | null;
  pulling: { model: string; pct: number; status: string } | null;
}

export interface RigmindApi extends Api13 {
  localAiStatus(): Promise<LocalAiStatus>;
  localAiSetup(model?: string): Promise<{ ok: boolean; message: string }>;
  onLocalAi(cb: (s: LocalAiStatus) => void): () => void;
  // v1.2: health
  listIncidents(): Promise<Incident[]>;
  explainIncident(id: string): Promise<string>;
  onIncident(cb: (i: Incident) => void): () => void;
  bootReport(): Promise<BootReport>;
  healthTrends(): Promise<{ weeks: HealthTrend[]; warning: string | null }>;
  driverImpact(): Promise<DriverImpact[]>;
  stressStart(seconds: number, label: string, cpu: boolean, gpu: boolean): Promise<StressResult | { error: string }>;
  stressStop(): Promise<void>;
  stressList(): Promise<StressResult[]>;
  onStress(cb: (s: StressState) => void): () => void;
  coachAsk(question: string): Promise<string>;
  // tune
  displayReport(): Promise<DisplayReport>;
  setRefresh(device: string, hz: number): Promise<{ ok: boolean; message: string }>;
  shaderInfo(): Promise<ShaderCacheInfo>;
  clearShaders(): Promise<{ ok: boolean; message: string }>;
  gameAdvice(game: string, goal: string): Promise<string>;
  netStatus(): Promise<NetStatus>;
  onNet(cb: (n: NetStatus) => void): () => void;
  energySummary(): Promise<EnergySummary>;
  biosLookup(): Promise<BiosLookup>;
  // security
  securityState(): Promise<SecurityState>;
  onSecurity(cb: (s: SecurityState) => void): () => void;
  securityCheck(): Promise<SecurityState>;
  securitySweep(): Promise<SecurityState>;
  defenderScan(type: "QuickScan" | "FullScan"): Promise<{ ok: boolean; message: string }>;
  defenderOffline(): Promise<{ ok: boolean; message: string }>;
  defenderUpdate(): Promise<{ ok: boolean; message: string }>;
  threatAction(id: string, action: "remove" | "allow" | "restore"): Promise<{ ok: boolean; message: string }>;
  triageAlert(id: string): Promise<string>;
  dismissAlert(id: string): Promise<void>;
  renameDevice(mac: string, name: string): Promise<void>;
  blockApp(path: string): Promise<{ ok: boolean; message: string }>;
  // AI brain
  listRules(): Promise<Rule[]>;
  addRule(text: string): Promise<Rule[]>;
  toggleRule(id: string, enabled: boolean): Promise<Rule[]>;
  deleteRule(id: string): Promise<Rule[]>;
  listCheckups(): Promise<Checkup[]>;
  runCheckup(): Promise<Checkup>;
  listNotes(): Promise<RigNote[]>;
  addNote(text: string): Promise<RigNote[]>;
  deleteNote(id: string): Promise<RigNote[]>;
  listChanges(): Promise<ChangeEntry[]>;
  undoChange(id: string): Promise<{ ok: boolean; message: string }>;
  onChanges(cb: (c: ChangeEntry[]) => void): () => void;
  // fun
  getSnapshot(sessionId: string, file: string): Promise<string | null>;
  listMatches(): Promise<MatchRecap[]>;
  recapMatch(id: string): Promise<string>;
  voiceAsk(): Promise<void>;
  remotePairing(): Promise<{ url: string | null; qr: string | null }>;
  remoteReset(): Promise<{ url: string | null; qr: string | null }>;
  saveRigCard(dataUrl: string): Promise<{ ok: boolean; message: string }>;
  installGameLighting(): Promise<{ ok: boolean; message: string }>;
  getExtras(): Promise<ExtrasSettings>;
  saveExtras(patch: Partial<ExtrasSettings>): Promise<ExtrasSettings>;
  saveAimScore(mode: string, score: number, avgMs: number): Promise<ExtrasSettings>;
  // hardware, fans, rgb
  getHwStatus(): Promise<HwStatus>;
  onHwStatus(cb: (s: HwStatus) => void): () => void;
  getFanSettings(): Promise<FanSettings>;
  saveFanSettings(patch: Partial<FanSettings>): Promise<FanSettings>;
  getFanRuntime(): Promise<FanRuntime>;
  onFanRuntime(cb: (r: FanRuntime) => void): () => void;
  calibrateFan(controlId: string): Promise<{ ok: boolean; message: string }>;
  getRgbSettings(): Promise<RgbSettings>;
  saveRgbSettings(patch: Partial<RgbSettings>): Promise<RgbSettings>;
  getRgbStatus(): Promise<RgbStatus>;
  onRgbStatus(cb: (s: RgbStatus) => void): () => void;
  launchOpenRgb(): Promise<{ ok: boolean; message: string }>;
  // profiles and tests
  listProfiles(): Promise<GameProfile[]>;
  saveProfile(p: GameProfile): Promise<GameProfile[]>;
  deleteProfile(exe: string): Promise<GameProfile[]>;
  cpuHasCacheCcd(): Promise<boolean>;
  startTest(change: TestChangeKind, target: string | undefined, label: string): Promise<{ ok: boolean; message: string }>;
  cancelTest(): Promise<void>;
  listTests(): Promise<TestRun[]>;
  onTest(cb: (t: TestRun) => void): () => void;
  // updates
  getUpdateStatus(): Promise<UpdateStatus>;
  onUpdateStatus(cb: (u: UpdateStatus) => void): () => void;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<{ ok: boolean; message: string }>;
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Omit<Settings, "hasApiKey">>): Promise<Settings>;
  setApiKey(key: string): Promise<Settings>;
  getSystemInfo(refresh?: boolean): Promise<SystemInfo>;
  getToolStatus(): Promise<ToolStatus>;
  installTool(tool: "presentmon" | "librehardwaremonitor" | "pawnio" | "openrgb"): Promise<{ ok: boolean; message: string }>;
  getRunningApps(): Promise<ProcInfo[]>;
  getGameState(): Promise<GameState>;
  getHistory(): Promise<Telemetry[]>;
  getTopProcs(): Promise<ProcInfo[]>;
  manualBoost(on: boolean): Promise<GameState>;
  onTelemetry(cb: (t: Telemetry) => void): () => void;
  onGameState(cb: (g: GameState) => void): () => void;
  onNavigate(cb: (page: string) => void): () => void;
  listSessions(): Promise<SessionSummary[]>;
  getSession(id: string): Promise<SessionDetail | null>;
  deleteSession(id: string): Promise<void>;
  analyzeSession(id: string): Promise<string>;
  aiChat(history: ChatMessage[]): Promise<ChatMessage>;
  executeAction(a: ProposedAction): Promise<{ ok: boolean; message: string }>;
  driversLast(): Promise<DriverScan | null>;
  driversScan(): Promise<DriverScan>;
  installWindowsUpdateDrivers(ids: string[]): Promise<{ ok: boolean; message: string }>;
  installNvidiaDriver(): Promise<{ ok: boolean; message: string }>;
  onDriverProgress(cb: (msg: string) => void): () => void;
  openExternal(url: string): Promise<void>;
}

/** Assistant actions that can be measured with a before/after test. */
export const TESTABLE: Partial<Record<ActionKind, TestChangeKind>> = {
  set_power_plan_high: "power_high",
  add_to_pause_list: "pause_app",
  disable_game_dvr: "game_dvr_off",
  set_game_affinity_cache: "affinity_cache",
  raise_game_priority: "priority_high",
};

// =====================================================================
// v1.2: health, tuning, security, AI brain, fun features
// =====================================================================

export interface DisplayInfo {
  device: string;
  gpu: string;
  monitor: string;
  width: number;
  height: number;
  hz: number;
  maxHz: number;
  rates: number[];
  maxWidth: number;
  maxHeight: number;
}

export interface DisplayReport {
  displays: DisplayInfo[];
  vrrWindows: boolean | null; // Windows "Variable refresh rate" setting
  issues: { device: string; text: string; fix?: { hz: number } }[];
}

export type IncidentKind = "app_crash" | "app_hang" | "gpu_reset" | "hardware_error" | "bluescreen" | "power_loss";

export interface Incident {
  id: string;
  t: number;
  kind: IncidentKind;
  title: string; // "Cyberpunk2077.exe crashed"
  detail: string; // raw-ish facts from the event log
  app?: string;
  context?: { cpu: number | null; gpu: number | null; cpuTemp: number | null; gpuTemp: number | null; gpuPowerW: number | null; ramGB: number | null; source: "live" | "flight-recorder" | "session" } | null;
  driver?: string | null;
  explanation?: string | null;
}

export interface BootRecord {
  t: number;
  bootSec: number;
  mainPathSec: number;
  postBootSec: number;
}

export interface BootReport {
  boots: BootRecord[];
  slowItems: { name: string; kind: string; delaySec: number; t: number }[];
}

export interface StressResult {
  id: string;
  t: number;
  label: string; // "Stress test" or the undervolt step, e.g. "0.900 V @ 1950 MHz"
  seconds: number;
  passed: boolean;
  reason: string;
  maxCpuTemp: number | null;
  maxGpuTemp: number | null;
  avgGpuPowerW: number | null;
  avgGpuClock: number | null;
  minGpuClock: number | null;
  avgCpuClock: number | null;
  throttled: boolean;
  samples: { s: number; cpuTemp: number | null; gpuTemp: number | null; gpuClock: number | null; gpuPower: number | null }[];
}

export interface StressState {
  running: boolean;
  label: string;
  progress: number;
  seconds: number;
  elapsed: number;
  live: { cpuTemp: number | null; gpuTemp: number | null; gpuClock: number | null; gpuPower: number | null } | null;
}

export interface HealthTrend {
  week: string; // ISO week start, e.g. "2026-11-09"
  gpuTempAtLoad: number | null;
  cpuTempAtLoad: number | null;
  sessions: number;
}

export interface DriverImpact {
  game: string;
  exe: string;
  rows: { driver: string; sessions: number; avgFps: number | null; low1: number | null }[];
  verdict: string | null; // "1% lows 9% lower since 591.44"
}

export interface ShaderCacheInfo {
  caches: { name: string; path: string; mb: number }[];
  totalMb: number;
  autoClearOnDriverUpdate: boolean;
  lastCleared: number | null;
}

export interface GameConfigInfo {
  game: string;
  path: string;
  content: string; // truncated
}

export interface NetStatus {
  targets: { host: string; label: string; ms: number | null; avg: number | null; jitter: number | null; loss: number }[];
  wifi: { ssid: string; signal: number; band: string } | null;
  gameServers: string[];
}

export interface EnergySummary {
  today: { kWh: number; cost: number };
  month: { kWh: number; cost: number };
  nowW: number | null;
  rate: number; // $/kWh
  days: { day: string; kWh: number; cost: number }[];
}

export interface ChangeEntry {
  id: string;
  t: number;
  label: string;
  source: "you" | "assistant" | "autopilot" | "automation";
  undoable: boolean;
  undone: boolean;
}

export interface RigNote {
  id: string;
  t: number;
  text: string;
}

// ---------- Automations ----------
export type RuleTrigger =
  | { type: "game_start"; game?: string }
  | { type: "game_end"; game?: string }
  | { type: "temp_above"; source: "cpu" | "gpu"; value: number }
  | { type: "time"; at: string }
  | { type: "idle"; minutes: number }
  | { type: "app_start"; app: string };

export type RuleAction =
  | { type: "fan_profile"; value: FanProfileName }
  | { type: "light_mode"; value: "status" | "static" | "off" | "screen" }
  | { type: "light_color"; value: string }
  | { type: "pause_app"; value: string }
  | { type: "end_app"; value: string }
  | { type: "power_plan"; value: "high" | "balanced" }
  | { type: "notify"; value: string };

export interface Rule {
  id: string;
  enabled: boolean;
  text: string; // what the user wrote
  summary: string; // plain-English restatement
  trigger: RuleTrigger;
  between?: { from: string; to: string } | null;
  actions: RuleAction[];
  lastRun: number | null;
}

export interface Checkup {
  id: string;
  t: number;
  title: string;
  report: string; // markdown
  actions: ProposedAction[];
}

// ---------- Security ----------
export interface DefenderStatus {
  available: boolean;
  realTime: boolean;
  tamperProtection: boolean | null;
  signatureAgeDays: number | null;
  signatureVersion: string | null;
  lastQuickScan: string | null;
  lastFullScan: string | null;
  scanning: boolean;
  thirdPartyAv: string | null; // another antivirus is active
}

export interface Threat {
  id: string;
  name: string;
  severity: string;
  status: string; // "Quarantined", "Removed", "Allowed", "Active"...
  resources: string[];
  detected: string | null;
}

export interface Listener {
  process: string;
  pid: number;
  port: number;
  protocol: "TCP" | "UDP";
  address: string; // 0.0.0.0 = all networks
  path: string | null;
  signer: string | null;
  firstSeen: number;
  isNew: boolean;
}

export interface LanDevice {
  ip: string;
  mac: string;
  vendorHint: string | null;
  firstSeen: number;
  lastSeen: number;
  isNew: boolean;
  name: string | null; // user label
}

export type SecurityAlertKind = "new_listener" | "failed_logins" | "new_admin" | "new_service" | "new_task" | "new_device" | "exposure" | "threat";

export interface SecurityAlert {
  id: string;
  t: number;
  kind: SecurityAlertKind;
  severity: "info" | "warn" | "high";
  title: string;
  detail: string;
  dismissed: boolean;
  triage?: string | null;
}

export interface SecurityState {
  defender: DefenderStatus | null;
  threats: Threat[];
  listeners: Listener[];
  devices: LanDevice[];
  exposure: { item: string; ok: boolean; detail: string }[];
  alerts: SecurityAlert[];
  lastCheck: number | null;
}

// ---------- Settings for v1.2 features ----------
export interface ExtrasSettings {
  holdWindowsUpdate: boolean; // during games
  autoClearShaders: boolean; // after a GPU driver update
  snapshots: boolean; // stutter screenshots
  energyRate: number; // $/kWh
  baselineWatts: number; // rest of the system
  voice: { enabled: boolean; hotkey: string; speak: boolean };
  remote: { enabled: boolean; port: number; token: string; allowControl: boolean };
  discord: { enabled: boolean; appId: string };
  gameLighting: boolean; // CS2 / Dota 2 game state lighting
  checkup: { enabled: boolean; hour: number };
  anomalyAlerts: boolean;
  autopilot: boolean;
  rigLayout: Record<string, string>; // slot -> fan controlId
  security: { watch: boolean; alertNewDevices: boolean; alertNewListeners: boolean };
  playstyle: string; // e.g. "Competitive CS2 and Valorant, casual Minecraft building"
  aim: { dpi: number; scores: { t: number; mode: string; score: number; avgMs: number }[] };
}

export interface MatchRecap {
  id: string;
  game: "cs2" | "dota2";
  start: number;
  end: number;
  map: string | null;
  stats: Record<string, number | string | null>; // kills, deaths, rounds won...
  rounds: { n: number; won: boolean | null; kills: number; died: boolean; fps: number | null; ping: number | null }[];
  summary: string | null;
}
