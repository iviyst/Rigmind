// Automations: rules written in plain English, turned into a fixed set of triggers and actions.
// Claude only translates; the engine below runs the rule, and only these actions exist.
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { powerMonitor, Notification } from "electron";
import { dataDir, load, save } from "./store";
import { boost } from "./boost";
import { telemetry } from "./telemetry";
import { hw } from "./hw";
import { fans } from "./fans";
import { rgb } from "./rgb";
import * as win from "./winsys";
import { history } from "./history";
import type { GameState, ProcInfo, Rule, RuleAction } from "../shared/types";

const file = () => join(dataDir("automations"), "rules.json");

function inWindow(from: string, to: string, d = new Date()) {
  const m = d.getHours() * 60 + d.getMinutes();
  const [a, b] = [from, to].map((s) => s.split(":").map(Number)).map(([h, mm]) => h * 60 + mm);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

class Automations extends EventEmitter {
  private rules: Rule[] | null = null;
  private lastFired = new Map<string, number>();
  private knownApps = new Set<string>();
  private idleFired = new Set<string>();

  list(): Rule[] {
    if (this.rules) return this.rules;
    try {
      this.rules = existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : [];
    } catch {
      this.rules = [];
    }
    return this.rules!;
  }
  private persist() {
    writeFileSync(file(), JSON.stringify(this.list()));
    this.emit("changed", this.list());
  }
  add(r: Omit<Rule, "id" | "lastRun" | "enabled">): Rule[] {
    this.list().unshift({ ...r, id: randomUUID(), enabled: true, lastRun: null });
    this.persist();
    return this.list();
  }
  toggle(id: string, enabled: boolean) {
    const r = this.list().find((x) => x.id === id);
    if (r) r.enabled = enabled;
    this.persist();
    return this.list();
  }
  remove(id: string) {
    this.rules = this.list().filter((x) => x.id !== id);
    this.persist();
    return this.list();
  }

  init() {
    boost.on("started", (g: GameState) => this.fire((t) => t.type === "game_start" && (!t.game || t.game.toLowerCase() === (g.exe ?? "").toLowerCase() || t.game.toLowerCase() === (g.game ?? "").toLowerCase())));
    boost.on("ended", () => this.fire((t) => t.type === "game_end"));
    telemetry.on("sample", () => {
      const cpu = hw.cpuTemp() ?? telemetry.latest()?.cpu.temp ?? null;
      const gpu = telemetry.latest()?.gpu?.temp ?? null;
      this.fire((t) => t.type === "temp_above" && ((t.source === "cpu" && (cpu ?? 0) > t.value) || (t.source === "gpu" && (gpu ?? 0) > t.value)), 5 * 60_000);
    });
    telemetry.on("procs", (procs: ProcInfo[]) => {
      const names = new Set(procs.map((p) => p.name.toLowerCase()));
      const fresh = [...names].filter((n) => !this.knownApps.has(n));
      if (this.knownApps.size) for (const n of fresh) this.fire((t) => t.type === "app_start" && t.app.toLowerCase().replace(/\.exe$/, "") === n, 60_000);
      this.knownApps = names;
    });
    setInterval(() => {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      this.fire((t) => t.type === "time" && t.at === hhmm, 70_000);
      const idleMin = powerMonitor.getSystemIdleTime() / 60;
      for (const r of this.list()) {
        if (r.trigger.type !== "idle") continue;
        if (idleMin >= r.trigger.minutes && !this.idleFired.has(r.id)) {
          this.idleFired.add(r.id);
          void this.run(r);
        } else if (idleMin < 1) this.idleFired.delete(r.id);
      }
    }, 30_000);
  }

  private fire(match: (t: Rule["trigger"]) => boolean, cooldownMs = 0) {
    for (const r of this.list()) {
      if (!r.enabled || !match(r.trigger)) continue;
      if (r.between && !inWindow(r.between.from, r.between.to)) continue;
      if (cooldownMs && Date.now() - (this.lastFired.get(r.id) ?? 0) < cooldownMs) continue;
      this.lastFired.set(r.id, Date.now());
      void this.run(r);
    }
  }

  async run(r: Rule) {
    for (const a of r.actions) await this.act(a).catch(() => {});
    r.lastRun = Date.now();
    this.persist();
    history.record(`Automation ran: ${r.summary}`, "automation", null);
  }

  private async act(a: RuleAction) {
    switch (a.type) {
      case "fan_profile":
        fans.saveSettings(boost.state.active ? { gameProfile: a.value } : { desktopProfile: a.value });
        break;
      case "light_mode":
        rgb.saveSettings({ mode: a.value });
        break;
      case "light_color":
        if (/^#[0-9a-f]{6}$/i.test(a.value)) rgb.saveSettings({ mode: "static", color: a.value });
        break;
      case "pause_app": {
        const paused = await win.suspendByName([a.value]);
        if (boost.state.active) boost.adoptPaused(paused);
        else setTimeout(() => void win.resumePids(paused.map((p) => p.pid)), 60 * 60_000); // never leave apps frozen outside a game for long
        break;
      }
      case "end_app":
        if (!win.isProtected(a.value)) await win.endProcess(a.value);
        break;
      case "power_plan":
        await win.setPowerScheme(a.value === "high" ? win.HIGH_PERF : win.BALANCED);
        break;
      case "notify":
        new Notification({ title: "Rigmind", body: a.value.slice(0, 200) }).show();
        break;
    }
  }
}

export const automations = new Automations();
