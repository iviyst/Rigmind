// Meeting Mode: knows a call has started because a call app is using the microphone (Windows
// records this under CapabilityAccessManager\ConsentStore), then clears the way for the call and
// warns early when the connection or CPU is about to make audio choppy.
import { EventEmitter } from "node:events";
import { ChildProcessWithoutNullStreams } from "node:child_process";
import { streamPs, runPs, runPsJson } from "./ps";
import { netmon } from "./netmon";
import { telemetry } from "./telemetry";
import { boost } from "./boost";
import { load, save } from "./store";
import { workFeatures } from "./mode";
import { holdUpdates } from "./tune";
import * as win from "./winsys";
import type { MeetingState } from "../shared/types";

const CALL_APPS: [RegExp, string][] = [
  [/teams/i, "Teams"],
  [/zoom/i, "Zoom"],
  [/webex|ciscocollab/i, "Webex"],
  [/slack/i, "Slack"],
  [/discord/i, "Discord"],
  [/skype/i, "Skype"],
  [/ringcentral/i, "RingCentral"],
  [/gotomeeting|g2m/i, "GoTo Meeting"],
  [/chrome|msedge|firefox|brave|opera|vivaldi/i, "Browser"], // Google Meet and other web calls
];
const PAUSE = ["OneDrive", "GoogleDriveFS", "Dropbox", "box", "iCloudDrive"];

// Prints the apps using the microphone right now, every 4 seconds.
const MIC_WATCH = String.raw`
$base='HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'
while($true){
  $using=@()
  foreach($k in Get-ChildItem $base -Recurse -ErrorAction SilentlyContinue){
    $p=Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue
    if($p -and $p.LastUsedTimeStart -and $p.LastUsedTimeStop -eq 0){ $using+=$k.PSChildName }
  }
  [Console]::Out.WriteLine((@{type='mic';using=@($using)} | ConvertTo-Json -Compress)); [Console]::Out.Flush()
  Start-Sleep -Seconds 4
}`;

const NOTIF_KEY = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings";

