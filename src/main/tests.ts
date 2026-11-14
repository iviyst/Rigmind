// Before/after tests: did a fix actually help?
// Runs A (before) -> B (with the change) -> A again (change undone), 40 s each, while you keep
// playing in the same spot. Comparing B with both A runs separates real gains from noise.
// Better -> the change is re-applied and kept. Same or worse -> it stays undone.
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { telemetry } from "./telemetry";
import { fps } from "./fps";
import { boost } from "./boost";
import { dataDir, load, save } from "./store";
import * as win from "./winsys";
import { getProfile, saveProfile, pinToCacheCcd, unpin } from "./profiles";
import type { PhaseStats, Telemetry, TestChangeKind, TestRun } from "../shared/types";

const PHASE_MS = 40_000;
const SETTLE_MS = 5_000;
const file = () => join(dataDir("tests"), "tests.json");

interface Change {
  apply(): Promise<boolean>;
  revert(): Promise<void>;
  keep(): void; // make it permanent when the test says it helped
}

function makeChange(kind: TestChangeKind, target: string | undefined, pid: number, exe: string): Change | null {
  switch (kind) {
    case "power_high": {
      let prev: string | null = null;
      return {
        apply: async () => ((prev = await win.getActivePowerScheme()), win.setPowerScheme(win.HIGH_PERF)),
        revert: async () => void (prev && (await win.setPowerScheme(prev))),
        keep: () => {
          const p = getProfile(exe);
          if (p) saveProfile({ ...p, power: "high" });
        },
      };
    }
    case "pause_app": {
      if (!target || win.isProtected(target)) return null;
      let pids: number[] = [];
      return {
        apply: async () => ((pids = (await win.suspendByName([target])).map((p) => p.pid)), pids.length > 0),
        revert: async () => win.resumePids(pids),
        keep: () => {
          const b = load().boost;
          if (!b.suspendList.some((n) => n.toLowerCase() === target.toLowerCase())) save({ boost: { ...b, suspendList: [...b.suspendList, target] } });
          void win.suspendByName([target]).then((p) => boost.adoptPaused(p));
        },
      };
    }
    case "game_dvr_off":
      return { apply: async () => (await win.disableGameDvr(), true), revert: () => win.enableGameDvr(), keep: () => {} };
    case "priority_high":
      return {
        apply: async () => (await win.setPriority(pid, "High"), true),
        revert: () => win.setPriority(pid, "Normal"),
        keep: () => {
          const p = getProfile(exe);
          if (p) saveProfile({ ...p, priority: "High" });
        },
      };
    case "affinity_cache":
      return {
        apply: () => pinToCacheCcd(pid),
        revert: async () => void (await unpin(pid)),
        keep: () => {
          const p = getProfile(exe);
          if (p) saveProfile({ ...p, affinity: "cache-ccd" });
        },
      };
  }
  return null;
}

function stats(samples: Telemetry[], frametimes: number[], stutters: number): PhaseStats {
  const f = samples.map((s) => s.fps?.fps).filter((x): x is number => x != null);
  const sorted = [...frametimes].sort((a, b) => b - a);
  const worst = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.01)));
  const worstAvg = worst.reduce((a, b) => a + b, 0) / (worst.length || 1);
  return {
    fps: f.length ? Math.round(f.reduce((a, b) => a + b, 0) / f.length) : 0,
    low1: worstAvg ? Math.round(1000 / worstAvg) : 0,
    stutters,
    seconds: samples.length,
  };
}

class TestRunner extends EventEmitter {
  current: TestRun | null = null;
  private cancelled = false;

  list(): TestRun[] {
    try {
      return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : [];
    } catch {
      return [];
    }
  }

  private record(t: TestRun) {
    const all = [t, ...this.list().filter((x) => x.id !== t.id)].slice(0, 50);
    writeFileSync(file(), JSON.stringify(all));
  }

  private update(patch: Partial<TestRun>) {
    if (!this.current) return;
    this.current = { ...this.current, ...patch };
    this.emit("test", this.current);
  }

  cancel() {
    this.cancelled = true;
  }

