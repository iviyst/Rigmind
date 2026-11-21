import { useEffect, useState } from "react";
import { api, fmt } from "../api";
import { toast } from "./Bits";
import type { FileFinding, ThreatScanState } from "../../shared/types";

const STATUS: Record<FileFinding["status"], { cls: string; text: string }> = {
  found: { cls: "crit", text: "Found" },
  handed_off: { cls: "warn", text: "With your antivirus" },
  removed_by_av: { cls: "good", text: "Removed by your antivirus" },
  av_says_clean: { cls: "warn", text: "Antivirus didn't act" },
  held: { cls: "neutral", text: "Held, can't run" },
  ignored: { cls: "neutral", text: "Ignored" },
  restored: { cls: "neutral", text: "Restored" },
};

export function ThreatsPanel() {
  const [st, setSt] = useState<ThreatScanState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    api.threatState().then(setSt);
    return api.onThreats(setSt);
  }, []);
  if (!st) return null;
  const run = async (label: string, fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(label);
    const r = await fn().catch((e) => ({ ok: false, message: e?.message ?? String(e) }));
    toast(r.message);
    setSt(await api.threatState());
    setBusy(null);
  };
  const av = st.products.find((p) => p.enabled);
  const i = st.intel;
  const open = st.findings.filter((f) => f.status !== "ignored" && f.status !== "removed_by_av");

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Second opinion with open threat lists</h2>
          <p className="sub small">Rigmind checks your downloads, desktop, temp folders and startup programs against open malware lists, then hands anything suspicious to {av ? av.name : "your antivirus"} to deal with. Rigmind never quarantines files itself.</p>
        </div>
        <button className="btn" disabled={!!busy || st.scanning} onClick={() => run("scan", api.threatScan)}>{st.scanning || busy === "scan" ? "Checking…" : "Check files"}</button>
      </div>
      <div className="kv">
        <span className="k">Your antivirus</span>
        <span>{st.products.length ? st.products.map((p) => `${p.name} (${p.enabled ? (p.upToDate ? "on, up to date" : "on, out of date") : "off"})`).join(", ") : "None registered with Windows"}</span>
        <span className="k">Threat list</span>
        <span>
          {i.builtAt ? `${i.counts.hashes.toLocaleString()} malware files, ${i.counts.domains.toLocaleString()} malware sites, ${i.counts.extensions} bad extensions · updated ${fmt.ago(i.builtAt)}` : "Not downloaded yet"}
          {i.stale && i.builtAt && <span className="tag warn" style={{ marginLeft: 8 }}>Over 48 hours old</span>}
          {i.error && <div className="muted small">{i.error}</div>}
        </span>
        <span className="k">ClamAV</span>
        <span>{i.clam.installed ? `Installed${i.clam.dbUpdated ? `, signatures from ${fmt.ago(i.clam.dbUpdated)}` : ""}` : <>Not installed. <button className="btn ghost sm" style={{ padding: 0 }} onClick={() => api.openExternal("https://www.clamav.net/downloads")}>Get ClamAV</button> for a full open-source second scan.</>}</span>
        {st.lastScan && (<><span className="k">Last check</span><span>{fmt.ago(st.lastScan)}, {st.scanned.toLocaleString()} files</span></>)}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn ghost sm" disabled={!!busy} onClick={() => run("upd", api.intelUpdate)}>Update threat list</button>
      </div>
      {open.length > 0 && (
        <table className="list" style={{ marginTop: 12 }}>
          <thead><tr><th>File</th><th>Why</th><th>Status</th><th /></tr></thead>
          <tbody>
            {open.map((f) => (
              <tr key={f.id}>
                <td style={{ wordBreak: "break-all" }}><b>{f.path.split("\\").pop()}</b><div className="muted small">{f.path}</div></td>
                <td className="small">{f.threat}<div className="muted">{f.source}</div></td>
                <td><span className={`tag ${STATUS[f.status].cls}`}>{STATUS[f.status].text}</span></td>
                <td className="num">
                  <div className="row" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
                    {(f.status === "found" || f.status === "restored") && <button className="btn primary sm" disabled={!!busy} onClick={() => run(f.id, () => api.threatAct(f.id, "hand_off"))}>{busy === f.id ? "Scanning…" : `Send to ${av?.name ?? "antivirus"}`}</button>}
                    {f.status === "av_says_clean" && (
                      <>
                        <button className="btn sm" onClick={() => run(f.id, () => api.threatAct(f.id, "report"))}>Report it</button>
                        <button className="btn sm" onClick={() => confirm("Move this file somewhere it can't run? You can restore it from here.") && run(f.id, () => api.threatAct(f.id, "hold"))}>Hold it</button>
                      </>
                    )}
                    {f.status === "held" && <button className="btn ghost sm" onClick={() => run(f.id, () => api.threatAct(f.id, "restore"))}>Restore</button>}
                    {f.status !== "held" && <button className="btn ghost sm" onClick={() => run(f.id, () => api.threatAct(f.id, "ignore"))}>Ignore</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {st.lastScan && !open.length && <p className="muted" style={{ marginTop: 10 }}>Nothing suspicious.</p>}
    </section>
  );
}
