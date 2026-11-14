import { useEffect, useState } from "react";
import { api } from "../api";
import { Setting, Switch, toast } from "../components/Bits";
import { CurveEditor } from "../components/CurveEditor";
import { RigDiagram } from "../components/RigDiagram";
import type { FanControlCfg, FanProfileName, FanRuntime, FanSettings, HwStatus } from "../../shared/types";

// Same curves as the engine (src/main/fans.ts) so the preview matches what's applied.
const PROFILE_CURVES: Record<FanProfileName, { t: number; p: number }[]> = {
  quiet: [{ t: 40, p: 20 }, { t: 60, p: 30 }, { t: 70, p: 45 }, { t: 80, p: 70 }, { t: 90, p: 100 }],
  balanced: [{ t: 40, p: 25 }, { t: 55, p: 35 }, { t: 65, p: 50 }, { t: 75, p: 70 }, { t: 85, p: 100 }],
  performance: [{ t: 35, p: 40 }, { t: 50, p: 55 }, { t: 60, p: 70 }, { t: 70, p: 85 }, { t: 80, p: 100 }],
};
const PROFILES: { id: FanProfileName; label: string }[] = [
  { id: "quiet", label: "Quiet" },
  { id: "balanced", label: "Balanced" },
  { id: "performance", label: "Performance" },
];
const SOURCES = [
  { id: "max", label: "Hottest of CPU and GPU" },
  { id: "cpu", label: "CPU" },
  { id: "gpu", label: "GPU" },
  { id: "liquid", label: "Liquid (AIO)" },
] as const;

const defaultCfg = (name: string): FanControlCfg => ({ label: name, mode: "auto", source: /gpu/i.test(name) ? "gpu" : "max", fixed: 50, custom: PROFILE_CURVES.balanced, minPct: /gpu/i.test(name) ? 30 : 20, calibration: null });

