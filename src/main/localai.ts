// Rigmind Local AI: a free assistant that runs on this PC through Ollama (no account, no API costs,
// nothing leaves the computer). Rigmind installs Ollama and downloads a model sized to the GPU.
import { EventEmitter } from "node:events";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { load, save } from "./store";
import { telemetry } from "./telemetry";
import { boost } from "./boost";
import type { LocalAiStatus } from "../shared/types";

const HOST = "http://127.0.0.1:11434";

/** Pick a model that fits comfortably next to a game's VRAM needs. */
function recommend(vramGB: number | null): string {
  if (vramGB != null && vramGB >= 12) return "qwen3:8b";
  if (vramGB != null && vramGB >= 6) return "qwen3:4b";
  return "qwen3:1.7b";
}

async function api<T = any>(path: string, body?: object, timeoutMs = 120_000): Promise<T> {
  const res = await fetch(HOST + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Local AI error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

function ollamaExe(): string | null {
  const local = process.env.LOCALAPPDATA ?? "";
  const candidates = [join(local, "Programs", "Ollama", "ollama.exe"), join(process.env.ProgramFiles ?? "C:\\Program Files", "Ollama", "ollama.exe")];
  return candidates.find(existsSync) ?? null;
}

class LocalAi extends EventEmitter {
  private pulling: LocalAiStatus["pulling"] = null;

  init() {
    // Free the GPU's memory for the game: unload the model when a game starts.
    boost.on("started", () => void this.unload());
  }

  async running(): Promise<boolean> {
    try {
      await api("/api/version", undefined, 2000);
      return true;
    } catch {
      return false;
    }
  }

  async status(): Promise<LocalAiStatus> {
    const running = await this.running();
    let models: string[] = [];
    if (running) models = ((await api<{ models: { name: string }[] }>("/api/tags").catch(() => ({ models: [] }))).models ?? []).map((m) => m.name);
    const vramMB = telemetry.latest()?.gpu?.vramTotalMB ?? null;
    const vramGB = vramMB ? Math.round(vramMB / 1024) : null;
    return { installed: running || !!ollamaExe(), running, models, recommended: recommend(vramGB), vramGB, pulling: this.pulling };
  }

  private async ensureRunning(): Promise<boolean> {
    if (await this.running()) return true;
    const exe = ollamaExe();
    if (!exe) return false;
    spawn(exe, ["serve"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await this.running()) return true;
    }
    return false;
  }

  /** One click: install Ollama if needed, start it, download the model, and switch Rigmind to Local AI. */
  async setup(model?: string): Promise<{ ok: boolean; message: string }> {
    const st = await this.status();
    const chosen = model || st.recommended;
    if (!st.installed) {
      this.pulling = { model: chosen, pct: 0, status: "Installing Ollama…" };
      this.emit("status", await this.status());
      const ok = await new Promise<boolean>((resolve) =>
        execFile("winget", ["install", "--id", "Ollama.Ollama", "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements"], { windowsHide: true, timeout: 900_000 }, (err, out) => resolve(!err || /already installed/i.test(out)))
      );
      if (!ok) {
        this.pulling = null;
        return { ok: false, message: "Couldn't install Ollama with winget. Install it from ollama.com, then try again." };
      }
    }
    if (!(await this.ensureRunning())) {
      this.pulling = null;
      return { ok: false, message: "Ollama is installed but didn't start. Open Ollama from the Start menu, then try again." };
    }
    // Download the model with progress.
    this.pulling = { model: chosen, pct: 0, status: "Downloading model…" };
    this.emit("status", await this.status());
    try {
      const res = await fetch(HOST + "/api/pull", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: chosen, stream: true }) });
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let lastEmit = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          try {
            const j = JSON.parse(line);
            if (j.error) throw new Error(j.error);
            if (j.total && j.completed) this.pulling = { model: chosen, pct: j.completed / j.total, status: "Downloading model…" };
            if (Date.now() - lastEmit > 500) {
              lastEmit = Date.now();
              this.emit("status", await this.status());
            }
          } catch (e: any) {
            if (e?.message && !/JSON/.test(e.message)) throw e;
          }
        }
      }
    } catch (e: any) {
      this.pulling = null;
      this.emit("status", await this.status());
      return { ok: false, message: e?.message ?? String(e) };
    }
    this.pulling = null;
    save({ aiProvider: "local", localModel: chosen });
    this.emit("status", await this.status());
    return { ok: true, message: `Rigmind Local AI is ready (${chosen}). It runs entirely on this PC.` };
  }

  async unload() {
    const m = load().localModel;
    if (m && (await this.running())) await api("/api/chat", { model: m, messages: [], keep_alive: 0 }, 5000).catch(() => {});
  }

  /** One chat turn with tools, in Ollama's native format. */
  async chat(messages: any[], tools: any[], maxTokens: number): Promise<{ content: string; tool_calls: { function: { name: string; arguments: any } }[] }> {
    if (!(await this.ensureRunning())) throw new Error("Rigmind Local AI isn't running. Open Settings > AI to set it up.");
    const model = load().localModel;
    if (!model) throw new Error("Rigmind Local AI isn't set up yet. Open Settings > AI.");
    const r = await api<{ message: { content: string; tool_calls?: any[] } }>("/api/chat", {
      model,
      messages,
      tools,
      stream: false,
      think: false,
      options: { num_predict: maxTokens, temperature: 0.3, num_ctx: 16384 },
      // Stay loaded for a while on the desktop, but never hold GPU memory during a game.
      keep_alive: boost.state.active ? 0 : "10m",
    }, 300_000);
    return { content: (r.message.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim(), tool_calls: r.message.tool_calls ?? [] };
  }
}

export const localAi = new LocalAi();
