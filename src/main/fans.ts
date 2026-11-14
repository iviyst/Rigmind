// Fan control engine. Runs on every hardware sample (1/s).
// - Curves per fan from a profile (quiet/balanced/performance) or a custom curve.
// - Ramps up early when a game launches, before temperatures rise.
// - Smooths changes (fast up, slow down) so fans don't hunt.
// - Failsafe: any critical temperature or lost sensors -> every fan to 100%.
// - Off, or helper gone -> fans belong to the BIOS (the helper releases them itself).
import { EventEmitter } from "node:events";
import { hw } from "./hw";
import { load, save } from "./store";
import type { CurvePoint, FanControlCfg, FanProfileName, FanRuntime, FanSettings, FanSource } from "../shared/types";

export const PROFILE_CURVES: Record<FanProfileName, CurvePoint[]> = {
  quiet: [{ t: 40, p: 20 }, { t: 60, p: 30 }, { t: 70, p: 45 }, { t: 80, p: 70 }, { t: 90, p: 100 }],
  balanced: [{ t: 40, p: 25 }, { t: 55, p: 35 }, { t: 65, p: 50 }, { t: 75, p: 70 }, { t: 85, p: 100 }],
  performance: [{ t: 35, p: 40 }, { t: 50, p: 55 }, { t: 60, p: 70 }, { t: 70, p: 85 }, { t: 80, p: 100 }],
};

const CRIT = { cpu: 95, gpu: 88, hotspot: 105 };
const PRE_RAMP_MS = 45_000;
const PRE_RAMP_PCT = 15;

export function interpolate(curve: CurvePoint[], t: number): number {
  const pts = [...curve].sort((a, b) => a.t - b.t);
  if (!pts.length) return 100;
  if (t <= pts[0].t) return pts[0].p;
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].t) {
      const a = pts[i - 1], b = pts[i];
      return a.p + ((t - a.t) / (b.t - a.t)) * (b.p - a.p);
    }
  }
  return pts[pts.length - 1].p;
}

export function defaultCfg(name: string): FanControlCfg {
  const gpu = /gpu/i.test(name);
  return { label: name, mode: "auto", source: gpu ? "gpu" : "max", fixed: 50, custom: PROFILE_CURVES.balanced, minPct: gpu ? 30 : 20, calibration: null };
}

class FanEngine extends EventEmitter {
  private applied: Record<string, number> = {};
  private gameStartedAt = 0;
  private gameProfile: FanProfileName | null = null; // per-game override
  private calibratingId: string | null = null;
  private calibStep = "";
  inGame = false;
  failsafe: string | null = null;

  init() {
    hw.on("sample", () => this.tick());
    // Watch for a stalled helper while fans are under our control.
    setInterval(() => {
      if (this.isActive() && hw.age > 5000) this.setFailsafe("Lost contact with the sensors");
    }, 2000);
  }

  settings(): FanSettings {
    return load().fans;
  }

  saveSettings(patch: Partial<FanSettings>): FanSettings {
    const before = this.settings();
    const next = save({ fans: { ...before, ...patch } }).fans;
    if (!next.enabled && before.enabled) this.releaseAll();
    // Fans switched back to automatic get handed to the BIOS straight away.
    for (const [id, c] of Object.entries(next.controls)) if (c.mode === "auto" && before.controls[id]?.mode !== "auto") this.release(id);
    return next;
  }

  isActive() {
    const s = this.settings();
    return s.enabled && s.riskAccepted && Object.values(s.controls).some((c) => c.mode !== "auto");
  }

  onGameStart(profile: FanProfileName | null) {
    this.inGame = true;
    this.gameStartedAt = Date.now();
    this.gameProfile = profile;
  }
  onGameEnd() {
    this.inGame = false;
    this.gameProfile = null;
  }

  currentProfile(): FanProfileName {
    const s = this.settings();
    return this.inGame ? this.gameProfile ?? s.gameProfile : s.desktopProfile;
  }

  private sourceTemp(src: FanSource): number | null {
    const cpu = hw.cpuTemp();
    const gpu = hw.gpuTemp();
    if (src === "cpu") return cpu;
    if (src === "gpu") return gpu;
    if (src === "liquid") return hw.liquidTemp() ?? cpu;
    const v = [cpu, gpu].filter((x): x is number => x != null);
    return v.length ? Math.max(...v) : null;
  }

  private setFailsafe(reason: string) {
    this.failsafe = reason;
    for (const f of hw.fans()) {
      hw.setFan(f.controlId, 100);
      this.applied[f.controlId] = 100;
    }
    this.emit("runtime", this.runtime());
  }

