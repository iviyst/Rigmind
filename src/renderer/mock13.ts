// Sample data for the 1.3 pages, so the UI can be previewed in a browser.
import type { Api13, AppBoostState, BrowserGuardState, DirNode, MeetingState, MemoryView, ModeState, PrinterInfo, ReadyReport, ReadyState, SpaceHog, ThreatScanState } from "../shared/types";

const H = 3600_000;
const now = Date.now();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (message: string) => async () => (await wait(400), { ok: true, message });
const noop = () => () => {};

const params = new URLSearchParams(location.search);
let mode: ModeState = { mode: (params.get("mode") as any) || "both", chosenAt: "installer", active: params.get("call") ? "call" : "normal", detail: params.get("call") ? "Teams call" : null, override: null, pcType: params.get("laptop") ? "laptop" : "desktop", managed: false };

const lastRun: ReadyReport = {
  id: "r1",
  start: now - 7 * H,
  end: now - 7 * H + 94 * 60_000,
  trigger: "night",
  dryRun: false,
  stages: [
    { id: "preflight", label: "Preflight", status: "done", note: "Screen off, sound muted, lights off." },
    { id: "games", label: "Game updates", status: "done", note: "3 of 3 game(s) updated." },
    { id: "apps", label: "App updates", status: "done", note: "4 app(s) updated, 1 skipped because it was open." },
    { id: "system", label: "Windows and driver updates", status: "done", note: "Installed 2 Windows update(s). Installed GPU driver 591.44" },
    { id: "warmup", label: "Shader warm-up", status: "done", note: "3 of 4 game(s) warmed." },
    { id: "maintenance", label: "Maintenance", status: "done", note: "Defender quick scan done. Freed 1240 MB of temp files. SSD TRIM done" },
    { id: "backup", label: "Backup check", status: "done", note: "OneDrive folder backup: your Desktop and Documents are backed up as you work." },
    { id: "prewarm", label: "Pre-warm", status: "skipped", note: "Turned off" },
    { id: "restore", label: "Restore and sleep", status: "done", note: "Settings restored. Going back to sleep." },
  ],
  gamesUpdated: ["Cyberpunk 2077", "Counter-Strike 2", "Helldivers 2"],
  appsUpdated: ["Google Chrome", "Zoom Workplace", "7-Zip", "Notepad++"],
  warmed: [
    { appId: "1091500", game: "Cyberpunk 2077", seconds: 412, cacheMB: 1380, outcome: "warmed" },
    { appId: "553850", game: "Helldivers 2", seconds: 286, cacheMB: 910, outcome: "warmed" },
    { appId: "730", game: "Counter-Strike 2", seconds: 151, cacheMB: 240, outcome: "warmed" },
    { appId: "1172470", game: "Apex Legends", seconds: 210, cacheMB: 0, outcome: "needs_you" },
  ],
  downloadedGB: 18.6,
  minutesSaved: 42,
  restartNeeded: false,
  needsYou: ["Apex Legends needs you: it stopped at a sign-in or prompt. Open it once, then Rigmind can warm it again."],
  backup: { kind: "OneDrive folder backup", lastRun: null, level: "good", detail: "Backed up as you work." },
  stoppedBy: null,
  log: ["3:00:12 AM 3 games need updates (18.6 GB): Cyberpunk 2077, Counter-Strike 2, Helldivers 2.", "3:01:02 AM Started Steam in the background.", "3:41:55 AM Created a System Restore point.", "4:12:30 AM Cyberpunk 2077: warmed in 412 s, shader cache +1380 MB."],
};

