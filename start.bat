@echo off
title Case Management System
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   Starting Case Management System...
echo ========================================
echo.
echo   Open browser at: http://localhost:3001
echo   Login: admin / admin123
echo.
echo   Keep this window OPEN while using.
echo.
node server.js
pause