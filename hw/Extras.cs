// Extra capabilities used by Rigmind beyond sensors and fans.
//   {"cmd":"ping","targets":["1.1.1.1","192.168.1.1"]}   -> {"type":"ping","r":[{"host":..,"ms":12|null}]} every 2 s
//   {"cmd":"snap","id":"x","path":"C:\\..\\a.jpg","w":480}  -> {"type":"snap","id":"x","ok":true}
//   {"cmd":"avgcolor","id":"x"}                            -> {"type":"avgcolor","id":"x","r":..,"g":..,"b":..}
//   {"cmd":"displays","id":"x"}                            -> {"type":"displays","id":"x","list":[...]}
//   {"cmd":"setrefresh","id":"x","device":"\\\\.\\DISPLAY1","hz":165}
//   {"cmd":"listen","id":"x","seconds":8}                  -> {"type":"heard","id":"x","text":"..."}
//   {"cmd":"say","text":"..."}
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Text.Json.Nodes;

namespace RigmindHw;

internal static class Extras
{
    private static string[] _pingTargets = Array.Empty<string>();
    private static Thread? _pingThread;
    private static SpeechSynthesizer? _tts;

    public static void Handle(string name, JsonObject cmd)
    {
        var id = (string?)cmd["id"] ?? "";
        switch (name)
        {
            case "ping":
                _pingTargets = (cmd["targets"] as JsonArray)?.Select(x => (string?)x).Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x!).Take(8).ToArray() ?? Array.Empty<string>();
                if (_pingThread == null)
                {
                    _pingThread = new Thread(PingLoop) { IsBackground = true };
                    _pingThread.Start();
                }
                break;
            case "snap":
                Run(() => Snap(id, (string?)cmd["path"] ?? "", (int?)cmd["w"] ?? 480));
                break;
            case "avgcolor":
                Run(() => AvgColor(id));
                break;
            case "displays":
                Run(() => Program.Write(new JsonObject { ["type"] = "displays", ["id"] = id, ["list"] = Displays.List() }));
                break;
            case "setrefresh":
                Run(() =>
                {
                    var ok = Displays.SetRefresh((string?)cmd["device"] ?? "", (int?)cmd["hz"] ?? 60, out var msg);
                    Program.Write(new JsonObject { ["type"] = "setrefresh", ["id"] = id, ["ok"] = ok, ["msg"] = msg });
                });
                break;
            case "listen":
                Run(() => Listen(id, Math.Clamp((int?)cmd["seconds"] ?? 8, 2, 20)));
                break;
            case "say":
                Run(() =>
                {
                    _tts ??= new SpeechSynthesizer();
                    _tts.SetOutputToDefaultAudioDevice();
                    _tts.SpeakAsyncCancelAll();
                    _tts.SpeakAsync((string?)cmd["text"] ?? "");
                });
                break;
        }
    }

    private static void Run(Action a) => new Thread(() =>
    {
        try { a(); }
        catch (Exception ex) { Program.Write(new JsonObject { ["type"] = "error", ["msg"] = ex.Message }); }
    }) { IsBackground = true }.Start();

    private static void PingLoop()
    {
        using var ping = new Ping();
        while (true)
        {
            var targets = _pingTargets;
            var results = new JsonArray();
            foreach (var host in targets)
            {
                long? ms = null;
                try
                {
                    var reply = ping.Send(host, 1000);
                    if (reply.Status == IPStatus.Success) ms = reply.RoundtripTime;
                }
                catch { /* unreachable */ }
                results.Add(new JsonObject { ["host"] = host, ["ms"] = ms });
            }
            if (targets.Length > 0) Program.Write(new JsonObject { ["type"] = "ping", ["r"] = results });
            Thread.Sleep(2000);
        }
    }

    private static Bitmap CapturePrimary()
    {
        var b = System.Windows.Forms.Screen.PrimaryScreen!.Bounds;
        var bmp = new Bitmap(b.Width, b.Height, PixelFormat.Format24bppRgb);
        using var g = Graphics.FromImage(bmp);
        g.CopyFromScreen(b.Left, b.Top, 0, 0, b.Size);
        return bmp;
    }

    private static void Snap(string id, string path, int width)
    {
        // Works for borderless and windowed games. Exclusive-fullscreen games may come out black.
        using var full = CapturePrimary();
        var h = (int)(full.Height * (width / (double)full.Width));
        using var small = new Bitmap(width, h);
        using (var g = Graphics.FromImage(small))
        {
            g.InterpolationMode = InterpolationMode.HighQualityBilinear;
            g.DrawImage(full, 0, 0, width, h);
        }
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var jpeg = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
        using var ep = new EncoderParameters(1);
        ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 70L);
        small.Save(path, jpeg, ep);
        Program.Write(new JsonObject { ["type"] = "snap", ["id"] = id, ["ok"] = true, ["path"] = path });
    }

    private static void AvgColor(string id)
    {
        using var full = CapturePrimary();
        using var tiny = new Bitmap(32, 18);
        using (var g = Graphics.FromImage(tiny))
        {
            g.InterpolationMode = InterpolationMode.HighQualityBilinear;
            g.DrawImage(full, 0, 0, 32, 18);
        }
        // Weight saturated pixels more so the result isn't always muddy grey.
        double r = 0, gr = 0, bl = 0, wsum = 0;
        for (var x = 0; x < tiny.Width; x++)
            for (var y = 0; y < tiny.Height; y++)
            {
                var c = tiny.GetPixel(x, y);
                var w = 0.2 + c.GetSaturation() * c.GetBrightness();
                r += c.R * w; gr += c.G * w; bl += c.B * w; wsum += w;
            }
        Program.Write(new JsonObject { ["type"] = "avgcolor", ["id"] = id, ["r"] = (int)(r / wsum), ["g"] = (int)(gr / wsum), ["b"] = (int)(bl / wsum) });
    }

    private static void Listen(string id, int seconds)
    {
        string text = "";
        try
        {
            using var rec = new SpeechRecognitionEngine(System.Globalization.CultureInfo.CurrentCulture);
            rec.LoadGrammar(new DictationGrammar());
            rec.SetInputToDefaultAudioDevice();
            rec.InitialSilenceTimeout = TimeSpan.FromSeconds(4);
            rec.EndSilenceTimeout = TimeSpan.FromSeconds(1.2);
            rec.BabbleTimeout = TimeSpan.FromSeconds(seconds);
            var result = rec.Recognize(TimeSpan.FromSeconds(seconds));
            text = result?.Text ?? "";
        }
        catch (Exception ex)
        {
            Program.Write(new JsonObject { ["type"] = "heard", ["id"] = id, ["text"] = "", ["error"] = "Speech recognition isn't available: " + ex.Message });
            return;
        }
        Program.Write(new JsonObject { ["type"] = "heard", ["id"] = id, ["text"] = text });
    }
}