let ready: ReadyState = {
  running: false,
  current: null,
  last: lastRun,
  history: [{ id: "r1", start: lastRun.start, minutesSaved: 42, dryRun: false }],
  settings: { enabled: true, dryRunDone: true, from: "03:00", to: "06:00", weekdaysOnly: false, gameUpdates: true, appUpdates: true, warmup: "top5", windowsUpdates: true, gpuDriver: "download", restarts: "safe", prewarm: false, fanCapPct: 55, downloadCapGB: 0, phoneReport: true, gpuLimitC: 83, cpuLimitC: 90, alwaysWarm: [], neverTouch: [] },
  scheduled: true,
  wakeIssues: [],
  topGames: [
    { appId: "1091500", name: "Cyberpunk 2077", score: 41.2, warm: true },
    { appId: "730", name: "Counter-Strike 2", score: 38.5, warm: true },
    { appId: "553850", name: "Helldivers 2", score: 22.1, warm: true },
    { appId: "1172470", name: "Apex Legends", score: 9.4, warm: true },
    { appId: "1245620", name: "Elden Ring", score: 3.2, warm: true },
    { appId: "570", name: "Dota 2", score: 0.6, warm: false },
  ],
  weekMinutesSaved: 137,
};

let appBoost: AppBoostState = {
  enabled: true,
  active: params.get("job") ? { app: "Premiere Pro", exe: "adobe premiere pro", since: now - 4 * 60_000, paused: ["OneDrive", "Dropbox"] } : null,
  jobs: [
    { id: "j1", app: "Premiere Pro", exe: "adobe premiere pro", start: now - 3 * H, end: now - 3 * H + 372_000, seconds: 372, vsAvgPct: -18 },
    { id: "j2", app: "Excel", exe: "excel", start: now - 26 * H, end: now - 26 * H + 41_000, seconds: 41, vsAvgPct: 6 },
    { id: "j3", app: "MSBuild", exe: "msbuild", start: now - 30 * H, end: now - 30 * H + 128_000, seconds: 128, vsAvgPct: 34 },
    { id: "j4", app: "ArcGIS Pro", exe: "arcgispro", start: now - 50 * H, end: now - 50 * H + 905_000, seconds: 905, vsAvgPct: null },
  ],
  apps: [
    { exe: "adobe premiere pro", name: "Premiere Pro", kind: "video" },
    { exe: "resolve", name: "DaVinci Resolve", kind: "video" },
    { exe: "blender", name: "Blender", kind: "3d" },
    { exe: "acad", name: "AutoCAD", kind: "3d" },
    { exe: "msbuild", name: "MSBuild", kind: "code" },
    { exe: "devenv", name: "Visual Studio", kind: "code" },
    { exe: "excel", name: "Excel", kind: "office" },
    { exe: "arcgispro", name: "ArcGIS Pro", kind: "gis" },
    { exe: "qgis-bin", name: "QGIS", kind: "gis" },
  ],
};

let meeting: MeetingState = {
  enabled: true,
  inCall: !!params.get("call"),
  app: params.get("call") ? "Teams" : null,
  since: now - 18 * 60_000,
  paused: ["OneDrive"],
  health: { level: "warn", message: "Wi-Fi signal is weak. Plug in Ethernet or move closer to the router.", jitterMs: 12, lossPct: 0, wifiSignal: 44, cpu: 31 },
  dnd: true,
};

