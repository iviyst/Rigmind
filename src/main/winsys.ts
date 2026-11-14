// Windows system operations used by Game Boost and the AI assistant's actions.
import { runPs, runPsJson, psq } from "./ps";
import type { SystemInfo } from "../shared/types";

export const HIGH_PERF = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";
export const BALANCED = "381b4222-f694-41f0-9685-ff5bb260df2e";

// Processes that must never be paused or ended.
export const PROTECTED = new Set(
  [
    "system", "idle", "registry", "smss", "csrss", "wininit", "winlogon", "services", "lsass", "svchost",
    "dwm", "explorer", "fontdrvhost", "audiodg", "spoolsv", "sihost", "ctfmon", "taskhostw", "runtimebroker",
    "msmpeng", "securityhealthservice", "nvcontainer", "nvdisplay.container", "amdrsserv", "atiesrxx", "atieclxx",
    "rigmind", "electron", "powershell", "presentmon", "conhost", "memory compression", "lghub", "steam",
    "easyanticheat", "beservice", "vgc", "vgtray", "faceitservice",
  ].map((s) => s.toLowerCase())
);
export const isProtected = (name: string) => PROTECTED.has(name.toLowerCase().replace(/\.exe$/, ""));

export async function getActivePowerScheme(): Promise<string | null> {
  const out = await runPs("powercfg /getactivescheme");
  return out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? null;
}

export async function setPowerScheme(guid: string): Promise<boolean> {
  const out = await runPs(String.raw`
powercfg /setactive ${guid} 2>$null
$a=(powercfg /getactivescheme) -join ' '
if($a -notmatch '${guid}' -and '${guid}' -eq '${HIGH_PERF}'){
  $d=(powercfg /duplicatescheme ${HIGH_PERF}) -join ' '
  if($d -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'){ powercfg /setactive $Matches[1] }
}
(powercfg /getactivescheme) -join ' '`);
  return out.includes(guid) || (guid === HIGH_PERF && /high performance/i.test(out));
}

export async function setPriority(pid: number, level: "High" | "Normal" | "AboveNormal") {
  await runPs(`(Get-Process -Id ${pid}).PriorityClass='${level}'`);
}

/** Set which logical processors a process may run on. Some anti-cheat blocks this. */
export async function runAffinity(pid: number, mask: bigint): Promise<boolean> {
  const out = await runPs(`try { (Get-Process -Id ${pid}).ProcessorAffinity=[IntPtr][Int64]${mask.toString()}; 'OK' } catch { 'FAIL' }`).catch(() => "FAIL");
  return out.includes("OK");
}

export async function enableGameDvr() {
  await runPs(`Set-ItemProperty 'HKCU:\\System\\GameConfigStore' GameDVR_Enabled 1 -Type DWord
Set-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR' AppCaptureEnabled 1 -Type DWord`);
}

const SUSPEND_TYPE = String.raw`
if (-not ('Rig.Proc' -as [type])) {
Add-Type -Namespace Rig -Name Proc -MemberDefinition @'
[DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
[DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
[DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(int a, bool i, int pid);
[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
'@
}
function Set-Suspended($procId, $suspend){
  $h=[Rig.Proc]::OpenProcess(0x0800, $false, $procId)
  if($h -eq [IntPtr]::Zero){ return $false }
  if($suspend){ [void][Rig.Proc]::NtSuspendProcess($h) } else { [void][Rig.Proc]::NtResumeProcess($h) }
  [void][Rig.Proc]::CloseHandle($h); return $true
}`;

/** Pause every running process whose name is in the list. Returns what was paused. */
export async function suspendByName(names: string[]): Promise<{ pid: number; name: string }[]> {
  const safe = names.map((n) => n.replace(/\.exe$/i, "")).filter((n) => n && !isProtected(n));
  if (!safe.length) return [];
  const list = safe.map(psq).join(",");
  return runPsJson<{ pid: number; name: string }[]>(`${SUSPEND_TYPE}
$out=@()
foreach($p in Get-Process -Name @(${list}) -ErrorAction SilentlyContinue){
  if(Set-Suspended $p.Id $true){ $out+=[ordered]@{pid=$p.Id;name=$p.ProcessName} }
}
ConvertTo-Json -InputObject @($out) -Compress`).catch(() => []);
}

export async function resumePids(pids: number[]) {
  if (!pids.length) return;
  await runPs(`${SUSPEND_TYPE}
foreach($i in @(${pids.join(",")})){ [void](Set-Suspended $i $false) }`);
}

export async function endProcess(target: string): Promise<string> {
  const isPid = /^\d+$/.test(target);
  const name = target.replace(/\.exe$/i, "");
  if (!isPid && isProtected(name)) return `${name} is a Windows or security process and can't be ended.`;
  const out = await runPs(
    isPid
      ? `$p=Get-Process -Id ${target}; if($p){ Stop-Process -Id ${target} -Force; "Ended " + $p.ProcessName } else { "Not running" }`
      : `$p=Get-Process -Name ${psq(name)} -ErrorAction SilentlyContinue; if($p){ $p | Stop-Process -Force; "Ended " + @($p).Count + " process(es) named ${name.replace(/"/g, "")}" } else { "Not running" }`
  );
  return out.trim();
}

