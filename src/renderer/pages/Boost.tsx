import { useEffect, useState } from "react";
import { api, fmt } from "../api";
import { Setting, Switch, toast } from "../components/Bits";
import { IconBoost, IconCheck, IconX } from "../components/Icons";
import { GameProfiles, TestsPanel } from "../components/Profiles";
import type { GameState, ProcInfo, Settings, ToolStatus } from "../../shared/types";

export function Boost({ settings, setSettings, game }: { settings: Settings; setSettings: (s: Settings) => void; game: GameState }) {
  const b = settings.boost;
  const [apps, setApps] = useState<ProcInfo[]>([]);
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [newGame, setNewGame] = useState("");
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    api.getRunningApps().then(setApps);
    api.getToolStatus().then(setTools);
  }, []);

  const patch = async (p: Partial<Settings["boost"]>) => setSettings(await api.saveSettings({ boost: { ...b, ...p } }));
  const inList = (n: string) => b.suspendList.some((x) => x.toLowerCase() === n.toLowerCase());
  const suggestions = apps.filter((a) => !inList(a.name)).slice(0, 12);

  const installPm = async () => {
    setInstalling(true);
    const r = await api.installTool("presentmon");
    setInstalling(false);
    toast(r.message);
    api.getToolStatus().then(setTools);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Game Boost</h1>
          <p className="sub">Turns on by itself when a game starts and puts everything back when you quit.</p>
        </div>
        <Switch checked={b.enabled} onChange={(v) => patch({ enabled: v })} label="Game Boost" />
      </div>

      <section className="panel boost-status">
        <div className={`boost-ring ${game.active && game.boosted ? "on" : ""}`}><IconBoost /></div>
        <div style={{ flex: 1 }}>
          <h2>{game.active ? (game.boosted ? `Boosting ${game.game}` : `${game.game} is running`) : b.enabled ? "Waiting for a game" : "Game Boost is off"}</h2>
          {game.active ? (
            <ul className="checklist">
              <li><span className="muted">Running for {fmt.dur(Date.now() - (game.since ?? Date.now()))}</span></li>
              {game.boosted && b.raisePriority && <li><IconCheck />High CPU priority</li>}
              {game.boosted && b.highPerformancePower && <li><IconCheck />High performance power</li>}
              {game.suspended.length > 0 && <li><IconCheck />Paused {game.suspended.join(", ")}</li>}
              {game.fpsCapture === "running" && <li><IconCheck />Recording FPS</li>}
            </ul>
          ) : (
            <p className="sub">Detects games from Steam, Epic, Xbox, Battle.net, EA, Ubisoft, Riot, GOG, Rockstar and Roblox, plus any you add below.</p>
          )}
        </div>
        <button className="btn" onClick={async () => api.manualBoost(!game.active)}>{game.active ? "End boost" : "Boost now"}</button>
      </section>

      <div className="grid-2">
        <section className="panel">
          <h2>While you play</h2>
          <div style={{ marginTop: 6 }}>
            <Setting title="Raise game priority" desc="Gives the game first claim on your CPU.">
              <Switch checked={b.raisePriority} onChange={(v) => patch({ raisePriority: v })} label="Raise game priority" />
            </Setting>
            <Setting title="High performance power plan" desc="Stops the CPU from clocking down mid-game. Your previous plan comes back after.">
              <Switch checked={b.highPerformancePower} onChange={(v) => patch({ highPerformancePower: v })} label="High performance power plan" />
            </Setting>
            <Setting title="Pause background apps" desc="Freezes the apps in your pause list, then resumes them when the game closes.">
              <Switch checked={b.pauseBackground} onChange={(v) => patch({ pauseBackground: v })} label="Pause background apps" />
            </Setting>
            <Setting title="In-game overlay" desc="FPS, 1% low, temps and load in a corner. Shows over borderless and windowed games.">
              <div className="row">
                <select className="input" style={{ width: 140 }} value={b.overlayCorner} onChange={(e) => patch({ overlayCorner: e.target.value as any })} aria-label="Overlay position">
                  <option value="top-left">Top left</option>
                  <option value="top-right">Top right</option>
                  <option value="bottom-left">Bottom left</option>
                  <option value="bottom-right">Bottom right</option>
                </select>
                <Switch checked={b.overlay} onChange={(v) => patch({ overlay: v })} label="In-game overlay" />
              </div>
            </Setting>
            <Setting title="Session reports" desc="Records FPS, frame times and stutters for every session.">
              <Switch checked={b.sessionReports} onChange={(v) => patch({ sessionReports: v })} label="Session reports" />
            </Setting>
            <Setting title="Explain each session with AI" desc={settings.hasApiKey ? "Rigmind writes up what caused any stutters when you quit." : "Add your Anthropic API key in Settings first."}>
              <Switch checked={b.autoAnalyze && settings.hasApiKey} onChange={(v) => patch({ autoAnalyze: v })} label="Explain each session with AI" />
            </Setting>
          </div>
        </section>

        <div className="stack" style={{ gap: 20 }}>
          <section className="panel">
            <div className="panel-head">
              <h2>Pause list</h2>
              <span className="muted small">{b.suspendList.length} apps</span>
            </div>
            <div className="row wrap">
              {b.suspendList.map((n) => (
                <span key={n} className="chip">
                  {n}
                  <button aria-label={`Remove ${n}`} onClick={() => patch({ suspendList: b.suspendList.filter((x) => x !== n) })}><IconX /></button>
                </span>
              ))}
              {!b.suspendList.length && <span className="muted">Nothing gets paused. Add apps from the list below.</span>}
            </div>
            <h3 style={{ margin: "18px 0 8px" }} className="muted">Running now, biggest first</h3>
            <div className="row wrap">
              {suggestions.map((a) => (
                <button key={a.pid} className="btn sm" onClick={() => patch({ suspendList: [...b.suspendList, a.name] })}>
                  + {a.name} <span className="muted">{a.memMB >= 1024 ? `${(a.memMB / 1024).toFixed(1)} GB` : `${a.memMB} MB`}</span>
                </button>
              ))}
            </div>
            <p className="muted small" style={{ marginBottom: 0 }}>Don't pause voice chat or anything the game needs. Windows and anti-cheat processes are protected and never paused.</p>
          </section>

          <section className="panel">
            <h2>Games Rigmind should detect</h2>
            <p className="sub small">Add a game's .exe name if it isn't picked up automatically.</p>
            <form className="row" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); const n = newGame.trim().replace(/\.exe$/i, ""); if (n) patch({ customGames: [...b.customGames, n] }); setNewGame(""); }}>
              <input className="input" placeholder="e.g. FactoryGame" value={newGame} onChange={(e) => setNewGame(e.target.value)} aria-label="Game exe name" />
              <button className="btn" type="submit">Add game</button>
            </form>
            <div className="row wrap" style={{ marginTop: 12 }}>
              {b.customGames.map((n) => (
                <span key={n} className="chip">{n}<button aria-label={`Remove ${n}`} onClick={() => patch({ customGames: b.customGames.filter((x) => x !== n) })}><IconX /></button></span>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="row between">
              <div>
                <h2>FPS capture</h2>
                <p className="sub small">Uses Intel PresentMon to read real frame times from any DirectX, Vulkan or OpenGL game.</p>
              </div>
              {tools?.presentMon ? <span className="tag good">Ready</span> : <button className="btn primary" disabled={installing} onClick={installPm}>{installing ? "Installing…" : "Install PresentMon"}</button>}
            </div>
          </section>
        </div>
      </div>
      <TestsPanel gameActive={game.active} />
      <GameProfiles globalPause={b.suspendList} />
    </div>
  );
}
