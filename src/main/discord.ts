// Discord status ("Playing Cyberpunk 2077 · 118 FPS on RTX 4070 Ti SUPER") through Discord's local IPC pipe.
// Needs an Application ID from discord.com/developers (free) entered in Settings.
import { connect, Socket } from "node:net";
import { load } from "./store";
import { boost } from "./boost";
import { telemetry } from "./telemetry";

class DiscordPresence {
  private sock: Socket | null = null;
  private ready = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  private send(op: number, payload: object) {
    if (!this.sock) return;
    const json = Buffer.from(JSON.stringify(payload));
    const head = Buffer.alloc(8);
    head.writeInt32LE(op, 0);
    head.writeInt32LE(json.length, 4);
    this.sock.write(Buffer.concat([head, json]));
  }

  private connectPipe(i = 0) {
    const cfg = load().extras.discord;
    if (!cfg.enabled || !/^\d{15,22}$/.test(cfg.appId) || i > 9) return;
    const s = connect(`\\\\?\\pipe\\discord-ipc-${i}`);
    s.once("error", () => this.connectPipe(i + 1));
    s.once("connect", () => {
      this.sock = s;
      this.send(0, { v: 1, client_id: cfg.appId });
      s.on("data", () => (this.ready = true));
      s.on("close", () => {
        this.sock = null;
        this.ready = false;
      });
    });
  }

  apply() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.sock?.destroy();
    this.sock = null;
    if (!load().extras.discord.enabled) return;
    this.connectPipe();
    this.timer = setInterval(() => this.update(), 15_000);
  }

  private update() {
    if (!this.sock) return this.connectPipe();
    if (!this.ready) return;
    const g = boost.state;
    const t = telemetry.latest();
    const activity = g.active
      ? {
          details: `Playing ${g.game}`,
          state: [t?.fps ? `${t.fps.fps} FPS` : null, t?.gpu?.name?.replace(/NVIDIA GeForce |AMD Radeon /, "")].filter(Boolean).join(" on "),
          timestamps: g.since ? { start: Math.floor(g.since / 1000) } : undefined,
        }
      : null;
    this.send(1, { cmd: "SET_ACTIVITY", args: { pid: process.pid, activity }, nonce: String(Date.now()) });
  }
}

export const discord = new DiscordPresence();
