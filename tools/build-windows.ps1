# Rebuilds the KEF Control Windows installers (.msi + .exe).
# Run:  powershell -ExecutionPolicy Bypass -File ".\tools\build-windows.ps1"

# Locate the app folder relative to this script (tools/ is a sibling of app/).
$app = (Resolve-Path (Join-Path $PSScriptRoot "..\app")).Path
Set-Location $app

# Close the app if it's running, so nothing is file-locked during the build.
Get-Process "KEF Control" -ErrorAction SilentlyContinue | Stop-Process -Force

# Build: front-end deps, then Rust + installers.
npm install
npm run tauri build
if ($LASTEXITCODE -ne 0) {
    Write-Host "`nBuild FAILED (exit $LASTEXITCODE). See the output above." -ForegroundColor Red
    exit $LASTEXITCODE
}

# Show the built installers and open the folder.
$bundle = Join-Path $app "target\release\bundle"
Write-Host "`nBuild complete. Installers:" -ForegroundColor Green
Get-ChildItem -Path $bundle -Recurse -Include *.exe, *.msi |
    Select-Object @{N = 'Installer'; E = { $_.Name } },
                  @{N = 'Size (MB)'; E = { [math]::Round($_.Length / 1MB, 1) } },
                  FullName |
    Format-Table -AutoSize
Start-Process explorer.exe $bundle
