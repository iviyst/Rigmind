import { useRef, useState } from "react";
import type { CurvePoint } from "../../shared/types";

const T0 = 30, T1 = 100; // °C on the x axis

/** Drag points to shape a fan curve. Arrow keys nudge the focused point. */
export function CurveEditor({ points, onChange, current, readOnly, color = "var(--cpu)" }: { points: CurvePoint[]; onChange?: (p: CurvePoint[]) => void; current?: { t: number; p: number } | null; readOnly?: boolean; color?: string }) {
  const W = 520, H = 220, padL = 34, padB = 24, padT = 10, padR = 10;
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const pts = [...points].sort((a, b) => a.t - b.t);
  const x = (t: number) => padL + ((t - T0) / (T1 - T0)) * (W - padL - padR);
  const y = (p: number) => padT + (1 - p / 100) * (H - padT - padB);
  const toVal = (cx: number, cy: number) => {
    const r = ref.current!.getBoundingClientRect();
    const sx = ((cx - r.left) / r.width) * W, sy = ((cy - r.top) / r.height) * H;
    return { t: Math.round(T0 + ((sx - padL) / (W - padL - padR)) * (T1 - T0)), p: Math.round((1 - (sy - padT) / (H - padT - padB)) * 100) };
  };
  const update = (i: number, v: CurvePoint) => {
    const next = pts.map((p, j) => (j === i ? v : p));
    // Keep points in order and the curve non-decreasing so hotter never means slower.
    const lo = i > 0 ? next[i - 1].t + 1 : T0, hi = i < next.length - 1 ? next[i + 1].t - 1 : T1;
    next[i] = { t: Math.max(lo, Math.min(hi, v.t)), p: Math.max(i > 0 ? next[i - 1].p : 0, Math.min(i < next.length - 1 ? next[i + 1].p : 100, v.p)) };
    onChange?.(next);
  };
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t)} ${y(p.p)}`).join("") + `L${x(T1)} ${y(pts[pts.length - 1]?.p ?? 100)}`;

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", touchAction: "none", display: "block" }} role="group" aria-label="Fan curve: fan speed by temperature"
      onPointerMove={(e) => drag != null && update(drag, toVal(e.clientX, e.clientY))} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
      {[0, 25, 50, 75, 100].map((p) => (
        <g key={p}>
          <line x1={padL} x2={W - padR} y1={y(p)} y2={y(p)} stroke="var(--line-soft)" />
          <text x={padL - 6} y={y(p) + 4} textAnchor="end" fill="var(--muted)" fontSize="11">{p}%</text>
        </g>
      ))}
      {[30, 40, 50, 60, 70, 80, 90, 100].map((t) => (
        <text key={t} x={x(t)} y={H - 6} textAnchor="middle" fill="var(--muted)" fontSize="11">{t}°</text>
      ))}
      <path d={d} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
      {current && (
        <g>
          <line x1={x(current.t)} x2={x(current.t)} y1={padT} y2={H - padB} stroke="var(--muted)" strokeDasharray="3 4" />
          <circle cx={x(current.t)} cy={y(current.p)} r={5} fill="var(--ink)" stroke="var(--panel)" strokeWidth={2} />
          <text x={x(current.t) + 8} y={padT + 12} fill="var(--ink-2)" fontSize="11">Now {current.t}°C, {Math.round(current.p)}%</text>
        </g>
      )}
      {!readOnly &&
        pts.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.p)} r={8} fill="var(--panel)" stroke={color} strokeWidth={2.5} style={{ cursor: "grab" }} tabIndex={0}
            aria-label={`Point ${i + 1}: ${p.t} degrees, ${p.p} percent`}
            onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(i); }}
            onKeyDown={(e) => {
              const k = e.key;
              const dt = k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : 0, dp = k === "ArrowUp" ? 1 : k === "ArrowDown" ? -1 : 0;
              if (dt || dp) { e.preventDefault(); update(i, { t: p.t + dt, p: p.p + dp }); }
            }} />
        ))}
    </svg>
  );
}
