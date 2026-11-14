// Records a gaming session (one point per second + stutter events) and stores it.
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dataDir, load } from "./store";
import { energy } from "./energy";
import { netmon } from "./netmon";
import { hw } from "./hw";
import { currentDriver } from "./tune";
import type { SessionDetail, SessionPoint, SessionSummary, StutterEvent, StutterCause, Telemetry, ProcInfo } from "../shared/types";

const dir = () => dataDir("sessions");

export class SessionRecorder {
  points: SessionPoint[] = [];
  events: StutterEvent[] = [];
  readonly id: string;
  readonly start = Date.now();
  private latest: Telemetry | null = null;
  private wh = 0;
  private snaps = 0;
  private lastSnap = 0;

  constructor(public game: string, public exe: string) {
    this.id = new Date(this.start).toISOString().replace(/[:.]/g, "-") + "_" + exe.replace(/[^\w-]/g, "");
  }

  add(t: Telemetry) {
    this.latest = t;
    this.wh += (energy.watts() ?? 0) / 3600;
    this.points.push({
      t: t.t,
      fps: t.fps?.fps ?? null,
      low1: t.fps?.low1 ?? null,
      ft: t.fps?.frametimeMs ?? null,
      ftMax: t.fps?.frametimes.length ? Math.max(...t.fps.frametimes) : null,
      cpu: t.cpu.load,
      gpu: t.gpu?.load ?? null,
      cpuTemp: t.cpu.temp,
      gpuTemp: t.gpu?.temp ?? null,
      ram: +t.ram.usedGB.toFixed(2),
      gpuClock: t.gpu?.clockMHz ?? null,
      disk: +t.disk.readMBs.toFixed(1),
      ping: netmon.gamePing(),
    });
  }

  stutter(ms: number, procs: ProcInfo[]) {
    const t = this.latest;
    if (!t || this.events.length > 2000) return;
    // Don't log the same hitch twice within 250 ms.
    const last = this.events[this.events.length - 1];
    if (last && Date.now() - last.t < 250) return;
    const others = procs.filter((p) => p.name.toLowerCase() !== this.exe.toLowerCase());
    const top = [...others].sort((a, b) => b.cpu - a.cpu)[0];
    const { cause, why } = this.classify(t, top);
    // Optional screenshot of what was on screen at a big hitch (local only, rate limited).
    let snapshot: string | null = null;
    if (load().extras.snapshots && ms >= 50 && this.snaps < 40 && Date.now() - this.lastSnap > 15_000 && hw.running) {
      this.snaps++;
      this.lastSnap = Date.now();
      snapshot = `${this.snaps}.jpg`;
      void hw.snap(join(dir(), this.id + "-snaps", snapshot));
    }
    this.events.push({
      snapshot,
      t: Date.now(),
      frametimeMs: +ms.toFixed(1),
      cpuLoad: t.cpu.load,
      gpuLoad: t.gpu?.load ?? null,
      ramUsedGB: +t.ram.usedGB.toFixed(1),
      diskMBs: +(t.disk.readMBs + t.disk.writeMBs).toFixed(1),
      topProc: top ? `${top.name} (${top.cpu}% CPU)` : null,
      cause,
      why,
    });
  }

  /** Best guess at why a frame took too long, from what the PC was doing at that moment. */
  private classify(t: Telemetry, top: ProcInfo | undefined): { cause: StutterCause; why: string } {
    const g = t.gpu;
    const vramPct = g?.vramUsedMB != null && g.vramTotalMB ? g.vramUsedMB / g.vramTotalMB : null;
    if (vramPct != null && vramPct >= 0.95) return { cause: "vram", why: `Video memory ${Math.round(vramPct * 100)}% full` };
    const clocks = this.points.slice(-120).map((p) => p.gpuClock).filter((x): x is number => x != null).sort((a, b) => a - b);
    const medianClock = clocks.length ? clocks[Math.floor(clocks.length / 2)] : null;
    const clockDrop = medianClock && g?.clockMHz ? 1 - g.clockMHz / medianClock : 0;
    if ((t.cpu.temp ?? 0) >= 95 || (g?.temp ?? 0) >= 85 || ((g?.temp ?? 0) >= 80 && clockDrop > 0.15))
      return { cause: "thermal", why: `CPU ${t.cpu.temp ?? "?"}°C, GPU ${g?.temp ?? "?"}°C${clockDrop > 0.15 ? `, GPU clock down ${Math.round(clockDrop * 100)}%` : ""}` };
    if (t.disk.readMBs >= 50) return { cause: "loading", why: `Reading ${Math.round(t.disk.readMBs)} MB/s from disk` };
    if (top && top.cpu >= 8) return { cause: "background", why: `${top.name} using ${top.cpu}% CPU` };
    if (t.cpu.load >= 90) return { cause: "cpu", why: `CPU at ${Math.round(t.cpu.load)}%` };
    // Shader compilation: hitches early in a session (or right after loading) with none of the above.
    const sinceStart = Date.now() - this.start;
    const recentDisk = this.points.slice(-10).some((p) => (p.disk ?? 0) >= 50);
    if (sinceStart < 5 * 60_000 || recentDisk) return { cause: "shader", why: sinceStart < 5 * 60_000 ? "Early in the session, nothing else busy" : "Right after loading new data" };
    return { cause: "unknown", why: "Nothing unusual on the PC at that moment" };
  }

