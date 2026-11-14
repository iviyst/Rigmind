// Persistent settings stored as JSON in the user's app-data folder.
import { app, safeStorage } from "electron";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Settings, BoostSettings, FanSettings, RgbSettings, GameProfile, ExtrasSettings } from "../shared/types";
import { randomBytes } from "node:crypto";

interface Stored {
  apiKeyEnc: string | null;
  model: string;
  aiProvider: "claude" | "local";
  localModel: string;
  startWithWindows: boolean;
  presentMonPath: string;
  boost: BoostSettings;
  driverCheckHours: number;
  pendingResume: { pid: number; name: string }[]; // crash-safety for paused apps
  savedPowerScheme: string | null;
  fans: FanSettings;
  rgb: RgbSettings;
  profiles: Record<string, GameProfile>; // key = exe name, lower case
  extras: ExtrasSettings;
  lastGpuDriver: string | null;
}

const defaults: Stored = {
  apiKeyEnc: null,
  model: "claude-sonnet-5-5",
  aiProvider: "claude",
  localModel: "",
  startWithWindows: false,
  presentMonPath: "",
  driverCheckHours: 24,
  pendingResume: [],
  savedPowerScheme: null,
  fans: { enabled: false, riskAccepted: false, desktopProfile: "quiet", gameProfile: "balanced", preRamp: true, controls: {} },
  rgb: {
    enabled: false,
    mode: "status",
    color: "#2f95db",
    brightness: 80,
    alerts: true,
    gameScenes: true,
    schedule: { enabled: false, from: "23:00", to: "07:00" },
    idleOffMin: 15,
    openRgbPath: "",
  },
  profiles: {},
  lastGpuDriver: null,
  extras: {
    holdWindowsUpdate: true,
    autoClearShaders: true,
    snapshots: false,
    energyRate: 0.13,
    baselineWatts: 60,
    voice: { enabled: false, hotkey: "CommandOrControl+Shift+Space", speak: true },
    remote: { enabled: false, port: 7342, token: "", allowControl: false },
    discord: { enabled: false, appId: "" },
    gameLighting: true,
    checkup: { enabled: true, hour: 10 },
    anomalyAlerts: true,
    autopilot: false,
    rigLayout: {},
    security: { watch: true, alertNewDevices: true, alertNewListeners: true },
    playstyle: "",
    aim: { dpi: 800, scores: [] },
  },
  boost: {
    enabled: true,
    raisePriority: true,
    highPerformancePower: true,
    pauseBackground: true,
    suspendList: ["OneDrive", "GoogleDriveFS", "Dropbox", "AdobeUpdateService", "SearchApp"],
    overlay: true,
    overlayCorner: "top-left",
    sessionReports: true,
    autoAnalyze: true,
    customGames: [],
    ignoredExes: [],
  },
};

const dir = () => app.getPath("userData");
const file = () => join(dir(), "settings.json");
let cache: Stored | null = null;

export function load(): Stored {
  if (cache) return cache;
  try {
    if (existsSync(file())) {
      const raw = JSON.parse(readFileSync(file(), "utf8"));
      cache = {
        ...defaults,
        ...raw,
        boost: { ...defaults.boost, ...(raw.boost ?? {}) },
        fans: { ...defaults.fans, ...(raw.fans ?? {}) },
        rgb: { ...defaults.rgb, ...(raw.rgb ?? {}), schedule: { ...defaults.rgb.schedule, ...(raw.rgb?.schedule ?? {}) } },
        profiles: raw.profiles ?? {},
        extras: { ...defaults.extras, ...(raw.extras ?? {}) },
      };
    }
  } catch {
    /* fall through to defaults */
  }
  cache ??= structuredClone(defaults);
  // The phone remote needs a random secret; make one the first time.
  if (!cache!.extras.remote.token) cache!.extras.remote.token = randomBytes(18).toString("base64url");
  return cache!;
}

export function save(patch: Partial<Stored>): Stored {
  const cur = load();
  cache = {
    ...cur,
    ...patch,
    boost: { ...cur.boost, ...(patch.boost ?? {}) },
    fans: { ...cur.fans, ...(patch.fans ?? {}) },
    rgb: { ...cur.rgb, ...(patch.rgb ?? {}) },
    extras: { ...cur.extras, ...(patch.extras ?? {}) },
  };
  mkdirSync(dir(), { recursive: true });
  writeFileSync(file(), JSON.stringify(cache, null, 2));
  return cache;
}

export function publicSettings(): Settings {
  const s = load();
  return {
    model: s.model,
    hasApiKey: !!s.apiKeyEnc,
    aiProvider: s.aiProvider,
    localModel: s.localModel,
    aiReady: s.aiProvider === "local" ? !!s.localModel : !!s.apiKeyEnc,
    startWithWindows: s.startWithWindows,
    presentMonPath: s.presentMonPath,
    boost: s.boost,
    driverCheckHours: s.driverCheckHours,
  };
}

export function setApiKey(key: string) {
  const trimmed = key.trim();
  if (!trimmed) return save({ apiKeyEnc: null });
  // Encrypted with Windows DPAPI (tied to this Windows account). Never stored in plain text.
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows encryption isn't available, so the key wasn't saved.");
  if (!/^sk-ant-[\w-]{20,}$/.test(trimmed)) throw new Error("That doesn't look like an Anthropic API key (it should start with sk-ant-).");
  return save({ apiKeyEnc: "enc:" + safeStorage.encryptString(trimmed).toString("base64") });
}

export function getApiKey(): string | null {
  const v = load().apiKeyEnc;
  if (!v) return null;
  if (!v.startsWith("enc:")) return null; // ignore anything that isn't encrypted
  try {
    return safeStorage.decryptString(Buffer.from(v.slice(4), "base64"));
  } catch {
    return null; // encrypted under a different Windows account
  }
}

export const dataDir = (sub: string) => {
  const p = join(dir(), sub);
  mkdirSync(p, { recursive: true });
  return p;
};

/** Is the chosen AI engine (Claude or Rigmind Local AI) set up? */
export function aiReady(): boolean {
  const s = load();
  return s.aiProvider === "local" ? !!s.localModel : !!s.apiKeyEnc;
}
