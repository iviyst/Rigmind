// Fake data so the UI can be previewed in a normal browser (npm run preview:ui).
import type { ExtrasSettings, Incident, SecurityState, Rule, Checkup, RigNote, ChangeEntry, MatchRecap, StressResult, NetStatus, RigmindApi, Telemetry, GameState, SessionDetail, Settings, DriverScan, ChatMessage, HwStatus, FanSettings, FanRuntime, RgbSettings, RgbStatus, GameProfile, TestRun, UpdateStatus } from "../shared/types";

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
  aiProvider: "claude",
  localModel: "",
  aiReady: true,
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
  return { id, game: gameName, exe: gameName.replace(/\s/g, ""), start, end: start + mins * 60000, avgFps: fps, low1: Math.round(fps * 0.68), stutters, maxCpuTemp: 79, maxGpuTemp: 73, avgCpuLoad: 47, avgGpuLoad: 91, peakRamGB: 19.4, analysis, causes, points, stutterEvents, driver: "32.0.15.9144", energyWh: Math.round(mins * 7.4), pingAvg: 31, anomaly: id === "s1" ? "Cyberpunk 2077 ran 14% slower than usual (104 vs 121 FPS average)." : null };
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
  { id: 0, name: "Gigabyte B650 AORUS ELITE AX", type: "0", leds: 6, state: "direct" },
  { id: 1, name: "Corsair Vengeance RGB DDR5", type: "1", leds: 10, state: "static" },
  { id: 2, name: "Corsair Vengeance RGB DDR5", type: "1", leds: 10, state: "static" },
  { id: 3, name: "Lian Li Uni Hub", type: "4", leds: 0, state: "no-leds" },
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

