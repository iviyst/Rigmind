// Executes an action after the user clicks Apply (or Autopilot applies a low-risk one).
// Only the actions listed here exist. Each lasting change is recorded in the change history.
import { shell } from "electron";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import * as win from "./winsys";
import { load, save } from "./store";
import { boost } from "./boost";
import { fans } from "./fans";
import { history } from "./history";
import { runPs } from "./ps";
import { getProfile, saveProfile, pinToCacheCcd, cpuHasCacheCcd } from "./profiles";
import { setRefresh, addDefenderExclusion, clearShaderCaches } from "./tune";
import { security } from "./security";
import { telemetry } from "./telemetry";
import type { ChangeEntry, ProposedAction } from "../shared/types";

type Result = { ok: boolean; message: string };
type Source = ChangeEntry["source"];

// ---- undo handlers for the changes below ----
history.registerUndo("power", async (d) => (await win.setPowerScheme(d.prev), "Power plan restored."));
history.registerUndo("pause_list_add", async (d) => {
  const b = load().boost;
  save({ boost: { ...b, suspendList: b.suspendList.filter((n) => n.toLowerCase() !== d.name.toLowerCase()) } });
  return `${d.name} is no longer paused during games.`;
});
history.registerUndo("game_mode", async () => {
  await runPs(`Set-ItemProperty 'HKCU:\\Software\\Microsoft\\GameBar' AutoGameModeEnabled 0 -Type DWord`);
  return "Game Mode turned off.";
});
history.registerUndo("game_dvr", async () => (await win.enableGameDvr(), "Background recording turned back on."));
history.registerUndo("hags", async () => {
  await runPs(`Set-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' HwSchMode 1 -Type DWord`);
  return "GPU scheduling turned off. Restart to apply.";
});
history.registerUndo("profile_field", async (d) => {
  const p = getProfile(d.exe);
  if (p) saveProfile({ ...p, [d.field]: d.prev });
  return "Game profile restored.";
});
history.registerUndo("fan_profile", async (d) => (fans.saveSettings({ [d.which]: d.prev }), "Fan profile restored."));

