import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, shell, session, IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { telemetry } from "./telemetry";
import { boost } from "./boost";
import { findPresentMon } from "./fps";
import { load, save, publicSettings, setApiKey, aiReady } from "./store";
import { localAi } from "./localai";
import { listSessions, deleteSession } from "./sessions";
import * as ai from "./ai";
import * as drivers from "./drivers";
import { executeAction } from "./actions";
import { getSystemInfo, isProtected } from "./winsys";
import { showOverlay, hideOverlay, overlaySample, overlayToast } from "./overlay";
import { hw } from "./hw";
import { fans } from "./fans";
import { rgb, findOpenRgb } from "./rgb";
import { tests } from "./tests";
import { updater } from "./updater";
import { resource } from "./paths";
import { listProfiles, saveProfile, deleteProfile, cpuHasCacheCcd, getProfile } from "./profiles";
import { history } from "./history";
import { incidents } from "./incidents";
import { bootReport, healthTrends, driverImpact } from "./health";
import { stress } from "./stress";
import { displayReport, setRefresh, shaderCacheInfo, clearShaderCaches, checkDriverChange } from "./tune";
import { netmon } from "./netmon";
import { energy } from "./energy";
import { security } from "./security";
import { automations } from "./automations";
import { brain } from "./brain";
import { listNotes, addNote, deleteNote } from "./notes";
import { getSnapshot, getSession } from "./sessions";
import { gsi } from "./gsi";
import { voice } from "./voice";
import { remote } from "./remote";
import { discord } from "./discord";
import { app as electronApp } from "electron";
import { writeFileSync as writeFile } from "node:fs";
import type { ChatMessage, ProposedAction, SessionDetail, Settings, GameProfile, FanSettings, RgbSettings, TestChangeKind, ExtrasSettings, MatchRecap } from "../shared/types";

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const preload = join(__dirname, "preload.js");

let mainWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function loadPage(w: BrowserWindow, page: string) {
  if (isDev) w.loadURL(`${process.env.VITE_DEV_SERVER_URL}/${page}`);
  else w.loadFile(join(__dirname, "..", "..", "dist", "renderer", page));
}

function createWindow(show: boolean) {
  mainWin = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: "#0f1424",
    title: "Rigmind",
    icon: resource("icon.png"),
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#0f1424", symbolColor: "#8b95b5", height: 40 },
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
  });
  loadPage(mainWin, "index.html");
  // The UI is local only: never navigate the window anywhere else.
  mainWin.webContents.on("will-navigate", (e) => e.preventDefault());
  mainWin.once("ready-to-show", () => show && mainWin?.show());
  mainWin.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWin?.hide(); // keep monitoring from the tray
    }
  });
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

function showMain(page?: string) {
  if (!mainWin) createWindow(true);
  mainWin!.show();
  mainWin!.focus();
  if (page) mainWin!.webContents.send("navigate", page);
}

function notify(title: string, body: string, page?: string) {
  const n = new Notification({ title, body, icon: resource("icon.png") });
  n.on("click", () => showMain(page));
  n.show();
}

function buildTray() {
  tray = new Tray(nativeImage.createFromPath(resource("tray.png")));
  const refresh = () => {
    const b = load().boost;
    tray!.setToolTip(boost.state.active ? `Rigmind - boosting ${boost.state.game}` : "Rigmind");
    tray!.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open Rigmind", click: () => showMain() },
        { label: "Game Boost", type: "checkbox", checked: b.enabled, click: (i) => save({ boost: { ...b, enabled: i.checked } }) },
        { label: "In-game overlay", type: "checkbox", checked: b.overlay, click: (i) => save({ boost: { ...b, overlay: i.checked } }) },
        ...(updater.status.state === "ready" ? [{ label: `Restart to update (${updater.status.version})`, click: () => updater.install() }] : []),
        { type: "separator" },
        { label: "Quit", click: () => { quitting = true; app.quit(); } },
      ])
    );
  };
  refresh();
  tray.on("click", () => showMain());
  boost.on("state", refresh);
  updater.on("status", refresh);
}

