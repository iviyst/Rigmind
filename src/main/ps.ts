// Helpers for running PowerShell from the main process.
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const PS_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];
const scriptDir = join(tmpdir(), "rigmind-ps");

function writeScript(script: string): string {
  mkdirSync(scriptDir, { recursive: true });
  const file = join(scriptDir, `${randomUUID()}.ps1`);
  // UTF-8 with BOM so Windows PowerShell 5.1 reads it correctly.
  writeFileSync(file, "﻿" + "$ProgressPreference='SilentlyContinue'\n[Console]::OutputEncoding=[Text.Encoding]::UTF8\n" + script, "utf8");
  return file;
}

/** Run a PowerShell script and resolve with its stdout. */
export function runPs(script: string, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const file = writeScript(script);
    const child = spawn("powershell.exe", [...PS_ARGS, "-File", file], { windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("PowerShell timed out"));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString("utf8")));
    child.stderr.on("data", (d) => (err += d.toString("utf8")));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out.trim()) reject(new Error(err.trim() || `PowerShell exited with ${code}`));
      else resolve(out);
    });
  });
}

/** Run a script whose last output line is JSON, and parse it. */
export async function runPsJson<T>(script: string, timeoutMs?: number): Promise<T> {
  const out = await runPs(script, timeoutMs);
  const start = out.search(/[\[{]/);
  if (start < 0) throw new Error("No JSON returned: " + out.slice(0, 200));
  return JSON.parse(out.slice(start)) as T;
}

/** Start a long-running PowerShell script that prints one JSON object per line. */
export function streamPs(script: string, onLine: (obj: any) => void, onExit: (code: number | null) => void): ChildProcessWithoutNullStreams {
  const file = writeScript(script);
  const child = spawn("powershell.exe", [...PS_ARGS, "-File", file], { windowsHide: true });
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d.toString("utf8");
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("{")) continue;
      try {
        onLine(JSON.parse(line));
      } catch {
        /* ignore partial lines */
      }
    }
  });
  child.on("close", onExit);
  return child;
}

/** Escape a string for use inside a single-quoted PowerShell literal. */
export const psq = (s: string) => "'" + s.replace(/'/g, "''") + "'";