export async function executeAction(a: ProposedAction, scanDrivers: () => Promise<unknown>, source: Source = "assistant"): Promise<Result> {
  try {
    switch (a.kind) {
      case "set_power_plan_high":
      case "set_power_plan_balanced": {
        const prev = await win.getActivePowerScheme();
        const high = a.kind === "set_power_plan_high";
        const ok = await win.setPowerScheme(high ? win.HIGH_PERF : win.BALANCED);
        if (!ok) return { ok: false, message: "This PC doesn't offer High performance. Set Settings > Power > Power mode to Best performance." };
        if (prev) history.record(`Power plan set to ${high ? "High performance" : "Balanced"}`, source, { type: "power", data: { prev } });
        return { ok: true, message: `Power plan set to ${high ? "High performance" : "Balanced"}.` };
      }
      case "end_process":
        if (!a.target) return { ok: false, message: "No process given." };
        return { ok: true, message: await win.endProcess(a.target) };
      case "add_to_pause_list": {
        const name = (a.target ?? "").replace(/\.exe$/i, "");
        if (!name || win.isProtected(name)) return { ok: false, message: `${name || "That"} can't be paused safely.` };
        const b = load().boost;
        if (!b.suspendList.some((n) => n.toLowerCase() === name.toLowerCase())) {
          save({ boost: { ...b, suspendList: [...b.suspendList, name] } });
          history.record(`Added ${name} to the pause list`, source, { type: "pause_list_add", data: { name } });
        }
        return { ok: true, message: `${name} will be paused while you play.` };
      }
      case "enable_game_mode":
        await win.enableGameMode();
        history.record("Turned on Game Mode", source, { type: "game_mode", data: {} });
        return { ok: true, message: "Game Mode is on." };
      case "disable_game_dvr":
        await win.disableGameDvr();
        history.record("Turned off Xbox background recording", source, { type: "game_dvr", data: {} });
        return { ok: true, message: "Xbox background recording is off." };
      case "clear_temp_files": {
        const msg = await win.clearTempFiles();
        history.record(msg, source, null);
        return { ok: true, message: msg };
      }
      case "enable_gpu_scheduling":
        await win.enableGpuScheduling();
        history.record("Turned on hardware-accelerated GPU scheduling", source, { type: "hags", data: {} });
        return { ok: true, message: "Hardware-accelerated GPU scheduling is on. Restart to apply." };
      case "open_windows_setting": {
        const uri = win.SETTINGS_PAGES[a.target ?? ""];
        if (a.target === "startup") spawn("taskmgr.exe", ["/7", "/startup"], { detached: true, stdio: "ignore" }).unref();
        else if (uri) await shell.openExternal(uri);
        else return { ok: false, message: "Unknown settings page." };
        return { ok: true, message: "Opened." };
      }
      case "scan_drivers":
        await scanDrivers();
        return { ok: true, message: "Driver scan finished. See the Drivers page." };
      case "set_game_affinity_cache": {
        const g = boost.state;
        if (!(await cpuHasCacheCcd())) return { ok: false, message: "This CPU doesn't have a separate cache CCD." };
        const p = g.exe ? getProfile(g.exe) : null;
        if (p) {
          history.record(`Pinned ${p.name} to the cache cores`, source, { type: "profile_field", data: { exe: p.exe, field: "affinity", prev: p.affinity } });
          saveProfile({ ...p, affinity: "cache-ccd" });
        }
        if (g.pid && !(await pinToCacheCcd(g.pid))) return { ok: false, message: "Saved to the game's profile, but the game blocked the change right now. It applies next launch." };
        return { ok: true, message: g.pid ? "Game pinned to the cache cores, and saved to its profile." : "Saved to the game's profile." };
      }
      case "raise_game_priority": {
        const g = boost.state;
        const p = g.exe ? getProfile(g.exe) : null;
        if (p) {
          history.record(`Set ${p.name} to High priority`, source, { type: "profile_field", data: { exe: p.exe, field: "priority", prev: p.priority } });
          saveProfile({ ...p, priority: "High" });
        }
        if (g.pid) await win.setPriority(g.pid, "High");
        return { ok: true, message: "Game priority set to High." };
      }
      case "apply_fan_profile": {
        const t = a.target as "quiet" | "balanced" | "performance";
        if (!["quiet", "balanced", "performance"].includes(t)) return { ok: false, message: "Unknown fan profile." };
        const which = boost.state.active ? "gameProfile" : "desktopProfile";
        const prev = fans.settings()[which];
        const s = fans.saveSettings({ [which]: t });
        history.record(`${which === "gameProfile" ? "Gaming" : "Desktop"} fan profile set to ${t}`, source, { type: "fan_profile", data: { which, prev } });
        return { ok: true, message: `${which === "gameProfile" ? "Gaming" : "Desktop"} fan profile set to ${t}.${s.enabled ? "" : " Turn on fan control on the Cooling page for it to take effect."}` };
      }
      case "set_refresh_rate": {
        const [device, hz] = (a.target ?? "").split("|");
        if (!device || !Number(hz)) return { ok: false, message: "Missing display or refresh rate." };
        return setRefresh(device, Number(hz), source);
      }
      case "add_defender_exclusion": {
        const exe = (a.target ?? boost.state.exe ?? "").replace(/\.exe$/i, "");
        const p = getProfile(exe);
        const running = telemetry.procs.find((x) => x.name.toLowerCase() === exe.toLowerCase() && x.path);
        const dir = p?.installDir ?? (running?.path ? dirname(running.path) : null);
        if (!dir) return { ok: false, message: "Start the game once so Rigmind can find its folder." };
        return addDefenderExclusion(dir, source);
      }
      case "clear_shader_cache":
        return clearShaderCaches(source);
      case "block_app_firewall":
        return security.blockApp(a.target ?? "", source);
      case "quick_scan":
        return security.scan("QuickScan");
      case "remove_threat":
        return security.threatAction(a.target ?? security.state().threats[0]?.id ?? "", "remove");
    }
    return { ok: false, message: "That action isn't supported." };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? String(e) };
  }
}
