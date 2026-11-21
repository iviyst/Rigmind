// App Boost: Game Boost for heavy work. When a known work app is actually busy (exporting, building,
// rendering, recalculating) Rigmind raises its priority, pauses cloud sync, uses the fast power plan
// and keeps the PC awake. Everything is put back when the job ends, and the job time is recorded.
import { EventEmitter } from "node:events";
import { cpus } from "node:os";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { telemetry } from "./telemetry";
import { boost } from "./boost";
import { hw } from "./hw";
import { load, save, dataDir } from "./store";
import { workFeatures } from "./mode";
import * as win from "./winsys";
import type { AppBoostState, AppJob, ProcInfo, WorkApp } from "../shared/types";

export const KNOWN_WORK_APPS: WorkApp[] = [
  { exe: "adobe premiere pro", name: "Premiere Pro", kind: "video" },
  { exe: "resolve", name: "DaVinci Resolve", kind: "video" },
  { exe: "afterfx", name: "After Effects", kind: "video" },
  { exe: "adobe media encoder", name: "Media Encoder", kind: "video" },
  { exe: "photoshop", name: "Photoshop", kind: "video" },
  { exe: "lightroom", name: "Lightroom Classic", kind: "video" },
  { exe: "handbrake", name: "HandBrake", kind: "video" },
  { exe: "blender", name: "Blender", kind: "3d" },
  { exe: "acad", name: "AutoCAD", kind: "3d" },
  { exe: "sldworks", name: "SolidWorks", kind: "3d" },
  { exe: "fusion360", name: "Fusion", kind: "3d" },
  { exe: "msbuild", name: "MSBuild", kind: "code" },
  { exe: "devenv", name: "Visual Studio", kind: "code" },
  { exe: "dotnet", name: ".NET build", kind: "code" },
  { exe: "cl", name: "C++ compiler", kind: "code" },
  { exe: "cargo", name: "Cargo", kind: "code" },
  { exe: "rustc", name: "Rust compiler", kind: "code" },
  { exe: "gradle", name: "Gradle", kind: "code" },
  { exe: "excel", name: "Excel", kind: "office" },
  { exe: "pbidesktop", name: "Power BI", kind: "office" },
  { exe: "msaccess", name: "Access", kind: "office" },
  { exe: "arcgispro", name: "ArcGIS Pro", kind: "gis" },
  { exe: "qgis-bin", name: "QGIS", kind: "gis" },
  { exe: "qgis", name: "QGIS", kind: "gis" },
];
const SYNC_APPS = ["OneDrive", "GoogleDriveFS", "Dropbox", "box", "iCloudDrive"];
const CORES = Math.max(1, cpus().length);
const jobsFile = () => join(dataDir("appboost"), "jobs.json");

class AppBoost extends EventEmitter {
  private busySince = new Map<string, number>(); // exe -> first busy poll
  private quietSince: number | null = null;
  private active: AppBoostState["active"] = null;
  private paused: { pid: number; name: string }[] = [];
  private savedScheme: string | null = null;
  private jobs: AppJob[] = [];
  private pids: number[] = [];

  init() {
    try {
      this.jobs = existsSync(jobsFile()) ? JSON.parse(readFileSync(jobsFile(), "utf8")) : [];
    } catch {
      this.jobs = [];
    }
    telemetry.on("procs", (p: ProcInfo[]) => void this.onProcs(p));
  }

  apps(): WorkApp[] {
    return [...KNOWN_WORK_APPS, ...load().appBoost.custom];
  }

  state(): AppBoostState {
    return { enabled: load().appBoost.enabled, active: this.active, jobs: this.jobs.slice(0, 50), apps: this.apps() };
  }

  save(patch: { enabled?: boolean; addExe?: string; removeExe?: string }): AppBoostState {
    const cur = load().appBoost;
    let custom = cur.custom;
    if (patch.addExe) {
      const exe = patch.addExe.toLowerCase().replace(/\.exe$/, "").trim().slice(0, 60);
      if (exe && !this.apps().some((a) => a.exe === exe)) custom = [...custom, { exe, name: patch.addExe.replace(/\.exe$/i, ""), kind: "custom" }];
    }
    if (patch.removeExe) custom = custom.filter((a) => a.exe !== patch.removeExe);
    save({ appBoost: { enabled: patch.enabled ?? cur.enabled, custom } });
    if (patch.enabled === false && this.active) void this.end();
    this.emit("state", this.state());
    return this.state();
  }

