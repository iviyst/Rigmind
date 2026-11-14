// Long-term health: boot times, temperature trends, and how driver updates changed performance.
import { runPsJson } from "./ps";
import { listSessions, getSession } from "./sessions";
import type { BootReport, DriverImpact, HealthTrend } from "../shared/types";

// Windows logs every boot (event 100) and what slowed it down (101-110) in Diagnostics-Performance.
const BOOT_QUERY = String.raw`
$out=@()
try {
  foreach($e in Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Diagnostics-Performance/Operational';Id=100,101,102,103,106,109} -MaxEvents 300 -ErrorAction Stop){
    $x=[xml]$e.ToXml(); $d=@{}
    foreach($n in $x.Event.EventData.Data){ $d[$n.Name]="$($n.'#text')" }
    $out+=[ordered]@{id=$e.Id;t=[int64]([DateTimeOffset]$e.TimeCreated).ToUnixTimeMilliseconds();boot=$d['BootTime'];main=$d['MainPathBootTime'];post=$d['BootPostBootTime'];name=$(if($d['FriendlyName']){$d['FriendlyName']}else{$d['Name']});deg=$d['DegradationTime']}
  }
} catch {}
ConvertTo-Json -InputObject @($out) -Compress`;

export async function bootReport(): Promise<BootReport> {
  const raw = await runPsJson<any[]>(BOOT_QUERY, 60_000).catch(() => []);
  const boots = (raw ?? [])
    .filter((e) => e.id === 100 && e.boot)
    .map((e) => ({ t: e.t, bootSec: +(Number(e.boot) / 1000).toFixed(1), mainPathSec: +(Number(e.main) / 1000).toFixed(1), postBootSec: +(Number(e.post) / 1000).toFixed(1) }))
    .sort((a, b) => a.t - b.t)
    .slice(-30);
  const kinds: Record<number, string> = { 101: "App", 102: "Driver", 103: "Service", 106: "Background task", 109: "Device" };
  const items = new Map<string, { name: string; kind: string; delaySec: number; t: number }>();
  for (const e of raw ?? []) {
    if (e.id === 100 || !e.name) continue;
    const delay = Number(e.deg) / 1000;
    const k = `${e.id}:${e.name}`;
    const prev = items.get(k);
    if (!prev || e.t > prev.t) items.set(k, { name: e.name, kind: kinds[e.id] ?? "Item", delaySec: +delay.toFixed(1), t: e.t });
  }
  return { boots, slowItems: [...items.values()].sort((a, b) => b.delaySec - a.delaySec).slice(0, 15) };
}

const weekStart = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.toISOString().slice(0, 10);
};

/** Average temperatures under load, week by week. Rising numbers at the same load point to dust or old thermal paste. */
export function healthTrends(): { weeks: HealthTrend[]; warning: string | null } {
  const buckets = new Map<string, { g: number[]; c: number[]; n: number }>();
  for (const s of listSessions().slice(0, 200)) {
    const d = getSession(s.id);
    if (!d) continue;
    const b = buckets.get(weekStart(s.start)) ?? { g: [], c: [], n: 0 };
    b.n++;
    for (const p of d.points) {
      if (p.gpu != null && p.gpu >= 80 && p.gpuTemp != null) b.g.push(p.gpuTemp);
      if (p.cpu >= 40 && p.cpuTemp != null) b.c.push(p.cpuTemp);
    }
    buckets.set(weekStart(s.start), b);
  }
  const avg = (v: number[]) => (v.length >= 30 ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null);
  const weeks = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, b]) => ({ week, gpuTempAtLoad: avg(b.g), cpuTempAtLoad: avg(b.c), sessions: b.n }));
  let warning: string | null = null;
  const recent = weeks.slice(-2), older = weeks.slice(-10, -4);
  const mean = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  for (const [k, label] of [["gpuTempAtLoad", "GPU"], ["cpuTempAtLoad", "CPU"]] as const) {
    const r = mean(recent.map((w) => w[k])), o = mean(older.map((w) => w[k]));
    if (r != null && o != null && r - o >= 5)
      warning = `Your ${label} now runs about ${Math.round(r - o)}°C hotter under the same load than a month or two ago. That usually means dust in the filters or heatsink, or drying thermal paste.`;
  }
  return { weeks, warning };
}

/** Compare each game's performance across GPU driver versions. */
export function driverImpact(): DriverImpact[] {
  const byGame = new Map<string, { game: string; exe: string; rows: Map<string, { fps: number[]; low: number[] }> }>();
  for (const s of listSessions()) {
    if (!s.driver || s.avgFps == null) continue;
    const g = byGame.get(s.exe) ?? { game: s.game, exe: s.exe, rows: new Map() };
    const r = g.rows.get(s.driver) ?? { fps: [], low: [] };
    r.fps.push(s.avgFps);
    if (s.low1 != null) r.low.push(s.low1);
    g.rows.set(s.driver, r);
    byGame.set(s.exe, g);
  }
  const avg = (v: number[]) => (v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null);
  const out: DriverImpact[] = [];
  for (const g of byGame.values()) {
    if (g.rows.size < 2) continue;
    const rows = [...g.rows.entries()].map(([driver, r]) => ({ driver, sessions: r.fps.length, avgFps: avg(r.fps), low1: avg(r.low) }));
    rows.sort((a, b) => a.driver.localeCompare(b.driver, undefined, { numeric: true }));
    const [prev, cur] = rows.slice(-2);
    let verdict: string | null = null;
    if (prev.sessions >= 2 && cur.sessions >= 2 && prev.low1 && cur.low1) {
      const pct = Math.round(((cur.low1 - prev.low1) / prev.low1) * 100);
      verdict = Math.abs(pct) < 4 ? `No real change since driver ${cur.driver}.` : `1% lows are ${Math.abs(pct)}% ${pct > 0 ? "higher" : "lower"} since driver ${cur.driver}.`;
    }
    out.push({ game: g.game, exe: g.exe, rows, verdict });
  }
  return out;
}
