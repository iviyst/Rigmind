import { useEffect, useState } from "react";
import { api, fmt } from "../api";
import { Switch, Thinking, toast } from "../components/Bits";
import { Treemap } from "../components/Treemap";
import type { CleanupPreview, DirNode, DiskInfo, DiskMap, MemoryView, SpaceHog } from "../../shared/types";

export function Space() {
  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [map, setMap] = useState<DiskMap | null>(null);
  const [trail, setTrail] = useState<DirNode[]>([]);
  const [scanning, setScanning] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ files: number; bytes: number } | null>(null);
  const [hogs, setHogs] = useState<SpaceHog[] | null>(null);
  const [hogBusy, setHogBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [mem, setMem] = useState<MemoryView | null>(null);

  useEffect(() => {
    api.disks().then(setDisks);
    api.memoryView().then(setMem);
    const off = api.onDiskProgress(setProgress);
    const t = setInterval(() => api.memoryView().then(setMem), 15_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  const scan = async (drive: string) => {
    setScanning(drive);
    setProgress(null);
    try {
      const m = await api.diskScan(drive);
      setMap(m);
      setTrail([m.root]);
    } catch (e: any) {
      toast(e?.message ?? "The scan failed");
    }
    setScanning(null);
  };
  const findHogs = async () => {
    setHogBusy("find");
    try {
      setHogs(await api.spaceHogs());
    } catch (e: any) {
      toast(e?.message ?? "Couldn't check");
    }
    setHogBusy(null);
  };
  const clean = async (h: SpaceHog) => {
    setHogBusy(h.id);
    const r = await api.spaceClean(h.id);
    toast(r.message);
    if (r.ok) setHogs((x) => x && x.filter((y) => y.id !== h.id));
    setPreview(null);
    setHogBusy(null);
    api.disks().then(setDisks);
  };
  const node = trail[trail.length - 1];
  const memTotal = mem ? mem.totalMB : 1;
  const seg = mem ? [
    { k: "In use", v: Math.max(0, mem.inUseMB - mem.compressedMB), c: "var(--cpu)" },
    { k: "Compressed", v: mem.compressedMB, c: "var(--gpu)" },
    { k: "Cached (ready to give back)", v: mem.standbyMB, c: "color-mix(in srgb, var(--cpu) 35%, var(--panel))" },
    { k: "Free", v: mem.freeMB, c: "var(--line)" },
  ] : [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Space and memory</h1>
          <p className="sub">What's filling your drives and what's using your RAM. Nothing is deleted without a preview, and your own files only ever go to the Recycle Bin.</p>
        </div>
      </div>

      <section className="panel">
        <h2>Drives</h2>
        {disks.map((d) => {
          const used = d.totalBytes - d.freeBytes;
          const pct = d.totalBytes ? (used / d.totalBytes) * 100 : 0;
          return (
            <div key={d.drive} className="row" style={{ padding: "10px 0", borderTop: "1px solid var(--line-soft)", gap: 16 }}>
              <b style={{ width: 160 }}>{d.drive} {d.label && <span className="muted">{d.label}</span>}</b>
              <div className="grow">
                <div className="progress"><i style={{ width: `${pct}%`, background: pct > 90 ? "var(--crit)" : pct > 80 ? "var(--warn)" : "var(--cpu)" }} /></div>
                <div className="muted small" style={{ marginTop: 4 }}>{fmt.bytes(d.freeBytes)} free of {fmt.bytes(d.totalBytes)}</div>
              </div>
              <button className="btn sm" disabled={!!scanning} onClick={() => scan(d.drive)}>{scanning === d.drive ? "Mapping…" : "Map this drive"}</button>
            </div>
          );
        })}
        {scanning && progress && <p className="progress-line" style={{ marginTop: 8 }}><Thinking /> {progress.files.toLocaleString()} files, {fmt.bytes(progress.bytes)} so far</p>}
      </section>

      {map && node && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>
                {trail.map((t, i) => (
                  <span key={t.path}>
                    {i > 0 && <span className="muted"> › </span>}
                    <button className="btn ghost sm" style={{ padding: "0 2px", fontSize: "inherit", fontWeight: "inherit" }} onClick={() => setTrail(trail.slice(0, i + 1))}>{i === 0 ? map.drive : t.name}</button>
                  </span>
                ))}
              </h2>
              <p className="sub small">{fmt.bytes(node.bytes)} in {node.files.toLocaleString()} files · mapped in {map.seconds} s. Click a block to look inside.</p>
            </div>
            <button className="btn sm" onClick={() => api.openPath(node.path)}>Open in Explorer</button>
          </div>
          <Treemap node={node} onOpen={(n) => setTrail([...trail, n])} />
          {map.bigFiles.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>Biggest files</h3>
              <table className="list" style={{ marginTop: 6 }}>
                <tbody>
                  {map.bigFiles.slice(0, 10).map((f) => (
                    <tr key={f.path}>
                      <td style={{ wordBreak: "break-all" }}>{f.path}</td>
                      <td className="num">{fmt.bytes(f.bytes)}</td>
                      <td className="num muted">{new Date(f.modified).toLocaleDateString()}</td>
                      <td className="num"><button className="btn ghost sm" onClick={() => api.openPath(f.path)}>Show</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Space you can get back</h2>
            <p className="sub small">Leftovers Windows and your apps don't need. System cleanup always goes through Windows' own tools.</p>
          </div>
          <button className="btn" disabled={!!hogBusy} onClick={findHogs}>{hogBusy === "find" ? "Looking…" : hogs ? "Look again" : "Find space"}</button>
        </div>
        {hogBusy === "find" && <p className="progress-line"><Thinking /> Checking update files, caches, old drivers and duplicates. This takes a minute or two.</p>}
        {hogs && !hogs.length && <p className="muted">Nothing worth cleaning right now.</p>}
        {hogs?.map((h) => (
          <div key={h.id} style={{ padding: "10px 0", borderTop: "1px solid var(--line-soft)" }}>
            <div className="row between" style={{ gap: 16, alignItems: "flex-start" }}>
              <div>
                <b>{h.label}</b> <span className="muted">{fmt.bytes(h.bytes)}</span>
                <div className="muted small">{h.detail}</div>
              </div>
              {h.fix && (
                <button className="btn sm" disabled={!!hogBusy} onClick={async () => (h.needsPreview ? setPreview(await api.spacePreview(h.id)) : clean(h))}>
                  {hogBusy === h.id ? "Working…" : h.fix}
                </button>
              )}
            </div>
            {preview?.hogId === h.id && (
              <div style={{ marginTop: 8, background: "var(--bg)", borderRadius: 8, padding: 10 }}>
                <table className="list">
                  <tbody>
                    {preview.items.slice(0, 30).map((i) => (
                      <tr key={i.path}>
                        <td style={{ wordBreak: "break-all" }} className="small">{i.path}</td>
                        <td className="num small">{fmt.bytes(i.bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.items.length > 30 && <p className="muted small">…and {preview.items.length - 30} more</p>}
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn primary sm" onClick={() => clean(h)}>Remove these ({fmt.bytes(preview.totalBytes)})</button>
                  <button className="btn ghost sm" onClick={() => setPreview(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </section>

      {mem && (
        <>
          <section className="panel">
            <h2>Memory</h2>
            <div className="membar" aria-label="How your RAM is used">
              {seg.map((s) => (
                <i key={s.k} style={{ width: `${(s.v / memTotal) * 100}%`, background: s.c }} title={`${s.k}: ${fmt.gb(s.v / 1024)} GB`} />
              ))}
            </div>
            <div className="legend" style={{ marginTop: 8 }}>
              {seg.map((s) => (
                <span key={s.k}><i style={{ background: s.c }} />{s.k} {fmt.gb(s.v / 1024)} GB</span>
              ))}
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>Cached memory holds files you used recently so they open faster. Windows gives it back the instant an app needs it, so a full-looking bar is normal. Rigmind doesn't "clean" it: that only makes the PC slower.</p>
            <table className="list" style={{ marginTop: 10 }}>
              <thead><tr><th>App</th><th className="num">Memory</th><th className="num">Last 3 hours</th><th /></tr></thead>
              <tbody>
                {mem.apps.slice(0, 15).map((a) => (
                  <tr key={a.app}>
                    <td>
                      <b>{a.app}</b> {a.procs > 1 && <span className="muted small">{a.procs} processes</span>}
                      {a.leak && <div className="small" style={{ color: "var(--warn)" }}>Keeps growing: restarting it frees about {fmt.gb((a.growthMB ?? 0) / 1024)} GB</div>}
                    </td>
                    <td className="num">{a.memMB >= 1024 ? `${fmt.gb(a.memMB / 1024)} GB` : `${a.memMB} MB`}</td>
                    <td className="num muted">{a.growthMB == null ? "–" : `${a.growthMB > 0 ? "+" : ""}${a.growthMB} MB`}</td>
                    <td className="num">
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        {a.leak && <button className="btn sm" onClick={async () => toast((await api.memoryAct("restart", a.app)).message)}>Restart</button>}
                        <button className="btn ghost sm" onClick={async () => toast((await api.memoryAct("close", a.app)).message)}>Close</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <h2>Starts with Windows</h2>
            <p className="sub small">Every app here starts at sign-in and keeps using memory. Turning one off doesn't uninstall it.</p>
            <table className="list" style={{ marginTop: 10 }}>
              <tbody>
                {mem.startup.map((s) => (
                  <tr key={s.id}>
                    <td><b>{s.name}</b>{s.publisher && <span className="muted small"> · {s.publisher}</span>}<div className="muted small" style={{ wordBreak: "break-all" }}>{s.command}</div></td>
                    <td className="num" style={{ width: 70 }}>
                      <Switch checked={s.enabled} label={`${s.name} at startup`} onChange={async (v) => { const r = await api.startupToggle(s.id, v); toast(r.message); if (r.ok) setMem((m) => m && { ...m, startup: m.startup.map((x) => (x.id === s.id ? { ...x, enabled: v } : x)) }); }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
