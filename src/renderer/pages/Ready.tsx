import { useEffect, useState } from "react";
import { api, fmt } from "../api";
import { Setting, Switch, toast } from "../components/Bits";
import type { ModeState, ReadyReport, ReadySettings, ReadyState, StageStatus } from "../../shared/types";

const STATUS: Record<StageStatus, { cls: string; text: string }> = {
  pending: { cls: "neutral", text: "Waiting" },
  running: { cls: "warn", text: "Working" },
  done: { cls: "good", text: "Done" },
  skipped: { cls: "neutral", text: "Skipped" },
  failed: { cls: "crit", text: "Problem" },
};
const STOPPED: Record<string, string> = { input: "You started using the PC, so Ready stopped and handed it back.", heat: "Stopped because the PC got too hot.", battery: "Didn't run because the PC was on battery.", call: "Stopped because a call started." };

export function readyName(m: ModeState | null) {
  return m?.mode === "work" ? "Ready to Work" : m?.mode === "gaming" ? "Ready to Play" : "Ready";
}

export function Ready({ mode }: { mode: ModeState | null }) {
  const [st, setSt] = useState<ReadyState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    api.readyState().then(setSt);
    return api.onReady(setSt);
  }, []);
  if (!st) return null;
  const s = st.settings;
  const set = async (patch: Partial<ReadySettings>) => setSt(await api.readySave(patch));
  const act = async (label: string, fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(label);
    try {
      toast((await fn()).message);
    } catch (e: any) {
      toast(e?.message ?? "Something went wrong");
    }
    setBusy(null);
  };
  const r: ReadyReport | null = st.current ?? st.last;
  const gaming = mode?.mode !== "work";
  const working = mode?.mode !== "gaming";
  const warmedOk = r?.warmed.filter((w) => w.outcome === "warmed") ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{readyName(mode)}</h1>
          <p className="sub">
            While you sleep, Rigmind {gaming ? "patches your games, warms up their shaders" : "updates your apps"}{gaming && working ? ", updates your apps" : ""} and installs Windows updates with the screen off and the sound muted. Touch the keyboard or mouse and it stops within 2 seconds.
          </p>
        </div>
        <div className="row">
          {st.running ? (
            <button className="btn" onClick={() => act("cancel", api.readyCancel)}>Stop</button>
          ) : (
            <>
              <button className="btn" disabled={!!busy} onClick={() => act("dry", () => api.readyRunNow(true))}>Practice run</button>
              <button className="btn primary" disabled={!!busy} onClick={() => act("run", () => api.readyRunNow(false))}>Run Ready now</button>
            </>
          )}
        </div>
      </div>

      <section className="panel boost-status">
        <div className={`boost-ring ${s.enabled ? "on" : ""}`}>
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
        </div>
        <div style={{ flex: 1 }}>
          <h2>{st.running ? (r?.dryRun ? "Practice run in progress" : "Working on your PC") : s.enabled ? `On every ${s.weekdaysOnly ? "weeknight" : "night"} at ${s.from}` : "Off"}</h2>
          <ul className="checklist">
            {s.enabled && !s.dryRunDone && <li>The first night is a practice run: Rigmind only logs what it would do</li>}
            {st.weekMinutesSaved > 0 && <li>About {st.weekMinutesSaved} min of waiting saved this week</li>}
            {st.last && <li className="muted">Last run {fmt.ago(st.last.start)}</li>}
          </ul>
        </div>
        <Switch checked={s.enabled} onChange={(v) => set({ enabled: v })} label="Ready at night" />
      </section>

      {st.wakeIssues.length > 0 && s.enabled && (
        <div className="notice">
          {st.wakeIssues.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}

      {r && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>{st.current ? "Tonight's run" : r.dryRun ? "Last practice run" : "Last night"}</h2>
              <p className="sub small">
                {fmt.when(r.start)}
                {r.end ? ` · ${fmt.dur(r.end - r.start)}` : ""}
                {r.trigger === "catchup" ? " · catch-up after the PC was off" : r.trigger === "manual" ? " · started by you" : ""}
              </p>
            </div>
            <button className="btn ghost sm" onClick={() => setShowLog((v) => !v)}>{showLog ? "Hide log" : "Show log"}</button>
          </div>
          {r.stoppedBy && <div className="notice info" style={{ marginBottom: 12 }}>{STOPPED[r.stoppedBy]}</div>}
          {r.needsYou.length > 0 && (
            <div className="notice" style={{ marginBottom: 12 }}>
              <b>Needs you</b>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {r.needsYou.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="stats" style={{ marginBottom: 14 }}>
            <div className="stat"><div className="v">{r.gamesUpdated.length}</div><div className="k">Games patched</div></div>
            <div className="stat"><div className="v">{warmedOk.length}</div><div className="k">Games warmed</div></div>
            <div className="stat"><div className="v">{r.appsUpdated.length}</div><div className="k">Apps updated</div></div>
            <div className="stat"><div className="v">{r.downloadedGB}<small>GB</small></div><div className="k">Downloaded</div></div>
            <div className="stat"><div className="v">{Math.round(r.minutesSaved)}<small>min</small></div><div className="k">Waiting saved</div></div>
          </div>
          <table className="list">
            <tbody>
              {r.stages
                .filter((x) => !(x.status === "skipped" && /mode$/.test(x.note ?? "")))
                .map((x) => (
                  <tr key={x.id}>
                    <td style={{ width: 210 }}><b>{x.label}</b></td>
                    <td className="muted">{x.note}</td>
                    <td className="num" style={{ width: 110 }}><span className={`tag ${STATUS[x.status].cls}`}>{STATUS[x.status].text}</span></td>
                  </tr>
                ))}
            </tbody>
          </table>
          {r.warmed.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>Shader warm-up</h3>
              <table className="list" style={{ marginTop: 6 }}>
                <thead><tr><th>Game</th><th className="num">Time</th><th className="num">Shaders built</th><th>Result</th></tr></thead>
                <tbody>
                  {r.warmed.map((w) => (
                    <tr key={w.appId}>
                      <td>{w.game}</td>
                      <td className="num">{Math.round(w.seconds / 60)} min</td>
                      <td className="num">{w.cacheMB} MB</td>
                      <td>{{ warmed: "Ready, no compile wait", no_gain: "Nothing to build (Rigmind stops warming it after 3 tries)", timed_out: "Took over 20 min, stopped", needs_you: "Stopped at a sign-in or prompt", skipped: "Skipped" }[w.outcome]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {showLog && <pre className="small" style={{ whiteSpace: "pre-wrap", background: "var(--bg)", padding: 12, borderRadius: 8, marginTop: 12, maxHeight: 260, overflow: "auto" }}>{r.log.join("\n") || "Nothing logged yet."}</pre>}
        </section>
      )}

      <>
        <section className="panel">
          <h2>When and what</h2>
          <Setting title="Night window" desc="Rigmind wakes the PC at the start and stops starting new work an hour before the end.">
            <div className="row">
              <input className="input" type="time" style={{ width: 130 }} value={s.from} onChange={(e) => set({ from: e.target.value })} aria-label="Start" />
              <span className="muted">to</span>
              <input className="input" type="time" style={{ width: 130 }} value={s.to} onChange={(e) => set({ to: e.target.value })} aria-label="End" />
            </div>
          </Setting>
          <Setting title="Weeknights only" desc="Skip Friday and Saturday nights."><Switch checked={s.weekdaysOnly} onChange={(v) => set({ weekdaysOnly: v })} label="Weeknights only" /></Setting>
          {gaming && <Setting title="Game updates" desc="Steam downloads patches with no window open. Other launchers come later."><Switch checked={s.gameUpdates} onChange={(v) => set({ gameUpdates: v })} label="Game updates" /></Setting>}
          {working && <Setting title="App updates" desc="Updates apps through winget. Apps that are open are skipped, since updating them would close them."><Switch checked={s.appUpdates} onChange={(v) => set({ appUpdates: v })} label="App updates" /></Setting>}
          <Setting title="Windows updates" desc={mode?.managed ? "Your company's IT manages updates on this PC, so Rigmind only reports them." : "Installs after making a System Restore point."}><Switch checked={s.windowsUpdates} onChange={(v) => set({ windowsUpdates: v })} label="Windows updates" /></Setting>
          <Setting title="GPU driver" desc="Download only is the safe default: you install with one click in the morning.">
            <div className="seg">
              {(["off", "download", "install"] as const).map((v) => (
                <button key={v} className={s.gpuDriver === v ? "on" : ""} onClick={() => set({ gpuDriver: v })}>{{ off: "Off", download: "Download only", install: "Install" }[v]}</button>
              ))}
            </div>
          </Setting>
          <Setting title="Restarts" desc="Only restarts when nothing unsaved is open, nobody else is signed in, and no call or game is running.">
            <div className="seg">
              {(["never", "safe"] as const).map((v) => (
                <button key={v} className={s.restarts === v ? "on" : ""} onClick={() => set({ restarts: v })}>{v === "never" ? "Never" : "Only if safe"}</button>
              ))}
            </div>
          </Setting>
        </section>

        <section className="panel">
          <h2>Quiet and safe</h2>
          {gaming && (
            <Setting title="Shader warm-up" desc="Launches your most-played games to their menu so the shader compile happens tonight, not when you sit down to play.">
              <div className="seg">
                {(["off", "top3", "top5", "all"] as const).map((v) => (
                  <button key={v} className={s.warmup === v ? "on" : ""} onClick={() => set({ warmup: v })}>{{ off: "Off", top3: "Top 3", top5: "Top 5", all: "All recent" }[v]}</button>
                ))}
              </div>
            </Setting>
          )}
          {gaming && <Setting title="Pre-warm" desc="Loads tonight's likely game into spare RAM so it opens faster. Only when the PC sleeps (not hibernate) and 8 GB+ is free."><Switch checked={s.prewarm} onChange={(v) => set({ prewarm: v })} label="Pre-warm" /></Setting>}
          <Setting title="Download cap" desc="Most a night can download. 0 means no cap.">
            <div className="row"><input className="input" type="number" min={0} style={{ width: 90 }} value={s.downloadCapGB} onChange={(e) => set({ downloadCapGB: Math.max(0, Number(e.target.value) || 0) })} aria-label="Download cap" /><span className="muted">GB</span></div>
          </Setting>
          <Setting title="Temperature limits" desc="If the GPU or CPU passes these, the game closes and Rigmind moves on.">
            <div className="row">
              <span className="muted small">GPU</span><input className="input" type="number" style={{ width: 70 }} value={s.gpuLimitC} onChange={(e) => set({ gpuLimitC: Number(e.target.value) || 83 })} aria-label="GPU limit" />
              <span className="muted small">CPU</span><input className="input" type="number" style={{ width: 70 }} value={s.cpuLimitC} onChange={(e) => set({ cpuLimitC: Number(e.target.value) || 90 })} aria-label="CPU limit" />
              <span className="muted">°C</span>
            </div>
          </Setting>
          <Setting title="Check that waking works" desc="Schedules a wake in 5 minutes. Put the PC to sleep and see if it wakes.">
            <button className="btn sm" disabled={!!busy} onClick={() => act("wake", api.readyTestWake)}>Test wake</button>
          </Setting>
          <p className="muted small" style={{ marginTop: 10 }}>At night the screen is turned off, sound is muted, RGB goes dark, fans use the quiet curve and notifications are held. Everything goes back exactly as it was.</p>
        </section>
      </>

      {gaming && st.topGames.length > 0 && (
        <section className="panel">
          <h2>Games Rigmind keeps ready</h2>
          <p className="sub small">Ranked by how recently and how often you play them, and which days you usually play.</p>
          <table className="list" style={{ marginTop: 10 }}>
            <thead><tr><th>Game</th><th className="num">Score</th><th>Warm-up</th><th /></tr></thead>
            <tbody>
              {st.topGames.map((g) => {
                const always = s.alwaysWarm.includes(g.appId);
                const never = s.neverTouch.includes(g.appId);
                return (
                  <tr key={g.appId}>
                    <td>{g.name}</td>
                    <td className="num">{g.score}</td>
                    <td>{never ? <span className="tag neutral">Never touched</span> : g.warm ? <span className="tag good">Warmed at night</span> : <span className="tag neutral">Updates only</span>}</td>
                    <td className="num">
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <button className="btn ghost sm" onClick={() => set({ alwaysWarm: always ? s.alwaysWarm.filter((x) => x !== g.appId) : [...s.alwaysWarm, g.appId], neverTouch: s.neverTouch.filter((x) => x !== g.appId) })}>{always ? "Unpin" : "Always warm"}</button>
                        <button className="btn ghost sm" onClick={() => set({ neverTouch: never ? s.neverTouch.filter((x) => x !== g.appId) : [...s.neverTouch, g.appId], alwaysWarm: s.alwaysWarm.filter((x) => x !== g.appId) })}>{never ? "Allow" : "Never touch"}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
