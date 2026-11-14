// In-game overlay: a transparent, click-through, always-on-top window.
// Works over borderless/windowed games. Exclusive-fullscreen games draw over it.
import { BrowserWindow, screen } from "electron";
import { load } from "./store";
import type { Telemetry } from "../shared/types";

let win: BrowserWindow | null = null;
const W = 230;
const H = 132;

function position() {
  const { workArea } = screen.getPrimaryDisplay();
  const c = load().boost.overlayCorner;
  const m = 16;
  const x = c.endsWith("left") ? workArea.x + m : workArea.x + workArea.width - W - m;
  const y = c.startsWith("top") ? workArea.y + m : workArea.y + workArea.height - H - m;
  return { x, y };
}

export function showOverlay(loadPage: (w: BrowserWindow, page: string) => void, preload: string, game: string) {
  if (!win) {
    win = new BrowserWindow({
      width: W,
      height: H,
      ...position(),
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setIgnoreMouseEvents(true);
    win.setVisibleOnAllWorkspaces(true);
    loadPage(win, "overlay.html");
    win.once("ready-to-show", () => win?.showInactive());
    win.on("closed", () => (win = null));
  } else {
    win.setPosition(position().x, position().y);
    win.showInactive();
  }
  win.webContents.once("did-finish-load", () => win?.webContents.send("overlay:game", game));
  win.webContents.send("overlay:game", game);
}

export function hideOverlay() {
  win?.close();
  win = null;
}

export function overlaySample(t: Telemetry) {
  win?.webContents.send("telemetry", t);
}
