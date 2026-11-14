// Network quality: ping, jitter and loss to your router, the internet, and the game's own servers.
import { EventEmitter } from "node:events";
import { hw } from "./hw";
import { runPs, runPsJson } from "./ps";
import { boost } from "./boost";
import type { NetStatus } from "../shared/types";

const isPrivate = (ip: string) => /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|fe80:|0\.)/i.test(ip);

class NetMonitor extends EventEmitter {
  private samples = new Map<string, (number | null)[]>();
  private labels = new Map<string, string>();
  private gateway: string | null = null;
  private gameServers: string[] = [];
  private wifi: NetStatus["wifi"] = null;

  init() {
    hw.on("ping", (r: { host: string; ms: number | null }[]) => {
      for (const x of r) {
        const arr = this.samples.get(x.host) ?? [];
        arr.push(x.ms);
        if (arr.length > 30) arr.shift();
        this.samples.set(x.host, arr);
      }
      this.emit("status", this.status());
    });
    void this.refreshTargets();
    setInterval(() => void this.refreshTargets(), 20_000);
    setInterval(() => void this.refreshWifi(), 30_000);
    void this.refreshWifi();
  }

  private async refreshTargets() {
    if (!this.gateway) {
      this.gateway = (await runPs("(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).NextHop").catch(() => "")).trim() || null;
    }
    // The game's live servers: remote addresses of its TCP connections (UDP has no remote address in Windows).
    const pid = boost.state.pid;
    if (boost.state.active && pid) {
      const ips = await runPsJson<string[]>(`ConvertTo-Json -Compress -InputObject @(Get-NetTCPConnection -OwningProcess ${pid} -State Established -ErrorAction SilentlyContinue | Select-Object -ExpandProperty RemoteAddress -Unique)`).catch(() => []);
      this.gameServers = (ips ?? []).filter((ip) => ip && !isPrivate(ip)).slice(0, 3);
    } else this.gameServers = [];
    const targets: string[] = [];
    if (this.gateway) {
      targets.push(this.gateway);
      this.labels.set(this.gateway, "Your router");
    }
    targets.push("1.1.1.1");
    this.labels.set("1.1.1.1", "Internet (Cloudflare)");
    for (const ip of this.gameServers) {
      targets.push(ip);
      this.labels.set(ip, `${boost.state.game ?? "Game"} server`);
    }
    hw.setPingTargets(targets);
    // Forget hosts we no longer ping.
    for (const h of [...this.samples.keys()]) if (!targets.includes(h)) this.samples.delete(h);
  }

  private async refreshWifi() {
    const out = await runPs("netsh wlan show interfaces").catch(() => "");
    const ssid = out.match(/^\s*SSID\s*:\s*(.+)$/m)?.[1]?.trim();
    const signal = out.match(/^\s*Signal\s*:\s*(\d+)%/m)?.[1];
    const band = out.match(/^\s*Band\s*:\s*(.+)$/m)?.[1]?.trim() ?? out.match(/^\s*Radio type\s*:\s*(.+)$/m)?.[1]?.trim() ?? "";
    this.wifi = ssid && signal ? { ssid, signal: Number(signal), band } : null;
  }

  status(): NetStatus {
    const targets = [...this.samples.entries()].map(([host, arr]) => {
      const ok = arr.filter((x): x is number => x != null);
      const diffs = ok.slice(1).map((v, i) => Math.abs(v - ok[i]));
      return {
        host,
        label: this.labels.get(host) ?? host,
        ms: arr[arr.length - 1] ?? null,
        avg: ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : null,
        jitter: diffs.length ? +(diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(1) : null,
        loss: arr.length ? Math.round(((arr.length - ok.length) / arr.length) * 100) : 0,
      };
    });
    return { targets, wifi: this.wifi, gameServers: this.gameServers };
  }

  /** Latest ping to the game's server (or the internet if none is known). */
  gamePing(): number | null {
    const st = this.status();
    const t = st.targets.find((x) => this.gameServers.includes(x.host)) ?? st.targets.find((x) => x.host === "1.1.1.1");
    return t?.ms ?? null;
  }
}

export const netmon = new NetMonitor();
