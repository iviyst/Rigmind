// Frame-time capture using Intel PresentMon (console edition), which reads the
// same ETW events as RTSS/FrameView. Gives true FPS, 1% lows and stutter spikes.
import { spawn, ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { load } from "./store";
import type { FpsStats } from "../shared/types";

function findIn(dir: string, re: RegExp, depth = 2): string | null {
  if (!existsSync(dir) || depth < 0) return null;
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isFile() && re.test(e.name)) return p;
      if (e.isDirectory() && /presentmon/i.test(e.name)) {
        const hit = findIn(p, re, depth - 1);
        if (hit) return hit;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function findPresentMon(): string | null {
  const custom = load().presentMonPath;
  if (custom && existsSync(custom)) return custom;
  const local = process.env.LOCALAPPDATA ?? "";
  const pf = process.env.ProgramFiles ?? "C:\\Program Files";
  const re = /^presentmon.*\.exe$/i;
  return (
    findIn(join(local, "Microsoft", "WinGet", "Links"), re, 0) ??
    findIn(join(local, "Microsoft", "WinGet", "Packages"), re, 2) ??
    findIn(join(pf, "Intel"), re, 3) ??
    null
  );
}

class FpsCapture extends EventEmitter {
  private proc: ChildProcess | null = null;
  private frames: { t: number; ms: number }[] = []; // rolling 10s window
  private lastSecond: number[] = [];
  stutters = 0;

  get running() {
    return !!this.proc;
  }

  start(pid: number): boolean {
    this.stop();
    const exe = findPresentMon();
    if (!exe) return false;
    this.frames = [];
    this.stutters = 0;
    const args = ["--process_id", String(pid), "--output_stdout", "--stop_existing_session", "--session_name", "RigmindCapture", "--terminate_on_proc_exit"];
    const p = spawn(exe, args, { windowsHide: true });
    this.proc = p;
    let buf = "";
    let col = -1;
    p.stdout?.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        const cells = line.split(",");
        if (col < 0) {
          // Header row: PresentMon 2.x uses FrameTime / MsBetweenPresents depending on mode.
          const names = cells.map((c) => c.trim());
          col = ["FrameTime", "MsBetweenPresents", "MsBetweenDisplayChange"].map((n) => names.indexOf(n)).find((i) => i >= 0) ?? -1;
          continue;
        }
        const ms = parseFloat(cells[col]);
        if (ms > 0 && ms < 2000) this.addFrame(ms);
      }
    });
    p.on("error", () => (this.proc = null));
    p.on("close", () => (this.proc = null));
    return true;
  }

  stop() {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }

  private addFrame(ms: number) {
    const now = Date.now();
    // Stutter = a frame much longer than the recent median (and long enough to notice).
    if (this.frames.length > 60) {
      const recent = this.frames.slice(-120).map((f) => f.ms).sort((a, b) => a - b);
      const median = recent[Math.floor(recent.length / 2)];
      if (ms > Math.max(median * 2.5, median + 20)) {
        this.stutters++;
        this.emit("stutter", ms);
      }
    }
    this.frames.push({ t: now, ms });
    while (this.frames.length && now - this.frames[0].t > 10_000) this.frames.shift();
  }

  /** Stats for the last second, plus 1% low over the last 10 seconds. */
  stats(): FpsStats | null {
    if (!this.proc || this.frames.length < 2) return null;
    const now = Date.now();
    const sec = this.frames.filter((f) => now - f.t <= 1000).map((f) => f.ms);
    if (!sec.length) return null;
    const sum = sec.reduce((a, b) => a + b, 0);
    const all = this.frames.map((f) => f.ms).sort((a, b) => b - a);
    const worst1 = all.slice(0, Math.max(1, Math.floor(all.length * 0.01)));
    const worstAvg = worst1.reduce((a, b) => a + b, 0) / worst1.length;
    this.lastSecond = sec;
    return {
      fps: Math.round((sec.length / sum) * 1000),
      low1: Math.round(1000 / worstAvg),
      frametimeMs: +(sum / sec.length).toFixed(2),
      frametimes: sec.slice(-240),
    };
  }
}

export const fps = new FpsCapture();