let browser: BrowserGuardState = {
  scannedAt: now - 20 * 60_000,
  scanning: false,
  managedPc: false,
  extensions: [
    { key: "Chrome|Default|abc", id: "kjhgfdsapoiuytrewqlkjhgfdsamnbvc", name: "PDF Converter Pro", version: "3.1.4", browser: "Chrome", profile: "Default", permissions: ["<all_urls>", "cookies", "webRequest", "nativeMessaging"], fromStore: false, forced: true, enabled: true, score: 135, level: "risky", reasons: ["Can read and change every website you visit, including email and banking.", "Can read your cookies or see and change your web traffic.", "Can talk to programs installed on your PC.", "Was force-installed by a policy, but this PC isn't managed by a company. This is a common malware trick."], knownBad: false, blocked: false, newPermissions: [] },
    { key: "Edge|Default|def", id: "lmnopqrstuvwxyzabcdefghijklmnopa", name: "Coupon Helper", version: "8.0.2", browser: "Edge", profile: "Default", permissions: ["<all_urls>", "tabs", "storage"], fromStore: true, forced: false, enabled: true, score: 45, level: "review", reasons: ["Can read and change every website you visit, including email and banking.", "Asked for new permissions in its last update: <all_urls>."], knownBad: false, blocked: false, newPermissions: ["<all_urls>"] },
    { key: "Chrome|Default|ghi", id: "cjpalhdlnbpafiamejdnhcphjbkeiagm", name: "uBlock Origin", version: "1.60.0", browser: "Chrome", profile: "Default", permissions: ["<all_urls>", "storage", "webRequest"], fromStore: true, forced: false, enabled: true, score: 45, level: "review", reasons: ["Can read and change every website you visit, including email and banking.", "Can read your cookies or see and change your web traffic."], knownBad: false, blocked: false, newPermissions: [] },
    { key: "Firefox|default|jkl", id: "addon@darkreader.org", name: "Dark Reader", version: "4.9.9", browser: "Firefox", profile: "default-release", permissions: ["storage"], fromStore: true, forced: false, enabled: true, score: 0, level: "ok", reasons: [], knownBad: false, blocked: false, newPermissions: [] },
  ],
  hijacks: [{ id: "proxy|AutoConfigURL", kind: "proxy", title: "A proxy script controls where your web traffic goes", detail: "Script: http://198.51.100.7/proxy.pac. Malware often uses this to reroute browsing.", fixable: true }],
};

let threats: ThreatScanState = {
  products: [{ name: "Windows Defender", enabled: true, upToDate: true, isDefender: true }],
  intel: { version: "202611160417", builtAt: now - 3 * H, checkedAt: now - 1 * H, counts: { hashes: 184392, extensions: 37, domains: 21877 }, stale: false, error: null, clam: { installed: false, path: null, dbUpdated: null } },
  scanning: false,
  lastScan: now - 2 * H,
  scanned: 3412,
  findings: [{ id: "f1", path: "C:\\Users\\Chris\\Downloads\\free-fps-booster-setup.exe", sha256: "9f".repeat(32), threat: "RedLineStealer", source: "threat list", found: now - 2 * H, status: "found", av: null }],
};

const dir = (name: string, bytes: number, children?: DirNode[]): DirNode => ({ name, path: `C:\\${name}`, bytes, files: Math.round(bytes / 2_000_000), children });
const GB = 1024 ** 3;
const root: DirNode = dir("C:\\", 812 * GB, [
  dir("Program Files (x86)", 318 * GB, [dir("Steam", 301 * GB, [dir("steamapps", 300 * GB, [dir("common", 296 * GB, [dir("Call of Duty", 141 * GB), dir("Cyberpunk 2077", 72 * GB), dir("Helldivers 2", 44 * GB), dir("Counter-Strike Global Offensive", 33 * GB), dir("Apex Legends", 6 * GB)])])]), dir("Microsoft", 9 * GB), dir("Epic Games", 8 * GB)]),
  dir("Users", 201 * GB, [dir("Chris", 199 * GB, [dir("Videos", 88 * GB), dir("AppData", 61 * GB), dir("Downloads", 34 * GB), dir("Documents", 12 * GB), dir("Pictures", 4 * GB)])]),
  dir("Windows", 41 * GB, [dir("WinSxS", 14 * GB), dir("System32", 9 * GB), dir("SoftwareDistribution", 6 * GB), dir("Installer", 5 * GB), dir("Temp", 2 * GB)]),
  dir("Program Files", 112 * GB, [dir("NVIDIA Corporation", 3 * GB), dir("Adobe", 21 * GB), dir("Docker", 6 * GB), dir("Ollama", 18 * GB), dir("WindowsApps", 52 * GB)]),
  dir("hiberfil.sys", 25 * GB),
  dir("pagefile.sys", 19 * GB),
  dir("ProgramData", 11 * GB, [dir("NVIDIA", 2 * GB), dir("Microsoft", 7 * GB)]),
  dir("Windows.old", 22 * GB, [dir("Windows", 18 * GB), dir("Users", 4 * GB)]),
]);

