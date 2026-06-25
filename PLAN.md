# KEF LS50 Wireless II Desktop Control App — Execution Plan

Cross-platform (Windows x64 + macOS) desktop app replicating the KEF remote and KEF Connect app, controlling the speakers over the **network HTTP/JSON API** (`GET /api/getData`, `POST /api/setData`) — the same protocol KEF Connect uses. No IR hardware needed; the Holo Audio Red keeps feeding audio via coax while control happens over LAN.

**Stack:** Tauri v2 (Rust backend) + React/TypeScript/Vite frontend.

## Protocol reference (verified against pykefcontrol)

| Function | Path | Notes |
|---|---|---|
| Power on | `settings:/kef/play/physicalSource` = `powerOn` | setData |
| Standby (off) | `settings:/kef/play/physicalSource` = `standby` | setData |
| Source get/set | `settings:/kef/play/physicalSource` | `wifi, bluetooth, tv, optic, coaxial, analog` |
| Volume get/set | `player:volume` | `i32_`, 0–100 |
| Mute | `settings:/mediaPlayer/mute` | `bool_` |
| Play/pause, next, prev | `player:player/control`, role `activate` | `{"control": "pause"\|"next"\|"previous"}` |
| Speaker status | `settings:/kef/host/speakerStatus` | `standby` / `powerOn` |
| Now playing | `player:player/data` | title, artist, album, cover URL, codec |
| Name / firmware | `settings:/deviceName`, `settings:/releasetext` | |
| Live events | `POST /api/event/modifyQueue` + `GET /api/event/pollQueue` | long-poll for state sync |

## Phases

### Phase 1 — Protocol layer ✅ (scaffolded)
- [x] Rust crate `kef-client`: typed async client for all paths above, incl. event polling
- [x] Tauri v2 app skeleton with commands wrapping the client
- [x] Minimal test UI (IP entry, status readout, all commands as raw buttons)
- [ ] Validate against real speakers (run `npm run tauri dev` on the PC)

### Phase 2 — Core GUI (remote parity)
Power toggle, volume slider + mute, source selector, transport buttons. Live state sync via event polling so the app reflects changes from the physical remote / KEF Connect. Polished visual design.

### Phase 3 — KEF Connect parity
Now-playing screen (album art, track info, codec/sample-rate badge), EQ/DSP settings (desk/wall mode, treble trim, phase correction, sub out), speaker info, volume limit/step settings.

### Phase 4 — Desktop polish
System tray with quick controls, media-key support, global hotkeys, launch at startup, dark/light theme.

### Phase 5 — Packaging
Windows `.msi`/`.exe` + macOS `.dmg` (universal), code signing, auto-updates, cross-platform testing.

## Project layout

```
app/
  src/                 # React frontend
  src-tauri/           # Tauri shell (commands, window, tray later)
  crates/kef-client/   # Pure-Rust speaker protocol library
```

## Prerequisites to run (on Windows PC)
1. Install Rust (rustup.rs) and Node.js LTS
2. `cd app && npm install`
3. `npm run tauri dev`
4. Enter the speaker IP (find it in KEF Connect → Settings, or your router) — consider a DHCP reservation so it never changes.
