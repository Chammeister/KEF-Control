# KEF Control

Desktop controller for KEF LS50 Wireless II (Windows x64 + macOS). Tauri v2 + React. Controls the speakers over their network HTTP API — no IR hardware needed.

## First-time setup

1. **Rust** — install from <https://rustup.rs> (on Windows this also prompts for the MSVC build tools; accept the defaults)
2. **Node.js LTS** — <https://nodejs.org>
3. ```
   cd app
   npm install
   ```

## Run in dev mode

```
npm run tauri dev
```

First build takes a few minutes (Rust compiles everything once); subsequent runs are fast.

In the app, enter your speaker's IP address (KEF Connect app → Settings → speaker info, or your router's client list). Tip: give the speaker a DHCP reservation in your router so the IP never changes.

## Build installers

```
npm run tauri build
```

Outputs to `src-tauri/target/release/bundle/` (`.msi`/`.exe` on Windows, `.dmg`/`.app` on macOS).

## Quick protocol smoke test (optional, no app needed)

With the speaker on your network, from any terminal:

```
curl "http://SPEAKER_IP/api/getData?path=settings:/deviceName&roles=value"
curl "http://SPEAKER_IP/api/getData?path=player:volume&roles=value"
```

Both should return JSON.

## Layout

- `crates/kef-client` — pure-Rust speaker protocol library (getData/setData, event long-polling)
- `src-tauri` — Tauri shell exposing the client as IPC commands
- `src` — React UI