const base: Partial<RigmindApi> = {
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

// ---------------- v1.2 sample data ----------------
const H = 3600_000;
let extras: ExtrasSettings = {
  holdWindowsUpdate: true, autoClearShaders: true, snapshots: true, energyRate: 0.13, baselineWatts: 60,
  voice: { enabled: true, hotkey: "CommandOrControl+Shift+Space", speak: true },
  remote: { enabled: true, port: 7342, token: "demo", allowControl: true },
  discord: { enabled: false, appId: "" }, gameLighting: true, checkup: { enabled: true, hour: 10 }, anomalyAlerts: true, autopilot: false,
  rigLayout: { front1: "/fan/1", rear: "/fan/2", cpu: "/fan/0", top1: "/fan/2" },
  security: { watch: true, alertNewDevices: true, alertNewListeners: true },
  playstyle: "Competitive CS2 and Valorant, story games on max settings, Minecraft with the kids",
  aim: { dpi: 800, scores: Array.from({ length: 12 }, (_, i) => ({ t: Date.now() - (12 - i) * 86400000, mode: "flick", score: 40 + i * 3 + (i % 3) * 2, avgMs: 520 - i * 9 })) },
};
const incidentsList: Incident[] = [
  { id: "i1", t: Date.now() - 5 * H, kind: "gpu_reset", title: "GPU driver stopped responding and recovered", detail: "Display driver nvlddmkm stopped responding and has successfully recovered.", context: { cpu: 61, gpu: 99, cpuTemp: 74, gpuTemp: 83, gpuPowerW: 302, ramGB: 19.1, source: "live" }, driver: "32.0.15.9144", explanation: "**Likely cause: GPU power spikes.** The reset happened at 302 W, the highest draw this week, and it's the third reset this week, all above 295 W in Cyberpunk.\n\n- Most likely an unstable overclock or a PSU struggling with transient spikes.\n- Try a 90% power limit in Afterburner for a few sessions. If resets stop, the PSU or overclock is the culprit." },
  { id: "i2", t: Date.now() - 26 * H, kind: "app_crash", title: "Cyberpunk2077.exe crashed", app: "Cyberpunk2077.exe", detail: "Faulting module: nvwgf2umx.dll | Exception 0xc0000005", context: { cpu: 58, gpu: 98, cpuTemp: 73, gpuTemp: 82, gpuPowerW: 296, ramGB: 18.8, source: "session" }, driver: "32.0.15.9144", explanation: null },
  { id: "i3", t: Date.now() - 3 * 86400000, kind: "power_loss", title: "PC shut down unexpectedly", detail: "The system has rebooted without cleanly shutting down first.", context: { cpu: 12, gpu: 8, cpuTemp: 44, gpuTemp: 41, gpuPowerW: 31, ramGB: 9.2, source: "flight-recorder" }, driver: "32.0.15.9144", explanation: null },
];
const sec: SecurityState = {
  defender: { available: true, realTime: true, tamperProtection: true, signatureAgeDays: 0, signatureVersion: "1.421.512.0", lastQuickScan: new Date(Date.now() - 20 * H).toISOString(), lastFullScan: new Date(Date.now() - 12 * 86400000).toISOString(), scanning: false, thirdPartyAv: null },
  threats: [{ id: "2147735503", name: "PUA:Win32/Presenoker", severity: "Low", status: "Quarantined", resources: ["file:_C:\\Users\\you\\Downloads\\free-fps-booster.exe"], detected: new Date(Date.now() - 9 * 86400000).toISOString() }],
  listeners: [
    { process: "steam", pid: 4410, port: 27036, protocol: "TCP", address: "0.0.0.0", path: "C:\\Program Files (x86)\\Steam\\steam.exe", signer: null, firstSeen: Date.now() - 30 * 86400000, isNew: false },
    { process: "Discord", pid: 7712, port: 6463, protocol: "TCP", address: "0.0.0.0", path: null, signer: null, firstSeen: Date.now() - 30 * 86400000, isNew: false },
    { process: "AnyDesk", pid: 9921, port: 7070, protocol: "TCP", address: "0.0.0.0", path: "C:\\Program Files (x86)\\AnyDesk\\AnyDesk.exe", signer: null, firstSeen: Date.now() - 4 * H, isNew: true },
  ],
  devices: [
    { ip: "192.168.1.1", mac: "A4-2B-B0-11-22-33", vendorHint: null, firstSeen: Date.now() - 40 * 86400000, lastSeen: Date.now(), isNew: false, name: "Router" },
    { ip: "192.168.1.24", mac: "3C-22-FB-44-55-66", vendorHint: null, firstSeen: Date.now() - 40 * 86400000, lastSeen: Date.now(), isNew: false, name: "Kids' tablet" },
    { ip: "192.168.1.77", mac: "D8-3A-DD-77-88-99", vendorHint: null, firstSeen: Date.now() - 2 * H, lastSeen: Date.now(), isNew: true, name: null },
  ],
  exposure: [
    { item: "Firewall", ok: true, detail: "On for every network type" },
    { item: "Remote Desktop", ok: false, detail: "On. Anyone who can reach this PC can try to sign in. Turn it off unless you use it." },
    { item: "Shared folders", ok: true, detail: "None shared" },
    { item: "SMBv1 (old file sharing)", ok: true, detail: "Off" },
    { item: "Guest account", ok: true, detail: "Off" },
  ],
  alerts: [
    { id: "a1", t: Date.now() - 4 * H, kind: "new_listener", severity: "warn", title: "AnyDesk started accepting network connections", detail: "TCP port 7070 on all networks", dismissed: false, triage: "**Probably expected, but worth a check.** AnyDesk is a remote-control app. If you installed it on purpose, set a strong unattended-access password or turn unattended access off. If you didn't install it, uninstall it now: scammers often ask people to install AnyDesk." },
    { id: "a2", t: Date.now() - 2 * H, kind: "new_device", severity: "info", title: "New device on your network: 192.168.1.77", detail: "Hardware address D8-3A-DD-77-88-99.", dismissed: false, triage: null },
  ],
  lastCheck: Date.now() - 3 * 60000,
};
let rules: Rule[] = [
  { id: "r1", enabled: true, text: "When I start Valorant, close Chrome and set fans to performance", summary: "When VALORANT starts: end Chrome, gaming fans to Performance.", trigger: { type: "game_start", game: "VALORANT-Win64-Shipping" }, actions: [{ type: "end_app", value: "chrome" }, { type: "fan_profile", value: "performance" }], lastRun: Date.now() - 20 * H, between: null },
  { id: "r2", enabled: true, text: "Turn the lights off at 11pm on school nights", summary: "At 23:00: lights off.", trigger: { type: "time", at: "23:00" }, actions: [{ type: "light_mode", value: "off" }], lastRun: Date.now() - 10 * H, between: null },
  { id: "r3", enabled: false, text: "If the GPU goes over 84 degrees, warn me and switch to performance fans", summary: "When GPU passes 84°C: notify, fans to Performance.", trigger: { type: "temp_above", source: "gpu", value: 84 }, actions: [{ type: "notify", value: "GPU is over 84°C" }, { type: "fan_profile", value: "performance" }], lastRun: null, between: null },
];
const checkups: Checkup[] = [{ id: "c1", t: Date.now() - 3 * H, title: "Mostly healthy: one GPU stability issue to look at", report: "**Mostly healthy: one GPU stability issue to look at.**\n\n1. **GPU driver reset 3 times this week**, each above 295 W in Cyberpunk. Try a 90% power limit for a few sessions.\n2. **Remote Desktop is on.** You haven't signed in remotely in 30 days. Turn it off.\n3. **Your 165 Hz monitor ran at 60 Hz** after yesterday's driver update. Fix below.\n\nTemps, boot time (19 s) and drivers are fine.", actions: [{ id: "p1", kind: "set_refresh_rate", target: "\\\\.\\DISPLAY1|165", label: "Set monitor to 165 Hz", reason: "It's at 60 Hz but supports 165 Hz.", state: "pending" }] }];
let notes: RigNote[] = [
  { id: "n1", t: Date.now() - 2 * 86400000, text: "Enabled XMP on Nov 14 (DDR4-3600 kit now at rated speed)." },
  { id: "n2", t: Date.now() - 5 * 86400000, text: "PSU is a 750 W Corsair RM750 from 2019." },
];
let changes: ChangeEntry[] = [
  { id: "h1", t: Date.now() - 1 * H, label: "Set LG ULTRAGEAR to 165 Hz (was 60 Hz)", source: "assistant", undoable: true, undone: false },
  { id: "h2", t: Date.now() - 6 * H, label: "Added Spotify to the pause list", source: "autopilot", undoable: true, undone: false },
  { id: "h3", t: Date.now() - 20 * H, label: "Automation ran: When VALORANT starts: end Chrome, gaming fans to Performance.", source: "automation", undoable: false, undone: false },
  { id: "h4", t: Date.now() - 2 * 86400000, label: "Cleared 1840 MB of GPU shader caches", source: "autopilot", undoable: false, undone: false },
];
const matches: MatchRecap[] = [{ id: "m1", game: "cs2", start: Date.now() - 30 * H, end: Date.now() - 29.3 * H, map: "de_mirage", stats: { kills: 21, deaths: 17, assists: 4, mvps: 3, team_ct: 13, team_t: 10 },
  rounds: Array.from({ length: 23 }, (_, i) => ({ n: i, won: i % 3 !== 0, kills: (i * 7) % 4, died: i % 2 === 0, fps: i === 14 ? 142 : 290 + (i % 5) * 8, ping: i === 14 ? 96 : 22 + (i % 3) })),
  summary: "**Solid match, 21-17 with 3 MVPs.** One PC problem: in round 15 your FPS fell to 142 and ping hit 96 ms right as you died, the same moment Windows Update started (Rigmind now holds updates during games).\n\n- Your deaths cluster in the first 20 seconds of T-side rounds: try a slower mid control.\n- Your FPS is far above your 165 Hz refresh, so cap it at 237 with Reflex on for steadier input lag." }];
const stressList: StressResult[] = [
  { id: "s1", t: Date.now() - 86400000, label: "0.925 V @ 2715 MHz", seconds: 300, passed: true, reason: "Completed with stable clocks and safe temperatures.", maxCpuTemp: 71, maxGpuTemp: 69, avgGpuPowerW: 231, avgGpuClock: 2712, minGpuClock: 2685, avgCpuClock: 4950, throttled: false, samples: [] },
  { id: "s2", t: Date.now() - 86400000 - 2 * H, label: "0.900 V @ 2715 MHz", seconds: 142, passed: false, reason: "The GPU driver reset during the test. This setting isn't stable.", maxCpuTemp: 70, maxGpuTemp: 67, avgGpuPowerW: 219, avgGpuClock: 2710, minGpuClock: 2690, avgCpuClock: 4940, throttled: false, samples: [] },
  { id: "s3", t: Date.now() - 2 * 86400000, label: "Stock", seconds: 300, passed: true, reason: "Completed with stable clocks and safe temperatures.", maxCpuTemp: 72, maxGpuTemp: 76, avgGpuPowerW: 284, avgGpuClock: 2745, minGpuClock: 2700, avgCpuClock: 4960, throttled: false, samples: [] },
];
const net = (): NetStatus => ({
  targets: [
    { host: "192.168.1.1", label: "Your router", ms: 1 + Math.round(Math.random()), avg: 1, jitter: 0.3, loss: 0 },
    { host: "1.1.1.1", label: "Internet (Cloudflare)", ms: 14 + Math.round(Math.random() * 3), avg: 15, jitter: 1.2, loss: 0 },
    { host: "162.249.72.1", label: "Cyberpunk 2077 server", ms: 31 + Math.round(Math.random() * 4), avg: 32, jitter: 2.1, loss: 0 },
  ],
  wifi: null,
  gameServers: ["162.249.72.1"],
});
const v12 = {
  listIncidents: async () => incidentsList,
  explainIncident: async () => (await wait(1200), "**Likely cause:** a game-specific bug in the DirectX driver module, not your hardware. Temps and power were normal."),
  onIncident: on("inc:new"),
  bootReport: async () => ({ boots: Array.from({ length: 14 }, (_, i) => ({ t: Date.now() - (14 - i) * 86400000, bootSec: +(17 + Math.sin(i) * 3 + (i > 9 ? 9 : 0)).toFixed(1), mainPathSec: 11, postBootSec: 6 })), slowItems: [{ name: "iCUE", kind: "App", delaySec: 6.2, t: Date.now() }, { name: "Armoury Crate Service", kind: "Service", delaySec: 3.8, t: Date.now() }, { name: "OneDrive", kind: "App", delaySec: 2.1, t: Date.now() }] }),
  healthTrends: async () => ({ weeks: Array.from({ length: 10 }, (_, i) => ({ week: new Date(Date.now() - (10 - i) * 7 * 86400000).toISOString().slice(0, 10), gpuTempAtLoad: 66 + (i > 6 ? 6 : 0) + (i % 2), cpuTempAtLoad: 70 + (i % 3), sessions: 4 + (i % 3) })), warning: "Your GPU now runs about 6°C hotter under the same load than a month or two ago. That usually means dust in the filters or heatsink, or drying thermal paste." }),
  driverImpact: async () => [{ game: "Cyberpunk 2077", exe: "Cyberpunk2077", rows: [{ driver: "572.83", sessions: 6, avgFps: 101, low1: 70 }, { driver: "591.44", sessions: 5, avgFps: 106, low1: 77 }], verdict: "1% lows are 10% higher since driver 591.44." }],
  stressStart: async () => (await wait(800), stressList[0]),
  stressStop: async () => {},
  stressList: async () => stressList,
  onStress: on("stress:state"),
  coachAsk: async () => (await wait(1200), "**Next step: 0.912 V @ 2715 MHz.** 0.900 V reset the driver after 142 s, so the stable floor is between 0.900 and 0.925 V. Try halfway, then run a 10-minute test. If it passes, finish with an hour of Cyberpunk."),
  displayReport: async () => ({ displays: [{ device: "\\\\.\\DISPLAY1", gpu: "NVIDIA GeForce RTX 4070 Ti SUPER", monitor: "LG ULTRAGEAR", width: 2560, height: 1440, hz: 60, maxHz: 165, rates: [60, 100, 120, 144, 165], maxWidth: 2560, maxHeight: 1440 }, { device: "\\\\.\\DISPLAY2", gpu: "NVIDIA GeForce RTX 4070 Ti SUPER", monitor: "Dell P2419H", width: 1920, height: 1080, hz: 60, maxHz: 60, rates: [60], maxWidth: 1920, maxHeight: 1080 }], vrrWindows: true, issues: [{ device: "\\\\.\\DISPLAY1", text: "LG ULTRAGEAR is running at 60 Hz but supports 165 Hz at this resolution.", fix: { hz: 165 } }] }),
  setRefresh: async () => ({ ok: true, message: "Set to 165 Hz" }),
  shaderInfo: async () => ({ caches: [{ name: "NVIDIA DirectX cache", path: "C:\\...\\DXCache", mb: 1840 }, { name: "Windows DirectX cache", path: "C:\\...\\D3DSCache", mb: 312 }], totalMb: 2152, autoClearOnDriverUpdate: true, lastCleared: Date.now() - 2 * 86400000 }),
  clearShaders: async () => ({ ok: true, message: "Cleared 2152 MB." }),
  gameAdvice: async () => (await wait(1500), "**Target: 237 FPS cap with Reflex On + Boost** (your 165 Hz LG, GPU-bound at 96%).\n\n#### Biggest wins\n- **Shadow quality:** High → Medium (+18 FPS, barely visible in matches)\n- **Ambient occlusion:** On → Off\n- **Boost player contrast:** keep On\n\n#### Outside the game\n- NVIDIA Low Latency Mode: On (Reflex overrides it in CS2)\n- Your monitor was at 60 Hz: fixed on the Tune page."),
  netStatus: async () => net(),
  onNet: (cb: (n: NetStatus) => void) => { const id = setInterval(() => cb(net()), 2000); return () => clearInterval(id); },
  energySummary: async () => ({ today: { kWh: 2.1, cost: 0.27 }, month: { kWh: 38.4, cost: 4.99 }, nowW: 446, rate: 0.13, days: Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${String(i + 1).padStart(2, "0")}`, kWh: +(1 + Math.abs(Math.sin(i)) * 2.4).toFixed(2), cost: 0.2 })) }),
  biosLookup: async () => (await wait(1500), { board: "Gigabyte Z390 AORUS ULTRA-CF", current: "F10", latest: "F12", latestDate: "2024-01-11", newer: true, notes: "- **F12** addresses UEFI image-parsing vulnerabilities (LogoFAIL).\n- **F11** adds Resizable BAR and capsule updates. **After F11 you can't go back to older versions.**", url: "https://www.gigabyte.com/Motherboard/Z390-AORUS-ULTRA-rev-10/support" }),
  securityState: async () => sec,
  onSecurity: on("sec:state"),
  securityCheck: async () => (await wait(800), sec),
  securitySweep: async () => (await wait(1500), sec),
  defenderScan: async () => (await wait(1500), { ok: true, message: "Scan finished. No active threats." }),
  defenderOffline: async () => ({ ok: true, message: "Windows will restart and scan." }),
  defenderUpdate: async () => (await wait(800), { ok: true, message: "Threat definitions updated." }),
  threatAction: async () => ({ ok: true, message: "Done." }),
  triageAlert: async () => (await wait(1200), "**Probably a phone or console joining Wi-Fi.** Check your router's device list for a matching address."),
  dismissAlert: async () => {},
  renameDevice: async () => {},
  blockApp: async () => ({ ok: true, message: "Blocked." }),
  listRules: async () => rules,
  addRule: async (text: string) => (await wait(1200), (rules = [{ id: String(Math.random()), enabled: true, text, summary: "When any game starts: lights to screen glow.", trigger: { type: "game_start" }, actions: [{ type: "light_mode", value: "screen" }], lastRun: null, between: null } as Rule, ...rules])),
  toggleRule: async (id: string, en: boolean) => (rules = rules.map((r) => (r.id === id ? { ...r, enabled: en } : r))),
  deleteRule: async (id: string) => (rules = rules.filter((r) => r.id !== id)),
  listCheckups: async () => checkups,
  runCheckup: async () => (await wait(1500), checkups[0]),
  listNotes: async () => notes,
  addNote: async (t: string) => (notes = [{ id: String(Math.random()), t: Date.now(), text: t }, ...notes]),
  deleteNote: async (id: string) => (notes = notes.filter((n) => n.id !== id)),
  listChanges: async () => changes,
  undoChange: async (id: string) => ((changes = changes.map((c) => (c.id === id ? { ...c, undone: true } : c))), { ok: true, message: "Undone." }),
  onChanges: on("changes:update"),
  getSnapshot: async () => null,
  listMatches: async () => matches,
  recapMatch: async () => (await wait(1000), matches[0].summary ?? ""),
  voiceAsk: async () => {},
  remotePairing: async () => ({ url: "http://192.168.1.42:7342/?t=demo", qr: null }),
  remoteReset: async () => ({ url: "http://192.168.1.42:7342/?t=new", qr: null }),
  saveRigCard: async () => ({ ok: true, message: "Saved to your Pictures folder." }),
  installGameLighting: async () => ({ ok: true, message: "Game lighting set up for CS2." }),
  getExtras: async () => extras,
  saveExtras: async (p: Partial<ExtrasSettings>) => (extras = { ...extras, ...p }),
  localAiStatus: async () => ({ installed: false, running: false, models: [], recommended: "qwen3:8b", vramGB: 16, pulling: null }),
  localAiSetup: async () => (await wait(1500), { ok: true, message: "Rigmind Local AI is ready (qwen3:8b)." }),
  onLocalAi: on("localai:status"),
  saveAimScore: async (mode: string, score: number, avgMs: number) => (extras = { ...extras, aim: { ...extras.aim, scores: [{ t: Date.now(), mode, score, avgMs }, ...extras.aim.scores] } }),
};

export const mockApi: RigmindApi = { ...base, ...v12 } as RigmindApi;
