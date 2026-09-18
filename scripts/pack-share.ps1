# Собирает портативную папку DynamicIsland и zip на рабочий стол
$ErrorActionPreference = 'Stop'
$island = Split-Path -Parent $PSScriptRoot
$electronDist = Join-Path $island 'node_modules\electron\dist'
$stageRoot = Join-Path $island 'release'
$appDir = Join-Path $stageRoot 'DynamicIsland'
$desktop = [Environment]::GetFolderPath('Desktop')
$zipPath = Join-Path $desktop 'DynamicIsland-share.zip'

if (-not (Test-Path (Join-Path $electronDist 'electron.exe'))) {
  throw "Не найден Electron: $electronDist"
}

Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
Copy-Item -Path (Join-Path $electronDist '*') -Destination $appDir -Recurse -Force

$resourcesApp = Join-Path $appDir 'resources\app'
New-Item -ItemType Directory -Path $resourcesApp -Force | Out-Null
@'
{
  "name": "pc-dynamic-island",
  "version": "0.1.0",
  "main": "dist-electron/main.js",
  "private": true
}
'@ | Set-Content -LiteralPath (Join-Path $resourcesApp 'package.json') -Encoding UTF8

Copy-Item (Join-Path $island 'dist') (Join-Path $resourcesApp 'dist') -Recurse -Force
Copy-Item (Join-Path $island 'dist-electron') (Join-Path $resourcesApp 'dist-electron') -Recurse -Force
Copy-Item (Join-Path $island 'assets') (Join-Path $resourcesApp 'assets') -Recurse -Force

Push-Location $resourcesApp
npm install exceljs@^4.4.0 --omit=dev --no-fund --no-audit --package-lock=false
Pop-Location

Move-Item -LiteralPath (Join-Path $appDir 'electron.exe') -Destination (Join-Path $appDir 'Dynamic Island.exe') -Force

@'
@echo off
cd /d "%~dp0"
start "" "Dynamic Island.exe"
'@ | Set-Content -LiteralPath (Join-Path $appDir 'Start.bat') -Encoding ASCII

@(
'Dynamic Island - how to install',
'',
'1. Unzip to any folder.',
'2. Run Dynamic Island.exe or Start.bat.',
'3. If SmartScreen warns: More info -> Run anyway.',
'',
'No Node.js required.',
'',
'---',
'',
'Как установить',
'',
'1. Распакуй архив в любую папку.',
'2. Запусти Dynamic Island.exe или Start.bat.',
'3. Если Windows предупредит — Подробнее → Выполнить в любом случае.',
'',
'Node.js ставить не нужно.',
'',
'Данные: %APPDATA%\pc-dynamic-island\',
'Excel «Задачник.xlsx» — в Документах.',
'Выход: ПКМ по иконке в трее → Выход.'
) -join "`r`n" | Set-Content -LiteralPath (Join-Path $appDir 'README.txt') -Encoding UTF8

if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $appDir,
  $zipPath,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $true
)

Write-Host "Готово: $zipPath"
