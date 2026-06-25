# KEF Control

A modern desktop controller for **KEF wireless speakers**, for **Windows and macOS**. It puts the physical remote and the most-used parts of the KEF Connect app into a clean native window on your computer, and talks to the speakers over your local network - the same way the official mobile app does. No extra hardware and no line-of-sight required.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue) ![License](https://img.shields.io/badge/license-MIT-green) ![Unofficial](https://img.shields.io/badge/status-unofficial-lightgrey)

## Background - why this exists

When your KEF speakers are on your network, the natural way to control them is the remote or the phone app. But if you spend your day at a computer, neither is convenient: the remote is one more thing to find on the desk, and reaching for your phone to nudge the volume or switch inputs breaks your flow. This app gives you all of that from the machine you're already using, with a mouse and keyboard.

There's also a very practical reason it was built. My KEF LS50 Wireless II sit on my desk on dedicated speaker stands, which makes it hard to glance at the top panel to tell whether they're even powered on, or to see which source is active. A small always-available window solves that: I can see at a glance whether the speakers are on and what input they're using, switch sources with a click, and adjust volume without hunting for the remote.

## Who it's for

- KEF owners who connect their **LS50 Wireless II, LSX II / LSX II LT, or LS60 Wireless** to their home network and want to control them from a **Windows PC/laptop or a Mac**.
- People who want quick, mouse-driven access to **power, source, volume and transport**, plus the **EQ and advanced DSP / system settings** that normally live inside the KEF Connect app - without picking up a phone.
- Desktop / nearfield setups (speakers on stands or a desk) where the top panel is awkward to see or reach.

## Download and install

Grab the latest installer from the [**Releases**](../../releases) page:

- **Windows** - `KEF Control_x.y.z_x64-setup.exe` (recommended) or the `.msi`.
- **macOS** - `KEF Control_x.y.z_universal.dmg` (a single file that runs on both Apple Silicon and Intel Macs).

The builds are **unsigned** (this is a free, unofficial project), so your OS shows a one-time security prompt the first time you launch:

- **Windows:** SmartScreen says "Windows protected your PC" -> click **More info** -> **Run anyway**.
- **macOS:** Gatekeeper says the developer "cannot be verified" -> **right-click the app -> Open -> Open**, or allow it under **System Settings -> Privacy & Security**.

After it's open, enter your speaker's IP address once (find it in KEF Connect under the speaker's info, or in your router's device list). The app remembers it and auto-connects next time. Tip: give the speaker a **DHCP reservation** in your router so its IP never changes.

## Features

**Remote (main tab)**

- Power on / standby, and it remembers the last real input so powering on doesn't dump you back to Wi-Fi.
- Source switching: Wi-Fi, Bluetooth, TV, Optical, Coaxial, Aux.
- Volume slider and a remote-style mute button.
- Transport controls (play / pause, next, previous) for streaming sources.
- Now Playing: track title, artist, album, cover art and a live progress bar (Wi-Fi streaming).
- Live two-way sync: changes made on the physical remote, the speaker's top panel, or the phone app show up in the window instantly.

**EQ / DSP tab** - the expert audio settings from KEF Connect:

- Bass extension (Less / Standard / Extra), desk mode and wall mode with gain trims, treble trim, phase correction, and left/right balance.
- Full subwoofer section: output on/off, gain, low-pass frequency, polarity, and the high-pass filter for the main speakers.
- Settings are stored per source and written securely to the speaker.

**Settings tab**

- Device info (name, model, firmware, IP, MAC).
- Speaker preferences: standby timer, second wake-up source, auto-switch to TV, startup tone, top-panel lock, standby LED, cable mode, primary speaker, and "wake sub on start-up".
- Volume preferences: step size, maximum-volume limit, and a fixed wake-up volume.
- App preferences: launch at startup, and where the window opens on screen (7 anchor positions).
- About: version, project link, and disclaimer.

**Desktop integration**

- System tray with quick controls (show/hide, power, play/pause, mute, volume) - closing the window keeps it running in the tray.
- Media keys (play/pause, next, previous) control the speaker.
- Launch at startup, and the window reopens at your chosen position.
- Light and dark themes.

## Supported speakers

The app targets KEF's current "**W2**" wireless platform - the second-generation wireless speakers that the **KEF Connect** app controls and that expose a local network API on port 80. That covers:

- **KEF LS50 Wireless II** (developed and tested against this model)
- **KEF LSX II** and **LSX II LT**
- **KEF LS60 Wireless**

These share the same control protocol, so they should all work. Only the LS50 Wireless II has been tested directly; reports and fixes for the others are welcome.

**Not supported**

- **First-generation KEF LS50 Wireless and LSX (2018)** - these use an older, different control protocol and the original KEF apps, not KEF Connect.
- **Passive / non-networked KEF speakers** and anything without network streaming (e.g. Q/R Series passives, the Mu headphones, soundbars without the W2 platform).
- Any speaker that doesn't appear in the **KEF Connect** app is almost certainly not compatible.

## Limitations and known notes

- **It's a controller, not a streamer.** The app controls the speaker over the network; it does **not** send audio to it. Audio still arrives through the speaker's own inputs and streaming services (in my setup, via coax from a Holo Audio Red DDC). This is by design.
- **No music browsing.** It isn't a full KEF Connect replacement - there's no streaming-service login, library browsing or playlist editing. Now Playing is read-only metadata plus transport controls.
- **Transport works for streaming sources only.** Play/pause/next/previous apply to Wi-Fi and Bluetooth; physical inputs (coax, optical, TV, aux) can't be transport-controlled - that's a speaker limitation, and the app tells you so.
- **Same network required.** Your computer and the speaker must be on the same LAN, and you need the speaker's IP (a DHCP reservation keeps it stable).
- **Local, unencrypted protocol.** KEF's speakers expose their control API over plain HTTP with no password - anyone already on your network can control the speaker regardless of this app. Keep the speaker on a trusted home network.
- **Unsigned builds** trigger the one-time SmartScreen / Gatekeeper prompts described above.
- **Firmware drift.** It was built and tested against firmware in the 4.1.x range. A future KEF firmware update could change the API and require an update here.
- **macOS minor notes:** the window-position anchors don't subtract the Dock / menu bar (a window may sit a few pixels under them), and global media-key capture may need Accessibility permission under System Settings -> Privacy & Security.

## Privacy

Everything happens locally between your computer and your speaker on your own network. There's **no cloud service, no account, no telemetry, and no analytics**. The app stores only a few non-sensitive preferences on your machine (speaker IP, theme, last source, window position).

## Build from source

Prerequisites: [Rust](https://rustup.rs) and [Node.js LTS](https://nodejs.org). On Windows the Rust installer also prompts for the MSVC build tools (accept the defaults); on macOS run `xcode-select --install` first for the compiler.

```
cd app
npm install
npm run tauri dev     # run in development
npm run tauri build   # build installers
```

Installers are **not cross-compiled** - build Windows on Windows and macOS on a Mac. Because this is a Cargo workspace, the output is under `app/target/release/bundle/` (not `app/src-tauri/target/`).

- **Windows:** `npm run tauri build` -> `app\target\release\bundle\nsis\*-setup.exe` and `...\msi\*.msi`.
- **macOS (universal):**
  ```
  rustup target add aarch64-apple-darwin x86_64-apple-darwin
  npm run tauri build -- --target universal-apple-darwin
  ```
  -> `app/target/release/bundle/dmg/*.dmg`.

### Automated releases (GitHub Actions)

Pushing a version tag builds and publishes both platforms automatically. The workflow in `.github/workflows/release.yml` uses [`tauri-action`](https://github.com/tauri-apps/tauri-action) to build the Windows installers and a universal macOS `.dmg` on GitHub's runners, then attaches them to a draft GitHub Release:

```
git tag v0.1.1
git push origin v0.1.1
```

When the run finishes, publish the draft release and the installers are available on the Releases page.

## How it works

KEF's W2 platform exposes a local HTTP/JSON API on port 80:

- `GET /api/getData` and `POST /api/setData` read and write state (power, source, volume, mute, settings).
- `GET /api/getRows` reads list-style data such as the DSP profile.
- `POST /api/event/modifyQueue` + `GET /api/event/pollQueue` long-poll for live state updates.

Reads are open; writing DSP and host settings requires a signed `HMAC_SHA256_AES256` request, which the app builds natively in Rust. See `PLAN.md` for the full protocol reference.

## Project layout

```
app/
  crates/kef-client/   Pure-Rust speaker protocol library
  src-tauri/           Tauri v2 shell exposing the client over IPC
  src/                 React + TypeScript UI
tools/                 Developer scripts used while reverse-engineering the API
.github/workflows/     CI that builds and publishes installers on a version tag
PLAN.md                Architecture and protocol notes
```

Built with [Tauri v2](https://tauri.app) (Rust) and React + TypeScript.

## Disclaimer

KEF Control is an unofficial, community-built app and is not affiliated with, endorsed by, or supported by KEF or GP Acoustics. "KEF" and its line-up of speakers are trademarks of their respective owners. The app controls the speaker over its local network API and may break with future firmware updates. Provided as-is, without warranty of any kind - use at your own risk.

## License

[MIT](LICENSE)
