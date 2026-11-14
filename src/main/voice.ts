// Voice copilot: press the hotkey, ask a question, hear a short answer.
// Speech recognition and speech output run offline through Windows (System.Speech in the helper);
// only the recognized text goes to Claude.
import { globalShortcut, Notification } from "electron";
import { EventEmitter } from "node:events";
import { hw } from "./hw";
import { load, aiReady } from "./store";
import { quickAnswer } from "./ai";

class Voice extends EventEmitter {
  private busy = false;
  private registered: string | null = null;

  apply() {
    if (this.registered) globalShortcut.unregister(this.registered);
    this.registered = null;
    const v = load().extras.voice;
    if (!v.enabled) return;
    try {
      if (globalShortcut.register(v.hotkey, () => void this.ask())) this.registered = v.hotkey;
    } catch {
      /* invalid accelerator */
    }
  }

  async ask() {
    if (this.busy) return;
    if (!aiReady()) return this.show("Set up an AI engine in Settings (Claude or Rigmind Local AI) to use voice.");
    if (!hw.running) return this.show("Voice needs the hardware helper (npm run build:hw).");
    this.busy = true;
    try {
      this.show("Listening…", true);
      const heard = await hw.listen(8);
      const text = heard?.text?.trim();
      if (!text) return this.show(heard?.error ?? "Didn't catch that. Press the hotkey and try again.");
      this.show(`“${text}”`, true);
      const answer = await quickAnswer(text);
      this.show(answer);
      if (load().extras.voice.speak) hw.say(answer);
    } catch (e: any) {
      this.show("Voice error: " + (e?.message ?? e));
    } finally {
      this.busy = false;
    }
  }

  /** Shown in the in-game overlay if it's open, otherwise as a notification. */
  private show(text: string, transient = false) {
    const handled = this.listenerCount("message") > 0;
    this.emit("message", { text, transient });
    if (!handled && !transient) new Notification({ title: "Rigmind", body: text }).show();
  }
}

export const voice = new Voice();