function setStartup(on: boolean) {
  if (!app.isPackaged) return;
  // A scheduled task (not a Run key) because Rigmind runs elevated.
  const args = on
    ? ["/Create", "/F", "/TN", "Rigmind", "/SC", "ONLOGON", "/RL", "HIGHEST", "/TR", `"${process.execPath}" --hidden`]
    : ["/Delete", "/F", "/TN", "Rigmind"];
  execFile("schtasks.exe", args, { windowsHide: true }, () => {});
}

// ---------- Driver checks on a schedule ----------
async function scanDrivers() {
  const send = (m: string) => mainWin?.webContents.send("drivers:progress", m);
  const scan = await drivers.scanDrivers(send);
  const updates = scan.gpu.filter((g) => g.status === "update").length + scan.windowsUpdate.length;
  if (updates) {
    notify("Driver updates available", `${updates} update(s) ready to install.`, "drivers");
    rgb.flash("#f2a93b");
  }
  return scan;
}
function scheduleDriverChecks() {
  const check = () => {
    if (boost.state.active) return; // never during a game
    const last = drivers.lastScan()?.scannedAt ?? 0;
    if (Date.now() - last > load().driverCheckHours * 3600_000) scanDrivers().catch(() => {});
  };
  setTimeout(check, 5 * 60_000);
  setInterval(check, 60 * 60_000);
}

// ---------- IPC ----------
/** Only Rigmind's own pages may call into the main process. */
function trustedSender(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? "";
  return isDev ? url.startsWith(process.env.VITE_DEV_SERVER_URL!) : url.startsWith("file://");
}
const realHandle = ipcMain.handle.bind(ipcMain);
function guardIpc() {
  (ipcMain as any).handle = (channel: string, fn: (e: IpcMainInvokeEvent, ...a: any[]) => any) =>
    realHandle(channel, (e, ...args) => {
      if (!trustedSender(e)) throw new Error("Blocked IPC from untrusted page");
      return fn(e, ...args);
    });
}

