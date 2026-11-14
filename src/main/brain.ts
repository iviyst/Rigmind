// The "smart PC" layer: daily checkups, anomaly alerts after each session, and Autopilot.
import { EventEmitter } from "node:events";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { dataDir, load, aiReady } from "./store";
import { listSessions, saveSessionField } from "./sessions";
import { boost } from "./boost";
import * as ai from "./ai";
import type { Checkup, ProposedAction, SessionDetail } from "../shared/types";

const file = () => join(dataDir("checkups"), "checkups.json");

// Low-risk fixes Autopilot may apply on its own (each one is undoable in the change history).
const AUTOPILOT_SAFE = new Set(["add_to_pause_list", "disable_game_dvr", "enable_game_mode", "set_power_plan_high", "clear_temp_files", "set_refresh_rate", "raise_game_priority"]);

class Brain extends EventEmitter {
  private applyAction: ((a: ProposedAction, source: "autopilot") => Promise<{ ok: boolean; message: string }>) | null = null;

  init(applyAction: (a: ProposedAction, source: "autopilot") => Promise<{ ok: boolean; message: string }>) {
    this.applyAction = applyAction;
    // Daily checkup at the chosen hour (checked every 10 minutes; never during a game).
    setInterval(() => {
      const c = load().extras.checkup;
      if (!c.enabled || !aiReady() || boost.state.active) return;
      const now = new Date();
      const last = this.list()[0]?.t ?? 0;
      if (now.getHours() >= c.hour && new Date(last).toDateString() !== now.toDateString()) void this.checkup().catch(() => {});
    }, 10 * 60_000);
  }

  list(): Checkup[] {
    try {
      return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : [];
    } catch {
      return [];
    }
  }

  async checkup(): Promise<Checkup> {
    const c = await ai.runCheckup();
    writeFileSync(file(), JSON.stringify([c, ...this.list()].slice(0, 30)));
    this.emit("checkup", c);
    await this.autopilot(c.actions, "daily checkup");
    return c;
  }

  /** Compare a finished session with this game's usual numbers. */
  anomaly(s: SessionDetail): string | null {
    if (!load().extras.anomalyAlerts || s.avgFps == null) return null;
    const prev = listSessions().filter((x) => x.exe === s.exe && x.id !== s.id && x.avgFps != null).slice(0, 6);
    if (prev.length < 3) return null;
    const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
    const fps = med(prev.map((x) => x.avgFps!));
    const lows = prev.map((x) => x.low1).filter((x): x is number => x != null);
    const gpuT = prev.map((x) => x.maxGpuTemp).filter((x): x is number => x != null);
    let msg: string | null = null;
    if (s.avgFps < fps * 0.88) msg = `${s.game} ran ${Math.round((1 - s.avgFps / fps) * 100)}% slower than usual (${s.avgFps} vs ${fps} FPS average).`;
    else if (s.low1 != null && lows.length >= 3 && s.low1 < med(lows) * 0.85) msg = `${s.game} had rougher frame pacing than usual (1% low ${s.low1} vs ${med(lows)}).`;
    else if (s.maxGpuTemp != null && gpuT.length >= 3 && s.maxGpuTemp >= med(gpuT) + 6) msg = `Your GPU ran ${s.maxGpuTemp - med(gpuT)}°C hotter than usual in ${s.game}.`;
    if (msg) saveSessionField(s.id, { anomaly: msg });
    return msg;
  }

  async autopilot(actions: ProposedAction[], from: string): Promise<string[]> {
    if (!load().extras.autopilot || !this.applyAction) return [];
    const done: string[] = [];
    for (const a of actions.filter((x) => AUTOPILOT_SAFE.has(x.kind))) {
      const r = await this.applyAction(a, "autopilot").catch(() => null);
      if (r?.ok) done.push(a.label);
    }
    if (done.length) this.emit("autopilot", { from, done });
    return done;
  }
}

export const brain = new Brain();