  private tick() {
    if (this.calibratingId) return;
    const s = this.settings();
    if (!this.isActive()) {
      if (Object.keys(this.applied).length) this.releaseAll();
      return;
    }
    const cpu = hw.cpuTemp(), gpu = hw.gpuTemp(), hot = hw.gpuHotspot();
    if ((cpu ?? 0) >= CRIT.cpu || (gpu ?? 0) >= CRIT.gpu || (hot ?? 0) >= CRIT.hotspot) {
      return this.setFailsafe(`Critical temperature (CPU ${cpu ?? "?"}°C, GPU ${gpu ?? "?"}°C)`);
    }
    if (cpu == null && gpu == null) return this.setFailsafe("No temperature sensors are reporting");
    this.failsafe = null;

    const profile = this.currentProfile();
    const preRamp = s.preRamp && this.inGame && Date.now() - this.gameStartedAt < PRE_RAMP_MS ? PRE_RAMP_PCT : 0;
    for (const fan of hw.fans()) {
      const cfg = s.controls[fan.controlId];
      if (!cfg || cfg.mode === "auto") continue;
      let target: number;
      if (cfg.mode === "fixed") target = cfg.fixed;
      else {
        const t = this.sourceTemp(cfg.source);
        if (t == null) {
          target = 100;
        } else {
          const curve = cfg.mode === "custom" ? cfg.custom : PROFILE_CURVES[profile];
          target = interpolate(curve, t) + preRamp;
        }
      }
      target = Math.max(cfg.minPct, Math.min(100, target));
      // Fast up (10%/s), slow down (2%/s) so fans don't hunt.
      const prev = this.applied[fan.controlId] ?? fan.percent ?? target;
      const next = target > prev ? Math.min(target, prev + 10) : Math.max(target, prev - 2);
      if (Math.abs(next - (this.applied[fan.controlId] ?? -99)) >= 1) {
        hw.setFan(fan.controlId, next);
        this.applied[fan.controlId] = Math.round(next);
      }
    }
    this.emit("runtime", this.runtime());
  }

  release(id: string) {
    hw.releaseFan(id);
    delete this.applied[id];
  }

  releaseAll() {
    hw.releaseAll();
    this.applied = {};
    this.failsafe = null;
    this.emit("runtime", this.runtime());
  }

  runtime(): FanRuntime {
    return {
      active: this.isActive(),
      failsafe: this.failsafe,
      targets: { ...this.applied },
      profile: this.currentProfile(),
      calibrating: this.calibratingId ? { controlId: this.calibratingId, step: this.calibStep } : null,
    };
  }

  /** Measure RPM at each duty to find the lowest speed the fan reliably spins at. */
  async calibrate(controlId: string): Promise<{ ok: boolean; message: string }> {
    if (this.inGame) return { ok: false, message: "Calibrate when no game is running." };
    if (!hw.running) return { ok: false, message: "The hardware helper isn't running." };
    const fan = hw.fans().find((f) => f.controlId === controlId);
    if (!fan) return { ok: false, message: "Fan not found." };
    this.calibratingId = controlId;
    const steps = [100, 80, 60, 50, 40, 30, 25, 20, 15, 10];
    const points: { p: number; rpm: number }[] = [];
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      for (const p of steps) {
        // Abort and cool down if anything gets hot while we're slowing fans.
        if ((hw.cpuTemp() ?? 0) >= 85 || (hw.gpuTemp() ?? 0) >= 80) {
          hw.setFan(controlId, 100);
          return { ok: false, message: "Stopped: temperatures rose during calibration. Try again with the PC idle." };
        }
        this.calibStep = `Testing ${p}%`;
        this.emit("runtime", this.runtime());
        hw.setFan(controlId, p);
        await wait(p === 100 ? 6000 : 4500);
        const rpm = hw.fans().find((f) => f.controlId === controlId)?.rpm ?? 0;
        points.push({ p, rpm: Math.round(rpm) });
      }
      const spinning = points.filter((x) => x.rpm > 150);
      const startPct = spinning.length ? Math.min(...spinning.map((x) => x.p)) + 5 : 30;
      const s = this.settings();
      const cfg = s.controls[controlId] ?? defaultCfg(fan.name);
      const noRpm = points.every((x) => x.rpm === 0);
      this.saveSettings({
        controls: { ...s.controls, [controlId]: { ...cfg, minPct: noRpm ? cfg.minPct : Math.max(cfg.minPct, startPct), calibration: { at: Date.now(), startPct, points } } },
      });
      return {
        ok: true,
        message: noRpm ? "This header doesn't report RPM, so Rigmind kept your minimum speed." : `Spins reliably from ${startPct}%. Max ${points[0].rpm} RPM.`,
      };
    } finally {
      this.calibratingId = null;
      this.calibStep = "";
      if (this.settings().controls[controlId]?.mode === "auto" || !this.isActive()) this.release(controlId);
      this.emit("runtime", this.runtime());
    }
  }
}

export const fans = new FanEngine();
