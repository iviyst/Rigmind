import { useEffect, useState } from "react";
import { api } from "../api";
import { Thinking, toast } from "../components/Bits";
import type { PrinterInfo } from "../../shared/types";

export function Printers() {
  const [list, setList] = useState<PrinterInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = async (refresh: boolean) => {
    setBusy("scan");
    try {
      setList(await api.printers(refresh));
    } catch (e: any) {
      toast(e?.message ?? "Couldn't look for printers");
    }
    setBusy(null);
  };
  useEffect(() => {
    void load(false);
  }, []);
  const run = async (key: string, fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(key);
    try {
      const r = await fn();
      toast(r.message);
      if (r.ok) setList(await api.printers(true));
    } catch (e: any) {
      toast(e?.message ?? "Something went wrong");
    }
    setBusy(null);
  };
  const added = list?.filter((p) => p.installed) ?? [];
  const found = list?.filter((p) => !p.installed) ?? [];

  const row = (p: PrinterInfo) => (
    <div key={p.key} className="printer">
      <div>
        <b>{p.name}</b> {p.isDefault && <span className="tag good" style={{ marginLeft: 6 }}>Default</span>}
        {p.installed && <span className={`tag ${p.status === "Ready" ? "good" : "warn"}`} style={{ marginLeft: 10 }}>{p.status}</span>}
        <div className="meta">
          {[p.location, p.model, p.color == null ? null : p.color ? "Color" : "Black and white", p.host].filter(Boolean).join(" · ")}
        </div>
        {p.problem && <div className="small" style={{ color: "var(--warn)", marginTop: 2 }}>{p.problem}</div>}
        {p.managedByIt && <div className="muted small">Set up by your company's IT.</div>}
      </div>
      <div className="row" style={{ justifyContent: "flex-end", alignSelf: "center" }}>
        {!p.installed && <button className="btn primary sm" disabled={!!busy} onClick={() => run(p.key, () => api.printerAdd(p.key))}>{busy === p.key ? "Adding…" : "Add"}</button>}
        {p.installed && <button className="btn sm" disabled={!!busy} onClick={() => run(p.key, () => api.printerIdentify(p.key))}>Identify</button>}
        {p.installed && p.problem?.includes("moved") && <button className="btn sm" disabled={!!busy} onClick={() => run(p.key, () => api.printerFix(p.key, "port"))}>Fix address</button>}
        {p.installed && p.jobs > 0 && <button className="btn sm" disabled={!!busy} onClick={() => run(p.key, () => api.printerFix(p.key, "queue"))}>Clear stuck jobs</button>}
        {p.installed && !p.isDefault && <button className="btn ghost sm" disabled={!!busy} onClick={() => run(p.key, () => api.printerFix(p.key, "default"))}>Make default</button>}
        {p.adminUrl && <button className="btn ghost sm" onClick={() => api.openExternal(p.adminUrl!)}>Ink and paper</button>}
        {p.installed && !p.managedByIt && <button className="btn ghost sm" disabled={!!busy} onClick={() => confirm(`Remove ${p.name} from this PC?`) && run(p.key, () => api.printerFix(p.key, "remove"))}>Remove</button>}
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Printers</h1>
          <p className="sub">Every printer on your network, where it is, and whether it's working. Add one in a click, no driver download needed for most printers.</p>
        </div>
        <button className="btn" disabled={!!busy} onClick={() => load(true)}>{busy === "scan" ? "Looking…" : "Look again"}</button>
      </div>
      {!list && <p className="progress-line"><Thinking /> Looking for printers on your network…</p>}
      {list && (
        <>
          <section className="panel">
            <h2>On this PC</h2>
            {added.length ? added.map(row) : <p className="muted">No printers added yet.</p>}
          </section>
          <section className="panel">
            <h2>Found on your network</h2>
            <p className="sub small">Not sure which one is next to you? Add it, then press Identify: it prints a page with its name in huge letters.</p>
            {found.length ? found.map(row) : <p className="muted">No other printers answered. Printers that are asleep or on a different network won't show up.</p>}
          </section>
        </>
      )}
    </div>
  );
}
