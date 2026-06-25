# Validates the KEF HMAC_SHA256_AES256 protected-write scheme by flipping
# phaseCorrection. If it works, the same algorithm goes into the Rust backend.
# Run: powershell -ExecutionPolicy Bypass -File ".\tools\kef-auth-test.ps1"

$kef        = "192.168.1.50"                      # <- set your speaker's IP address
$path       = "settings:/kef/dsp/v2/phaseCorrection"
$valuePlain = '{"type":"bool_","bool_":false}'   # turn phase correction OFF
$password   = ""                                  # no password set on the speaker

$enc = [System.Text.Encoding]::UTF8
function B64($b){ [Convert]::ToBase64String($b) }
function Rand($n){ $x = New-Object byte[] $n; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($x); return ,$x }

# key = SHA256(salt + password)
$salt    = Rand 6
$saltB64 = B64 $salt
$pw      = $enc.GetBytes($password)
$combo   = New-Object byte[] ($salt.Length + $pw.Length)
[Array]::Copy($salt,0,$combo,0,$salt.Length)
[Array]::Copy($pw,0,$combo,$salt.Length,$pw.Length)
$key = [System.Security.Cryptography.SHA256]::Create().ComputeHash($combo)

# AES-256-CBC encrypt the value (IV prepended)
$iv  = Rand 16
$aes = [System.Security.Cryptography.Aes]::Create()
$aes.KeySize = 256
$aes.Mode    = [System.Security.Cryptography.CipherMode]::CBC
$aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
$aes.Key = $key; $aes.IV = $iv
$pt  = $enc.GetBytes($valuePlain)
$ct  = $aes.CreateEncryptor().TransformFinalBlock($pt, 0, $pt.Length)
$blob = New-Object byte[] ($iv.Length + $ct.Length)
[Array]::Copy($iv,0,$blob,0,16)
[Array]::Copy($ct,0,$blob,16,$ct.Length)
$encVal = B64 $blob

# body (exact key order: path, role, value — it is part of the signed message)
$body = '{"path":"' + $path + '","role":"value","value":"' + $encVal + '"}'

# signed message + HMAC
$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
$url = "http://$kef/api/setData"
$msg = "user." + $saltB64 + "." + $now + "." + $url + "." + $body
$hmac = New-Object System.Security.Cryptography.HMACSHA256(,$key)
$sig  = B64 ($hmac.ComputeHash($enc.GetBytes($msg)))
$auth = "HMAC_SHA256_AES256 " + (B64 ($enc.GetBytes("user"))) + "." + $saltB64 + "." + $now + "." + $sig

Write-Host "Authorization: $auth"
Write-Host "Body: $body"
try {
  $r = Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Headers @{ Authorization = $auth } -Body $body
  Write-Host "WRITE OK:" ($r | ConvertTo-Json -Compress)
} catch {
  Write-Host "ERROR:" $_.Exception.Message
  try { $rd = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); Write-Host "ERR BODY:" $rd.ReadToEnd() } catch {}
}
Start-Sleep -Milliseconds 400
Write-Host "RE-READ phaseCorrection:" (Invoke-RestMethod "http://$kef/api/getData?path=settings:/kef/dsp/v2/phaseCorrection&roles=value" | ConvertTo-Json -Depth 6 -Compress)
