# Discovers the speaker's host/volume/streaming settings paths + values, and
# tests whether host-setting writes require the HMAC auth.
# Run: powershell -ExecutionPolicy Bypass -File ".\tools\kef-discover-settings.ps1"

$kef = "192.168.1.50"                             # <- set your speaker's IP address
$out = ".\tools\discover"
New-Item -ItemType Directory -Force -Path $out | Out-Null

function Save($name, $obj) {
  ($obj | ConvertTo-Json -Depth 14) | Out-File -Encoding utf8 (Join-Path $out $name)
  Write-Host "saved $name"
}

# 1) Try to ENUMERATE settings containers (like kef:dsp/editValue did for DSP).
foreach ($c in @("settings:/kef/host", "settings:/kef", "settings:/mediaPlayer", "settings:/kef/play")) {
  $fn = ($c -replace '[^A-Za-z0-9]', '_')
  try { Save "rows_$fn.json" (Invoke-RestMethod "http://$kef/api/getRows?path=$c&roles=@all&from=0&to=300") }
  catch { Write-Host "rows $c -> $($_.Exception.Message)" }
  try { Save "data_$fn.json" (Invoke-RestMethod "http://$kef/api/getData?path=$c&roles=@all") }
  catch { Write-Host "data $c -> $($_.Exception.Message)" }
}

# 2) Read known + candidate individual paths (value role).
$paths = @(
  "settings:/kef/host/standbyMode","settings:/kef/host/wakeUpSource","settings:/kef/host/startupTone",
  "settings:/kef/host/cableMode","settings:/kef/host/masterChannelMode","settings:/kef/host/maximumVolume",
  "settings:/kef/host/volumeLimit","settings:/kef/host/volumeStep","settings:/kef/host/disableFrontStandbyLED",
  "settings:/kef/host/wakeUpVolume","settings:/kef/host/resetVolume","settings:/kef/host/enableResetVolume",
  "settings:/kef/host/hardwareVolume","settings:/kef/host/topPanelLock","settings:/kef/host/disableTopPanel",
  "settings:/kef/host/autoTvSwitch","settings:/kef/host/autoSwitchTv","settings:/kef/host/tvAutoSwitch",
  "settings:/kef/host/wakeSubOnStartup","settings:/kef/host/forceSubwoofer","settings:/kef/dsp/v2/wakeSub",
  "settings:/kef/host/streamQuality","settings:/kef/host/audioQuality","settings:/airable/quality",
  "settings:/kef/host/maxVolumeLimitEnable","settings:/kef/host/volumeLimitEnable"
)
$res = [ordered]@{}
foreach ($p in $paths) {
  try { $res[$p] = (Invoke-RestMethod "http://$kef/api/getData?path=$p&roles=value") }
  catch { $res[$p] = "ERR $($_.Exception.Message)" }
}
Save "known_and_candidates.json" $res

# 3) AUTH TEST: does a host-setting write need the HMAC auth?
#    Plain write of startupTone to its current value (no real change).
$cur = $res["settings:/kef/host/startupTone"]
Write-Host "`n--- plain write test on startupTone ---"
$plainBody = '{"path":"settings:/kef/host/startupTone","roles":"value","value":{"type":"bool_","bool_":true}}'
try {
  $r = Invoke-RestMethod -Method Post -Uri "http://$kef/api/setData" -ContentType "application/json" -Body $plainBody
  Write-Host "PLAIN WRITE OK (host writes need NO auth):" ($r | ConvertTo-Json -Compress)
} catch {
  Write-Host "PLAIN WRITE FAILED:" $_.Exception.Message
  try { $rd = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); Write-Host "BODY:" $rd.ReadToEnd() } catch {}
  Write-Host "(401 => host writes DO need the HMAC auth, same as DSP)"
}

Write-Host "`n=== files in $out ==="
Get-ChildItem $out | Select-Object Name, Length | Format-Table -AutoSize
