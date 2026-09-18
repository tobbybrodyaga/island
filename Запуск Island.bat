@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Island
echo Запуск Island...
set PATH=%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\node;%PATH%
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js не найден. Установите LTS с https://nodejs.org
  pause
  exit /b 1
)
call npm run dev
if errorlevel 1 pause
