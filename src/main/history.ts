// Change history: every lasting change Rigmind makes, with undo where possible.
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./store";
import type { ChangeEntry } from "../shared/types";

interface Stored extends ChangeEntry {
  undo: { type: string; data: any } | null;
}

type UndoFn = (data: any) => Promise<string | void>;
const undoers = new Map<string, UndoFn>();
const file = () => join(dataDir("history"), "changes.json");

class History extends EventEmitter {
  private list: Stored[] | null = null;

  /** Modules register how to undo their own change types. */
  registerUndo(type: string, fn: UndoFn) {
    undoers.set(type, fn);
  }

  private load(): Stored[] {
    if (this.list) return this.list;
    try {
      this.list = existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : [];
    } catch {
      this.list = [];
    }
    return this.list!;
  }

  private save() {
    writeFileSync(file(), JSON.stringify(this.load().slice(0, 300)));
    this.emit("changed", this.entries());
  }

  record(label: string, source: ChangeEntry["source"], undo: Stored["undo"] = null) {
    this.load().unshift({ id: randomUUID(), t: Date.now(), label, source, undo, undoable: !!undo, undone: false });
    this.save();
  }

  entries(): ChangeEntry[] {
    return this.load().map(({ undo, ...e }) => e);
  }

  async undo(id: string): Promise<{ ok: boolean; message: string }> {
    const e = this.load().find((x) => x.id === id);
    if (!e || !e.undo || e.undone) return { ok: false, message: "Nothing to undo." };
    const fn = undoers.get(e.undo.type);
    if (!fn) return { ok: false, message: "Rigmind doesn't know how to undo this one." };
    try {
      const msg = await fn(e.undo.data);
      e.undone = true;
      this.save();
      return { ok: true, message: msg || `Undid: ${e.label}` };
    } catch (err: any) {
      return { ok: false, message: err?.message ?? String(err) };
    }
  }
}

export const history = new History();
