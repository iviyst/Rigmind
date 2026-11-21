// Game Boost: watches for games, applies the boost, records the session, and
// puts everything back the way it was when the game closes.
import { EventEmitter } from "node:events";
import { telemetry } from "./telemetry";
import { fps } from "./fps";
import { detectGame, friendlyName } from "./games";
import { load, save } from "./store";
import { SessionRecorder } from "./sessions";
import * as win from "./winsys";
import { ensureProfile, learnFromSession, pinToCacheCcd, saveProfile } from "./profiles";
import { holdUpdates } from "./tune";
import { dirname } from "node:path";
import type { GameState, GameProfile, ProcInfo, SessionDetail } from "../shared/types";

class GameBoost extends EventEmitter {
  state: GameState = { active: false, game: null, exe: null, pid: null, since: null, boosted: false, fpsCapture: "off", suspended: [] };
  private seen = 0; // consecutive polls with a game detected
  private missing = 0;
  private candidate: ProcInfo | null = null;
  private manual = false;
  private recorder: SessionRecorder | null = null;
  private paused: { pid: number; name: string }[] = [];
  private busy = false;
  /** Set by Ready to Play while it launches games unattended to warm their shaders. */
  suppressed = false;

  async init() {
    // If Rigmind crashed mid-game last time, resume anything it paused.
    const s = load();
    if (s.pendingResume.length) {
      await win.resumePids(s.pendingResume.map((p) => p.pid)).catch(() => {});
      save({ pendingResume: [] });
    }
    if (s.savedPowerScheme) {
      await win.setPowerScheme(s.savedPowerScheme).catch(() => {});
      save({ savedPowerScheme: null });
    }
    telemetry.on("procs", (procs: ProcInfo[]) => this.onProcs(procs));
    telemetry.on("sample", (t) => this.recorder?.add(t));
    fps.on("stutter", (ms: number) => this.recorder?.stutter(ms, telemetry.procs));
    telemetry.fpsProvider = () => fps.stats();
  }

  private set(patch: Partial<GameState>) {
    this.state = { ...this.state, ...patch };
    this.emit("state", this.state);
  }

  private onProcs(procs: ProcInfo[]) {
    if (this.busy || (this.suppressed && !this.state.active)) return;
    if (this.state.active) {
      const stillRunning = procs.some((p) => p.pid === this.state.pid);
      if (stillRunning || this.manual) {
        this.missing = 0;
        return;
      }
      if (++this.missing >= 2) void this.stop();
      return;
    }
    const g = detectGame(procs);
    if (g && this.candidate?.pid === g.pid) this.seen++;
    else {
      this.candidate = g;
      this.seen = g ? 1 : 0;
    }
    if (g && this.seen >= 2) void this.start(g);
  }

  /** Start/stop boost by hand (uses the heaviest foreground-ish app if no game is detected). */
  async manualToggle(on: boolean): Promise<GameState> {
    if (on && !this.state.active) {
      const g = detectGame(telemetry.procs) ?? [...telemetry.procs].sort((a, b) => b.cpu - a.cpu)[0];
      if (g) {
        this.manual = true;
        await this.start(g);
      }
    } else if (!on && this.state.active) await this.stop();
    return this.state;
  }

  profile: GameProfile | null = null;

  private async start(g: ProcInfo) {
    this.busy = true;
    const cfg = load().boost;
    const name = friendlyName(g);
    let prof = (this.profile = ensureProfile(g.name, name));
    if (g.path && prof.installDir !== dirname(g.path)) prof = this.profile = (saveProfile({ ...prof, installDir: dirname(g.path) }), { ...prof, installDir: dirname(g.path) });
    this.set({ active: true, game: prof.name, exe: g.name, pid: g.pid, since: Date.now(), boosted: false, fpsCapture: "off", suspended: [] });
    try {
      if (cfg.enabled) {
        if (cfg.highPerformancePower && prof.power === "high") {
          const cur = await win.getActivePowerScheme();
          if (cur && cur !== win.HIGH_PERF) save({ savedPowerScheme: cur });
          await win.setPowerScheme(win.HIGH_PERF);
        }
        if (cfg.raisePriority && prof.priority !== "Normal") await win.setPriority(g.pid, prof.priority).catch(() => {});
        if (prof.affinity === "cache-ccd") await pinToCacheCcd(g.pid).catch(() => false);
        const list = prof.pauseMode === "custom" ? prof.pauseList : cfg.suspendList;
        if (cfg.pauseBackground && list.length) {
          this.paused = await win.suspendByName(list.filter((n) => n.toLowerCase() !== g.name.toLowerCase()));
          save({ pendingResume: this.paused });
        }
        await holdUpdates(true);
        this.set({ boosted: true, suspended: [...new Set(this.paused.map((p) => p.name))] });
      }
      const capturing = fps.start(g.pid);
      this.set({ fpsCapture: capturing ? "running" : "unavailable" });
      if (cfg.sessionReports) this.recorder = new SessionRecorder(prof.name, g.name);
      this.emit("started", this.state, prof);
    } finally {
      this.busy = false;
    }
  }

  /** Track apps paused elsewhere (e.g. a test that was kept) so they resume when the game ends. */
  adoptPaused(list: { pid: number; name: string }[]) {
    this.paused.push(...list);
    save({ pendingResume: this.paused });
    this.set({ suspended: [...new Set(this.paused.map((p) => p.name))] });
  }

  async stop() {
    this.busy = true;
    try {
      fps.stop();
      if (this.paused.length) await win.resumePids(this.paused.map((p) => p.pid)).catch(() => {});
      await holdUpdates(false);
      this.paused = [];
      const s = load();
      if (s.savedPowerScheme) await win.setPowerScheme(s.savedPowerScheme).catch(() => {});
      save({ pendingResume: [], savedPowerScheme: null });
      const detail: SessionDetail | null = this.recorder?.finish() ?? null;
      this.recorder = null;
      if (detail) learnFromSession(detail);
      this.profile = null;
      this.manual = false;
      this.missing = 0;
      this.seen = 0;
      this.candidate = null;
      this.set({ active: false, game: null, exe: null, pid: null, since: null, boosted: false, fpsCapture: "off", suspended: [] });
      this.emit("ended", detail);
    } finally {
      this.busy = false;
    }
  }

  /** Called on app quit so nothing stays paused. */
  async shutdown() {
    if (this.state.active) await this.stop();
  }
}

export const boost = new GameBoost();
