import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Markdown, Thinking } from "../components/Bits";
import { BrandMark, IconCheck } from "../components/Icons";
import { TESTABLE } from "../../shared/types";
import type { ChatMessage, GameState, ProposedAction, Settings } from "../../shared/types";

const STARTERS = [
  "Why does my game stutter?",
  "Why did my PC crash?",
  "Is anything on my network suspicious?",
  "Am I CPU or GPU bottlenecked?",
  "Is my RAM running at its rated speed?",
  "Are my temperatures OK?",
  "What should I upgrade first?",
];

export function Assistant({ settings, game, messages, setMessages, draft, setDraft, goSettings }: { settings: Settings; game: GameState; messages: ChatMessage[]; setMessages: (m: ChatMessage[]) => void; draft: string; setDraft: (s: string) => void; goSettings: () => void }) {
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);
  useEffect(() => {
    if (draft) input.current?.focus();
  }, [draft]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next = [...messages, { role: "user" as const, content: q }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    try {
      const reply = await api.aiChat(next);
      setMessages([...next, reply]);
    } catch (e: any) {
      setMessages([...next, { role: "assistant", content: `Couldn't reach Claude: ${e?.message ?? e}` }]);
    } finally {
      setBusy(false);
    }
  };

  const apply = async (mi: number, a: ProposedAction) => {
    const update = (patch: Partial<ProposedAction>) =>
      setMessages(messages.map((m, i) => (i === mi ? { ...m, actions: m.actions?.map((x) => (x.id === a.id ? { ...x, ...patch } : x)) } : m)));
    const r = await api.executeAction(a);
    update({ state: r.ok ? "done" : "failed", result: r.message });
  };

  const test = async (mi: number, a: ProposedAction) => {
    const kind = TESTABLE[a.kind];
    if (!kind) return;
    const r = await api.startTest(kind, a.target, a.label);
    setMessages(messages.map((m, i) => (i === mi ? { ...m, actions: m.actions?.map((x) => (x.id === a.id ? { ...x, state: r.ok ? "testing" : x.state, result: r.message } : x)) } : m)));
  };

  if (!settings.aiReady)
    return (
      <div className="page">
        <h1>Assistant</h1>
        <section className="panel empty">
          <h2>Choose an AI engine to get started</h2>
          <p>The assistant reads your live stats, sessions and drivers, then explains what's wrong and offers one-click fixes. Use Claude with your own API key, or set up the free Rigmind Local AI that runs on this PC.</p>
          <button className="btn primary" onClick={goSettings}>Set up AI</button>
        </section>
      </div>
    );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Assistant</h1>
          <p className="sub">Ask about performance, crashes, security or your games. Rigmind checks your real numbers before answering, and nothing changes until you click Apply.{settings.aiProvider === "local" ? " Running on Rigmind Local AI." : ""}</p>
        </div>
        {messages.length > 0 && <button className="btn ghost" onClick={() => setMessages([])}>New chat</button>}
      </div>
      <section className="panel chat">
        <div className="chat-log" ref={log} aria-live="polite">
          {!messages.length && (
            <div className="stack" style={{ margin: "auto 0", alignItems: "flex-start" }}>
              <h2>What's going on with your PC?</h2>
              <div className="prompts">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="msg user">{m.content}</div>
            ) : (
              <div key={i} className="msg assistant">
                <div className="who"><BrandMark />Rigmind</div>
                <Markdown text={m.content} />
                {m.actions?.map((a) => (
                  <div key={a.id} className="action-card">
                    <div>
                      <h3>{a.label}</h3>
                      <div className="why">{a.state === "pending" || !a.state ? a.reason : a.result}</div>
                    </div>
                    {a.state === "done" ? (
                      <span className="tag good"><IconCheck />Applied</span>
                    ) : a.state === "failed" ? (
                      <span className="tag crit">Didn't work</span>
                    ) : a.state === "testing" ? (
                      <span className="tag neutral">Testing on the Game Boost page</span>
                    ) : (
                      <div className="row">
                        {a.testable && game.active && <button className="btn sm" onClick={() => test(i, a)}>Apply and test</button>}
                        <button className="btn primary sm" onClick={() => apply(i, a)}>Apply</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
          {busy && (
            <div className="msg assistant">
              <div className="who"><BrandMark />Checking your PC…</div>
              <Thinking />
            </div>
          )}
        </div>
        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
          <textarea
            ref={input}
            className="input"
            rows={1}
            placeholder="Ask about FPS, stutters, temps, drivers…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            aria-label="Message"
          />
          <button className="btn primary" type="submit" disabled={busy || !draft.trim()}>Send</button>
        </form>
      </section>
    </div>
  );
}