function registerIpc() {
  guardIpc();
  ipcMain.handle("settings:get", () => publicSettings());
  ipcMain.handle("settings:save", (_e, patch: Partial<Settings>) => {
    const { hasApiKey, aiReady, ...rest } = patch as Settings;
    if (rest.startWithWindows !== undefined && rest.startWithWindows !== load().startWithWindows) setStartup(rest.startWithWindows);
    save(rest as any);
    return publicSettings();
  });
  ipcMain.handle("settings:apiKey", (_e, key: string) => {
    setApiKey(String(key ?? ""));
    return publicSettings(); // never returns the key itself
  });
  ipcMain.handle("sys:info", (_e, refresh?: boolean) => getSystemInfo(refresh));
  ipcMain.handle("sys:tools", () => ({ presentMon: !!findPresentMon(), cpuTempSensor: telemetry.cpuTempSensor || hw.cpuTemp() != null, nvidiaSmi: telemetry.nvidiaAvailable }));
  ipcMain.handle("hw:status", () => hw.status());
  ipcMain.handle("fans:get", () => fans.settings());
  ipcMain.handle("fans:save", (_e, p: Partial<FanSettings>) => fans.saveSettings(p));
  ipcMain.handle("fans:runtime", () => fans.runtime());
  ipcMain.handle("fans:calibrate", (_e, id: string) => fans.calibrate(id));
  ipcMain.handle("rgb:get", () => rgb.settings());
  ipcMain.handle("rgb:save", (_e, p: Partial<RgbSettings>) => rgb.saveSettings(p));
  ipcMain.handle("rgb:status", () => rgb.status());
  ipcMain.handle("rgb:launch", () => rgb.launch());
  ipcMain.handle("profiles:list", () => listProfiles());
  ipcMain.handle("profiles:save", (_e, p: GameProfile) => saveProfile(p));
  ipcMain.handle("profiles:delete", (_e, exe: string) => deleteProfile(exe));
  ipcMain.handle("profiles:cacheCcd", () => cpuHasCacheCcd());
  ipcMain.handle("tests:start", (_e, kind: TestChangeKind, target: string | undefined, label: string) => tests.start(kind, target, label));
  ipcMain.handle("tests:cancel", () => tests.cancel());
  ipcMain.handle("tests:list", () => (tests.current ? [tests.current, ...tests.list()] : tests.list()));
  ipcMain.handle("update:status", () => updater.status);
  ipcMain.handle("update:check", () => updater.check());
  ipcMain.handle("update:install", () => updater.install());
  // ---- v1.2 ----
  ipcMain.handle("inc:list", () => incidents.all());
  ipcMain.handle("inc:explain", (_e, id: string) => ai.explainIncident(String(id)));
  ipcMain.handle("health:boot", () => bootReport());
  ipcMain.handle("health:trends", () => healthTrends());
  ipcMain.handle("health:drivers", () => driverImpact());
  ipcMain.handle("stress:start", (_e, seconds: number, label: string, cpu: boolean, gpu: boolean) =>
    stress.start({ seconds: Number(seconds) || 300, label: String(label || "Stress test").slice(0, 80), cpu: !!cpu, gpu: !!gpu, loadPage, preload })
  );
  ipcMain.handle("stress:stop", () => stress.stop());
  ipcMain.handle("stress:list", () => stress.list());
  ipcMain.handle("stress:coach", (_e, q: string) => ai.coach(String(q ?? "").slice(0, 2000)));
  ipcMain.handle("tune:display", () => displayReport());
  ipcMain.handle("tune:refresh", (_e, device: string, hz: number) => setRefresh(String(device), Number(hz), "you"));
  ipcMain.handle("tune:shaders", () => shaderCacheInfo());
  ipcMain.handle("tune:clearShaders", () => clearShaderCaches("you"));
  ipcMain.handle("tune:advice", (_e, game: string, goal: string) => ai.gameAdvice(String(game), String(goal ?? "").slice(0, 500)));
  ipcMain.handle("net:status", () => netmon.status());
  ipcMain.handle("energy:summary", () => energy.summary());
  ipcMain.handle("bios:lookup", async () => {
    const fw = drivers.lastScan()?.firmware.find((f) => f.kind === "bios");
    if (!fw) throw new Error("Run a driver scan first so Rigmind knows your board.");
    return ai.biosLookup(fw.name, fw.version, fw.date);
  });
  ipcMain.handle("sec:state", () => security.state());
  ipcMain.handle("sec:check", () => security.check());
  ipcMain.handle("sec:sweep", () => security.sweep());
  ipcMain.handle("sec:scan", (_e, type: "QuickScan" | "FullScan") => security.scan(type === "FullScan" ? "FullScan" : "QuickScan"));
  ipcMain.handle("sec:offline", () => security.offlineScan());
  ipcMain.handle("sec:update", () => security.updateSignatures());
  ipcMain.handle("sec:threat", (_e, id: string, action: "remove" | "allow" | "restore") => security.threatAction(String(id), ["remove", "allow", "restore"].includes(action) ? action : "remove"));
  ipcMain.handle("sec:triage", (_e, id: string) => ai.triageAlert(String(id)));
  ipcMain.handle("sec:dismiss", (_e, id: string) => security.dismiss(String(id)));
  ipcMain.handle("sec:rename", (_e, mac: string, name: string) => security.renameDevice(String(mac), String(name ?? "").slice(0, 60)));
  ipcMain.handle("sec:block", (_e, path: string) => security.blockApp(String(path), "you"));
  ipcMain.handle("rules:list", () => automations.list());
  ipcMain.handle("rules:add", async (_e, text: string) => automations.add(await ai.parseRule(String(text).slice(0, 600))));
  ipcMain.handle("rules:toggle", (_e, id: string, on: boolean) => automations.toggle(String(id), !!on));
  ipcMain.handle("rules:delete", (_e, id: string) => automations.remove(String(id)));
  ipcMain.handle("checkup:list", () => brain.list());
  ipcMain.handle("checkup:run", () => brain.checkup());
  ipcMain.handle("notes:list", () => listNotes());
  ipcMain.handle("notes:add", (_e, t: string) => addNote(String(t)));
  ipcMain.handle("notes:delete", (_e, id: string) => deleteNote(String(id)));
  ipcMain.handle("changes:list", () => history.entries());
  ipcMain.handle("changes:undo", (_e, id: string) => history.undo(String(id)));
  ipcMain.handle("snap:get", (_e, sid: string, f: string) => getSnapshot(String(sid), String(f)));
  ipcMain.handle("match:list", () => gsi.recaps());
  ipcMain.handle("match:recap", async (_e, id: string) => {
    const m = gsi.recaps().find((x) => x.id === id);
    if (!m) throw new Error("Match not found");
    const text = await ai.recapMatch(m);
    gsi.saveRecapSummary(m.id, text);
    return text;
  });
  ipcMain.handle("voice:ask", () => voice.ask());
  ipcMain.handle("remote:pairing", () => remote.pairing());
  ipcMain.handle("remote:reset", () => (remote.resetToken(), remote.apply(), remote.pairing()));
  ipcMain.handle("rigcard:save", (_e, dataUrl: string) => {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) return { ok: false, message: "Invalid image." };
    const file = join(electronApp.getPath("pictures"), `Rigmind rig card ${new Date().toISOString().slice(0, 10)}.png`);
    writeFile(file, Buffer.from(dataUrl.split(",")[1], "base64"));
    shell.showItemInFolder(file);
    return { ok: true, message: "Saved to your Pictures folder." };
  });
  ipcMain.handle("gsi:install", async () => {
    const done = await gsi.install();
    return done.length ? { ok: true, message: `Game lighting set up for ${done.join(" and ")}. Restart the game if it's open.` } : { ok: false, message: "Couldn't find CS2 or Dota 2 in your Steam libraries." };
  });
  ipcMain.handle("extras:get", () => load().extras);
  ipcMain.handle("extras:save", (_e, patch: Partial<ExtrasSettings>) => {
    const next = save({ extras: { ...load().extras, ...patch } }).extras;
    voice.apply();
    remote.apply();
    discord.apply();
    return next;
  });
  ipcMain.handle("localai:status", () => localAi.status());
  ipcMain.handle("localai:setup", (_e, model?: string) => localAi.setup(typeof model === "string" && /^[\w.:-]{1,60}$/.test(model) ? model : undefined));
  ipcMain.handle("aim:score", (_e, mode: string, score: number, avgMs: number) => {
    const ex = load().extras;
    const scores = [{ t: Date.now(), mode: String(mode).slice(0, 20), score: Number(score) || 0, avgMs: Number(avgMs) || 0 }, ...ex.aim.scores].slice(0, 200);
    return save({ extras: { ...ex, aim: { ...ex.aim, scores } } }).extras;
  });
  ipcMain.handle("sys:installTool", async (_e, tool: "presentmon" | "librehardwaremonitor" | "pawnio" | "openrgb") => {
    if (tool === "pawnio") {
      // PawnIO is a signed kernel driver; install it from its official site.
      await shell.openExternal("https://pawnio.eu/");
      return { ok: true, message: "Download and run the PawnIO installer, then restart Rigmind." };
    }
    const id = tool === "presentmon" ? "Intel.PresentMon.Console" : tool === "openrgb" ? "OpenRGB.OpenRGB" : "LibreHardwareMonitor.LibreHardwareMonitor";
    return new Promise((resolve) => {
      execFile("winget", ["install", "--id", id, "-e", "--accept-package-agreements", "--accept-source-agreements", "--silent"], { windowsHide: true, timeout: 600_000 }, (err, stdout) => {
        if (err && !/already installed/i.test(stdout)) resolve({ ok: false, message: "winget couldn't install it: " + (stdout.split("\n").filter(Boolean).pop() ?? err.message) });
        else
          resolve({
            ok: true,
            message:
              tool === "presentmon"
                ? "PresentMon installed. FPS capture starts with your next game."
                : tool === "openrgb"
                ? "OpenRGB installed. Click Start OpenRGB to connect."
                : "LibreHardwareMonitor installed. Open it once and enable Options > Run on Windows startup, then CPU temps appear here.",
          });
      });
    });
  });
  ipcMain.handle("sys:apps", () =>
    [...telemetry.procs]
      .filter((p) => !isProtected(p.name) && p.memMB > 30)
      .sort((a, b) => b.memMB - a.memMB)
      .filter((p, i, all) => all.findIndex((q) => q.name === p.name) === i)
      .slice(0, 30)
  );
  ipcMain.handle("game:state", () => boost.state);
  ipcMain.handle("game:manual", (_e, on: boolean) => boost.manualToggle(on));
  ipcMain.handle("telemetry:history", () => telemetry.history);
  ipcMain.handle("telemetry:procs", () => telemetry.procs);
  ipcMain.handle("sessions:list", () => listSessions());
  ipcMain.handle("sessions:get", (_e, id: string) => getSession(String(id)));
  ipcMain.handle("sessions:delete", (_e, id: string) => deleteSession(id));
  ipcMain.handle("sessions:analyze", (_e, id: string) => ai.analyzeSession(id));
  ipcMain.handle("ai:chat", (_e, h: ChatMessage[]) => ai.chat(h));
  ipcMain.handle("ai:execute", (_e, a: ProposedAction) => executeAction(a, scanDrivers, "assistant"));
  ipcMain.handle("drivers:last", () => drivers.lastScan());
  ipcMain.handle("drivers:scan", () => scanDrivers());
  ipcMain.handle("drivers:installWu", (_e, ids: string[]) => drivers.installWindowsUpdate(ids, (m) => mainWin?.webContents.send("drivers:progress", m)));
  ipcMain.handle("drivers:installNvidia", () => drivers.installNvidia((m) => mainWin?.webContents.send("drivers:progress", m)));
  ipcMain.handle("open:external", (_e, url: string) => {
    if (typeof url === "string" && /^(https:\/\/|ms-settings:)/.test(url)) return shell.openExternal(url);
  });
}

