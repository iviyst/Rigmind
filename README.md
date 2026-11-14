# Rigmind

AI-powered performance companion for Windows gaming PCs. Live monitoring, automatic Game Boost, frame-time stutter analysis explained by Claude, before/after fix testing, fan and RGB control, and one-click driver updates.

## Privacy: your data stays yours

Rigmind has **no servers, no accounts, no telemetry and no analytics**. Nothing about you or your PC is ever sent to Rigmind or its developer.

- **Everything is stored locally** in `%APPDATA%\Rigmind` on your PC: settings, game profiles, session recordings, test results and driver scans. Uninstall Rigmind and delete that folder, and it's all gone.
- **Your Anthropic API key** is encrypted with your Windows account (DPAPI) and saved only on your PC. It is never shown in the app, never logged, and never sent anywhere except to Anthropic when you use the AI features.

The few times Rigmind connects to the internet, it talks directly to the service involved:

| When | Where it goes | What is sent |
|---|---|---|
| You use AI features with **Claude** | Anthropic's API, with **your own** key | The stats, hardware info, session, crash and security data Claude needs to answer. Covered by [Anthropic's API data policy](https://www.anthropic.com/legal/privacy). |
| You use AI features with **Rigmind Local AI** | Nowhere. It runs on your PC through Ollama | Nothing leaves your PC. (The one-time model download comes from Ollama's library.) |
| Find the latest BIOS (Claude only) | Anthropic's web search, reading the board maker's site | Your motherboard model and BIOS version. |
| Driver checks | NVIDIA and Microsoft Windows Update | Standard driver lookups, the same ones the NVIDIA app and Windows Update do. |
| Update checks | GitHub (this repository's Releases) | A request for the latest version number. |
| Installing helpers you choose | winget / the tool's official site | Only when you click Install. |
| Phone remote (off by default) | Your home network only | Live stats to your own phone, protected by a secret link. |
| Discord status (off by default) | The Discord app on your PC | Your current game and FPS. |

Security scans use Microsoft Defender on your PC; Rigmind never uploads your files.

## Features

| Page | |
|---|---|
| **Live** | CPU and GPU load gauges, temperatures, clocks, GPU power, FPS and 1% lows while you play, RAM, VRAM, disk and network use, plus the apps using the most CPU. |
| **Game Boost** | Detects games from Steam, Epic, Xbox, Battle.net, EA, Ubisoft, Riot, GOG, Rockstar and Roblox. While you play it applies the **game's profile**: priority, power plan, pinning to the cache cores on dual-CCD X3D Ryzens, pausing background apps, fan profile and lighting color. Everything is restored when the game closes. Rigmind learns which apps cause stutters and suggests pausing them. |
| **Before/after tests** | Measures FPS before a change, with it, and without it again, about 40 seconds each, while you play. The change is kept only if it measurably helps; otherwise Rigmind undoes it. |
| **Sessions** | Every game recorded second by second. Each stutter is sorted by cause: shader compiling, loading from disk, a background app, CPU maxed out, video memory full or overheating. Claude explains what happened. |
| **Cooling** | Fan curves (Quiet, Balanced, Performance or custom), separate curves for the desktop and for gaming, spin-up ahead of the heat when a game launches, per-fan calibration, and failsafes. |
| **Lighting** | RGB through OpenRGB that shows your PC's status: blue at idle shifting toward magenta as temperatures rise. It pulses red if something runs hot, flashes for notifications, and can show a color per game, turn off on a schedule, or turn off when you're away. |
| **Drivers** | NVIDIA driver one-click update; Windows Update drivers with a restore point; BIOS and SSD firmware checks. **Firmware is never flashed automatically.** |
| **Assistant** | Chat about your PC with Claude or the free Rigmind Local AI. Fixes appear as **Apply** or **Apply and test** buttons, from a fixed list of safe actions. Rig notes let it remember facts about your PC between chats. |
| **Game Coach** | Optimizes any game's settings for your hardware and playstyle by reading its own config file. Sensitivity converter (cm/360, eDPI), aim warm-up trainer, and CS2/Dota 2 match recaps lined up with your FPS and ping. Fair play only: no aim assist. |
| **Health** | Daily AI checkup. Crash Detective (crashes, GPU driver resets, hardware errors, blue screens, sudden shutdowns) with a flight recorder of the minutes before each one. Temperature trends, boot time and what slows it, driver impact on each game, a built-in CPU+GPU stress test, and an undervolting coach. |
| **Security** | Microsoft Defender status, scans, threats and quarantine, explained in plain English. Intrusion watch: new apps accepting connections, new services, startup tasks and admin accounts, failed sign-ins, new devices on your network, and an exposure check (firewall, Remote Desktop, sharing, SMBv1). |
| **Tune** | Display Doctor (monitors stuck at 60 Hz), ping/jitter/loss to your game's servers, power use and cost, shader cache cleanup, holding Windows Update during games, stutter snapshots. |
| **Automations** | "When I start Valorant, close Chrome and set fans to performance." Plain English becomes a rule built from a fixed set of safe steps. |
| **More** | Voice copilot (hotkey, offline speech recognition), phone remote, rig card image, Discord status, live rig diagram, game-reactive and screen-matching RGB, Autopilot for low-risk fixes, change history with undo, BIOS Update Assistant. |

## Set up (Windows 10/11)

1. Install **Node.js 22** and the **.NET 8 SDK** (`winget install Microsoft.DotNet.SDK.8`).
2. Open **Terminal as Administrator** in this folder.
3. `npm install`
4. `npm run build:hw` builds the hardware helper (sensors and fan control).
5. `npm run dev` starts Rigmind with live reload. `npm run dist` builds an installer in `release\` instead.
6. In Rigmind:
   - **Settings > AI engine:** paste your Anthropic API key, or choose **Rigmind Local AI** for a free assistant that runs on your PC (one click installs Ollama and a model sized to your GPU). Install PresentMon for FPS capture.
   - **Cooling:** install the [PawnIO](https://pawnio.eu/) driver for motherboard fans and CPU temperature, then turn on fan control.
   - **Lighting:** install OpenRGB, then close iCUE, Armoury Crate and other brand RGB apps.

`npm run preview:ui` opens the interface in a browser with sample data. It doesn't touch your PC.

## Releasing an update

Users get updates automatically. Rigmind checks this repo's GitHub Releases every 6 hours, downloads new versions in the background, and installs them when Rigmind restarts. It never checks or installs during a game.

To publish a version:

```
npm version minor        # or patch / major: bumps package.json and creates a tag
git push --follow-tags
```

GitHub Actions (`.github/workflows/release.yml`) builds the helper and the installer on Windows and publishes the release. It uses GitHub's own short-lived token, so you never create or store a personal access token.

## Security

See [SECURITY.md](SECURITY.md). Recommended GitHub settings for this repo:

- **Settings > Code security > Secret scanning** and **Push protection**: on. GitHub blocks pushes that contain keys.
- **Dependabot alerts** and **security updates**: on.
- **Settings > Actions > General > Workflow permissions**: "Read repository contents" by default. The release workflow asks for write access itself.
- **Branch protection on `main`**: require the Secret scan check to pass.

Never paste your API key into code, issues or commit messages. If one ever leaks, delete it on the [API keys page](https://platform.claude.com/settings/keys) and create a new one.

## Good to know

- **Fan control** uses LibreHardwareMonitor with the PawnIO driver, the same setup FanControl uses. Some players report that certain anti-cheat systems react to PawnIO being installed, so check your games' rules if you play competitive titles.
- **The overlay** shows over borderless and windowed games. Games in exclusive fullscreen draw over it.
- **Pinning to cache cores** only appears on dual-CCD X3D Ryzens (7900X3D, 7950X3D, 9900X3D, 9950X3D). Some anti-cheat blocks it; Rigmind then saves it for the next launch.
- **AMD and Intel graphics drivers** link to AMD Adrenalin or Intel Driver & Support Assistant, because neither offers a version lookup.

## Code layout

```
hw/              C# hardware helper (LibreHardwareMonitorLib): sensors + fan control over stdio
src/main/        Electron main process
  telemetry.ts   perf-counter sampler + nvidia-smi
  hw.ts          talks to the hardware helper
  fans.ts        fan curves, pre-ramp, calibration, failsafes
  rgb.ts         OpenRGB lighting engine
  fps.ts         PresentMon: FPS, 1% low, stutters
  games.ts       game detection
  boost.ts       Game Boost and crash-safe restore
  profiles.ts    per-game profiles and learning
  tests.ts       before/after tests
  sessions.ts    session recording and stutter causes
  ai.ts          Claude tool-use loop
  actions.ts     the fixed list of actions you can apply
  drivers.ts     driver and firmware checks
  updater.ts     auto-update from GitHub Releases
  localai.ts     Rigmind Local AI (Ollama)
  incidents.ts   Crash Detective + flight recorder
  health.ts      boot times, temperature trends, driver impact
  stress.ts      CPU + GPU stress test
  security.ts    Defender control + intrusion watch
  tune.ts        Display Doctor, shader caches, game configs, update hold
  netmon.ts      ping / jitter / loss
  energy.ts      power and cost
  automations.ts plain-English rules engine
  brain.ts       daily checkup, anomaly alerts, Autopilot
  history.ts     change history with undo
  gsi.ts         CS2 / Dota 2 game state (lighting + match recaps)
  voice.ts, remote.ts, discord.ts, notes.ts
src/renderer/    React UI (mock.ts powers the browser preview)
src/shared/      types shared by both
.github/         release build, secret scan, Dependabot
```
