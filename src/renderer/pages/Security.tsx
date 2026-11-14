import { useEffect, useState } from "react";
import { api, fmt } from "../api";
import { Markdown, Thinking, toast } from "../components/Bits";
import { IconShield } from "../components/Icons";
import type { SecurityState, Settings } from "../../shared/types";

export function Security({ settings }: { settings: Settings }) {
  const [st, setSt] = useState<SecurityState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [triaging, setTriaging] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    api.securityState().then(setSt);
    return api.onSecurity(setSt);
  }, []);
  if (!st) return null;

  const run = async (label: string, fn: () => Promise<{ ok: boolean; message: string } | SecurityState>) => {
    setBusy(label);
    try {
      const r = await fn();
      if ("message" in r) toast(r.message);
      else setSt(r);
    } catch (e: any) {
      toast(e?.message ?? "Something went wrong");
    }
    setBusy(null);
  };
  const d = st.defender;
  const active = st.threats.filter((t) => /Active|Detected|failed/i.test(t.status));
  const alerts = st.alerts.filter((a) => !a.dismissed);
  const issues = st.exposure.filter((e) => !e.ok).length;
  const protectedOk = !!d?.available && d.realTime && !active.length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Security</h1>
          <p className="sub">Microsoft Defender's protection plus a watch on your network, sign-ins and anything new that starts with Windows.</p>
        </div>
        <button className="btn" disabled={!!busy} onClick={() => run("check", () => api.securityCheck())}>{busy === "check" ? "Checking…" : "Check now"}</button>
      </div>

      <section className="panel boost-status">
        <div className={`boost-ring ${protectedOk ? "on" : ""}`} style={!protectedOk ? { borderColor: "var(--crit)" } : undefined}><IconShield /></div>
        <div style={{ flex: 1 }}>
          <h2>{!d?.available ? (d?.thirdPartyAv ? `Protected by ${d.thirdPartyAv}` : "Microsoft Defender isn't available") : active.length ? `${active.length} threat${active.length > 1 ? "s" : ""} need attention` : d.realTime ? "You're protected" : "Real-time protection is off"}</h2>
          <ul className="checklist">
            {d?.available && <li>Definitions {d.signatureAgeDays === 0 ? "up to date" : `${d.signatureAgeDays} days old`}</li>}
            {d?.lastQuickScan && <li>Quick scan {fmt.ago(new Date(d.lastQuickScan).getTime())}</li>}
            {d?.tamperProtection != null && <li>Tamper protection {d.tamperProtection ? "on" : "off"}</li>}
            <li>{issues ? `${issues} exposure issue${issues > 1 ? "s" : ""}` : "No exposure issues"}</li>
            {st.lastCheck && <li className="muted">Checked {fmt.ago(st.lastCheck)}</li>}
          </ul>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <button className="btn primary" disabled={!!busy || d?.scanning} onClick={() => run("quick", () => api.defenderScan("QuickScan"))}>{busy === "quick" || d?.scanning ? "Scanning…" : "Quick scan"}</button>
          <div className="row">
            <button className="btn sm" disabled={!!busy} onClick={() => run("full", () => api.defenderScan("FullScan"))}>Full scan</button>
            <button className="btn sm" disabled={!!busy} onClick={() => run("upd", () => api.defenderUpdate())}>Update</button>
          </div>
        </div>
      </section>

      {alerts.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>Alerts</h2><span className="muted small">{alerts.length} open</span></div>
          {alerts.slice(0, 10).map((a) => (
            <div key={a.id} className="incident">
              <div className="incident-head" style={{ cursor: "default" }}>
                <span className={`tag ${a.severity === "high" ? "crit" : a.severity === "warn" ? "warn" : "neutral"}`}>{a.severity === "high" ? "Important" : a.severity === "warn" ? "Check" : "Info"}</span>
                <span className="grow">{a.title}<div className="muted small" style={{ whiteSpace: "pre-wrap" }}>{a.detail}</div></span>
                <span className="muted small">{fmt.ago(a.t)}</span>
              </div>
              <div className="incident-body">
                {a.triage ? <Markdown text={a.triage} /> : triaging === a.id ? <Thinking /> : null}
                <div className="row" style={{ marginTop: 6 }}>
                  {!a.triage && <button className="btn sm" disabled={!settings.aiReady || triaging === a.id} onClick={async () => { setTriaging(a.id); try { const t = await api.triageAlert(a.id); setSt((s) => s && { ...s, alerts: s.alerts.map((x) => (x.id === a.id ? { ...x, triage: t } : x)) }); } catch (e: any) { toast(e?.message ?? "Couldn't check that"); } setTriaging(null); }}>Is this a problem?</button>}
                  <button className="btn ghost sm" onClick={async () => { await api.dismissAlert(a.id); setSt((s) => s && { ...s, alerts: s.alerts.map((x) => (x.id === a.id ? { ...x, dismissed: true } : x)) }); }}>Dismiss</button>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {st.threats.length > 0 && (
        <section className="panel">
          <h2>Threats Defender found</h2>
          <table className="list" style={{ marginTop: 10 }}>
            <thead><tr><th>Threat</th><th>Severity</th><th>Status</th><th /></tr></thead>
            <tbody>
              {st.threats.map((t) => (
                <tr key={t.id}>
                  <td><b>{t.name}</b><div className="muted small" style={{ wordBreak: "break-all" }}>{t.resources[0]?.replace(/^\w+:_/, "")}</div></td>
                  <td>{t.severity}</td>
                  <td>{t.status}</td>
                  <td className="num">
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      {/Active|Detected|failed/i.test(t.status) && <button className="btn primary sm" onClick={() => run("rm", () => api.threatAction(t.id, "remove"))}>Remove</button>}
                      {t.status === "Quarantined" && <button className="btn ghost sm" onClick={() => confirm(`Restore ${t.name} from quarantine? Only do this if you're sure it's a false alarm.`) && run("rs", () => api.threatAction(t.id, "restore"))}>Restore</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="grid-2">
        <section className="panel">
          <h2>Exposure check</h2>
          {st.exposure.map((e) => (
            <div key={e.item} className="row between" style={{ padding: "8px 0", borderTop: "1px solid var(--line-soft)", alignItems: "flex-start" }}>
              <div><h3>{e.item}</h3><div className="muted small">{e.detail}</div></div>
              <span className={`tag ${e.ok ? "good" : "warn"}`}>{e.ok ? "OK" : "Fix"}</span>
            </div>
          ))}
          {!st.exposure.length && <p className="muted">Run a check to see your exposure.</p>}
        </section>
        <section className="panel">
          <div className="panel-head">
            <div><h2>Devices on your network</h2><p className="sub small">Rigmind tells you when a device it hasn't seen before joins.</p></div>
            <button className="btn sm" disabled={!!busy} onClick={() => run("sweep", () => api.securitySweep())}>{busy === "sweep" ? "Scanning…" : "Scan network"}</button>
          </div>
          {st.devices.slice(0, 15).map((dv) => (
            <div key={dv.mac} className="row between small" style={{ padding: "7px 0", borderTop: "1px solid var(--line-soft)" }}>
              {naming === dv.mac ? (
                <form className="row" onSubmit={async (e) => { e.preventDefault(); await api.renameDevice(dv.mac, name); setSt((s) => s && { ...s, devices: s.devices.map((x) => (x.mac === dv.mac ? { ...x, name: name || null } : x)) }); setNaming(null); }}>
                  <input className="input" autoFocus style={{ width: 170 }} value={name} onChange={(e) => setName(e.target.value)} aria-label="Device name" />
                  <button className="btn sm" type="submit">Save</button>
                </form>
              ) : (
                <button className="btn ghost sm" style={{ padding: 0 }} onClick={() => { setNaming(dv.mac); setName(dv.name ?? ""); }}>
                  <b>{dv.name ?? dv.ip}</b> {dv.name && <span className="muted">{dv.ip}</span>}
                </button>
              )}
              <span className="row">{dv.isNew && <span className="tag warn">New</span>}<span className="muted">{dv.mac}</span></span>
            </div>
          ))}
          {!st.devices.length && <p className="muted">No devices found yet.</p>}
        </section>
      </div>

      <section className="panel">
        <h2>Apps that accept network connections</h2>
        <p className="sub small">Games, launchers and chat apps normally show up here. Watch for anything you don't recognize, especially remote-access tools.</p>
        <table className="list" style={{ marginTop: 10 }}>
          <thead><tr><th>App</th><th>Port</th><th>Open to</th><th /></tr></thead>
          <tbody>
            {st.listeners.slice(0, 30).map((l) => (
              <tr key={`${l.process}-${l.protocol}-${l.port}`}>
                <td><b>{l.process}</b> {l.isNew && <span className="tag warn" style={{ marginLeft: 8 }}>New</span>}<div className="muted small" style={{ wordBreak: "break-all" }}>{l.path ?? ""}</div></td>
                <td>{l.protocol} {l.port}</td>
                <td>{l.address === "0.0.0.0" || l.address === "::" ? "All networks" : l.address}</td>
                <td className="num">{l.path && !/\\Windows\\/i.test(l.path) && <button className="btn ghost sm" onClick={() => confirm(`Block ${l.process} from using the network? You can undo this in the change history.`) && run("block", () => api.blockApp(l.path!))}>Block</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="muted small">Malware detection uses Microsoft Defender's engine. Rigmind never uploads your files anywhere. If you use another antivirus, Defender steps aside and Rigmind shows its name above.</p>
    </div>
  );
}