// ---------- App lifecycle ----------
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => showMain());
  app.setAppUserModelId("com.chris.rigmind");

  app.whenReady().then(async () => {
    // No camera, mic, notifications-from-web, etc. The UI never needs browser permissions.
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    registerIpc();
    createWindow(!process.argv.includes("--hidden"));
    buildTray();
    await boost.init();
    telemetry.start();
    hw.start();
    fans.init();
    rgb.init();
    updater.init();
    scheduleDriverChecks();
    energy.init();
    localAi.init();
    localAi.on("status", (st) => mainWin?.webContents.send("localai:status", st));
    netmon.init();
    incidents.init();
    security.init();
    automations.init();
    brain.init((a, source) => executeAction(a, scanDrivers, source));
    void gsi.init();
    voice.apply();
    remote.apply();
    discord.apply();
    void checkDriverChange().then((d) => d && notify("GPU driver updated", `Driver ${d} detected. Rigmind cleared the old shader caches, so expect a few hitches while games rebuild them.`));

    // Push live updates to the window.
    const send = (ch: string) => (v: unknown) => mainWin?.webContents.send(ch, v);
    stress.on("state", send("stress:state"));
    netmon.on("status", send("net:status"));
    security.on("state", send("sec:state"));
    history.on("changed", send("changes:update"));
    incidents.on("incident", (i) => {
      mainWin?.webContents.send("inc:new", i);
      const serious = ["gpu_reset", "bluescreen", "power_loss", "hardware_error"].includes(i.kind) || (i.app && getProfile(i.app));
      if (serious) notify(i.title, "Open Health to see what happened and why.", "health");
    });
    security.on("alert", (a) => a.severity !== "info" && notify(a.title, a.detail.slice(0, 120), "security"));
    brain.on("checkup", (c) => notify("Daily checkup ready", c.title, "health"));
    brain.on("autopilot", (r: { from: string; done: string[] }) => notify("Autopilot made changes", `${r.done.join(", ")}. Undo any of them in Settings > Change history.`, "settings"));
    voice.on("message", (m: { text: string; transient: boolean }) => {
      if (!overlayToast(m.text) && !m.transient) notify("Rigmind", m.text);
    });
    gsi.on("match", (m: MatchRecap) => notify(`${m.game === "cs2" ? "CS2" : "Dota 2"} match saved`, "Open Sessions for your match recap.", "sessions"));

    hw.on("status", (st) => mainWin?.webContents.send("hw:status", st));
    fans.on("runtime", (r) => mainWin?.webContents.send("fans:runtime", r));
    rgb.on("status", (st) => mainWin?.webContents.send("rgb:status", st));
    tests.on("test", (t) => mainWin?.webContents.send("tests:update", t));
    updater.on("status", (u) => mainWin?.webContents.send("update:status", u));
    updater.on("ready", (v) => notify("Rigmind update ready", `Version ${v} installs when you restart Rigmind.`, "settings"));

    telemetry.on("sample", (t) => {
      mainWin?.webContents.send("telemetry", t);
      overlaySample(t);
    });
    boost.on("state", (s) => mainWin?.webContents.send("game:state", s));
    boost.on("started", (s, prof?: GameProfile) => {
      const b = load().boost;
      fans.onGameStart(prof && prof.fanProfile !== "default" ? prof.fanProfile : null);
      rgb.setGame(prof?.rgbColor ?? null);
      if (b.overlay) showOverlay(loadPage, preload, s.game ?? "");
      if (b.enabled) notify("Game Boost on", `${s.game}: ${s.suspended.length ? `paused ${s.suspended.join(", ")}` : "boost applied"}.`);
    });
    boost.on("ended", async (detail: SessionDetail | null) => {
      hideOverlay();
      fans.onGameEnd();
      rgb.setGame(null);
      if (tests.current) tests.cancel();
      if (!detail) return;
      const unusual = brain.anomaly(detail);
      if (unusual) notify("Unusual session", unusual, "sessions");
      const summary = `${Math.round((detail.end - detail.start) / 60000)} min, ${detail.avgFps ?? "?"} FPS avg, ${detail.stutters} stutters.`;
      if (load().boost.autoAnalyze && aiReady()) {
        try {
          const { actions } = await ai.analyzeSessionFull(detail.id);
          void brain.autopilot(actions, `${detail.game} session`);
          notify(`${detail.game} session report`, summary + " Rigmind's analysis is ready.", "sessions");
          rgb.flash("#2f95db");
        } catch {
          notify(`${detail.game} session saved`, summary, "sessions");
        }
      } else notify(`${detail.game} session saved`, summary, "sessions");
    });
  });

  ipcMain.on("stress:lost", () => stress.gpuLost());

  app.on("before-quit", async (e) => {
    quitting = true;
    if (boost.state.active) {
      e.preventDefault();
      await boost.shutdown(); // resume paused apps, restore power plan
      telemetry.stop();
      hw.stop(); // fans back to the BIOS
      setTimeout(() => app.exit(0), 400);
    } else {
      telemetry.stop();
      hw.stop();
    }
  });
  app.on("window-all-closed", () => {
    /* stay in tray */
  });
}
