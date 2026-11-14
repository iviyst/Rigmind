import { useEffect, useState } from "react";
import { api, fmt } from "../api";
import { IconX } from "./Icons";
import { toast } from "./Bits";
import type { GameProfile, TestRun } from "../../shared/types";

const CHANGE_LABEL: Record<string, string> = {
  power_high: "High performance power",
  pause_app: "Pause an app",
  game_dvr_off: "Background recording off",
  affinity_cache: "Pin to cache cores",
  priority_high: "High priority",
};

export function GameProfiles({ globalPause }: { globalPause: string[] }) {
  const [list, setList] = useState<GameProfile[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [x3d, setX3d] = useState(false);
  const [add, setAdd] = useState("");
  useEffect(() => {
    api.listProfiles().then((l) => {
      setList(l);
      setSel(l[0]?.exe ?? null);
    });
    api.cpuHasCacheCcd().then(setX3d);
  }, []);
  const p = list.find((x) => x.exe === sel);
  const save = async (patch: Partial<GameProfile>) => p && setList(await api.saveProfile({ ...p, ...patch }));

  if (!list.length)
    return (
      <section className="panel">
        <h2>Game profiles</h2>
        <p className="sub">Each game gets its own profile the first time you play it.</p>
      </section>
    );

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Game profiles</h2>
          <p className="sub small">Settings Rigmind applies for each game. Tests and past sessions keep them tuned.</p>
        </div>
      </div>
      <div className="sessions" style={{ gridTemplateColumns: "240px 1fr" }}>
        <div role="listbox" aria-label="Games">
          {list.map((g) => (
            <button key={g.exe} className="session-item" role="option" aria-selected={g.exe === sel} onClick={() => setSel(g.exe)}>
              <span className="g">{g.name}</span>
              <span className="m"><span>{g.sessions} sessions</span>{g.lastPlayed && <span>{fmt.ago(g.lastPlayed)}</span>}</span>
            </button>
          ))}
        </div>
        {p && (
          <div className="stack" style={{ gap: 0 }}>
            <div className="setting">
              <div><h3>Priority</h3><p>How strongly the game claims the CPU.</p></div>
              <select className="input" style={{ width: 160 }} value={p.priority} onChange={(e) => save({ priority: e.target.value as GameProfile["priority"] })} aria-label="Priority">
                <option value="High">High</option>
                <option value="AboveNormal">Above normal</option>
                <option value="Normal">Normal</option>
              </select>
            </div>
            <div className="setting">
              <div><h3>Power plan</h3><p>High performance stops the CPU from clocking down.</p></div>
              <select className="input" style={{ width: 160 }} value={p.power} onChange={(e) => save({ power: e.target.value as GameProfile["power"] })} aria-label="Power plan">
                <option value="high">High performance</option>
                <option value="keep">Leave as is</option>
              </select>
            </div>
            {x3d && (
              <div className="setting">
                <div><h3>Run on cache cores</h3><p>Keeps the game on the CPU half with the extra 3D V-Cache. Often raises 1% lows.</p></div>
                <select className="input" style={{ width: 160 }} value={p.affinity} onChange={(e) => save({ affinity: e.target.value as GameProfile["affinity"] })} aria-label="CPU cores">
                  <option value="all">All cores</option>
                  <option value="cache-ccd">Cache cores only</option>
                </select>
              </div>
            )}
            <div className="setting">
              <div><h3>Fans</h3><p>Fan profile while this game runs.</p></div>
              <select className="input" style={{ width: 160 }} value={p.fanProfile} onChange={(e) => save({ fanProfile: e.target.value as GameProfile["fanProfile"] })} aria-label="Fan profile">
                <option value="default">Gaming default</option>
                <option value="quiet">Quiet</option>
                <option value="balanced">Balanced</option>
                <option value="performance">Performance</option>
              </select>
            </div>
            <div className="setting">
              <div><h3>Lighting color</h3><p>Shown while you play, if game colors are on.</p></div>
              <div className="row">
                {p.rgbColor && <button className="btn ghost sm" onClick={() => save({ rgbColor: null })}>Clear</button>}
                <input type="color" value={p.rgbColor ?? "#2f95db"} onChange={(e) => save({ rgbColor: e.target.value })} aria-label="Game color" style={{ width: 44, height: 32, border: 0, background: "none" }} />
              </div>
            </div>
            <div className="setting" style={{ alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <h3>Apps to pause</h3>
                <div className="seg" role="radiogroup" style={{ margin: "8px 0" }}>
                  <button role="radio" aria-checked={p.pauseMode === "global"} className={p.pauseMode === "global" ? "on" : ""} onClick={() => save({ pauseMode: "global" })}>Use main pause list</button>
                  <button role="radio" aria-checked={p.pauseMode === "custom"} className={p.pauseMode === "custom" ? "on" : ""} onClick={() => save({ pauseMode: "custom", pauseList: p.pauseList.length ? p.pauseList : globalPause })}>Its own list</button>
                </div>
                {p.pauseMode === "custom" && (
                  <>
                    <div className="row wrap">
                      {p.pauseList.map((n) => (
                        <span key={n} className="chip">{n}<button aria-label={`Remove ${n}`} onClick={() => save({ pauseList: p.pauseList.filter((x) => x !== n) })}><IconX /></button></span>
                      ))}
                    </div>
                    <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); const n = add.trim().replace(/\.exe$/i, ""); if (n) save({ pauseList: [...p.pauseList, n] }); setAdd(""); }}>
                      <input className="input" style={{ width: 200 }} placeholder="App name, e.g. Spotify" value={add} onChange={(e) => setAdd(e.target.value)} aria-label="App to pause" />
                      <button className="btn sm" type="submit">Add</button>
                    </form>
                  </>
                )}
                {p.suggestedPause.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <p className="small" style={{ margin: "0 0 6px", color: "var(--ink-2)" }}>These apps caused stutters in your sessions:</p>
                    <div className="row wrap">
                      {p.suggestedPause.map((n) => (
                        <button key={n} className="btn sm" onClick={() => save({ pauseMode: "custom", pauseList: [...new Set([...(p.pauseMode === "custom" ? p.pauseList : globalPause), n])], suggestedPause: p.suggestedPause.filter((x) => x !== n) })}>
                          + Pause {n}
                        </button>
                      ))}
                      <button className="btn ghost sm" onClick={() => save({ suggestedPause: [] })}>Dismiss</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="row" style={{ justifyContent: "flex-end", paddingTop: 8 }}>
              <button className="btn ghost sm" onClick={async () => { const l = await api.deleteProfile(p.exe); setList(l); setSel(l[0]?.exe ?? null); toast("Profile deleted"); }}>Delete profile</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function TestCard({ t, onCancel }: { t: TestRun; onCancel?: () => void }) {
  const running = t.phase !== "done" && t.phase !== "aborted";
  const phaseLabel = t.phase === "before" ? "Measuring before the change" : t.phase === "after" ? "Measuring with the change" : t.phase === "before-again" ? "Measuring without it again" : "";
  return (
    <div className="stack" style={{ gap: 6, padding: "14px 0", borderTop: "1px solid var(--line-soft)" }}>
      <div className="row between">
        <div>
          <h3>{t.label}</h3>
          <div className="muted small">{t.game}, {fmt.when(t.started)}</div>
        </div>
        {running ? (
          onCancel && <button className="btn ghost sm" onClick={onCancel}>Stop test</button>
        ) : t.verdict === "better" ? (
          <span className="tag good">Helped, kept</span>
        ) : t.verdict === "worse" ? (
          <span className="tag crit">Worse, undone</span>
        ) : t.verdict === "same" ? (
          <span className="tag neutral">No difference, undone</span>
        ) : (
          <span className="tag neutral">Stopped</span>
        )}
      </div>
      {running && (
        <>
          <div className="row between small"><span style={{ color: "var(--ink-2)" }}>{phaseLabel}. Keep playing in the same area.</span><span className="muted">{Math.round(t.progress * 100)}%</span></div>
          <div className="progress"><i style={{ width: `${t.progress * 100}%` }} /></div>
        </>
      )}
      {(t.a1 || t.b) && (
        <div className="cmp">
          <div><span>Before</span><b>{t.a1 && t.a2 ? Math.round((t.a1.low1 + t.a2.low1) / 2) : t.a1?.low1 ?? "–"}</b><span>1% low FPS</span></div>
          <div><span>With change</span><b>{t.b?.low1 ?? "–"}</b><span>1% low FPS</span></div>
          <div><span>Average FPS</span><b>{t.a1 ? Math.round(((t.a1.fps) + (t.a2?.fps ?? t.a1.fps)) / 2) : "–"} → {t.b?.fps ?? "–"}</b><span>before → with change</span></div>
        </div>
      )}
      {t.summary && <p className="small" style={{ margin: 0, color: "var(--ink-2)" }}>{t.summary}</p>}
      {!t.summary && !running && <p className="small muted" style={{ margin: 0 }}>{CHANGE_LABEL[t.change]}</p>}
    </div>
  );
}

export function TestsPanel({ gameActive }: { gameActive: boolean }) {
  const [list, setList] = useState<TestRun[]>([]);
  useEffect(() => {
    api.listTests().then(setList);
    return api.onTest((t) => setList((l) => [t, ...l.filter((x) => x.id !== t.id)]));
  }, []);
  const quick: { kind: "power_high" | "game_dvr_off" | "priority_high" | "affinity_cache"; label: string }[] = [
    { kind: "priority_high", label: "High priority" },
    { kind: "power_high", label: "High performance power" },
    { kind: "game_dvr_off", label: "Background recording off" },
    { kind: "affinity_cache", label: "Pin to cache cores" },
  ];
  const running = list.find((t) => t.phase !== "done" && t.phase !== "aborted");
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Before and after tests</h2>
          <p className="sub small">Measures FPS with and without a change while you play, and only keeps it if it really helps. Takes about 2.5 minutes.</p>
        </div>
      </div>
      {gameActive && !running && (
        <div className="row wrap" style={{ marginBottom: 6 }}>
          <span className="muted small">Test now:</span>
          {quick.map((q) => (
            <button key={q.kind} className="btn sm" onClick={async () => toast((await api.startTest(q.kind, undefined, q.label)).message)}>{q.label}</button>
          ))}
        </div>
      )}
      {!gameActive && !list.length && <p className="muted" style={{ margin: 0 }}>Start a game, then test a change here or from the Assistant.</p>}
      {list.slice(0, 6).map((t) => <TestCard key={t.id} t={t} onCancel={() => api.cancelTest()} />)}
    </section>
  );
}