  async start(kind: TestChangeKind, target: string | undefined, label: string): Promise<{ ok: boolean; message: string }> {
    if (this.current) return { ok: false, message: "A test is already running." };
    const g = boost.state;
    if (!g.active || !g.pid || !g.exe) return { ok: false, message: "Start your game first, then run the test while you play." };
    if (!fps.running) return { ok: false, message: "Tests need FPS capture. Install PresentMon on the Game Boost page." };
    const change = makeChange(kind, target, g.pid, g.exe);
    if (!change) return { ok: false, message: "That change can't be tested." };
    this.cancelled = false;
    this.current = { id: randomUUID(), game: g.game ?? g.exe, exe: g.exe, change: kind, target, label, started: Date.now(), phase: "before", progress: 0 };
    this.emit("test", this.current);
    void this.run(change).catch(async (e) => {
      await change.revert().catch(() => {});
      this.finish({ phase: "aborted", summary: "Test stopped: " + (e?.message ?? e) });
    });
    return { ok: true, message: "Test started. Keep playing in the same area for about 2.5 minutes." };
  }

  private async phase(name: TestRun["phase"], offsetMs: number): Promise<PhaseStats> {
    this.update({ phase: name });
    const samples: Telemetry[] = [];
    const frametimes: number[] = [];
    let stutters = 0;
    const onSample = (t: Telemetry) => {
      if (t.fps) {
        samples.push(t);
        frametimes.push(...t.fps.frametimes);
      }
    };
    const onStutter = () => stutters++;
    telemetry.on("sample", onSample);
    fps.on("stutter", onStutter);
    const total = 3 * PHASE_MS + 2 * SETTLE_MS;
    const startedAt = Date.now();
    try {
      while (Date.now() - startedAt < PHASE_MS) {
        if (this.cancelled) throw new Error("cancelled");
        if (!boost.state.active) throw new Error("the game closed");
        await new Promise((r) => setTimeout(r, 1000));
        this.update({ progress: Math.min(0.99, (offsetMs + Date.now() - startedAt) / total) });
      }
    } finally {
      telemetry.off("sample", onSample);
      fps.off("stutter", onStutter);
    }
    return stats(samples, frametimes, stutters);
  }

  private async run(change: Change) {
    const settle = () => new Promise((r) => setTimeout(r, SETTLE_MS));
    const a1 = await this.phase("before", 0);
    this.update({ a1 });
    if (!(await change.apply())) throw new Error("the change couldn't be applied (the game or anti-cheat may block it)");
    await settle();
    const b = await this.phase("after", PHASE_MS + SETTLE_MS);
    this.update({ b });
    await change.revert();
    await settle();
    const a2 = await this.phase("before-again", 2 * (PHASE_MS + SETTLE_MS));

    const base = { fps: (a1.fps + a2.fps) / 2, low1: (a1.low1 + a2.low1) / 2, stutters: (a1.stutters + a2.stutters) / 2 };
    const thrLow = Math.max(base.low1 * 0.03, Math.abs(a1.low1 - a2.low1) * 1.5, 1);
    const thrFps = Math.max(base.fps * 0.02, Math.abs(a1.fps - a2.fps) * 1.5, 1);
    const dLow = b.low1 - base.low1;
    const dFps = b.fps - base.fps;
    const fewerStutters = base.stutters >= 4 && b.stutters <= base.stutters * 0.5;
    let verdict: TestRun["verdict"] = "same";
    if (dLow < -thrLow || dFps < -thrFps) verdict = "worse";
    else if (dLow > thrLow || dFps > thrFps || fewerStutters) verdict = "better";

    const pct = (d: number, base: number) => (base ? `${d >= 0 ? "+" : ""}${Math.round((d / base) * 100)}%` : "");
    let summary = `1% low ${Math.round(base.low1)} → ${b.low1} FPS (${pct(dLow, base.low1)}), average ${Math.round(base.fps)} → ${b.fps} FPS, stutters ${Math.round(base.stutters)} → ${b.stutters}.`;
    if (verdict === "better") {
      await change.apply();
      change.keep();
      summary += " It helped, so Rigmind kept it.";
    } else summary += verdict === "worse" ? " It made things worse, so Rigmind undid it." : " No real difference, so Rigmind undid it.";
    this.finish({ a2, phase: "done", progress: 1, verdict, summary, kept: verdict === "better" });
  }

  private finish(patch: Partial<TestRun>) {
    this.update(patch);
    if (this.current) this.record(this.current);
    this.current = null;
  }
}

export const tests = new TestRunner();
