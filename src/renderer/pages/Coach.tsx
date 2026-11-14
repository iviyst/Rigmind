import { useEffect, useRef, useState } from "react";
import { api, fmt } from "../api";
import { Markdown, Thinking, toast } from "../components/Bits";
import { Sparkline } from "../components/Charts";
import type { ExtrasSettings, GameProfile, MatchRecap, Settings } from "../../shared/types";

// Degrees of turn per mouse count at sensitivity 1 (well-established values).
const YAW: Record<string, number> = { "Counter-Strike 2": 0.022, "Apex Legends": 0.022, VALORANT: 0.07, "Overwatch 2": 0.0066 };

export function Coach({ settings }: { settings: Settings }) {
  const [ex, setEx] = useState<ExtrasSettings | null>(null);
  const [style, setStyle] = useState("");
  const [games, setGames] = useState<GameProfile[]>([]);
  const [game, setGame] = useState("");
  const [goal, setGoal] = useState("");
  const [advice, setAdvice] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [matches, setMatches] = useState<MatchRecap[]>([]);

  useEffect(() => {
    api.getExtras().then((e) => {
      setEx(e);
      setStyle(e.playstyle);
    });
    api.listProfiles().then((l) => {
      setGames(l);
      setGame(l[0]?.name ?? "");
    });
    api.listMatches().then(setMatches);
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Game Coach</h1>
          <p className="sub">Tune each game for your hardware and the way you play, sharpen your aim, and review your matches. Fair play only: no aim assist or anything that breaks a game's rules.</p>
        </div>
      </div>

      <section className="panel">
        <h2>How you play</h2>
        <p className="sub small">Rigmind's advice follows this everywhere: competitive games get maximum FPS and minimum input lag, story games get the best visuals that stay smooth.</p>
        <form className="row" style={{ marginTop: 10 }} onSubmit={async (e) => { e.preventDefault(); setEx(await api.saveExtras({ playstyle: style.slice(0, 300) })); toast("Saved"); }}>
          <input className="input" placeholder="e.g. Competitive CS2 and Valorant, story games on max settings" value={style} onChange={(e) => setStyle(e.target.value)} aria-label="Your playstyle" />
          <button className="btn" type="submit" disabled={style === ex?.playstyle}>Save</button>
        </form>
      </section>

      <section className="panel">
        <h2>Optimize a game</h2>
        <p className="sub small">Reads the game's own settings file and your sessions, then tells you exactly what to change.</p>
        <form className="row wrap" style={{ marginTop: 10 }} onSubmit={async (e) => { e.preventDefault(); if (!game) return; setThinking(true); setAdvice(null); try { setAdvice(await api.gameAdvice(game, goal)); } catch (err: any) { toast(err?.message ?? "Couldn't get advice"); } setThinking(false); }}>
          <select className="input" style={{ width: 220 }} value={game} onChange={(e) => setGame(e.target.value)} aria-label="Game">
            {games.map((g) => <option key={g.exe} value={g.name}>{g.name}</option>)}
            {!games.length && <option value="">Play a game first</option>}
          </select>
          <input className="input" style={{ flex: 1, minWidth: 220 }} placeholder="Goal (optional), e.g. 240 FPS with low input lag" value={goal} onChange={(e) => setGoal(e.target.value)} aria-label="Goal" />
          <button className="btn primary" type="submit" disabled={!settings.aiReady || !game || thinking}>Optimize</button>
        </form>
        <div style={{ marginTop: 14 }}>{thinking ? <Thinking /> : advice ? <Markdown text={advice} /> : null}</div>
      </section>

      <div className="grid-2">
        <SensTools ex={ex} setEx={setEx} />
        <AimWarmup ex={ex} setEx={setEx} />
      </div>

      <section className="panel">
        <div className="panel-head">
          <div><h2>Match recaps</h2><p className="sub small">CS2 and Dota 2 send Rigmind your match stats through their official game state feed. Rigmind lines them up with your FPS and ping round by round.</p></div>
          <button className="btn sm" onClick={async () => toast((await api.installGameLighting()).message)}>Set up CS2 / Dota 2</button>
        </div>
        {!matches.length && <p className="muted" style={{ margin: 0 }}>Play a full CS2 or Dota 2 match after setup and the recap appears here.</p>}
        {matches.slice(0, 5).map((m) => <Recap key={m.id} m={m} canAi={settings.aiReady} />)}
      </section>
    </div>
  );
}

function Recap({ m, canAi }: { m: MatchRecap; canAi: boolean }) {
  const [summary, setSummary] = useState(m.summary);
  const [busy, setBusy] = useState(false);
  const fps = m.rounds.map((r) => r.fps);
  return (
    <div style={{ borderTop: "1px solid var(--line-soft)", padding: "14px 0" }}>
      <div className="row between">
        <div><h3>{m.game === "cs2" ? "Counter-Strike 2" : "Dota 2"}{m.map ? `, ${m.map}` : ""}</h3><div className="muted small">{fmt.when(m.start)}, {fmt.dur(m.end - m.start)}</div></div>
        <div className="row small">{Object.entries(m.stats).filter(([, v]) => v != null).slice(0, 5).map(([k, v]) => <span key={k}><b>{v}</b> <span className="muted">{k.replace("_", " ")}</span></span>)}</div>
      </div>
      {fps.some((x) => x != null) && <div style={{ marginTop: 8 }}><Sparkline values={fps} color="var(--ink)" label="FPS by round" format={(v) => `${Math.round(v)} FPS`} height={32} /></div>}
      <div style={{ marginTop: 8 }}>{busy ? <Thinking /> : summary ? <Markdown text={summary} /> : <button className="btn sm" disabled={!canAi} onClick={async () => { setBusy(true); try { setSummary(await api.recapMatch(m.id)); } catch (e: any) { toast(e?.message ?? "Recap failed"); } setBusy(false); }}>Recap this match</button>}</div>
    </div>
  );
}

function SensTools({ ex, setEx }: { ex: ExtrasSettings | null; setEx: (e: ExtrasSettings) => void }) {
  const [from, setFrom] = useState("Counter-Strike 2");
  const [to, setTo] = useState("VALORANT");
  const [sens, setSens] = useState(1.2);
  const dpi = ex?.aim.dpi ?? 800;
  const cm360 = (360 / (YAW[from] * sens * dpi)) * 2.54;
  const converted = (sens * YAW[from]) / YAW[to];
  return (
    <section className="panel">
      <h2>Sensitivity</h2>
      <p className="sub small">Keep the same aim across games. Converts using each game's real turn rate.</p>
      <div className="stack" style={{ marginTop: 10 }}>
        <div className="row">
          <label className="small muted" style={{ width: 80 }}>Mouse DPI</label>
          <input className="input" type="number" min={100} max={32000} style={{ width: 110 }} defaultValue={dpi} onBlur={async (e) => ex && setEx(await api.saveExtras({ aim: { ...ex.aim, dpi: Math.max(100, Number(e.target.value) || 800) } }))} aria-label="Mouse DPI" />
        </div>
        <div className="row wrap">
          <select className="input" style={{ width: 170 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From game">{Object.keys(YAW).map((g) => <option key={g}>{g}</option>)}</select>
          <input className="input" type="number" step="0.01" min={0.01} style={{ width: 90 }} value={sens} onChange={(e) => setSens(Number(e.target.value) || 0.01)} aria-label="Sensitivity" />
          <span className="muted">in</span>
          <select className="input" style={{ width: 170 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To game">{Object.keys(YAW).map((g) => <option key={g}>{g}</option>)}</select>
        </div>
        <div className="cmp">
          <div><span>{to}</span><b>{converted.toFixed(3)}</b><span>same feel</span></div>
          <div><span>eDPI</span><b>{Math.round(sens * dpi)}</b><span>in {from}</span></div>
          <div><span>Full turn</span><b>{cm360.toFixed(1)} cm</b><span>{(cm360 / 2.54).toFixed(1)} in of mouse</span></div>
        </div>
        <p className="muted small" style={{ margin: 0 }}>Most pros in tactical shooters sit around 30–50 cm per full turn. Lower sensitivity is steadier; higher reacts faster.</p>
      </div>
    </section>
  );
}

function AimWarmup({ ex, setEx }: { ex: ExtrasSettings | null; setEx: (e: ExtrasSettings) => void }) {
  const TOTAL = 30;
  const [running, setRunning] = useState(false);
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null);
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const times = useRef<number[]>([]);
  const shown = useRef(0);
  const place = () => {
    setTarget({ x: 8 + Math.random() * 84, y: 12 + Math.random() * 76 });
    shown.current = performance.now();
  };
  const start = () => {
    setHits(0);
    setMisses(0);
    times.current = [];
    setRunning(true);
    place();
  };
  const finish = async (h: number, m: number) => {
    setRunning(false);
    setTarget(null);
    const avg = times.current.length ? Math.round(times.current.reduce((a, b) => a + b, 0) / times.current.length) : 0;
    const accuracy = h / Math.max(1, h + m);
    const score = Math.round((h * accuracy * 1000) / Math.max(250, avg));
    if (ex) setEx(await api.saveAimScore("flick", score, avg));
    toast(`Score ${score}: ${avg} ms per target, ${Math.round(accuracy * 100)}% accuracy`);
  };
  const scores = (ex?.aim.scores ?? []).filter((s) => s.mode === "flick").slice(0, 20).reverse();
  return (
    <section className="panel">
      <div className="panel-head">
        <div><h2>Aim warm-up</h2><p className="sub small">{TOTAL} targets, as fast and accurately as you can. A quick warm-up before ranked.</p></div>
        {!running && <button className="btn primary sm" onClick={start}>Start</button>}
      </div>
      <div className="aim-arena" onMouseDown={(e) => { if (running && e.target === e.currentTarget) setMisses((m) => m + 1); }} role="application" aria-label="Aim trainer">
        {running ? (
          <>
            <div className="aim-hud">{hits} / {TOTAL}{misses ? `, ${misses} missed` : ""}</div>
            {target && (
              <button className="aim-target" aria-label="Target" style={{ left: `${target.x}%`, top: `${target.y}%` }} onMouseDown={(e) => {
                e.stopPropagation();
                times.current.push(performance.now() - shown.current);
                const h = hits + 1;
                setHits(h);
                if (h >= TOTAL) void finish(h, misses);
                else place();
              }} />
            )}
          </>
        ) : (
          <div className="empty" style={{ paddingTop: 110 }}>{scores.length ? `Best score ${Math.max(...scores.map((s) => s.score))}` : "Press Start"}</div>
        )}
      </div>
      {scores.length > 1 && <div style={{ marginTop: 10 }}><Sparkline values={scores.map((s) => s.score)} color="var(--ink)" label="Warm-up scores over time" format={(v) => `Score ${Math.round(v)}`} height={34} /></div>}
    </section>
  );
}
