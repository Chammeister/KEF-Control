use kef_client::{KefSpeaker, NowPlaying, Source, SpeakerOverview, StateUpdate};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

/// Currently connected speaker (None until `connect` succeeds).
struct AppState {
    speaker: Mutex<Option<KefSpeaker>>,
    /// Last selected *real* input (coaxial/optic/wifi/...), used to restore
    /// the source on power-on instead of waking into Wi-Fi by default.
    last_source: Mutex<Option<String>>,
    /// Where to park the window on launch / show (set from the UI).
    window_anchor: std::sync::Mutex<String>,
}

fn err_str(e: impl std::fmt::Display) -> String {
    e.to_string()
}

// ---------- desktop helpers (tray / media keys) ----------

/// Park the main window at the given anchor on the current monitor.
/// Anchors: top-left|top-center|top-right|center|bottom-left|bottom-center|bottom-right.
fn position_window(app: &AppHandle, anchor: &str) {
    if let Some(w) = app.get_webview_window("main") {
        if let (Ok(Some(mon)), Ok(ws)) = (w.current_monitor(), w.outer_size()) {
            let ms = mon.size();
            let mpos = mon.position();
            let sf = mon.scale_factor();
            let margin = (12.0 * sf) as i32;
            let taskbar = (48.0 * sf) as i32; // approximate taskbar reserve
            let availw = ms.width as i32;
            let availh = ms.height as i32 - taskbar;
            let ww = ws.width as i32;
            let wh = ws.height as i32;
            let left = margin;
            let cx = (availw - ww) / 2;
            let right = availw - ww - margin;
            let top = margin;
            let cy = (availh - wh) / 2;
            let bottom = availh - wh - margin;
            let (x, y) = match anchor {
                "top-left" => (left, top),
                "top-center" => (cx, top),
                "top-right" => (right, top),
                "center" => (cx, cy),
                "bottom-left" => (left, bottom),
                "bottom-center" => (cx, bottom),
                _ => (right, bottom), // bottom-right default
            };
            let _ = w.set_position(tauri::PhysicalPosition::new(
                mpos.x + x.max(0),
                mpos.y + y.max(0),
            ));
        }
    }
}

/// Position the window using the anchor stored in app state.
fn reposition(app: &AppHandle) {
    let anchor = app
        .state::<AppState>()
        .window_anchor
        .lock()
        .map(|a| a.clone())
        .unwrap_or_else(|_| "bottom-right".into());
    position_window(app, &anchor);
}

// ---------- persisted window anchor ----------
//
// The chosen anchor is saved to disk so the window can be placed at startup
// (including launch-at-startup) *before* the WebView has loaded and told us
// which anchor to use. Without this, startup placement falls back to a default.

fn anchor_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("window_anchor"))
}

/// Read the saved anchor (falls back to bottom-right on first run).
fn load_saved_anchor(app: &AppHandle) -> String {
    anchor_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "bottom-right".into())
}

/// Persist the chosen anchor for the next launch.
fn save_anchor(app: &AppHandle, anchor: &str) {
    if let Some(p) = anchor_path(app) {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(p, anchor);
    }
}

/// Show the main window if hidden, hide it if visible.
fn toggle_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            reposition(app);
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

/// Run a fire-and-forget speaker command from a tray/hotkey handler (no-op if
/// not connected). Generic over runtime so it works from both the tray (Wry)
/// and the runtime-generic global-shortcut handler.
fn run_speaker<R, F, Fut>(app: &AppHandle<R>, f: F)
where
    R: tauri::Runtime,
    F: FnOnce(KefSpeaker) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = kef_client::Result<()>> + Send,
{
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let speaker = { app.state::<AppState>().speaker.lock().await.clone() };
        if let Some(s) = speaker {
            let _ = f(s).await;
        }
    });
}

// ---------- launch-at-startup ----------

