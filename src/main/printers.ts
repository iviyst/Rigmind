// Printer Finder: every printer on the network with a clear name, location and status, a one-click
// add through Windows' built-in IPP class driver, and fixes for "Offline" and stuck jobs.
// Discovery uses mDNS/Bonjour, the way AirPrint and IPP Everywhere printers announce themselves.
import { createSocket } from "node:dgram";
import { runPs, runPsJson, psq } from "./ps";
import { mode } from "./mode";
import { history } from "./history";
import type { PrinterInfo } from "../shared/types";

const SERVICES = ["_ipp._tcp.local", "_ipps._tcp.local", "_printer._tcp.local", "_pdl-datastream._tcp.local"];

// ---------- A tiny mDNS client ----------
function encodeName(name: string): Buffer {
  const parts = name.split(".").filter(Boolean);
  return Buffer.concat([...parts.map((p) => Buffer.concat([Buffer.from([Buffer.byteLength(p)]), Buffer.from(p)])), Buffer.from([0])]);
}
function query(): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(SERVICES.length, 4); // questions
  const qs = SERVICES.map((s) => Buffer.concat([encodeName(s), Buffer.from([0, 12, 0, 1])])); // PTR, IN
  return Buffer.concat([header, ...qs]);
}
function readName(buf: Buffer, off: number): [string, number] {
  const labels: string[] = [];
  let jumped = false;
  let next = off;
  for (let guard = 0; guard < 64; guard++) {
    const len = buf[off];
    if (len === undefined) break;
    if (len === 0) {
      off++;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      const ptr = ((len & 0x3f) << 8) | buf[off + 1];
      if (!jumped) next = off + 2;
      jumped = true;
      off = ptr;
      continue;
    }
    labels.push(buf.toString("utf8", off + 1, off + 1 + len));
    off += 1 + len;
  }
  return [labels.join("."), jumped ? next : off];
}
interface Rec { name: string; type: number; data: any }
function parse(buf: Buffer): Rec[] {
  const out: Rec[] = [];
  try {
    const qd = buf.readUInt16BE(4);
    const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
    let off = 12;
    for (let i = 0; i < qd; i++) off = readName(buf, off)[1] + 4;
    for (let i = 0; i < total; i++) {
      const [name, o] = readName(buf, off);
      const type = buf.readUInt16BE(o);
      const len = buf.readUInt16BE(o + 8);
      const start = o + 10;
      let data: any = null;
      if (type === 12) data = readName(buf, start)[0]; // PTR
      else if (type === 33) data = { port: buf.readUInt16BE(start + 4), target: readName(buf, start + 6)[0] }; // SRV
      else if (type === 1) data = [...buf.subarray(start, start + 4)].join("."); // A
      else if (type === 16) {
        // TXT: key=value strings
        const txt: Record<string, string> = {};
        let p = start;
        while (p < start + len) {
          const l = buf[p];
          const s = buf.toString("utf8", p + 1, p + 1 + l);
          const eq = s.indexOf("=");
          if (eq > 0) txt[s.slice(0, eq).toLowerCase()] = s.slice(eq + 1);
          p += 1 + l;
        }
        data = txt;
      }
      out.push({ name, type, data });
      off = start + len;
    }
  } catch {
    /* malformed packet: keep what we have */
  }
  return out;
}

/** Ask the network for printers and collect answers for a few seconds. */
function discover(ms = 3500): Promise<Rec[]> {
  return new Promise((resolve) => {
    const recs: Rec[] = [];
    const sock = createSocket({ type: "udp4", reuseAddr: true });
    const done = () => {
      try {
        sock.close();
      } catch {
        /* already closed */
      }
      resolve(recs);
    };
    sock.on("error", done);
    sock.on("message", (msg) => recs.push(...parse(msg)));
    // Sending from a random port asks printers to answer us directly (a "legacy unicast" query).
    sock.bind(0, () => {
      const q = query();
      sock.send(q, 5353, "224.0.0.251");
      setTimeout(() => sock.send(q, 5353, "224.0.0.251"), 1000);
    });
    setTimeout(done, ms);
  });
}

