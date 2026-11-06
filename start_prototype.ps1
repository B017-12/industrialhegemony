# Valmet SpatialSense — One-Click Launcher (Uses Visual Studio 2022 Bundled Node.js)
$ErrorActionPreference = "Continue"

$vsNodeDir = "C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Microsoft\VisualStudio\NodeJs"
if (Test-Path "$vsNodeDir\node.exe") {
    $env:PATH = "$vsNodeDir;$env:PATH"
    Write-Host "Added Visual Studio Node.js to PATH: $(& "$vsNodeDir\node.exe" -v)" -ForegroundColor Cyan
}

Set-Location "d:\i"

if (-not (Test-Path "d:\i\node_modules")) {
    Write-Host "Installing React + Three.js dependencies..." -ForegroundColor Yellow
    & "$vsNodeDir\npm.cmd" install
}

Write-Host "Starting Valmet SpatialSense on http://localhost:5173 ..." -ForegroundColor Green
& "$vsNodeDir\npm.cmd" run dev
