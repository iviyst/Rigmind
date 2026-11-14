// Claude-powered assistant. Read-only tools run automatically; anything that
// changes the PC is returned as a proposed action the user must click to apply.
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { getApiKey, load } from "./store";
import { telemetry } from "./telemetry";
import { boost } from "./boost";
import { listSessions, getSession, saveAnalysis } from "./sessions";
import { getSystemInfo } from "./winsys";
import { lastScan } from "./drivers";
import { hw } from "./hw";
import { fans } from "./fans";
import { listProfiles, cpuHasCacheCcd } from "./profiles";
import { tests } from "./tests";
import { TESTABLE } from "../shared/types";
import type { ActionKind, ChatMessage, ProposedAction, SessionDetail } from "../shared/types";

const SYSTEM = `You are Rigmind, the performance assistant built into a Windows gaming PC's monitoring app.
You can read live telemetry, hardware info, recorded gaming sessions (FPS, 1% lows, frame-time stutters with what else was happening at that moment) and driver/firmware status.

How to work:
- Always look at real data with your tools before diagnosing. Quote the specific numbers that support your conclusion.
- Session stutter events carry a "cause" (shader, loading, background, cpu, vram, thermal, unknown) and a "why". Use them, and look at the cause mix to find the main problem.
- When a game is running, fixes marked testable get an "Apply and test" button that measures FPS before and after. Mention that the user can test it when it fits.
- If the CPU is a dual-CCD X3D Ryzen, pinning the game to the cache CCD (set_game_affinity_cache) often improves 1% lows; suggest it when sessions are CPU-limited.
- Diagnose like an experienced PC tech: CPU-bound vs GPU-bound (GPU < ~85% while FPS is low usually means CPU/engine bound), thermal throttling (CPU > 90°C, GPU > 83°C), RAM pressure (> 85% used), VRAM limits, disk activity during stutters, background apps, outdated drivers, RAM not running at rated speed (XMP/EXPO off), single-channel RAM, power plan, refresh rate.
- To change anything on the PC, call propose_action. Never claim you changed something yourself; the user clicks Apply. Only propose actions that the data supports.
- Things you can't do through actions (BIOS settings like XMP, game graphics settings, hardware upgrades, flashing firmware) - explain the steps clearly.
- Never recommend flashing BIOS/firmware automatically; if a BIOS update looks worthwhile, tell them to download it from the motherboard maker's support page and follow its instructions.
- Be direct and concise. Use short paragraphs and bullet lists. Plain language; the user is a capable developer and gamer.`;

const tools: Anthropic.Tool[] = [
  {
    name: "get_live_stats",
    description: "Current CPU/GPU load, temps, clocks, RAM, VRAM, disk, network, FPS if a game is running, the last 60 seconds of history, the running game, and the top processes by CPU and RAM.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_system_info",
    description: "Static hardware/Windows info: CPU, RAM sticks and their configured vs rated speed, GPUs and driver versions, motherboard, BIOS, disks and free space, power plan, Game Mode, Game DVR, hardware GPU scheduling, displays and refresh rates.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_sessions",
    description: "Summaries of recorded gaming sessions (game, duration, avg FPS, 1% low, stutter count, max temps, avg loads).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_session",
    description: "Detail for one session: per-10-second timeline and every stutter event with CPU/GPU load, RAM, disk activity and the busiest other process at that moment.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "get_driver_status",
    description: "Last driver and firmware scan: GPU driver installed vs latest, device drivers, Windows Update driver updates available, BIOS and SSD firmware versions and age.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_hardware",
    description: "Fan speeds (RPM and %), every temperature sensor, fan control mode and profile, whether fan control is active or in failsafe.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_game_profiles",
    description: "Per-game profiles (priority, power, CPU pinning, pause list, fan profile, suggested apps to pause) and past before/after test results.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "propose_action",
    description:
      "Propose a fix the user can apply with one click. kinds: set_power_plan_high, set_power_plan_balanced, end_process (target = process name or PID), add_to_pause_list (target = process name to pause during games), enable_game_mode, disable_game_dvr, clear_temp_files, enable_gpu_scheduling (needs restart), open_windows_setting (target = graphics|display|startup|power|gamemode|storage|windowsupdate), scan_drivers, set_game_affinity_cache (pin the running game to the X3D cache CCD), raise_game_priority, apply_fan_profile (target = quiet|balanced|performance).",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["set_power_plan_high", "set_power_plan_balanced", "end_process", "add_to_pause_list", "enable_game_mode", "disable_game_dvr", "clear_temp_files", "enable_gpu_scheduling", "open_windows_setting", "scan_drivers", "set_game_affinity_cache", "raise_game_priority", "apply_fan_profile"],
        },
        target: { type: "string" },
        label: { type: "string", description: "Short button text, e.g. 'End Chrome' or 'Pause OneDrive during games'" },
        reason: { type: "string", description: "One sentence: why, citing the data" },
      },
      required: ["kind", "label", "reason"],
    },
  },
];

function client() {
  const key = getApiKey();
  if (!key) throw new Error("Add your Anthropic API key in Settings to use the assistant.");
  return new Anthropic({ apiKey: key });
}

