$ErrorActionPreference = 'SilentlyContinue'
Write-Output 'Stopping Island processes...'

# Нельзя убивать сам лаунчер: его CommandLine тоже содержит путь к island
$keep = @($PID)
try {
  $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
  if ($parent) { $keep += [int]$parent }
} catch {}

Get-CimInstance Win32_Process |
  Where-Object {
    $_.ProcessId -and
    ($keep -notcontains [int]$_.ProcessId) -and
    $_.CommandLine -and
    $_.Name -match '^(node|electron)\.exe$' -and
    (
      $_.CommandLine -match 'ILON_MUSK_PROJECT_FIRE_GUN111\\island' -or
      $_.CommandLine -match 'scripts\\dev\.mjs'
    )
  } |
  ForEach-Object {
    Write-Output ("kill pid=$($_.ProcessId) name=$($_.Name)")
    Stop-Process -Id $_.ProcessId -Force
  }

# Порт 5173, если занят чужим процессом
$lines = netstat -ano | Select-String 'LISTENING' | Select-String ':5173'
foreach ($line in $lines) {
  if ($line.Line -match '\s(\d+)\s*$') {
    $portPid = [int]$Matches[1]
    if ($keep -notcontains $portPid) {
      Write-Output ("kill port5173 pid=$portPid")
      Stop-Process -Id $portPid -Force
    }
  }
}

Start-Sleep -Milliseconds 500
Write-Output 'stopped'
