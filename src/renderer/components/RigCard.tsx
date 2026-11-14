import { useState } from "react";
import { api } from "../api";
import { toast } from "./Bits";

/** Draws a shareable "rig card" image of your specs and best results, saved as a PNG. */
export function RigCardButton({ cpuName }: { cpuName?: string }) {
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      const [sys, sessions, energy] = await Promise.all([api.getSystemInfo(), api.listSessions(), api.energySummary()]);
      const best = [...sessions].filter((s) => s.avgFps != null).sort((a, b) => b.end - a.end).reduce<Record<string, { fps: number; low: number | null }>>((acc, s) => {
        if (!acc[s.game] || s.avgFps! > acc[s.game].fps) acc[s.game] = { fps: s.avgFps!, low: s.low1 };
        return acc;
      }, {});
      const W = 1200, H = 630;
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const g = c.getContext("2d")!;
      await document.fonts.ready;
      g.fillStyle = "#0f1424";
      g.fillRect(0, 0, W, H);
      const grad = g.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, "#2f95db");
      grad.addColorStop(1, "#e2468b");
      g.fillStyle = grad;
      g.fillRect(0, 0, W, 6);
      g.fillStyle = "#e6eaf5";
      g.font = "600 46px 'Chakra Petch'";
      g.fillText("My rig", 60, 92);
      g.font = "500 20px Barlow";
      g.fillStyle = "#8b95b5";
      g.fillText("Measured by Rigmind", 60, 126);
      const rows: [string, string][] = [
        ["CPU", sys.cpu || cpuName || ""],
        ["GPU", (sys.gpus[0] ?? "").replace(/ - driver.*$/, "")],
        ["Memory", `${Math.round(sys.ramGB)} GB${sys.ramSticks[0] ? `, ${sys.ramSticks[0].match(/@ (\d+) MT\/s/)?.[1] ?? ""} MT/s` : ""}`],
        ["Board", sys.board],
        ["Display", sys.displays[0] ?? ""],
      ];
      rows.forEach(([k, v], i) => {
        g.fillStyle = "#8b95b5";
        g.font = "500 20px Barlow";
        g.fillText(k, 60, 196 + i * 52);
        g.fillStyle = "#e6eaf5";
        g.font = "600 24px Barlow";
        g.fillText(v.slice(0, 52), 180, 196 + i * 52);
      });
      g.fillStyle = "#161d33";
      g.fillRect(760, 160, 380, 400);
      g.fillStyle = "#8b95b5";
      g.font = "500 20px Barlow";
      g.fillText("Best average FPS", 790, 200);
      Object.entries(best).slice(0, 5).forEach(([game, r], i) => {
        g.fillStyle = "#e6eaf5";
        g.font = "600 40px 'Chakra Petch'";
        g.fillText(String(r.fps), 790, 260 + i * 62);
        g.font = "500 18px Barlow";
        g.fillStyle = "#b7c0db";
        g.fillText(`${game.slice(0, 24)}${r.low ? `, 1% low ${r.low}` : ""}`, 880, 252 + i * 62);
      });
      g.fillStyle = "#8b95b5";
      g.font = "500 18px Barlow";
      g.fillText(`${sessions.length} sessions logged, ${energy.month.kWh} kWh this month`, 60, 590);
      const r = await api.saveRigCard(c.toDataURL("image/png"));
      toast(r.message);
    } catch (e: any) {
      toast(e?.message ?? "Couldn't make the rig card");
    }
    setBusy(false);
  };
  return <button className="btn" disabled={busy} onClick={make}>{busy ? "Making…" : "Share rig card"}</button>;
}
