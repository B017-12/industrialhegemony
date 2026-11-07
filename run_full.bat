@echo off
setlocal
rem Valmet DNA SpatialSense - full demo on Windows: Python backend (AI, scene edits, routes) + web app.
rem First run installs everything (uv, Python 3.12, Python packages, node_modules). Needs Node.js 20+.
cd /d "%~dp0"
title Valmet SpatialSense - launcher

where node >nul 2>nul
if errorlevel 1 goto :no_node

where uv >nul 2>nul
if errorlevel 1 call :install_uv
where uv >nul 2>nul
if errorlevel 1 goto :no_uv

for %%F in (data\raw\builder_pack.xlsx data\derived\splats_clean.npz data\derived\transform.json) do (
    if not exist "%%F" (
        echo [!] Missing %%F - pull the latest branch, it is committed to git.
        goto :fail
    )
)
if not exist ".env" (
    echo [i] No .env found: AI commands use the offline rule parser instead of Gemini.
    echo     To enable Gemini, create .env next to this file with two lines:
    echo       LLM_MODEL=google:your-model-id
    echo       GEMINI_API_KEY=your-key
)

echo.
echo === Python packages: first run downloads Python 3.12 and takes a few minutes ===
call uv sync
if errorlevel 1 goto :fail

if exist "node_modules" goto :start
echo.
echo === Web app packages ===
call npm.cmd install
if errorlevel 1 goto :fail

:start
echo.
echo === Starting backend on http://127.0.0.1:8000 in its own window ===
start "Valmet backend :8000 - close to stop" cmd /k uv run uvicorn backend.app:app --host 127.0.0.1 --port 8000

echo Waiting for the backend to answer...
powershell -NoProfile -Command "for($i=0;$i -lt 90;$i++){try{Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/health -TimeoutSec 2 | Out-Null; exit 0}catch{Start-Sleep 1}}; exit 1"
if errorlevel 1 (
    echo [!] Backend did not answer within 90 s - look at the backend window for the error.
    echo     The web app will still start, but AI commands and scene edits need the backend.
)

echo.
echo === Starting web app on http://localhost:5173 - press Ctrl+C here to stop ===
start "" http://localhost:5173
call npm.cmd run dev
goto :eof

:install_uv
echo === Installing uv - Python package manager, from astral.sh ===
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
set "PATH=%USERPROFILE%\.local\bin;%PATH%"
exit /b 0

:no_node
echo [!] Node.js not found. Install Node.js 20 or newer from https://nodejs.org and run this again.
goto :fail

:no_uv
echo [!] uv could not be installed automatically. Install it from https://docs.astral.sh/uv/ and run this again.
goto :fail

:fail
echo.
pause
exit /b 1