const hogs: SpaceHog[] = [
  { id: "game-1172470", label: "Apex Legends (not played in 214 days)", bytes: 74 * GB, detail: "Uninstalled through Steam, so your saves and cloud data stay safe. You can reinstall any time.", fix: "Uninstall in Steam", needsPreview: false },
  { id: "winold", label: "Previous Windows installation (Windows.old)", bytes: 22 * GB, detail: "Kept after a Windows upgrade so you can go back. Disk Cleanup can remove it sooner.", fix: "Open Disk Cleanup", needsPreview: false },
  { id: "olddownloads", label: "Large old downloads", bytes: 14.2 * GB, detail: "Files over 200 MB in Downloads that haven't changed in 60 days. Pick what to remove; they go to the Recycle Bin.", fix: "Review", needsPreview: true },
  { id: "gpudrivers", label: "Old GPU driver packages and installer leftovers", bytes: 6.8 * GB, detail: "Copies of graphics drivers you've already replaced. Rigmind keeps your current driver and the one before it.", fix: "Remove old copies", needsPreview: true },
  { id: "winupdate", label: "Old Windows Update files", bytes: 5.1 * GB, detail: "Downloaded update files Windows no longer needs.", fix: "Clean up", needsPreview: false },
  { id: "browser-chrome", label: "Chrome cache", bytes: 2.4 * GB, detail: "Saved copies of web pages and images. Close Chrome first.", fix: "Clear", needsPreview: false },
  { id: "dev-npm", label: "npm cache", bytes: 1.9 * GB, detail: "Downloaded packages your build tools can fetch again when needed.", fix: "Clean", needsPreview: false },
];

