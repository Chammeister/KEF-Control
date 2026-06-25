//! Async client for the KEF LS50 Wireless II (and LSX II / LS60) network control API.
//!
//! The speakers expose an HTTP/JSON API on port 80:
//! - `GET  /api/getData?path=<path>&roles=value` — read a property
//! - `POST /api/setData` with JSON body — write a property
//! - `POST /api/event/modifyQueue` + `GET /api/event/pollQueue` — long-poll event stream
//!
//! Protocol verified against the pykefcontrol reference implementation.

use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;

type HmacSha256 = Hmac<Sha256>;
type Aes256CbcEnc = cbc::Encryptor<aes::Aes256>;

#[derive(Debug, thiserror::Error)]
pub enum KefError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("unexpected response from speaker: {0}")]
    UnexpectedResponse(String),
    #[error("crypto error: {0}")]
    Crypto(String),
}

pub type Result<T> = std::result::Result<T, KefError>;

/// Physical sources of the speaker. `Standby` powers it off,
/// `PowerOn` wakes it to the last used source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    Wifi,
    Bluetooth,
    Tv,
    Optic,
    Coaxial,
    Analog,
    Usb,
    Standby,
    PowerOn,
}

impl Source {
    pub fn as_str(&self) -> &'static str {
        match self {
            Source::Wifi => "wifi",
            Source::Bluetooth => "bluetooth",
            Source::Tv => "tv",
            Source::Optic => "optic",
            Source::Coaxial => "coaxial",
            Source::Analog => "analog",
            Source::Usb => "usb",
            Source::Standby => "standby",
            Source::PowerOn => "powerOn",
        }
    }

    pub fn from_api(s: &str) -> Option<Source> {
        Some(match s {
            "wifi" => Source::Wifi,
            "bluetooth" => Source::Bluetooth,
            "tv" => Source::Tv,
            "optic" => Source::Optic,
            "coaxial" => Source::Coaxial,
            "analog" => Source::Analog,
            "usb" => Source::Usb,
            "standby" => Source::Standby,
            "powerOn" => Source::PowerOn,
            _ => return None,
        })
    }
}

/// Snapshot of speaker state for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakerOverview {
    pub name: String,
    pub model: String,
    pub firmware: String,
    /// "standby" or "powerOn"
    pub status: String,
    pub source: String,
    pub volume: i32,
    pub muted: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NowPlaying {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub cover_url: Option<String>,
    /// "playing", "paused", "stopped", ...
    pub state: Option<String>,
    /// Track length in ms
    pub duration_ms: Option<i64>,
    pub codec: Option<String>,
    pub sample_rate: Option<i64>,
}

/// Incremental state update from the event queue. All fields optional;
/// only changed properties are present.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StateUpdate {
    pub source: Option<String>,
    pub volume: Option<i32>,
    pub muted: Option<bool>,
    pub speaker_status: Option<String>,
    pub device_name: Option<String>,
    pub now_playing: Option<NowPlaying>,
}

#[derive(Debug, Clone)]
pub struct KefSpeaker {
    host: String,
    http: reqwest::Client,
}

