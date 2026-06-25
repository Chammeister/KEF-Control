import { useState } from "react";
import type { SettingsProfile, SpeakerOverview } from "./types";

type FieldValue = number | boolean | string;

interface Props {
  overview: SpeakerOverview | null;
  host: string;
  settings: SettingsProfile | null;
  busyKey: string | null;
  setSetting: (key: string, value: FieldValue) => void;
  autostart: boolean;
  onToggleAutostart: () => void;
  winAnchor: string;
  onWinAnchor: (anchor: string) => void;
  onOpenUrl: (url: string) => void;
}

const APP_VERSION = "0.1.1";
const GITHUB_URL = "https://github.com/Chammeister/KEF-Control";
const DISCLAIMER =
  "KEF Control is an unofficial, community-built app and is not affiliated with, " +
  "endorsed by, or supported by KEF or GP Acoustics. \"KEF\" and its line-up of " +
  "speakers are trademarks of their respective owners. The app controls the speaker " +
  "over its local network API and may break with future firmware updates. Provided " +
  "as-is, without warranty of any kind - use at your own risk.";

const WIN_POSITIONS: [string, string][] = [
  ["bottom-right", "Bottom Right"],
  ["bottom-center", "Bottom Center"],
  ["bottom-left", "Bottom Left"],
  ["center", "Center"],
  ["top-right", "Top Right"],
  ["top-center", "Top Center"],
  ["top-left", "Top Left"],
];

// "V41191" -> "4.1.191" (KEF's displayed format: major.minor.patch)
export function fmtFirmware(fw?: string): string {
  if (!fw) return "-";
  const d = fw.replace(/[^0-9]/g, "");
  return d.length >= 3 ? `${d[0]}.${d[1]}.${d.slice(2)}` : fw;
}

function Toggle(props: { on: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <button
      className={props.on ? "toggle on" : "toggle"}
      disabled={props.disabled}
      onClick={props.onToggle}
      role="switch"
      aria-checked={props.on}
    >
      <span className="knob" />
    </button>
  );
}

