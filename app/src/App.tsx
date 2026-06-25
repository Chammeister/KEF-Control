import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  DspProfile,
  NowPlaying,
  SettingsProfile,
  SpeakerOverview,
  StateUpdate,
} from "./types";
import AudioTab from "./AudioTab";
import DeviceTab, { fmtFirmware } from "./DeviceTab";
import remoteIco from "./assets/tab-remote.png";
import eqIco from "./assets/tab-eq.png";
import settingsIco from "./assets/tab-settings.png";

const SOURCES = ["wifi", "bluetooth", "tv", "optic", "coaxial", "analog"] as const;

const SOURCE_LABELS: Record<string, string> = {
  wifi: "Wi-Fi",
  bluetooth: "Bluetooth",
  tv: "TV / HDMI",
  optic: "Optical",
  coaxial: "Coaxial",
  analog: "AUX",
  standby: "Standby",
};

const STREAMING_SOURCES = new Set(["wifi", "bluetooth"]);
const REAL_SOURCES = new Set<string>([
  "wifi", "bluetooth", "tv", "optic", "coaxial", "analog",
]);
const lastSourceKey = (host: string) => `kef_last_source:${host}`;
const PLACEHOLDER_TITLES = new Set([
  "coax", "coaxial", "optical", "optic", "tv", "tv / hdmi", "hdmi",
  "aux", "analog", "wifi", "wi-fi", "bluetooth", "standby",
]);

type Tab = "remote" | "audio" | "device";

/* ----------------------------- icons ----------------------------- */
function MuteIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 L6 9 H3 V15 H6 L11 19 Z" fill="currentColor" stroke="none" />
      {muted ? (
        <>
          <line x1="16" y1="9" x2="22" y2="15" />
          <line x1="22" y1="9" x2="16" y2="15" />
        </>
      ) : (
        <>
          <path d="M15.5 8.5 a5 5 0 0 1 0 7" />
          <path d="M18.5 6 a9 9 0 0 1 0 12" />
        </>
      )}
    </svg>
  );
}
const PrevIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5 9 12l11 7z" /></svg>
);
const NextIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5l11 7L4 19z" /></svg>
);
const PlayIcon = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8L7 20z" /></svg>
);
const PauseIcon = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
);
const WifiIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
    <path d="M5 12.5a10 10 0 0 1 14 0M8 15.5a6 6 0 0 1 8 0" />
    <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
  </svg>
);
const BluetoothIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    <path d="M7 8l10 8-5 4V4l5 4-10 8" />
  </svg>
);
// Source circle content + label, matching KEF Connect.
const SOURCE_TILE: Record<string, { glyph: ReactNode; label: string }> = {
  wifi: { glyph: <WifiIcon />, label: "Wi-Fi" },
  bluetooth: { glyph: <BluetoothIcon />, label: "Bluetooth" },
  tv: { glyph: "TV", label: "TV" },
  optic: { glyph: "OPT", label: "Optical" },
  coaxial: { glyph: "CX", label: "COAX" },
  analog: { glyph: "AUX", label: "AUX" },
};

// KEF Connect's own icons (supplied as PNGs), tinted via CSS mask so they
// follow the active/inactive colour.
const TAB_ICONS: Record<Tab, string> = {
  remote: remoteIco,
  audio: eqIco,
  device: settingsIco,
};

