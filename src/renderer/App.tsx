import { useEffect, useState, type JSX } from "react";
import { api, isMock } from "./api";
import { Live } from "./pages/Live";
import { Boost } from "./pages/Boost";
import { Sessions } from "./pages/Sessions";
import { Drivers } from "./pages/Drivers";
import { Assistant } from "./pages/Assistant";
import { SettingsPage } from "./pages/SettingsPage";
import { Cooling } from "./pages/Cooling";
import { Lighting } from "./pages/Lighting";
import { Health } from "./pages/Health";
import { Security } from "./pages/Security";
import { Tune } from "./pages/Tune";
import { Coach } from "./pages/Coach";
import { Automations } from "./pages/Automations";
import { Toaster } from "./components/Bits";
import { BrandMark, IconAssistant, IconBoost, IconDrivers, IconLive, IconSessions, IconSettings, IconFan, IconLight, IconHealth, IconShield, IconTune, IconCoach, IconAuto } from "./components/Icons";
import type { ChatMessage, GameState, Settings, Telemetry } from "../shared/types";

type Page = "live" | "boost" | "coach" | "sessions" | "health" | "security" | "tune" | "cooling" | "lighting" | "drivers" | "automations" | "assistant" | "settings";
// Groups are separated by a thin line in the sidebar.
const NAV: ({ id: Page; label: string; icon: () => JSX.Element } | "sep")[] = [
  { id: "live", label: "Live", icon: IconLive },
  { id: "boost", label: "Game Boost", icon: IconBoost },
  { id: "coach", label: "Game Coach", icon: IconCoach },
  { id: "sessions", label: "Sessions", icon: IconSessions },
  "sep",
  { id: "health", label: "Health", icon: IconHealth },
  { id: "security", label: "Security", icon: IconShield },
  { id: "tune", label: "Tune", icon: IconTune },
  { id: "drivers", label: "Drivers", icon: IconDrivers },
  "sep",
  { id: "cooling", label: "Cooling", icon: IconFan },
  { id: "lighting", label: "Lighting", icon: IconLight },
  "sep",
  { id: "automations", label: "Automations", icon: IconAuto },
  { id: "assistant", label: "Assistant", icon: IconAssistant },
  { id: "settings", label: "Settings", icon: IconSettings },
];

export function App() {
  const [page, setPage] = useState<Page>((new URLSearchParams(location.search).get("page") as Page) || "live");
  const [history, setHistory] = useState<Telemetry[]>([]);
  const [game, setGame] = useState<GameState | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    api.getHistory().then(setHistory);
    api.getGameState().then(setGame);
    api.getSettings().then(setSettings);
    const offs = [
      api.onTelemetry((t) => setHistory((h) => [...h.slice(-179), t])),
      api.onGameState(setGame),
      api.onNavigate((p) => setPage(p as Page)),
    ];
    return () => offs.forEach((o) => o());
  }, []);

  const ask = (q: string) => {
    setDraft(q);
    setPage("assistant");
  };

  if (!settings || !game) return null;
  return (
    <div className="shell">
      <header className="titlebar">
        <div className="brand"><BrandMark className="brand-mark" />Rigmind</div>
        <div className="spacer" />
        <span className={`status-pill ${game.active ? "live" : ""}`}>
          <span className="dot" />
          {game.active ? `${game.boosted ? "Boosting" : "Playing"} ${game.game}` : settings.boost.enabled ? "Game Boost ready" : "Game Boost off"}
        </span>
      </header>
      <nav className="rail" aria-label="Main">
        {NAV.map((n, i) =>
          n === "sep" ? (
            <div key={`sep${i}`} className="sep" role="separator" />
          ) : (
            <button key={n.id} aria-current={page === n.id ? "page" : undefined} onClick={() => setPage(n.id)}>
              <n.icon />
              {n.label}
            </button>
          )
        )}
        {isMock && <div className="foot">Preview with sample data. Run inside the app to see your PC.</div>}
      </nav>
      <main>
        {page === "live" && <Live history={history} game={game} onAsk={ask} />}
        {page === "boost" && <Boost settings={settings} setSettings={setSettings} game={game} />}
        {page === "sessions" && <Sessions settings={settings} onAsk={ask} />}
        {page === "coach" && <Coach settings={settings} />}
        {page === "health" && <Health settings={settings} />}
        {page === "security" && <Security settings={settings} />}
        {page === "tune" && <Tune />}
        {page === "automations" && <Automations settings={settings} />}
        {page === "cooling" && <Cooling />}
        {page === "lighting" && <Lighting />}
        {page === "drivers" && <Drivers />}
        {page === "assistant" && <Assistant settings={settings} game={game} messages={chat} setMessages={setChat} draft={draft} setDraft={setDraft} goSettings={() => setPage("settings")} />}
        {page === "settings" && <SettingsPage settings={settings} setSettings={setSettings} />}
      </main>
      <Toaster />
    </div>
  );
}
