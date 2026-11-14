import { contextBridge, ipcRenderer } from "electron";
import type { RigmindApi } from "../shared/types";

const on = (channel: string) => (cb: (v: any) => void) => {
  const h = (_: unknown, v: any) => cb(v);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};
const call = (channel: string) => (...args: any[]) => ipcRenderer.invoke(channel, ...args);

const api: RigmindApi = {
  getSettings: call("settings:get"),
  saveSettings: call("settings:save"),
  setApiKey: call("settings:apiKey"),
  getSystemInfo: call("sys:info"),
  getToolStatus: call("sys:tools"),
  installTool: call("sys:installTool"),
  getRunningApps: call("sys:apps"),
  getGameState: call("game:state"),
  getHistory: call("telemetry:history"),
  getTopProcs: call("telemetry:procs"),
  manualBoost: call("game:manual"),
  onTelemetry: on("telemetry"),
  onGameState: on("game:state"),
  onNavigate: on("navigate"),
  listSessions: call("sessions:list"),
  getSession: call("sessions:get"),
  deleteSession: call("sessions:delete"),
  analyzeSession: call("sessions:analyze"),
  aiChat: call("ai:chat"),
  executeAction: call("ai:execute"),
  driversLast: call("drivers:last"),
  driversScan: call("drivers:scan"),
  installWindowsUpdateDrivers: call("drivers:installWu"),
  installNvidiaDriver: call("drivers:installNvidia"),
  onDriverProgress: on("drivers:progress"),
  openExternal: call("open:external"),
  getHwStatus: call("hw:status"),
  onHwStatus: on("hw:status"),
  getFanSettings: call("fans:get"),
  saveFanSettings: call("fans:save"),
  getFanRuntime: call("fans:runtime"),
  onFanRuntime: on("fans:runtime"),
  calibrateFan: call("fans:calibrate"),
  getRgbSettings: call("rgb:get"),
  saveRgbSettings: call("rgb:save"),
  getRgbStatus: call("rgb:status"),
  onRgbStatus: on("rgb:status"),
  launchOpenRgb: call("rgb:launch"),
  listProfiles: call("profiles:list"),
  saveProfile: call("profiles:save"),
  deleteProfile: call("profiles:delete"),
  cpuHasCacheCcd: call("profiles:cacheCcd"),
  startTest: call("tests:start"),
  cancelTest: call("tests:cancel"),
  listTests: call("tests:list"),
  onTest: on("tests:update"),
  getUpdateStatus: call("update:status"),
  onUpdateStatus: on("update:status"),
  checkForUpdates: call("update:check"),
  installUpdate: call("update:install"),
};

contextBridge.exposeInMainWorld("rigmind", api);
// The overlay listens for the game name separately.
contextBridge.exposeInMainWorld("rigmindOverlay", { onGame: on("overlay:game"), onTelemetry: on("telemetry") });
