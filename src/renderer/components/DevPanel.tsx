import { useEffect, useState } from "react";
import { api, fmt } from "../api";
import { toast } from "./Bits";
import type { DevInfo, PortOwner } from "../../shared/types";

/** Dev mode (Tune page): WSL memory cap, build caches and "who has this port?". */
export function DevPanel() {
  const [d, setD] = useState<DevInfo | null>(null);
  const [cap, setCap] = useState("8");
  const [ports, setPorts] = useState<PortOwner[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    api.devInfo().then((x) => {
      setD(x);
      if (x.wsl.capGB) setCap(String(x.wsl.capGB));
    });
  }, []);
  if (!d || (!d.wsl.installed && !d.docker && !d.caches.length)) return null;
  const shown = (ports ?? []).filter((p) => !q || String(p.port).startsWith(q) || p.process.toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="panel">
      <h2>Developer tools</h2>
      {(d.wsl.installed || d.docker) && (
        <div className="setting">
          <div>
            <h3>WSL memory cap</h3>
            <p>{d.wsl.usingMB ? `WSL${d.docker ? " and Docker are" : " is"} holding ${fmt.gb(d.wsl.usingMB / 1024)} GB right now. ` : ""}Without a cap, WSL can keep up to half your RAM until it's shut down.{d.wsl.capGB ? ` Currently capped at ${d.wsl.capGB} GB.` : ""}</p>
          </div>
          <div className="row">
            <input className="input" type="number" min={2} max={256} style={{ width: 80 }} value={cap} onChange={(e) => setCap(e.target.value)} aria-label="Cap in GB" />
            <span className="muted">GB</span>
            <button className="btn sm" onClick={async () => toast((await api.devAct("wslcap", cap)).message)}>Set cap</button>
          </div>
        </div>
      )}
      {d.caches.length > 0 && (
        <table className="list" style={{ marginTop: 6 }}>
          <thead><tr><th>Build cache</th><th className="num">Size</th><th /></tr></thead>
          <tbody>
            {d.caches.map((c) => (
              <tr key={c.name}>
                <td>{c.name}<div className="muted small">{c.path}</div></td>
                <td className="num">{fmt.bytes(c.bytes)}</td>
                <td className="num"><button className="btn ghost sm" onClick={async () => { const r = await api.devAct("cleancache", c.name); toast(r.message); if (r.ok) setD((x) => x && { ...x, caches: x.caches.map((y) => (y.name === c.name ? { ...y, bytes: 0 } : y)) }); }}>Clean</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="setting">
        <div><h3>Who's using a port?</h3><p>For "port 3000 is already in use".</p></div>
        <div className="row">
          {ports && <input className="input" style={{ width: 140 }} placeholder="Port or app" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter ports" />}
          <button className="btn sm" onClick={async () => setPorts(await api.portOwners())}>{ports ? "Refresh" : "Show ports"}</button>
        </div>
      </div>
      {ports && (
        <table className="list">
          <tbody>
            {shown.slice(0, 20).map((p) => (
              <tr key={`${p.port}-${p.pid}`}><td className="num" style={{ width: 80 }}>{p.port}</td><td><b>{p.process}</b> <span className="muted small">PID {p.pid}</span></td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
