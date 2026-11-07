# Valmet SpatialSense — One-Click Launcher
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

if (-not (Test-Path "$PSScriptRoot\node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install
}

Write-Host "Starting Valmet DNA SpatialSense on http://localhost:5173 ..." -ForegroundColor Green
npm run dev
