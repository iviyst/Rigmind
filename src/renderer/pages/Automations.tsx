import { useEffect, useState } from "react";
import { api, fmt } from "../api";
import { Switch, Thinking, toast } from "../components/Bits";
import type { Rule, Settings } from "../../shared/types";

const EXAMPLES = [
  "When I start Valorant, close Chrome and set fans to performance",
  "Turn the lights off at 11pm",
  "If the GPU goes over 84 degrees, warn me",
  "When I've been away for 20 minutes, switch fans to quiet",
  "When Minecraft starts, make the lights green",
];

function describeTrigger(r: Rule) {
  const t = r.trigger;
  const base =
    t.type === "game_start" ? `When ${t.game || "any game"} starts`
    : t.type === "game_end" ? `When ${t.game || "a game"} closes`
    : t.type === "temp_above" ? `When the ${t.source.toUpperCase()} passes ${t.value}°C`
    : t.type === "time" ? `Every day at ${t.at}`
    : t.type === "idle" ? `After ${t.minutes} minutes away`
    : `When ${t.app} opens`;
  return base + (r.between ? `, between ${r.between.from} and ${r.between.to}` : "");
}

export function Automations({ settings }: { settings: Settings }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.listRules().then(setRules);
  }, []);

  const add = async (t: string) => {
    if (!t.trim()) return;
    setBusy(true);
    try {
      setRules(await api.addRule(t));
      setText("");
      toast("Automation added");
    } catch (e: any) {
      toast(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    }
    setBusy(false);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Automations</h1>
          <p className="sub">Tell Rigmind what to do and when, in plain English. Each rule is turned into a fixed set of safe steps you can check before it runs.</p>
        </div>
      </div>
      <section className="panel">
        <form className="row" onSubmit={(e) => { e.preventDefault(); void add(text); }}>
          <input className="input" placeholder="When… then…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Describe an automation" />
          <button className="btn primary" type="submit" disabled={!settings.aiReady || busy || !text.trim()}>{busy ? "Creating…" : "Create"}</button>
        </form>
        {busy && <div style={{ marginTop: 10 }}><Thinking /></div>}
        <div className="prompts" style={{ marginTop: 12 }}>
          {EXAMPLES.map((x) => <button key={x} onClick={() => setText(x)}>{x}</button>)}
        </div>
        {!settings.aiReady && <p className="muted small" style={{ marginBottom: 0 }}>Set up an AI engine in Settings to create automations.</p>}
      </section>

      <section className="panel">
        <h2>Your automations</h2>
        {!rules.length && <p className="muted" style={{ margin: 0 }}>None yet. Try one of the examples above.</p>}
        {rules.map((r) => (
          <div key={r.id} className="setting" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <h3>{r.summary}</h3>
              <p>{describeTrigger(r)}: {r.actions.map((a) => (a.type === "notify" ? `notify "${a.value}"` : `${a.type.replace("_", " ")} ${a.value}`)).join(", ")}</p>
              <p className="muted small">You wrote: "{r.text}"{r.lastRun ? `. Last ran ${fmt.ago(r.lastRun)}.` : ""}</p>
            </div>
            <div className="row">
              <button className="btn ghost sm" onClick={async () => setRules(await api.deleteRule(r.id))}>Delete</button>
              <Switch checked={r.enabled} onChange={async (v) => setRules(await api.toggleRule(r.id, v))} label={`Turn ${r.summary} on or off`} />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
