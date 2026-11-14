// Tachometer-style load gauge: 270° of segmented ticks that light up with load.
interface Props {
  label: string;
  value: number | null; // 0-100
  color: string;
  name?: string;
  meta: { k: string; v: string; tone?: string }[];
}

const SEGMENTS = 48;
const START = 135; // degrees, measured clockwise from +x
const SWEEP = 270;

export function Gauge({ label, value, color, name, meta }: Props) {
  const cx = 150, cy = 150, r1 = 104, r2 = 126;
  const lit = value == null ? 0 : Math.round((Math.max(0, Math.min(100, value)) / 100) * SEGMENTS);
  const ticks = Array.from({ length: SEGMENTS }, (_, i) => {
    const a = ((START + (SWEEP * (i + 0.5)) / SEGMENTS) * Math.PI) / 180;
    const major = i % 6 === 0;
    const inner = major ? r1 - 6 : r1;
    return { x1: cx + inner * Math.cos(a), y1: cy + inner * Math.sin(a), x2: cx + r2 * Math.cos(a), y2: cy + r2 * Math.sin(a), on: i < lit };
  });
  return (
    <div className="gauge" role="meter" aria-label={`${label} load`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value == null ? undefined : Math.round(value)}>
      <svg viewBox="0 0 300 262">
        {ticks.map((t, i) => (
          <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.on ? color : "var(--line)"} strokeWidth={4} strokeLinecap="round" style={{ transition: "stroke .25s" }} />
        ))}
        <text x={cx} y={cy - 34} textAnchor="middle" className="gauge-label">{label}</text>
        <text x={cx} y={cy + 22} textAnchor="middle">
          <tspan className="gauge-value">{value == null ? "–" : Math.round(value)}</tspan>
          <tspan className="gauge-unit" dx="4">%</tspan>
        </text>
        <text x={cx} y={cy + 52} textAnchor="middle" className="gauge-label" style={{ letterSpacing: 0, fontFamily: "var(--body)", fontWeight: 500 }}>load</text>
      </svg>
      <div className="gauge-meta">
        {meta.map((m) => (
          <span key={m.k} className={m.tone ? `tone-${m.tone}` : undefined}>
            <b style={m.tone === "warn" ? { color: "var(--warn)" } : m.tone === "crit" ? { color: "var(--crit)" } : undefined}>{m.v}</b>
            {m.k}
          </span>
        ))}
      </div>
      {name && <div className="gauge-name" title={name}>{name}</div>}
    </div>
  );
}
