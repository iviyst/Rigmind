// Fake data so the UI can be previewed in a normal browser (npm run preview:ui).
import type { RigmindApi, Telemetry, GameState, SessionDetail, Settings, DriverScan, ChatMessage, HwStatus, FanSettings, FanRuntime, RgbSettings, RgbStatus, GameProfile, TestRun, UpdateStatus } from "../shared/types";

const listeners: Record<string, Set<(v: any) => void>> = {};
const on = (ch: string) => (cb: (v: any) => void) => {
  (listeners[ch] ??= new Set()).add(cb);
  return () => listeners[ch].delete(cb);
};
const emit = (ch: string, v: any) => listeners[ch]?.forEach((cb) => cb(v));

let game: GameState = { active: true, game: "Cyberpunk 2077", exe: "Cyberpunk2077", pid: 9120, since: Date.now() - 41 * 60000, boosted: true, fpsCapture: "running", suspended: ["OneDrive", "Dropbox"] };
let settings: Settings = {
  model: "claude-sonnet-5-5",
  hasApiKey: true,
  startWithWindows: true,
  presentMonPath: "",
  driverCheckHours: 24,
  boost: { enabled: true, raisePriority: true, highPerformancePower: true, pauseBackground: true, suspendList: ["OneDrive", "Dropbox", "AdobeUpdateService"], overlay: true, overlayCorner: "top-left", sessionReports: true, autoAnalyze: true, customGames: [], ignoredExes: [] },
};

let k = 0;
function sample(): Telemetry {
  k++;
  const w = (a: number, b: number, s = 1) => a + (Math.sin(k / (7 * s)) * 0.5 + 0.5) * (b - a) + (Math.random() - 0.5) * (b - a) * 0.15;
  const fps = Math.round(w(96, 128));
  const frametimes = Array.from({ length: fps }, (_, i) => 1000 / fps + (Math.random() - 0.5) * 2 + (i === 40 && k % 9 === 0 ? 28 : 0));
  return {
    t: Date.now(),
    cpu: { load: w(38, 61), temp: Math.round(w(66, 74, 2)), clockMHz: Math.round(w(4850, 5150)) },
    gpu: { name: "NVIDIA GeForce RTX 4070 Ti SUPER", load: w(91, 99), temp: Math.round(w(68, 72, 3)), vramUsedMB: Math.round(w(10400, 11200, 4)), vramTotalMB: 16376, clockMHz: Math.round(w(2700, 2790)), powerW: Math.round(w(255, 285)) },
    ram: { usedGB: w(17.4, 18.6, 5), totalGB: 31.9 },
    disk: { readMBs: Math.max(0, w(-20, 60)), writeMBs: Math.max(0, w(-5, 8)) },
    net: { downMbps: Math.max(0, w(0.2, 6)), upMbps: Math.max(0, w(0.1, 1.2)) },
    fps: game.active ? { fps, low1: Math.round(fps * 0.71), frametimeMs: +(1000 / fps).toFixed(2), frametimes } : null,
  };
}
const history: Telemetry[] = [];
for (let i = 0; i < 90; i++) history.push({ ...sample(), t: Date.now() - (90 - i) * 1000 });
setInterval(() => {
  const s = sample();
  history.push(s);
  history.shift();
  emit("telemetry", s);
}, 1000);

