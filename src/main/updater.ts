// Auto-update from GitHub Releases (electron-updater). Downloads in the background,
// installs when you restart Rigmind. Never checks or installs while a game is running.
import { app } from "electron";
import { EventEmitter } from "node:events";
import { autoUpdater } from "electron-updater";
import { boost } from "./boost";
import type { UpdateStatus } from "../shared/types";

class Updater extends EventEmitter {
  status: UpdateStatus = { state: "idle", current: app.getVersion(), version: null, progress: 0, error: null, checkedAt: null };

  private set(p: Partial<UpdateStatus>) {
    this.status = { ...this.status, ...p };
    this.emit("status", this.status);
  }

  init() {
    if (!app.isPackaged) {
      this.set({ state: "dev" });
      return;
    }
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("checking-for-update", () => this.set({ state: "checking", error: null }));
    autoUpdater.on("update-available", (i) => this.set({ state: "downloading", version: i.version, progress: 0 }));
    autoUpdater.on("update-not-available", () => this.set({ state: "current", checkedAt: Date.now() }));
    autoUpdater.on("download-progress", (p) => this.set({ state: "downloading", progress: p.percent / 100 }));
    autoUpdater.on("update-downloaded", (i) => {
      this.set({ state: "ready", version: i.version, progress: 1, checkedAt: Date.now() });
      this.emit("ready", i.version);
    });
    autoUpdater.on("error", (e) => this.set({ state: "error", error: e?.message ?? String(e), checkedAt: Date.now() }));
    setTimeout(() => this.check(), 30_000);
    setInterval(() => this.check(), 6 * 3600_000);
  }

  async check() {
    if (!app.isPackaged || boost.state.active || this.status.state === "downloading" || this.status.state === "ready") return this.status;
    try {
      await autoUpdater.checkForUpdates();
    } catch (e: any) {
      this.set({ state: "error", error: e?.message ?? String(e) });
    }
    return this.status;
  }

  install(): { ok: boolean; message: string } {
    if (this.status.state !== "ready") return { ok: false, message: "No update is ready yet." };
    if (boost.state.active) return { ok: false, message: "Finish your game first. Rigmind installs the update when you close it." };
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return { ok: true, message: "Restarting to install the update…" };
  }
}

export const updater = new Updater();
