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
import { Ready, readyName } from "./pages/Ready";
import { Work } from "./pages/Work";
import { Space } from "./pages/Space";
import { Printers } from "./pages/Printers";
import { Toaster } from "./components/Bits";
import { BrandMark, IconAssistant, IconBoost, IconDrivers, IconLive, IconSessions, IconSettings, IconFan, IconLight, IconHealth, IconShield, IconTune, IconCoach, IconAuto, IconMoon, IconWork, IconDisk, IconPrinter } from "./components/Icons";
import type { ChatMessage, GameState, ModeState, Settings, Telemetry, WorkMode } from "../shared/types";

type Page = "live" | "boost" | "coach" | "sessions" | "work" | "ready" | "health" | "security" | "space" | "tune" | "cooling" | "lighting" | "printers" | "drivers" | "automations" | "assistant" | "settings";
type NavItem = { id: Page; label: string; icon: () => JSX.Element; modes?: WorkMode[] };
// Groups are separated by a thin line in the sidebar. `modes` limits an item to those modes.
const NAV: (NavItem | "sep")[] = [
  { id: "live", label: "Live", icon: IconLive },
  { id: "boost", label: "Game Boost", icon: IconBoost, modes: ["gaming", "both"] },
  { id: "coach", label: "Game Coach", icon: IconCoach, modes: ["gaming", "both"] },
  { id: "work", label: "Work", icon: IconWork, modes: ["work", "both"] },
  { id: "sessions", label: "Sessions", icon: IconSessions, modes: ["gaming", "both"] },
  { id: "ready", label: "Ready", icon: IconMoon },
  "sep",
  { id: "health", label: "Health", icon: IconHealth },
  { id: "security", label: "Security", icon: IconShield },
  { id: "space", label: "Space and memory", icon: IconDisk },
  { id: "tune", label: "Tune", icon: IconTune },
  { id: "drivers", label: "Drivers", icon: IconDrivers },
  "sep",
  { id: "cooling", label: "Cooling", icon: IconFan },
  { id: "lighting", label: "Lighting", icon: IconLight, modes: ["gaming", "both"] },
  { id: "printers", label: "Printers", icon: IconPrinter, modes: ["work", "both"] },
  "sep",
  { id: "automations", label: "Automations", icon: IconAuto },
  { id: "assistant", label: "Assistant", icon: IconAssistant },
  { id: "settings", label: "Settings", icon: IconSettings },
];

const PROFILE_TEXT = { game: "Playing", call: "On a call", work: "Working", normal: "" } as const;

export function App() {
  const [page, setPage] = useState<Page>((new URLSearchParams(location.search).get("page") as Page) || "live");
  const [history, setHistory] = useState<Telemetry[]>([]);
  const [game, setGame] = useState<GameState | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ModeState | null>(null);

  useEffect(() => {
    api.getHistory().then(setHistory);
    api.getGameState().then(setGame);
    api.getSettings().then(setSettings);
    api.getMode().then(setMode);
    const offs = [
      api.onMode(setMode),
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
  const m = mode?.mode ?? "both";
  // Drop items hidden in this mode, then any separator left at the start, end or doubled up.
  const nav = NAV.filter((n) => n === "sep" || !n.modes || n.modes.includes(m)).filter((n, i, all) => n !== "sep" || (i > 0 && all[i - 1] !== "sep" && i < all.length - 1));
  const go = (p: string) => setPage(p as Page);
  const pillText = game.active
    ? `${game.boosted ? "Boosting" : "Playing"} ${game.game}`
    : mode && mode.active !== "normal" && mode.active !== "game"
    ? `${PROFILE_TEXT[mode.active]}${mode.detail ? ` · ${mode.detail.replace(/ call$| working$/, "")}` : ""}`
    : m === "work"
    ? "Work mode"
    : settings.boost.enabled
    ? "Game Boost ready"
    : "Game Boost off";
  const live = game.active || (mode?.active ?? "normal") !== "normal";
  return (
    <div className="shell">
      <header className="titlebar">
        <div className="brand"><BrandMark className="brand-mark" />Rigmind</div>
        <div className="spacer" />
        <span className={`status-pill ${live ? "live" : ""}`}>
          <span className="dot" />
          {pillText}
        </span>
      </header>
      <nav className="rail" aria-label="Main">
        {nav.map((n, i) =>
          n === "sep" ? (
            <div key={`sep${i}`} className="sep" role="separator" />
          ) : (
            <button key={n.id} aria-current={page === n.id ? "page" : undefined} onClick={() => setPage(n.id)}>
              <n.icon />
              {n.id === "ready" ? readyName(mode) : n.label}
            </button>
          )
        )}
        {isMock && <div className="foot">Preview with sample data. Run inside the app to see your PC.</div>}
      </nav>
      <main>
        {page === "live" && <Live history={history} game={game} onAsk={ask} go={m !== "gaming" ? go : undefined} />}
        {page === "work" && <Work go={go} />}
        {page === "ready" && <Ready mode={mode} />}
        {page === "space" && <Space />}
        {page === "printers" && <Printers />}
        {page === "boost" && <Boost settings={settings} setSettings={setSettings} game={game} />}
        {page === "sessions" && <Sessions settings={settings} onAsk={ask} />}
        {page === "coach" && <Coach settings={settings} />}
        {page === "health" && <Health settings={settings} laptop={mode?.pcType === "laptop"} />}
        {page === "security" && <Security settings={settings} />}
        {page === "tune" && <Tune />}
        {page === "automations" && <Automations settings={settings} />}
        {page === "cooling" && <Cooling />}
        {page === "lighting" && <Lighting />}
        {page === "drivers" && <Drivers />}
        {page === "assistant" && <Assistant settings={settings} game={game} messages={chat} setMessages={setChat} draft={draft} setDraft={setDraft} goSettings={() => setPage("settings")} />}
        {page === "settings" && <SettingsPage settings={settings} setSettings={setSettings} mode={mode} setMode={setMode} />}
      </main>
      <Toaster />
    </div>
  );
}
