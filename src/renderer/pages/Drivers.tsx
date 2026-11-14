import { useEffect, useState } from "react";
import { api, fmt } from "../api";
import { Thinking, toast } from "../components/Bits";
import { IconExternal } from "../components/Icons";
import type { DriverItem, DriverScan } from "../../shared/types";

const statusTag = (s: DriverItem["status"]) =>
  s === "update" ? <span className="tag warn">Update available</span> : s === "current" ? <span className="tag good">Up to date</span> : s === "check" ? <span className="tag neutral">Check maker's tool</span> : <span className="tag neutral">Unknown</span>;

export function Drivers() {
  const [scan, setScan] = useState<DriverScan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.driversLast().then((s) => {
      setScan(s);
      if (s) setPicked(new Set(s.windowsUpdate.filter((u) => !u.isFirmware).map((u) => u.id)));
    });
    return api.onDriverProgress(setProgress);
  }, []);

  const run = async (label: string, fn: () => Promise<{ ok: boolean; message: string } | DriverScan>) => {
    setBusy(label);
    setProgress("");
    try {
      const r = await fn();
      if ("scannedAt" in r) {
        setScan(r);
        setPicked(new Set(r.windowsUpdate.filter((u) => !u.isFirmware).map((u) => u.id)));
        toast("Scan complete");
      } else toast(r.message);
    } catch (e: any) {
      toast(e?.message ?? "Something went wrong");
    } finally {
      setBusy(null);
      setProgress("");
    }
  };

  const updates = scan ? scan.gpu.filter((g) => g.status === "update").length + scan.windowsUpdate.length : 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Drivers and firmware</h1>
          <p className="sub">
            {scan ? `Last checked ${fmt.ago(scan.scannedAt)}. ${updates ? `${updates} update${updates > 1 ? "s" : ""} ready.` : "Everything Rigmind can check is current."}` : "Rigmind checks once a day and never while you're playing."}
          </p>
        </div>
        <button className="btn primary" disabled={!!busy} onClick={() => run("scan", () => api.driversScan())}>{busy === "scan" ? "Checking…" : "Check now"}</button>
      </div>

      {busy && (
        <div className="progress-line" role="status">
          <Thinking /> {progress || "Working…"}
        </div>
      )}

      {!scan && !busy && (
        <section className="panel empty">
          <h2>No scan yet</h2>
          <p>Check now to compare your graphics, chipset, network and other drivers against the latest releases.</p>
        </section>
      )}

      {scan && (
        <>
          {scan.errors.map((e) => <div key={e} className="notice">{e}</div>)}
          <section className="panel">
            <h2>Graphics driver</h2>
            {scan.gpu.map((g) => (
              <div key={g.name} className="driver">
                <div>
                  <h3>{g.name}</h3>
                  <div className="ver">Installed {g.installedVersion}{g.installedDate ? `, ${g.installedDate}` : ""}{g.latestVersion ? `. Latest ${g.latestVersion}` : ""}</div>
                </div>
                <div className="row">
                  {statusTag(g.status)}
                  {g.status === "update" && /nvidia/i.test(g.name) && (
                    <button className="btn primary sm" disabled={!!busy} onClick={() => run("nv", () => api.installNvidiaDriver())}>Download and install {g.latestVersion}</button>
                  )}
                  {g.link && <button className="btn sm" onClick={() => api.openExternal(g.link!)}>Open <IconExternal /></button>}
                </div>
                {g.note && <div className="note">{g.note}</div>}
              </div>
            ))}
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Updates from Windows Update</h2>
                <p className="sub small">Signed drivers Microsoft offers for your hardware. Rigmind makes a restore point before installing.</p>
              </div>
              {scan.windowsUpdate.length > 0 && (
                <button className="btn primary" disabled={!!busy || !picked.size} onClick={() => run("wu", () => api.installWindowsUpdateDrivers([...picked]))}>
                  Install {picked.size} selected
                </button>
              )}
            </div>
            {!scan.windowsUpdate.length && <p className="muted" style={{ margin: 0 }}>Windows Update has no driver updates for this PC.</p>}
            {scan.windowsUpdate.map((u) => (
              <label key={u.id} className="driver" style={{ cursor: "pointer" }}>
                <div className="row">
                  <input
                    type="checkbox"
                    checked={picked.has(u.id)}
                    onChange={(e) => {
                      const n = new Set(picked);
                      e.target.checked ? n.add(u.id) : n.delete(u.id);
                      setPicked(n);
                    }}
                  />
                  <div>
                    <h3>{u.title}</h3>
                    <div className="ver">{u.driverClass}{u.date ? `, released ${u.date}` : ""}</div>
                  </div>
                </div>
                {u.isFirmware ? <span className="tag warn">Firmware, not selected by default</span> : <span className="tag warn">Update available</span>}
              </label>
            ))}
          </section>

          <section className="panel">
            <h2>Firmware</h2>
            <p className="sub small">Rigmind checks firmware but never installs it for you. A failed BIOS flash can leave a PC unable to start, so do it yourself with the maker's tool, plugged into reliable power.</p>
            {scan.firmware.map((f) => (
              <div key={f.kind + f.name} className="driver">
                <div>
                  <h3>{f.kind === "bios" ? `BIOS on ${f.name}` : f.name}</h3>
                  <div className="ver">Version {f.version}{f.date ? `, released ${f.date}` : ""}</div>
                </div>
                <div className="row">
                  {f.kind === "bios" && (f.ageDays ?? 0) > 365 ? <span className="tag warn">Over a year old</span> : <span className="tag neutral">Check with maker</span>}
                  <button className="btn sm" onClick={() => api.openExternal(f.link)}>Find update <IconExternal /></button>
                </div>
                <div className="note">{f.advice}</div>
              </div>
            ))}
          </section>

          <section className="panel">
            <h2>Other device drivers</h2>
            {scan.devices.map((d) => (
              <div key={d.name} className="driver">
                <div>
                  <h3>{d.name}</h3>
                  <div className="ver">{d.installedVersion}{d.installedDate ? `, ${d.installedDate}` : ""}</div>
                </div>
                <div className="row">
                  {statusTag(d.status)}
                  {d.link && <button className="btn sm" onClick={() => api.openExternal(d.link!)}>Find driver <IconExternal /></button>}
                </div>
                {d.note && <div className="note">{d.note}</div>}
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
