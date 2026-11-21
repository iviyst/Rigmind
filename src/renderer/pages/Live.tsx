import { useEffect, useState } from "react";
import { WhySlowPanel } from "../components/WhySlowPanel";
import { api, fmt, tempTone } from "../api";
import { Gauge } from "../components/Gauge";
import { Sparkline } from "../components/Charts";
import type { GameState, ProcInfo, Telemetry, NetStatus, EnergySummary } from "../../shared/types";
import { RigCardButton } from "../components/RigCard";

export function Live({ history, game, onAsk, go }: { history: Telemetry[]; game: GameState; onAsk: (q: string) => void; go?: (page: string) => void }) {
  const t = history[history.length - 1];
  const [procs, setProcs] = useState<ProcInfo[]>([]);
  const [cpuName, setCpuName] = useState<string>();
  const [net, setNet] = useState<NetStatus | null>(null);
  const [energy, setEnergy] = useState<EnergySummary | null>(null);
  useEffect(() => {
    api.netStatus().then(setNet);
    api.energySummary().then(setEnergy);
    const off = api.onNet(setNet);
    const id = setInterval(() => api.energySummary().then(setEnergy), 10_000);
    return () => (off(), clearInterval(id));
  }, []);
  useEffect(() => {
    api.getSystemInfo().then((s) => setCpuName(s.cpu)).catch(() => {});
  }, []);
  useEffect(() => {
    const load = () => api.getTopProcs().then(setProcs);
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  const last = history.slice(-90);
  const topCpu = [...procs].sort((a, b) => b.cpu - a.cpu).slice(0, 7);
  const vramPct = t?.gpu?.vramUsedMB != null && t.gpu.vramTotalMB ? (t.gpu.vramUsedMB / t.gpu.vramTotalMB) * 100 : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{game.active ? game.game : "Your rig, live"}</h1>
          <p className="sub">{game.active ? `Playing for ${fmt.dur(Date.now() - (game.since ?? Date.now()))}${game.boosted ? " with Game Boost on" : ""}` : "Updated every second. Start a game and Game Boost takes over."}</p>
        </div>
        <div className="row">
        <RigCardButton cpuName={cpuName} />
        <button className="btn" onClick={() => onAsk(game.active ? `I'm playing ${game.game}. Look at my live stats and tell me what's limiting my FPS right now.` : "My PC feels slow. Check my live stats and tell me why.")}>
          Ask Rigmind what's slowing it down
        </button>
        </div>
      </div>

      <div className="chips">
        {net?.targets.map((t) => <span key={t.host}>{t.label}: <b>{t.ms ?? "–"} ms</b>{t.loss ? `, ${t.loss}% loss` : ""}</span>)}
        {energy?.nowW != null && <span>Drawing <b>{energy.nowW} W</b>, about ${energy.today.cost.toFixed(2)} today</span>}
      </div>

      <section className="panel hero" aria-label="Load">
        <Gauge
          label="CPU"
          value={t?.cpu.load ?? null}
          color="var(--cpu)"
          name={cpuName}
          meta={[
            { k: "temp", v: fmt.temp(t?.cpu.temp), tone: tempTone(t?.cpu.temp, 85, 95) },
            { k: "MHz", v: t?.cpu.clockMHz ? String(t.cpu.clockMHz) : "–" },
          ]}
        />
        <FpsCore t={t} game={game} history={last} />
        <Gauge
          label="GPU"
          value={t?.gpu?.load ?? null}
          color="var(--gpu)"
          name={t?.gpu?.name}
          meta={[
            { k: "temp", v: fmt.temp(t?.gpu?.temp), tone: tempTone(t?.gpu?.temp, 80, 88) },
            { k: "MHz", v: t?.gpu?.clockMHz ? String(t.gpu.clockMHz) : "–" },
            ...(t?.gpu?.powerW != null ? [{ k: "W", v: String(Math.round(t.gpu.powerW)) }] : []),
          ]}
        />
      </section>

      <div className="grid-4">
        <Meter name="Memory" value={t ? fmt.gb(t.ram.usedGB) : "–"} unit={`/ ${t ? Math.round(t.ram.totalGB) : "–"} GB`} detail={t ? `${Math.round((t.ram.usedGB / t.ram.totalGB) * 100)}% in use` : ""}>
          <Sparkline label="Memory used, last 90 seconds" values={last.map((h) => h.ram.usedGB)} color="var(--ink-2)" max={t?.ram.totalGB} format={(v) => `${v.toFixed(1)} GB`} />
        </Meter>
        <Meter name="Video memory" value={t?.gpu?.vramUsedMB != null ? (t.gpu.vramUsedMB / 1024).toFixed(1) : "–"} unit={t?.gpu?.vramTotalMB ? `/ ${Math.round(t.gpu.vramTotalMB / 1024)} GB` : "GB"} detail={vramPct != null ? `${Math.round(vramPct)}% in use` : "Dedicated GPU memory"}>
          <Sparkline label="Video memory used, last 90 seconds" values={last.map((h) => (h.gpu?.vramUsedMB != null ? h.gpu.vramUsedMB / 1024 : null))} color="var(--gpu)" max={t?.gpu?.vramTotalMB ? t.gpu.vramTotalMB / 1024 : undefined} format={(v) => `${v.toFixed(1)} GB`} />
        </Meter>
        <Meter name="Disk" value={t ? (t.disk.readMBs + t.disk.writeMBs).toFixed(0) : "–"} unit="MB/s" detail={t ? `${t.disk.readMBs.toFixed(0)} read, ${t.disk.writeMBs.toFixed(0)} write` : ""}>
          <Sparkline label="Disk activity, last 90 seconds" values={last.map((h) => h.disk.readMBs + h.disk.writeMBs)} color="var(--ink-2)" format={(v) => `${v.toFixed(0)} MB/s`} />
        </Meter>
        <Meter name="Network" value={t ? t.net.downMbps.toFixed(1) : "–"} unit="Mbps down" detail={t ? `${t.net.upMbps.toFixed(1)} Mbps up` : ""}>
          <Sparkline label="Download speed, last 90 seconds" values={last.map((h) => h.net.downMbps)} color="var(--ink-2)" format={(v) => `${v.toFixed(1)} Mbps`} />
        </Meter>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>What's using your CPU</h2>
          <span className="muted small">Refreshes every 3 seconds</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th>App</th>
              <th className="num">CPU</th>
              <th className="num">Memory</th>
            </tr>
          </thead>
          <tbody>
            {topCpu.map((p) => (
              <tr key={p.pid}>
                <td>
                  {p.name}
                  {game.pid === p.pid && <span className="tag good" style={{ marginLeft: 10 }}>Game</span>}
                </td>
                <td className="num">
                  <div className="bar-cell">
                    <span>{p.cpu.toFixed(1)}%</span>
                    <span className="track"><span className="fill" style={{ display: "block", width: `${Math.min(100, p.cpu)}%`, background: "var(--cpu)" }} /></span>
                  </div>
                </td>
                <td className="num">{p.memMB >= 1024 ? `${(p.memMB / 1024).toFixed(1)} GB` : `${p.memMB} MB`}</td>
              </tr>
            ))}
            {!topCpu.length && (
              <tr>
                <td colSpan={3} className="muted">Collecting process data…</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      {go && <WhySlowPanel go={go} />}
    </div>
  );
}

function FpsCore({ t, game, history }: { t?: Telemetry; game: GameState; history: Telemetry[] }) {
  if (!game.active)
    return (
      <div className="fps-core idle">
        <div className="big">No game running</div>
        <div className="lbl">FPS and frame times appear here when you play.</div>
      </div>
    );
  if (!t?.fps)
    return (
      <div className="fps-core idle">
        <div className="big">{game.game}</div>
        <div className="lbl">{game.fpsCapture === "unavailable" ? "Install PresentMon in Settings to see FPS." : "Waiting for frames…"}</div>
      </div>
    );
  return (
    <div className="fps-core">
      <div className="big" aria-label={`${t.fps.fps} frames per second`}>{t.fps.fps}</div>
      <div className="lbl">frames per second</div>
      <div className="lows">
        <span><b>{t.fps.low1}</b>1% low</span>
        <span><b>{t.fps.frametimeMs.toFixed(1)}</b>ms frame</span>
      </div>
      <div className="fps-strip">
        <Sparkline label="FPS, last 90 seconds" values={history.map((h) => h.fps?.fps ?? null)} color="var(--ink)" format={(v) => `${Math.round(v)} FPS`} height={36} />
      </div>
    </div>
  );
}

function Meter({ name, value, unit, detail, children }: { name: string; value: string; unit: string; detail: string; children: React.ReactNode }) {
  return (
    <section className="panel meter">
      <div className="top">
        <span className="name">{name}</span>
        <span className="val">{value}<small>{unit}</small></span>
      </div>
      <div className="detail">{detail}</div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </section>
  );
}
