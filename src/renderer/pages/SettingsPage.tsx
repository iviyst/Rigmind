import { useEffect, useState } from "react";
import { api } from "../api";
import { Setting, Switch, toast } from "../components/Bits";
import type { Settings, SystemInfo, ToolStatus, UpdateStatus } from "../../shared/types";
import { fmt } from "../api";

export function SettingsPage({ settings, setSettings }: { settings: Settings; setSettings: (s: Settings) => void }) {
  const [key, setKey] = useState("");
  const [model, setModel] = useState(settings.model);
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [upd, setUpd] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    api.getUpdateStatus().then(setUpd);
    return api.onUpdateStatus(setUpd);
  }, []);

  useEffect(() => {
    api.getToolStatus().then(setTools);
    api.getSystemInfo().then(setSys).catch(() => {});
  }, []);

  const install = async (t: "presentmon" | "librehardwaremonitor") => {
    setInstalling(t);
    const r = await api.installTool(t);
    setInstalling(null);
    toast(r.message);
    api.getToolStatus().then(setTools);
  };

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <h1>Settings</h1>

      <section className="panel">
        <h2>Claude</h2>
        <Setting title="Anthropic API key" desc={settings.hasApiKey ? "Encrypted with your Windows account and stored only on this PC. Paste a new key to replace it." : "Create one at platform.claude.com. It's encrypted with your Windows account and never leaves this PC except to call Claude."}>
          <form className="row" onSubmit={async (e) => {
            e.preventDefault();
            try {
              setSettings(await api.setApiKey(key));
              setKey("");
              toast(key ? "API key saved" : "API key removed");
            } catch (err: any) {
              toast(String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
            }
          }}>
            <input className="input" type="password" style={{ width: 260 }} placeholder={settings.hasApiKey ? "••••••••••••" : "sk-ant-…"} value={key} onChange={(e) => setKey(e.target.value)} aria-label="Anthropic API key" />
            <button className="btn" type="submit">{key ? "Save key" : settings.hasApiKey ? "Remove" : "Save key"}</button>
          </form>
        </Setting>
        <p className="muted small" style={{ margin: "0 0 4px" }}>When you use the assistant or session reports, Rigmind sends your PC's stats and session data to Anthropic's API with your key. Nothing goes to Rigmind or anyone else.</p>
        <Setting title="Model" desc="Sonnet is fast and inexpensive. Opus digs deeper on tricky problems.">
          <form className="row" onSubmit={async (e) => { e.preventDefault(); setSettings(await api.saveSettings({ model })); toast("Model saved"); }}>
            <input className="input" style={{ width: 200 }} value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model" list="models" />
            <datalist id="models">
              <option value="claude-sonnet-5-5" />
              <option value="claude-opus-5-5" />
              <option value="claude-haiku-5-5" />
            </datalist>
            <button className="btn" type="submit" disabled={model === settings.model}>Save</button>
          </form>
        </Setting>
      </section>

      {upd && (
        <section className="panel">
          <h2>Updates</h2>
          <Setting
            title={`Rigmind ${upd.current}`}
            desc={
              upd.state === "ready" ? `Version ${upd.version} is downloaded and installs when Rigmind restarts.`
              : upd.state === "downloading" ? `Downloading ${upd.version}… ${Math.round(upd.progress * 100)}%`
              : upd.state === "checking" ? "Checking for updates…"
              : upd.state === "current" ? `You're up to date. Checked ${upd.checkedAt ? fmt.ago(upd.checkedAt) : "recently"}.`
              : upd.state === "error" ? `Couldn't check for updates: ${upd.error}`
              : upd.state === "dev" ? "Updates are off in development builds."
              : "Rigmind checks GitHub for updates every 6 hours, never during a game."
            }
          >
            {upd.state === "ready" ? (
              <button className="btn primary" onClick={async () => toast((await api.installUpdate()).message)}>Restart and update</button>
            ) : (
              <button className="btn" disabled={upd.state === "checking" || upd.state === "downloading" || upd.state === "dev"} onClick={async () => setUpd(await api.checkForUpdates())}>Check now</button>
            )}
          </Setting>
        </section>
      )}

      <section className="panel">
        <h2>General</h2>
        <Setting title="Start with Windows" desc="Rigmind starts in the tray when you sign in, so Game Boost is always ready.">
          <Switch checked={settings.startWithWindows} onChange={async (v) => setSettings(await api.saveSettings({ startWithWindows: v }))} label="Start with Windows" />
        </Setting>
        <Setting title="Check for driver updates" desc="How often Rigmind looks for new drivers. It never checks during a game.">
          <select className="input" style={{ width: 150 }} value={settings.driverCheckHours} onChange={async (e) => setSettings(await api.saveSettings({ driverCheckHours: Number(e.target.value) }))} aria-label="Driver check frequency">
            <option value={12}>Twice a day</option>
            <option value={24}>Daily</option>
            <option value={168}>Weekly</option>
          </select>
        </Setting>
      </section>

      <section className="panel">
        <h2>Sensors and helpers</h2>
        <Setting title="FPS capture (Intel PresentMon)" desc="Reads real frame times from games.">
          {tools?.presentMon ? <span className="tag good">Installed</span> : <button className="btn" disabled={!!installing} onClick={() => install("presentmon")}>{installing === "presentmon" ? "Installing…" : "Install"}</button>}
        </Setting>
        <Setting title="CPU temperature (LibreHardwareMonitor)" desc="Windows doesn't report CPU temperature on its own. Install this and keep it running in the tray.">
          {tools?.cpuTempSensor ? <span className="tag good">Reading temps</span> : <button className="btn" disabled={!!installing} onClick={() => install("librehardwaremonitor")}>{installing === "librehardwaremonitor" ? "Installing…" : "Install"}</button>}
        </Setting>
        <Setting title="NVIDIA GPU sensors" desc="Temperature, clocks and power from nvidia-smi, which comes with the NVIDIA driver.">
          {tools?.nvidiaSmi ? <span className="tag good">Connected</span> : <span className="tag neutral">Not found</span>}
        </Setting>
      </section>

      {sys && (
        <section className="panel">
          <h2>This PC</h2>
          <table className="list" style={{ marginTop: 10 }}>
            <tbody>
              {[
                ["Windows", sys.os],
                ["Processor", `${sys.cpu} (${sys.cores} cores, ${sys.threads} threads)`],
                ["Memory", `${sys.ramGB} GB: ${sys.ramSticks.join("; ")}`],
                ["Graphics", sys.gpus.join("; ")],
                ["Motherboard", sys.board],
                ["BIOS", sys.bios],
                ["Displays", sys.displays.join("; ")],
                ["Power plan", sys.powerPlan],
                ["Game Mode", sys.gameMode ? "On" : "Off"],
                ["GPU scheduling", sys.gpuScheduling ? "On" : "Off"],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td className="muted" style={{ width: 160 }}>{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
