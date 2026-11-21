// Rigmind 1.3 helper commands: the night engine (Ready to Play / Ready to Work), file hashing
// for the threat lists, and the disk map.
//   {"cmd":"idle","id":"x"}                        -> {"type":"idle","id":"x","ms":1234}        ms since last keyboard/mouse input
//   {"cmd":"awake","on":true}                      keep the PC from sleeping (screen may still turn off)
//   {"cmd":"monitoroff"}                           turn the displays off
//   {"cmd":"sleep","id":"x"}                       sleep (S3 / Modern Standby), never hibernate
//   {"cmd":"mute","id":"x","on":true}              -> {"type":"mute","id":"x","ok":true,"wasMuted":false,"volume":0.42}
//   {"cmd":"hash","id":"x","paths":["C:\\a.exe"]}  -> {"type":"hash","id":"x","list":[{"path":..,"sha256":..}]}
//   {"cmd":"diskscan","id":"x","path":"C:\\"}      -> {"type":"diskprogress",...} then {"type":"diskscan","id":"x","root":{...},"bigFiles":[...]}
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace RigmindHw;

internal static class Night
{
    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }

    [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
    [DllImport("kernel32.dll")] private static extern uint SetThreadExecutionState(uint esFlags);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("powrprof.dll", SetLastError = true)] private static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent);

    private const uint ES_CONTINUOUS = 0x80000000;
    private const uint ES_SYSTEM_REQUIRED = 0x00000001;
    private static readonly IntPtr HWND_BROADCAST = new(0xffff);
    private const uint WM_SYSCOMMAND = 0x0112;
    private static readonly IntPtr SC_MONITORPOWER = new(0xF170);

    // The keep-awake request belongs to the thread that made it, so one long-lived thread owns it.
    private static readonly BlockingCollection<bool> AwakeQueue = new();
    private static Thread? _awakeThread;

    public static bool Handle(string name, JsonObject cmd)
    {
        var id = (string?)cmd["id"] ?? "";
        switch (name)
        {
            case "idle":
            {
                var info = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
                long ms = GetLastInputInfo(ref info) ? (long)(uint)(Environment.TickCount - (int)info.dwTime) : -1;
                Program.Write(new JsonObject { ["type"] = "idle", ["id"] = id, ["ms"] = ms });
                return true;
            }
            case "awake":
                if (_awakeThread == null)
                {
                    _awakeThread = new Thread(() =>
                    {
                        foreach (var on in AwakeQueue.GetConsumingEnumerable())
                            SetThreadExecutionState(on ? ES_CONTINUOUS | ES_SYSTEM_REQUIRED : ES_CONTINUOUS);
                    }) { IsBackground = true };
                    _awakeThread.Start();
                }
                AwakeQueue.Add((bool?)cmd["on"] ?? false);
                return true;
            case "monitoroff":
                PostMessage(HWND_BROADCAST, WM_SYSCOMMAND, SC_MONITORPOWER, new IntPtr(2));
                return true;
            case "sleep":
            {
                AwakeQueue.Add(false);
                // SetSuspendState(false, ...) asks for sleep. rundll32 powrprof,SetSuspendState would
                // hibernate instead whenever hibernation is enabled.
                var ok = SetSuspendState(false, false, false);
                Program.Write(new JsonObject { ["type"] = "sleep", ["id"] = id, ["ok"] = ok });
                return true;
            }
            case "mute":
                Run(() => Mute(id, (bool?)cmd["on"] ?? true, (float?)cmd["volume"]));
                return true;
            case "hash":
                Run(() => Hash(id, (cmd["paths"] as JsonArray)?.Select(x => (string?)x ?? "").Where(x => x != "").Take(5000).ToArray() ?? Array.Empty<string>()));
                return true;
            case "diskscan":
                Run(() => DiskScan(id, (string?)cmd["path"] ?? "C:\\"));
                return true;
        }
        return false;
    }

    private static void Run(Action a) => new Thread(() =>
    {
        try { a(); }
        catch (Exception ex) { Program.Write(new JsonObject { ["type"] = "error", ["msg"] = ex.Message }); }
    }) { IsBackground = true }.Start();

    // ---------- Audio (Core Audio endpoint volume) ----------
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] private class MMDeviceEnumeratorCom { }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out uint count);
        [PreserveSig] int SetMasterVolumeLevel(float levelDb, ref Guid ctx);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
        [PreserveSig] int GetMasterVolumeLevel(out float levelDb);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid ctx);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid ctx);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float levelDb);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    private static void Mute(string id, bool on, float? restoreVolume)
    {
        var t = new Thread(() =>
        {
            try
            {
                var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
                Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0 /*render*/, 1 /*multimedia*/, out var dev));
                var iid = typeof(IAudioEndpointVolume).GUID;
                Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23 /*CLSCTX_ALL*/, IntPtr.Zero, out var o));
                var vol = (IAudioEndpointVolume)o;
                vol.GetMute(out var wasMuted);
                vol.GetMasterVolumeLevelScalar(out var level);
                var ctx = Guid.Empty;
                vol.SetMute(on, ref ctx);
                if (restoreVolume is float v) vol.SetMasterVolumeLevelScalar(Math.Clamp(v, 0f, 1f), ref ctx);
                Program.Write(new JsonObject { ["type"] = "mute", ["id"] = id, ["ok"] = true, ["wasMuted"] = wasMuted, ["volume"] = level });
            }
            catch (Exception ex)
            {
                Program.Write(new JsonObject { ["type"] = "mute", ["id"] = id, ["ok"] = false, ["msg"] = ex.Message });
            }
        });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
    }

    // ---------- File hashes for the threat lists ----------
    private static void Hash(string id, string[] paths)
    {
        var list = new JsonArray();
        using var sha = SHA256.Create();
        foreach (var p in paths)
        {
            try
            {
                var fi = new FileInfo(p);
                if (!fi.Exists || fi.Length > 300L * 1024 * 1024) continue;
                using var fs = new FileStream(p, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                list.Add(new JsonObject { ["path"] = p, ["sha256"] = Convert.ToHexString(sha.ComputeHash(fs)).ToLowerInvariant() });
            }
            catch { /* locked or removed: skip */ }
        }
        Program.Write(new JsonObject { ["type"] = "hash", ["id"] = id, ["list"] = list });
    }

    // ---------- Disk map ----------
    private sealed class Node
    {
        public string Name = "", Path = "";
        public long Bytes, Files;
        public List<Node>? Children;
    }

    private const int KeepDepth = 4; // folders deeper than this are only counted
    private static long _scanFiles, _scanBytes;

    private static void DiskScan(string id, string root)
    {
        _scanFiles = 0;
        _scanBytes = 0;
        var big = new ConcurrentBag<(string path, long bytes, DateTime mod)>();
        var bigLock = new object();
        var minBig = 100L * 1024 * 1024; // track files over 100 MB
        var started = DateTime.UtcNow;
        var done = false;
        var progress = new Thread(() =>
        {
            while (!done)
            {
                Thread.Sleep(700);
                Program.Write(new JsonObject { ["type"] = "diskprogress", ["id"] = id, ["files"] = Interlocked.Read(ref _scanFiles), ["bytes"] = Interlocked.Read(ref _scanBytes) });
            }
        }) { IsBackground = true };
        progress.Start();

        var opts = new EnumerationOptions { IgnoreInaccessible = true, RecurseSubdirectories = false, AttributesToSkip = FileAttributes.ReparsePoint, ReturnSpecialDirectories = false };

        Node Walk(DirectoryInfo dir, int depth)
        {
            var n = new Node { Name = dir.Name, Path = dir.FullName };
            var subs = new List<DirectoryInfo>();
            try
            {
                foreach (var e in dir.EnumerateFileSystemInfos("*", opts))
                {
                    if (e is FileInfo f)
                    {
                        long len;
                        try { len = f.Length; } catch { continue; }
                        n.Bytes += len;
                        n.Files++;
                        if (len >= minBig) big.Add((f.FullName, len, f.LastWriteTimeUtc));
                    }
                    else if (e is DirectoryInfo d) subs.Add(d);
                }
            }
            catch { /* access denied */ }
            Interlocked.Add(ref _scanFiles, n.Files);
            Interlocked.Add(ref _scanBytes, n.Bytes);
            var kids = new ConcurrentBag<Node>();
            if (depth == 0) Parallel.ForEach(subs, new ParallelOptions { MaxDegreeOfParallelism = 8 }, d => kids.Add(Walk(d, depth + 1)));
            else foreach (var d in subs) kids.Add(Walk(d, depth + 1));
            foreach (var k in kids)
            {
                n.Bytes += k.Bytes;
                n.Files += k.Files;
            }
            if (depth < KeepDepth)
                n.Children = kids.Where(k => k.Bytes > 0).OrderByDescending(k => k.Bytes).Take(40).Select(k => depth + 1 < KeepDepth ? k : new Node { Name = k.Name, Path = k.Path, Bytes = k.Bytes, Files = k.Files }).ToList();
            return n;
        }

        var tree = Walk(new DirectoryInfo(root), 0);
        done = true;

        JsonObject ToJson(Node n) => new()
        {
            ["name"] = n.Name,
            ["path"] = n.Path,
            ["bytes"] = n.Bytes,
            ["files"] = n.Files,
            ["children"] = n.Children == null ? null : new JsonArray(n.Children.Select(c => (JsonNode)ToJson(c)).ToArray()),
        };
        var bigFiles = new JsonArray(big.OrderByDescending(b => b.bytes).Take(60)
            .Select(b => (JsonNode)new JsonObject { ["path"] = b.path, ["bytes"] = b.bytes, ["modified"] = new DateTimeOffset(b.mod).ToUnixTimeMilliseconds() }).ToArray());
        Program.Write(new JsonObject
        {
            ["type"] = "diskscan",
            ["id"] = id,
            ["root"] = ToJson(tree),
            ["bigFiles"] = bigFiles,
            ["seconds"] = Math.Round((DateTime.UtcNow - started).TotalSeconds, 1),
        });
    }
}