function session(id: string, gameName: string, mins: number, ago: number, fps: number, stutters: number, analysis: string | null): SessionDetail {
  const start = Date.now() - ago;
  const points = Array.from({ length: mins * 60 }, (_, i) => {
    const f = Math.round(fps + Math.sin(i / 50) * 12 + (Math.random() - 0.5) * 8 - (i > 900 && i < 1000 ? 25 : 0));
    return { t: start + i * 1000, fps: f, low1: Math.round(f * 0.72), ft: +(1000 / f).toFixed(1), ftMax: +(1000 / f + (i % 97 === 0 ? 30 : Math.random() * 4)).toFixed(1), cpu: Math.round(45 + Math.sin(i / 40) * 12 + (i > 900 && i < 1000 ? 30 : 0)), gpu: Math.round(93 - (i > 900 && i < 1000 ? 22 : 0) + Math.random() * 4), cpuTemp: Math.round(68 + Math.sin(i / 200) * 5), gpuTemp: Math.round(70 + Math.sin(i / 300) * 3), ram: +(17 + i / 3000).toFixed(1) };
  });
  const causeCycle = ["background", "background", "loading", "shader", "background", "loading", "cpu", "background", "shader", "unknown"] as const;
  const stutterEvents = Array.from({ length: stutters }, (_, i) => ({ t: start + (60 + i * ((mins * 60 - 120) / Math.max(1, stutters))) * 1000, frametimeMs: 38 + (i % 5) * 9, cpuLoad: 88, gpuLoad: 71, ramUsedGB: 18.2, diskMBs: 140, topProc: i % 2 ? "MsMpEng (11% CPU)" : "OneDrive (6% CPU)", cause: causeCycle[i % causeCycle.length], why: "Sample" }));
  const causes = stutterEvents.reduce<Record<string, number>>((a, e) => ((a[e.cause] = (a[e.cause] ?? 0) + 1), a), {});
  return { id, game: gameName, exe: gameName.replace(/\s/g, ""), start, end: start + mins * 60000, avgFps: fps, low1: Math.round(fps * 0.68), stutters, maxCpuTemp: 79, maxGpuTemp: 73, avgCpuLoad: 47, avgGpuLoad: 91, peakRamGB: 19.4, analysis, causes, points, stutterEvents };
}
const sessions = [
  session("s1", "Cyberpunk 2077", 52, 3 * 3600_000, 104, 23, "**Verdict: some hitches.** 104 FPS average with a 71 FPS 1% low over 52 minutes; GPU-bound most of the time (GPU 91% avg), which is healthy.\n\n#### What caused the stutters\n- 17 of 23 stutters happened between minute 15 and 17, when CPU load jumped to 88% and **MsMpEng** (Windows Defender) was the busiest other process while the disk read 140 MB/s. That's a real-time scan of the game's files during an area load.\n- The rest line up with **OneDrive** syncing.\n\n#### Top fixes\n1. Add a Defender exclusion for the game folder (Windows Security > Virus & threat protection > Exclusions).\n2. Pause OneDrive during games - it's already on your pause list but wasn't running at launch, so it started mid-session.\n3. Your RAM runs at 4800 MT/s but is rated 6000. Turn on XMP/EXPO in the BIOS."),
  session("s2", "Counter-Strike 2", 34, 26 * 3600_000, 287, 4, null),
  session("s3", "Roblox", 71, 50 * 3600_000, 231, 2, null),
];

const scan: DriverScan = {
  scannedAt: Date.now() - 5 * 3600_000,
  gpu: [{ name: "NVIDIA GeForce RTX 4070 Ti SUPER", category: "Graphics", installedVersion: "572.83", installedDate: "2026-04-10", latestVersion: "591.44", status: "update", note: "Game Ready 591.44 is available." }],
  nvidiaLatest: { version: "591.44", url: "https://example.invalid", date: "2026-11-04" },
  devices: [
    { name: "Realtek Gaming 2.5GbE Family Controller", category: "NET", installedVersion: "10.68.815.2023", installedDate: "2023-08-15", status: "check", note: "Driver is 3 years old - check Realtek's site.", link: "https://www.google.com" },
    { name: "Intel(R) Wi-Fi 6E AX211 160MHz", category: "NET", installedVersion: "23.110.0.5", installedDate: "2026-07-01", status: "current" },
    { name: "Realtek USB Audio", category: "MEDIA", installedVersion: "6.3.9600.2380", installedDate: "2025-11-20", status: "current" },
    { name: "AMD GPIO Controller", category: "SYSTEM", installedVersion: "2.2.0.130", installedDate: "2025-02-11", status: "update", note: "An update from this maker is listed in Windows Update below." },
  ],
  windowsUpdate: [
    { id: "a", title: "Advanced Micro Devices, Inc. - System - 2.2.0.135", driverClass: "System", manufacturer: "AMD", date: "2026-09-02", isFirmware: false },
    { id: "b", title: "Logitech - HIDClass - 5.10.127", driverClass: "HIDClass", manufacturer: "Logitech", date: "2026-06-18", isFirmware: false },
  ],
  firmware: [
    { kind: "bios", name: "Gigabyte B650 AORUS ELITE AX", version: "F20", date: "2025-03-14", ageDays: 610, advice: "Your BIOS is 20 months old. Newer versions often fix stability, memory compatibility (XMP/EXPO) and CPU microcode issues. Check the support page and update with the board's own tool (e.g. Q-Flash, EZ Flash, M-Flash) from a USB stick.", link: "https://www.google.com" },
    { kind: "ssd", name: "Samsung SSD 990 PRO 2TB", version: "4B2QJXD7", date: null, ageDays: null, advice: "Check for SSD firmware updates with Samsung Magician. Back up first.", link: "https://www.google.com" },
  ],
  errors: [],
};