function Segmented(props: {
  options: [string, string][];
  value: string;
  busy?: boolean;
  onPick: (v: string) => void;
}) {
  return (
    <div className="segmented">
      {props.options.map(([val, label]) => (
        <button
          key={val}
          className={props.value === val ? "seg active" : "seg"}
          disabled={props.busy}
          onClick={() => props.onPick(val)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Slider(props: {
  min: number; max: number; step: number; value: number;
  disabled?: boolean; onCommit: (v: number) => void; format: (v: number) => string;
}) {
  const { min, max, step, value, disabled, onCommit, format } = props;
  const [drag, setDrag] = useState<number | null>(null);
  const v = drag ?? value;
  const pct = ((v - min) / (max - min)) * 100;
  const fill = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--track) ${pct}%, var(--track) 100%)`;
  return (
    <div className="dsp-slider">
      <input type="range" min={min} max={max} step={step} value={v} disabled={disabled}
        style={{ background: fill }}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => { if (drag !== null) { onCommit(drag); setDrag(null); } }} />
      <span className="dsp-value">{format(v)}</span>
    </div>
  );
}

export default function DeviceTab({ overview, host, settings, busyKey, setSetting, autostart, onToggleAutostart, winAnchor, onWinAnchor, onOpenUrl }: Props) {
  const s = settings;
  const busy = (k: string) => busyKey === k;
  const bool = (k: string) => s?.[k] === true;
  const str = (k: string, fb: string) => (typeof s?.[k] === "string" ? (s![k] as string) : fb);
  const num = (k: string, fb: number) => (typeof s?.[k] === "number" ? (s![k] as number) : fb);

  return (
    <div className="device">
      <div className="info-grid">
        <span className="info-k">Speaker name</span><span className="info-v">{overview?.name ?? "-"}</span>
        <span className="info-k">Model</span><span className="info-v">{overview?.model ?? "-"}</span>
        <span className="info-k">Firmware version</span><span className="info-v">{fmtFirmware(overview?.firmware)}</span>
        <span className="info-k">IP address</span><span className="info-v">{host}</span>
        <span className="info-k">MAC address</span><span className="info-v">{s?.mac || "-"}</span>
      </div>

      {!s && <p className="hint">Loading settings…</p>}

      {s && (
        <>
          <h2 style={{ marginTop: 16 }}>Speaker Preferences</h2>

          <div className="dsp-row">
            <label>Standby Timer</label>
            <Segmented value={str("standbyMode", "standby_30mins")} busy={busy("standbyMode")}
              onPick={(v) => setSetting("standbyMode", v)}
              options={[["standby_20mins", "ECO"], ["standby_30mins", "30"], ["standby_60mins", "60"], ["standby_none", "Never"]]} />
          </div>

          <div className="dsp-row">
            <label>
              Second Wake-Up Source
              <span className="row-sub">Auto-wakes when this input gets signal</span>
            </label>
            <select value={str("wakeUpSource", "wakeup_default")} disabled={busy("wakeUpSource")}
              onChange={(e) => setSetting("wakeUpSource", e.target.value)}>
              <option value="wakeup_default">None</option>
              <option value="bluetooth">Bluetooth</option>
              <option value="tv">TV</option>
              <option value="optical">Optical</option>
              <option value="coaxial">COAX</option>
              <option value="analog">AUX</option>
            </select>
          </div>

          <div className="dsp-row">
            <label>
              Auto-Switch to TV
              <span className="row-sub">Switch to TV input when it powers on</span>
            </label>
            <Toggle on={bool("autoSwitchToHDMI")} disabled={busy("autoSwitchToHDMI")}
              onToggle={() => setSetting("autoSwitchToHDMI", !bool("autoSwitchToHDMI"))} />
          </div>

          <div className="dsp-row">
            <label>Startup Tone</label>
            <Toggle on={bool("startupTone")} disabled={busy("startupTone")}
              onToggle={() => setSetting("startupTone", !bool("startupTone"))} />
          </div>

          <div className="dsp-row">
            <label>
              Top Panel Lock
              <span className="row-sub">Disable the speaker's touch controls</span>
            </label>
            <Toggle on={bool("disableTopPanel")} disabled={busy("disableTopPanel")}
              onToggle={() => setSetting("disableTopPanel", !bool("disableTopPanel"))} />
          </div>

          <div className="dsp-row">
            <label>
              Disable Standby LED
              <span className="row-sub">Turn off the front standby light</span>
            </label>
            <Toggle on={bool("disableFrontStandbyLED")} disabled={busy("disableFrontStandbyLED")}
              onToggle={() => setSetting("disableFrontStandbyLED", !bool("disableFrontStandbyLED"))} />
          </div>

          <div className="dsp-row">
            <label>Cable Mode (between speakers)</label>
            <Segmented value={str("cableMode", "wireless")} busy={busy("cableMode")}
              onPick={(v) => setSetting("cableMode", v)}
              options={[["wireless", "Wireless"], ["wired", "Wired"]]} />
          </div>

          <div className="dsp-row">
            <label>
              Primary Speaker
              <span className="row-sub">Which speaker is the master channel</span>
            </label>
            <Segmented value={str("masterChannelMode", "right")} busy={busy("masterChannelMode")}
              onPick={(v) => setSetting("masterChannelMode", v)}
              options={[["left", "Left"], ["right", "Right"]]} />
          </div>

          <div className="dsp-row">
            <label>
              Wake Sub on Start-Up
              <span className="row-sub">Force the subwoofer on with the speakers</span>
            </label>
            <Toggle on={bool("subwooferForceOn")} disabled={busy("subwooferForceOn")}
              onToggle={() => setSetting("subwooferForceOn", !bool("subwooferForceOn"))} />
          </div>

          <h2 style={{ marginTop: 18 }}>Volume</h2>

          <div className="dsp-row">
            <label>
              Volume Sensitivity
              <span className="row-sub">Step size per press (1-10)</span>
            </label>
            <Slider min={1} max={10} step={1} value={num("volumeStep", 1)} disabled={busy("volumeStep")}
              onCommit={(v) => setSetting("volumeStep", v)} format={(v) => `${v}`} />
          </div>

          <div className="dsp-row">
            <label>Maximum Volume Limit</label>
            <Toggle on={bool("volumeLimit")} disabled={busy("volumeLimit")}
              onToggle={() => setSetting("volumeLimit", !bool("volumeLimit"))} />
          </div>
          {bool("volumeLimit") && (
            <div className="dsp-row indent">
              <label>Max Volume</label>
              <Slider min={0} max={100} step={1} value={num("maximumVolume", 90)} disabled={busy("maximumVolume")}
                onCommit={(v) => setSetting("maximumVolume", v)} format={(v) => `${v}`} />
            </div>
          )}

          <div className="dsp-row">
            <label>
              Reset Volume on Power-On
              <span className="row-sub">Wake at a fixed volume each time</span>
            </label>
            <Toggle on={bool("standbyDefaultVol")} disabled={busy("standbyDefaultVol")}
              onToggle={() => setSetting("standbyDefaultVol", !bool("standbyDefaultVol"))} />
          </div>
          {bool("standbyDefaultVol") && (
            <div className="dsp-row indent">
              <label>Wake-Up Volume</label>
              <Slider min={0} max={100} step={1} value={num("defaultVolumeGlobal", 30)} disabled={busy("defaultVolumeGlobal")}
                onCommit={(v) => setSetting("defaultVolumeGlobal", v)} format={(v) => `${v}`} />
            </div>
          )}
        </>
      )}

      <h2 style={{ marginTop: 18 }}>App</h2>
      <div className="dsp-row">
        <label>
          Launch at Startup
          <span className="row-sub">Open automatically when you sign in</span>
        </label>
        <Toggle on={autostart} onToggle={onToggleAutostart} />
      </div>
      <div className="dsp-row">
        <label>
          Window Position
          <span className="row-sub">Where the app opens on screen</span>
        </label>
        <select value={winAnchor} onChange={(e) => onWinAnchor(e.target.value)}>
          {WIN_POSITIONS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>
      <p className="hint" style={{ marginTop: 4 }}>
        Closing the window keeps KEF Control running in the system tray. Right-click
        the tray icon for quick controls, or choose Quit to exit fully.
      </p>

      <div className="settings-divider" />
      <h2>About</h2>
      <div className="info-grid" style={{ borderBottom: "none", paddingBottom: 0, marginBottom: 4 }}>
        <span className="info-k">App</span><span className="info-v">KEF Control</span>
        <span className="info-k">Version</span><span className="info-v">{APP_VERSION}</span>
      </div>
      <div className="dsp-row">
        <label>
          Project page
          <span className="row-sub">Source code &amp; releases on GitHub</span>
        </label>
        <button className="link" onClick={() => onOpenUrl(GITHUB_URL)}>Open GitHub ↗</button>
      </div>
      <p className="hint" style={{ marginTop: 8, lineHeight: 1.5 }}>{DISCLAIMER}</p>
    </div>
  );
}
