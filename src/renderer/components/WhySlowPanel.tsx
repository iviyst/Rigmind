import { useState } from "react";
import { api } from "../api";
import { Thinking, toast } from "./Bits";
import type { WhySlow } from "../../shared/types";

/** "Why is it slow?": a 10-second snapshot that names the cause in plain words. */
export function WhySlowPanel({ go }: { go: (page: string) => void }) {
  const [r, setR] = useState<WhySlow | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      setR(await api.whySlow());
    } catch (e: any) {
      toast(e?.message ?? "Couldn't check");
    }
    setBusy(false);
  };
  const fix = async (action: string, target?: string) => {
    if (action === "open-space" || action === "open-memory") return go("space");
    if (action === "open-dev") return go("tune");
    if (action === "browser-memory") {
      toast("Open your browser's Settings > Performance and turn on Memory Saver.");
      return;
    }
    const res = await api.whySlowFix(action, target);
    toast(res.message);
    if (res.ok) setR((x) => x && { ...x, causes: x.causes.filter((c) => c.fix?.action !== action) });
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Why is it slow?</h2>
          <p className="sub small">Takes a quick snapshot and names the cause, with a fix where there is one.</p>
        </div>
        <button className="btn" disabled={busy} onClick={check}>{busy ? "Checking…" : r ? "Check again" : "Check now"}</button>
      </div>
      {busy && <Thinking />}
      {r && !busy && (
        <>
          <h3 style={{ marginTop: 4 }}>{r.verdict}</h3>
          {r.causes.map((c) => (
            <div key={c.title} className="row between" style={{ padding: "9px 0", borderTop: "1px solid var(--line-soft)", alignItems: "flex-start", gap: 16 }}>
              <div>
                <b>{c.title}</b>
                <div className="muted small">{c.detail}</div>
              </div>
              {c.fix && <button className="btn sm" onClick={() => fix(c.fix!.action, c.fix!.target)}>{c.fix.label}</button>}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
