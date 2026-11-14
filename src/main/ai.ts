// Claude-powered assistant. Read-only tools run automatically; anything that
// changes the PC is returned as a proposed action the user must click to apply.
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { getApiKey, load } from "./store";
import { localAi } from "./localai";
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
import { incidents } from "./incidents";
import { security } from "./security";
import { listNotes, addNote } from "./notes";
import { healthTrends, driverImpact, bootReport } from "./health";
import { stress } from "./stress";
import { displayReport, findGameConfig, shaderCacheInfo } from "./tune";
import { netmon } from "./netmon";
import { energy } from "./energy";
import { getProfile } from "./profiles";
import type { Rule, Checkup, MatchRecap, BiosLookup } from "../shared/types";
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
- Be direct and concise. Use short paragraphs and bullet lists. Plain language; the user is a capable developer and gamer.
- Rig notes (get_rig_notes) are facts about this PC from earlier chats. When the user tells you a lasting fact about their PC or setup (e.g. "I enabled XMP", "my PSU is 650 W"), save it with add_rig_note.
- Never help with aim assistance, triggerbots, ESP, macros, reading game memory, or anything else that gives an unfair advantage in multiplayer games or breaks a game's rules. Offer legitimate help instead: settings, practice, hardware and network tuning.
- Firmware: never suggest custom or modded BIOS. Point to the board maker's official BIOS and its own flashing tool.`;

function withContext(base: string) {
  const notes = listNotes().slice(0, 30).map((n) => `- ${n.text}`).join("\n");
  const style = load().extras.playstyle;
  return base + (style ? `\n\nThe user's playstyle: ${style}` : "") + (notes ? `\n\nRig notes:\n${notes}` : "");
}

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
    name: "get_incidents",
    description: "Recent crashes, GPU driver resets, hardware errors, blue screens and unexpected shutdowns, with the temperatures/power/load just before each one.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_health",
    description: "Temperature trends under load by week, boot times and what slows boot, how each GPU driver version changed each game's FPS, stress test results, energy use.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_security",
    description: "Microsoft Defender status and threats, apps accepting network connections, devices on the home network, exposure checklist (firewall, Remote Desktop, sharing) and recent security alerts.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_display_and_network",
    description: "Monitors (resolution, refresh rate vs max), Windows VRR, ping/jitter/loss to router, internet and the current game's servers, Wi-Fi signal, GPU shader cache sizes.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_game_config",
    description: "The game's own settings file (graphics options) for a game, by exe or name. Works for CS2, Fortnite, Valorant, Cyberpunk 2077, Minecraft, Roblox and most Unreal Engine games.",
    input_schema: { type: "object", properties: { game: { type: "string" } }, required: ["game"] },
  },
  {
    name: "get_rig_notes",
    description: "Facts about this PC and its owner saved from earlier chats.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "add_rig_note",
    description: "Save a lasting fact about this PC or setup for future chats (one short sentence).",
    input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  {
    name: "propose_action",
    description:
      "Propose a fix the user can apply with one click. kinds: set_power_plan_high, set_power_plan_balanced, end_process (target = process name or PID), add_to_pause_list (target = process name to pause during games), enable_game_mode, disable_game_dvr, clear_temp_files, enable_gpu_scheduling (needs restart), open_windows_setting (target = graphics|display|startup|power|gamemode|storage|windowsupdate), scan_drivers, set_game_affinity_cache (pin the running game to the X3D cache CCD), raise_game_priority, apply_fan_profile (target = quiet|balanced|performance), set_refresh_rate (target = '<display device>|<hz>', using the device name from get_display_and_network), add_defender_exclusion (target = game exe; excludes its install folder from real-time scans), clear_shader_cache, block_app_firewall (target = full exe path), quick_scan (Defender), remove_threat.",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["set_power_plan_high", "set_power_plan_balanced", "end_process", "add_to_pause_list", "enable_game_mode", "disable_game_dvr", "clear_temp_files", "enable_gpu_scheduling", "open_windows_setting", "scan_drivers", "set_game_affinity_cache", "raise_game_priority", "apply_fan_profile", "set_refresh_rate", "add_defender_exclusion", "clear_shader_cache", "block_app_firewall", "quick_scan", "remove_threat"],
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
    case "get_incidents":
      return incidents.all().slice(0, 25);
    case "get_health":
      return { trends: healthTrends(), driverImpact: driverImpact(), boot: await bootReport().catch(() => null), stressTests: stress.list().slice(0, 8).map(({ samples, ...r }) => r), energy: energy.summary() };
    case "get_security": {
      const st = security.state();
      return { ...st, alerts: st.alerts.filter((a) => !a.dismissed).slice(0, 20), listeners: st.listeners.slice(0, 40) };
    }
    case "get_display_and_network":
      return { display: await displayReport().catch(() => null), network: netmon.status(), shaderCaches: shaderCacheInfo() };
    case "get_game_config": {
      const g = String(input.game ?? "");
      const prof = getProfile(g);
      return (await findGameConfig(prof?.exe ?? g, prof?.name ?? g)) ?? { error: "Couldn't find a settings file for that game." };
    }
    case "get_rig_notes":
      return listNotes();
    case "add_rig_note":
      addNote(String(input.text ?? ""));
      return { ok: true };
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

const useLocal = () => load().aiProvider === "local";

/** Same tool loop as Claude, through Rigmind Local AI (Ollama's native tool calling). */
async function converseLocal(messages: Anthropic.MessageParam[], system: string, maxTokens: number): Promise<{ text: string; actions: ProposedAction[] }> {
  const actions: ProposedAction[] = [];
  const localTools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const msgs: any[] = [
    { role: "system", content: withContext(system) + "\n\nYou are running as Rigmind Local AI, a small model on the user's PC. Call tools to get real data before answering. Keep answers short." },
    ...messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) })),
  ];
  for (let i = 0; i < 8; i++) {
    const r = await localAi.chat(msgs, localTools, maxTokens);
    msgs.push({ role: "assistant", content: r.content, tool_calls: r.tool_calls });
    if (!r.tool_calls.length) return { text: r.content || "I couldn't come up with an answer. Try asking more specifically.", actions };
    for (const call of r.tool_calls) {
      let out: unknown;
      try {
        const args = typeof call.function.arguments === "string" ? JSON.parse(call.function.arguments) : call.function.arguments ?? {};
        out = await runTool(call.function.name, args, actions);
      } catch (e: any) {
        out = { error: String(e?.message ?? e) };
      }
      // Small models have small context windows: keep tool results compact.
      msgs.push({ role: "tool", tool_name: call.function.name, content: JSON.stringify(out).slice(0, 6000) });
    }
  }
  return { text: "I ran out of steps while investigating. Try a narrower question.", actions };
}

