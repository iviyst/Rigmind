// Security center: Microsoft Defender control plus a lightweight intrusion watch.
// Malware detection uses Defender's engine; Rigmind adds clear status, scheduling around games,
// and Claude's explanations. The intrusion watch compares snapshots of listening apps, services,
// scheduled tasks, admin accounts and devices on your network, and reads Windows' failed-login log.
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { dataDir, load } from "./store";
import { runPs, runPsJson, psq } from "./ps";
import { history } from "./history";
import { boost } from "./boost";
import type { ChangeEntry, DefenderStatus, LanDevice, Listener, SecurityAlert, SecurityState, Threat } from "../shared/types";

const file = () => join(dataDir("security"), "state.json");

interface Persist {
  baselineDone: boolean;
  listeners: Record<string, number>; // key -> firstSeen
  services: Record<string, string>; // name -> path
  tasks: Record<string, string>; // path -> action
  admins: string[];
  devices: Record<string, LanDevice>; // mac -> device
  alerts: SecurityAlert[];
  lastLoginCheck: number;
  lastCheck: number | null;
}

const DEFENDER = String.raw`
$ErrorActionPreference='SilentlyContinue'
$s=Get-MpComputerStatus
$av=@(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | Where-Object { $_.displayName -notmatch 'Defender' -and ((($_.productState -shr 12) -band 0xF) -eq 1) } | Select-Object -ExpandProperty displayName)
$det=@{}; foreach($d in Get-MpThreatDetection){ $det[[string]$d.ThreatID]=$d }
$sev=@{0='Unknown';1='Low';2='Moderate';4='High';5='Severe'}
$st=@{0='Unknown';1='Detected';2='Cleaned';3='Quarantined';4='Removed';5='Allowed';6='Blocked';102='Quarantine failed';103='Remove failed';104='Allow failed';105='Abandoned';107='Block failed'}
$threats=@(foreach($t in Get-MpThreat){ $d=$det[[string]$t.ThreatID]; [ordered]@{
  id=[string]$t.ThreatID; name=$t.ThreatName; severity=$sev[[int]$t.SeverityID]
  status=$(if($d){$st[[int]$d.ThreatStatusID]}else{ if($t.IsActive){'Active'}else{'Inactive'} })
  resources=@($t.Resources | Select-Object -First 5)
  detected=$(if($d -and $d.InitialDetectionTime){$d.InitialDetectionTime.ToString('o')}else{$null}) } })
[ordered]@{
  defender=$(if($s){[ordered]@{available=$true;realTime=[bool]$s.RealTimeProtectionEnabled;tamperProtection=$s.IsTamperProtected
    signatureAgeDays=$s.AntivirusSignatureAge;signatureVersion=$s.AntivirusSignatureVersion
    lastQuickScan=$(if($s.QuickScanEndTime){$s.QuickScanEndTime.ToString('o')}else{$null})
    lastFullScan=$(if($s.FullScanEndTime){$s.FullScanEndTime.ToString('o')}else{$null})
    scanning=$false;thirdPartyAv=$(if($av.Count){$av -join ', '}else{$null})}}else{$null})
  threats=$threats
} | ConvertTo-Json -Depth 5 -Compress`;