interface Found { instance: string; host: string | null; ip: string | null; port: number; ipp: boolean; secure: boolean; txt: Record<string, string> }

function assemble(recs: Rec[]): Found[] {
  const instances = new Set(recs.filter((r) => r.type === 12 && SERVICES.includes(r.name.toLowerCase())).map((r) => r.data as string));
  const out: Found[] = [];
  for (const inst of instances) {
    const srv = recs.find((r) => r.type === 33 && r.name === inst)?.data;
    const txt = recs.find((r) => r.type === 16 && r.name === inst)?.data ?? {};
    const host = srv?.target ?? null;
    const ip = host ? recs.find((r) => r.type === 1 && r.name === host)?.data ?? null : null;
    out.push({ instance: inst, host, ip, port: srv?.port ?? 631, ipp: /_ipps?\._tcp/i.test(inst), secure: /_ipps\._tcp/i.test(inst), txt });
  }
  return out;
}

// ---------- Installed printers ----------
const INSTALLED = String.raw`
$ErrorActionPreference='SilentlyContinue'
$ports=@{}; foreach($p in Get-PrinterPort){ $ports[$p.Name]=$p }
$def=(Get-CimInstance Win32_Printer | Where-Object Default).Name
$l=@(foreach($p in Get-Printer){
  $port=$ports[$p.PortName]
  $jobs=@(Get-PrintJob -PrinterName $p.Name)
  $stuck=@($jobs | Where-Object { $_.JobStatus -match 'Error|Blocked' -or $_.SubmittedTime -lt (Get-Date).AddMinutes(-10) }).Count
  [ordered]@{name=$p.Name;status=[string]$p.PrinterStatus;type=[string]$p.Type;port=$p.PortName;host=$(if($port){$port.PrinterHostAddress}else{$null});driver=$p.DriverName;location=$p.Location;isDefault=($p.Name -eq $def);jobs=$jobs.Count;stuck=$stuck;device=[string]$p.DeviceType;shared=$p.Shared}
})
ConvertTo-Json -InputObject @($l) -Depth 3 -Compress`;

const virtual = /Microsoft Print to PDF|Microsoft XPS|OneNote|Fax|Send To|PDF24|Adobe PDF|Snagit|CutePDF/i;

class PrinterFinder {
  private list: PrinterInfo[] = [];
  private lastScan = 0;

