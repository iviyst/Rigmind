// Tuning tools: Display Doctor, shader caches, Defender exclusions, game config files,
// and holding Windows Update while you play.
import { existsSync, readdirSync, statSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { hw } from "./hw";
import { runPs, psq } from "./ps";
import { load, save } from "./store";
import { history } from "./history";
import { getSystemInfo } from "./winsys";
import type { ChangeEntry, DisplayReport, GameConfigInfo, ShaderCacheInfo } from "../shared/types";

const local = () => process.env.LOCALAPPDATA ?? "";
const appdata = () => process.env.APPDATA ?? "";

// ---------------- Display Doctor ----------------
export async function displayReport(): Promise<DisplayReport> {
  const displays = await hw.displays();
  const vrrOut = await runPs(`(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences' -ErrorAction SilentlyContinue).DirectXUserGlobalSettings`).catch(() => "");
  const vrrWindows = vrrOut.trim() ? /VRROptimizeEnable=1/.test(vrrOut) : null;
  const issues: DisplayReport["issues"] = [];
  for (const d of displays) {
    const name = d.monitor || d.device;
    if (d.maxHz > d.hz + 5) issues.push({ device: d.device, text: `${name} is running at ${d.hz} Hz but supports ${d.maxHz} Hz at this resolution.`, fix: { hz: d.maxHz } });
    if (d.maxWidth * d.maxHeight > d.width * d.height * 1.2) issues.push({ device: d.device, text: `${name} is set to ${d.width}×${d.height}, below its ${d.maxWidth}×${d.maxHeight} maximum. Text and games will look softer.` });
  }
  return { displays, vrrWindows, issues };
}

export async function setRefresh(device: string, hz: number, source: ChangeEntry["source"]): Promise<{ ok: boolean; message: string }> {
  const before = (await hw.displays()).find((d) => d.device === device);
  const r = await hw.setRefresh(device, hz);
  if (!r) return { ok: false, message: "The hardware helper isn't running." };
  if (r.ok && before) history.record(`Set ${before.monitor || device} to ${hz} Hz (was ${before.hz} Hz)`, source, { type: "refresh", data: { device, hz: before.hz } });
  return { ok: r.ok, message: r.msg };
}
history.registerUndo("refresh", async (d) => {
  const r = await hw.setRefresh(d.device, d.hz);
  if (!r?.ok) throw new Error(r?.msg ?? "Couldn't change the refresh rate back.");
  return `Back to ${d.hz} Hz`;
});

// ---------------- Shader caches ----------------
function dirSizeMb(dir: string, depth = 4): number {
  let bytes = 0;
  const walk = (d: string, n: number) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      try {
        if (e.isFile()) bytes += statSync(p).size;
        else if (e.isDirectory() && n > 0) walk(p, n - 1);
      } catch {
        /* skip */
      }
    }
  };
  walk(dir, depth);
  return Math.round(bytes / 1048576);
}

function cacheDirs(): { name: string; path: string }[] {
  const L = local();
  return [
    { name: "NVIDIA DirectX cache", path: join(L, "NVIDIA", "DXCache") },
    { name: "NVIDIA OpenGL cache", path: join(L, "NVIDIA", "GLCache") },
    { name: "NVIDIA compute cache", path: join(appdata(), "NVIDIA", "ComputeCache") },
    { name: "AMD DirectX cache", path: join(L, "AMD", "DxCache") },
    { name: "AMD DirectX 12 cache", path: join(L, "AMD", "DxcCache") },
    { name: "AMD Vulkan cache", path: join(L, "AMD", "VkCache") },
    { name: "Intel shader cache", path: join(L, "Intel", "ShaderCache") },
    { name: "Windows DirectX cache", path: join(L, "D3DSCache") },
  ].filter((c) => existsSync(c.path));
}

export function shaderCacheInfo(): ShaderCacheInfo {
  const caches = cacheDirs().map((c) => ({ ...c, mb: dirSizeMb(c.path) }));
  const s = load();
  return { caches, totalMb: caches.reduce((a, c) => a + c.mb, 0), autoClearOnDriverUpdate: s.extras.autoClearShaders, lastCleared: (s as any).shaderLastCleared ?? null };
}

export function clearShaderCaches(source: ChangeEntry["source"]): { ok: boolean; message: string } {
  let freed = 0;
  for (const c of cacheDirs()) {
    const before = dirSizeMb(c.path);
    for (const e of readdirSync(c.path)) {
      try {
        rmSync(join(c.path, e), { recursive: true, force: true });
      } catch {
        /* in use by a running game or the driver: skip */
      }
    }
    freed += before - dirSizeMb(c.path);
  }
  save({ ...({ shaderLastCleared: Date.now() } as any) });
  history.record(`Cleared ${freed} MB of GPU shader caches`, source, null);
  return { ok: true, message: `Cleared ${freed} MB. Games will rebuild their shaders over the next few launches, so expect some hitches the first time.` };
}

