$ErrorActionPreference = 'Stop'

$island = 'c:\Users\Dankov_S\ILON_MUSK_PROJECT_FIRE_GUN111\island'
$nodeDir = 'C:\Program Files\nodejs'
$node = Join-Path $nodeDir 'node.exe'
$viteJs = Join-Path $island 'node_modules\vite\bin\vite.js'
$electronExe = Join-Path $island 'node_modules\electron\dist\electron.exe'
$log = Join-Path $env:TEMP 'island-launch.log'

function Write-Log([string]$msg) {
  Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) -Encoding UTF8
}

function Test-IslandElectronRunning {
  try {
    $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name -eq 'electron.exe' -and
        $_.CommandLine -and
        $_.CommandLine -match 'ILON_MUSK_PROJECT_FIRE_GUN111\\island'
      }
    return [bool]$procs
  } catch {
    return $false
  }
}

function Start-IslandElectron {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $electronExe
  $psi.Arguments = '.'
  $psi.WorkingDirectory = $island
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables['VITE_DEV_SERVER_URL'] = 'http://127.0.0.1:5173'
  if (-not $psi.EnvironmentVariables.ContainsKey('Path')) {
    $psi.EnvironmentVariables['Path'] = $env:Path
  } else {
    $psi.EnvironmentVariables['Path'] = $env:Path
  }
  return [System.Diagnostics.Process]::Start($psi)
}

Set-Location $island
$env:Path = "$nodeDir;" + $env:Path

"===== $(Get-Date) =====" | Set-Content -Path $log -Encoding UTF8
Write-Log "cwd=$island"

if (-not (Test-Path $node)) { Write-Log "Node not found: $node"; exit 1 }
if (-not (Test-Path $viteJs)) { Write-Log "Vite not found: $viteJs"; exit 1 }
if (-not (Test-Path $electronExe)) { Write-Log "Electron not found: $electronExe"; exit 1 }

# Уже запущен: второй инстанс только поднимает окно и сразу выходит
if (Test-IslandElectronRunning) {
  Write-Log 'already running - focus via second instance'
  $focus = Start-IslandElectron
  Write-Log ("focus pid=" + $focus.Id)
  Write-Log 'focus requested'
  exit 0
}

Write-Log 'stop old'
& (Join-Path $island 'scripts\stop-island.ps1') *>> $log
Start-Sleep -Milliseconds 500

Write-Log 'build electron'
& $node (Join-Path $island 'scripts\build-electron.mjs') *>> $log
if ($LASTEXITCODE -ne 0) { Write-Log "build failed: $LASTEXITCODE"; exit 1 }

$viteOut = Join-Path $env:TEMP 'island-vite.out.log'
$viteErr = Join-Path $env:TEMP 'island-vite.err.log'

Write-Log 'start vite detached'
Start-Process -FilePath $node `
  -ArgumentList @($viteJs, '--host', '127.0.0.1', '--port', '5173') `
  -WorkingDirectory $island `
  -WindowStyle Hidden `
  -RedirectStandardOutput $viteOut `
  -RedirectStandardError $viteErr | Out-Null

Write-Log 'wait for vite'
$ready = $false
for ($i = 0; $i -lt 50; $i++) {
  try {
    $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 1
    if ($resp.StatusCode -ge 200) { $ready = $true; break }
  } catch {
    Start-Sleep -Milliseconds 400
  }
}
if (-not $ready) {
  Write-Log 'vite did not start'
  if (Test-Path $viteErr) {
    Write-Log ('vite err: ' + ((Get-Content $viteErr -Raw -ErrorAction SilentlyContinue) | Out-String).Substring(0, [Math]::Min(500, ((Get-Content $viteErr -Raw -ErrorAction SilentlyContinue) | Out-String).Length)))
  }
  exit 1
}
Write-Log 'vite ready'

Write-Log 'start electron detached'
$proc = Start-IslandElectron
Write-Log ("electron pid=" + $proc.Id)

Start-Sleep -Seconds 3
$alive = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
if (-not $alive) {
  Write-Log 'electron exited early'
  exit 1
}

Write-Log 'launched ok'
