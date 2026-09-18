@echo off
REM Для ручного запуска из проводника (с консолью).
REM Ярлык на рабочем столе использует start-island.vbs без окон.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-island-silent.ps1"
