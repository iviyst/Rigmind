// Gaming / Work / Both. The installer writes %ProgramData%\Rigmind\mode.json; a change made later
// in Settings is stored in Rigmind's own settings and wins. In Both mode the active profile follows
// what's in front of the user: a call beats a game, a game beats a busy work app.
import { EventEmitter } from "node:events";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { load, save } from "./store";
import { runPs } from "./ps";
import type { ActiveProfile, ModeState, WorkMode } from "../shared/types";

const programData = () => process.env.ProgramData ?? "C:\\ProgramData";
export const modeFile = () => join(programData(), "Rigmind", "mode.json");
const isMode = (m: unknown): m is WorkMode => m === "gaming" || m === "work" || m === "both";

function fromInstaller(): WorkMode | null {
  try {
    if (!existsSync(modeFile())) return null;
    const m = JSON.parse(readFileSync(modeFile(), "utf8").replace(/^\uFEFF/, "")).mode;
    return isMode(m) ? m : null;
  } catch {
    return null;
  }
}

/** The mode the user picked. Defaults to Both. */
export function currentMode(): WorkMode {
  return load().modeOverride ?? fromInstaller() ?? "both";
}
export const workFeatures = () => currentMode() !== "gaming";
export const gameFeatures = () => currentMode() !== "work";

class ModeService extends EventEmitter {
  private pcType: ModeState["pcType"] = "desktop";
  private managed = false;
  private active: ActiveProfile = "normal";
  private detail: string | null = null;
  private override: ActiveProfile | null = null;

  async init() {
    const out = await runPs(
      "$b=@(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue).Count; $d=(Get-CimInstance Win32_ComputerSystem).PartOfDomain; $a=(dsregcmd /status 2>$null | Select-String 'AzureAdJoined\\s*:\\s*YES').Count; \"$b|$d|$a\""
    ).catch(() => "0|False|0");
    const [b, d, a] = out.trim().split("|");
    this.pcType = Number(b) > 0 ? "laptop" : "desktop";
    this.managed = /true/i.test(d ?? "") || Number(a) > 0;
    this.emit("state", this.state());
  }

  get isManaged() {
    return this.managed;
  }
  get isLaptop() {
    return this.pcType === "laptop";
  }

  state(): ModeState {
    const fileMode = fromInstaller();
    return {
      mode: currentMode(),
      chosenAt: load().modeOverride ? "app" : fileMode ? "installer" : "default",
      active: this.override ?? this.active,
      detail: this.override ? "Set by you" : this.detail,
      override: this.override,
      pcType: this.pcType,
      managed: this.managed,
    };
  }

  setMode(mode: WorkMode): ModeState {
    if (!isMode(mode)) throw new Error("Unknown mode");
    save({ modeOverride: mode });
    // Keep the shared file in step so a reinstall offers the same choice.
    try {
      mkdirSync(join(programData(), "Rigmind"), { recursive: true });
      writeFileSync(modeFile(), JSON.stringify({ mode }));
    } catch {
      /* not fatal */
    }
    this.emit("state", this.state());
    return this.state();
  }

  setOverride(p: ActiveProfile | null): ModeState {
    this.override = p;
    this.emit("state", this.state());
    return this.state();
  }

  /** Called by the feature modules whenever a game, call or work job starts or stops. */
  update(signals: { game: string | null; call: string | null; work: string | null }) {
    const next: [ActiveProfile, string | null] = signals.call
      ? ["call", `${signals.call} call`]
      : signals.game
      ? ["game", signals.game]
      : signals.work
      ? ["work", signals.work]
      : ["normal", null];
    if (next[0] !== this.active || next[1] !== this.detail) {
      [this.active, this.detail] = next;
      this.emit("state", this.state());
    }
  }
}

export const mode = new ModeService();