  init() {
    history.registerUndo("printer-default", async (d: { name: string }) => {
      await runPs(`(Get-CimInstance Win32_Printer -Filter ${psq(`Name='${d.name.replace(/'/g, "''")}'`)}) | Invoke-CimMethod -MethodName SetDefaultPrinter | Out-Null`);
      return `${d.name} is the default printer again.`;
    });
  }

  async list_(refresh = false): Promise<PrinterInfo[]> {
    if (!refresh && Date.now() - this.lastScan < 60_000 && this.list.length) return this.list;
    const [installed, recs] = await Promise.all([runPsJson<any[]>(INSTALLED, 60_000).catch(() => []), discover()]);
    const found = assemble(recs);
    const managed = mode.isManaged;
    const out: PrinterInfo[] = [];
    for (const p of installed) {
      if (virtual.test(p.name)) continue;
      const net = found.find((f) => (f.ip && f.ip === p.host) || (f.host && p.host && f.host.replace(/\.local$/, "").toLowerCase() === String(p.host).replace(/\.local$/, "").toLowerCase()) || f.instance.split("._")[0] === p.name);
      const offline = /offline|error|notavailable/i.test(p.status);
      // The printer is on the network under a new address, but the port still points at the old one.
      const moved = !net && p.host && /^\d+\.\d+\.\d+\.\d+$/.test(p.host) ? found.find((f) => f.instance.split("._")[0] === p.name || (f.txt.ty && p.driver?.includes(f.txt.ty))) : null;
      out.push({
        key: `installed|${p.name}`,
        name: p.name,
        installed: true,
        status: offline ? "Offline" : p.stuck ? "Jobs stuck" : "Ready",
        isDefault: !!p.isDefault,
        host: p.host ?? null,
        port: p.port ?? null,
        model: net?.txt.ty ?? p.driver ?? null,
        location: p.location || net?.txt.note || null,
        color: net?.txt.color ? net.txt.color === "T" : null,
        ippUrl: null,
        adminUrl: net?.txt.adminurl ?? (p.host ? `http://${p.host}` : null),
        jobs: p.jobs ?? 0,
        managedByIt: p.type === "Connection" || /^\\\\/.test(p.name) || (managed && /UPPort|Universal/i.test(p.port ?? "")),
        problem: moved ? `The printer moved to ${moved.ip ?? moved.host}, but Windows still looks for it at ${p.host}.` : offline ? "Windows can't reach this printer." : p.stuck ? `${p.stuck} job${p.stuck > 1 ? "s are" : " is"} stuck in the queue.` : null,
      });
    }
    // Printers on the network that aren't added yet. Prefer the IPP announcement for each device.
    const seen = new Set(out.map((p) => (p.host ?? "").toLowerCase()));
    const byDevice = new Map<string, Found>();
    for (const f of found) {
      const id = (f.ip ?? f.host ?? f.instance).toLowerCase();
      const cur = byDevice.get(id);
      if (!cur || (f.ipp && !cur.ipp) || (f.secure && !cur.secure)) byDevice.set(id, { ...f, txt: { ...(cur?.txt ?? {}), ...f.txt } });
    }
    for (const [id, f] of byDevice) {
      if (seen.has(id) || (f.host && seen.has(f.host.toLowerCase()))) continue;
      const name = f.instance.split("._")[0].replace(/\\032/g, " ");
      const addr = f.host?.replace(/\.$/, "") ?? f.ip;
      const rp = (f.txt.rp ?? "ipp/print").replace(/^\//, "");
      out.push({
        key: `net|${id}`,
        name,
        installed: false,
        status: "On the network",
        isDefault: false,
        host: addr,
        port: null,
        model: f.txt.ty ?? f.txt.product?.replace(/[()]/g, "") ?? null,
        location: f.txt.note || null,
        color: f.txt.color ? f.txt.color === "T" : null,
        ippUrl: f.ipp && addr ? `${f.secure ? "https" : "http"}://${addr}:${f.port}/${rp}` : null,
        adminUrl: f.txt.adminurl ?? (addr ? `http://${addr}` : null),
        jobs: 0,
        managedByIt: false,
        problem: f.ipp ? null : "This printer doesn't offer driverless printing; it needs its maker's driver.",
      });
    }
    this.list = out.sort((a, b) => Number(b.installed) - Number(a.installed) || (a.location ?? "~").localeCompare(b.location ?? "~") || a.name.localeCompare(b.name));
    this.lastScan = Date.now();
    return this.list;
  }

  private get(key: string) {
    const p = this.list.find((x) => x.key === key);
    if (!p) throw new Error("Refresh the printer list first.");
    return p;
  }

  async add(key: string): Promise<{ ok: boolean; message: string }> {
    const p = this.get(key);
    if (p.installed) return { ok: true, message: `${p.name} is already added.` };
    if (!p.ippUrl) {
      return { ok: false, message: `${p.name} needs its maker's driver. Search for "${p.model ?? p.name} driver" on the maker's website.` };
    }
    // Windows discovers the printer at that address and picks its built-in IPP class driver.
    const out = await runPs(`try { Add-Printer -Name ${psq(p.name)} -IppURL ${psq(p.ippUrl)} -ErrorAction Stop; 'ok' } catch { $_.Exception.Message }`, 120_000).catch((e) => String(e));
    if (out.trim() !== "ok") return { ok: false, message: `Windows couldn't add it: ${out.trim().slice(0, 200)}` };
    history.record(`Added printer ${p.name}`, "you");
    this.lastScan = 0;
    return { ok: true, message: `${p.name} is added. Try printing a page with Identify to make sure it's the right one.` };
  }

  /** Print one page with the printer's name in huge letters, so you can walk over and check. */
  async identify(key: string): Promise<{ ok: boolean; message: string }> {
    const p = this.get(key);
    if (!p.installed) return { ok: false, message: "Add the printer first, then print the identify page." };
    const title = p.name.replace(/'/g, "''");
    const sub = `${p.location ?? ""}  ${p.host ?? ""}  Printed by Rigmind`.replace(/'/g, "''");
    const out = await runPs(String.raw`
Add-Type -AssemblyName System.Drawing
$doc=New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName='${title}'
if(-not $doc.PrinterSettings.IsValid){ 'invalid'; return }
$doc.DocumentName='Rigmind printer check'
$doc.add_PrintPage({ param($s,$e)
  $big=New-Object System.Drawing.Font('Segoe UI',54,[System.Drawing.FontStyle]::Bold)
  $small=New-Object System.Drawing.Font('Segoe UI',16)
  $r=$e.MarginBounds
  $e.Graphics.DrawString('${title}',$big,[System.Drawing.Brushes]::Black,[System.Drawing.RectangleF]::new($r.X,$r.Y+120,$r.Width,600))
  $e.Graphics.DrawString('${sub}',$small,[System.Drawing.Brushes]::Black,[System.Drawing.PointF]::new($r.X,$r.Bottom-60))
})
$doc.Print(); 'ok'`, 60_000).catch((e) => String(e));
    return out.trim().endsWith("ok") ? { ok: true, message: `Sent a page to ${p.name}. Its name is printed in big letters.` } : { ok: false, message: "Windows couldn't print to it. Check it's on and connected." };
  }

  async fix(key: string, fix: "queue" | "default" | "port" | "remove"): Promise<{ ok: boolean; message: string }> {
    const p = this.get(key);
    if (p.managedByIt && fix !== "queue" && fix !== "default") return { ok: false, message: "Your company's IT manages this printer, so Rigmind won't change it." };
    const n = psq(p.name);
    if (fix === "queue") {
      const out = await runPs(`Get-PrintJob -PrinterName ${n} -ErrorAction SilentlyContinue | Remove-PrintJob -ErrorAction SilentlyContinue
if(@(Get-PrintJob -PrinterName ${n} -ErrorAction SilentlyContinue).Count){
  Stop-Service Spooler -Force; Get-ChildItem "$env:windir\\System32\\spool\\PRINTERS" -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue; Start-Service Spooler; 'restarted'
} else { 'cleared' }`, 60_000);
      this.lastScan = 0;
      return { ok: true, message: out.trim() === "restarted" ? "Cleared the stuck jobs and restarted the print service." : "Cleared the stuck jobs." };
    }
    if (fix === "default") {
      const prev = this.list.find((x) => x.isDefault);
      // Stop Windows from switching the default to whatever printer was used last.
      await runPs(`Set-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows' -Name LegacyDefaultPrinterMode -Value 1 -Type DWord; (Get-CimInstance Win32_Printer -Filter ${psq(`Name='${p.name.replace(/'/g, "''")}'`)}) | Invoke-CimMethod -MethodName SetDefaultPrinter | Out-Null`);
      history.record(`Set ${p.name} as the default printer`, "you", prev ? { type: "printer-default", data: { name: prev.name } } : null);
      this.lastScan = 0;
      return { ok: true, message: `${p.name} is now your default printer, and Windows won't keep changing it.` };
    }
    if (fix === "port") {
      const target = this.list.find((x) => !x.installed && x.name === p.name) ?? null;
      const m = p.problem?.match(/moved to (\S+),/);
      const addr = target?.host ?? m?.[1];
      if (!addr) return { ok: false, message: "Rigmind can't see this printer on the network right now. Check it's on." };
      const port = `Rigmind_${addr}`;
      await runPs(`if(-not (Get-PrinterPort -Name ${psq(port)} -ErrorAction SilentlyContinue)){ Add-PrinterPort -Name ${psq(port)} -PrinterHostAddress ${psq(addr)} }; Set-Printer -Name ${n} -PortName ${psq(port)}`);
      history.record(`Pointed ${p.name} at its new address ${addr}`, "you");
      this.lastScan = 0;
      return { ok: true, message: `${p.name} now prints to ${addr}.` };
    }
    await runPs(`Remove-Printer -Name ${n}`);
    history.record(`Removed printer ${p.name}`, "you");
    this.lastScan = 0;
    return { ok: true, message: `Removed ${p.name}.` };
  }
}

export const printers = new PrinterFinder();
