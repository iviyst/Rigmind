import { useEffect, useState } from "react";
import { api } from "../api";
import { Setting, Switch, toast } from "../components/Bits";
import type { RgbSettings, RgbStatus } from "../../shared/types";

const SWATCHES = ["#2f95db", "#e2468b", "#3fc88a", "#f2a93b", "#9b6bff", "#ffffff"];

export function Lighting() {
  const [cfg, setCfg] = useState<RgbSettings | null>(null);
  const [st, setSt] = useState<RgbStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getRgbSettings().then(setCfg);
    api.getRgbStatus().then(setSt);
    return api.onRgbStatus(setSt);
  }, []);
  if (!cfg || !st) return null;
  const save = async (p: Partial<RgbSettings>) => setCfg(await api.saveRgbSettings(p));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Lighting</h1>
          <p className="sub">Your RGB shows how the PC is doing: cool blue at rest, warming toward magenta under load, red when something runs hot.</p>
        </div>
        <Switch checked={cfg.enabled} onChange={(v) => save({ enabled: v })} label="RGB control" />
      </div>

      <section className="panel light-hero">
        <div className="glow" style={{ background: st.connected && cfg.enabled ? st.current : "var(--line)", boxShadow: st.connected && cfg.enabled ? `0 0 60px 6px ${st.current}55` : "none" }} aria-hidden />
        <div style={{ flex: 1 }}>
          <h2>{!cfg.enabled ? "RGB control is off" : st.connected ? st.reason || "Connected" : "Not connected to OpenRGB"}</h2>
          <p className="sub">
            {st.connected ? `${st.devices.length} device${st.devices.length === 1 ? "" : "s"}: ${st.devices.map((d) => d.name).join(", ")}` : "Rigmind talks to your lights through OpenRGB, which supports Corsair, ASUS, MSI, Gigabyte, Razer, Logitech, RAM and more."}
          </p>
        </div>
        {!st.connected && cfg.enabled && (
          st.installed ? (
            <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); toast((await api.launchOpenRgb()).message); setBusy(false); }}>{busy ? "Starting…" : "Start OpenRGB"}</button>
          ) : (
            <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); toast((await api.installTool("openrgb")).message); setBusy(false); }}>{busy ? "Installing…" : "Install OpenRGB"}</button>
          )
        )}
      </section>
      {!st.connected && cfg.enabled && <div className="notice info">Close iCUE, Armoury Crate, Mystic Light or RGB Fusion first. They fight over the same lights. RAM and some motherboards also need the PawnIO driver.</div>}

      <div className="grid-2">
        <section className="panel">
          <h2>Mode</h2>
          <div className="seg" role="radiogroup" style={{ margin: "12px 0 6px" }}>
            {(["status", "static", "off"] as const).map((m) => (
              <button key={m} role="radio" aria-checked={cfg.mode === m} className={cfg.mode === m ? "on" : ""} onClick={() => save({ mode: m })}>
                {m === "status" ? "Show PC status" : m === "static" ? "One color" : "Off"}
              </button>
            ))}
          </div>
          {cfg.mode === "static" && (
            <div className="row wrap" style={{ marginTop: 12 }}>
              {SWATCHES.map((c) => (
                <button key={c} className="swatch" aria-label={`Color ${c}`} aria-pressed={cfg.color === c} style={{ background: c }} onClick={() => save({ color: c })} />
              ))}
              <input type="color" value={cfg.color} onChange={(e) => save({ color: e.target.value })} aria-label="Custom color" style={{ width: 40, height: 32, border: 0, background: "none" }} />
            </div>
          )}
          {cfg.mode === "status" && <div className="status-ramp" aria-hidden><span>40°C</span><span>85°C</span></div>}
          <Setting title={`Brightness ${cfg.brightness}%`}>
            <input type="range" min={5} max={100} value={cfg.brightness} onChange={(e) => save({ brightness: Number(e.target.value) })} aria-label="Brightness" style={{ width: 200 }} />
          </Setting>
        </section>

        <section className="panel">
          <h2>Smart lighting</h2>
          <Setting title="Heat alerts" desc="Pulses red if the CPU passes 90°C or the GPU passes 85°C.">
            <Switch checked={cfg.alerts} onChange={(v) => save({ alerts: v })} label="Heat alerts" />
          </Setting>
          <Setting title="Game colors" desc="Each game can have its own color. Set it in the game's profile on the Game Boost page.">
            <Switch checked={cfg.gameScenes} onChange={(v) => save({ gameScenes: v })} label="Game colors" />
          </Setting>
          <Setting title="Lights off at night" desc={cfg.schedule.enabled ? `From ${cfg.schedule.from} to ${cfg.schedule.to}` : "Turn lights off on a schedule."}>
            <div className="row">
              {cfg.schedule.enabled && (
                <>
                  <input className="input" type="time" style={{ width: 132 }} value={cfg.schedule.from} onChange={(e) => save({ schedule: { ...cfg.schedule, from: e.target.value } })} aria-label="Lights off from" />
                  <input className="input" type="time" style={{ width: 132 }} value={cfg.schedule.to} onChange={(e) => save({ schedule: { ...cfg.schedule, to: e.target.value } })} aria-label="Lights off until" />
                </>
              )}
              <Switch checked={cfg.schedule.enabled} onChange={(v) => save({ schedule: { ...cfg.schedule, enabled: v } })} label="Lights off at night" />
            </div>
          </Setting>
          <Setting title="Off when you step away" desc="Turns lights off after the PC has been idle.">
            <select className="input" style={{ width: 140 }} value={cfg.idleOffMin} onChange={(e) => save({ idleOffMin: Number(e.target.value) })} aria-label="Idle timeout">
              <option value={0}>Never</option>
              <option value={5}>After 5 min</option>
              <option value={15}>After 15 min</option>
              <option value={30}>After 30 min</option>
            </select>
          </Setting>
        </section>
      </div>
    </div>
  );
}
