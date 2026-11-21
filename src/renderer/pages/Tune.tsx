import { useEffect, useState } from "react";
import { DevPanel } from "../components/DevPanel";
import { api, fmt } from "../api";
import { Setting, Switch, toast } from "../components/Bits";
import type { DisplayReport, EnergySummary, ExtrasSettings, NetStatus, ShaderCacheInfo } from "../../shared/types";

export function Tune() {
  const [disp, setDisp] = useState<DisplayReport | null>(null);
  const [net, setNet] = useState<NetStatus | null>(null);
  const [energy, setEnergy] = useState<EnergySummary | null>(null);
  const [shaders, setShaders] = useState<ShaderCacheInfo | null>(null);
  const [ex, setEx] = useState<ExtrasSettings | null>(null);

  useEffect(() => {
    api.displayReport().then(setDisp).catch(() => {});
    api.netStatus().then(setNet);
    api.energySummary().then(setEnergy);
    api.shaderInfo().then(setShaders);
    api.getExtras().then(setEx);
    const off = api.onNet(setNet);
    const id = setInterval(() => api.energySummary().then(setEnergy), 10_000);
    return () => (off(), clearInterval(id));
  }, []);
  const saveEx = async (p: Partial<ExtrasSettings>) => setEx(await api.saveExtras(p));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tune</h1>
          <p className="sub">Free performance hiding in your settings: displays, network, shader caches and Windows itself.</p>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div><h2>Display Doctor</h2><p className="sub small">Catches monitors running slower or blurrier than they can.</p></div>
          {disp && <span className={`tag ${disp.issues.length ? "warn" : "good"}`}>{disp.issues.length ? `${disp.issues.length} issue${disp.issues.length > 1 ? "s" : ""}` : "All good"}</span>}
        </div>
        {disp?.issues.map((i) => (
          <div key={i.text} className="action-card">
            <div><h3>{i.text}</h3>{i.fix && <div className="why">A higher refresh rate makes everything smoother, even on the desktop.</div>}</div>
            {i.fix && <button className="btn primary sm" onClick={async () => { const r = await api.setRefresh(i.device, i.fix!.hz); toast(r.message); api.displayReport().then(setDisp); }}>Set to {i.fix.hz} Hz</button>}
          </div>
        ))}
        <table className="list" style={{ marginTop: 10 }}>
          <tbody>
            {disp?.displays.map((d) => (
              <tr key={d.device}>
                <td><b>{d.monitor || d.device}</b><div className="muted small">{d.gpu}</div></td>
                <td>{d.width}×{d.height}</td>
                <td className="num">
                  <select className="input" style={{ width: 110 }} value={d.hz} aria-label={`Refresh rate for ${d.monitor}`} onChange={async (e) => { const r = await api.setRefresh(d.device, Number(e.target.value)); toast(r.message); api.displayReport().then(setDisp); }}>
                    {d.rates.map((r) => <option key={r} value={r}>{r} Hz</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {disp && disp.vrrWindows === false && <p className="muted small" style={{ marginBottom: 0 }}>Windows' "Variable refresh rate" setting is off. Turning it on helps G-Sync/FreeSync work in more games (Settings &gt; Display &gt; Graphics).</p>}
        {!disp && <p className="muted" style={{ margin: 0 }}>Needs the hardware helper (npm run build:hw).</p>}
      </section>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <div><h2>Network</h2><p className="sub small">Ping, jitter and packet loss, including to the server your game is connected to.</p></div>
          </div>
          <table className="list">
            <thead><tr><th>To</th><th className="num">Now</th><th className="num">Jitter</th><th className="num">Loss</th></tr></thead>
            <tbody>
              {net?.targets.map((t) => (
                <tr key={t.host}>
                  <td>{t.label}<div className="muted small">{t.host}</div></td>
                  <td className="num">{t.ms != null ? `${t.ms} ms` : "–"}</td>
                  <td className="num">{t.jitter != null ? `${t.jitter} ms` : "–"}</td>
                  <td className="num" style={t.loss > 2 ? { color: "var(--warn)" } : undefined}>{t.loss}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {net?.wifi && <p className="small" style={{ marginBottom: 0, color: net.wifi.signal < 60 ? "var(--warn)" : "var(--ink-2)" }}>Wi-Fi "{net.wifi.ssid}" at {net.wifi.signal}% signal{net.wifi.band ? `, ${net.wifi.band}` : ""}.{net.wifi.signal < 60 ? " A wired connection would cut lag spikes." : ""}</p>}
          {net && !net.gameServers.length && <p className="muted small" style={{ marginBottom: 0 }}>Game server pings appear while you play (for games that use TCP connections).</p>}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Power and cost</h2>{energy?.nowW != null && <span className="muted small">Drawing about {energy.nowW} W now</span>}</div>
          <div className="cmp">
            <div><span>Today</span><b>${energy?.today.cost.toFixed(2) ?? "–"}</b><span>{energy?.today.kWh ?? "–"} kWh</span></div>
            <div><span>This month</span><b>${energy?.month.cost.toFixed(2) ?? "–"}</b><span>{energy?.month.kWh ?? "–"} kWh</span></div>
            <div><span>Rate</span><b>${energy?.rate}</b><span>per kWh</span></div>
          </div>
          {energy?.days.length ? (
            <div className="bars" style={{ marginTop: 14, height: 70 }} role="img" aria-label="Energy per day">
              {energy.days.map((d) => <span key={d.day} title={`${d.day}: ${d.kWh} kWh`} style={{ height: `${(d.kWh / Math.max(...energy.days.map((x) => x.kWh))) * 100}%` }} />)}
            </div>
          ) : null}
          {ex && (
            <div className="row" style={{ marginTop: 12 }}>
              <label className="small muted">Your electricity rate ($/kWh)</label>
              <input className="input" type="number" step="0.01" min="0" style={{ width: 90 }} defaultValue={ex.energyRate} onBlur={(e) => saveEx({ energyRate: Math.max(0, Number(e.target.value) || 0) })} aria-label="Electricity rate" />
            </div>
          )}
          <p className="muted small" style={{ marginBottom: 0 }}>Estimated from CPU and GPU power sensors plus about {ex?.baselineWatts ?? 60} W for the rest of the PC.</p>
        </section>
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <div><h2>Shader caches</h2><p className="sub small">{shaders ? `${(shaders.totalMb / 1024).toFixed(1)} GB of compiled GPU shaders.` : ""} Clearing them fixes stutter that starts after a driver update.</p></div>
            <button className="btn sm" onClick={async () => { const r = await api.clearShaders(); toast(r.message); api.shaderInfo().then(setShaders); }}>Clear</button>
          </div>
          {shaders?.caches.map((c) => <div key={c.path} className="row between small" style={{ padding: "4px 0" }}><span>{c.name}</span><span className="muted">{c.mb} MB</span></div>)}
          {shaders?.lastCleared && <p className="muted small">Last cleared {fmt.ago(shaders.lastCleared)}.</p>}
          {ex && (
            <Setting title="Clear automatically after a driver update" desc="Old caches from a previous driver are a common cause of stutter.">
              <Switch checked={ex.autoClearShaders} onChange={(v) => saveEx({ autoClearShaders: v })} label="Clear shader caches after driver updates" />
            </Setting>
          )}
        </section>
        <section className="panel">
          <h2>While you play</h2>
          {ex && (
            <>
              <Setting title="Hold Windows Update" desc="Pauses update downloads during a game and resumes them after, so they can't eat bandwidth or cause hitches.">
                <Switch checked={ex.holdWindowsUpdate} onChange={(v) => saveEx({ holdWindowsUpdate: v })} label="Hold Windows Update during games" />
              </Setting>
              <Setting title="Stutter snapshots" desc="Saves a small screenshot when a big stutter happens, so you can see what was on screen. Stored only on this PC.">
                <Switch checked={ex.snapshots} onChange={(v) => saveEx({ snapshots: v })} label="Stutter snapshots" />
              </Setting>
            </>
          )}
          <p className="muted small" style={{ marginBottom: 0 }}>To stop Steam or Epic updates during games, add their launchers to the pause list on the Game Boost page.</p>
        </section>
      </div>
      <DevPanel />
    </div>
  );
}
