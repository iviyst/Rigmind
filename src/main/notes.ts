// Rig notes: facts Claude remembers about this PC between chats (stored only on this PC).
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./store";
import type { RigNote } from "../shared/types";

const file = () => join(dataDir("notes"), "notes.json");

export function listNotes(): RigNote[] {
  try {
    return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : [];
  } catch {
    return [];
  }
}
export function addNote(text: string): RigNote[] {
  const clean = text.trim().slice(0, 300);
  if (!clean) return listNotes();
  const all = [{ id: randomUUID(), t: Date.now(), text: clean }, ...listNotes()].slice(0, 100);
  writeFileSync(file(), JSON.stringify(all));
  return all;
}
export function deleteNote(id: string): RigNote[] {
  const all = listNotes().filter((n) => n.id !== id);
  writeFileSync(file(), JSON.stringify(all));
  return all;
}
