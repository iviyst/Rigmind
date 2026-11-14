import { useEffect, useState } from "react";
import { api, fmt } from "../api";
import { Setting, Switch, toast } from "./Bits";
import type { ChangeEntry, ExtrasSettings, LocalAiStatus, RigNote, Settings } from "../../shared/types";

/** Choose between Claude and Rigmind Local AI. */
export function AiEngine({ settings, setSettings }: { settings: Settings; setSettings: (s: Settings) => void }) {
  const [st, setSt] = useState<LocalAiStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState("");
  useEffect(() => {
    api.localAiStatus().then((s) => {
      setSt(s);
      setModel(settings.localModel || s.recommended);
    });
    return api.onLocalAi(setSt);
  }, []);
  const pick = async (p: "claude" | "local") => setSettings(await api.saveSettings({ aiProvider: p } as any));
  const setup = async () => {
    setBusy(true);
    const r = await api.localAiSetup(model);
    toast(r.message);
    setSettings(await api.getSettings());
    setBusy(false);
  };
  return (
    <section className="panel">
      <h2>AI engine</h2>
      <div className="seg" role="radiogroup" style={{ margin: "12px 0 6px" }}>
        <button role="radio" aria-checked={settings.aiProvider === "claude"} className={settings.aiProvider === "claude" ? "on" : ""} onClick={() => pick("claude")}>Claude (API key)</button>
        <button role="radio" aria-checked={settings.aiProvider === "local"} className={settings.aiProvider === "local" ? "on" : ""} onClick={() => pick("local")}>Rigmind Local AI (free)</button>
      </div>
      {settings.aiProvider === "local" ? (
        <div className="stack" style={{ marginTop: 8 }}>
          <p className="sub small" style={{ margin: 0 }}>Runs entirely on this PC through Ollama. Free, private and works offline. It's less capable than Claude, and it's unloaded from your GPU whenever a game starts so it never costs FPS.</p>
          {st?.pulling ? (
            <div className="stack" style={{ gap: 6 }}>
              <div className="row between small"><span>{st.pulling.status} {st.pulling.model}</span><span className="muted">{Math.round(st.pulling.pct * 100)}%</span></div>
              <div className="progress"><i style={{ width: `${st.pulling.pct * 100}%` }} /></div>
            </div>
          ) : settings.localModel && st?.models.includes(settings.localModel) ? (
            <div className="row between"><span className="tag good">Ready: {settings.localModel}</span><span className="muted small">{st.running ? "Running" : "Starts when needed"}</span></div>
          ) : (
            <div className="row wrap">
              <select className="input" style={{ width: 240 }} value={model} onChange={(e) => setModel(e.target.value)} aria-label="Local model">
                <option value="qwen3:8b">Qwen3 8B: best answers (≈5 GB, 12 GB+ VRAM)</option>
                <option value="qwen3:4b">Qwen3 4B: balanced (≈2.5 GB, 6 GB+ VRAM)</option>
                <option value="qwen3:1.7b">Qwen3 1.7B: lightest (≈1.4 GB)</option>
              </select>
              <button className="btn primary" disabled={busy} onClick={setup}>{busy ? "Setting up…" : st?.installed ? "Download model" : "Install and set up"}</button>
              {st?.vramGB != null && <span className="muted small">Your GPU has {st.vramGB} GB, so {st.recommended} is recommended.</span>}
            </div>
          )}
          <p className="muted small" style={{ margin: 0 }}>Features that need the web, like the latest-BIOS lookup, still need Claude.</p>
        </div>
      ) : null}
    </section>
  );
}

