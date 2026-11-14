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
  mode: "status" | "static" | "off";
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
  devices: { id: number; name: string; type: string; leds: number }[];
  current: string; // hex currently shown
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
  | "apply_fan_profile";

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

export interface RigmindApi {
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