internal static class Displays
{
    private const int ENUM_CURRENT_SETTINGS = -1;
    private const int DM_DISPLAYFREQUENCY = 0x400000;
    private const int CDS_UPDATEREGISTRY = 0x01;
    private const int DISPLAY_DEVICE_ATTACHED_TO_DESKTOP = 0x1;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DEVMODE
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public int dmFields;
        public int dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
        public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DISPLAY_DEVICE
    {
        public int cb;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
        public int StateFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool EnumDisplayDevices(string? device, uint devNum, ref DISPLAY_DEVICE dd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int ChangeDisplaySettingsEx(string deviceName, ref DEVMODE devMode, IntPtr hwnd, int flags, IntPtr lParam);

    private static DEVMODE NewMode() => new() { dmSize = (short)Marshal.SizeOf<DEVMODE>(), dmDeviceName = "", dmFormName = "" };

    public static JsonArray List()
    {
        var list = new JsonArray();
        for (uint i = 0; ; i++)
        {
            var dd = new DISPLAY_DEVICE { cb = Marshal.SizeOf<DISPLAY_DEVICE>() };
            if (!EnumDisplayDevices(null, i, ref dd, 0)) break;
            if ((dd.StateFlags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP) == 0) continue;
            var cur = NewMode();
            if (!EnumDisplaySettings(dd.DeviceName, ENUM_CURRENT_SETTINGS, ref cur)) continue;
            var rates = new SortedSet<int>();
            var maxRes = (w: 0, h: 0);
            for (var m = 0; ; m++)
            {
                var mode = NewMode();
                if (!EnumDisplaySettings(dd.DeviceName, m, ref mode)) break;
                if (mode.dmPelsWidth * mode.dmPelsHeight > maxRes.w * maxRes.h) maxRes = (mode.dmPelsWidth, mode.dmPelsHeight);
                if (mode.dmPelsWidth == cur.dmPelsWidth && mode.dmPelsHeight == cur.dmPelsHeight) rates.Add(mode.dmDisplayFrequency);
            }
            var mon = new DISPLAY_DEVICE { cb = Marshal.SizeOf<DISPLAY_DEVICE>() };
            var monitorName = EnumDisplayDevices(dd.DeviceName, 0, ref mon, 0) ? mon.DeviceString : "";
            list.Add(new JsonObject
            {
                ["device"] = dd.DeviceName,
                ["gpu"] = dd.DeviceString,
                ["monitor"] = monitorName,
                ["width"] = cur.dmPelsWidth,
                ["height"] = cur.dmPelsHeight,
                ["hz"] = cur.dmDisplayFrequency,
                ["maxHz"] = rates.Count > 0 ? rates.Max : cur.dmDisplayFrequency,
                ["rates"] = new JsonArray(rates.Select(r => (JsonNode)r).ToArray()),
                ["maxWidth"] = maxRes.w,
                ["maxHeight"] = maxRes.h,
            });
        }
        return list;
    }

    public static bool SetRefresh(string device, int hz, out string msg)
    {
        var cur = NewMode();
        if (!EnumDisplaySettings(device, ENUM_CURRENT_SETTINGS, ref cur)) { msg = "Display not found"; return false; }
        cur.dmDisplayFrequency = hz;
        cur.dmFields = DM_DISPLAYFREQUENCY;
        var r = ChangeDisplaySettingsEx(device, ref cur, IntPtr.Zero, CDS_UPDATEREGISTRY, IntPtr.Zero);
        msg = r == 0 ? $"Set to {hz} Hz" : $"Windows refused the change (code {r})";
        return r == 0;
    }
}
