// Power and cost: CPU + GPU watts from sensors plus an estimate for the rest of the PC.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { dataDir, load } from "./store";
import { hw } from "./hw";
import { telemetry } from "./telemetry";
import type { EnergySummary } from "../shared/types";

const file = () => join(dataDir("energy"), "energy.json");
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

class Energy {
  private days: Record<string, number> = {}; // Wh per day
  private loaded = false;
  private lastFlush = Date.now();

  init() {
    try {
      if (existsSync(file())) this.days = JSON.parse(readFileSync(file(), "utf8"));
    } catch {
      this.days = {};
    }
    this.loaded = true;
    telemetry.on("sample", () => this.tick());
  }

  /** Estimated whole-PC draw right now, in watts. */
  watts(): number | null {
    const t = telemetry.latest();
    const gpu = t?.gpu?.powerW ?? null;
    const cpu = hw.cpuPower();
    if (gpu == null && cpu == null) return null;
    // Without a CPU power sensor, estimate from load (a typical gaming CPU idles ~25 W and peaks ~120 W).
    const cpuW = cpu ?? 25 + ((t?.cpu.load ?? 0) / 100) * 95;
    return Math.round((gpu ?? 30) + cpuW + load().extras.baselineWatts);
  }

  private tick() {
    const w = this.watts();
    if (w == null || !this.loaded) return;
    const k = dayKey();
    this.days[k] = (this.days[k] ?? 0) + w / 3600;
    if (Date.now() - this.lastFlush > 60_000) {
      this.lastFlush = Date.now();
      writeFileSync(file(), JSON.stringify(this.days));
    }
  }

  summary(): EnergySummary {
    const rate = load().extras.energyRate;
    const today = (this.days[dayKey()] ?? 0) / 1000;
    const month = dayKey().slice(0, 7);
    const monthKWh = Object.entries(this.days).filter(([d]) => d.startsWith(month)).reduce((a, [, v]) => a + v, 0) / 1000;
    const days = Object.entries(this.days)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([day, wh]) => ({ day, kWh: +(wh / 1000).toFixed(2), cost: +((wh / 1000) * rate).toFixed(2) }));
    return {
      today: { kWh: +today.toFixed(2), cost: +(today * rate).toFixed(2) },
      month: { kWh: +monthKWh.toFixed(1), cost: +(monthKWh * rate).toFixed(2) },
      nowW: this.watts(),
      rate,
      days,
    };
  }
}

export const energy = new Energy();