  /** Total CPU share of each known app's processes, as % of one core. */
  private usage(procs: ProcInfo[]) {
    const out = new Map<string, { app: WorkApp; coreLoad: number; pids: number[] }>();
    const apps = this.apps();
    for (const p of procs) {
      const n = p.name.toLowerCase();
      const app = apps.find((a) => a.exe === n);
      if (!app) continue;
      const cur = out.get(app.exe) ?? { app, coreLoad: 0, pids: [] };
      cur.coreLoad += (p.cpu * CORES) / 100;
      cur.pids.push(p.pid);
      out.set(app.exe, cur);
    }
    return out;
  }

  private async onProcs(procs: ProcInfo[]) {
    if (!load().appBoost.enabled || !workFeatures() || boost.state.active) {
      if (this.active) await this.end();
      return;
    }
    const now = Date.now();
    const usage = this.usage(procs);
    if (this.active) {
      const u = usage.get(this.active.exe);
      // Busy means at least ~half a core for office apps, 1.5 cores for the rest.
      if (u && u.coreLoad >= this.threshold(u.app)) {
        this.quietSince = null;
        this.pids = u.pids;
      } else if (!this.quietSince) this.quietSince = now;
      else if (now - this.quietSince > 15_000) await this.end();
      return;
    }
    for (const [exe, u] of usage) {
      if (u.coreLoad >= this.threshold(u.app)) {
        const since = this.busySince.get(exe) ?? now;
        this.busySince.set(exe, since);
        if (now - since >= (u.app.kind === "office" ? 10_000 : 20_000)) {
          await this.begin(u.app, u.pids, since);
          return;
        }
      } else this.busySince.delete(exe);
    }
    for (const exe of [...this.busySince.keys()]) if (!usage.has(exe)) this.busySince.delete(exe);
  }

  private threshold(app: WorkApp) {
    return app.kind === "office" ? 0.6 : 1.5;
  }

  private async begin(app: WorkApp, pids: number[], since: number) {
    this.pids = pids;
    for (const pid of pids) await win.setPriority(pid, "AboveNormal").catch(() => {});
    this.paused = await win.suspendByName(SYNC_APPS).catch(() => []);
    const cur = await win.getActivePowerScheme().catch(() => null);
    if (cur && cur !== win.HIGH_PERF) {
      this.savedScheme = cur;
      await win.setPowerScheme(win.HIGH_PERF).catch(() => {});
    }
    hw.keepAwake(true);
    this.active = { app: app.name, exe: app.exe, since, paused: [...new Set(this.paused.map((p) => p.name))] };
    this.emit("state", this.state());
    this.emit("started", this.active);
  }

  /** Put everything back and record the job. Safe to call more than once. */
  async end() {
    const a = this.active;
    if (!a) return;
    this.active = null;
    if (this.paused.length) await win.resumePids(this.paused.map((p) => p.pid)).catch(() => {});
    this.paused = [];
    if (this.savedScheme) await win.setPowerScheme(this.savedScheme).catch(() => {});
    this.savedScheme = null;
    hw.keepAwake(false);
    for (const pid of this.pids) await win.setPriority(pid, "Normal").catch(() => {});
    this.busySince.clear();
    this.quietSince = null;
    const end = Date.now() - 15_000; // the job ended when it went quiet
    const seconds = Math.max(1, Math.round((end - a.since) / 1000));
    const prev = this.jobs.filter((j) => j.exe === a.exe).slice(0, 10);
    const avg = prev.length ? prev.reduce((s, j) => s + j.seconds, 0) / prev.length : null;
    const job: AppJob = { id: randomUUID(), app: a.app, exe: a.exe, start: a.since, end, seconds, vsAvgPct: avg ? Math.round(((seconds - avg) / avg) * 100) : null };
    if (seconds >= 20) {
      this.jobs.unshift(job);
      this.jobs = this.jobs.slice(0, 300);
      writeFileSync(jobsFile(), JSON.stringify(this.jobs));
      this.emit("job", job);
    }
    this.emit("state", this.state());
  }
}

export const appBoost = new AppBoost();
