import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, shell, session, IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { telemetry } from "./telemetry";
import { boost } from "./boost";
import { findPresentMon } from "./fps";
import { load, save, publicSettings, setApiKey, getApiKey } from "./store";
import { listSessions, getSession, deleteSession } from "./sessions";
import * as ai from "./ai";
import * as drivers from "./drivers";
import { executeAction } from "./actions";
import { getSystemInfo, isProtected } from "./winsys";
import { showOverlay, hideOverlay, overlaySample } from "./overlay";
import { hw } from "./hw";
import { fans } from "./fans";
import { rgb, findOpenRgb } from "./rgb";
import { tests } from "./tests";
import { updater } from "./updater";
import { resource } from "./paths";
import { listProfiles, saveProfile, deleteProfile, cpuHasCacheCcd } from "./profiles";
import type { ChatMessage, ProposedAction, SessionDetail, Settings, GameProfile, FanSettings, RgbSettings, TestChangeKind } from "../shared/types";

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
    const { hasApiKey, ...rest } = patch as Settings;
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
  ipcMain.handle("sessions:get", (_e, id: string) => getSession(id));
  ipcMain.handle("sessions:delete", (_e, id: string) => deleteSession(id));
  ipcMain.handle("sessions:analyze", (_e, id: string) => ai.analyzeSession(id));
  ipcMain.handle("ai:chat", (_e, h: ChatMessage[]) => ai.chat(h));
  ipcMain.handle("ai:execute", (_e, a: ProposedAction) => executeAction(a, scanDrivers));
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
      const summary = `${Math.round((detail.end - detail.start) / 60000)} min, ${detail.avgFps ?? "?"} FPS avg, ${detail.stutters} stutters.`;
      if (load().boost.autoAnalyze && getApiKey()) {
        try {
          await ai.analyzeSession(detail.id);
          notify(`${detail.game} session report`, summary + " Rigmind's analysis is ready.", "sessions");
          rgb.flash("#2f95db");
        } catch {
          notify(`${detail.game} session saved`, summary, "sessions");
        }
      } else notify(`${detail.game} session saved`, summary, "sessions");
    });
  });

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
