import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/barlow/500.css";
import "./styles.css";
import type { Telemetry } from "../shared/types";

function Overlay() {
  const [t, setT] = useState<Telemetry | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => window.rigmindOverlay?.onTelemetry(setT), []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const off = (window.rigmindOverlay as any)?.onToast?.((m: string) => {
      setToast(m);
      clearTimeout(timer);
      timer = setTimeout(() => setToast(null), Math.min(15000, 3000 + m.length * 60));
    });
    return () => off?.();
  }, []);
  const hot = (v: number | null | undefined, lim: number) => (v != null && v >= lim ? "hot" : undefined);
  return (
    <div className="ov">
      <div className="fps">{t?.fps?.fps ?? "–"}<small>FPS</small></div>
      <div className="lows">{t?.fps ? `1% low ${t.fps.low1}, ${t.fps.frametimeMs.toFixed(1)} ms` : "Waiting for frames"}</div>
      <div className="rows">
        <span className="k">CPU</span>
        <span>{t ? Math.round(t.cpu.load) : "–"}%</span>
        <span className={hot(t?.cpu.temp, 90)}>{t?.cpu.temp != null ? `${t.cpu.temp}°C` : ""}</span>
        <span className="k">GPU</span>
        <span>{t?.gpu ? Math.round(t.gpu.load) : "–"}%</span>
        <span className={hot(t?.gpu?.temp, 83)}>{t?.gpu?.temp != null ? `${t.gpu.temp}°C` : ""}</span>
      </div>
      {toast && <div className="ov-toast">{toast}</div>}
    </div>
  );
}

document.body.classList.add("overlay");
createRoot(document.getElementById("root")!).render(<Overlay />);
