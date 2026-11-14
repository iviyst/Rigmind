// Crash Detective: watches the Windows event log for crashes, GPU driver resets, hardware errors,
// blue screens and power loss, and attaches what the PC was doing at that moment.
// A "flight recorder" saves the last 5 minutes of sensor data to disk, so even after a hard
// shutdown Rigmind knows the temperatures and power draw right before it happened.
import { EventEmitter } from "node:events";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./store";
import { runPsJson } from "./ps";
import { telemetry } from "./telemetry";
import { listSessions, getSession } from "./sessions";
import { currentDriver } from "./tune";
import type { Incident, IncidentKind, Telemetry } from "../shared/types";

const file = () => join(dataDir("incidents"), "incidents.json");
const blackbox = () => join(dataDir("incidents"), "flight-recorder.json");

interface RawEvent { log: string; id: number; provider: string; t: number; rec: number; data: string[]; msg: string }

const QUERY = (sinceMs: number) => String.raw`
$start=[DateTimeOffset]::FromUnixTimeMilliseconds(${sinceMs}).LocalDateTime
$filters=@(
  @{LogName='Application';Id=1000,1002;StartTime=$start},
  @{LogName='System';Id=41,1001,4101,17,18,19,46,47;StartTime=$start}
)
$out=@()
foreach($h in $filters){
  try {
    foreach($e in Get-WinEvent -FilterHashtable $h -MaxEvents 300 -ErrorAction Stop){
      $x=[xml]$e.ToXml()
      $d=@($x.Event.EventData.Data | ForEach-Object { "$($_.'#text')" })
      $m=""; try { $m=($e.Message -split "\r?\n")[0] } catch {}
      $out+=[ordered]@{log=$e.LogName;id=$e.Id;provider=$e.ProviderName;t=[int64]([DateTimeOffset]$e.TimeCreated).ToUnixTimeMilliseconds();rec=$e.RecordId;data=$d;msg=$m}
    }
  } catch {}
}
ConvertTo-Json -InputObject @($out) -Depth 4 -Compress`;

function classify(e: RawEvent): { kind: IncidentKind; title: string; app?: string } | null {
  if (e.log === "Application" && e.id === 1000 && /Application Error/i.test(e.provider)) {
    const app = e.data[0] || "An app";
    return { kind: "app_crash", title: `${app} crashed`, app };
  }
  if (e.log === "Application" && e.id === 1002 && /Application Hang/i.test(e.provider)) {
    const app = e.data[0] || "An app";
    return { kind: "app_hang", title: `${app} froze and was closed`, app };
  }
  if (e.id === 4101 && /^Display$/i.test(e.provider)) return { kind: "gpu_reset", title: "GPU driver stopped responding and recovered" };
  if (/WHEA-Logger/i.test(e.provider)) return { kind: "hardware_error", title: e.id === 19 || e.id === 47 ? "Corrected hardware error (CPU or memory)" : "Hardware error reported" };
  if (e.id === 1001 && /WER-SystemErrorReporting/i.test(e.provider)) return { kind: "bluescreen", title: "Blue screen (system crash)" };
  if (e.id === 41 && /Kernel-Power/i.test(e.provider)) return { kind: "power_loss", title: "PC shut down unexpectedly" };
  return null;
}

class CrashDetective extends EventEmitter {
  private list: Incident[] | null = null;
  private seen = new Set<string>();
  private lastPoll = 0;

  init() {
    for (const i of this.load()) this.seen.add(i.id);
    this.lastPoll = Math.max(Date.now() - 7 * 86_400_000, ...this.load().map((i) => i.t));
    void this.poll();
    setInterval(() => void this.poll(), 120_000);
    // Flight recorder: last 5 minutes of sensors, rewritten every 15 s.
    setInterval(() => this.writeBlackbox(), 15_000);
  }

  private load(): Incident[] {
    if (this.list) return this.list;
    try {
      this.list = existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : [];
    } catch {
      this.list = [];
    }
    return this.list!;
  }
  private save() {
    writeFileSync(file(), JSON.stringify(this.load().slice(0, 300)));
  }