const mem: MemoryView = {
  totalMB: 32682,
  inUseMB: 19840,
  compressedMB: 1210,
  standbyMB: 9100,
  freeMB: 1742,
  apps: [
    { app: "Chrome", memMB: 6830, procs: 41, growthMB: 380, leak: false, history: [] },
    { app: "Teams", memMB: 3240, procs: 6, growthMB: 2610, leak: true, history: [] },
    { app: "WSL / Docker", memMB: 2980, procs: 1, growthMB: 0, leak: false, history: [] },
    { app: "Excel", memMB: 1420, procs: 1, growthMB: 120, leak: false, history: [] },
    { app: "VS Code", memMB: 1310, procs: 14, growthMB: 60, leak: false, history: [] },
    { app: "Discord", memMB: 690, procs: 5, growthMB: null, leak: false, history: [] },
    { app: "Steam", memMB: 512, procs: 9, growthMB: null, leak: false, history: [] },
  ],
  startup: [
    { id: "HKCU|Run|Discord", name: "Discord", command: "C:\\Users\\Chris\\AppData\\Local\\Discord\\Update.exe --processStart Discord.exe", location: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", enabled: true, publisher: "Discord Inc." },
    { id: "HKCU|Run|Steam", name: "Steam", command: "\"C:\\Program Files (x86)\\Steam\\steam.exe\" -silent", location: "HKCU\\...\\Run", enabled: true, publisher: "Valve" },
    { id: "HKLM|Run|AdobeGCInvoker", name: "AdobeGCInvoker-1.0", command: "\"C:\\Program Files (x86)\\Common Files\\Adobe\\AdobeGCClient\\AGCInvokerUtility.exe\"", location: "HKLM\\...\\Run", enabled: false, publisher: "Adobe Inc." },
  ],
};

const printers: PrinterInfo[] = [
  { key: "installed|Office LaserJet", name: "Office LaserJet", installed: true, status: "Offline", isDefault: true, host: "192.168.1.31", port: "IP_192.168.1.31", model: "HP LaserJet Pro M404dn", location: "Front office, by the copier", color: false, ippUrl: null, adminUrl: "http://192.168.1.44", jobs: 2, managedByIt: false, problem: "The printer moved to 192.168.1.44, but Windows still looks for it at 192.168.1.31." },
  { key: "installed|Brother MFC", name: "Brother MFC-L3770CDW", installed: true, status: "Ready", isDefault: false, host: "192.168.1.52", port: "WSD-1", model: "Brother MFC-L3770CDW series", location: "Shop", color: true, ippUrl: null, adminUrl: "http://192.168.1.52", jobs: 0, managedByIt: false, problem: null },
  { key: "net|epson", name: "EPSON ET-4850 Series", installed: false, status: "On the network", isDefault: false, host: "EPSON4F2A1C.local", port: null, model: "EPSON ET-4850 Series", location: "Upstairs office", color: true, ippUrl: "http://EPSON4F2A1C.local:631/ipp/print", adminUrl: "http://EPSON4F2A1C.local", jobs: 0, managedByIt: false, problem: null },
  { key: "net|canon", name: "Canon TS6400 series", installed: false, status: "On the network", isDefault: false, host: "Canon-TS6400.local", port: null, model: "Canon TS6400 series", location: null, color: true, ippUrl: "http://Canon-TS6400.local:631/ipp/print", adminUrl: null, jobs: 0, managedByIt: false, problem: null },
];

export const mock13: Api13 = {
  getMode: async () => mode,
  setMode: async (m) => (mode = { ...mode, mode: m, chosenAt: "app" }),
  setProfileOverride: async (p) => (mode = { ...mode, override: p }),
  onMode: noop,
  readyState: async () => ready,
  readySave: async (p) => (ready = { ...ready, settings: { ...ready.settings, ...p } }),
  readyRunNow: ok("Ready is running."),
  readyCancel: ok("Stopping."),
  readyTestWake: ok("Put the PC to sleep now. It should wake at 3:27, and Rigmind will say \"Wake test worked\"."),
  onReady: noop,
  appBoostState: async () => appBoost,
  appBoostSave: async (p) => (appBoost = { ...appBoost, enabled: p.enabled ?? appBoost.enabled }),
  onAppBoost: noop,
  meetingState: async () => meeting,
  meetingSave: async (p) => (meeting = { ...meeting, ...p }),
  meetingCheck: async () => (await wait(600), { mic: "Headset Microphone (Jabra Evolve2 65)", speakers: "Headphones (Jabra Evolve2 65)", camera: true, net: "23 ms ping, 3.1 ms jitter, 0% loss, Wi-Fi 44%" }),
  onMeeting: noop,
  browserState: async () => browser,
  browserScan: async () => (await wait(900), browser),
  browserBlock: ok("PDF Converter Pro is blocked."),
  browserOpen: ok("Opened Chrome. Paste into the address bar (Ctrl+V), then click Remove."),
  browserFix: ok("Fixed. Undo any time in Settings > Change history."),
  threatState: async () => threats,
  threatScan: ok("Checked 3,412 files. Nothing new."),
  threatAct: ok("Windows Defender removed it."),
  intelUpdate: ok("Threat list updated: 184,392 known malware files."),
  onThreats: noop,
  disks: async () => [
    { drive: "C:", label: "Windows", totalBytes: 931 * GB, freeBytes: 119 * GB },
    { drive: "D:", label: "Games", totalBytes: 1863 * GB, freeBytes: 642 * GB },
  ],
  diskScan: async (drive) => (await wait(1200), { drive, scannedAt: Date.now(), seconds: 9.4, root, bigFiles: [{ path: "C:\\hiberfil.sys", bytes: 25 * GB, modified: now - 2 * H }, { path: "C:\\Users\\Chris\\Videos\\2026-10 site walkthrough raw.mp4", bytes: 18.4 * GB, modified: now - 40 * 24 * H }, { path: "C:\\Users\\Chris\\Downloads\\Win11_24H2_English_x64.iso", bytes: 5.8 * GB, modified: now - 210 * 24 * H }] }),
  onDiskProgress: noop,
  spaceHogs: async () => (await wait(800), hogs),
  spacePreview: async (id) => ({ hogId: id, items: [{ path: "C:\\Users\\Chris\\Downloads\\Win11_24H2_English_x64.iso", bytes: 5.8 * GB }, { path: "C:\\Users\\Chris\\Downloads\\ArcGISPro_33_Setup.exe", bytes: 3.1 * GB }, { path: "C:\\Users\\Chris\\Downloads\\old-site-photos.zip", bytes: 2.6 * GB }], totalBytes: 11.5 * GB }),
  spaceClean: ok("Freed 5.1 GB."),
  openPath: async () => {},
  memoryView: async () => mem,
  memoryAct: ok("Restarted Teams."),
  startupToggle: ok("Discord will no longer start with Windows."),
  printers: async () => (await wait(500), printers),
  printerAdd: ok("EPSON ET-4850 Series is added."),
  printerIdentify: ok("Sent a page to Brother MFC-L3770CDW. Its name is printed in big letters."),
  printerFix: ok("Office LaserJet now prints to 192.168.1.44."),
  whySlow: async () => (await wait(900), { t: Date.now(), verdict: "Found 3 things slowing your PC down", causes: [
    { title: "OneDrive is syncing", detail: "It's using 9% CPU while the disk moves 84 MB/s.", fix: { label: "Pause sync for 1 hour", action: "pause-sync" } },
    { title: "Chrome is using 6.7 GB of memory", detail: "Across about 41 processes (roughly one per tab and extension). Its memory saver puts unused tabs to sleep.", fix: { label: "Open memory saver", action: "browser-memory", target: "chrome" } },
    { title: "WSL or Docker is holding 2.9 GB", detail: "Linux and container tools keep memory until they're shut down. A memory cap stops this.", fix: { label: "Set a memory cap", action: "open-dev" } },
  ] }),
  whySlowFix: ok("Sync paused for an hour."),
  hangPatterns: async () => [
    { app: "EXCEL.EXE", count: 4, lastAt: now - 5 * H, pattern: "EXCEL.EXE froze 4 times, usually while cloud sync was busy." },
    { app: "Teams.exe", count: 1, lastAt: now - 40 * H, pattern: null },
  ],
  battery: async () => ({ present: true, designWh: 99.9, fullWh: 86.1, wearPct: 14, cycles: 212, vendorTool: { name: "Lenovo Vantage", hint: "Open Lenovo Vantage > Power > Charge threshold (or Conservation mode) to stop charging at 80%." } }),
  backupStatus: async () => ({ kind: "OneDrive folder backup", lastRun: null, level: "good", detail: "Your Desktop and Documents live in OneDrive and OneDrive is running, so they're backed up as you work." }),
  devInfo: async () => ({ wsl: { installed: true, capGB: null, usingMB: 2980 }, docker: true, caches: [{ name: "npm cache", path: "C:\\Users\\Chris\\AppData\\Local\\npm-cache", bytes: 1.9 * GB }, { name: "NuGet packages", path: "C:\\Users\\Chris\\.nuget\\packages", bytes: 3.4 * GB }] }),
  devAct: ok("WSL is capped at 8 GB."),
  portOwners: async () => [{ port: 3000, protocol: "TCP", process: "node", pid: 18220 }, { port: 5173, protocol: "TCP", process: "node", pid: 20112 }, { port: 8090, protocol: "TCP", process: "pocketbase", pid: 9984 }],
};
