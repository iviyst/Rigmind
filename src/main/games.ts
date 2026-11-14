// Detects when a game is running from the live process list.
import type { ProcInfo } from "../shared/types";
import { load } from "./store";

// Install folders used by the major launchers.
const GAME_DIRS = [
  /\\steamapps\\common\\/i,
  /\\Epic Games\\/i,
  /\\GOG Galaxy\\Games\\/i,
  /\\GOG Games\\/i,
  /\\XboxGames\\/i,
  /\\WindowsApps\\.*(Microsoft\.(Minecraft|Halo|Forza|SeaofThieves))/i,
  /\\Riot Games\\/i,
  /\\Battle\.net\\/i,
  /\\Blizzard\\/i,
  /\\EA Games\\/i,
  /\\Electronic Arts\\/i,
  /\\Ubisoft Game Launcher\\games\\/i,
  /\\Rockstar Games\\/i,
  /\\Roblox\\Versions\\/i,
  /\\Games\\/i,
];

// Well-known games that live outside launcher folders.
const KNOWN = ["RobloxPlayerBeta", "Minecraft.Windows", "javaw", "FortniteClient-Win64-Shipping", "VALORANT-Win64-Shipping", "cs2", "r5apex", "RainbowSix", "GTA5", "eldenring", "Overwatch"];

// Helpers, launchers and anti-cheat that live inside game folders but aren't the game.
const NOT_GAMES = /(launcher|crash|report|helper|updater|setup|install|unins|redist|vc_redist|dxsetup|easyanticheat|battleye|beservice|ue4prereq|cefprocess|webhelper|overlay|bootstrap|steamservice|epicwebhelper|riotclient|agent|vgc|vgtray|battle\.net|blizzard|origin|eadesktop|ubisoftconnect|upc|socialclub|rockstarservice|gamebar|xboxpcapp)/i;

const friendly: Record<string, string> = {
  robloxplayerbeta: "Roblox",
  "minecraft.windows": "Minecraft",
  javaw: "Minecraft (Java)",
  "fortniteclient-win64-shipping": "Fortnite",
  "valorant-win64-shipping": "VALORANT",
  cs2: "Counter-Strike 2",
  r5apex: "Apex Legends",
  gta5: "GTA V",
};

export function friendlyName(p: ProcInfo): string {
  const key = p.name.toLowerCase();
  if (friendly[key]) return friendly[key];
  // Use the game's folder name under the launcher directory when we have it.
  const m = p.path?.match(/\\(?:common|Epic Games|Games|XboxGames|Riot Games|Rockstar Games)\\([^\\]+)\\/i);
  return m ? m[1] : p.name.replace(/-Win64-Shipping|_x64|Win64/i, "");
}

export function detectGame(procs: ProcInfo[]): ProcInfo | null {
  const s = load().boost;
  const custom = new Set(s.customGames.map((n) => n.toLowerCase().replace(/\.exe$/, "")));
  const ignored = new Set(s.ignoredExes.map((n) => n.toLowerCase().replace(/\.exe$/, "")));
  const known = new Set(KNOWN.map((k) => k.toLowerCase()));
  const candidates = procs.filter((p) => {
    const n = p.name.toLowerCase();
    if (ignored.has(n)) return false;
    if (custom.has(n)) return true;
    if (NOT_GAMES.test(n)) return false;
    if (n === "javaw" && !/minecraft/i.test(p.path ?? "")) return false;
    if (known.has(n)) return true;
    return !!p.path && GAME_DIRS.some((re) => re.test(p.path!)) && p.memMB > 150;
  });
  if (!candidates.length) return null;
  // Games are the heaviest process in their folder.
  return candidates.sort((a, b) => b.memMB - a.memMB)[0];
}