  finish(): SessionDetail | null {
    if (this.points.length < 30) return null; // ignore launches shorter than 30 s
    const avg = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x != null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const max = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x != null);
      return v.length ? Math.max(...v) : null;
    };
    const fpsVals = this.points.map((p) => p.fps);
    const lows = this.points.map((p) => p.low1).filter((x): x is number => x != null).sort((a, b) => a - b);
    const detail: SessionDetail = {
      id: this.id,
      game: this.game,
      exe: this.exe,
      start: this.start,
      end: Date.now(),
      avgFps: avg(fpsVals) != null ? Math.round(avg(fpsVals)!) : null,
      low1: lows.length ? lows[Math.floor(lows.length * 0.1)] : null,
      stutters: this.events.length,
      maxCpuTemp: max(this.points.map((p) => p.cpuTemp)),
      maxGpuTemp: max(this.points.map((p) => p.gpuTemp)),
      avgCpuLoad: Math.round(avg(this.points.map((p) => p.cpu)) ?? 0),
      avgGpuLoad: avg(this.points.map((p) => p.gpu)) != null ? Math.round(avg(this.points.map((p) => p.gpu))!) : null,
      peakRamGB: max(this.points.map((p) => p.ram)) ?? 0,
      analysis: null,
      driver: currentDriver(),
      energyWh: Math.round(this.wh),
      pingAvg: avg(this.points.map((p) => p.ping ?? null)) != null ? Math.round(avg(this.points.map((p) => p.ping ?? null))!) : null,
      anomaly: null,
      causes: this.events.reduce<Partial<Record<StutterCause, number>>>((acc, e) => {
        const c = e.cause ?? "unknown";
        acc[c] = (acc[c] ?? 0) + 1;
        return acc;
      }, {}),
      points: this.points,
      stutterEvents: this.events,
    };
    writeFileSync(join(dir(), detail.id + ".json"), JSON.stringify(detail));
    return detail;
  }
}

export function listSessions(): SessionSummary[] {
  return readdirSync(dir())
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const { points, stutterEvents, ...summary } = JSON.parse(readFileSync(join(dir(), f), "utf8")) as SessionDetail;
        return summary;
      } catch {
        return null;
      }
    })
    .filter((s): s is SessionSummary => !!s)
    .sort((a, b) => b.start - a.start);
}

export function getSession(id: string): SessionDetail | null {
  const f = join(dir(), id.replace(/[\\/]/g, "") + ".json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
}

export function saveAnalysis(id: string, analysis: string) {
  const s = getSession(id);
  if (!s) return;
  s.analysis = analysis;
  writeFileSync(join(dir(), s.id + ".json"), JSON.stringify(s));
}

export function deleteSession(id: string) {
  const safe = id.replace(/[\\/]/g, "");
  const f = join(dir(), safe + ".json");
  if (existsSync(f)) unlinkSync(f);
  rmSync(join(dir(), safe + "-snaps"), { recursive: true, force: true });
}

export function saveSessionField(id: string, patch: Partial<SessionDetail>) {
  const s = getSession(id);
  if (!s) return;
  writeFileSync(join(dir(), s.id + ".json"), JSON.stringify({ ...s, ...patch }));
}

/** A stutter snapshot as a data URL for the UI. */
export function getSnapshot(sessionId: string, file: string): string | null {
  const p = join(dir(), sessionId.replace(/[\\/]/g, "") + "-snaps", file.replace(/[\\/]/g, ""));
  return existsSync(p) ? "data:image/jpeg;base64," + readFileSync(p).toString("base64") : null;
}
