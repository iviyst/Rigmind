import { useMemo, useRef, useState } from "react";

// ---------- Sparkline: one series, hover shows the value ----------
interface SparkProps {
  values: (number | null)[];
  color: string;
  max?: number;
  height?: number;
  format: (v: number) => string;
  label: string;
  stepSec?: number;
}

export function Sparkline({ values, color, max, height = 44, format, label, stepSec = 1 }: SparkProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 300;
  const nums = values.filter((v): v is number => v != null);
  const top = max ?? Math.max(1, ...nums) * 1.15;
  const n = Math.max(2, values.length);
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => height - 2 - (Math.min(v, top) / top) * (height - 6);
  let d = "";
  values.forEach((v, i) => {
    if (v == null) return;
    d += (d && values[i - 1] != null ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1);
  });
  const onMove = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
    setHover(Math.max(0, Math.min(values.length - 1, i)));
  };
  const hv = hover != null ? values[hover] : null;
  return (
    <div className="chart" ref={ref} onMouseMove={onMove} onMouseLeave={() => setHover(null)} aria-label={label} role="img">
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ height }}>
        <path d={d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {hover != null && hv != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} stroke="var(--muted)" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="2 3" />
          </>
        )}
      </svg>
      {hover != null && hv != null && (
        <>
          <span style={{ position: "absolute", left: `${(hover / (n - 1)) * 100}%`, top: y(hv), width: 8, height: 8, marginLeft: -4, marginTop: -4, borderRadius: "50%", background: color, boxShadow: "0 0 0 2px var(--panel)" }} />
          <div className="tooltip" style={{ left: `${(hover / (n - 1)) * 100}%`, top: 0 }}>
            <b>{format(hv)}</b> <span className="k">{Math.round((values.length - 1 - hover) * stepSec)}s ago</span>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Session line chart: multiple series + stutter markers ----------
export interface Series {
  name: string;
  color: string;
  values: (number | null)[];
  unit: string;
}

interface LineProps {
  series: Series[];
  times: number[]; // seconds from start
  max?: number;
  height?: number;
  markers?: { sec: number; label: string }[];
  label: string;
  xLabels?: string[]; // one per point; replaces the mm:ss axis
}

export function LineChart({ series, times, max, height = 220, markers = [], label, xLabels }: LineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 800, padL = 36, padB = 22, padT = 8;
  const H = height;
  const allVals = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  const top = max ?? niceMax(Math.max(1, ...allVals));
  const tEnd = times[times.length - 1] || 1;
  const x = (sec: number) => padL + (sec / tEnd) * (W - padL);
  const y = (v: number) => padT + (1 - Math.min(v, top) / top) * (H - padT - padB);
  const paths = useMemo(
    () =>
      series.map((s) => {
        let d = "";
        s.values.forEach((v, i) => {
          if (v == null) return;
          d += (d && s.values[i - 1] != null ? "L" : "M") + x(times[i]).toFixed(1) + " " + y(v).toFixed(1);
        });
        return d;
      }),
    [series, times, top]
  );
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f));
  const xTicks = Array.from({ length: 6 }, (_, i) => Math.round((tEnd * i) / 5));
  const onMove = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const sec = ((sx - padL) / (W - padL)) * tEnd;
    let best = 0;
    for (let i = 0; i < times.length; i++) if (Math.abs(times[i] - sec) < Math.abs(times[best] - sec)) best = i;
    setHover(sx < padL ? null : best);
  };
  const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  const hoverMarkers = hover != null ? markers.filter((m) => Math.abs(m.sec - times[hover]) <= Math.max(5, tEnd / 160)) : [];

  return (
    <div className="chart" ref={ref} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} preserveAspectRatio="none">
        {yTicks.map((t) => (
          <g key={t}>
            <line className="gridline" x1={padL} x2={W} y1={y(t)} y2={y(t)} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {paths.map((d, i) => (
          <path key={series[i].name} d={d} fill="none" stroke={series[i].color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        ))}
        {markers.map((m, i) => (
          <path key={i} d={`M${x(m.sec)} ${H - padB + 2} l-4 7 h8 z`} fill="var(--warn)" />
        ))}
        {hover != null && <line x1={x(times[hover])} x2={x(times[hover])} y1={padT} y2={H - padB} stroke="var(--muted)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* Axis labels live in HTML so they don't stretch with the SVG. */}
      {yTicks.map((t) => (
        <span key={t} className="axis-label" style={{ position: "absolute", left: 0, top: `${(y(t) / H) * 100}%`, transform: "translateY(-50%)", fontSize: 11, color: "var(--muted)" }}>{t}</span>
      ))}
      {(xLabels ? times.map((t, i) => ({ t, l: xLabels[i] })).filter((_, i, a) => a.length <= 8 || i % Math.ceil(a.length / 6) === 0) : xTicks.map((t) => ({ t, l: mm(t) }))).map(({ t, l }, i, arr) => (
        <span key={i} style={{ position: "absolute", left: `${(x(t) / W) * 100}%`, bottom: -18, transform: i === 0 ? "none" : i === arr.length - 1 ? "translateX(-100%)" : "translateX(-50%)", fontSize: 11, color: "var(--muted)" }}>{l}</span>
      ))}
      {hover != null &&
        series.map((s) => {
          const v = s.values[hover];
          return v == null ? null : <span key={s.name} style={{ position: "absolute", left: `${(x(times[hover]) / W) * 100}%`, top: `${(y(v) / H) * 100}%`, width: 8, height: 8, margin: "-4px 0 0 -4px", borderRadius: "50%", background: s.color, boxShadow: "0 0 0 2px var(--panel)" }} />;
        })}
      {hover != null && (
        <div className="tooltip" style={{ left: `${(x(times[hover]) / W) * 100}%`, top: 0 }}>
          <div className="k" style={{ marginBottom: 4 }}>{xLabels ? xLabels[hover] : mm(times[hover])}</div>
          {series.map((s) => (
            <div key={s.name}>
              <span className="sw" style={{ background: s.color }} />
              {s.name} <b>{s.values[hover] == null ? "–" : `${Math.round(s.values[hover]!)}${s.unit}`}</b>
            </div>
          ))}
          {hoverMarkers.slice(0, 2).map((m, i) => (
            <div key={i} style={{ marginTop: 4, color: "var(--warn)" }}>▲ {m.label}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function niceMax(v: number) {
  const steps = [20, 40, 60, 80, 100, 120, 160, 200, 240, 320, 400, 480, 600, 800, 1000];
  return steps.find((s) => s >= v * 1.05) ?? Math.ceil(v / 100) * 100;
}

export function Legend({ items }: { items: { name: string; color: string; marker?: boolean }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.name}>
          {i.marker ? <svg width="10" height="9" aria-hidden><path d="M5 0 L10 9 H0z" fill={i.color} /></svg> : <i style={{ background: i.color }} />}
          {i.name}
        </span>
      ))}
    </div>
  );
}
