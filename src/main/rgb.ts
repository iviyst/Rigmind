// RGB lighting through OpenRGB's SDK server (localhost:6742).
// Lighting reflects the PC: calm blue at idle, shifting to magenta as temps rise,
// a red pulse at critical temps, quick flashes for events, and game scenes.
import { EventEmitter } from "node:events";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { powerMonitor } from "electron";
import { Client } from "openrgb-sdk";
import { load, save } from "./store";
import { telemetry } from "./telemetry";
import { hw } from "./hw";
import type { RgbSettings, RgbStatus } from "../shared/types";
import { gsi, type GameEvent } from "./gsi";

type RGB = { red: number; green: number; blue: number };
const hex = (h: string): RGB => {
  const n = parseInt(h.replace("#", ""), 16);
  return { red: (n >> 16) & 255, green: (n >> 8) & 255, blue: n & 255 };
};
const toHex = (c: RGB) => "#" + [c.red, c.green, c.blue].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const mix = (a: RGB, b: RGB, f: number): RGB => ({ red: a.red + (b.red - a.red) * f, green: a.green + (b.green - a.green) * f, blue: a.blue + (b.blue - a.blue) * f });
const scale = (c: RGB, f: number): RGB => ({ red: c.red * f, green: c.green * f, blue: c.blue * f });

const COOL = hex("#2f95db");
const WARM = hex("#e2468b");
const RED = hex("#ff2a2a");
const BLACK: RGB = { red: 0, green: 0, blue: 0 };

function inWindow(from: string, to: string, d = new Date()): boolean {
  const m = d.getHours() * 60 + d.getMinutes();
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  const a = fh * 60 + fm, b = th * 60 + tm;
  return a <= b ? m >= a && m < b : m >= a || m < b; // handles overnight windows
}