const WATCH = (sinceMs: number) => String.raw`
$ErrorActionPreference='SilentlyContinue'
$procs=@{}; foreach($p in Get-Process){ $procs[$p.Id]=$p }
function L($proto,$addr,$port,$procId){
  if($addr -match '^(127\.|::1$)'){ return $null }
  $p=$procs[[int]$procId]
  [ordered]@{process=$(if($p){$p.ProcessName}else{"PID $procId"});pid=[int]$procId;port=[int]$port;protocol=$proto;address=$addr;path=$(if($p){$p.Path}else{$null})}
}
$listen=@()
foreach($c in Get-NetTCPConnection -State Listen){ $x=L 'TCP' $c.LocalAddress $c.LocalPort $c.OwningProcess; if($x){$listen+=$x} }
foreach($c in Get-NetUDPEndpoint){ if($c.LocalPort -lt 49152 -or $c.LocalAddress -eq '0.0.0.0'){ $x=L 'UDP' $c.LocalAddress $c.LocalPort $c.OwningProcess; if($x){$listen+=$x} } }
$services=@(Get-CimInstance Win32_Service | ForEach-Object { [ordered]@{name=$_.Name;path=$_.PathName;start=$_.StartMode} })
$tasks=@(Get-ScheduledTask | Where-Object { $_.TaskPath -notmatch '^\\Microsoft\\' } | ForEach-Object { [ordered]@{path=($_.TaskPath+$_.TaskName);action=(($_.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join '; ')} })
$admins=@(Get-LocalGroupMember -SID 'S-1-5-32-544' | ForEach-Object { $_.Name })
$start=[DateTimeOffset]::FromUnixTimeMilliseconds(${sinceMs}).LocalDateTime
$fails=@(Get-WinEvent -FilterHashtable @{LogName='Security';Id=4625;StartTime=$start} -MaxEvents 500 | ForEach-Object { $x=[xml]$_.ToXml(); $d=@{}; foreach($n in $x.Event.EventData.Data){ $d[$n.Name]="$($n.'#text')" }; [ordered]@{t=[int64]([DateTimeOffset]$_.TimeCreated).ToUnixTimeMilliseconds();user=$d['TargetUserName'];ip=$d['IpAddress'];type=$d['LogonType']} })
$rdp=((Get-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server').fDenyTSConnections -eq 0)
$fw=@(Get-NetFirewallProfile | ForEach-Object { [ordered]@{name=$_.Name;enabled=[bool]$_.Enabled} })
$shares=@(Get-SmbShare | Where-Object { $_.Name -notmatch '\$$' } | Select-Object -ExpandProperty Name)
$smb1=(Get-SmbServerConfiguration).EnableSMB1Protocol
$guest=(Get-LocalUser -Name 'Guest').Enabled
$netprof=@(Get-NetConnectionProfile | ForEach-Object { [ordered]@{name=$_.Name;category="$($_.NetworkCategory)"} })
$neigh=@(Get-NetNeighbor -AddressFamily IPv4 -State Reachable,Stale,Delay,Probe | Where-Object { $_.LinkLayerAddress -and $_.LinkLayerAddress -notmatch '^(00-00-00-00-00-00|FF-FF-FF-FF-FF-FF|01-00-5E)' -and $_.IPAddress -notmatch '^(224\.|239\.|255\.|169\.254\.)' -and $_.IPAddress -notmatch '\.255$' } | ForEach-Object { [ordered]@{ip=$_.IPAddress;mac=$_.LinkLayerAddress} })
[ordered]@{listen=$listen;services=$services;tasks=$tasks;admins=$admins;fails=$fails;rdp=$rdp;fw=$fw;shares=$shares;smb1=$smb1;guest=$guest;netprof=$netprof;neigh=$neigh} | ConvertTo-Json -Depth 5 -Compress`;

// Ping every address on the local /24 so the neighbor table fills with all devices.
const SWEEP = String.raw`
$ErrorActionPreference='SilentlyContinue'
$ip=(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.PrefixOrigin -in 'Dhcp','Manual' -and $_.IPAddress -notmatch '^169\.254' } | Select-Object -First 1).IPAddress
if(-not $ip){ 'none'; exit }
$base=($ip -split '\.')[0..2] -join '.'
$tasks=@(1..254 | ForEach-Object { (New-Object System.Net.NetworkInformation.Ping).SendPingAsync("$base.$_",400) })
try { [Threading.Tasks.Task]::WaitAll($tasks) } catch {}
'done'`;

class SecurityCenter extends EventEmitter {
  private p: Persist | null = null;
  private defender: DefenderStatus | null = null;
  private threats: Threat[] = [];
  private netListeners: Listener[] = [];
  private exposure: SecurityState["exposure"] = [];
  private scanning = false;
  private pendingScan: "QuickScan" | "FullScan" | null = null;