impl KefSpeaker {
    /// Create a client for a speaker at `host` (IP or hostname, no scheme).
    pub fn new(host: impl Into<String>) -> Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()?;
        Ok(Self { host: host.into(), http })
    }

    pub fn host(&self) -> &str {
        &self.host
    }

    // ---------- low-level ----------

    /// `GET /api/getData` — returns the first element of the JSON array response.
    pub async fn get_data(&self, path: &str) -> Result<Value> {
        let url = format!("http://{}/api/getData", self.host);
        let resp: Value = self
            .http
            .get(&url)
            .query(&[("path", path), ("roles", "value")])
            .send()
            .await?
            .json()
            .await?;
        resp.as_array()
            .and_then(|a| a.first().cloned())
            .ok_or_else(|| KefError::UnexpectedResponse(format!("{path}: {resp}")))
    }

    /// `POST /api/setData` (LS50WII/LSXII/LS60 firmware uses POST with JSON body).
    pub async fn set_data(&self, path: &str, roles: &str, value: Value) -> Result<Value> {
        let url = format!("http://{}/api/setData", self.host);
        let body = json!({ "path": path, "roles": roles, "value": value });
        Ok(self.http.post(&url).json(&body).send().await?.json().await?)
    }

    // ---------- power & source ----------

    pub async fn power_on(&self) -> Result<()> {
        self.set_source_raw("powerOn").await
    }

    /// Put the speaker into standby.
    pub async fn shutdown(&self) -> Result<()> {
        self.set_source_raw("standby").await
    }

    pub async fn set_source(&self, source: Source) -> Result<()> {
        self.set_source_raw(source.as_str()).await
    }

    async fn set_source_raw(&self, source: &str) -> Result<()> {
        self.set_data(
            "settings:/kef/play/physicalSource",
            "value",
            json!({ "type": "kefPhysicalSource", "kefPhysicalSource": source }),
        )
        .await?;
        Ok(())
    }

    pub async fn source(&self) -> Result<String> {
        let v = self.get_data("settings:/kef/play/physicalSource").await?;
        v["kefPhysicalSource"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| KefError::UnexpectedResponse(v.to_string()))
    }

    /// "standby" or "powerOn"
    pub async fn status(&self) -> Result<String> {
        let v = self.get_data("settings:/kef/host/speakerStatus").await?;
        v["kefSpeakerStatus"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| KefError::UnexpectedResponse(v.to_string()))
    }

    // ---------- volume & mute ----------

    /// Volume 0–100.
    pub async fn volume(&self) -> Result<i32> {
        let v = self.get_data("player:volume").await?;
        v["i32_"]
            .as_i64()
            .map(|n| n as i32)
            .ok_or_else(|| KefError::UnexpectedResponse(v.to_string()))
    }

    pub async fn set_volume(&self, volume: i32) -> Result<()> {
        let volume = volume.clamp(0, 100);
        self.set_data("player:volume", "value", json!({ "type": "i32_", "i32_": volume }))
            .await?;
        Ok(())
    }

    pub async fn muted(&self) -> Result<bool> {
        let v = self.get_data("settings:/mediaPlayer/mute").await?;
        v["bool_"]
            .as_bool()
            .ok_or_else(|| KefError::UnexpectedResponse(v.to_string()))
    }

    pub async fn set_mute(&self, mute: bool) -> Result<()> {
        self.set_data(
            "settings:/mediaPlayer/mute",
            "value",
            json!({ "type": "bool_", "bool_": mute }),
        )
        .await?;
        Ok(())
    }

    // ---------- playback transport ----------

    pub async fn toggle_play_pause(&self) -> Result<()> {
        self.track_control("pause").await
    }

    pub async fn next_track(&self) -> Result<()> {
        self.track_control("next").await
    }

    pub async fn previous_track(&self) -> Result<()> {
        self.track_control("previous").await
    }

    async fn track_control(&self, command: &str) -> Result<()> {
        self.set_data("player:player/control", "activate", json!({ "control": command }))
            .await?;
        Ok(())
    }

    // ---------- info ----------

    pub async fn device_name(&self) -> Result<String> {
        let v = self.get_data("settings:/deviceName").await?;
        v["string_"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| KefError::UnexpectedResponse(v.to_string()))
    }

    /// Returns (model, firmware_version), e.g. ("LS50WII", "v1.6.0").
    pub async fn model_and_firmware(&self) -> Result<(String, String)> {
        let v = self.get_data("settings:/releasetext").await?;
        let text = v["string_"]
            .as_str()
            .ok_or_else(|| KefError::UnexpectedResponse(v.to_string()))?;
        let mut parts = text.splitn(2, '_');
        let model = parts.next().unwrap_or_default().to_string();
        let firmware = parts.next().unwrap_or_default().to_string();
        Ok((model, firmware))
    }

    /// One-shot state snapshot for the UI. Also serves as a connectivity check.
    pub async fn overview(&self) -> Result<SpeakerOverview> {
        let name = self.device_name().await?;
        let (model, firmware) = self.model_and_firmware().await?;
        let status = self.status().await?;
        let source = self.source().await?;
        let volume = self.volume().await?;
        let muted = self.muted().await.unwrap_or(false);
        Ok(SpeakerOverview { name, model, firmware, status, source, volume, muted })
    }

    pub async fn now_playing(&self) -> Result<NowPlaying> {
        let d = self.get_data("player:player/data").await?;
        Ok(Self::parse_player_data(&d))
    }

    fn parse_player_data(d: &Value) -> NowPlaying {
        let track = &d["trackRoles"];
        let meta = &track["mediaData"]["metaData"];
        let res = &track["mediaData"]["activeResource"];
        NowPlaying {
            title: track["title"].as_str().map(String::from),
            artist: meta["artist"].as_str().map(String::from),
            album: meta["album"].as_str().map(String::from),
            cover_url: track["icon"].as_str().map(String::from),
            state: d["state"].as_str().map(String::from),
            duration_ms: d["status"]["duration"].as_i64(),
            codec: res["codec"].as_str().map(String::from),
            sample_rate: res["sampleFrequency"].as_i64().or(res["streamSampleRate"].as_i64()),
        }
    }

    // ---------- event queue (live state sync) ----------

    /// Subscribe to state-change events. Returns a queue id for [`poll_events`].
    /// Queues expire if not polled for ~50 s — recreate on poll failure.
    pub async fn create_event_queue(&self) -> Result<String> {
        let url = format!("http://{}/api/event/modifyQueue", self.host);
        let subscribe = [
            "settings:/kef/play/physicalSource",
            "settings:/kef/host/speakerStatus",
            "player:volume",
            "settings:/mediaPlayer/mute",
            "player:player/data",
            "settings:/deviceName",
        ]
        .iter()
        .map(|p| json!({ "path": p, "type": "itemWithValue" }))
        .collect::<Vec<_>>();
        let body = json!({ "subscribe": subscribe, "unsubscribe": [] });
        let resp: Value = self.http.post(&url).json(&body).send().await?.json().await?;
        // Response is a JSON string like "{uuid}" — strip the braces.
        let raw = resp
            .as_str()
            .ok_or_else(|| KefError::UnexpectedResponse(resp.to_string()))?;
        Ok(raw.trim_matches(|c| c == '{' || c == '}').to_string())
    }

    /// Long-poll the event queue (server holds the request up to `timeout_secs`).
    /// Returns a merged update of everything that changed.
    pub async fn poll_events(&self, queue_id: &str, timeout_secs: u64) -> Result<StateUpdate> {
        let url = format!("http://{}/api/event/pollQueue", self.host);
        let resp: Value = self
            .http
            .get(&url)
            .query(&[
                ("queueId", format!("{{{queue_id}}}")),
                ("timeout", timeout_secs.to_string()),
            ])
            .timeout(Duration::from_secs(timeout_secs + 2))
            .send()
            .await?
            .json()
            .await?;

        let mut update = StateUpdate::default();
        let Some(events) = resp.as_array() else {
            return Err(KefError::UnexpectedResponse(resp.to_string()));
        };
        for ev in events {
            let path = ev["path"].as_str().unwrap_or_default();
            let item = &ev["itemValue"];
            match path {
                "settings:/kef/play/physicalSource" => {
                    update.source = item["kefPhysicalSource"].as_str().map(String::from);
                }
                "settings:/kef/host/speakerStatus" => {
                    update.speaker_status = item["kefSpeakerStatus"].as_str().map(String::from);
                }
                "player:volume" => {
                    update.volume = item["i32_"].as_i64().map(|n| n as i32);
                }
                "settings:/mediaPlayer/mute" => {
                    update.muted = item["bool_"].as_bool();
                }
                "settings:/deviceName" => {
                    update.device_name = item["string_"].as_str().map(String::from);
                }
                "player:player/data" => {
                    if item.is_object() {
                        update.now_playing = Some(Self::parse_player_data(item));
                    }
                }
                _ => {}
            }
        }
        Ok(update)
    }

    // ---------- now-playing position ----------

    /// Current playback position in milliseconds.
    pub async fn play_time(&self) -> Result<i64> {
        let v = self.get_data("player:player/data/playTime").await?;
        v["i64_"]
            .as_i64()
            .ok_or_else(|| KefError::UnexpectedResponse(v.to_string()))
    }

    // ---------- DSP / EQ ----------
    //
    // Firmware V4.1.x exposes editable DSP at `settings:/kef/dsp/v2/<field>`.
    // Reading is unauthenticated (authMode=setData), but WRITING requires the
    // speaker's `HMAC_SHA256_AES256` auth: the value is AES-256-CBC encrypted and
    // the request is HMAC-SHA256 signed with a key = SHA256(salt + password).
    // The speaker has no password set, so the password is empty. This scheme was
    // reverse-engineered from the speaker's own web UI (kef-api.js) and validated
    // live against the unit. Numeric values are real units (dB/Hz), not steps.

    /// KEF value-type wrapper for each editable DSP field.
    fn dsp_type_for(key: &str) -> Option<&'static str> {
        Some(match key {
            "deskMode" | "wallMode" | "phaseCorrection" | "highPassMode" | "subwooferOut"
            | "subEnableStereo" | "dialogueMode" => "bool_",
            "deskModeSetting" | "wallModeSetting" | "trebleAmount" | "highPassModeFreq"
            | "subOutLPFreq" => "double_",
            "balance" | "subwooferGain" | "subwooferCount" => "i32_",
            "bassExtension" | "subwooferPolarity" | "audioPolarity" | "subwooferPreset" => {
                "string_"
            }
            _ => return None,
        })
    }

    /// Read all editable DSP settings in one shot via the `kef:dsp/editValue`
    /// rows endpoint. Returns a JSON object keyed by field name, values in the
    /// speaker's real units (dB / Hz / bool / enum string).
    pub async fn dsp_profile(&self) -> Result<Value> {
        let url = format!("http://{}/api/getRows", self.host);
        let resp: Value = self
            .http
            .get(&url)
            .query(&[
                ("path", "kef:dsp/editValue"),
                ("roles", "@all"),
                ("from", "0"),
                ("to", "40"),
            ])
            .send()
            .await?
            .json()
            .await?;
        let rows = resp["rows"]
            .as_array()
            .ok_or_else(|| KefError::UnexpectedResponse(resp.to_string()))?;
        let mut o = serde_json::Map::new();
        for row in rows {
            let Some(name) = row["name"].as_str() else { continue };
            let v = &row["value"];
            let val = match v["type"].as_str().unwrap_or("") {
                "bool_" => json!(v["bool_"].as_bool().unwrap_or(false)),
                "i32_" => json!(v["i32_"].as_i64().unwrap_or(0)),
                "i16_" => json!(v["i16_"].as_i64().unwrap_or(0)),
                "double_" => json!(v["double_"].as_f64().unwrap_or(0.0)),
                "string_" => json!(v["string_"].as_str().unwrap_or("")),
                _ => continue,
            };
            o.insert(name.to_string(), val);
        }
        Ok(Value::Object(o))
    }

    /// Write one DSP field (encrypted + signed), then return the re-read profile.
    pub async fn set_dsp_field(&self, key: &str, value: Value) -> Result<Value> {
        let kef_type = Self::dsp_type_for(key)
            .ok_or_else(|| KefError::UnexpectedResponse(format!("unknown DSP field: {key}")))?;
        // Coerce whole-number doubles to f64 so they serialize as e.g. "0.0".
        let value = if kef_type == "double_" {
            value.as_f64().map(|n| json!(n)).unwrap_or(value)
        } else {
            value
        };
        let mut value_obj = serde_json::Map::new();
        value_obj.insert("type".to_string(), json!(kef_type));
        value_obj.insert(kef_type.to_string(), value);
        let value_json =
            serde_json::to_string(&Value::Object(value_obj)).expect("serialize DSP value");
        self.set_data_secure(&format!("settings:/kef/dsp/v2/{key}"), &value_json)
            .await?;
        self.dsp_profile().await
    }

    // ---------- protected (authenticated) writes ----------

    /// Perform a `setData` that requires the speaker's `HMAC_SHA256_AES256` auth:
    /// AES-256-CBC encrypt `value_json` and HMAC-SHA256 sign the request.
    /// `value_json` is the JSON of the typed value object, e.g.
    /// `{"type":"bool_","bool_":false}`.
    async fn set_data_secure(&self, path: &str, value_json: &str) -> Result<()> {
        const PASSWORD: &[u8] = b""; // no password configured on the speaker

        // key = SHA256(salt(6) + password)
        let mut salt = [0u8; 6];
        getrandom::getrandom(&mut salt).map_err(|e| KefError::Crypto(e.to_string()))?;
        let salt_b64 = B64.encode(salt);
        let mut hasher = Sha256::new();
        hasher.update(salt);
        hasher.update(PASSWORD);
        let key = hasher.finalize();

        // AES-256-CBC encrypt the value (random IV prepended), base64 of IV+CT
        let mut iv = [0u8; 16];
        getrandom::getrandom(&mut iv).map_err(|e| KefError::Crypto(e.to_string()))?;
        let ct = Aes256CbcEnc::new_from_slices(&key, &iv)
            .map_err(|e| KefError::Crypto(e.to_string()))?
            .encrypt_padded_vec_mut::<Pkcs7>(value_json.as_bytes());
        let mut blob = Vec::with_capacity(16 + ct.len());
        blob.extend_from_slice(&iv);
        blob.extend_from_slice(&ct);
        let enc_val = B64.encode(&blob);

        // Body — key order (path, role, value) matters: it is part of the signed message.
        let body = format!(
            "{{\"path\":\"{path}\",\"role\":\"value\",\"value\":\"{enc_val}\"}}"
        );

        // HMAC-SHA256 signed message: user.<saltB64>.<ts>.<url>.<body>
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .to_string();
        let url = format!("http://{}/api/setData", self.host);
        let message = format!("user.{salt_b64}.{now}.{url}.{body}");
        let mut mac = HmacSha256::new_from_slice(&key).map_err(|e| KefError::Crypto(e.to_string()))?;
        mac.update(message.as_bytes());
        let sig = B64.encode(mac.finalize().into_bytes());
        let auth = format!(
            "HMAC_SHA256_AES256 {}.{salt_b64}.{now}.{sig}",
            B64.encode("user")
        );

        let resp = self
            .http
            .post(&url)
            .header("Authorization", auth)
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await?;
        if !resp.status().is_success() {
            let code = resp.status().as_u16();
            let text = resp.text().await.unwrap_or_default();
            return Err(KefError::UnexpectedResponse(format!(
                "setData {path} failed: HTTP {code} {text}"
            )));
        }
        Ok(())
    }

    // ---------- host / device settings ----------
    //
    // All editable host settings live at `settings:/kef/host/<field>`. Reads are
    // unauthenticated; writes need the same HMAC auth as DSP. Paths/types verified
    // by enumerating `settings:/kef/host` on the speaker.

    pub async fn mac_address(&self) -> Result<String> {
        let v = self.get_data("settings:/system/primaryMacAddress").await?;
        v["string_"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| KefError::UnexpectedResponse(v.to_string()))
    }

    fn host_type_for(key: &str) -> Option<&'static str> {
        HOST_SETTINGS.iter().find(|(k, _)| *k == key).map(|(_, t)| *t)
    }

    /// Read one host setting, returning its inner JSON value (or null on error).
    async fn host_value(&self, key: &str, kef_type: &str) -> Value {
        match self.get_data(&format!("settings:/kef/host/{key}")).await {
            Ok(v) => v.get(kef_type).cloned().unwrap_or(Value::Null),
            Err(_) => Value::Null,
        }
    }

    /// Read all editable host settings (+ MAC) as a JSON object keyed by field.
    pub async fn settings_profile(&self) -> Result<Value> {
        let mut o = serde_json::Map::new();
        for (key, kef_type) in HOST_SETTINGS {
            o.insert(key.to_string(), self.host_value(key, kef_type).await);
        }
        o.insert("mac".into(), json!(self.mac_address().await.unwrap_or_default()));
        Ok(Value::Object(o))
    }

    /// Write one host setting (encrypted + signed), then return the re-read profile.
    pub async fn set_setting(&self, key: &str, value: Value) -> Result<Value> {
        let kef_type = Self::host_type_for(key)
            .ok_or_else(|| KefError::UnexpectedResponse(format!("unknown setting: {key}")))?;
        let mut obj = serde_json::Map::new();
        obj.insert("type".to_string(), json!(kef_type));
        obj.insert(kef_type.to_string(), value);
        let value_json =
            serde_json::to_string(&Value::Object(obj)).expect("serialize setting value");
        self.set_data_secure(&format!("settings:/kef/host/{key}"), &value_json)
            .await?;
        self.settings_profile().await
    }
}