export function findOpenRgb(): string | null {
  const custom = load().rgb.openRgbPath;
  if (custom && existsSync(custom)) return custom;
  const pf = process.env.ProgramFiles ?? "C:\\Program Files";
  const local = process.env.LOCALAPPDATA ?? "";
  const direct = [join(pf, "OpenRGB", "OpenRGB.exe"), join(local, "Programs", "OpenRGB", "OpenRGB.exe")].find(existsSync);
  if (direct) return direct;
  const pk = join(local, "Microsoft", "WinGet", "Packages");
  try {
    for (const d of readdirSync(pk).filter((n) => /openrgb/i.test(n))) {
      const stack = [join(pk, d)];
      while (stack.length) {
        const dir = stack.pop()!;
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.isFile() && /^openrgb\.exe$/i.test(e.name)) return join(dir, e.name);
          if (e.isDirectory()) stack.push(join(dir, e.name));
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

class RgbEngine extends EventEmitter {
  private client: Client | null = null;
  private devices: RgbStatus["devices"] = [];
  private lastHex = "";
  private flashUntil = 0;
  private flashColor: RGB = { red: 255, green: 255, blue: 255 };
  private gameColor: string | null = null;
  private reason = "";
  private error: string | null = null;
  private connecting = false;
  private lastStaticSend = 0;
  private screenColor: RGB | null = null;
  private screenBusy = false;
  private effect: { until: number; color: RGB; pulse: boolean; label: string } | null = null;
  private lowHealth = false;
  private staticHex = ""; // last color actually sent to Static-mode devices

  init() {
    setInterval(() => this.tick(), 250);
    // Screen glow: sample the average screen color 4x a second.
    setInterval(() => {
      if (this.settings().mode !== "screen" || !this.client || this.screenBusy) return;
      this.screenBusy = true;
      void hw.avgColor().then((c) => {
        this.screenBusy = false;
        if (c) this.screenColor = { red: c.r, green: c.g, blue: c.b };
      });
    }, 250);
    // Game-reactive lighting from CS2 / Dota 2.
    gsi.on("event", (e: GameEvent) => this.onGameEvent(e));
    setInterval(() => this.ensureConnected(), 15_000);
    // OpenRGB can take 5-20 s to detect RAM and motherboards: keep asking until devices show up.
    setInterval(() => {
      if (this.client && !this.devices.length) void this.refreshDevices();
    }, 5_000);
    this.ensureConnected();
  }

  settings(): RgbSettings {
    return load().rgb;
  }
  saveSettings(patch: Partial<RgbSettings>): RgbSettings {
    const next = save({ rgb: { ...this.settings(), ...patch } }).rgb;
    this.lastHex = ""; // force a repaint
    this.staticHex = "";
    if (next.enabled) this.ensureConnected();
    return next;
  }

  setGame(color: string | null) {
    this.gameColor = color;
  }

  private onGameEvent(e: GameEvent) {
    if (!load().extras.gameLighting) return;
    const now = Date.now();
    if (e.kind === "health") this.lowHealth = e.value > 0 && e.value <= 30;
    if (e.kind === "death") {
      this.lowHealth = false;
      this.effect = { until: now + 2500, color: hex("#ff2a2a"), pulse: false, label: "Eliminated" };
    } else if (e.kind === "kill") this.effect = { until: now + 600, color: hex("#ffffff"), pulse: false, label: "Kill" };
    else if (e.kind === "flash") this.effect = { until: now + 1500, color: hex("#ffffff"), pulse: false, label: "Flashed" };
    else if (e.kind === "bomb" && e.state === "planted") this.effect = { until: now + 40_000, color: hex("#ff6a00"), pulse: true, label: "Bomb planted" };
    else if (e.kind === "bomb" && e.state === "defused") this.effect = { until: now + 2500, color: hex("#2f95db"), pulse: false, label: "Bomb defused" };
    else if (e.kind === "bomb" && e.state === "exploded") this.effect = { until: now + 2500, color: hex("#ffb000"), pulse: false, label: "Bomb exploded" };
    else if (e.kind === "round") {
      this.effect = null;
      this.lowHealth = false;
    }
  }

  /** Short flash, e.g. when a session report or driver update is ready. */
  flash(color = "#ffffff") {
    this.flashColor = hex(color);
    this.flashUntil = Date.now() + 1800;
  }

  async launch(): Promise<{ ok: boolean; message: string }> {
    const exe = findOpenRgb();
    if (!exe) return { ok: false, message: "OpenRGB isn't installed. Use Install OpenRGB first." };
    spawn(exe, ["--server", "--startminimized"], { detached: true, stdio: "ignore" }).unref();
    await new Promise((r) => setTimeout(r, 4000));
    await this.ensureConnected();
    return this.client ? { ok: true, message: `Connected to OpenRGB: ${this.devices.length} device(s).` } : { ok: false, message: "OpenRGB started but its SDK server isn't answering. In OpenRGB, open SDK Server and click Start Server." };
  }

  private async ensureConnected() {
    if (!this.settings().enabled || this.client || this.connecting) return;
    this.connecting = true;
    try {
      const c = new Client("Rigmind", 6742, "127.0.0.1");
      await c.connect(2000);
      c.on("disconnect", () => {
        this.client = null;
        this.devices = [];
        this.emit("status", this.status());
      });
      // OpenRGB tells clients when it finishes detecting or rescans hardware.
      c.on("deviceListUpdated", () => void this.refreshDevices());
      this.client = c;
      this.error = null;
      await this.refreshDevices();
    } catch {
      this.error = "OpenRGB isn't running with its SDK server on.";
      this.client = null;
    } finally {
      this.connecting = false;
      this.emit("status", this.status());
    }
  }

  /** Re-read OpenRGB's device list and put each device in a mode Rigmind can drive. */
  private async refreshDevices() {
    const c = this.client;
    if (!c) return;
    try {
      const all = await c.getAllControllerData();
      this.devices = all.map((d: any, i: number) => {
        const leds = d.leds?.length ?? d.colors?.length ?? 0;
        const modes: string[] = (d.modes ?? []).map((m: any) => String(m.name).toLowerCase());
        const state: RgbStatus["devices"][number]["state"] =
          leds === 0 ? "no-leds" : modes.includes("direct") || modes.includes("custom") ? "direct" : modes.includes("static") ? "static" : "unsupported";
        return { id: i, name: d.name, type: String(d.type), leds, state };
      });
      for (const d of this.devices) if (d.state === "direct") c.setCustomMode(d.id);
      this.lastHex = ""; // repaint everything with the current color
      this.staticHex = "";
    } catch {
      /* keep the old list; we'll try again */
    }
    this.emit("status", this.status());
  }

  private pick(): RGB {
    const s = this.settings();
    const now = Date.now();
    if (now < this.flashUntil) {
      const on = Math.floor((this.flashUntil - now) / 300) % 2 === 0;
      this.reason = "Notification";
      return on ? this.flashColor : BLACK;
    }
    const cpu = hw.cpuTemp() ?? telemetry.latest()?.cpu.temp ?? null;
    const gpu = hw.gpuTemp() ?? telemetry.latest()?.gpu?.temp ?? null;
    // Game events beat everything except heat alerts.
    if (this.effect && now < this.effect.until && !((cpu ?? 0) >= 90 || (gpu ?? 0) >= 85)) {
      this.reason = this.effect.label;
      return this.effect.pulse ? scale(this.effect.color, 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(now / (this.effect.until - now < 10_000 ? 90 : 220)))) : this.effect.color;
    }
    if (this.lowHealth && load().extras.gameLighting) {
      this.reason = "Low health";
      return scale(RED, 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(now / 160)));
    }
    if (s.alerts && ((cpu ?? 0) >= 90 || (gpu ?? 0) >= 85)) {
      this.reason = `Hot: CPU ${cpu ?? "?"}°C, GPU ${gpu ?? "?"}°C`;
      const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now / 250));
      return scale(RED, pulse);
    }
    if (s.mode === "off") return (this.reason = "Lights off"), BLACK;
    if (s.schedule.enabled && inWindow(s.schedule.from, s.schedule.to)) return (this.reason = `Off until ${s.schedule.to}`), BLACK;
    if (s.idleOffMin > 0 && powerMonitor.getSystemIdleTime() > s.idleOffMin * 60) return (this.reason = "Off while idle"), BLACK;
    if (s.mode === "screen") return (this.reason = "Matching your screen"), this.screenColor ?? COOL;
    if (s.gameScenes && this.gameColor) return (this.reason = "Game scene"), hex(this.gameColor);
    if (s.mode === "static") return (this.reason = "Static color"), hex(s.color);
    // Status mode: blend from cool to warm as the hottest component goes from 40°C to 85°C.
    const temps = [cpu, gpu].filter((x): x is number => x != null);
    if (temps.length) {
      const t = Math.max(...temps);
      this.reason = `Hottest part ${t}°C`;
      return mix(COOL, WARM, Math.max(0, Math.min(1, (t - 40) / 45)));
    }
    const busy = Math.max(telemetry.latest()?.cpu.load ?? 0, telemetry.latest()?.gpu?.load ?? 0);
    this.reason = `Load ${Math.round(busy)}%`;
    return mix(COOL, WARM, busy / 100);
  }

  private tick() {
    const s = this.settings();
    if (!s.enabled || !this.client) return;
    const c = scale(this.pick(), s.brightness / 100);
    const h = toHex(c);
    const col = { red: Math.round(c.red), green: Math.round(c.green), blue: Math.round(c.blue) };
    // Static-only devices (common on RAM and some controllers) are slow: at most 2 updates per second,
    // and only when the color actually changed.
    const staticDue = h !== this.staticHex && Date.now() - this.lastStaticSend > 500 && this.devices.some((d) => d.state === "static");
    if (h === this.lastHex && !staticDue) return;
    try {
      for (const d of this.devices) {
        if (d.state === "direct" && h !== this.lastHex) this.client.updateLeds(d.id, Array(d.leds).fill(col));
        else if (d.state === "static" && staticDue) void this.client.updateMode(d.id, { name: "Static", colors: [col] }).catch(() => {});
      }
    } catch {
      this.client = null;
    }
    if (staticDue) {
      this.staticHex = h;
      this.lastStaticSend = Date.now();
    }
    this.lastHex = h;
    this.emit("status", this.status());
  }

  status(): RgbStatus {
    return { connected: !!this.client, installed: !!findOpenRgb(), devices: this.devices, current: this.lastHex || "#000000", reason: this.reason, error: this.error, gameEvent: this.effect && Date.now() < this.effect.until ? this.effect.label : null };
  }
}

export const rgb = new RgbEngine();
