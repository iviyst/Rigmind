import type { RigmindApi } from "../shared/types";
import { mockApi } from "./mock";

declare global {
  interface Window {
    rigmind?: RigmindApi;
    rigmindOverlay?: { onGame(cb: (g: string) => void): () => void; onTelemetry(cb: (t: any) => void): () => void };
  }
}

export const isMock = !window.rigmind;
export const api: RigmindApi = window.rigmind ?? mockApi;

export const fmt = {
  pct: (v: number | null | undefined) => (v == null ? "–" : Math.round(v).toString()),
  temp: (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v)}°`),
  gb: (v: number) => v.toFixed(1),
  dur: (ms: number) => {
    const m = Math.round(ms / 60000);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  },
  when: (t: number) => {
    const d = new Date(t);
    const today = new Date();
    const y = new Date(Date.now() - 86400000);
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
    if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + `, ${time}`;
  },
  ago: (t: number) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
  },
};

export const tempTone = (v: number | null | undefined, warn: number, crit: number) => (v == null ? "neutral" : v >= crit ? "crit" : v >= warn ? "warn" : "good");
