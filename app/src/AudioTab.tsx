import { useState } from "react";
import type { DspProfile } from "./types";

type FieldValue = number | boolean | string;

interface Props {
  dsp: DspProfile | null;
  source: string;
  busyKey: string | null;
  setField: (key: string, value: FieldValue) => void;
}

const STREAMING = new Set(["wifi", "bluetooth"]);

/* A slider that only commits on release (so we don't spam the speaker).
   Values are the speaker's real units (dB / Hz). */
function Slider(props: {
  min: number;
  max: number;
  step: number;
  value: number;
  disabled?: boolean;
  onCommit: (v: number) => void;
  format: (v: number) => string;
}) {
  const { min, max, step, value, disabled, onCommit, format } = props;
  const [drag, setDrag] = useState<number | null>(null);
  const v = drag ?? value;
  const pct = ((v - min) / (max - min)) * 100;
  const fill = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--track) ${pct}%, var(--track) 100%)`;
  return (
    <div className="dsp-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        disabled={disabled}
        style={{ background: fill }}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => {
          if (drag !== null) {
            onCommit(drag);
            setDrag(null);
          }
        }}
      />
      <span className="dsp-value">{format(v)}</span>
    </div>
  );
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

// unit labels
const trim = (n: number) => +n.toFixed(2);
const deskWallDb = (v: number) => `${trim(v)} dB`;
const trebleDb = (v: number) => `${v > 0 ? "+" : ""}${trim(v)} dB`;
const gainDb = (v: number) => `${v > 0 ? "+" : ""}${v} dB`;
const hz = (v: number) => `${v} Hz`;
const balanceLbl = (v: number) => (v === 0 ? "Center" : v < 0 ? `L ${-v}` : `R ${v}`);

export default function AudioTab({ dsp, source, busyKey, setField }: Props) {
  if (!dsp) {
    return <div className="hint" style={{ padding: "8px 2px" }}>Loading DSP profile…</div>;
  }

  const num = (k: string, fallback = 0) =>
    typeof dsp[k] === "number" ? (dsp[k] as number) : fallback;
  const bool = (k: string) => dsp[k] === true;
  const str = (k: string, fallback: string) =>
    typeof dsp[k] === "string" ? (dsp[k] as string) : fallback;
  const busy = (k: string) => busyKey === k;
  const subOn = bool("subwooferOut");

  return (
    <div className="dsp">
      <p className="hint" style={{ marginTop: 0 }}>
        DSP settings are stored per source - these apply to{" "}
        <strong>{STREAMING.has(source) ? source : source.toUpperCase()}</strong>.
      </p>

      <div className="dsp-row">
        <label>Bass Extension</label>
        <Segmented
          value={str("bassExtension", "standard")}
          busy={busy("bassExtension")}
          onPick={(v) => setField("bassExtension", v)}
          options={[["less", "Less"], ["standard", "Standard"], ["extra", "Extra"]]}
        />
      </div>

      <div className="dsp-row">
        <label>
          Desk Mode
          <span className="row-sub">Reduces presence on a desk/stand</span>
        </label>
        <Toggle on={bool("deskMode")} disabled={busy("deskMode")} onToggle={() => setField("deskMode", !bool("deskMode"))} />
      </div>
      {bool("deskMode") && (
        <div className="dsp-row indent">
          <label>Desk Gain</label>
          <Slider min={-10} max={0} step={0.5} value={num("deskModeSetting", -3)}
            disabled={busy("deskModeSetting")} onCommit={(v) => setField("deskModeSetting", v)} format={deskWallDb} />
        </div>
      )}

      <div className="dsp-row">
        <label>
          Wall Mode
          <span className="row-sub">Trims bass near a wall</span>
        </label>
        <Toggle on={bool("wallMode")} disabled={busy("wallMode")} onToggle={() => setField("wallMode", !bool("wallMode"))} />
      </div>
      {bool("wallMode") && (
        <div className="dsp-row indent">
          <label>Wall Gain</label>
          <Slider min={-10} max={0} step={0.5} value={num("wallModeSetting", -3)}
            disabled={busy("wallModeSetting")} onCommit={(v) => setField("wallModeSetting", v)} format={deskWallDb} />
        </div>
      )}

      <div className="dsp-row">
        <label>Treble Trim</label>
        <Slider min={-3} max={3} step={0.25} value={num("trebleAmount", 0)}
          disabled={busy("trebleAmount")} onCommit={(v) => setField("trebleAmount", v)} format={trebleDb} />
      </div>

      <div className="dsp-row">
        <label>
          Phase Correction
          <span className="row-sub">On by default</span>
        </label>
        <Toggle on={bool("phaseCorrection")} disabled={busy("phaseCorrection")}
          onToggle={() => setField("phaseCorrection", !bool("phaseCorrection"))} />
      </div>

      <div className="dsp-row">
        <label>Balance</label>
        <Slider min={-30} max={30} step={1} value={num("balance", 0)}
          disabled={busy("balance")} onCommit={(v) => setField("balance", v)} format={balanceLbl} />
      </div>

      <h2 style={{ marginTop: 18 }}>Subwoofer</h2>
      <div className="dsp-row">
        <label>Subwoofer Output</label>
        <Toggle on={subOn} disabled={busy("subwooferOut")} onToggle={() => setField("subwooferOut", !subOn)} />
      </div>
      {subOn && (
        <>
          <div className="dsp-row indent">
            <label>Sub Gain</label>
            <Slider min={-10} max={10} step={1} value={num("subwooferGain", 0)}
              disabled={busy("subwooferGain")} onCommit={(v) => setField("subwooferGain", v)} format={gainDb} />
          </div>
          <div className="dsp-row indent">
            <label>Sub Low-Pass</label>
            <Slider min={40} max={250} step={5} value={num("subOutLPFreq", 80)}
              disabled={busy("subOutLPFreq")} onCommit={(v) => setField("subOutLPFreq", v)} format={hz} />
          </div>
          <div className="dsp-row indent">
            <label>Sub Polarity</label>
            <Segmented
              value={str("subwooferPolarity", "normal")}
              busy={busy("subwooferPolarity")}
              onPick={(v) => setField("subwooferPolarity", v)}
              options={[["normal", "Normal"], ["inverted", "Inverted"]]}
            />
          </div>
          <div className="dsp-row indent">
            <label>
              High-Pass Filter
              <span className="row-sub">Relieves the mains of deep bass</span>
            </label>
            <Toggle on={bool("highPassMode")} disabled={busy("highPassMode")}
              onToggle={() => setField("highPassMode", !bool("highPassMode"))} />
          </div>
          {bool("highPassMode") && (
            <div className="dsp-row indent">
              <label>High-Pass Freq</label>
              <Slider min={50} max={120} step={5} value={num("highPassModeFreq", 95)}
                disabled={busy("highPassModeFreq")} onCommit={(v) => setField("highPassModeFreq", v)} format={hz} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