  private persist(): Persist {
    if (this.p) return this.p;
    try {
      this.p = existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : null;
    } catch {
      this.p = null;
    }
    this.p ??= { baselineDone: false, listeners: {}, services: {}, tasks: {}, admins: [], devices: {}, alerts: [], lastLoginCheck: Date.now() - 86_400_000, lastCheck: null };
    return this.p;
  }
  private save() {
    const p = this.persist();
    p.alerts = p.alerts.slice(0, 200);
    writeFileSync(file(), JSON.stringify(p));
    this.emit("state", this.state());
  }

  init() {
    setTimeout(() => void this.check(), 20_000);
    setInterval(() => load().extras.security.watch && void this.check(), 5 * 60_000);
    setInterval(() => load().extras.security.watch && void this.sweep(), 30 * 60_000);
    boost.on("ended", () => {
      if (this.pendingScan) {
        const t = this.pendingScan;
        this.pendingScan = null;
        void this.scan(t);
      }
    });
  }

  private alert(kind: SecurityAlert["kind"], severity: SecurityAlert["severity"], title: string, detail: string) {
    const a: SecurityAlert = { id: randomUUID(), t: Date.now(), kind, severity, title, detail, dismissed: false, triage: null };
    this.persist().alerts.unshift(a);
    this.emit("alert", a);
  }

  async refreshDefender() {
    const r = await runPsJson<{ defender: DefenderStatus | null; threats: Threat[] }>(DEFENDER, 60_000).catch(() => null);
    this.defender = r?.defender ? { ...r.defender, scanning: this.scanning } : { available: false, realTime: false, tamperProtection: null, signatureAgeDays: null, signatureVersion: null, lastQuickScan: null, lastFullScan: null, scanning: false, thirdPartyAv: null };
    const before = new Set(this.threats.map((t) => t.id + t.status));
    this.threats = r?.threats ?? [];
    for (const t of this.threats) if (!before.has(t.id + t.status) && /Active|Detected|failed/i.test(t.status) && before.size) this.alert("threat", "high", `Threat found: ${t.name}`, `${t.severity} severity, ${t.status}. ${t.resources.join(", ")}`);
  }

