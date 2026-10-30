@echo off
title Vedant Enterprises - PWA Web Server
cd /d "%~dp0"

echo ====================================================
echo   Starting Vedant Enterprises Local PWA Server...
echo ====================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    node server.js
    pause
    exit /b
)

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo Starting with Python HTTP Server on port 5000...
    python -m http.server 5000
    pause
    exit /b
)

echo Neither Node.js nor Python was found.
echo Opening directly in your browser...
start "" "%~dp0index.html"
pause
