// Talks to rigmind-hw.exe (C#, LibreHardwareMonitorLib): sensors in, fan commands out.
import { EventEmitter } from "node:events";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resource } from "./paths";
import { randomUUID } from "node:crypto";
import type { FanInfo, HwStatus, TempReading, DisplayInfo } from "../shared/types";

interface RawSensor { id: string; name: string; type: string; index: number; min?: number; max?: number }
interface RawHardware { id: string; name: string; type: string; parent?: string | null; sensors: RawSensor[] }

const exePath = () => resource("rigmind-hw", "rigmind-hw.exe");

class HardwareHelper extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private hardware: RawHardware[] = [];
  private values: Record<string, number> = {};
  private lastSample = 0;
  private ping: ReturnType<typeof setInterval> | null = null;
  private stopping = false;
  pawnio = false;
  error: string | null = null;
  private pending = new Map<string, { resolve: (v: any) => void; timer: ReturnType<typeof setTimeout> }>();

  get running() {
    return !!this.proc && Date.now() - this.lastSample < 5000;
  }
  get built() {
    return existsSync(exePath());
  }
  /** Milliseconds since the last sensor sample. */
  get age() {
    return this.lastSample ? Date.now() - this.lastSample : Infinity;
  }

  start() {
    if (this.proc || !this.built) {
      if (!this.built) this.error = "The hardware helper isn't built yet. Run npm run build:hw.";
      return;
    }
    this.stopping = false;
    const p = spawn(exePath(), [], { windowsHide: true });
    this.proc = p;
    let buf = "";
    p.stdout.on("data", (d) => {
      buf += d.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line.startsWith("{")) {
          try {
            this.onMessage(JSON.parse(line));
          } catch {
            /* ignore */
          }
        }
      }
    });
    p.on("error", (e) => (this.error = e.message));
    p.on("close", () => {
      this.proc = null;
      if (this.ping) clearInterval(this.ping);
      this.emit("status", this.status());
      if (!this.stopping) setTimeout(() => this.start(), 5000);
    });
    // Heartbeat: without it the helper hands fans back to the BIOS after 5 s.
    this.ping = setInterval(() => this.send({ cmd: "ping" }), 1000);
  }

  stop() {
    this.stopping = true;
    this.send({ cmd: "defaultAll" });
    setTimeout(() => this.proc?.kill(), 300);
  }

  restart() {
    this.stop();
    setTimeout(() => this.start(), 800);
  }

  send(cmd: object) {
    if (this.proc?.stdin.writable) this.proc.stdin.write(JSON.stringify(cmd) + "\n");
  }

  /** Send a command that answers with a message carrying the same id. Resolves null on timeout. */
  request<T = any>(cmd: Record<string, unknown>, timeoutMs = 10_000): Promise<T | null> {
    if (!this.proc) return Promise.resolve(null);
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.send({ ...cmd, id });
    });
  }

  setPingTargets(targets: string[]) {
    this.send({ cmd: "ping", targets });
  }
  snap(path: string, width = 480) {
    return this.request<{ ok: boolean; path: string }>({ cmd: "snap", path, w: width }, 8000);
  }
  avgColor() {
    return this.request<{ r: number; g: number; b: number }>({ cmd: "avgcolor" }, 2000);
  }
  displays() {
    return this.request<{ list: DisplayInfo[] }>({ cmd: "displays" }, 8000).then((r) => r?.list ?? []);
  }
  setRefresh(device: string, hz: number) {
    return this.request<{ ok: boolean; msg: string }>({ cmd: "setrefresh", device, hz }, 8000);
  }
  listen(seconds = 8) {
    return this.request<{ text: string; error?: string }>({ cmd: "listen", seconds }, (seconds + 6) * 1000);
  }
  say(text: string) {
    this.send({ cmd: "say", text });
  }
  cpuPower(): number | null {
    const c = this.find((h, s) => h.type === "Cpu" && s.type === "Power" && /package/i.test(s.name));
    return c.length ? c[0].v : null;
  }

  setFan(controlId: string, pct: number) {
    this.send({ cmd: "set", id: controlId, value: Math.round(pct) });
  }
  releaseFan(controlId: string) {
    this.send({ cmd: "default", id: controlId });
  }
  releaseAll() {
    this.send({ cmd: "defaultAll" });
  }

  private onMessage(m: any) {
    if (m.type === "hello") {
      this.hardware = m.hardware;
      this.pawnio = !!m.pawnio;
      this.error = null;
    } else if (m.type === "sensors") {
      this.values = m.s;
      this.lastSample = Date.now();
      this.emit("sample", this.values);
      this.emit("status", this.status());
    } else if (m.type === "error") {
      this.error = m.msg;
    } else if (m.type === "ping") {
      this.emit("ping", m.r as { host: string; ms: number | null }[]);
    }
    // Replies to request(): matched by id.
    if (m.id && this.pending.has(m.id)) {
      const p = this.pending.get(m.id)!;
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      p.resolve(m);
    }
  }

  private find(pred: (h: RawHardware, s: RawSensor) => boolean): { h: RawHardware; s: RawSensor; v: number }[] {
    const out: { h: RawHardware; s: RawSensor; v: number }[] = [];
    for (const h of this.hardware)
      for (const s of h.sensors) {
        const v = this.values[s.id];
        if (v != null && pred(h, s)) out.push({ h, s, v });
      }
    return out;
  }

  cpuTemp(): number | null {
    const c = this.find((h, s) => h.type === "Cpu" && s.type === "Temperature" && /package|tctl|tdie/i.test(s.name));
    return c.length ? Math.round(c[0].v) : null;
  }
  gpuTemp(): number | null {
    const g = this.find((h, s) => /^Gpu/.test(h.type) && s.type === "Temperature" && /^GPU Core$/i.test(s.name));
    return g.length ? Math.round(g[0].v) : null;
  }
  gpuHotspot(): number | null {
    const g = this.find((h, s) => /^Gpu/.test(h.type) && s.type === "Temperature" && /hot ?spot/i.test(s.name));
    return g.length ? Math.round(g[0].v) : null;
  }
  liquidTemp(): number | null {
    const l = this.find((_h, s) => s.type === "Temperature" && /liquid|coolant|water/i.test(s.name));
    return l.length ? Math.round(l[0].v) : null;
  }

  fans(): FanInfo[] {
    const out: FanInfo[] = [];
    for (const h of this.hardware)
      for (const s of h.sensors) {
        if (s.type !== "Control") continue;
        // The RPM sensor for a control usually shares its hardware and index.
        const rpmSensor = h.sensors.find((x) => x.type === "Fan" && x.index === s.index) ?? null;
        out.push({
          controlId: s.id,
          name: s.name,
          hardware: h.name,
          rpm: rpmSensor ? this.values[rpmSensor.id] ?? null : null,
          percent: this.values[s.id] ?? null,
          min: s.min ?? 0,
          max: s.max ?? 100,
        });
      }
    return out;
  }

  temps(): TempReading[] {
    return this.find((_h, s) => s.type === "Temperature")
      .filter((x) => x.v > 0 && x.v < 130)
      .map((x) => ({ id: x.s.id, name: x.s.name, hardware: x.h.name, value: Math.round(x.v) }));
  }

  status(): HwStatus {
    return { running: this.running, built: this.built, pawnio: this.pawnio, error: this.error, fans: this.fans(), temps: this.temps() };
  }
}

export const hw = new HardwareHelper();
