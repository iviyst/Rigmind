// Built-in stress test: loads every CPU thread and the GPU (a WebGL2 shader window) for a few
// minutes, watching temperatures, clocks and power. Used for checking fan curves and by the
// undervolting coach to check each step is stable.
import { EventEmitter } from "node:events";
import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { randomUUID } from "node:crypto";
import { BrowserWindow } from "electron";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./store";
import { telemetry } from "./telemetry";
import { hw } from "./hw";
import { boost } from "./boost";
import type { StressResult, StressState, Telemetry } from "../shared/types";

const file = () => join(dataDir("stress"), "results.json");
const CPU_WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
let x = 1.0001, stop = false;
parentPort.on("message", () => (stop = true));
(function spin() {
  const end = Date.now() + 200;
  while (Date.now() < end) for (let i = 0; i < 2e5; i++) x = Math.sqrt(x * 1.000001 + i) % 97.3 + Math.sin(x);
  if (!stop) setImmediate(spin);
})();`;

class StressTest extends EventEmitter {
  state: StressState = { running: false, label: "", progress: 0, seconds: 0, elapsed: 0, live: null };
  private workers: Worker[] = [];
  private win: BrowserWindow | null = null;
  private abortReason: string | null = null;

  list(): StressResult[] {
    try {
      return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : [];
    } catch {
      return [];
    }
  }

  /** Called by the GPU page if WebGL loses its context (the driver reset): a clear sign of instability. */
  gpuLost() {
    this.abortReason = "The GPU driver reset during the test. This setting isn't stable.";
  }

  stop(reason = "Stopped") {
    this.abortReason = reason;
  }

  async start(opts: { seconds: number; label: string; cpu: boolean; gpu: boolean; loadPage: (w: BrowserWindow, page: string) => void; preload: string }): Promise<StressResult | { error: string }> {
    if (this.state.running) return { error: "A stress test is already running." };
    if (boost.state.active) return { error: "Close your game before running a stress test." };
    this.abortReason = null;
    const seconds = Math.max(60, Math.min(1800, opts.seconds));
    this.state = { running: true, label: opts.label, progress: 0, seconds, elapsed: 0, live: null };
    this.emit("state", this.state);

    if (opts.cpu) for (let i = 0; i < cpus().length; i++) this.workers.push(new Worker(CPU_WORKER, { eval: true }));
    if (opts.gpu) {
      this.win = new BrowserWindow({ width: 960, height: 540, title: "Rigmind stress test (close to stop)", backgroundColor: "#000", autoHideMenuBar: true, webPreferences: { preload: opts.preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
      opts.loadPage(this.win, "stress.html");
      this.win.on("closed", () => {
        this.win = null;
        if (this.state.running && !this.abortReason) this.abortReason = "Stopped: the test window was closed.";
      });
      this.win.webContents.on("render-process-gone", () => (this.abortReason = "The GPU test crashed. This setting isn't stable."));
    }

    const samples: StressResult["samples"] = [];
    const t0 = Date.now();
    let reason = "Completed with stable clocks and safe temperatures.";
    let passed = true;
    while ((Date.now() - t0) / 1000 < seconds) {
      await new Promise((r) => setTimeout(r, 1000));
      const t: Telemetry | null = telemetry.latest();
      const s = Math.round((Date.now() - t0) / 1000);
      const live = { cpuTemp: hw.cpuTemp() ?? t?.cpu.temp ?? null, gpuTemp: t?.gpu?.temp ?? null, gpuClock: t?.gpu?.clockMHz ?? null, gpuPower: t?.gpu?.powerW ?? null };
      samples.push({ s, ...live });
      this.state = { ...this.state, elapsed: s, progress: s / seconds, live };
      this.emit("state", this.state);
      if ((live.cpuTemp ?? 0) >= 97 || (live.gpuTemp ?? 0) >= 90) {
        passed = false;
        reason = `Stopped early: too hot (CPU ${live.cpuTemp ?? "?"}°C, GPU ${live.gpuTemp ?? "?"}°C). Check your cooling before going further.`;
        break;
      }
      if (this.abortReason) {
        passed = false;
        reason = this.abortReason;
        break;
      }
    }
    for (const w of this.workers) void w.terminate();
    this.workers = [];
    this.win?.close();
    this.win = null;

    const vals = (k: keyof StressResult["samples"][number]) => samples.map((x) => x[k] as number | null).filter((x): x is number => x != null);
    const avg = (v: number[]) => (v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null);
    const clocks = vals("gpuClock");
    const firstThird = clocks.slice(0, Math.max(1, Math.floor(clocks.length / 3)));
    const lastThird = clocks.slice(-Math.max(1, Math.floor(clocks.length / 3)));
    const peak = firstThird.length ? Math.max(...firstThird) : null;
    const late = avg(lastThird);
    const throttled = !!peak && !!late && late < peak * 0.88 && (Math.max(0, ...vals("gpuTemp")) >= 82);
    if (passed && throttled) reason = "Stable, but the GPU slowed down as it heated up (thermal throttling). Better airflow or a stronger fan curve would help.";

    const result: StressResult = {
      id: randomUUID(),
      t: Date.now(),
      label: opts.label,
      seconds: Math.round((Date.now() - t0) / 1000),
      passed,
      reason,
      maxCpuTemp: vals("cpuTemp").length ? Math.max(...vals("cpuTemp")) : null,
      maxGpuTemp: vals("gpuTemp").length ? Math.max(...vals("gpuTemp")) : null,
      avgGpuPowerW: avg(vals("gpuPower")),
      avgGpuClock: avg(clocks),
      minGpuClock: clocks.length ? Math.min(...clocks.slice(5)) || null : null,
      avgCpuClock: avg(telemetry.history.slice(-samples.length).map((x) => x.cpu.clockMHz).filter((x): x is number => x != null)),
      throttled,
      samples: samples.filter((_, i) => i % 2 === 0),
    };
    writeFileSync(file(), JSON.stringify([result, ...this.list()].slice(0, 60)));
    this.state = { running: false, label: "", progress: 1, seconds, elapsed: result.seconds, live: null };
    this.emit("state", this.state);
    this.emit("done", result);
    return result;
  }
}

export const stress = new StressTest();
