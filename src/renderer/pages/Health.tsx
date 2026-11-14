import { useEffect, useState } from "react";
import { api, fmt } from "../api";
import { Markdown, Thinking, toast } from "../components/Bits";
import { LineChart, Legend } from "../components/Charts";
import type { BootReport, Checkup, DriverImpact, HealthTrend, Incident, Settings, StressResult, StressState, ProposedAction } from "../../shared/types";

const KIND_LABEL: Record<Incident["kind"], string> = {
  app_crash: "Crash",
  app_hang: "Froze",
  gpu_reset: "GPU reset",
  hardware_error: "Hardware error",
  bluescreen: "Blue screen",
  power_loss: "Sudden shutdown",
};

export function Health({ settings }: { settings: Settings }) {
  const [checkups, setCheckups] = useState<Checkup[]>([]);
  const [checking, setChecking] = useState(false);
  const [inc, setInc] = useState<Incident[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [explaining, setExplaining] = useState<string | null>(null);
  const [trends, setTrends] = useState<{ weeks: HealthTrend[]; warning: string | null } | null>(null);
  const [boot, setBoot] = useState<BootReport | null>(null);
  const [impact, setImpact] = useState<DriverImpact[]>([]);

  useEffect(() => {
    api.listCheckups().then(setCheckups);
    api.listIncidents().then(setInc);
    api.healthTrends().then(setTrends);
    api.bootReport().then(setBoot).catch(() => {});
    api.driverImpact().then(setImpact);
    return api.onIncident((i) => setInc((l) => [i, ...l]));
  }, []);

  const latest = checkups[0];
  const explain = async (id: string) => {
    setExplaining(id);
    try {
      const text = await api.explainIncident(id);
      setInc((l) => l.map((x) => (x.id === id ? { ...x, explanation: text } : x)));
    } catch (e: any) {
      toast(e?.message ?? "Couldn't explain that one");
    }
    setExplaining(null);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Health</h1>
          <p className="sub">Crashes, temperatures over time, boot speed and stability, all in one place.</p>
        </div>
        <button className="btn primary" disabled={!settings.aiReady || checking} onClick={async () => {
          setChecking(true);
          try { const c = await api.runCheckup(); setCheckups((l) => [c, ...l]); } catch (e: any) { toast(e?.message ?? "Checkup failed"); }
          setChecking(false);
        }}>{checking ? "Checking…" : "Run checkup now"}</button>
      </div>

      {latest ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Daily checkup</h2>
            <span className="muted small">{fmt.when(latest.t)}</span>
          </div>
          <Markdown text={latest.report} />
          <ActionList actions={latest.actions} />
        </section>
      ) : (
        <section className="panel">
          <h2>Daily checkup</h2>
          <p className="sub">{settings.aiReady ? "Every day Rigmind reviews crashes, temperatures, security, drivers and your games, then tells you only what needs attention." : "Set up an AI engine in Settings to get a daily checkup."}</p>
        </section>
      )}

      {trends?.warning && <div className="notice">{trends.warning}</div>}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Crash Detective</h2>
            <p className="sub small">Crashes, GPU driver resets, hardware errors and sudden shutdowns, with what your PC was doing just before.</p>
          </div>
        </div>
        {!inc.length && <p className="muted" style={{ margin: 0 }}>No crashes or hardware errors in the last week.</p>}
        {inc.slice(0, 12).map((i) => (
          <div key={i.id} className="incident">
            <button className="incident-head" aria-expanded={open === i.id} onClick={() => setOpen(open === i.id ? null : i.id)}>
              <span className={`tag ${i.kind === "app_crash" || i.kind === "app_hang" ? "warn" : "crit"}`}>{KIND_LABEL[i.kind]}</span>
              <span className="grow">{i.title}</span>
              <span className="muted small">{fmt.when(i.t)}</span>
            </button>
            {open === i.id && (
              <div className="incident-body">
                {i.context && (
                  <div className="cmp" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
                    <div><span>CPU</span><b>{i.context.cpu != null ? `${Math.round(i.context.cpu)}%` : "–"}</b><span>{i.context.cpuTemp != null ? `${i.context.cpuTemp}°C` : ""}</span></div>
                    <div><span>GPU</span><b>{i.context.gpu != null ? `${Math.round(i.context.gpu)}%` : "–"}</b><span>{i.context.gpuTemp != null ? `${i.context.gpuTemp}°C` : ""}</span></div>
                    <div><span>GPU power</span><b>{i.context.gpuPowerW != null ? `${Math.round(i.context.gpuPowerW)} W` : "–"}</b><span>peak</span></div>
                    <div><span>Memory</span><b>{i.context.ramGB != null ? `${i.context.ramGB.toFixed(1)} GB` : "–"}</b><span>in use</span></div>
                    <div><span>From</span><b style={{ fontSize: 14 }}>{i.context.source === "flight-recorder" ? "Flight recorder" : i.context.source === "session" ? "Session log" : "Live data"}</b><span>last 30 s</span></div>
                  </div>
                )}
                <p className="muted small" style={{ margin: "10px 0" }}>{i.detail}</p>
                {i.explanation ? <Markdown text={i.explanation} /> : explaining === i.id ? <Thinking /> : (
                  <button className="btn sm" disabled={!settings.aiReady} onClick={() => explain(i.id)}>Explain what happened</button>
                )}
              </div>
            )}
          </div>
        ))}
      </section>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <h2>Temperatures under load</h2>
            <Legend items={[{ name: "CPU", color: "var(--cpu)" }, { name: "GPU", color: "var(--gpu)" }]} />
          </div>
          {trends && trends.weeks.length > 1 ? (
            <div style={{ paddingBottom: 20 }}>
              <LineChart label="Average temperature under load by week" height={170} times={trends.weeks.map((_, i) => i * 7 * 86400)} series={[
                { name: "CPU", color: "var(--cpu)", values: trends.weeks.map((w) => w.cpuTempAtLoad), unit: "°C" },
                { name: "GPU", color: "var(--gpu)", values: trends.weeks.map((w) => w.gpuTempAtLoad), unit: "°C" },
              ]} xLabels={trends.weeks.map((w) => w.week.slice(5))} />
            </div>
          ) : <p className="muted" style={{ margin: 0 }}>Builds up week by week as you play.</p>}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Boot time</h2>
            {boot?.boots.length ? <span className="muted small">Last boot {boot.boots[boot.boots.length - 1].bootSec} s</span> : null}
          </div>
          {boot?.boots.length ? (
            <div className="bars" role="img" aria-label="Boot time for recent boots">
              {boot.boots.map((b) => {
                const max = Math.max(...boot.boots.map((x) => x.bootSec));
                return <span key={b.t} title={`${fmt.when(b.t)}: ${b.bootSec} s`} style={{ height: `${(b.bootSec / max) * 100}%` }} />;
              })}
            </div>
          ) : <p className="muted" style={{ margin: 0 }}>No boot records found.</p>}
          {boot?.slowItems.length ? (
            <>
              <h3 style={{ margin: "14px 0 6px" }}>Slowing your startup</h3>
              {boot.slowItems.slice(0, 5).map((s) => (
                <div key={s.name + s.kind} className="row between small" style={{ padding: "4px 0" }}>
                  <span>{s.name} <span className="muted">{s.kind}</span></span>
                  <span>+{s.delaySec} s</span>
                </div>
              ))}
              <button className="btn sm" style={{ marginTop: 8 }} onClick={() => api.executeAction({ id: "x", kind: "open_windows_setting", target: "startup", label: "", reason: "" })}>Manage startup apps</button>
            </>
          ) : null}
        </section>
      </div>

      {impact.length > 0 && (
        <section className="panel">
          <h2>Driver updates and your games</h2>
          <p className="sub small">How each game ran on each GPU driver you've used.</p>
          <table className="list" style={{ marginTop: 10 }}>
            <thead><tr><th>Game</th><th>Driver</th><th className="num">Sessions</th><th className="num">Avg FPS</th><th className="num">1% low</th></tr></thead>
            <tbody>
              {impact.flatMap((g) => g.rows.map((r, i) => (
                <tr key={g.exe + r.driver}>
                  <td>{i === 0 ? <b>{g.game}</b> : ""}{i === g.rows.length - 1 && g.verdict ? <div className="muted small">{g.verdict}</div> : null}</td>
                  <td>{r.driver}</td><td className="num">{r.sessions}</td><td className="num">{r.avgFps ?? "–"}</td><td className="num">{r.low1 ?? "–"}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </section>
      )}

      <StressAndCoach settings={settings} />
    </div>
  );
}

function ActionList({ actions }: { actions: ProposedAction[] }) {
  const [state, setState] = useState<Record<string, string>>({});
  if (!actions.length) return null;
  return (
    <div style={{ marginTop: 6 }}>
      {actions.map((a) => (
        <div key={a.id} className="action-card">
          <div><h3>{a.label}</h3><div className="why">{state[a.id] ?? a.reason}</div></div>
          {state[a.id] ? <span className="tag good">Done</span> : <button className="btn primary sm" onClick={async () => { const r = await api.executeAction(a); setState((s) => ({ ...s, [a.id]: r.message })); }}>Apply</button>}
        </div>
      ))}
    </div>
  );
}

function StressAndCoach({ settings }: { settings: Settings }) {
  const [list, setList] = useState<StressResult[]>([]);
  const [st, setSt] = useState<StressState | null>(null);
  const [label, setLabel] = useState("");
  const [minutes, setMinutes] = useState(5);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    api.stressList().then(setList);
    return api.onStress((s) => {
      setSt(s);
      if (!s.running) api.stressList().then(setList);
    });
  }, []);
  const running = st?.running;
  return (
    <div className="grid-2">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Stress test</h2>
            <p className="sub small">Loads the CPU and GPU to check cooling, throttling and stability. Close games first.</p>
          </div>
        </div>
        {running ? (
          <div className="stack">
            <div className="row between small"><span>{st!.label}: {Math.floor(st!.elapsed / 60)}:{String(st!.elapsed % 60).padStart(2, "0")} of {st!.seconds / 60} min</span><button className="btn ghost sm" onClick={() => api.stressStop()}>Stop</button></div>
            <div className="progress"><i style={{ width: `${st!.progress * 100}%` }} /></div>
            <div className="cmp">
              <div><span>CPU</span><b>{st!.live?.cpuTemp ?? "–"}°C</b></div>
              <div><span>GPU</span><b>{st!.live?.gpuTemp ?? "–"}°C</b></div>
              <div><span>GPU clock</span><b>{st!.live?.gpuClock ?? "–"}</b><span>MHz, {st!.live?.gpuPower ? `${Math.round(st!.live.gpuPower)} W` : ""}</span></div>
            </div>
          </div>
        ) : (
          <form className="row wrap" onSubmit={async (e) => { e.preventDefault(); const r = await api.stressStart(minutes * 60, label || "Stress test", true, true); if ("error" in r) toast(r.error); setLabel(""); }}>
            <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Label, e.g. 0.925 V @ 2715 MHz" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Test label" />
            <select className="input" style={{ width: 110 }} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Duration">
              <option value={2}>2 min</option><option value={5}>5 min</option><option value={10}>10 min</option><option value={30}>30 min</option>
            </select>
            <button className="btn primary" type="submit">Start test</button>
          </form>
        )}
        {list.slice(0, 6).map((r) => (
          <div key={r.id} className="row between small" style={{ padding: "8px 0", borderTop: "1px solid var(--line-soft)", marginTop: 6 }}>
            <div><b>{r.label}</b> <span className="muted">{fmt.when(r.t)}</span><div className="muted">{r.reason}</div></div>
            <span className={`tag ${r.passed ? (r.throttled ? "warn" : "good") : "crit"}`}>{r.passed ? (r.throttled ? "Throttled" : "Passed") : "Failed"}</span>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Undervolting coach</h2>
        <p className="sub small">Run your GPU cooler and quieter at the same speed. Change one step at a time in MSI Afterburner, label the stress test with the setting, and the coach tells you what to try next.</p>
        <form className="row" style={{ marginTop: 10 }} onSubmit={async (e) => { e.preventDefault(); setAsking(true); try { setAnswer(await api.coachAsk(q)); } catch (err: any) { toast(err?.message ?? "Coach unavailable"); } setAsking(false); }}>
          <input className="input" placeholder="What should I try next?" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Question for the coach" />
          <button className="btn" type="submit" disabled={!settings.aiReady || asking}>Ask</button>
        </form>
        <div style={{ marginTop: 12 }}>{asking ? <Thinking /> : answer ? <Markdown text={answer} /> : null}</div>
        <p className="muted small" style={{ marginBottom: 0 }}>The coach never raises voltage above stock or the power limit above 100%. Undervolting is safe: an unstable step just crashes the test, and the previous setting fixes it.</p>
      </section>
    </div>
  );
}