const fanNames = [["CPU Fan", "Nuvoton NCT6799D", 1120, 38], ["System Fan #1", "Nuvoton NCT6799D", 860, 35], ["System Fan #2", "Nuvoton NCT6799D", 845, 35], ["Pump", "Nuvoton NCT6799D", 2650, 70], ["GPU Fan", "NVIDIA GeForce RTX 4070 Ti SUPER", 1430, 46]] as const;
const hwStatus = (): HwStatus => ({
  running: true, built: true, pawnio: true, error: null,
  fans: fanNames.map(([name, hardware, rpm, pct], i) => ({ controlId: `/fan/${i}`, name, hardware, rpm: Math.round(rpm + (Math.random() - 0.5) * 30), percent: pct, min: 0, max: 100 })),
  temps: [
    { id: "t1", name: "CPU Package", hardware: "AMD Ryzen 7 7800X3D", value: 71 },
    { id: "t2", name: "GPU Core", hardware: "NVIDIA GeForce RTX 4070 Ti SUPER", value: 69 },
    { id: "t3", name: "GPU Hot Spot", hardware: "NVIDIA GeForce RTX 4070 Ti SUPER", value: 81 },
    { id: "t4", name: "Motherboard", hardware: "Nuvoton NCT6799D", value: 41 },
    { id: "t5", name: "Composite", hardware: "Samsung SSD 990 PRO 2TB", value: 47 },
  ],
});
let fanSettings: FanSettings = {
  enabled: true, riskAccepted: true, desktopProfile: "quiet", gameProfile: "balanced", preRamp: true,
  controls: {
    "/fan/0": { label: "CPU cooler", mode: "profile", source: "cpu", fixed: 50, custom: [], minPct: 25, calibration: { at: Date.now() - 86400000, startPct: 25, points: [] } },
    "/fan/1": { label: "Front intake", mode: "profile", source: "max", fixed: 50, custom: [], minPct: 20, calibration: null },
    "/fan/2": { label: "Rear exhaust", mode: "custom", source: "max", fixed: 50, custom: [{ t: 40, p: 25 }, { t: 60, p: 35 }, { t: 72, p: 55 }, { t: 82, p: 80 }, { t: 90, p: 100 }], minPct: 20, calibration: null },
    "/fan/3": { label: "Pump", mode: "fixed", source: "cpu", fixed: 70, custom: [], minPct: 50, calibration: null },
    "/fan/4": { label: "GPU Fan", mode: "auto", source: "gpu", fixed: 50, custom: [], minPct: 30, calibration: null },
  },
};
const fanRuntime: FanRuntime = { active: true, failsafe: null, targets: { "/fan/0": 38, "/fan/1": 35, "/fan/2": 36, "/fan/3": 70 }, profile: "balanced", calibrating: null };
let rgbSettings: RgbSettings = { enabled: true, mode: "status", color: "#2f95db", brightness: 80, alerts: true, gameScenes: true, schedule: { enabled: true, from: "23:00", to: "07:00" }, idleOffMin: 15, openRgbPath: "" };
const rgbStatus: RgbStatus = { connected: true, installed: true, current: "#8a6bb5", reason: "Hottest part 71°C", error: null, devices: [
  { id: 0, name: "Gigabyte B650 AORUS ELITE AX", type: "0", leds: 6 },
  { id: 1, name: "Corsair Vengeance RGB DDR5", type: "1", leds: 10 },
  { id: 2, name: "Corsair Vengeance RGB DDR5", type: "1", leds: 10 },
  { id: 3, name: "Lian Li Uni Hub", type: "4", leds: 48 },
] };
let profiles: GameProfile[] = [
  { exe: "Cyberpunk2077", name: "Cyberpunk 2077", pauseMode: "custom", pauseList: ["OneDrive", "Dropbox", "chrome"], priority: "High", power: "high", affinity: "cache-ccd", fanProfile: "balanced", rgbColor: "#f5e94b", suggestedPause: ["MsMpEng", "Spotify"], sessions: 14, lastPlayed: Date.now() - 3 * 3600_000 },
  { exe: "cs2", name: "Counter-Strike 2", pauseMode: "global", pauseList: [], priority: "High", power: "high", affinity: "all", fanProfile: "performance", rgbColor: null, suggestedPause: [], sessions: 31, lastPlayed: Date.now() - 26 * 3600_000 },
  { exe: "RobloxPlayerBeta", name: "Roblox", pauseMode: "global", pauseList: [], priority: "AboveNormal", power: "keep", affinity: "all", fanProfile: "quiet", rgbColor: "#3fc88a", suggestedPause: [], sessions: 52, lastPlayed: Date.now() - 50 * 3600_000 },
];
const testRuns: TestRun[] = [
  { id: "t1", game: "Cyberpunk 2077", exe: "Cyberpunk2077", change: "affinity_cache", label: "Pin to cache cores", started: Date.now() - 2 * 86400000, phase: "done", progress: 1, a1: { fps: 101, low1: 68, stutters: 6, seconds: 40 }, b: { fps: 108, low1: 81, stutters: 2, seconds: 40 }, a2: { fps: 102, low1: 70, stutters: 5, seconds: 40 }, verdict: "better", summary: "1% low 69 → 81 FPS (+17%), average 102 → 108 FPS, stutters 6 → 2. It helped, so Rigmind kept it.", kept: true },
  { id: "t2", game: "Cyberpunk 2077", exe: "Cyberpunk2077", change: "game_dvr_off", label: "Turn off background recording", started: Date.now() - 3 * 86400000, phase: "done", progress: 1, a1: { fps: 103, low1: 70, stutters: 4, seconds: 40 }, b: { fps: 104, low1: 71, stutters: 4, seconds: 40 }, a2: { fps: 102, low1: 69, stutters: 5, seconds: 40 }, verdict: "same", summary: "1% low 70 → 71 FPS (+1%), average 103 → 104 FPS, stutters 5 → 4. No real difference, so Rigmind undid it.", kept: false },
];
const updateStatus: UpdateStatus = { state: "ready", current: "1.0.0", version: "1.1.0", progress: 1, error: null, checkedAt: Date.now() - 20 * 60000 };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockApi: RigmindApi = {
  getSettings: async () => settings,
  saveSettings: async (p) => (settings = { ...settings, ...p, boost: { ...settings.boost, ...(p.boost ?? {}) } }),
  setApiKey: async (key) => (settings = { ...settings, hasApiKey: !!key }),
  getSystemInfo: async () => ({ os: "Windows 11 Pro build 26200", cpu: "AMD Ryzen 7 7800X3D 8-Core Processor", cores: 8, threads: 16, ramGB: 31.9, ramSticks: ["16 GB @ 4800 MT/s (rated 6000)", "16 GB @ 4800 MT/s (rated 6000)"], gpus: ["NVIDIA GeForce RTX 4070 Ti SUPER - driver 32.0.15.7283"], board: "Gigabyte B650 AORUS ELITE AX", bios: "F20 (2025-03-14)", disks: ["Samsung SSD 990 PRO 2TB SSD NVMe"], powerPlan: "High performance", gameMode: true, gameDvr: false, gpuScheduling: true, displays: ["2560x1440 @ 165 Hz"] }),
  getToolStatus: async () => ({ presentMon: true, cpuTempSensor: true, nvidiaSmi: true }),
  installTool: async () => (await wait(800), { ok: true, message: "Installed." }),
  getRunningApps: async () => ["chrome", "Discord", "OneDrive", "Spotify", "Dropbox", "steamwebhelper", "Teams", "AdobeUpdateService", "iCUE", "EpicGamesLauncher"].map((name, i) => ({ pid: 1000 + i, name, cpu: 2, memMB: 900 - i * 70 })),
  getGameState: async () => game,
  getHistory: async () => history,
  getTopProcs: async () => [
    { pid: 9120, name: "Cyberpunk2077", cpu: 38.2, memMB: 11240 },
    { pid: 3321, name: "chrome", cpu: 3.1, memMB: 2410 },
    { pid: 2210, name: "Discord", cpu: 1.4, memMB: 640 },
    { pid: 1820, name: "MsMpEng", cpu: 1.2, memMB: 310 },
    { pid: 4410, name: "iCUE", cpu: 0.9, memMB: 280 },
    { pid: 5521, name: "Spotify", cpu: 0.6, memMB: 420 },
    { pid: 5522, name: "dwm", cpu: 0.5, memMB: 160 },
  ],
  manualBoost: async (on) => {
    game = on ? { ...game, active: true, game: "Cyberpunk 2077", since: Date.now() } : { active: false, game: null, exe: null, pid: null, since: null, boosted: false, fpsCapture: "off", suspended: [] };
    emit("game:state", game);
    return game;
  },
  onTelemetry: on("telemetry"),
  onGameState: on("game:state"),
  onNavigate: on("navigate"),
  listSessions: async () => sessions.map(({ points, stutterEvents, ...s }) => s),
  getSession: async (id) => sessions.find((s) => s.id === id) ?? null,
  deleteSession: async () => {},
  analyzeSession: async () => (await wait(1500), "**Verdict: smooth.** Mock analysis."),
  aiChat: async (h: ChatMessage[]) => {
    await wait(1200);
    return {
      role: "assistant",
      content: "Your GPU is the limit right now - it's at **96%** with 70°C, while the CPU sits at 49%. That's what you want in a demanding game.\n\nTwo things are costing you smoothness:\n- **Chrome** is holding 2.4 GB of RAM and waking the CPU every few seconds.\n- Your RAM runs at **4800 MT/s** but is rated for 6000. Turn on EXPO in the BIOS (Tweaker > Extreme Memory Profile).",
      actions: [
        { id: "x1", kind: "add_to_pause_list", target: "chrome", label: "Pause Chrome during games", reason: "2.4 GB RAM and periodic CPU spikes while gaming.", state: "pending", testable: true },
        { id: "x2", kind: "open_windows_setting", target: "startup", label: "Review startup apps", reason: "11 apps launch with Windows.", state: "pending" },
      ],
    };
  },
  executeAction: async (a) => (await wait(500), { ok: true, message: `${a.label}: done.` }),
  driversLast: async () => scan,
  driversScan: async () => (await wait(1500), scan),
  installWindowsUpdateDrivers: async () => (await wait(1500), { ok: true, message: "Installed. Restart your PC to finish." }),
  installNvidiaDriver: async () => (await wait(1500), { ok: true, message: "Installer is open." }),
  onDriverProgress: on("drivers:progress"),
  openExternal: async (u) => void window.open(u, "_blank"),
  getHwStatus: async () => hwStatus(),
  onHwStatus: (cb) => {
    const id = setInterval(() => cb(hwStatus()), 1000);
    return () => clearInterval(id);
  },
  getFanSettings: async () => fanSettings,
  saveFanSettings: async (p) => (fanSettings = { ...fanSettings, ...p }),
  getFanRuntime: async () => fanRuntime,
  onFanRuntime: on("fans:runtime"),
  calibrateFan: async () => (await wait(2000), { ok: true, message: "Spins reliably from 25%. Max 1980 RPM." }),
  getRgbSettings: async () => rgbSettings,
  saveRgbSettings: async (p) => (rgbSettings = { ...rgbSettings, ...p }),
  getRgbStatus: async () => rgbStatus,
  onRgbStatus: on("rgb:status"),
  launchOpenRgb: async () => ({ ok: true, message: "Connected." }),
  listProfiles: async () => profiles,
  saveProfile: async (p) => (profiles = profiles.map((x) => (x.exe === p.exe ? p : x))),
  deleteProfile: async (exe) => (profiles = profiles.filter((x) => x.exe !== exe)),
  cpuHasCacheCcd: async () => true,
  startTest: async () => ({ ok: true, message: "Test started." }),
  cancelTest: async () => {},
  listTests: async () => [{ id: "live", game: "Cyberpunk 2077", exe: "Cyberpunk2077", change: "pause_app", target: "chrome", label: "Pause Chrome during games", started: Date.now() - 50000, phase: "after", progress: 0.42, a1: { fps: 104, low1: 71, stutters: 3, seconds: 40 } } as TestRun, ...testRuns],
  onTest: on("tests:update"),
  getUpdateStatus: async () => updateStatus,
  onUpdateStatus: on("update:status"),
  checkForUpdates: async () => updateStatus,
  installUpdate: async () => ({ ok: true, message: "Restarting…" }),
};