#[tauri::command]
fn get_autostart(app: AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(err_str)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let al = app.autolaunch();
    if enabled {
        al.enable().map_err(err_str)
    } else {
        al.disable().map_err(err_str)
    }
}

/// Set the window anchor (persisted in app state) and reposition immediately.
#[tauri::command]
fn set_window_position(anchor: String, app: AppHandle) -> Result<(), String> {
    if let Ok(mut a) = app.state::<AppState>().window_anchor.lock() {
        *a = anchor.clone();
    }
    save_anchor(&app, &anchor);
    position_window(&app, &anchor);
    Ok(())
}

/// Open a URL in the user's default browser.
///
/// Hardened against command injection: only `http`/`https` URLs are accepted,
/// and any shell-significant or control characters are rejected before the URL
/// is ever handed to a launcher process. (Today the only caller passes a
/// compile-time constant, but this keeps the IPC command safe by construction.)
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let url = url.trim();
    let scheme_ok = url.starts_with("https://") || url.starts_with("http://");
    // Reject anything that could break out of an argument / shell invocation.
    let has_bad = url.chars().any(|c| {
        c.is_control() || c.is_whitespace() || "\"'`\\&|;<>^%$(){}[]*?!".contains(c)
    });
    if !scheme_ok || has_bad || url.len() > 2048 {
        return Err("Refused to open an unsafe or non-http(s) URL".into());
    }

    #[cfg(target_os = "windows")]
    // Pass the URL as the title-less START target; no shell metacharacters can
    // reach cmd because they are rejected above.
    let r = std::process::Command::new("cmd").args(["/C", "start", "", url]).spawn();
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(url).spawn();
    #[cfg(target_os = "linux")]
    let r = std::process::Command::new("xdg-open").arg(url).spawn();
    r.map(|_| ()).map_err(err_str)
}

/// True for actual inputs - excludes the pseudo-sources `standby`/`powerOn`.
fn is_real_source(s: &str) -> bool {
    matches!(
        s,
        "wifi" | "bluetooth" | "tv" | "optic" | "coaxial" | "analog" | "usb"
    )
}

