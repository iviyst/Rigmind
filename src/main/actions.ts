// Executes an AI-proposed action after the user clicks Apply. Whitelisted only.
import { shell } from "electron";
import { spawn } from "node:child_process";
import * as win from "./winsys";
import { load, save } from "./store";
import { boost } from "./boost";
import { fans } from "./fans";
import { getProfile, saveProfile, pinToCacheCcd, cpuHasCacheCcd } from "./profiles";
import type { ProposedAction } from "../shared/types";

export async function executeAction(a: ProposedAction, scanDrivers: () => Promise<unknown>): Promise<{ ok: boolean; message: string }> {
  try {
    switch (a.kind) {
      case "set_power_plan_high":
        return (await win.setPowerScheme(win.HIGH_PERF))
          ? { ok: true, message: "Power plan set to High performance." }
          : { ok: false, message: "This PC doesn't offer High performance. Set Settings > Power > Power mode to Best performance." };
      case "set_power_plan_balanced":
        await win.setPowerScheme(win.BALANCED);
        return { ok: true, message: "Power plan set to Balanced." };
      case "end_process":
        if (!a.target) return { ok: false, message: "No process given." };
        return { ok: true, message: await win.endProcess(a.target) };
      case "add_to_pause_list": {
        const name = (a.target ?? "").replace(/\.exe$/i, "");
        if (!name || win.isProtected(name)) return { ok: false, message: `${name || "That"} can't be paused safely.` };
        const b = load().boost;
        if (!b.suspendList.some((n) => n.toLowerCase() === name.toLowerCase())) save({ boost: { ...b, suspendList: [...b.suspendList, name] } });
        return { ok: true, message: `${name} will be paused while you play.` };
      }
      case "enable_game_mode":
        await win.enableGameMode();
        return { ok: true, message: "Game Mode is on." };
      case "disable_game_dvr":
        await win.disableGameDvr();
        return { ok: true, message: "Xbox background recording is off." };
      case "clear_temp_files":
        return { ok: true, message: await win.clearTempFiles() };
      case "enable_gpu_scheduling":
        await win.enableGpuScheduling();
        return { ok: true, message: "Hardware-accelerated GPU scheduling is on. Restart to apply." };
      case "open_windows_setting": {
        const uri = win.SETTINGS_PAGES[a.target ?? ""];
        if (a.target === "startup") spawn("taskmgr.exe", ["/7", "/startup"], { detached: true, stdio: "ignore" }).unref();
        else if (uri) await shell.openExternal(uri);
        else return { ok: false, message: "Unknown settings page." };
        return { ok: true, message: "Opened." };
      }
      case "set_game_affinity_cache": {
        const g = boost.state;
        if (!(await cpuHasCacheCcd())) return { ok: false, message: "This CPU doesn't have a separate cache CCD." };
        const p = g.exe ? getProfile(g.exe) : null;
        if (p) saveProfile({ ...p, affinity: "cache-ccd" });
        if (g.pid && !(await pinToCacheCcd(g.pid))) return { ok: false, message: "Saved to the game's profile, but the game blocked the change right now. It applies next launch." };
        return { ok: true, message: g.pid ? "Game pinned to the cache cores, and saved to its profile." : "Saved to the game's profile." };
      }
      case "raise_game_priority": {
        const g = boost.state;
        const p = g.exe ? getProfile(g.exe) : null;
        if (p) saveProfile({ ...p, priority: "High" });
        if (g.pid) await win.setPriority(g.pid, "High");
        return { ok: true, message: "Game priority set to High." };
      }
      case "apply_fan_profile": {
        const t = a.target as "quiet" | "balanced" | "performance";
        if (!["quiet", "balanced", "performance"].includes(t)) return { ok: false, message: "Unknown fan profile." };
        const s = fans.saveSettings(boost.state.active ? { gameProfile: t } : { desktopProfile: t });
        return { ok: true, message: `${boost.state.active ? "Gaming" : "Desktop"} fan profile set to ${t}.${s.enabled ? "" : " Turn on fan control on the Cooling page for it to take effect."}` };
      }
      case "scan_drivers":
        await scanDrivers();
        return { ok: true, message: "Driver scan finished. See the Drivers page." };
    }
    return { ok: false, message: "That action isn't supported." };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? String(e) };
  }
}