function ThemeIcon({ theme }: { theme: string }) {
  return theme === "dark" ? (
    // sun (click to go light)
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
    </svg>
  ) : (
    // moon (click to go dark)
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* --------------------------------------------------------------- */

export default function App() {
  const [host, setHost] = useState(localStorage.getItem("kef_host") ?? "");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<SpeakerOverview | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [volumeDrag, setVolumeDrag] = useState<number | null>(null);
  const [live, setLive] = useState(false);
  const [tab, setTab] = useState<Tab>("remote");
  const [position, setPosition] = useState(0);
  const [dsp, setDsp] = useState<DspProfile | null>(null);
  const [dspBusy, setDspBusy] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsProfile | null>(null);
  const [settingsBusy, setSettingsBusy] = useState<string | null>(null);
  const [theme, setTheme] = useState<string>(() => localStorage.getItem("kef_theme") ?? "dark");
  const [autostart, setAutostart] = useState(false);
  const [winAnchor, setWinAnchor] = useState<string>(
    () => localStorage.getItem("kef_win_pos") ?? "bottom-right"
  );
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const draggingRef = useRef(false);

  // ----- derived state -----
  const isOn = overview?.status === "powerOn";
  const streaming = STREAMING_SOURCES.has(overview?.source ?? "");
  const hasTrack =
    !!nowPlaying?.title &&
    !PLACEHOLDER_TITLES.has(nowPlaying.title.trim().toLowerCase());
  const showNowPlaying = streaming && hasTrack;

  // Apply + persist the colour theme on <html data-theme>.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("kef_theme", theme);
  }, [theme]);

  // Load launch-at-startup state once (app-level, independent of the speaker).
  useEffect(() => {
    invoke<boolean>("get_autostart").then(setAutostart).catch(() => {});
  }, []);

  // Auto-connect on launch using the remembered IP (the user sets a DHCP
  // reservation so it never changes). Only falls back to manual entry if there's
  // no saved IP or the connection fails.
  useEffect(() => {
    if (localStorage.getItem("kef_host")) handleConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply the saved window position on launch.
  useEffect(() => {
    invoke("set_window_position", { anchor: winAnchor }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeWinAnchor = useCallback((a: string) => {
    setWinAnchor(a);
    localStorage.setItem("kef_win_pos", a);
    invoke("set_window_position", { anchor: a }).catch((e) => setError(String(e)));
  }, []);

  const openUrl = useCallback((url: string) => {
    invoke("open_url", { url }).catch(() => {});
  }, []);

  const toggleAutostart = useCallback(async () => {
    const next = !autostart;
    try {
      await invoke("set_autostart", { enabled: next });
      setAutostart(next);
    } catch (e) {
      setError(String(e));
    }
  }, [autostart]);

  // ----- data loaders -----
  const refresh = useCallback(async () => {
    try {
      const ov = await invoke<SpeakerOverview>("get_overview");
      setOverview((prev) =>
        draggingRef.current && prev ? { ...ov, volume: prev.volume } : ov
      );
      setError(null);
      if (ov.status === "powerOn" && ov.source === "wifi") {
        try {
          setNowPlaying(await invoke<NowPlaying>("now_playing"));
        } catch {
          setNowPlaying(null);
        }
      } else {
        setNowPlaying(null);
      }
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const applyUpdate = useCallback((u: StateUpdate) => {
    setOverview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        source: u.source ?? prev.source,
        volume: !draggingRef.current && u.volume != null ? u.volume : prev.volume,
        muted: u.muted ?? prev.muted,
        status: u.speaker_status ?? prev.status,
        name: u.device_name ?? prev.name,
      };
    });
    if (u.now_playing) setNowPlaying(u.now_playing);
  }, []);

  const loadDsp = useCallback(async () => {
    try {
      setDsp(await invoke<DspProfile>("get_eq_profile"));
    } catch {
      setDsp(null);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      setSettings(await invoke<SettingsProfile>("get_settings_profile"));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // ----- live event sync (long-poll, with polling fallback) -----
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    let pollTimer: number | null = null;

    const startFallbackPolling = () => {
      setLive(false);
      refresh();
      pollTimer = window.setInterval(refresh, 3000);
    };

    const runEventLoop = async () => {
      await refresh();
      let queueId: string | null = null;
      try {
        queueId = await invoke<string>("create_event_queue");
      } catch {
        if (!cancelled) startFallbackPolling();
        return;
      }
      if (cancelled) return;
      setLive(true);
      while (!cancelled) {
        try {
          const upd = await invoke<StateUpdate>("poll_events", { queueId, timeoutSecs: 25 });
          if (cancelled) break;
          applyUpdate(upd);
          setLive(true);
          setError(null);
        } catch {
          if (cancelled) break;
          setLive(false);
          try {
            queueId = await invoke<string>("create_event_queue");
          } catch {
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      }
    };

    runEventLoop();
    return () => {
      cancelled = true;
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, [connected, refresh, applyUpdate]);

  // Load DSP / device data when the relevant tab is opened.
  useEffect(() => {
    if (!connected) return;
    if (tab === "audio") loadDsp();
    if (tab === "device") loadSettings();
  }, [tab, connected, loadDsp, loadSettings]);

  // DSP is per-source - reload when the source changes while on the Audio tab.
  useEffect(() => {
    if (connected && tab === "audio") loadDsp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview?.source]);

  // Remember the last real input on disk so power-on can restore it even after
  // the app is closed or the speaker sat in standby overnight.
  useEffect(() => {
    const src = overview?.source;
    if (overview?.status === "powerOn" && src && REAL_SOURCES.has(src)) {
      localStorage.setItem(lastSourceKey(host), src);
    }
  }, [overview?.source, overview?.status, host]);

  // Poll playback position for the progress bar while a track is playing.
  useEffect(() => {
    if (!connected || !showNowPlaying) return;
    let active = true;
    const tick = async () => {
      try {
        const ms = await invoke<number>("play_time");
        if (active) setPosition(ms);
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [connected, showNowPlaying, nowPlaying?.title]);

  // ----- actions -----
  async function handleConnect() {
    setBusy(true);
    setError(null);
    try {
      const ov = await invoke<SpeakerOverview>("connect", { host });
      localStorage.setItem("kef_host", host);
      setOverview(ov);
      setConnected(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doDisconnect() {
    try {
      await invoke("disconnect");
    } catch {
      /* ignore - we're tearing the session down anyway */
    }
    setConfirmDisconnect(false);
    setConnected(false);
    setOverview(null);
    setNowPlaying(null);
    setDsp(null);
    setSettings(null);
    setLive(false);
    setTab("remote");
  }

  async function cmd(name: string, args?: Record<string, unknown>) {
    try {
      await invoke(name, args);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  // Power on by re-selecting the persisted source (which also wakes the
  // speaker), so it never defaults to Wi-Fi. Falls back to a plain power-on
  // only if we've genuinely never seen a source for this speaker.
  function togglePower() {
    if (isOn) {
      cmd("power_off");
      return;
    }
    const stored = localStorage.getItem(lastSourceKey(host));
    if (stored && REAL_SOURCES.has(stored)) {
      cmd("set_source", { source: stored });
    } else {
      cmd("power_on");
    }
  }

  const setField = useCallback(
    async (key: string, value: number | boolean | string) => {
      setDspBusy(key);
      try {
        const updated = await invoke<DspProfile>("set_dsp_field", { key, value });
        setDsp(updated);
        setError(null);
      } catch (e) {
        setError(String(e));
      } finally {
        setDspBusy(null);
      }
    },
    []
  );

  const setSetting = useCallback(
    async (key: string, value: number | boolean | string) => {
      setSettingsBusy(key);
      try {
        const updated = await invoke<SettingsProfile>("set_setting", { key, value });
        setSettings(updated);
        setError(null);
      } catch (e) {
        setError(String(e));
      } finally {
        setSettingsBusy(null);
      }
    },
    []
  );

  // ----- connect screen -----
  if (!connected) {
    // While auto-connecting (saved IP, no error yet) show a clean connecting state.
    if (busy && !error) {
      return (
        <div className="app connect-screen">
          <h1>KEF Control</h1>
          <p className="hint">Connecting to your speaker at {host}…</p>
        </div>
      );
    }
    return (
      <div className="app connect-screen">
        <h1>KEF Control</h1>
        <p className="hint">
          Enter your speaker's IP address (KEF Connect → Settings → Speaker info,
          or your router's client list). It'll be remembered after this.
        </p>
        <div className="connect-row">
          <input
            value={host}
            placeholder="e.g. 192.168.1.50"
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && host && handleConnect()}
            autoFocus
          />
          <button className="primary" disabled={!host || busy} onClick={handleConnect}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>
    );
  }

  const muted = overview?.muted ?? false;
  const volume = overview?.volume ?? 0;
  // While muted the slider sits at 0 (KEF-style); the number still shows the level.
  const sliderValue = volumeDrag ?? (muted ? 0 : volume);
  const isPlaying = showNowPlaying && nowPlaying?.state === "playing";
  const sliderFill = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${sliderValue}%, var(--track) ${sliderValue}%, var(--track) 100%)`;
  // Source label for the "playback not supported" message.
  const srcLabel = (SOURCE_TILE[overview?.source ?? ""]?.label ?? overview?.source ?? "this").toUpperCase();
  const duration = nowPlaying?.duration_ms ?? 0;
  const progressPct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <div className="app">
      <header>
        <div className="title-block">
          <h1>{overview?.name ?? "Speaker"}</h1>
          <span className="sub">
            <span className={live ? "live-dot on" : "live-dot"} title={live ? "Live" : "Reconnecting…"} />
            {overview?.model} · v{fmtFirmware(overview?.firmware)} · {host}
          </span>
        </div>
        <div className="header-actions">
          <button
            className="icon-ghost"
            title={theme === "dark" ? "Light theme" : "Dark theme"}
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <ThemeIcon theme={theme} />
          </button>
          <button
            className={isOn ? "power on" : "power"}
            title={isOn ? "Standby" : "Power on"}
            aria-label={isOn ? "Standby" : "Power on"}
            onClick={togglePower}
          >
            ⏻
          </button>
        </div>
      </header>

      <div className="app-scroll">
      {error && <div className="error">{error}</div>}

      {tab === "remote" && (
        <>
          <section>
            <div className="source-grid">
              {SOURCES.map((s) => (
                <button
                  key={s}
                  className={overview?.source === s ? "source-tile active" : "source-tile"}
                  onClick={() => cmd("set_source", { source: s })}
                  title={SOURCE_TILE[s].label}
                >
                  <span className="source-circle">{SOURCE_TILE[s].glyph}</span>
                  <span className="source-label">{SOURCE_TILE[s].label}</span>
                </button>
              ))}
            </div>
            {!isOn && (
              <p className="hint standby-hint">
                Speaker is in standby - pick a source, or press the power button, to turn it on.
              </p>
            )}
          </section>

          <section>
            <h2>Volume <span className={muted ? "vol-num muted" : "vol-num"}>{volume}</span></h2>
            <div className="volume-row">
              <input
                type="range"
                min={0}
                max={100}
                value={sliderValue}
                style={{ background: sliderFill }}
                onChange={(e) => setVolumeDrag(Number(e.target.value))}
                onPointerDown={() => {
                  draggingRef.current = true;
                }}
                onPointerUp={() => {
                  if (volumeDrag !== null) {
                    const v = volumeDrag;
                    cmd("set_volume", { volume: v });
                    setOverview((prev) => (prev ? { ...prev, volume: v, muted: false } : prev));
                    if (muted) cmd("set_mute", { mute: false }); // adjusting volume unmutes
                  }
                  draggingRef.current = false;
                  setVolumeDrag(null);
                }}
              />
              <button
                className="mute-btn"
                title={muted ? "Unmute" : "Mute"}
                aria-label={muted ? "Unmute" : "Mute"}
                aria-pressed={muted}
                onClick={() => cmd("set_mute", { mute: !muted })}
              >
                <MuteIcon muted={muted} />
              </button>
            </div>
          </section>

          <section>
            <h2>Playback</h2>
            {!streaming ? (
              <p className="hint" style={{ textAlign: "center", margin: "10px 0 4px" }}>
                Playback control is not supported in {srcLabel} mode
              </p>
            ) : (
            <>
            <div className="transport">
              <button onClick={() => cmd("previous_track")} title="Previous" aria-label="Previous"><PrevIcon /></button>
              <button
                className="big"
                onClick={() => cmd("play_pause")}
                title={isPlaying ? "Pause" : "Play"}
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button onClick={() => cmd("next_track")} title="Next" aria-label="Next"><NextIcon /></button>
            </div>
            {showNowPlaying && nowPlaying && (
              <div className="now-playing">
                {nowPlaying.cover_url ? (
                  <img src={nowPlaying.cover_url} alt="" />
                ) : (
                  <div className="np-art-fallback" aria-hidden="true">♪</div>
                )}
                <div className="np-meta">
                  <div className="np-title">{nowPlaying.title}</div>
                  <div className="np-sub">
                    {[nowPlaying.artist, nowPlaying.album].filter(Boolean).join(" - ")}
                  </div>
                  {nowPlaying.codec && (
                    <div className="np-codec">
                      {nowPlaying.codec.toUpperCase()}
                      {nowPlaying.sample_rate ? ` · ${(nowPlaying.sample_rate / 1000).toFixed(1)} kHz` : ""}
                    </div>
                  )}
                </div>
              </div>
            )}
            {showNowPlaying && duration > 0 && (
              <div className="progress">
                <div className="progress-bar"><div className="progress-fill" style={{ width: `${progressPct}%` }} /></div>
                <div className="progress-time">
                  <span>{fmtTime(position)}</span>
                  <span>{fmtTime(duration)}</span>
                </div>
              </div>
            )}
            </>
            )}
          </section>
        </>
      )}

      {tab === "audio" && (
        <section>
          <h2>EQ</h2>
          <AudioTab dsp={dsp} source={overview?.source ?? ""} busyKey={dspBusy} setField={setField} />
        </section>
      )}

      {tab === "device" && (
        <section>
          <h2>Settings</h2>
          <DeviceTab
            overview={overview}
            host={host}
            settings={settings}
            busyKey={settingsBusy}
            setSetting={setSetting}
            autostart={autostart}
            onToggleAutostart={toggleAutostart}
            winAnchor={winAnchor}
            onWinAnchor={changeWinAnchor}
            onOpenUrl={openUrl}
          />
        </section>
      )}

      <footer>
        <span className="sub">
          {isOn
            ? `On · ${SOURCE_LABELS[overview?.source ?? ""] ?? overview?.source ?? ""}`
            : "Standby"}
        </span>
        <button className="link" onClick={() => setConfirmDisconnect(true)}>
          Disconnect
        </button>
      </footer>
      </div>

      <nav className="bottom-tabs">
        {([
          ["remote", "Remote"],
          ["audio", "EQ"],
          ["device", "Settings"],
        ] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "bottom-tab active" : "bottom-tab"}
            onClick={() => setTab(id)}
          >
            <span
              className="tab-ico"
              style={{
                WebkitMaskImage: `url(${TAB_ICONS[id]})`,
                maskImage: `url(${TAB_ICONS[id]})`,
              }}
            />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {confirmDisconnect && (
        <div className="modal-overlay" onClick={() => setConfirmDisconnect(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">Disconnect speaker?</h2>
            <p className="modal-text">
              This disconnects the app from your speaker. The speaker keeps
              playing - you can reconnect anytime by entering its IP address.
            </p>
            <div className="modal-actions">
              <button className="modal-btn modal-yes" onClick={doDisconnect}>
                Yes
              </button>
              <button className="modal-btn modal-no" onClick={() => setConfirmDisconnect(false)}>
                No
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
