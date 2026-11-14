// Per-game profiles: created the first time a game is detected, then tuned by
// the user, by tests, and by what Rigmind learns from each session.
import { load, save } from "./store";
import { isProtected, getSystemInfo, runAffinity } from "./winsys";
import type { GameProfile, SessionDetail } from "../shared/types";

const key = (exe: string) => exe.toLowerCase().replace(/\.exe$/, "");

export function listProfiles(): GameProfile[] {
  return Object.values(load().profiles).sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
}

export function getProfile(exe: string): GameProfile | null {
  return load().profiles[key(exe)] ?? null;
}

export function ensureProfile(exe: string, name: string): GameProfile {
  const existing = getProfile(exe);
  if (existing) return existing;
  const p: GameProfile = {
    exe,
    name,
    pauseMode: "global",
    pauseList: [],
    priority: "High",
    power: "high",
    affinity: "all",
    fanProfile: "default",
    rgbColor: null,
    suggestedPause: [],
    sessions: 0,
    lastPlayed: null,
  };
  return saveProfile(p), p;
}

export function saveProfile(p: GameProfile): GameProfile[] {
  save({ profiles: { ...load().profiles, [key(p.exe)]: p } });
  return listProfiles();
}

export function deleteProfile(exe: string): GameProfile[] {
  const all = { ...load().profiles };
  delete all[key(exe)];
  save({ profiles: all });
  return listProfiles();
}

/** Learn from a finished session: count it, and suggest pausing apps that keep causing stutters. */
export function learnFromSession(s: SessionDetail) {
  const p = getProfile(s.exe);
  if (!p) return;
  const counts = new Map<string, number>();
  for (const e of s.stutterEvents) {
    if (e.cause !== "background" || !e.topProc) continue;
    const name = e.topProc.replace(/\s*\(.*\)$/, "");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const already = new Set([...(p.pauseMode === "custom" ? p.pauseList : load().boost.suspendList), ...p.suggestedPause].map((n) => n.toLowerCase()));
  const fresh = [...counts.entries()].filter(([n, c]) => c >= 3 && !isProtected(n) && !already.has(n.toLowerCase())).map(([n]) => n);
  saveProfile({ ...p, sessions: p.sessions + 1, lastPlayed: s.end, suggestedPause: [...p.suggestedPause, ...fresh] });
}

/** Dual-CCD X3D Ryzen (7900X3D, 7950X3D, 9900X3D, 9950X3D): only one CCD has the extra cache. */
export async function cpuHasCacheCcd(): Promise<boolean> {
  const info = await getSystemInfo().catch(() => null);
  return !!info && /X3D/i.test(info.cpu) && info.cores >= 12;
}

/** Pin a game to the cache CCD (CCD0 = the first half of logical processors). */
export async function pinToCacheCcd(pid: number): Promise<boolean> {
  const info = await getSystemInfo();
  const half = Math.floor(info.threads / 2);
  return runAffinity(pid, (1n << BigInt(half)) - 1n);
}

export async function unpin(pid: number): Promise<boolean> {
  const info = await getSystemInfo();
  return runAffinity(pid, (1n << BigInt(info.threads)) - 1n);
}
