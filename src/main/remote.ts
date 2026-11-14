// Phone remote: a small web page on your home network (scan the QR code in Settings).
// Protected by a random secret in the link, accepts only private-network addresses, off by default.
import { createServer, Server, IncomingMessage, ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { timingSafeEqual, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { load, save } from "./store";
import { telemetry } from "./telemetry";
import { boost } from "./boost";
import { fans } from "./fans";
import { rgb } from "./rgb";
import { energy } from "./energy";
import { netmon } from "./netmon";

const PRIVATE = /^(::ffff:)?(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/;

function lanIp(): string | null {
  for (const list of Object.values(networkInterfaces()))
    for (const n of list ?? []) if (n.family === "IPv4" && !n.internal && PRIVATE.test(n.address)) return n.address;
  return null;
}

const PAGE = (allowControl: boolean) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rigmind</title><style>
body{margin:0;background:#0f1424;color:#e6eaf5;font:15px system-ui,sans-serif;padding:18px}
h1{font-size:20px;margin:0 0 4px}.sub{color:#8b95b5;margin:0 0 16px}
.g{display:grid;grid-template-columns:1fr 1fr;gap:10px}.c{background:#161d33;border-radius:14px;padding:14px}
.v{font-size:30px;font-weight:600}.k{color:#8b95b5;font-size:13px}.cpu{color:#2f95db}.gpu{color:#e2468b}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}button{flex:1;padding:12px;border-radius:10px;border:1px solid #2a3557;background:#1d2642;color:#e6eaf5;font-size:14px}
h2{font-size:15px;margin:18px 0 6px}.hot{color:#f2a93b}</style></head><body>
<h1>Rigmind</h1><p class="sub" id="game">Connecting…</p>
<div class="g">
<div class="c"><div class="k cpu">CPU</div><div class="v" id="cpu">–</div><div class="k" id="cput"></div></div>
<div class="c"><div class="k gpu">GPU</div><div class="v" id="gpu">–</div><div class="k" id="gput"></div></div>
<div class="c"><div class="k">FPS</div><div class="v" id="fps">–</div><div class="k" id="low"></div></div>
<div class="c"><div class="k">Ping</div><div class="v" id="ping">–</div><div class="k" id="watts"></div></div>
</div>
${allowControl ? `<h2>Fans</h2><div class="row"><button onclick="act('fan','quiet')">Quiet</button><button onclick="act('fan','balanced')">Balanced</button><button onclick="act('fan','performance')">Performance</button></div>
<h2>Lighting</h2><div class="row"><button onclick="act('light','status')">Status</button><button onclick="act('light','screen')">Screen</button><button onclick="act('light','off')">Off</button></div>` : `<p class="sub" style="margin-top:16px">Controls are off. Turn on "Allow control" in Rigmind's settings to change fans and lights from here.</p>`}
<script>
const token=new URLSearchParams(location.search).get('t');
const $=id=>document.getElementById(id);
function act(kind,value){fetch('/api/action?t='+encodeURIComponent(token),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind,value})})}
const es=new EventSource('/events?t='+encodeURIComponent(token));
es.onmessage=e=>{const d=JSON.parse(e.data);
$('game').textContent=d.game?('Playing '+d.game):'No game running';
$('cpu').textContent=d.cpu==null?'–':Math.round(d.cpu)+'%';$('gpu').textContent=d.gpu==null?'–':Math.round(d.gpu)+'%';
$('cput').textContent=d.cpuTemp==null?'':d.cpuTemp+'°C';$('gput').textContent=d.gpuTemp==null?'':d.gpuTemp+'°C';
$('cput').className='k'+(d.cpuTemp>=90?' hot':'');$('gput').className='k'+(d.gpuTemp>=83?' hot':'');
$('fps').textContent=d.fps??'–';$('low').textContent=d.low1?('1% low '+d.low1):'';
$('ping').textContent=d.ping==null?'–':d.ping+' ms';$('watts').textContent=d.watts?d.watts+' W':'';};
es.onerror=()=>{$('game').textContent='Disconnected. Is Rigmind running?'};
</script></body></html>`;

class PhoneRemote {
  private server: Server | null = null;

  private authed(req: IncomingMessage, url: URL): boolean {
    if (!PRIVATE.test(req.socket.remoteAddress ?? "")) return false;
    const given = Buffer.from(url.searchParams.get("t") ?? "");
    const real = Buffer.from(load().extras.remote.token);
    return given.length === real.length && timingSafeEqual(given, real);
  }

  apply() {
    this.server?.close();
    this.server = null;
    const cfg = load().extras.remote;
    if (!cfg.enabled) return;
    this.server = createServer((req, res) => this.handle(req, res));
    this.server.on("error", () => (this.server = null));
    this.server.listen(cfg.port, "0.0.0.0");
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://x");
    if (!this.authed(req, url)) return res.writeHead(403).end("Forbidden");
    const cfg = load().extras.remote;
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" });
      return res.end(PAGE(cfg.allowControl));
    }
    if (url.pathname === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const push = () => {
        const t = telemetry.latest();
        res.write(`data: ${JSON.stringify({ game: boost.state.active ? boost.state.game : null, cpu: t?.cpu.load ?? null, gpu: t?.gpu?.load ?? null, cpuTemp: t?.cpu.temp ?? null, gpuTemp: t?.gpu?.temp ?? null, fps: t?.fps?.fps ?? null, low1: t?.fps?.low1 ?? null, ping: netmon.gamePing(), watts: energy.watts() })}\n\n`);
      };
      push();
      const id = setInterval(push, 2000);
      req.on("close", () => clearInterval(id));
      return;
    }
    if (url.pathname === "/api/action" && req.method === "POST") {
      if (!cfg.allowControl) return res.writeHead(403).end();
      let body = "";
      req.on("data", (c) => (body += c).length > 2000 && req.destroy());
      req.on("end", () => {
        try {
          const { kind, value } = JSON.parse(body);
          if (kind === "fan" && ["quiet", "balanced", "performance"].includes(value)) fans.saveSettings(boost.state.active ? { gameProfile: value } : { desktopProfile: value });
          else if (kind === "light" && ["status", "screen", "off", "static"].includes(value)) rgb.saveSettings({ mode: value });
          else return res.writeHead(400).end();
          res.writeHead(200).end("ok");
        } catch {
          res.writeHead(400).end();
        }
      });
      return;
    }
    res.writeHead(404).end();
  }

  async pairing(): Promise<{ url: string | null; qr: string | null }> {
    const ip = lanIp();
    const cfg = load().extras.remote;
    if (!ip || !cfg.enabled) return { url: null, qr: null };
    const url = `http://${ip}:${cfg.port}/?t=${encodeURIComponent(cfg.token)}`;
    return { url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: "#0f1424", light: "#ffffff" } }) };
  }

  /** New secret: any phone that had the old link loses access. */
  resetToken() {
    const r = load().extras.remote;
    save({ extras: { ...load().extras, remote: { ...r, token: randomBytes(18).toString("base64url") } } });
  }
}

export const remote = new PhoneRemote();
