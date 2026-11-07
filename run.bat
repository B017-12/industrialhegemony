@echo off
cd /d "%~dp0"
if not exist "node_modules" (
    echo Installing React + Three.js dependencies...
    call npm.cmd install
)
echo Starting Valmet DNA SpatialSense on http://localhost:5173 ...
call npm.cmd run dev
