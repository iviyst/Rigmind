// rigmind-hw: reads hardware sensors and controls fans through LibreHardwareMonitorLib.
//
// Protocol (one JSON object per line):
//   stdout  {"type":"hello","pawnio":true,"hardware":[...]}            once at start
//           {"type":"sensors","t":<ms>,"s":{"<sensorId>":<value>,...}}  every interval
//           {"type":"ack","id":"<controlId>","ok":true,"msg":"..."}     after commands
//   stdin   {"cmd":"ping"}                         heartbeat (required at least every 5 s while fans are under software control)
//           {"cmd":"set","id":"<controlId>","value":<0-100>}
//           {"cmd":"default","id":"<controlId>"}   hand one fan back to the BIOS/firmware
//           {"cmd":"defaultAll"}
//           {"cmd":"interval","ms":1000}
//   More commands (ping, screenshots, screen color, displays, speech) are in Extras.cs.
//
// Safety: every software-controlled fan is returned to firmware control when stdin closes,
// when the heartbeat stops for 5 seconds, or when the process exits for any reason.
using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;
using LibreHardwareMonitor.Hardware;

namespace RigmindHw;

internal static class Program
{
    private static readonly Computer Computer = new()
    {
        IsCpuEnabled = true,
        IsGpuEnabled = true,
        IsMotherboardEnabled = true,
        IsControllerEnabled = true,
        IsMemoryEnabled = true,
        IsStorageEnabled = true,
    };

    private static readonly ConcurrentDictionary<string, ISensor> Controls = new();
    private static readonly ConcurrentDictionary<string, bool> SoftwareControlled = new();
    private static readonly object Gate = new();
    private static readonly object OutGate = new();
    private static int _intervalMs = 1000;
    private static DateTime _lastPing = DateTime.UtcNow;
    private static volatile bool _running = true;

    private static int Main()
    {
        AppDomain.CurrentDomain.ProcessExit += (_, _) => ReleaseAll();
        AppDomain.CurrentDomain.UnhandledException += (_, _) => ReleaseAll();
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; _running = false; };

        try
        {
            Computer.Open();
        }
        catch (Exception ex)
        {
            Write(new JsonObject { ["type"] = "error", ["msg"] = "Could not open hardware: " + ex.Message });
            return 1;
        }

        UpdateAll();
        Write(Hello());

        new Thread(ReadCommands) { IsBackground = true }.Start();
        new Thread(Watchdog) { IsBackground = true }.Start();

        while (_running)
        {
            var started = DateTime.UtcNow;
            try
            {
                lock (Gate) UpdateAll();
                Write(Snapshot());
            }
            catch (Exception ex)
            {
                Write(new JsonObject { ["type"] = "error", ["msg"] = ex.Message });
            }
            var wait = _intervalMs - (int)(DateTime.UtcNow - started).TotalMilliseconds;
            if (wait > 0) Thread.Sleep(wait);
        }