async function converse(messages: Anthropic.MessageParam[], system: string, maxTokens = 2048): Promise<{ text: string; actions: ProposedAction[] }> {
  if (useLocal()) return converseLocal(messages, system, Math.min(maxTokens, 1500));
  const c = client();
  const actions: ProposedAction[] = [];
  const model = load().model || "claude-sonnet-5-5";
  for (let i = 0; i < 10; i++) {
    const res = await c.messages.create({ model, max_tokens: maxTokens, system: withContext(system), tools, messages });
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
  return (await analyzeSessionFull(id)).text;
}

export async function analyzeSessionFull(id: string): Promise<{ text: string; actions: ProposedAction[] }> {
  const s = getSession(id);
  if (!s) throw new Error("Session not found");
  const prompt = `Analyze this gaming session of ${s.game}. Session id: ${s.id}.
Use get_session for the data, and get_system_info / get_driver_status if helpful.
Write a short report:
1. One-line verdict (smooth / some hitches / poor) with avg FPS and 1% low.
2. What caused the stutters or low FPS, with evidence (times, loads, temps, processes).
3. The top 3 fixes, most impactful first. Propose actions for any that Rigmind can apply.
${s.anomaly ? `Note: Rigmind flagged this session as unusual: ${s.anomaly} Explain why.` : ""}
Keep it under 250 words.`;
  const { text, actions } = await converse([{ role: "user", content: prompt }], SYSTEM);
  const withActions = actions.length ? text + "\n\n" + actions.map((a) => `- **${a.label}**: ${a.reason}`).join("\n") + "\n\n_Open the Assistant to apply these fixes._" : text;
  saveAnalysis(id, withActions);
  return { text: withActions, actions };
}


// ---------------- v1.2 AI features ----------------

export async function explainIncident(id: string): Promise<string> {
  const i = incidents.get(id);
  if (!i) throw new Error("Incident not found");
  const { text } = await converse(
    [{ role: "user", content: `Explain this incident and what most likely caused it. Look at other incidents and health data for patterns (same app, same driver, high temps/power before it). Give the likely cause, how confident you are, and the next steps, most useful first. Under 200 words.\n\n${JSON.stringify(i)}` }],
    SYSTEM
  );
  incidents.setExplanation(id, text);
  return text;
}

export async function triageAlert(id: string): Promise<string> {
  const a = security.getAlert(id);
  if (!a) throw new Error("Alert not found");
  const { text } = await converse(
    [{ role: "user", content: `Triage this security alert from Rigmind's intrusion watch. Use get_security for context. Say plainly whether it's likely harmless (e.g. a known app updating itself, a game launcher, a phone joining Wi-Fi) or worth worrying about, and exactly what to check or do. Don't be alarmist. Under 180 words.\n\n${JSON.stringify(a)}` }],
    SYSTEM
  );
  security.setTriage(id, text);
  return text;
}

export async function coach(question: string): Promise<string> {
  const results = stress.list().slice(0, 12).map(({ samples, ...r }) => r);
  const { text } = await converse(
    [{ role: "user", content: `You are coaching a GPU undervolt done in MSI Afterburner's curve editor (Ctrl+F). Steps are logged as stress tests named after the setting (e.g. "0.900 V @ 1950 MHz"). Rules: lower voltage in small steps (~25 mV) at a fixed clock, or raise clock at fixed voltage; any failed step means go back to the last passed one; finish with a long gaming test. Never suggest raising voltage above stock or touching the power limit above 100%. Use get_system_info and get_incidents to spot instability (GPU driver resets).\n\nLogged steps: ${JSON.stringify(results)}\n\nUser: ${question || "What should I try next?"}` }],
    SYSTEM
  );
  return text;
}

export async function gameAdvice(game: string, goal: string): Promise<string> {
  const { text } = await converse(
    [{ role: "user", content: `Optimize ${game} for this PC and this player. Steps: read the game's settings with get_game_config, look at its recent sessions (list_sessions/get_session) for FPS, 1% lows and stutter causes, check hardware (get_system_info, get_display_and_network). Goal: ${goal || "match my playstyle"}. Give: 1) the target (FPS cap, resolution/upscaler), 2) the exact settings to change in the game's menus, grouped by impact, with the setting's current value and the recommended one, 3) anything outside the game (driver settings such as Reflex/Anti-Lag, refresh rate, power). Keep it practical. Never suggest anything that breaks the game's rules.` }],
    SYSTEM,
    3000
  );
  return text;
}

/** Turn plain English into a rule, using only the triggers and actions the engine supports. */
export async function parseRule(text: string): Promise<Omit<Rule, "id" | "lastRun" | "enabled">> {
  if (useLocal()) return validateRule(text, await parseRuleLocal(text));
  const c = client();
  const res = await c.messages.create({
    model: load().model || "claude-sonnet-5-5",
    max_tokens: 1024,
    system: "Convert the user's automation request for Rigmind into a rule by calling create_rule. Use only the allowed triggers and actions. If the request can't be expressed, call create_rule with summary starting 'Can't do:' and explain briefly. Game names: use the exe name if known (cs2, VALORANT-Win64-Shipping, RobloxPlayerBeta, FortniteClient-Win64-Shipping) or the plain name.",
    tools: [
      {
        name: "create_rule",
        description: "Create an automation rule.",
        input_schema: {
          type: "object",
          properties: {
            summary: { type: "string", description: "One plain-English sentence describing the rule." },
            trigger: {
              type: "object",
              description: "One of: {type:'game_start',game?}, {type:'game_end',game?}, {type:'temp_above',source:'cpu'|'gpu',value}, {type:'time',at:'HH:MM'}, {type:'idle',minutes}, {type:'app_start',app}",
            },
            between: { type: "object", description: "Optional time window {from:'HH:MM',to:'HH:MM'}" },
            actions: {
              type: "array",
              description: "Each one of: {type:'fan_profile',value:'quiet'|'balanced'|'performance'}, {type:'light_mode',value:'status'|'static'|'off'|'screen'}, {type:'light_color',value:'#rrggbb'}, {type:'pause_app',value:name}, {type:'end_app',value:name}, {type:'power_plan',value:'high'|'balanced'}, {type:'notify',value:text}",
              items: { type: "object" },
            },
          },
          required: ["summary", "trigger", "actions"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "create_rule" },
    messages: [{ role: "user", content: text }],
  });
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error("Couldn't understand that rule.");
  return validateRule(text, block.input as any);
}

async function parseRuleLocal(text: string): Promise<any> {
  const prompt = `Turn this request into a JSON automation rule for Rigmind. Reply with JSON only, no other text.
Shape: {"summary": string, "trigger": T, "between": {"from":"HH:MM","to":"HH:MM"} | null, "actions": [A, ...]}
T is one of: {"type":"game_start","game"?:string} {"type":"game_end","game"?:string} {"type":"temp_above","source":"cpu"|"gpu","value":number} {"type":"time","at":"HH:MM"} {"type":"idle","minutes":number} {"type":"app_start","app":string}
A is one of: {"type":"fan_profile","value":"quiet"|"balanced"|"performance"} {"type":"light_mode","value":"status"|"static"|"off"|"screen"} {"type":"light_color","value":"#rrggbb"} {"type":"pause_app","value":string} {"type":"end_app","value":string} {"type":"power_plan","value":"high"|"balanced"} {"type":"notify","value":string}
If it can't be done with these, use {"summary":"Can't do: <why>","trigger":{"type":"game_end"},"actions":[]}.
Request: ${text}`;
  const r = await localAi.chat([{ role: "user", content: prompt }], [], 600);
  const m = r.content.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Couldn't understand that rule. Try wording it like: When <something happens>, <do something>.");
  return JSON.parse(m[0]);
}

function validateRule(text: string, r: any): Omit<Rule, "id" | "lastRun" | "enabled"> {
  const triggers = ["game_start", "game_end", "temp_above", "time", "idle", "app_start"];
  const actions = ["fan_profile", "light_mode", "light_color", "pause_app", "end_app", "power_plan", "notify"];
  if (String(r.summary).startsWith("Can't do:")) throw new Error(String(r.summary));
  if (!triggers.includes(r.trigger?.type)) throw new Error("That trigger isn't supported.");
  const acts = (r.actions ?? []).filter((a: any) => actions.includes(a?.type));
  if (!acts.length) throw new Error("None of those actions are supported.");
  return { text, summary: String(r.summary), trigger: r.trigger, between: r.between?.from && r.between?.to ? r.between : null, actions: acts };
}

/** Daily checkup: reviews the last day and proposes fixes. */
export async function runCheckup(): Promise<Checkup> {
  const { text, actions } = await converse(
    [{ role: "user", content: "Run a daily checkup of this PC. Look at incidents, health (trends, boot, driver impact), security, drivers, display/network and the last day of sessions. Start with a one-line overall status. Then list only what needs attention, most important first, each with the evidence and the fix (propose actions where Rigmind can apply them). If everything is fine, say so in two lines. Under 300 words." }],
    SYSTEM,
    3000
  );
  const first = text.split("\n").find((l) => l.trim())?.replace(/[#*_]/g, "").trim() ?? "Daily checkup";
  return { id: randomUUID(), t: Date.now(), title: first.slice(0, 120), report: text, actions };
}

/** Voice copilot: short spoken answer. */
export async function quickAnswer(question: string): Promise<string> {
  const { text } = await converse(
    [{ role: "user", content: `${question}\n\n(Answer for an in-game voice assistant: one or two short sentences, no lists, no markdown. Check live stats if the question is about the PC.)` }],
    SYSTEM,
    300
  );
  return text.replace(/[*#_`]/g, "");
}

export async function recapMatch(m: MatchRecap): Promise<string> {
  const { text } = await converse(
    [{ role: "user", content: `Recap this ${m.game === "cs2" ? "CS2" : "Dota 2"} match for the player. Separate gameplay from PC issues: point out rounds where FPS dropped or ping spiked and whether they lined up with deaths. Give 2-3 specific, fair-play tips. Under 200 words.\n\n${JSON.stringify(m)}` }],
    SYSTEM
  );
  return text;
}

/** Look up the newest official BIOS for this board with Claude's web search. */
export async function biosLookup(board: string, current: string, date: string | null): Promise<BiosLookup> {
  if (useLocal()) throw new Error("Looking up the latest BIOS needs web search, which only works with Claude. Use the Find update button to open the support page instead.");
  const c = client();
  const res = await c.messages.create({
    model: load().model || "claude-sonnet-5-5",
    max_tokens: 1500,
    system: "You find the newest official BIOS for a motherboard on the manufacturer's own support site. Only trust the manufacturer's site. Never suggest modded or unofficial BIOS files. When done, call report with what you found.",
    tools: [
      { type: "web_search_20250305", name: "web_search", max_uses: 4 } as any,
      {
        name: "report",
        description: "Report the newest official BIOS.",
        input_schema: {
          type: "object",
          properties: {
            latest: { type: "string", description: "Newest version name, e.g. F12" },
            latestDate: { type: "string" },
            newer: { type: "boolean", description: "Is it newer than the installed version?" },
            notes: { type: "string", description: "Short markdown: what versions newer than the installed one fix (security, stability, memory, CPU support), and warnings (e.g. can't downgrade after this version, must flash an in-between version first)." },
            url: { type: "string", description: "The manufacturer support/download page" },
          },
          required: ["notes"],
        },
      },
    ],
    messages: [{ role: "user", content: `Motherboard: ${board}. Installed BIOS: ${current}${date ? ` (dated ${date})` : ""}. Find the newest official BIOS version on the manufacturer's support page and compare.` }],
  } as any);
  const block = (res.content as any[]).find((b) => b.type === "tool_use" && b.name === "report");
  const r = block?.input ?? {};
  const text = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return { board, current, latest: r.latest ?? null, latestDate: r.latestDate ?? null, newer: typeof r.newer === "boolean" ? r.newer : null, notes: r.notes ?? text ?? "", url: r.url ?? null };
}