export async function enableGameMode() {
  await runPs(`New-Item -Path 'HKCU:\\Software\\Microsoft\\GameBar' -Force | Out-Null
Set-ItemProperty 'HKCU:\\Software\\Microsoft\\GameBar' AutoGameModeEnabled 1 -Type DWord
Set-ItemProperty 'HKCU:\\Software\\Microsoft\\GameBar' AllowAutoGameMode 1 -Type DWord`);
}

export async function disableGameDvr() {
  await runPs(`New-Item -Path 'HKCU:\\System\\GameConfigStore' -Force | Out-Null
Set-ItemProperty 'HKCU:\\System\\GameConfigStore' GameDVR_Enabled 0 -Type DWord
New-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR' -Force | Out-Null
Set-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR' AppCaptureEnabled 0 -Type DWord`);
}

export async function enableGpuScheduling() {
  await runPs(`Set-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' HwSchMode 2 -Type DWord`);
}

export async function clearTempFiles(): Promise<string> {
  const out = await runPs(String.raw`
function MB($p){ $s=(Get-ChildItem $p -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum; if($s){[math]::Round($s/1MB)}else{0} }
$b=(MB $env:TEMP)+(MB "$env:windir\Temp")
Get-ChildItem $env:TEMP -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem "$env:windir\Temp" -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
$a=(MB $env:TEMP)+(MB "$env:windir\Temp")
"Freed $($b-$a) MB of temp files"`);
  return out.trim();
}

export const SETTINGS_PAGES: Record<string, string> = {
  graphics: "ms-settings:display-advancedgraphics",
  display: "ms-settings:display-advanced",
  startup: "ms-settings:startupapps",
  power: "ms-settings:powersleep",
  gamemode: "ms-settings:gaming-gamemode",
  storage: "ms-settings:storagesense",
  windowsupdate: "ms-settings:windowsupdate",
};

let sysCache: SystemInfo | null = null;
export async function getSystemInfo(refresh = false): Promise<SystemInfo> {
  if (sysCache && !refresh) return sysCache;
  sysCache = await runPsJson<SystemInfo>(String.raw`
$ErrorActionPreference='SilentlyContinue'
$os=Get-CimInstance Win32_OperatingSystem; $cpu=Get-CimInstance Win32_Processor | Select-Object -First 1
$cs=Get-CimInstance Win32_ComputerSystem; $bb=Get-CimInstance Win32_BaseBoard; $bios=Get-CimInstance Win32_BIOS
$sticks=@(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { "$([math]::Round($_.Capacity/1GB)) GB @ $(if($_.ConfiguredClockSpeed){$_.ConfiguredClockSpeed}else{$_.Speed}) MT/s (rated $($_.Speed)) $($_.Manufacturer) $($_.PartNumber)".Trim() })
$gpus=@(Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.Name) - driver $($_.DriverVersion)" })
$disks=@(Get-PhysicalDisk | ForEach-Object { "$($_.FriendlyName) $($_.MediaType) $($_.BusType) $([math]::Round($_.Size/1GB)) GB fw $($_.FirmwareVersion) health $($_.HealthStatus)" })
$vols=@(Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Fixed' -and $_.Size } | ForEach-Object { "$($_.DriveLetter): $([math]::Round($_.SizeRemaining/1GB)) GB free of $([math]::Round($_.Size/1GB)) GB" })
$plan=((powercfg /getactivescheme) -join ' ') -replace '^.*\((.*)\).*$','$1'
$gm=(Get-ItemProperty 'HKCU:\Software\Microsoft\GameBar').AutoGameModeEnabled
$dvr=(Get-ItemProperty 'HKCU:\System\GameConfigStore').GameDVR_Enabled
$hags=(Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers').HwSchMode
$disp=@(Get-CimInstance Win32_VideoController | Where-Object { $_.CurrentRefreshRate } | ForEach-Object { "$($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution) @ $($_.CurrentRefreshRate) Hz on $($_.Name)" })
[ordered]@{
  os="$($os.Caption) build $($os.BuildNumber)"; cpu=$cpu.Name.Trim(); cores=$cpu.NumberOfCores; threads=$cpu.NumberOfLogicalProcessors
  ramGB=[math]::Round($cs.TotalPhysicalMemory/1GB,1); ramSticks=$sticks; gpus=$gpus
  board="$($bb.Manufacturer) $($bb.Product)"; bios="$($bios.SMBIOSBIOSVersion) ($($bios.ReleaseDate.ToString('yyyy-MM-dd')))"
  disks=@($disks+$vols); powerPlan=$plan; gameMode=($gm -ne 0); gameDvr=($dvr -ne 0); gpuScheduling=($hags -eq 2); displays=$disp
} | ConvertTo-Json -Compress -Depth 3`);
  return sysCache;
}