        ReleaseAll();
        Computer.Close();
        return 0;
    }

    private static IEnumerable<IHardware> AllHardware()
    {
        foreach (var hw in Computer.Hardware)
        {
            yield return hw;
            foreach (var sub in hw.SubHardware) yield return sub;
        }
    }

    private static void UpdateAll()
    {
        foreach (var hw in Computer.Hardware)
        {
            hw.Update();
            foreach (var sub in hw.SubHardware) sub.Update();
        }
    }

    private static bool PawnIoPresent()
    {
        // PawnIO installs a kernel service named "PawnIO".
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\PawnIO");
            return key != null;
        }
        catch { return false; }
    }

    private static JsonObject Hello()
    {
        var list = new JsonArray();
        foreach (var hw in AllHardware())
        {
            var sensors = new JsonArray();
            foreach (var s in hw.Sensors)
            {
                var o = new JsonObject
                {
                    ["id"] = s.Identifier.ToString(),
                    ["name"] = s.Name,
                    ["type"] = s.SensorType.ToString(),
                    ["index"] = s.Index,
                };
                if (s.SensorType == SensorType.Control && s.Control != null)
                {
                    Controls[s.Identifier.ToString()] = s;
                    o["min"] = s.Control.MinSoftwareValue;
                    o["max"] = s.Control.MaxSoftwareValue;
                }
                sensors.Add(o);
            }
            list.Add(new JsonObject
            {
                ["id"] = hw.Identifier.ToString(),
                ["name"] = hw.Name,
                ["type"] = hw.HardwareType.ToString(),
                ["parent"] = hw.Parent?.Identifier.ToString(),
                ["sensors"] = sensors,
            });
        }
        return new JsonObject { ["type"] = "hello", ["pawnio"] = PawnIoPresent(), ["hardware"] = list };
    }

    private static JsonObject Snapshot()
    {
        var values = new JsonObject();
        foreach (var hw in AllHardware())
            foreach (var s in hw.Sensors)
                if (s.Value is float v && !float.IsNaN(v))
                    values[s.Identifier.ToString()] = Math.Round(v, 2);
        return new JsonObject
        {
            ["type"] = "sensors",
            ["t"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            ["s"] = values,
        };
    }

    private static void ReadCommands()
    {
        string? line;
        while ((line = Console.ReadLine()) != null)
        {
            _lastPing = DateTime.UtcNow;
            try { Handle(JsonNode.Parse(line)!.AsObject()); }
            catch (Exception ex) { Write(new JsonObject { ["type"] = "error", ["msg"] = "Bad command: " + ex.Message }); }
        }
        // Rigmind closed our stdin (it quit or crashed): give fans back to firmware and exit.
        ReleaseAll();
        _running = false;
    }

    private static void Handle(JsonObject cmd)
    {
        var name = (string?)cmd["cmd"];
        switch (name)
        {
            case "ping":
                break;
            case "interval":
                _intervalMs = Math.Clamp((int?)cmd["ms"] ?? 1000, 250, 10000);
                break;
            case "set":
            {
                var id = (string?)cmd["id"] ?? "";
                var value = Math.Clamp((float?)cmd["value"] ?? 100f, 0f, 100f);
                if (!Controls.TryGetValue(id, out var s) || s.Control == null) { Ack(id, false, "Unknown fan control"); break; }
                lock (Gate)
                {
                    value = Math.Clamp(value, s.Control.MinSoftwareValue, s.Control.MaxSoftwareValue);
                    s.Control.SetSoftware(value);
                    SoftwareControlled[id] = true;
                }
                Ack(id, true, $"Set to {value:0}%");
                break;
            }
            case "default":
            {
                var id = (string?)cmd["id"] ?? "";
                if (Controls.TryGetValue(id, out var s) && s.Control != null)
                {
                    lock (Gate) s.Control.SetDefault();
                    SoftwareControlled.TryRemove(id, out _);
                    Ack(id, true, "Returned to automatic");
                }
                else Ack(id, false, "Unknown fan control");
                break;
            }
            case "defaultAll":
                ReleaseAll();
                Ack("*", true, "All fans returned to automatic");
                break;
            case "rescan":
                Write(Hello());
                break;
            default:
                Extras.Handle(name ?? "", cmd);
                break;
        }
    }

    private static void Watchdog()
    {
        while (_running)
        {
            Thread.Sleep(1000);
            if (!SoftwareControlled.IsEmpty && (DateTime.UtcNow - _lastPing).TotalSeconds > 5)
            {
                ReleaseAll();
                Write(new JsonObject { ["type"] = "error", ["msg"] = "Heartbeat lost; fans returned to automatic." });
            }
        }
    }

    private static void ReleaseAll()
    {
        lock (Gate)
        {
            foreach (var id in SoftwareControlled.Keys.ToList())
            {
                try
                {
                    if (Controls.TryGetValue(id, out var s)) s.Control?.SetDefault();
                }
                catch { /* keep releasing the rest */ }
                SoftwareControlled.TryRemove(id, out _);
            }
        }
    }

    private static void Ack(string id, bool ok, string msg) =>
        Write(new JsonObject { ["type"] = "ack", ["id"] = id, ["ok"] = ok, ["msg"] = msg });

    internal static void Write(JsonObject o)
    {
        lock (OutGate)
        {
            Console.Out.WriteLine(o.ToJsonString());
            Console.Out.Flush();
        }
    }
}
