# Security

## Reporting a problem
Please report security issues privately through **GitHub > Security > Report a vulnerability** on this repository, not in a public issue.

## How Rigmind protects you
- **Your Anthropic API key** is encrypted with Windows DPAPI (Electron `safeStorage`), tied to your Windows account, and stored only in `%APPDATA%\Rigmind\settings.json`. It is never shown in the interface, logged, or sent anywhere except Anthropic's API.
- **No servers.** Rigmind has no backend, accounts, telemetry or analytics.
- **Locked-down app.** Pages are sandboxed with context isolation and a strict content security policy. They can't navigate away from the app or request browser permissions. The main process only accepts requests from Rigmind's own pages.
- **Limited actions.** The AI can only *propose* fixes from a fixed list; nothing changes until you click Apply. Windows, security and anti-cheat processes can never be paused or ended.
- **Hardware safety.** Fans return to BIOS control if Rigmind closes, crashes or loses its sensors. Critical temperatures force every fan to 100%. Firmware is never flashed.
- **Releases** are built by GitHub Actions from this repository's source with GitHub's own short-lived token.
- **Every push** is scanned for leaked secrets (gitleaks). Dependabot opens updates for vulnerable dependencies.