export function Cooling() {
  const [hw, setHw] = useState<HwStatus | null>(null);
  const [cfg, setCfg] = useState<FanSettings | null>(null);
  const [rt, setRt] = useState<FanRuntime | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api.getHwStatus().then(setHw);
    api.getFanSettings().then(setCfg);
    api.getFanRuntime().then(setRt);
    const a = api.onHwStatus(setHw), b = api.onFanRuntime(setRt);
    return () => (a(), b());
  }, []);

  if (!cfg || !hw) return null;
  const save = async (p: Partial<FanSettings>) => setCfg(await api.saveFanSettings(p));
  const saveFan = (id: string, name: string, p: Partial<FanControlCfg>) => save({ controls: { ...cfg.controls, [id]: { ...(cfg.controls[id] ?? defaultCfg(name)), ...p } } });

  const temp = (src: string) => {
    const cpu = hw.temps.find((t) => /package|tctl|tdie/i.test(t.name))?.value ?? null;
    const gpu = hw.temps.find((t) => /^GPU Core$/i.test(t.name))?.value ?? null;
    const liquid = hw.temps.find((t) => /liquid|coolant/i.test(t.name))?.value ?? null;
    if (src === "cpu") return cpu;
    if (src === "gpu") return gpu;
    if (src === "liquid") return liquid ?? cpu;
    const v = [cpu, gpu].filter((x): x is number => x != null);
    return v.length ? Math.max(...v) : null;
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Cooling</h1>
          <p className="sub">Fan curves that know when you're gaming. Fans you leave on Automatic stay with your BIOS.</p>
        </div>
        {cfg.riskAccepted && <Switch checked={cfg.enabled} onChange={(v) => save({ enabled: v })} label="Fan control" />}
      </div>

      {!hw.built && <div className="notice">The hardware helper isn't built yet. In the Rigmind folder run <code>npm run build:hw</code>, then restart Rigmind.</div>}
      {hw.built && !hw.pawnio && (
        <div className="notice row between">
          <span>Motherboard fans and CPU temperature need the PawnIO driver. GPU fans work without it.</span>
          <button className="btn sm" onClick={async () => toast((await api.installTool("pawnio")).message)}>Get PawnIO</button>
        </div>
      )}
      {hw.built && <RigDiagram hw={hw} rt={rt} />}
      {rt?.failsafe && <div className="notice" role="alert" style={{ borderColor: "var(--crit)", background: "rgba(240,86,95,.1)" }}>All fans at 100%: {rt.failsafe}. They'll come down once things are back to normal.</div>}

      {!cfg.riskAccepted ? (
        <section className="panel stack">
          <h2>Before you turn on fan control</h2>
          <ul className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6, color: "var(--ink-2)" }}>
            <li>Rigmind sets fan speeds through LibreHardwareMonitor and the PawnIO driver, the same setup FanControl uses.</li>
            <li>Some players report that certain anti-cheat systems react to PawnIO being installed. Check your games' rules if you play competitive titles.</li>
            <li>If Rigmind closes, crashes or loses its sensors, every fan goes back to BIOS control, and critical temperatures always push fans to 100%.</li>
          </ul>
          <div><button className="btn primary" onClick={() => save({ riskAccepted: true, enabled: true })}>I understand, turn on fan control</button></div>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="grid-2" style={{ gap: 28 }}>
              <div>
                <h2>On the desktop</h2>
                <ProfilePicker value={cfg.desktopProfile} onChange={(v) => save({ desktopProfile: v })} active={rt?.profile === cfg.desktopProfile && !rt?.failsafe} />
              </div>
              <div>
                <h2>While gaming</h2>
                <ProfilePicker value={cfg.gameProfile} onChange={(v) => save({ gameProfile: v })} active={false} />
              </div>
            </div>
            <Setting title="Spin up when a game launches" desc="Raises fans for the first 45 seconds of a game so they're ahead of the heat, not chasing it.">
              <Switch checked={cfg.preRamp} onChange={(v) => save({ preRamp: v })} label="Spin up when a game launches" />
            </Setting>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Fans</h2>
              <span className="muted small">{hw.fans.length} found{rt ? `. Using the ${rt.profile} profile` : ""}</span>
            </div>
            {!hw.fans.length && <p className="muted" style={{ margin: 0 }}>No controllable fans found yet.</p>}
            <table className="list">
              <thead>
                <tr><th>Fan</th><th>Mode</th><th className="num">Speed</th><th className="num">Set to</th><th /></tr>
              </thead>
              <tbody>
                {hw.fans.map((f) => {
                  const c = cfg.controls[f.controlId] ?? defaultCfg(f.name);
                  const target = rt?.targets[f.controlId];
                  return [
                    <tr key={f.controlId} className="clickable" aria-expanded={open === f.controlId} onClick={() => setOpen(open === f.controlId ? null : f.controlId)}>
                      <td><b>{c.label}</b><div className="muted small">{f.name}, {f.hardware}</div></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select className="input" style={{ width: 150 }} value={c.mode} aria-label={`Mode for ${c.label}`} onChange={(e) => saveFan(f.controlId, f.name, { mode: e.target.value as FanControlCfg["mode"] })}>
                          <option value="auto">Automatic (BIOS)</option>
                          <option value="profile">Follow profile</option>
                          <option value="custom">Custom curve</option>
                          <option value="fixed">Fixed speed</option>
                        </select>
                      </td>
                      <td className="num">{f.rpm != null ? `${Math.round(f.rpm)} RPM` : "–"}</td>
                      <td className="num">{c.mode === "auto" ? <span className="muted">BIOS</span> : target != null ? `${target}%` : "–"}</td>
                      <td className="num muted small">{open === f.controlId ? "Hide" : "Edit"}</td>
                    </tr>,
                    open === f.controlId && (
                      <tr key={f.controlId + "-ed"}>
                        <td colSpan={5} style={{ background: "var(--bg)" }}>
                          <FanEditor cfg={c} name={f.name} id={f.controlId} saveFan={saveFan} now={temp(c.source)} target={target ?? null} profile={rt?.profile ?? cfg.desktopProfile} calibrating={rt?.calibrating?.controlId === f.controlId ? rt.calibrating.step : null} />
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </section>
        </>
      )}

      <section className="panel">
        <h2>Temperatures</h2>
        <table className="list" style={{ marginTop: 10 }}>
          <tbody>
            {hw.temps.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td className="muted">{t.hardware}</td>
                <td className="num" style={{ color: t.value >= 90 ? "var(--crit)" : t.value >= 80 ? "var(--warn)" : undefined }}>{t.value}°C</td>
              </tr>
            ))}
            {!hw.temps.length && <tr><td className="muted">No sensors reporting yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function ProfilePicker({ value, onChange, active }: { value: FanProfileName; onChange: (v: FanProfileName) => void; active: boolean }) {
  return (
    <div className="seg" role="radiogroup" style={{ marginTop: 10 }}>
      {PROFILES.map((p) => (
        <button key={p.id} role="radio" aria-checked={value === p.id} className={value === p.id ? "on" : ""} onClick={() => onChange(p.id)}>
          {p.label}
        </button>
      ))}
      {active && <span className="tag good" style={{ marginLeft: 10 }}>Active now</span>}
    </div>
  );
}

function FanEditor({ cfg, name, id, saveFan, now, target, profile, calibrating }: { cfg: FanControlCfg; name: string; id: string; saveFan: (id: string, name: string, p: Partial<FanControlCfg>) => void; now: number | null; target: number | null; profile: FanProfileName; calibrating: string | null }) {
  const [label, setLabel] = useState(cfg.label);
  const [busy, setBusy] = useState(false);
  const curve = cfg.mode === "custom" ? cfg.custom : PROFILE_CURVES[profile];
  return (
    <div className="grid-2" style={{ gap: 24, padding: "8px 4px" }}>
      <div>
        <CurveEditor points={curve} readOnly={cfg.mode !== "custom"} onChange={(p) => saveFan(id, name, { custom: p })} current={now != null && target != null ? { t: now, p: target } : null} />
        <p className="muted small" style={{ margin: "6px 0 0" }}>{cfg.mode === "custom" ? "Drag the points, or focus one and use the arrow keys." : cfg.mode === "profile" ? `Showing the ${profile} profile. Switch to Custom curve to edit.` : cfg.mode === "fixed" ? "Fixed speed ignores the curve." : "This fan is controlled by your BIOS."}</p>
      </div>
      <div className="stack">
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted small">Name</span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => label !== cfg.label && saveFan(id, name, { label })} />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted small">Follow temperature of</span>
          <select className="input" value={cfg.source} onChange={(e) => saveFan(id, name, { source: e.target.value as FanControlCfg["source"] })}>
            {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        {cfg.mode === "fixed" && (
          <label className="stack" style={{ gap: 4 }}>
            <span className="muted small">Fixed speed: {cfg.fixed}%</span>
            <input type="range" min={cfg.minPct} max={100} value={cfg.fixed} onChange={(e) => saveFan(id, name, { fixed: Number(e.target.value) })} />
          </label>
        )}
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted small">Never slower than: {cfg.minPct}%</span>
          <input type="range" min={0} max={60} value={cfg.minPct} onChange={(e) => saveFan(id, name, { minPct: Number(e.target.value) })} />
        </label>
        <div className="row">
          <button className="btn sm" disabled={busy || !!calibrating} onClick={async () => { setBusy(true); toast((await api.calibrateFan(id)).message); setBusy(false); }}>
            {calibrating ? calibrating : cfg.calibration ? "Calibrate again" : "Calibrate"}
          </button>
          <span className="muted small">{cfg.calibration ? `Spins from ${cfg.calibration.startPct}%` : "Finds the slowest speed this fan reliably spins at. Takes about a minute."}</span>
        </div>
      </div>
    </div>
  );
}
