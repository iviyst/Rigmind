import { useEffect, useState } from "react";
import { api, fmt } from "../api";
import { Setting, Switch, toast } from "../components/Bits";
import { WhySlowPanel } from "../components/WhySlowPanel";
import type { AppBoostState, MeetingState, ProcInfo } from "../../shared/types";

const KIND: Record<string, string> = { video: "Video and photo", "3d": "3D and CAD", code: "Code", office: "Office and data", gis: "GIS", custom: "Added by you" };

export function Work({ go }: { go: (page: string) => void }) {
  const [ab, setAb] = useState<AppBoostState | null>(null);
  const [mt, setMt] = useState<MeetingState | null>(null);
  const [apps, setApps] = useState<ProcInfo[]>([]);
  const [adding, setAdding] = useState(false);
  const [check, setCheck] = useState<{ mic: string | null; speakers: string | null; camera: boolean; net: string } | null>(null);

  useEffect(() => {
    api.appBoostState().then(setAb);
    api.meetingState().then(setMt);
    const offs = [api.onAppBoost(setAb), api.onMeeting(setMt)];
    return () => offs.forEach((o) => o());
  }, []);
  if (!ab || !mt) return null;

  const groups = Object.entries(
    ab.apps.reduce<Record<string, string[]>>((g, a) => ((g[a.kind] ??= []).includes(a.name) ? g : (g[a.kind].push(a.name), g)), {})
  );
  const health = mt.health;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Work</h1>
          <p className="sub">Heavy jobs get the PC's full attention, calls stay smooth, and Rigmind tells you why things are slow.</p>
        </div>
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>App Boost</h2>
              <p className="sub small">When an export, build, render or big recalculation runs, Rigmind raises that app's priority, pauses cloud sync and keeps the PC awake until it's done.</p>
            </div>
            <Switch checked={ab.enabled} onChange={async (v) => setAb(await api.appBoostSave({ enabled: v }))} label="App Boost" />
          </div>
          {ab.active ? (
            <div className="notice info">
              <b>Boosting {ab.active.app}</b> for {fmt.dur(Date.now() - ab.active.since)}
              {ab.active.paused.length > 0 && <div className="small">Paused while it works: {ab.active.paused.join(", ")}</div>}
            </div>
          ) : (
            <p className="muted small">Nothing heavy is running. Boost starts on its own after about 20 seconds of real work.</p>
          )}
          <h3 style={{ marginTop: 14 }}>Recent jobs</h3>
          {ab.jobs.length ? (
            <table className="list" style={{ marginTop: 6 }}>
              <thead><tr><th>App</th><th>When</th><th className="num">Took</th><th className="num">vs your average</th></tr></thead>
              <tbody>
                {ab.jobs.slice(0, 8).map((j) => (
                  <tr key={j.id}>
                    <td>{j.app}</td>
                    <td className="muted">{fmt.when(j.start)}</td>
                    <td className="num">{j.seconds >= 120 ? `${Math.round(j.seconds / 60)} min` : `${j.seconds} s`}</td>
                    <td className="num">{j.vsAvgPct == null ? "First run" : <span className={`tag ${j.vsAvgPct <= 0 ? "good" : j.vsAvgPct > 20 ? "warn" : "neutral"}`}>{j.vsAvgPct <= 0 ? `${Math.abs(j.vsAvgPct)}% faster` : `${j.vsAvgPct}% slower`}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted small">No jobs yet. Job times show up here so a slowdown over weeks is easy to spot.</p>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Meeting Mode</h2>
              <p className="sub small">Turns on when Teams, Zoom, Meet, Webex, Slack or Discord starts using your microphone. Cloud sync and Windows Update wait until the call ends.</p>
            </div>
            <Switch checked={mt.enabled} onChange={async (v) => setMt(await api.meetingSave({ enabled: v }))} label="Meeting Mode" />
          </div>
          {mt.inCall ? (
            <div className={`notice ${health.level === "good" ? "info" : ""}`}>
              <b>On a {mt.app} call</b> · {fmt.dur(Date.now() - (mt.since ?? Date.now()))}
              <div className="small">{health.message ?? "Connection looks steady."}</div>
              <div className="chips" style={{ marginTop: 8 }}>
                <span>Jitter <b>{health.jitterMs ?? "–"} ms</b></span>
                <span>Loss <b>{health.lossPct ?? "–"}%</b></span>
                {health.wifiSignal != null && <span>Wi-Fi <b>{health.wifiSignal}%</b></span>}
                <span>CPU <b>{health.cpu ?? "–"}%</b></span>
              </div>
            </div>
          ) : (
            <p className="muted small">No call right now.</p>
          )}
          <Setting title="Hold notifications during calls" desc="Turns off Windows pop-ups while you're on a call, then turns them back on.">
            <Switch checked={mt.dnd} onChange={async (v) => setMt(await api.meetingSave({ dnd: v }))} label="Hold notifications" />
          </Setting>
          <Setting title="Before a call" desc="Checks your mic, speakers, camera and connection in a few seconds.">
            <button className="btn sm" onClick={async () => setCheck(await api.meetingCheck())}>Check</button>
          </Setting>
          {check && (
            <div className="kv" style={{ marginTop: 8 }}>
              <span className="k">Microphone</span><span>{check.mic ?? "None found"}</span>
              <span className="k">Speakers</span><span>{check.speakers ?? "None found"}</span>
              <span className="k">Camera</span><span>{check.camera ? "Found" : "None found"}</span>
              <span className="k">Connection</span><span>{check.net}</span>
            </div>
          )}
        </section>
      </div>

      <WhySlowPanel go={go} />

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Apps App Boost knows</h2>
            <p className="sub small">Add any other app that does heavy work.</p>
          </div>
          <button className="btn sm" onClick={async () => { setApps(await api.getRunningApps()); setAdding(true); }}>Add an app</button>
        </div>
        {adding && (
          <div className="chips" style={{ marginBottom: 12 }}>
            {apps.map((p) => (
              <button key={p.name} className="chip" style={{ paddingRight: 10 }} onClick={async () => { setAb(await api.appBoostSave({ addExe: p.name })); setAdding(false); toast(`${p.name} added.`); }}>{p.name}</button>
            ))}
          </div>
        )}
        {groups.map(([kind, names]) => (
          <div key={kind} className="row" style={{ padding: "6px 0", borderTop: "1px solid var(--line-soft)", alignItems: "baseline" }}>
            <span className="muted small" style={{ width: 130, flex: "none" }}>{KIND[kind]}</span>
            <span className="small">{names.join(", ")}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
