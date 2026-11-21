import { useEffect, useState } from "react";
import { api, fmt } from "../api";
import type { BackupStatus, BatteryInfo, HangPattern } from "../../shared/types";

/** Backup check, laptop battery care and Hang detective (Health page). */
export function WorkHealthPanel({ laptop }: { laptop: boolean }) {
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [bat, setBat] = useState<BatteryInfo | null>(null);
  const [hangs, setHangs] = useState<HangPattern[]>([]);
  useEffect(() => {
    api.backupStatus().then(setBackup).catch(() => {});
    api.hangPatterns().then(setHangs).catch(() => {});
    if (laptop) api.battery().then(setBat).catch(() => {});
  }, [laptop]);
  const tone = { good: "good", warn: "warn", bad: "crit", unknown: "neutral" } as const;
  return (
    <>
      <div className="grid-2">
        <section className="panel">
          <h2>Backup check</h2>
          {backup ? (
            <>
              <div className="row" style={{ gap: 10 }}>
                <span className={`tag ${tone[backup.level]}`}>{backup.kind}</span>
                {backup.lastRun && <span className="muted small">Last backup {fmt.ago(backup.lastRun)}</span>}
              </div>
              <p className="small" style={{ marginBottom: 0 }}>{backup.detail}</p>
              {backup.level === "bad" && <button className="btn sm" style={{ marginTop: 10 }} onClick={() => api.openExternal("ms-settings:backup")}>Open backup settings</button>}
            </>
          ) : (
            <p className="muted small">Checking…</p>
          )}
        </section>
        {laptop && (
          <section className="panel">
            <h2>Battery health</h2>
            {bat?.present ? (
              <>
                <div className="stats" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                  <div className="stat"><div className="v">{bat.wearPct ?? "–"}<small>%</small></div><div className="k">Wear</div></div>
                  <div className="stat"><div className="v">{bat.fullWh?.toFixed(0) ?? "–"}<small>Wh</small></div><div className="k">Holds now (new: {bat.designWh?.toFixed(0) ?? "–"} Wh)</div></div>
                  <div className="stat"><div className="v">{bat.cycles ?? "–"}</div><div className="k">Charge cycles</div></div>
                </div>
                <p className="muted small" style={{ marginBottom: 0 }}>{bat.vendorTool ? `Stopping at 80% when you're mostly plugged in slows wear. ${bat.vendorTool.hint}` : "Your laptop maker's app can stop charging at 80% to slow wear, if it supports it."}</p>
              </>
            ) : (
              <p className="muted small">{bat ? "No battery found." : "Checking…"}</p>
            )}
          </section>
        )}
      </div>
      {hangs.length > 0 && (
        <section className="panel">
          <h2>Hang detective</h2>
          <p className="sub small">Apps that froze ("Not Responding"). After three freezes Rigmind looks for what they have in common.</p>
          <table className="list" style={{ marginTop: 8 }}>
            <tbody>
              {hangs.slice(0, 8).map((h) => (
                <tr key={h.app}>
                  <td><b>{h.app}</b><div className="muted small">{h.pattern ?? (h.count < 3 ? "Not enough freezes yet to see a pattern." : "Collecting details from the next freeze.")}</div></td>
                  <td className="num">{h.count}×</td>
                  <td className="num muted">{fmt.ago(h.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
