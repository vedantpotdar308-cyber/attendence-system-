@echo off
title Installing Vedant Enterprises Desktop App
cd /d "%~dp0"

echo =========================================================
echo   Installing Vedant Enterprises Attendance Application...
echo =========================================================
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0install_shortcuts.ps1"

echo.
echo =========================================================
echo   INSTALLATION COMPLETE!
echo   Two shortcuts have been added to your Windows Desktop:
echo     1. Vedant Branch App (शाखा ऍप)
echo     2. Vedant Central Admin (मुख्य ऍडमिन)
echo =========================================================
echo.
pause