  async check() {
    await this.refreshDefender();
    const p = this.persist();
    const w = await runPsJson<any>(WATCH(p.lastLoginCheck), 120_000).catch(() => null);
    if (!w) return this.state();
    const first = !p.baselineDone;
    const cfg = load().extras.security;

    // Apps accepting connections from the network.
    const now = Date.now();
    const seenKeys = new Set<string>();
    this.netListeners = (w.listen ?? []).map((l: any) => {
      const key = `${(l.process || "").toLowerCase()}|${l.protocol}|${l.port}`;
      seenKeys.add(key);
      if (!p.listeners[key]) {
        p.listeners[key] = now;
        if (!first && cfg.alertNewListeners && l.address !== "::" && !/^(svchost|System|lsass|wininit|services|spoolsv)$/i.test(l.process))
          this.alert("new_listener", "warn", `${l.process} started accepting network connections`, `${l.protocol} port ${l.port} on ${l.address === "0.0.0.0" ? "all networks" : l.address}${l.path ? `\n${l.path}` : ""}`);
      }
      const firstSeen = p.listeners[key];
      return { ...l, signer: null, firstSeen, isNew: !first && now - firstSeen < 86_400_000 } as Listener;
    });

    // Persistence: new services, scheduled tasks, admin accounts.
    for (const s of w.services ?? []) {
      if (!p.services[s.name]) {
        if (!first) this.alert("new_service", s.start === "Auto" ? "high" : "warn", `New Windows service: ${s.name}`, `${s.path ?? ""}\nStarts: ${s.start}`);
        p.services[s.name] = s.path ?? "";
      }
    }
    for (const t of w.tasks ?? []) {
      if (!p.tasks[t.path]) {
        if (!first) this.alert("new_task", "warn", `New scheduled task: ${t.path}`, t.action);
        p.tasks[t.path] = t.action;
      }
    }
    for (const a of w.admins ?? []) if (!p.admins.includes(a)) {
      if (!first) this.alert("new_admin", "high", `New administrator account: ${a}`, "An account was added to the Administrators group.");
      p.admins.push(a);
    }

    // Failed logins: many in a short time usually means someone is guessing passwords.
    const fails: { t: number; user: string; ip: string; type: string }[] = w.fails ?? [];
    if (fails.length >= 10) {
      const ips = [...new Set(fails.map((f) => f.ip).filter((x) => x && x !== "-"))];
      const remote = fails.some((f) => f.type === "10" || f.type === "3");
      this.alert("failed_logins", remote ? "high" : "warn", `${fails.length} failed Windows sign-ins`, `${remote ? "Over the network" : "On this PC"}${ips.length ? ` from ${ips.slice(0, 5).join(", ")}` : ""}. Accounts tried: ${[...new Set(fails.map((f) => f.user))].slice(0, 5).join(", ")}`);
    }
    p.lastLoginCheck = now;

    // Exposure checklist.
    const fwOff = (w.fw ?? []).filter((f: any) => !f.enabled).map((f: any) => f.name);
    const publicNets = (w.netprof ?? []).filter((n: any) => n.category === "Public").map((n: any) => n.name);
    this.exposure = [
      { item: "Firewall", ok: fwOff.length === 0, detail: fwOff.length ? `Off for: ${fwOff.join(", ")}` : "On for every network type" },
      { item: "Remote Desktop", ok: !w.rdp, detail: w.rdp ? "On. Anyone who can reach this PC can try to sign in. Turn it off unless you use it." : "Off" },
      { item: "Shared folders", ok: !(w.shares ?? []).length, detail: (w.shares ?? []).length ? `Shared: ${(w.shares ?? []).join(", ")}` : "None shared" },
      { item: "SMBv1 (old file sharing)", ok: !w.smb1, detail: w.smb1 ? "On. SMBv1 is outdated and was used by WannaCry. Turn it off." : "Off" },
      { item: "Guest account", ok: !w.guest, detail: w.guest ? "On" : "Off" },
      { item: "Network type", ok: true, detail: publicNets.length ? `${publicNets.join(", ")} set to Public (safest)` : "Private (normal for home)" },
    ];
    for (const e of this.exposure) if (!e.ok && !first && !p.alerts.some((a) => a.kind === "exposure" && a.title.startsWith(e.item) && !a.dismissed))
      this.alert("exposure", e.item === "Remote Desktop" || e.item === "Firewall" ? "high" : "warn", `${e.item}: needs attention`, e.detail);

    // Devices on your network.
    this.mergeDevices(w.neigh ?? [], first);

    p.baselineDone = true;
    p.lastCheck = now;
    this.save();
    return this.state();
  }

  private mergeDevices(neigh: { ip: string; mac: string }[], first: boolean) {
    const p = this.persist();
    const now = Date.now();
    for (const n of neigh) {
      const d = p.devices[n.mac];
      if (d) {
        d.lastSeen = now;
        d.ip = n.ip;
      } else {
        p.devices[n.mac] = { ip: n.ip, mac: n.mac, vendorHint: null, firstSeen: now, lastSeen: now, isNew: !first, name: null };
        if (!first && load().extras.security.alertNewDevices) this.alert("new_device", "info", `New device on your network: ${n.ip}`, `Hardware address ${n.mac}. If you don't recognize it, check your router's device list.`);
      }
    }
    for (const d of Object.values(p.devices)) d.isNew = now - d.firstSeen < 86_400_000 && d.firstSeen !== d.lastSeen && p.baselineDone;
  }

  async sweep() {
    await runPs(SWEEP, 30_000).catch(() => "");
    return this.check();
  }

  async scan(type: "QuickScan" | "FullScan" | "CustomScan", path?: string): Promise<{ ok: boolean; message: string }> {
    if (this.scanning) return { ok: false, message: "A scan is already running." };
    if (boost.state.active && type === "FullScan") {
      this.pendingScan = type;
      return { ok: true, message: "You're playing, so the full scan will start when the game closes." };
    }
    this.scanning = true;
    if (this.defender) this.defender.scanning = true;
    this.emit("state", this.state());
    try {
      await runPs(`Start-MpScan -ScanType ${type}${path ? ` -ScanPath ${psq(path)}` : ""}`, 6 * 3600_000);
    } finally {
      this.scanning = false;
    }
    await this.refreshDefender();
    this.save();
    const active = this.threats.filter((t) => /Active|Detected/i.test(t.status)).length;
    return { ok: true, message: active ? `Scan finished: ${active} threat(s) need attention.` : "Scan finished. No active threats." };
  }

