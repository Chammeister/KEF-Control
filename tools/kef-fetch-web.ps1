# Downloads the KEF speaker's web-UI pages and the scripts they load, into
# tools/kef-web, so the auth/signing code can be analyzed.
# Run:  powershell -ExecutionPolicy Bypass -File ".\tools\kef-fetch-web.ps1"

$kef = "192.168.1.50"                             # <- set your speaker's IP address
$out = ".\tools\kef-web"
New-Item -ItemType Directory -Force -Path $out | Out-Null

function Grab($url, $name) {
  try {
    $r = Invoke-WebRequest $url -UseBasicParsing
    [IO.File]::WriteAllText((Join-Path $out $name), $r.Content)
    Write-Host ("saved {0}  ({1} bytes)" -f $name, $r.Content.Length)
    return $r.Content
  } catch {
    Write-Host ("skip  {0} : {1}" -f $name, $_.Exception.Message)
    return ""
  }
}

$pages = @("index.fcgi", "network.fcgi", "settings.fcgi", "fts.fcgi")
$seen = @{}

foreach ($p in $pages) {
  $html = Grab "http://$kef/$p" ($p -replace '[^A-Za-z0-9._-]', '_')
  foreach ($m in [regex]::Matches($html, '(?:src|href)="([^"]+)"')) {
    $x = $m.Groups[1].Value
    # only chase scripts (.js or server-rendered *.js.fcgi / *.fcgi scripts), skip css/images/links
    if ($x -notmatch '\.(js|fcgi)(\?|$)') { continue }
    if ($x -match '\.(css|png|jpg|svg|ico)') { continue }
    if ($seen[$x]) { continue }
    $seen[$x] = $true
    $u = if ($x -match '^https?://') { $x } elseif ($x.StartsWith('/')) { "http://$kef$x" } else { "http://$kef/$x" }
    Grab $u ($x -replace '[^A-Za-z0-9._-]', '_') | Out-Null
  }
}

Write-Host "`n=== files in $out ==="
Get-ChildItem $out | Sort-Object Name | Select-Object Name, Length | Format-Table -AutoSize