class MeetingMode extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private inCall = false;
  private app: string | null = null;
  private since: number | null = null;
  private paused: { pid: number; name: string }[] = [];
  private badSince: number | null = null;
  private health: MeetingState["health"] = { level: "good", message: null, jitterMs: null, lossPct: null, wifiSignal: null, cpu: null };
  private toastsWere: number | null = null;

  init() {
    this.start();
    setInterval(() => this.checkHealth(), 2000);
  }

  private start() {
    if (this.proc) return;
    this.proc = streamPs(MIC_WATCH, (o) => o.type === "mic" && void this.onMic(o.using as string[]), () => {
      this.proc = null;
      setTimeout(() => this.start(), 10_000);
    });
  }

  state(): MeetingState {
    const m = load().meeting;
    return { enabled: m.enabled, inCall: this.inCall, app: this.app, since: this.since, paused: [...new Set(this.paused.map((p) => p.name))], health: this.health, dnd: m.dnd };
  }

  save(patch: { enabled?: boolean; dnd?: boolean }): MeetingState {
    save({ meeting: { ...load().meeting, ...patch } });
    if (patch.enabled === false && this.inCall) void this.end();
    this.emit("state", this.state());
    return this.state();
  }

  get active() {
    return this.inCall;
  }

  private async onMic(using: string[]) {
    const hit = using.map((u) => CALL_APPS.find(([re]) => re.test(u))).find(Boolean);
    const want = !!hit && load().meeting.enabled && workFeatures();
    if (want && !this.inCall) await this.begin(hit![1]);
    else if (!want && this.inCall) await this.end();
  }

  private async begin(app: string) {
    this.inCall = true;
    this.app = app;
    this.since = Date.now();
    this.paused = await win.suspendByName(PAUSE).catch(() => []);
    await holdUpdates(true);
    if (load().meeting.dnd) {
      const was = await runPs(`(Get-ItemProperty '${NOTIF_KEY}' -ErrorAction SilentlyContinue).NOC_GLOBAL_SETTING_TOASTS_ENABLED`).catch(() => "");
      this.toastsWere = was.trim() === "" ? 1 : Number(was.trim());
      await runPs(`New-Item -Path '${NOTIF_KEY}' -Force | Out-Null; Set-ItemProperty '${NOTIF_KEY}' NOC_GLOBAL_SETTING_TOASTS_ENABLED 0 -Type DWord`).catch(() => {});
    }
    this.emit("state", this.state());
    this.emit("started", app);
  }

  async end() {
    if (!this.inCall) return;
    this.inCall = false;
    if (this.paused.length) await win.resumePids(this.paused.map((p) => p.pid)).catch(() => {});
    this.paused = [];
    if (!boost.state.active) await holdUpdates(false);
    if (this.toastsWere != null) {
      await runPs(`Set-ItemProperty '${NOTIF_KEY}' NOC_GLOBAL_SETTING_TOASTS_ENABLED ${this.toastsWere ? 1 : 0} -Type DWord`).catch(() => {});
      this.toastsWere = null;
    }
    this.app = null;
    this.since = null;
    this.health = { ...this.health, level: "good", message: null };
    this.emit("state", this.state());
  }

  private checkHealth() {
    if (!this.inCall) return;
    const net = netmon.status();
    const inet = net.targets.find((t) => t.host === "1.1.1.1");
    const recent = telemetry.history.slice(-8);
    const cpu = recent.length ? Math.round(recent.reduce((a, t) => a + t.cpu.load, 0) / recent.length) : null;
    const jitter = inet?.jitter ?? null;
    const loss = inet?.loss ?? null;
    const signal = net.wifi?.signal ?? null;
    let message: string | null = null;
    let level: MeetingState["health"]["level"] = "good";
    if ((loss ?? 0) > 8 || (jitter ?? 0) > 80) {
      level = "bad";
      message = signal != null && signal < 60 ? "Your connection is dropping audio. Wi-Fi is weak: plug in Ethernet or move closer to the router." : "Your connection is dropping audio. Something else may be using the internet.";
    } else if ((loss ?? 0) > 2 || (jitter ?? 0) > 30) {
      level = "warn";
      message = signal != null && signal < 60 ? "Connection is unsteady. Wi-Fi is weak: plug in Ethernet or move closer." : "Connection is unsteady. Audio may break up.";
    } else if (signal != null && signal < 50) {
      level = "warn";
      message = "Wi-Fi signal is weak. Plug in Ethernet or move closer to the router.";
    } else if ((cpu ?? 0) > 90) {
      level = "warn";
      message = "Your CPU is maxed out, which can make your voice choppy. Close heavy apps until the call ends.";
    }
    // Only warn after 20 seconds of trouble, so one blip doesn't nag.
    if (level !== "good") this.badSince ??= Date.now();
    else this.badSince = null;
    const show = level !== "good" && Date.now() - (this.badSince ?? Date.now()) >= 20_000;
    const next = { level: show ? level : "good", message: show ? message : null, jitterMs: jitter, lossPct: loss, wifiSignal: signal, cpu } as MeetingState["health"];
    const changed = next.level !== this.health.level;
    this.health = next;
    if (changed && show) this.emit("warning", message);
    this.emit("state", this.state());
  }

  /** The 10-second pre-call check. */
  async check(): Promise<{ mic: string | null; speakers: string | null; camera: boolean; net: string }> {
    const d = await runPsJson<{ names: string[]; cams: number }>(
      "$n=@(Get-PnpDevice -Class AudioEndpoint -Status OK -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FriendlyName); $c=@(Get-PnpDevice -Class Camera,Image -Status OK -ErrorAction SilentlyContinue).Count; @{names=$n;cams=$c} | ConvertTo-Json -Compress"
    ).catch(() => ({ names: [], cams: 0 }));
    const names = d.names ?? [];
    const net = netmon.status();
    const inet = net.targets.find((t) => t.host === "1.1.1.1");
    const netText = inet?.avg == null ? "Couldn't measure the connection yet." : `${inet.avg} ms ping, ${inet.jitter ?? 0} ms jitter, ${inet.loss}% loss${net.wifi ? `, Wi-Fi ${net.wifi.signal}%` : ""}`;
    return {
      mic: names.find((n) => /microphone|mic|headset|array/i.test(n)) ?? null,
      speakers: names.find((n) => /speaker|headphone|headset|output/i.test(n)) ?? null,
      camera: d.cams > 0,
      net: netText,
    };
  }
}

export const meeting = new MeetingMode();
