// Live hardware telemetry: one long-running PowerShell sampler (perf counters,
// processes, optional LibreHardwareMonitor temps) plus nvidia-smi for NVIDIA cards.
import { EventEmitter } from "node:events";
import { spawn, ChildProcess } from "node:child_process";
import { streamPs } from "./ps";
import { hw } from "./hw";
import type { Telemetry, ProcInfo, GpuStats, FpsStats } from "../shared/types";

const SAMPLER = String.raw`
$ErrorActionPreference='SilentlyContinue'
$cores=[Environment]::ProcessorCount
$baseMHz=[double]((Get-CimInstance Win32_Processor | Select-Object -First 1).MaxClockSpeed)
$totalMB=[double]((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1MB)
$gpuName=(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Microsoft|Virtual|Parsec|Remote' } | Sort-Object AdapterRAM -Descending | Select-Object -First 1).Name
$counters=@(
 '\Processor Information(_Total)\% Processor Utility',
 '\Processor Information(_Total)\% Processor Performance',
 '\Memory\Available MBytes',
 '\PhysicalDisk(_Total)\Disk Read Bytes/sec',
 '\PhysicalDisk(_Total)\Disk Write Bytes/sec',
 '\Network Interface(*)\Bytes Received/sec',
 '\Network Interface(*)\Bytes Sent/sec',
 '\GPU Engine(*engtype_3D)\Utilization Percentage',
 '\GPU Adapter Memory(*)\Dedicated Usage')
$hasLhm = $null -ne (Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Hardware | Select-Object -First 1)
$prev=@{}; $prevT=Get-Date; $i=0
function Sum($pat){ $v=($script:samples | Where-Object { $_.Path -like $pat } | Measure-Object CookedValue -Sum).Sum; if($v){[double]$v}else{0} }
while($true){
  $script:samples=(Get-Counter -Counter $counters -SampleInterval 1 -MaxSamples 1).CounterSamples
  $gpuGroups=@{}
  foreach($s in $samples){
    if($s.Path -like '*gpu engine*' -and $s.InstanceName -match 'luid_(0x[0-9a-f]+_0x[0-9a-f]+)'){
      $k=$Matches[1]; $gpuGroups[$k]=[double]$gpuGroups[$k]+$s.CookedValue
    }
  }
  $gpuLoad=$null; if($gpuGroups.Count){ $gpuLoad=[math]::Min(100,[math]::Round(($gpuGroups.Values | Measure-Object -Maximum).Maximum,1)) }
  $vram=($samples | Where-Object { $_.Path -like '*dedicated usage' } | Measure-Object CookedValue -Maximum).Maximum
  $cpuTemp=$null; $gpuTemp=$null
  if($hasLhm -and ($i % 2 -eq 0)){
    $sens=Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -Filter "SensorType='Temperature'"
    $c=$sens | Where-Object { $_.Identifier -match 'cpu' -and $_.Name -match 'Package|Tctl|Tdie' } | Select-Object -First 1
    if($c){ $cpuTemp=[math]::Round($c.Value) }
    $g=$sens | Where-Object { $_.Identifier -match 'gpu' -and $_.Name -match 'GPU Core' } | Select-Object -First 1
    if($g){ $gpuTemp=[math]::Round($g.Value) }
  }
  $o=[ordered]@{
    type='sample'
    cpu=[math]::Min(100,[math]::Round((Sum '*% processor utility'),1))
    clock=$(if($baseMHz){[math]::Round($baseMHz*(Sum '*% processor performance')/100)}else{$null})
    cpuTemp=$cpuTemp; gpuTemp=$gpuTemp; gpuLoad=$gpuLoad; gpuName=$gpuName
    vramMB=$(if($vram){[math]::Round($vram/1MB)}else{$null})
    ramUsedMB=[math]::Round($totalMB-(Sum '*available mbytes'))
    ramTotalMB=[math]::Round($totalMB)
    rd=(Sum '*disk read bytes/sec'); wr=(Sum '*disk write bytes/sec')
    rx=(Sum '*bytes received/sec'); tx=(Sum '*bytes sent/sec')
    lhm=$hasLhm
  }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush()
  if($i % 3 -eq 0){
    $now=Get-Date; $dt=[math]::Max(0.5,($now-$prevT).TotalSeconds); $prevT=$now
    $cur=@{}; $list=New-Object System.Collections.ArrayList
    foreach($p in Get-Process){
      $c=[double]$p.CPU; $cur[$p.Id]=$c; $d=0
      if($prev.ContainsKey($p.Id)){ $d=($c-$prev[$p.Id])/$dt/$cores*100 }
      [void]$list.Add([ordered]@{pid=$p.Id;name=$p.ProcessName;path=$p.Path;cpu=[math]::Round([math]::Max(0,$d),1);memMB=[math]::Round($p.WorkingSet64/1MB)})
    }
    $prev=$cur
    [Console]::Out.WriteLine((@{type='procs';list=$list} | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush()
  }
  $i++
}
`;

