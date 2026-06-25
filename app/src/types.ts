export interface SpeakerOverview {
  name: string;
  model: string;
  firmware: string;
  status: string;
  source: string;
  volume: number;
  muted: boolean;
}

export interface NowPlaying {
  title: string | null;
  artist: string | null;
  album: string | null;
  cover_url: string | null;
  state: string | null;
  duration_ms: number | null;
  codec: string | null;
  sample_rate: number | null;
}

// Incremental update from the speaker's event queue - only changed fields set.
export interface StateUpdate {
  source: string | null;
  volume: number | null;
  muted: boolean | null;
  speaker_status: string | null;
  device_name: string | null;
  now_playing: NowPlaying | null;
}

// Editable host settings (keyed by KEF field name) + mac.
export interface SettingsProfile {
  mac?: string;
  standbyMode?: string; // standby_20mins | standby_30mins | standby_60mins | standby_none
  wakeUpSource?: string; // wakeup_default | bluetooth | tv | optical | coaxial | analog
  autoSwitchToHDMI?: boolean;
  startupTone?: boolean;
  disableTopPanel?: boolean;
  cableMode?: string; // wired | wireless
  masterChannelMode?: string; // left | right
  subwooferForceOn?: boolean;
  disableFrontStandbyLED?: boolean;
  volumeStep?: number; // 1..10
  volumeLimit?: boolean;
  maximumVolume?: number; // 0..100
  standbyDefaultVol?: boolean;
  defaultVolumeGlobal?: number; // 0..100
  [key: string]: unknown;
}

// Raw DSP/EQ profile object (kef:eqProfile/v2). Known fields typed; unknown
// fields preserved via the index signature so nothing is lost on write-back.
export interface DspProfile {
  bassExtension?: string; // "less" | "standard" | "more"
  deskMode?: boolean;
  deskModeSetting?: number;
  wallMode?: boolean;
  wallModeSetting?: number;
  trebleAmount?: number;
  phaseCorrection?: boolean;
  balance?: number;
  subwooferOut?: boolean;
  subwooferGain?: number;
  subOutLPFreq?: number;
  subwooferPolarity?: string;
  subwooferCount?: number;
  highPassMode?: boolean;
  highPassModeFreq?: number;
  audioPolarity?: string;
  profileName?: string;
  [key: string]: unknown;
}