  private writeBlackbox() {
    const h = telemetry.history.slice(-300).map((t) => ({ t: t.t, cpu: t.cpu.load, gpu: t.gpu?.load ?? null, cpuTemp: t.cpu.temp, gpuTemp: t.gpu?.temp ?? null, gpuPowerW: t.gpu?.powerW ?? null, ramGB: +t.ram.usedGB.toFixed(1) }));
    if (h.length) writeFileSync(blackbox(), JSON.stringify(h));
  }

  private context(t: number): Incident["context"] {
    const near = <T extends { t: number }>(arr: T[]): T[] => arr.filter((x) => x.t <= t + 2000 && x.t >= t - 30_000);
    const pick = (rows: any[], source: "live" | "flight-recorder" | "session") => {
      if (!rows.length) return null;
      const max = (k: string) => {
        const v = rows.map((r) => r[k]).filter((x: any) => typeof x === "number");
        return v.length ? Math.max(...v) : null;
      };
      return { cpu: max("cpu"), gpu: max("gpu"), cpuTemp: max("cpuTemp"), gpuTemp: max("gpuTemp"), gpuPowerW: max("gpuPowerW"), ramGB: max("ramGB"), source };
    };
    const live = near(telemetry.history as Telemetry[]).map((x: any) => ({ cpu: x.cpu.load, gpu: x.gpu?.load, cpuTemp: x.cpu.temp, gpuTemp: x.gpu?.temp, gpuPowerW: x.gpu?.powerW, ramGB: x.ram.usedGB }));
    if (live.length) return pick(live, "live");
    try {
      const bb = near(JSON.parse(readFileSync(blackbox(), "utf8")));
      if (bb.length) return pick(bb, "flight-recorder");
    } catch {
      /* no recorder data */
    }
    const s = listSessions().find((x) => x.start <= t && x.end >= t - 60_000);
    if (s) {
      const d = getSession(s.id);
      const pts = d ? near(d.points).map((p) => ({ cpu: p.cpu, gpu: p.gpu, cpuTemp: p.cpuTemp, gpuTemp: p.gpuTemp, ramGB: p.ram })) : [];
      if (pts.length) return pick(pts, "session");
    }
    return null;
  }

  async poll() {
    const since = this.lastPoll - 60_000;
    const raw = await runPsJson<RawEvent[]>(QUERY(since), 60_000).catch(() => []);
    this.lastPoll = Date.now();
    const fresh: Incident[] = [];
    for (const e of raw ?? []) {
      const c = classify(e);
      const id = `${e.log}-${e.rec}`;
      if (!c || this.seen.has(id)) continue;
      // Skip the noise of Windows' own background apps crashing.
      if (c.app && /^(svchost|SearchHost|SearchApp|RuntimeBroker|backgroundTaskHost|StartMenuExperienceHost|explorer|msedgewebview2|TextInputHost)\.exe$/i.test(c.app)) continue;
      this.seen.add(id);
      const inc: Incident = {
        id,
        t: e.t,
        kind: c.kind,
        title: c.title,
        app: c.app,
        detail: [e.msg, ...e.data.filter(Boolean).slice(0, 8)].filter(Boolean).join(" | ").slice(0, 600),
        context: this.context(e.t),
        driver: currentDriver(),
        explanation: null,
      };
      fresh.push(inc);
    }
    if (fresh.length) {
      this.list = [...fresh.sort((a, b) => b.t - a.t), ...this.load()].sort((a, b) => b.t - a.t);
      this.save();
      for (const i of fresh) this.emit("incident", i);
    }
    return fresh;
  }

  all(): Incident[] {
    return this.load();
  }
  get(id: string) {
    return this.load().find((i) => i.id === id) ?? null;
  }
  setExplanation(id: string, text: string) {
    const i = this.get(id);
    if (i) {
      i.explanation = text;
      this.save();
    }
  }
}

export const incidents = new CrashDetective();
