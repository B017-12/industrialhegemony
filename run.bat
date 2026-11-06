@echo off
set "PATH=C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Microsoft\VisualStudio\NodeJs;%PATH%"
cd /d D:\i
if not exist "D:\i\node_modules" (
    echo Installing React + Three.js dependencies...
    call npm.cmd install
)
echo Starting Valmet SpatialSense on http://localhost:5173 ...
call npm.cmd run dev
