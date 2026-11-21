import { useEffect, useState } from "react";
import { api, fmt } from "../api";
import { toast } from "./Bits";
import type { BrowserGuardState } from "../../shared/types";

const LEVEL = { risky: { cls: "crit", text: "Risky" }, review: { cls: "warn", text: "Review" }, ok: { cls: "good", text: "OK" } } as const;

export function BrowserGuardPanel() {
  const [st, setSt] = useState<BrowserGuardState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showOk, setShowOk] = useState(false);
  useEffect(() => {
    api.browserState().then(setSt);
  }, []);
  if (!st) return null;
  const scan = async () => {
    setBusy("scan");
    try {
      setSt(await api.browserScan());
    } catch (e: any) {
      toast(e?.message ?? "Scan failed");
    }
    setBusy(null);
  };
  const act = async (label: string, fn: () => Promise<{ ok: boolean; message: string }>, after?: () => void) => {
    setBusy(label);
    const r = await fn().catch((e) => ({ ok: false, message: e?.message ?? String(e) }));
    toast(r.message);
    if (r.ok) after?.();
    setBusy(null);
  };
  const flagged = st.extensions.filter((e) => e.level !== "ok");
  const ok = st.extensions.filter((e) => e.level === "ok");
  const list = showOk ? st.extensions : flagged;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Browser Guard</h2>
          <p className="sub small">Checks every extension in Chrome, Edge, Brave and Firefox, plus settings malware likes to hijack. It reads extension files only, never your history, passwords or cookies.</p>
        </div>
        <button className="btn" disabled={!!busy} onClick={scan}>{busy === "scan" ? "Scanning…" : st.scannedAt ? "Scan again" : "Scan browsers"}</button>
      </div>
      {st.scannedAt && (
        <p className="muted small" style={{ marginTop: 0 }}>
          {st.extensions.length} extension{st.extensions.length === 1 ? "" : "s"} checked {fmt.ago(st.scannedAt)}: {flagged.filter((e) => e.level === "risky").length} risky, {flagged.filter((e) => e.level === "review").length} to review, {ok.length} OK.
          {st.managedPc && " This PC is managed by your company, so Rigmind reports problems but leaves fixes to IT."}
        </p>
      )}
      {st.hijacks.length > 0 && (
        <div className="notice" style={{ margin: "8px 0 12px" }}>
          {st.hijacks.map((h) => (
            <div key={h.id} className="row between" style={{ gap: 16, padding: "6px 0", alignItems: "flex-start" }}>
              <div><b>{h.title}</b><div className="small" style={{ wordBreak: "break-word" }}>{h.detail}</div></div>
              {h.fixable && <button className="btn sm" disabled={!!busy} onClick={() => act(h.id, () => api.browserFix(h.id), () => setSt((s) => s && { ...s, hijacks: s.hijacks.filter((x) => x.id !== h.id) }))}>Fix</button>}
            </div>
          ))}
        </div>
      )}
      {list.map((e) => (
        <div key={e.key} className="incident">
          <button className="incident-head" onClick={() => setOpen(open === e.key ? null : e.key)} aria-expanded={open === e.key}>
            <span className={`tag ${LEVEL[e.level].cls}`}>{LEVEL[e.level].text}</span>
            <span className="grow">
              <b>{e.name}</b> <span className="muted small">{e.browser}{e.profile !== "Default" && e.profile !== "Person 1" ? ` · ${e.profile}` : ""} · v{e.version}</span>
              {!e.enabled && <span className="muted small"> · turned off</span>}
              {e.blocked && <span className="tag neutral" style={{ marginLeft: 8 }}>Blocked</span>}
            </span>
            <span className="muted small">{e.reasons.length ? `${e.reasons.length} concern${e.reasons.length > 1 ? "s" : ""}` : ""}</span>
          </button>
          {open === e.key && (
            <div className="incident-body">
              {e.reasons.length ? (
                <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
                  {e.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">Nothing unusual.</p>
              )}
              {e.level === "review" && !e.knownBad && <p className="muted small">"Review" doesn't mean it's bad: many good extensions need broad access. Keep it if you know what it is and installed it on purpose.</p>}
              <div className="row">
                <button className="btn sm" onClick={() => act("open", () => api.browserOpen(e.key))}>Remove in {e.browser}</button>
                {!e.blocked && e.level !== "ok" && <button className="btn ghost sm" disabled={!!busy || st.managedPc} onClick={() => confirm(`Block ${e.name} in ${e.browser}? The browser will show "Managed by your organization" afterwards. You can undo this in Settings > Change history.`) && act("block", () => api.browserBlock(e.key), () => setSt((s) => s && { ...s, extensions: s.extensions.map((x) => (x.key === e.key ? { ...x, blocked: true } : x)) }))}>Block</button>}
              </div>
              <p className="muted small" style={{ marginTop: 6, wordBreak: "break-all" }}>ID {e.id}{e.permissions.length ? ` · Permissions: ${e.permissions.slice(0, 12).join(", ")}${e.permissions.length > 12 ? "…" : ""}` : ""}</p>
            </div>
          )}
        </div>
      ))}
      {st.scannedAt && !flagged.length && !showOk && <p className="muted">No risky extensions found.</p>}
      {ok.length > 0 && <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => setShowOk((v) => !v)}>{showOk ? "Hide OK extensions" : `Show all ${st.extensions.length} extensions`}</button>}
    </section>
  );
}
