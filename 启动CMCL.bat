@echo off
chcp 65001 >nul
cd /d "%~dp0"
title CMCL Launcher

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules\electron\dist\electron.exe" (
    echo Installing dependencies, please wait...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
)

:: Kill leftover electron processes
taskkill /f /im electron.exe >nul 2>&1

:: Write build timestamp
node -e "require('fs').writeFileSync('src/buildtime.json',JSON.stringify({buildTime:new Date().toISOString()}))"

:: Build frontend
echo Building frontend...
call npx vite build
if errorlevel 1 (
    echo [ERROR] vite build failed
    pause
    exit /b 1
)
echo === Build complete: %date% %time% ===

:: Launch
echo Starting CMCL...
start "" "node_modules\electron\dist\electron.exe" .
timeout /t 8 /nobreak >nul