export function SmartSettings() {
  const [ex, setEx] = useState<ExtrasSettings | null>(null);
  const [pair, setPair] = useState<{ url: string | null; qr: string | null } | null>(null);
  useEffect(() => {
    api.getExtras().then(setEx);
  }, []);
  useEffect(() => {
    if (ex?.remote.enabled) api.remotePairing().then(setPair);
  }, [ex?.remote.enabled]);
  if (!ex) return null;
  const save = async (p: Partial<ExtrasSettings>) => setEx(await api.saveExtras(p));
  const hotkeyLabel = ex.voice.hotkey.replace("CommandOrControl", "Ctrl").replace(/\+/g, " + ");
  return (
    <>
      <section className="panel">
        <h2>Smart PC</h2>
        <Setting title="Daily checkup" desc={`Every day after ${ex.checkup.hour}:00, Rigmind reviews crashes, temps, security, drivers and your games, then tells you what needs attention.`}>
          <div className="row">
            <select className="input" style={{ width: 100 }} value={ex.checkup.hour} onChange={(e) => save({ checkup: { ...ex.checkup, hour: Number(e.target.value) } })} aria-label="Checkup time">
              {[7, 8, 9, 10, 12, 15, 18, 21].map((h) => <option key={h} value={h}>{h}:00</option>)}
            </select>
            <Switch checked={ex.checkup.enabled} onChange={(v) => save({ checkup: { ...ex.checkup, enabled: v } })} label="Daily checkup" />
          </div>
        </Setting>
        <Setting title="Unusual session alerts" desc="Tells you when a game runs noticeably slower or hotter than it usually does on your PC.">
          <Switch checked={ex.anomalyAlerts} onChange={(v) => save({ anomalyAlerts: v })} label="Unusual session alerts" />
        </Setting>
        <Setting title="Autopilot" desc="Lets Rigmind apply low-risk fixes by itself, such as pausing an app that keeps causing stutters or fixing a monitor stuck at 60 Hz. Every change is logged below with an undo button.">
          <Switch checked={ex.autopilot} onChange={(v) => save({ autopilot: v })} label="Autopilot" />
        </Setting>
      </section>

      <section className="panel">
        <h2>Voice copilot</h2>
        <Setting title={`Press ${hotkeyLabel} and ask`} desc={'Ask "why did it just stutter?" or "what\'s my GPU temp?" mid-game. Speech is recognized offline by Windows; only the text goes to the AI.'}>
          <Switch checked={ex.voice.enabled} onChange={(v) => save({ voice: { ...ex.voice, enabled: v } })} label="Voice copilot" />
        </Setting>
        <Setting title="Read answers aloud">
          <Switch checked={ex.voice.speak} onChange={(v) => save({ voice: { ...ex.voice, speak: v } })} label="Read answers aloud" />
        </Setting>
        <Setting title="Hotkey" desc="Uses Electron's format, e.g. CommandOrControl+Shift+Space or Alt+F10.">
          <input className="input" style={{ width: 230 }} defaultValue={ex.voice.hotkey} onBlur={(e) => e.target.value.trim() && save({ voice: { ...ex.voice, hotkey: e.target.value.trim() } })} aria-label="Voice hotkey" />
        </Setting>
        <button className="btn sm" disabled={!ex.voice.enabled} onClick={() => api.voiceAsk()}>Try it now</button>
      </section>

      <section className="panel">
        <h2>Phone remote</h2>
        <Setting title="Check on your PC from your phone" desc="Live temps, FPS and ping on your home network. Off the network, nothing can reach it. The link contains a secret, so only share it with your own devices.">
          <Switch checked={ex.remote.enabled} onChange={(v) => save({ remote: { ...ex.remote, enabled: v } })} label="Phone remote" />
        </Setting>
        {ex.remote.enabled && (
          <>
            <Setting title="Allow control" desc="Change fan and lighting profiles from your phone.">
              <Switch checked={ex.remote.allowControl} onChange={(v) => save({ remote: { ...ex.remote, allowControl: v } })} label="Allow control from phone" />
            </Setting>
            <div className="row" style={{ alignItems: "flex-start", gap: 20, paddingTop: 10 }}>
              {pair?.qr ? <img className="qr" src={pair.qr} alt="QR code to open the Rigmind phone remote" /> : null}
              <div className="stack" style={{ gap: 8 }}>
                <p className="small" style={{ margin: 0 }}>Scan with your phone's camera while it's on the same Wi-Fi.{!pair?.qr && pair?.url ? ` Or open ${pair.url}` : ""}</p>
                {!pair?.url && <p className="muted small" style={{ margin: 0 }}>No home network address found.</p>}
                <button className="btn sm" onClick={async () => { setPair(await api.remoteReset()); toast("New link created. Old links stop working."); }}>Reset link</button>
                <p className="muted small" style={{ margin: 0 }}>The first time, Windows may ask whether to allow Rigmind on private networks. Allow it for private networks only.</p>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Discord status</h2>
        <Setting title="Show your game and FPS on Discord" desc={<>Needs a free Application ID: create an app at discord.com/developers, name it "Rigmind", and paste its ID here.</>}>
          <div className="row">
            <input className="input" style={{ width: 200 }} placeholder="Application ID" defaultValue={ex.discord.appId} onBlur={(e) => save({ discord: { ...ex.discord, appId: e.target.value.trim() } })} aria-label="Discord Application ID" />
            <Switch checked={ex.discord.enabled} onChange={(v) => save({ discord: { ...ex.discord, enabled: v } })} label="Discord status" />
          </div>
        </Setting>
      </section>

      <section className="panel">
        <h2>Security watch</h2>
        <Setting title="Watch for changes" desc="Checks every 5 minutes for new apps accepting connections, new services, startup tasks, admin accounts and failed sign-ins.">
          <Switch checked={ex.security.watch} onChange={(v) => save({ security: { ...ex.security, watch: v } })} label="Security watch" />
        </Setting>
        <Setting title="Alert on new devices on your network">
          <Switch checked={ex.security.alertNewDevices} onChange={(v) => save({ security: { ...ex.security, alertNewDevices: v } })} label="Alert on new devices" />
        </Setting>
        <Setting title="Alert when an app starts accepting connections">
          <Switch checked={ex.security.alertNewListeners} onChange={(v) => save({ security: { ...ex.security, alertNewListeners: v } })} label="Alert on new listening apps" />
        </Setting>
      </section>
    </>
  );
}

export function NotesAndHistory() {
  const [notes, setNotes] = useState<RigNote[]>([]);
  const [changes, setChanges] = useState<ChangeEntry[]>([]);
  const [text, setText] = useState("");
  useEffect(() => {
    api.listNotes().then(setNotes);
    api.listChanges().then(setChanges);
    return api.onChanges(setChanges);
  }, []);
  const SRC: Record<ChangeEntry["source"], string> = { you: "You", assistant: "Assistant", autopilot: "Autopilot", automation: "Automation" };
  return (
    <>
      <section className="panel">
        <h2>Rig notes</h2>
        <p className="sub small">Things the AI remembers about your PC between chats, like "PSU is 750 W" or "XMP turned on in November". Stored only on this PC.</p>
        <form className="row" style={{ margin: "10px 0" }} onSubmit={async (e) => { e.preventDefault(); if (text.trim()) setNotes(await api.addNote(text)); setText(""); }}>
          <input className="input" placeholder="Add a note about your PC" value={text} onChange={(e) => setText(e.target.value)} aria-label="New rig note" />
          <button className="btn" type="submit">Add</button>
        </form>
        {notes.map((n) => (
          <div key={n.id} className="row between small" style={{ padding: "6px 0", borderTop: "1px solid var(--line-soft)" }}>
            <span>{n.text} <span className="muted">{fmt.ago(n.t)}</span></span>
            <button className="btn ghost sm" onClick={async () => setNotes(await api.deleteNote(n.id))}>Delete</button>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Change history</h2>
        <p className="sub small">Every lasting change Rigmind has made to your PC, and who made it.</p>
        {!changes.length && <p className="muted" style={{ margin: 0 }}>Nothing yet.</p>}
        {changes.slice(0, 40).map((c) => (
          <div key={c.id} className="row between small" style={{ padding: "8px 0", borderTop: "1px solid var(--line-soft)" }}>
            <span style={c.undone ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>{c.label} <span className="muted">{SRC[c.source]}, {fmt.ago(c.t)}</span></span>
            {c.undoable && !c.undone && <button className="btn sm" onClick={async () => { const r = await api.undoChange(c.id); toast(r.message); setChanges(await api.listChanges()); }}>Undo</button>}
            {c.undone && <span className="muted">Undone</span>}
          </div>
        ))}
      </section>
    </>
  );
}