/** Called at startup: if the GPU driver changed, old shader caches can cause stutter. */
export async function checkDriverChange(): Promise<string | null> {
  const info = await getSystemInfo(true).catch(() => null);
  const driver = info?.gpus.find((g) => !/Microsoft|Virtual|Parsec/i.test(g))?.match(/driver (\S+)/)?.[1] ?? null;
  if (!driver) return null;
  const prev = load().lastGpuDriver;
  save({ lastGpuDriver: driver });
  if (prev && prev !== driver && load().extras.autoClearShaders) {
    clearShaderCaches("autopilot");
    return driver;
  }
  return null;
}

export function currentDriver(): string | null {
  return load().lastGpuDriver;
}

// ---------------- Defender exclusions ----------------
export async function addDefenderExclusion(path: string, source: ChangeEntry["source"]): Promise<{ ok: boolean; message: string }> {
  if (!path || !existsSync(path)) return { ok: false, message: "Game folder not found." };
  if (/^[A-Z]:\\?$/i.test(path) || /\\Windows(\\|$)/i.test(path) || /\\Users\\[^\\]+\\?$/i.test(path))
    return { ok: false, message: "Rigmind only excludes game folders, never whole drives, Windows, or your user folder." };
  await runPs(`Add-MpPreference -ExclusionPath ${psq(path)}`);
  history.record(`Excluded ${path} from Defender real-time scanning`, source, { type: "defender_exclusion", data: { path } });
  return { ok: true, message: "Defender will skip this game folder during real-time scans. Downloads and other folders are still protected." };
}
history.registerUndo("defender_exclusion", async (d) => {
  await runPs(`Remove-MpPreference -ExclusionPath ${psq(d.path)}`);
  return "Defender scans that folder again.";
});

// ---------------- Game config files (for the settings advisor) ----------------
async function steamLibraries(): Promise<string[]> {
  const steam = (await runPs(`(Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' -ErrorAction SilentlyContinue).SteamPath`).catch(() => "")).trim();
  if (!steam) return [];
  const libs = [steam.replace(/\//g, "\\")];
  try {
    const vdf = readFileSync(join(steam, "steamapps", "libraryfolders.vdf"), "utf8");
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(m[1].replace(/\\\\/g, "\\"));
  } catch {
    /* ignore */
  }
  return [...new Set(libs)];
}

function newest(paths: string[]): string | null {
  const found = paths.filter(existsSync).map((p) => ({ p, t: statSync(p).mtimeMs }));
  return found.sort((a, b) => b.t - a.t)[0]?.p ?? null;
}

function findUnder(root: string, re: RegExp, depth: number): string[] {
  const out: string[] = [];
  const walk = (d: string, n: number) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isFile() && re.test(p)) out.push(p);
      else if (e.isDirectory() && n > 0) walk(p, n - 1);
    }
  };
  walk(root, depth);
  return out;
}

export async function findGameConfig(exe: string, name: string): Promise<GameConfigInfo | null> {
  const L = local();
  const key = (exe + " " + name).toLowerCase();
  let path: string | null = null;
  if (key.includes("cs2") || key.includes("counter-strike")) {
    for (const lib of await steamLibraries()) {
      const ud = join(dirname(join(lib, "x")), "userdata");
      path = newest(findUnder(ud, /\\730\\local\\cfg\\cs2_video\.txt$/i, 4));
      if (path) break;
    }
  } else if (key.includes("fortnite")) path = newest([join(L, "FortniteGame", "Saved", "Config", "WindowsClient", "GameUserSettings.ini")]);
  else if (key.includes("valorant")) path = newest(findUnder(join(L, "VALORANT", "Saved", "Config"), /GameUserSettings\.ini$/i, 3));
  else if (key.includes("cyberpunk")) path = newest([join(L, "CD Projekt Red", "Cyberpunk 2077", "UserSettings.json")]);
  else if (key.includes("minecraft")) path = newest([join(appdata(), ".minecraft", "options.txt")]);
  else if (key.includes("roblox")) path = newest(findUnder(join(L, "Roblox"), /GlobalBasicSettings_\d+\.xml$/i, 1));
  if (!path) {
    // Most Unreal Engine games keep settings in %LOCALAPPDATA%\<Game>\Saved\Config\Windows*\GameUserSettings.ini
    const short = name.replace(/[^a-z0-9]/gi, "").toLowerCase();
    try {
      for (const dir of readdirSync(L)) {
        const d = dir.replace(/[^a-z0-9]/gi, "").toLowerCase();
        if (d.length > 3 && (short.includes(d) || d.includes(short.slice(0, 6)) || exe.toLowerCase().startsWith(d))) {
          path = newest(findUnder(join(L, dir), /Saved\\Config\\Windows[^\\]*\\GameUserSettings\.ini$/i, 4));
          if (path) break;
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (!path) return null;
  const content = readFileSync(path, "utf8").slice(0, 8000);
  return { game: name, path, content };
}

// ---------------- Hold Windows Update while gaming ----------------
let held = false;
export async function holdUpdates(on: boolean) {
  if (on && !load().extras.holdWindowsUpdate) return;
  if (on === held) return;
  held = on;
  // Stopping these pauses any download in progress; Windows restarts them on its own later.
  await runPs(on ? "Stop-Service -Name wuauserv,BITS,DoSvc -Force -ErrorAction SilentlyContinue" : "Start-Service -Name BITS,wuauserv -ErrorAction SilentlyContinue").catch(() => {});
}