/// Editable host settings: (field name, KEF value type). Field name is also the
/// leaf of `settings:/kef/host/<field>`.
const HOST_SETTINGS: &[(&str, &str)] = &[
    ("standbyMode", "kefStandbyMode"),
    ("wakeUpSource", "kefWakeUpSource"),
    ("autoSwitchToHDMI", "bool_"),
    ("startupTone", "bool_"),
    ("disableTopPanel", "bool_"),
    ("cableMode", "kefCableMode"),
    ("masterChannelMode", "kefMasterChannelMode"),
    ("subwooferForceOn", "bool_"),
    ("disableFrontStandbyLED", "bool_"),
    ("volumeStep", "i16_"),
    ("volumeLimit", "bool_"),
    ("maximumVolume", "i32_"),
    ("standbyDefaultVol", "bool_"),
    ("defaultVolumeGlobal", "i32_"),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_roundtrip() {
        for s in [
            Source::Wifi,
            Source::Bluetooth,
            Source::Tv,
            Source::Optic,
            Source::Coaxial,
            Source::Analog,
            Source::Standby,
            Source::PowerOn,
        ] {
            assert_eq!(Source::from_api(s.as_str()), Some(s));
        }
    }

    #[test]
    fn parse_player_data_handles_missing_fields() {
        let np = KefSpeaker::parse_player_data(&json!({}));
        assert!(np.title.is_none());
        let np = KefSpeaker::parse_player_data(&json!({
            "state": "playing",
            "status": { "duration": 215000 },
            "trackRoles": {
                "title": "Song",
                "icon": "http://x/cover.jpg",
                "mediaData": {
                    "metaData": { "artist": "A", "album": "B" },
                    "activeResource": { "codec": "flac", "sampleFrequency": 44100 }
                }
            }
        }));
        assert_eq!(np.title.as_deref(), Some("Song"));
        assert_eq!(np.artist.as_deref(), Some("A"));
        assert_eq!(np.duration_ms, Some(215000));
        assert_eq!(np.codec.as_deref(), Some("flac"));
    }
}
