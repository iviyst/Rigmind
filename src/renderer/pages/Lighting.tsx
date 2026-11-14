import { useEffect, useState } from "react";
import { api } from "../api";
import { Setting, Switch, toast } from "../components/Bits";
import type { RgbSettings, RgbStatus, ExtrasSettings } from "../../shared/types";

const SWATCHES = ["#2f95db", "#e2468b", "#3fc88a", "#f2a93b", "#9b6bff", "#ffffff"];

export function Lighting() {
  const [cfg, setCfg] = useState<RgbSettings | null>(null);
  const [st, setSt] = useState<RgbStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [ex, setEx] = useState<ExtrasSettings | null>(null);

  useEffect(() => {
    api.getRgbSettings().then(setCfg);
    api.getRgbStatus().then(setSt);
    api.getExtras().then(setEx);
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
          <h2>{st.gameEvent ? st.gameEvent : !cfg.enabled ? "RGB control is off" : !st.connected ? "Not connected to OpenRGB" : !st.devices.length ? "Waiting for OpenRGB to find your lights" : st.reason || "Connected"}</h2>
          <p className="sub">
            {!st.connected
              ? "Rigmind talks to your lights through OpenRGB, which supports Corsair, ASUS, MSI, Gigabyte, Razer, Logitech, RAM and more."
              : !st.devices.length
              ? "OpenRGB is running but hasn't reported any devices yet. Detection can take up to 20 seconds. If none appear, open OpenRGB and check its device list."
              : `Controlling ${st.devices.filter((d) => d.state === "direct" || d.state === "static").length} of ${st.devices.length} devices.`}
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
      {st.connected && st.devices.length > 0 && (
        <section className="panel">
          <h2>Devices</h2>
          <table className="list" style={{ marginTop: 10 }}>
            <tbody>
              {st.devices.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td className="muted">{d.leds} LEDs</td>
                  <td className="num">
                    {d.state === "direct" ? <span className="tag good">Working</span>
                    : d.state === "static" ? <span className="tag good">Working (one color at a time)</span>
                    : d.state === "no-leds" ? <span className="tag warn">0 LEDs: resize its zones in OpenRGB</span>
                    : <span className="tag neutral">No supported mode</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {st.devices.some((d) => d.state === "no-leds") && (
            <p className="muted small" style={{ marginBottom: 0 }}>Fans on motherboard ARGB headers start at 0 LEDs. In OpenRGB, open the device, click Resize on each ARGB zone, enter the LED count of the fans on it, then save the profile.</p>
          )}
        </section>
      )}
      {cfg.enabled && (!st.connected || !st.devices.length) && <div className="notice info">Close iCUE, Armoury Crate, Mystic Light or RGB Fusion first. They fight over the same lights. RAM and some motherboards also need the PawnIO driver.</div>}

      <div className="grid-2">
        <section className="panel">
          <h2>Mode</h2>
          <div className="seg" role="radiogroup" style={{ margin: "12px 0 6px" }}>
            {(["status", "screen", "static", "off"] as const).map((m) => (
              <button key={m} role="radio" aria-checked={cfg.mode === m} className={cfg.mode === m ? "on" : ""} onClick={() => save({ mode: m })}>
                {m === "status" ? "Show PC status" : m === "screen" ? "Match screen" : m === "static" ? "One color" : "Off"}
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
          {cfg.mode === "screen" && <p className="muted small">Your lights follow the colors on screen, four times a second. Works best with borderless or windowed games.</p>}
          <Setting title={`Brightness ${cfg.brightness}%`}>
            <input type="range" min={5} max={100} value={cfg.brightness} onChange={(e) => save({ brightness: Number(e.target.value) })} aria-label="Brightness" style={{ width: 200 }} />
          </Setting>
        </section>

        <section className="panel">
          <h2>Smart lighting</h2>
          <Setting title="Heat alerts" desc="Pulses red if the CPU passes 90°C or the GPU passes 85°C.">
            <Switch checked={cfg.alerts} onChange={(v) => save({ alerts: v })} label="Heat alerts" />
          </Setting>
          {ex && (
            <Setting title="React to the game" desc="CS2 and Dota 2: flash on kills, pulse red at low health, count down the bomb. Uses the games' official state feed.">
              <div className="row">
                <button className="btn sm" onClick={async () => toast((await api.installGameLighting()).message)}>Set up</button>
                <Switch checked={ex.gameLighting} onChange={async (v) => setEx(await api.saveExtras({ gameLighting: v }))} label="Game-reactive lighting" />
              </div>
            </Setting>
          )}
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
