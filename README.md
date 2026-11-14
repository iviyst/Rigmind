# Rigmind

AI-powered performance companion for Windows gaming PCs. Live monitoring, automatic Game Boost, frame-time stutter analysis explained by Claude, before/after fix testing, fan and RGB control, and one-click driver updates.

## Privacy: your data stays yours

Rigmind has **no servers, no accounts, no telemetry and no analytics**. Nothing about you or your PC is ever sent to Rigmind or its developer.

- **Everything is stored locally** in `%APPDATA%\Rigmind` on your PC: settings, game profiles, session recordings, test results and driver scans. Uninstall Rigmind and delete that folder, and it's all gone.
- **Your Anthropic API key** is encrypted with your Windows account (DPAPI) and saved only on your PC. It is never shown in the app, never logged, and never sent anywhere except to Anthropic when you use the AI features.

The few times Rigmind connects to the internet, it talks directly to the service involved:

| When | Where it goes | What is sent |
|---|---|---|
| You use the Assistant or a session report | Anthropic's API, with **your own** key | The stats, hardware info, session data and driver status Claude needs to answer. Covered by [Anthropic's API data policy](https://www.anthropic.com/legal/privacy). If you don't add a key, nothing is ever sent. |
| Driver checks | NVIDIA and Microsoft Windows Update | Standard driver lookups, the same ones the NVIDIA app and Windows Update do. |
| Update checks | GitHub (this repository's Releases) | A request for the latest version number. |
| Installing helpers you choose | winget / the tool's official site | Only when you click Install. |

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
| **Assistant** | Chat with Claude about your PC. Fixes appear as **Apply** or **Apply and test** buttons, from a fixed list of safe actions. |

## Set up (Windows 10/11)

1. Install **Node.js 22** and the **.NET 8 SDK** (`winget install Microsoft.DotNet.SDK.8`).
2. Open **Terminal as Administrator** in this folder.
3. `npm install`
4. `npm run build:hw` builds the hardware helper (sensors and fan control).
5. `npm run dev` starts Rigmind with live reload. `npm run dist` builds an installer in `release\` instead.
6. In Rigmind:
   - **Settings:** paste your Anthropic API key. Install PresentMon for FPS capture.
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
src/renderer/    React UI (mock.ts powers the browser preview)
src/shared/      types shared by both
.github/         release build, secret scan, Dependabot
```