function compactSession(s: SessionDetail) {
  const step = 10;
  const timeline = [];
  for (let i = 0; i < s.points.length; i += step) {
    const chunk = s.points.slice(i, i + step);
    const avg = (k: keyof (typeof chunk)[0]) => {
      const v = chunk.map((p) => p[k] as number | null).filter((x): x is number => x != null);
      return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
    };
    timeline.push({ sec: i, fps: avg("fps"), low1: avg("low1"), cpu: avg("cpu"), gpu: avg("gpu"), cpuTemp: avg("cpuTemp"), gpuTemp: avg("gpuTemp"), ramGB: avg("ram") });
  }
  const { points, stutterEvents, ...summary } = s;
  return {
    ...summary,
    durationMin: Math.round((s.end - s.start) / 60000),
    timeline,
    stutterEvents: stutterEvents.slice(0, 150).map((e) => ({ ...e, sec: Math.round((e.t - s.start) / 1000) })),
  };
}

async function runTool(name: string, input: any, actions: ProposedAction[]): Promise<unknown> {
  switch (name) {
    case "get_live_stats": {
      const h = telemetry.history.slice(-60);
      const procs = telemetry.procs;
      return {
        now: telemetry.latest(),
        last60s: h.map((t) => ({ cpu: t.cpu.load, gpu: t.gpu?.load, cpuTemp: t.cpu.temp, gpuTemp: t.gpu?.temp, ramGB: +t.ram.usedGB.toFixed(1), fps: t.fps?.fps, low1: t.fps?.low1 })),
        game: boost.state,
        topCpu: [...procs].sort((a, b) => b.cpu - a.cpu).slice(0, 10).map(({ name, pid, cpu, memMB }) => ({ name, pid, cpu, memMB })),
        topRam: [...procs].sort((a, b) => b.memMB - a.memMB).slice(0, 10).map(({ name, pid, cpu, memMB }) => ({ name, pid, cpu, memMB })),
        sensors: { cpuTemp: telemetry.cpuTempSensor ? "available" : "not available (LibreHardwareMonitor not running)", nvidiaSmi: telemetry.nvidiaAvailable },
        pauseList: load().boost.suspendList,
      };
    }
    case "get_system_info":
      return getSystemInfo();
    case "list_sessions":
      return listSessions().slice(0, 20).map(({ analysis, ...s }) => ({ ...s, durationMin: Math.round((s.end - s.start) / 60000) }));
    case "get_session": {
      const s = getSession(String(input.id));
      return s ? compactSession(s) : { error: "No session with that id" };
    }
    case "get_hardware":
      return { ...hw.status(), fanControl: fans.runtime(), fanSettings: { ...fans.settings(), controls: undefined } };
    case "get_game_profiles":
      return { cpuHasCacheCcd: await cpuHasCacheCcd(), profiles: listProfiles(), tests: tests.list().slice(0, 15) };
    case "get_driver_status":
      return lastScan() ?? { note: "No driver scan yet. Propose scan_drivers." };
    case "propose_action": {
      const a: ProposedAction = {
        id: randomUUID(),
        kind: input.kind as ActionKind,
        target: input.target,
        label: String(input.label),
        reason: String(input.reason),
        state: "pending",
        testable: !!TESTABLE[input.kind as ActionKind],
      };
      actions.push(a);
      return { ok: true, note: "Shown to the user as a button. They decide whether to apply it." };
    }
  }
  return { error: "Unknown tool" };
}

async function converse(messages: Anthropic.MessageParam[], system: string): Promise<{ text: string; actions: ProposedAction[] }> {
  const c = client();
  const actions: ProposedAction[] = [];
  const model = load().model || "claude-sonnet-5-5";
  for (let i = 0; i < 8; i++) {
    const res = await c.messages.create({ model, max_tokens: 2048, system, tools, messages });
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason !== "tool_use") {
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      return { text, actions };
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      let out: unknown;
      try {
        out = await runTool(block.name, block.input, actions);
      } catch (e: any) {
        out = { error: String(e?.message ?? e) };
      }
      results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
  }
  return { text: "I ran out of steps while investigating. Try asking a narrower question.", actions };
}

export async function chat(history: ChatMessage[]): Promise<ChatMessage> {
  const messages: Anthropic.MessageParam[] = history
    .filter((m) => m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));
  const { text, actions } = await converse(messages, SYSTEM);
  return { role: "assistant", content: text, actions };
}

export async function analyzeSession(id: string): Promise<string> {
  const s = getSession(id);
  if (!s) throw new Error("Session not found");
  const prompt = `Analyze this gaming session of ${s.game}. Session id: ${s.id}.
Use get_session for the data, and get_system_info / get_driver_status if helpful.
Write a short report:
1. One-line verdict (smooth / some hitches / poor) with avg FPS and 1% low.
2. What caused the stutters or low FPS, with evidence (times, loads, temps, processes).
3. The top 3 fixes, most impactful first. Propose actions for any that Rigmind can apply.
Keep it under 250 words.`;
  const { text, actions } = await converse([{ role: "user", content: prompt }], SYSTEM);
  const withActions = actions.length ? text + "\n\n" + actions.map((a) => `- **${a.label}**: ${a.reason}`).join("\n") + "\n\n_Open the Assistant to apply these fixes._" : text;
  saveAnalysis(id, withActions);
  return withActions;
}
