import { useEffect, useState } from "react";
import { api } from "../api";
import type { ExtrasSettings, FanRuntime, HwStatus } from "../../shared/types";

// A side view of a mid-tower case. Assign each fan to where it sits; airflow arrows speed up with the fan,
// and the CPU and GPU blocks shift from blue to magenta as they heat up.
const SLOTS: { id: string; label: string; x: number; y: number; dir: "in" | "out" | "up" }[] = [
  { id: "front1", label: "Front top", x: 470, y: 90, dir: "in" },
  { id: "front2", label: "Front middle", x: 470, y: 180, dir: "in" },
  { id: "front3", label: "Front bottom", x: 470, y: 270, dir: "in" },
  { id: "top1", label: "Top front", x: 330, y: 22, dir: "up" },
  { id: "top2", label: "Top rear", x: 210, y: 22, dir: "up" },
  { id: "rear", label: "Rear", x: 50, y: 100, dir: "out" },
  { id: "cpu", label: "CPU cooler", x: 220, y: 125, dir: "out" },
];

const heat = (t: number | null) => {
  if (t == null) return "var(--line)";
  const f = Math.max(0, Math.min(1, (t - 40) / 45));
  const a = [47, 149, 219], b = [226, 70, 139];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * f)).join(",")})`;
};

export function RigDiagram({ hw, rt }: { hw: HwStatus; rt: FanRuntime | null }) {
  const [ex, setEx] = useState<ExtrasSettings | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    api.getExtras().then(setEx);
  }, []);
  if (!ex) return null;
  const layout = ex.rigLayout;
  const fan = (slot: string) => hw.fans.find((f) => f.controlId === layout[slot]);
  const cpuT = hw.temps.find((t) => /package|tctl|tdie/i.test(t.name))?.value ?? null;
  const gpuT = hw.temps.find((t) => /^GPU Core$/i.test(t.name))?.value ?? null;
  const assign = async (slot: string, id: string) => setEx(await api.saveExtras({ rigLayout: { ...layout, [slot]: id } }));

  return (
    <section className="panel">
      <div className="panel-head">
        <div><h2>Your rig</h2><p className="sub small">Live airflow and heat. Assign your fans to where they sit in the case.</p></div>
        <button className="btn sm" onClick={() => setEditing(!editing)}>{editing ? "Done" : "Place fans"}</button>
      </div>
      <div className="grid-2" style={{ alignItems: "center" }}>
        <svg className="rigsvg" viewBox="0 0 520 360" role="img" aria-label="Diagram of the case with fans, CPU and GPU">
          <rect x="30" y="10" width="460" height="340" rx="14" fill="var(--bg)" stroke="var(--line)" strokeWidth="2" />
          {/* motherboard */}
          <rect x="70" y="50" width="250" height="250" rx="6" fill="#141b30" stroke="var(--line-soft)" />
          {/* CPU */}
          <rect x="185" y="90" width="70" height="70" rx="8" fill={heat(cpuT)} opacity="0.9" />
          <text x="220" y="182" textAnchor="middle" fill="var(--ink)" fontSize="13" fontWeight="600">CPU {cpuT != null ? `${cpuT}°C` : ""}</text>
          {/* GPU */}
          <rect x="80" y="220" width="300" height="46" rx="8" fill={heat(gpuT)} opacity="0.9" />
          <text x="230" y="248" textAnchor="middle" fill="#fff" fontSize="13" fontWeight="600">GPU {gpuT != null ? `${gpuT}°C` : ""}</text>
          {/* PSU */}
          <rect x="40" y="300" width="160" height="40" rx="6" fill="#141b30" stroke="var(--line-soft)" />
          <text x="120" y="325" textAnchor="middle" fill="var(--muted)" fontSize="12">PSU</text>
          {SLOTS.map((s) => {
            const f = fan(s.id);
            const pct = f ? rt?.targets[f.controlId] ?? f.percent ?? 0 : 0;
            const speed = pct > 0 ? Math.max(0.35, 2.6 - pct / 45) : 0;
            const arrow = s.dir === "in" ? "M0 0 l-26 0 m8 -7 l-8 7 l8 7" : s.dir === "out" ? "M0 0 l-26 0 m8 -7 l-8 7 l8 7" : "M0 0 l0 -20 m-7 8 l7 -8 l7 8";
            return (
              <g key={s.id} transform={`translate(${s.x} ${s.y})`} opacity={f ? 1 : 0.35}>
                <circle r="20" fill="var(--panel)" stroke={f ? "var(--ink-2)" : "var(--line)"} strokeWidth="2" />
                <g style={f && speed ? { animation: `spin ${speed}s linear infinite`, transformOrigin: "0 0" } : undefined}>
                  {[0, 120, 240].map((a) => <path key={a} d="M0 0 C 6 -6, 14 -4, 15 3 C 8 4, 3 3, 0 0" fill="var(--ink-2)" transform={`rotate(${a})`} />)}
                </g>
                {f && <path d={arrow} transform={s.dir === "in" ? "translate(-24 0)" : s.dir === "out" ? "translate(-22 0)" : "translate(0 -22)"} stroke="var(--cpu)" strokeWidth="2.5" fill="none" strokeLinecap="round" style={speed ? { animation: `flow ${speed * 1.4}s ease-in-out infinite` } : undefined} />}
                {f && <text y="36" textAnchor="middle" fill="var(--ink-2)" fontSize="11">{f.rpm != null ? `${Math.round(f.rpm)} rpm` : `${Math.round(pct)}%`}</text>}
              </g>
            );
          })}
        </svg>
        <div className="stack" style={{ gap: 8 }}>
          {editing ? (
            SLOTS.map((s) => (
              <div key={s.id} className="row between small">
                <span>{s.label}</span>
                <select className="input" style={{ width: 210 }} value={layout[s.id] ?? ""} onChange={(e) => assign(s.id, e.target.value)} aria-label={`Fan at ${s.label}`}>
                  <option value="">Empty</option>
                  {hw.fans.map((f) => <option key={f.controlId} value={f.controlId}>{f.name} ({f.hardware})</option>)}
                </select>
              </div>
            ))
          ) : (
            <>
              <p className="small" style={{ margin: 0, color: "var(--ink-2)" }}>Cool parts show blue and turn magenta as they heat up. Arrows show which way air moves, and spin faster with the fans.</p>
              {!Object.values(layout).some(Boolean) && <p className="muted small" style={{ margin: 0 }}>Click Place fans to put each fan where it sits in your case.</p>}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