class TelemetryService extends EventEmitter {
  history: Telemetry[] = [];
  procs: ProcInfo[] = [];
  nvidia: GpuStats | null = null;
  nvidiaAvailable = false;
  cpuTempSensor = false;
  fpsProvider: (() => FpsStats | null) | null = null;
  private sampler: ChildProcess | null = null;
  private smi: ChildProcess | null = null;
  private stopped = false;

  start() {
    this.stopped = false;
    this.startSampler();
    this.startNvidiaSmi();
  }

  stop() {
    this.stopped = true;
    this.sampler?.kill();
    this.smi?.kill();
  }

  latest(): Telemetry | null {
    return this.history[this.history.length - 1] ?? null;
  }

  private startSampler() {
    this.sampler = streamPs(
      SAMPLER,
      (o) => {
        if (o.type === "procs") {
          this.procs = (o.list as ProcInfo[]).filter((p) => p.pid > 4);
          this.emit("procs", this.procs);
        } else if (o.type === "sample") this.onSample(o);
      },
      () => {
        if (!this.stopped) setTimeout(() => this.startSampler(), 3000); // auto-restart
      }
    );
  }

  private startNvidiaSmi() {
    const fields = "name,utilization.gpu,temperature.gpu,memory.used,memory.total,clocks.gr,power.draw";
    try {
      const p = spawn("nvidia-smi", [`--query-gpu=${fields}`, "--format=csv,noheader,nounits", "-lms", "1000"], { windowsHide: true });
      this.smi = p;
      let buf = "";
      p.on("error", () => (this.nvidiaAvailable = false));
      p.stdout?.on("data", (d) => {
        buf += d.toString();
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? "";
        const line = lines.filter(Boolean).pop();
        if (!line) return;
        const [name, util, temp, used, total, clock, power] = line.split(",").map((s) => s.trim());
        const num = (s: string) => (isNaN(parseFloat(s)) ? null : parseFloat(s));
        this.nvidiaAvailable = true;
        this.nvidia = {
          name,
          load: num(util) ?? 0,
          temp: num(temp),
          vramUsedMB: num(used),
          vramTotalMB: num(total),
          clockMHz: num(clock),
          powerW: num(power),
        };
      });
      p.on("close", () => {
        this.smi = null;
      });
    } catch {
      this.nvidiaAvailable = false;
    }
  }

  private onSample(o: any) {
    this.cpuTempSensor = !!o.lhm;
    let gpu: GpuStats | null = null;
    if (this.nvidia) {
      gpu = { ...this.nvidia };
    } else if (o.gpuLoad != null || o.gpuName) {
      gpu = {
        name: o.gpuName ?? "GPU",
        load: o.gpuLoad ?? 0,
        temp: o.gpuTemp ?? null,
        vramUsedMB: o.vramMB ?? null,
        vramTotalMB: null,
        clockMHz: null,
        powerW: null,
      };
    }
    const t: Telemetry = {
      t: Date.now(),
      cpu: { load: o.cpu ?? 0, temp: o.cpuTemp ?? null, clockMHz: o.clock ?? null },
      gpu,
      ram: { usedGB: (o.ramUsedMB ?? 0) / 1024, totalGB: (o.ramTotalMB ?? 0) / 1024 },
      disk: { readMBs: (o.rd ?? 0) / 1048576, writeMBs: (o.wr ?? 0) / 1048576 },
      net: { downMbps: ((o.rx ?? 0) * 8) / 1e6, upMbps: ((o.tx ?? 0) * 8) / 1e6 },
      fps: this.fpsProvider?.() ?? null,
    };
    // Prefer Rigmind's own hardware helper for temperatures when it's running.
    if (hw.running) {
      t.cpu.temp = hw.cpuTemp() ?? t.cpu.temp;
      if (gpu && gpu.temp == null) gpu.temp = hw.gpuTemp();
    }
    // Keep the last CPU temp if LHM only reported on alternate samples.
    const prev = this.latest();
    if (t.cpu.temp == null && prev?.cpu.temp != null && this.cpuTempSensor) t.cpu.temp = prev.cpu.temp;
    if (gpu && gpu.temp == null && prev?.gpu?.temp != null && this.cpuTempSensor) gpu.temp = prev.gpu.temp;
    this.history.push(t);
    if (this.history.length > 300) this.history.shift();
    this.emit("sample", t);
  }
}

export const telemetry = new TelemetryService();
