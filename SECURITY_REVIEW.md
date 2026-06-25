# KEF Control - Privacy & Security Review

Date: 2026-06-21. Scope: full source tree (`app/src`, `app/src-tauri`, `app/crates/kef-client`, `tools/`, config and docs) prior to the first public GitHub release.

## Summary

The app is in good shape for an open-source release. No secrets, passwords, or credentials are stored or transmitted by the app. The control protocol is local-network only and the cryptographic code is sound. A handful of personal identifiers and one defense-in-depth hardening item were found and fixed; all are listed below. Two residual items are inherent to KEF's own API and are documented rather than "fixed".

## 1. Privacy - personal info removed

| Item | Where | Fix |
|---|---|---|
| Email handle in app bundle ID | `tauri.conf.json` identifier `com.diycham.kefcontrol` | Changed to `io.github.chammeister.kefcontrol` (uses the already-public GitHub handle, not your email) |
| Real speaker IP `192.168.50.62` | `App.tsx` connect-screen placeholder | Changed to the generic example `192.168.1.50` |
| Real speaker IP + `C:\Users\micha\...` paths | `tools/kef-auth-test.ps1`, `kef-discover-settings.ps1`, `kef-fetch-web.ps1` | IP replaced with a placeholder you set; absolute paths replaced with relative `.\tools\...` |
| Captured speaker data (device name, MAC, raw API dumps) | `tools/discover/`, `tools/kef-web/` | Excluded from the repo via `.gitignore` (kept locally, never committed) |
| KEF copyrighted manuals (PDFs) and KEF web-UI JS | repo root, `tools/kef-web/` | Excluded via `.gitignore` |

After the fixes, a full scan of the to-be-committed file set for your name, email, real IP, and MAC address returns nothing.

Note: your GitHub handle `Chammeister` remains in the repo URL, bundle ID, and license by design - it is your chosen public identity for the project, not private information. Change it if you prefer.

## 2. Security - findings and fixes

**Fixed**

- **Content Security Policy was disabled** (`csp: null`). Set a restrictive policy: scripts and the app frame load only from the app itself (`script-src 'self'`, `object-src 'none'`, `frame-src 'none'`), album-art images are allowed from the speaker and streaming services (`img-src ... http: https:`), and IPC keeps working via the documented `connect-src 'self' ipc: http://ipc.localhost`. Tauri injects per-build script/style nonces automatically on top of this.
- **`open_url` command hardening.** The "Open GitHub" button calls a Rust command that launches the system browser (via `cmd /C start` on Windows). The only caller passes a compile-time constant, so it was not exploitable, but the command is now safe by construction: it accepts only `http(s)` URLs, rejects any control or shell-significant characters (`" ' \` & | ; < > ^ % $ ( ) { } [ ] * ? !`), and caps length - so no input can break out into a shell command.

**Reviewed - no action needed**

- **Cryptography (DSP/host-setting writes).** AES-256-CBC with a fresh random IV per write and HMAC-SHA256 request signing, keys and IVs from the OS CSPRNG (`getrandom`). Correctly implemented; nothing to change.
- **Secrets.** None. The speaker has no password set, so the protocol uses an empty password by design. The app stores only non-sensitive UI state in `localStorage` (speaker IP, theme, last source, window position).
- **Network client.** All HTTP requests have timeouts; volume is clamped; responses are parsed defensively (no panics on malformed data). TLS uses `rustls` so the build has no platform OpenSSL dependency.
- **IPC surface.** Tauri capabilities are minimal (`core:default` only). Commands act solely on the connected speaker and validate their inputs (e.g. unknown sources/fields are rejected).

**Residual risks (inherent to KEF's API, documented not fixed)**

- **Plaintext HTTP on the local network.** KEF's speakers expose their control API over unencrypted HTTP on port 80 - there is no HTTPS option. Anyone already on your LAN can read or control the speaker regardless of this app. This is a property of the speaker, not the app; keep the speaker on a trusted home network.
- **No speaker-side authentication for control.** Because the speaker ships with no password, basic control (volume, source, power) is unauthenticated by design. The app does not weaken this.

## 3. macOS compatibility

All features added during development are macOS-compatible:

- Browser-open, launch-at-startup (`LaunchAgent`), system tray, close-to-tray, window positioning, and live sync are all implemented cross-platform.
- The macOS app icon (`icon.icns`) is present and valid; `bundle.targets: "all"` produces a `.app` + `.dmg` on macOS.
- Two minor macOS caveats, cosmetic only: the window-position anchors use an approximate screen-edge margin and do not subtract the Dock/menu bar, so an anchored window may sit a few pixels under them; and global media-key capture can be intercepted by macOS and may require granting Accessibility permission. Neither affects core functionality.

## 4. Building the installers

See the "Build installers" section of `README.md` for the exact Windows and macOS commands, including the universal (Apple Silicon + Intel) macOS build and the Gatekeeper/SmartScreen notes for unsigned builds.

Installers cannot be cross-compiled: build the Windows `.msi`/`.exe` on Windows and the macOS `.dmg`/`.app` on a Mac.