  async offlineScan(): Promise<{ ok: boolean; message: string }> {
    await runPs("Start-MpWDOScan");
    return { ok: true, message: "Windows will restart and scan before it loads. Save your work." };
  }

  async updateSignatures(): Promise<{ ok: boolean; message: string }> {
    await runPs("Update-MpSignature", 600_000);
    await this.refreshDefender();
    this.save();
    return { ok: true, message: `Threat definitions updated${this.defender?.signatureVersion ? ` to ${this.defender.signatureVersion}` : ""}.` };
  }

  async threatAction(id: string, action: "remove" | "allow" | "restore"): Promise<{ ok: boolean; message: string }> {
    const t = this.threats.find((x) => x.id === id);
    if (!t) return { ok: false, message: "Threat not found." };
    if (action === "remove") await runPs(`Remove-MpThreat`);
    else if (action === "allow") await runPs(`Add-MpPreference -ThreatIDDefaultAction_Ids ${Number(id)} -ThreatIDDefaultAction_Actions Allow`);
    else await runPs(`& "$env:ProgramFiles\\Windows Defender\\MpCmdRun.exe" -Restore -Name ${psq(t.name)}`);
    history.record(`${action === "remove" ? "Removed" : action === "allow" ? "Allowed" : "Restored"} threat ${t.name}`, "you", null);
    await this.refreshDefender();
    this.save();
    return { ok: true, message: action === "remove" ? "Active threats removed." : action === "allow" ? `${t.name} is now allowed. Only do this if you're sure it's safe.` : `${t.name} was restored from quarantine.` };
  }

  async blockApp(path: string, source: ChangeEntry["source"]): Promise<{ ok: boolean; message: string }> {
    if (!path || !existsSync(path)) return { ok: false, message: "App file not found." };
    if (/\\Windows\\/i.test(path)) return { ok: false, message: "Rigmind won't block Windows components; that can break networking." };
    const name = `Rigmind block: ${basename(path)}`;
    await runPs(`New-NetFirewallRule -DisplayName ${psq(name)} -Direction Inbound -Program ${psq(path)} -Action Block | Out-Null
New-NetFirewallRule -DisplayName ${psq(name)} -Direction Outbound -Program ${psq(path)} -Action Block | Out-Null`);
    history.record(`Blocked ${basename(path)} in the firewall`, source, { type: "fw_block", data: { name } });
    return { ok: true, message: `${basename(path)} can no longer use the network. Undo it from the change history.` };
  }

  dismiss(id: string) {
    const a = this.persist().alerts.find((x) => x.id === id);
    if (a) a.dismissed = true;
    this.save();
  }
  setTriage(id: string, text: string) {
    const a = this.persist().alerts.find((x) => x.id === id);
    if (a) a.triage = text;
    this.save();
  }
  renameDevice(mac: string, name: string) {
    const d = this.persist().devices[mac];
    if (d) d.name = name.trim() || null;
    this.save();
  }
  getAlert(id: string) {
    return this.persist().alerts.find((x) => x.id === id) ?? null;
  }

  state(): SecurityState {
    const p = this.persist();
    return {
      defender: this.defender,
      threats: this.threats,
      listeners: this.netListeners,
      devices: Object.values(p.devices).sort((a, b) => b.lastSeen - a.lastSeen),
      exposure: this.exposure,
      alerts: p.alerts,
      lastCheck: p.lastCheck,
    };
  }
}

history.registerUndo("fw_block", async (d) => {
  await runPs(`Remove-NetFirewallRule -DisplayName ${psq(d.name)}`);
  return "Firewall block removed.";
});

export const security = new SecurityCenter();