async fn with_speaker<T, F, Fut>(state: &State<'_, AppState>, f: F) -> Result<T, String>
where
    F: FnOnce(KefSpeaker) -> Fut,
    Fut: std::future::Future<Output = kef_client::Result<T>>,
{
    let speaker = state
        .speaker
        .lock()
        .await
        .clone()
        .ok_or("Not connected to a speaker")?;
    f(speaker).await.map_err(err_str)
}

/// Connect to a speaker by IP/hostname. Verifies connectivity and
/// returns an initial state snapshot.
#[tauri::command]
async fn connect(host: String, state: State<'_, AppState>) -> Result<SpeakerOverview, String> {
    let speaker = KefSpeaker::new(host.trim()).map_err(err_str)?;
    let overview = speaker.overview().await.map_err(|e| {
        format!("Could not reach speaker at {}: {}", host.trim(), e)
    })?;
    if overview.status == "powerOn" && is_real_source(&overview.source) {
        *state.last_source.lock().await = Some(overview.source.clone());
    }
    *state.speaker.lock().await = Some(speaker);
    Ok(overview)
}

#[tauri::command]
async fn disconnect(state: State<'_, AppState>) -> Result<(), String> {
    *state.speaker.lock().await = None;
    Ok(())
}

#[tauri::command]
async fn get_overview(state: State<'_, AppState>) -> Result<SpeakerOverview, String> {
    let overview = with_speaker(&state, |s| async move { s.overview().await }).await?;
    // Keep track of the live input so power-on can restore it.
    if overview.status == "powerOn" && is_real_source(&overview.source) {
        *state.last_source.lock().await = Some(overview.source.clone());
    }
    Ok(overview)
}

#[tauri::command]
async fn power_on(state: State<'_, AppState>) -> Result<(), String> {
    // Restore the last real input rather than waking into Wi-Fi: setting a
    // physical source also powers the speaker on. Fall back to a plain
    // power-on if we've never observed a concrete source this session.
    let restore = state
        .last_source
        .lock()
        .await
        .as_deref()
        .and_then(Source::from_api);
    match restore {
        Some(src) => with_speaker(&state, |s| async move { s.set_source(src).await }).await,
        None => with_speaker(&state, |s| async move { s.power_on().await }).await,
    }
}

#[tauri::command]
async fn power_off(state: State<'_, AppState>) -> Result<(), String> {
    with_speaker(&state, |s| async move { s.shutdown().await }).await
}

#[tauri::command]
async fn set_source(source: String, state: State<'_, AppState>) -> Result<(), String> {
    let src = Source::from_api(&source).ok_or(format!("Unknown source: {source}"))?;
    with_speaker(&state, |s| async move { s.set_source(src).await }).await?;
    if is_real_source(&source) {
        *state.last_source.lock().await = Some(source);
    }
    Ok(())
}

#[tauri::command]
async fn set_volume(volume: i32, state: State<'_, AppState>) -> Result<(), String> {
    with_speaker(&state, |s| async move { s.set_volume(volume).await }).await
}

#[tauri::command]
async fn set_mute(mute: bool, state: State<'_, AppState>) -> Result<(), String> {
    with_speaker(&state, |s| async move { s.set_mute(mute).await }).await
}

#[tauri::command]
async fn play_pause(state: State<'_, AppState>) -> Result<(), String> {
    with_speaker(&state, |s| async move { s.toggle_play_pause().await }).await
}

#[tauri::command]
async fn next_track(state: State<'_, AppState>) -> Result<(), String> {
    with_speaker(&state, |s| async move { s.next_track().await }).await
}

#[tauri::command]
async fn previous_track(state: State<'_, AppState>) -> Result<(), String> {
    with_speaker(&state, |s| async move { s.previous_track().await }).await
}

#[tauri::command]
async fn now_playing(state: State<'_, AppState>) -> Result<NowPlaying, String> {
    with_speaker(&state, |s| async move { s.now_playing().await }).await
}

#[tauri::command]
async fn play_time(state: State<'_, AppState>) -> Result<i64, String> {
    with_speaker(&state, |s| async move { s.play_time().await }).await
}

// ---------- DSP / EQ ----------

#[tauri::command]
async fn get_eq_profile(state: State<'_, AppState>) -> Result<Value, String> {
    with_speaker(&state, |s| async move { s.dsp_profile().await }).await
}

/// Patch one DSP field; returns the re-read profile so the UI can confirm it.
#[tauri::command]
async fn set_dsp_field(
    key: String,
    value: Value,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    with_speaker(&state, |s| async move { s.set_dsp_field(&key, value).await }).await
}

// ---------- host / device settings ----------

#[tauri::command]
async fn get_settings_profile(state: State<'_, AppState>) -> Result<Value, String> {
    with_speaker(&state, |s| async move { s.settings_profile().await }).await
}

/// Patch one host setting (authenticated); returns the re-read profile.
#[tauri::command]
async fn set_setting(
    key: String,
    value: Value,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    with_speaker(&state, |s| async move { s.set_setting(&key, value).await }).await
}

/// Create an event subscription queue; returns the queue id.
#[tauri::command]
async fn create_event_queue(state: State<'_, AppState>) -> Result<String, String> {
    with_speaker(&state, |s| async move { s.create_event_queue().await }).await
}

/// Long-poll for state changes (blocks up to `timeout_secs` server-side).
#[tauri::command]
async fn poll_events(
    queue_id: String,
    timeout_secs: u64,
    state: State<'_, AppState>,
) -> Result<StateUpdate, String> {
    with_speaker(&state, |s| async move { s.poll_events(&queue_id, timeout_secs).await }).await
}

/// Media keys (play/pause, next, previous) controlling the speaker globally.
fn media_shortcut_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_global_shortcut::{Code, Shortcut, ShortcutState};
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            if *shortcut == Shortcut::new(None, Code::MediaPlayPause) {
                run_speaker(app, |s| async move { s.toggle_play_pause().await });
            } else if *shortcut == Shortcut::new(None, Code::MediaTrackNext) {
                run_speaker(app, |s| async move { s.next_track().await });
            } else if *shortcut == Shortcut::new(None, Code::MediaTrackPrevious) {
                run_speaker(app, |s| async move { s.previous_track().await });
            }
        })
        .build()
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "show", "Show / Hide Window", true, None::<&str>)?;
    let power = MenuItem::with_id(app, "power", "Power On / Standby", true, None::<&str>)?;
    let play = MenuItem::with_id(app, "play", "Play / Pause", true, None::<&str>)?;
    let mute = MenuItem::with_id(app, "mute", "Mute / Unmute", true, None::<&str>)?;
    let volup = MenuItem::with_id(app, "volup", "Volume +", true, None::<&str>)?;
    let voldn = MenuItem::with_id(app, "voldn", "Volume -", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &power, &play, &mute, &volup, &voldn, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("KEF Control")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => toggle_window(app),
            "quit" => app.exit(0),
            "power" => run_speaker(app, |s| async move {
                let st = s.status().await.unwrap_or_default();
                if st == "powerOn" {
                    s.shutdown().await
                } else {
                    s.power_on().await
                }
            }),
            "play" => run_speaker(app, |s| async move { s.toggle_play_pause().await }),
            "mute" => run_speaker(app, |s| async move {
                let m = s.muted().await.unwrap_or(false);
                s.set_mute(!m).await
            }),
            "volup" => run_speaker(app, |s| async move {
                let v = s.volume().await.unwrap_or(0);
                s.set_volume((v + 5).min(100)).await
            }),
            "voldn" => run_speaker(app, |s| async move {
                let v = s.volume().await.unwrap_or(0);
                s.set_volume((v - 5).max(0)).await
            }),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

pub fn run() {
    use tauri_plugin_global_shortcut::{Code, Shortcut};

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(media_shortcut_plugin())
        .manage(AppState {
            speaker: Mutex::new(None),
            last_source: Mutex::new(None),
            window_anchor: std::sync::Mutex::new("bottom-right".into()),
        })
        .invoke_handler(tauri::generate_handler![
            connect,
            disconnect,
            get_overview,
            power_on,
            power_off,
            set_source,
            set_volume,
            set_mute,
            play_pause,
            next_track,
            previous_track,
            now_playing,
            play_time,
            get_eq_profile,
            set_dsp_field,
            get_settings_profile,
            set_setting,
            create_event_queue,
            poll_events,
            get_autostart,
            set_autostart,
            set_window_position,
            open_url,
        ])
        .setup(|app| {
            build_tray(app.handle())?;
            // Restore the user's saved window position so the app opens where
            // they configured it - including on launch-at-startup. The anchor is
            // read from disk so it's known before the WebView loads.
            {
                let saved = load_saved_anchor(app.handle());
                if let Ok(mut a) = app.state::<AppState>().window_anchor.lock() {
                    *a = saved;
                }
            }
            reposition(app.handle());
            // At cold boot / autostart the monitor work area may not be settled
            // when we first place the window, which can leave it in the wrong
            // spot. Re-apply the position a couple of times as the desktop
            // initializes; once it's already correct these are no-ops.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                for delay in [500u64, 1500] {
                    std::thread::sleep(std::time::Duration::from_millis(delay));
                    let h = handle.clone();
                    let _ = handle.run_on_main_thread(move || reposition(&h));
                }
            });
            // Register the media keys as global shortcuts.
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            let gs = app.global_shortcut();
            for code in [Code::MediaPlayPause, Code::MediaTrackNext, Code::MediaTrackPrevious] {
                let _ = gs.register(Shortcut::new(None, code));
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides to tray instead of quitting.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
