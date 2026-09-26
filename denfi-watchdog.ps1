# ===========================================================================
# Denfi Auto Shutdown - STANDALONE Watchdog
#
# This is a self-contained script. It is NOT bundled inside the app. Run it
# ONCE per PC and it installs itself as an independent Windows Scheduled Task.
# Because it runs under Task Scheduler (NOT as a child of the app), ending the
# app from Task Manager can NEVER stop the watchdog. The watchdog then keeps
# the app alive - relaunching it in either login/lock mode or session mode.
#
# ---------------------------------------------------------------------------
# HOW TO USE
# ---------------------------------------------------------------------------
#   1) Keep denfi-watchdog-launch.vbs beside this file on the kiosk PC.
#   2) Double-click denfi-watchdog-launch.vbs. No PowerShell window appears.
#   3) Check watchdog-install.log in the app data folder for the result.
#      It installs + starts immediately and re-arms at every logon.
#      For interactive troubleshooting, run this script directly in PowerShell.
#
#   To remove it later:
#         powershell -ExecutionPolicy Bypass -File .\denfi-watchdog.ps1 -Uninstall
#
#   This watchdog is fixed to:
#         G:\auto\denfi-auto-shutdown\denfi-auto-shutdown.exe
# ===========================================================================

param(
  [string]$TargetExe = "",
  [string]$DataDir = "",
  [int]$PollSeconds = 5,
  [switch]$Watch,
  [switch]$Uninstall
)
$ErrorActionPreference = "Continue"

$TaskName = "DenfiAutoShutdownWatchdog"
$ExeBaseName = "denfi-auto-shutdown"
$FixedTargetExe = "G:\auto\denfi-auto-shutdown\denfi-auto-shutdown.exe"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Find-TargetExe {
  param([string]$hint)
  if ($hint -ne "") { return $hint }
  return $FixedTargetExe
}

# Mirror the app's data-dir logic so the admin-stop sentinel lines up exactly:
#   1) default = <exeFolder>\data
#   2) denfi-data-path.txt (next to exe) overrides, if it points at a local folder
#   3) DENFI_DATA_DIR env var overrides that
#   4) if the chosen custom dir is not usable/writable, fall back to the default
function Test-DirWritable {
  param([string]$dir)
  try {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force -EA Stop | Out-Null }
    $probe = Join-Path $dir (".denfi-write-test-" + [System.Guid]::NewGuid().ToString("N"))
    Set-Content -Path $probe -Value "ok" -EA Stop
    Remove-Item $probe -Force -EA SilentlyContinue
    return $true
  } catch { return $false }
}

function Resolve-DataDir {
  param([string]$exe, [string]$hint)
  if ($hint -ne "") { return $hint }
  if ($exe -eq "") { return "" }
  $exeDir = Split-Path -Parent $exe
  $default = (Join-Path $exeDir "data")
  $dataDir = $default

  $ptr = Join-Path $exeDir "denfi-data-path.txt"
  if (Test-Path $ptr) {
    try {
      $raw = (Get-Content $ptr -EA SilentlyContinue | Select-Object -First 1)
      if ($raw) { $raw = $raw.Trim() }
      if ($raw -and $raw.Length -gt 2 -and -not $raw.StartsWith("#") -and -not ($raw -match '^https?://')) {
        $dataDir = $raw
      }
    } catch {}
  }

  if ($env:DENFI_DATA_DIR -and $env:DENFI_DATA_DIR.Trim() -ne "") {
    $dataDir = $env:DENFI_DATA_DIR.Trim()
  }

  # Fall back to the portable default if the custom dir cannot be used, exactly
  # as the app does - otherwise the sentinel would land in different folders.
  if ($dataDir -ne $default -and -not (Test-DirWritable $dataDir)) {
    $dataDir = $default
  }
  return $dataDir
}

# ===========================================================================
# WATCH MODE - the actual monitoring loop (run by the scheduled task)
# ===========================================================================
function Invoke-WatchLoop {
  param([string]$exe, [string]$data, [int]$poll)

  $exeDir   = Split-Path -Parent $exe
  $exeName  = [System.IO.Path]::GetFileNameWithoutExtension($exe)
  try { if (-not (Test-Path $data)) { New-Item -ItemType Directory -Path $data -Force | Out-Null } } catch {}

  $SentinelFile = Join-Path $data "admin-stopped.flag"
  $LockFile     = Join-Path $data "watchdog.lock"
  $LogFile      = Join-Path $data "watchdog.log"

  function Write-Log($msg) {
    try {
      Add-Content -Path $LogFile -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg) -EA SilentlyContinue
    } catch {}
  }

  # Single-instance guard: only trust the lock if the PID is alive AND is a
  # PowerShell process (avoids false positives from a recycled PID).
  if (Test-Path $LockFile) {
    try {
      $otherPid = (Get-Content $LockFile -EA SilentlyContinue | Select-Object -First 1)
      if ($otherPid) { $otherPid = "$otherPid".Trim() }
      if ($otherPid) {
        $other = Get-Process -Id $otherPid -EA SilentlyContinue
        if ($other -and $other.ProcessName -match '^(powershell|pwsh)$') {
          Write-Log "Another watchdog (PID=$otherPid) already running. Exiting."
          return
        }
      }
    } catch {}
  }
  try { Set-Content -Path $LockFile -Value $PID -EA Stop } catch { Write-Log "Lockfile write failed: $($_.Exception.Message)" }

  # Rotate log past 512 KB.
  if (Test-Path $LogFile) {
    try {
      if ((Get-Item $LogFile).Length -gt 524288) {
        $tail = Get-Content $LogFile -Tail 200
        Set-Content -Path $LogFile -Value $tail
      }
    } catch {}
  }

  Write-Log "Watchdog started PID=$PID Target=$exe DataDir=$data"
  $healthFailures = 0
  $healthFailureLimit = 6

  try {
    while ($true) {
      if (Test-Path $SentinelFile) {
        Write-Log "Sentinel detected -- admin stop. Removing sentinel and exiting."
        try { Remove-Item $SentinelFile -Force -EA SilentlyContinue } catch {}
        break
      }
      $proc = @(Get-Process -Name $exeName -EA SilentlyContinue | Where-Object {
        try { $_.Path -and ($_.Path -ieq $exe) } catch { $false }
      })
      if (-not $proc) {
        # Grace window: an admin-stop may have just fired and the app exited
        # before its sentinel was observed. Wait, then re-check.
        Start-Sleep -Seconds 3
        if (Test-Path $SentinelFile) {
          Write-Log "Sentinel appeared during grace period -- admin stop. Exiting."
          try { Remove-Item $SentinelFile -Force -EA SilentlyContinue } catch {}
          break
        }
        if (-not (Test-Path $exe)) {
          # Self-heal: the app may have been reinstalled/moved since install.
          $found = Find-TargetExe -hint ""
          if ($found -ne "" -and (Test-Path $found)) {
            Write-Log "Target exe path changed. Re-detected: $found"
            $exe = $found
            $exeDir = Split-Path -Parent $exe
            $exeName = [System.IO.Path]::GetFileNameWithoutExtension($exe)
          } else {
            Write-Log "Target exe not found at $exe. Waiting."
            Start-Sleep -Seconds $poll
            continue
          }
        }
        Write-Log "Target '$exeName' not running. Relaunching: $exe"
        try { Start-Process -FilePath $exe -WorkingDirectory $exeDir -EA Stop; Write-Log "Relaunch issued." }
        catch { Write-Log "Relaunch FAILED: $($_.Exception.Message)" }
        Start-Sleep -Seconds 10
        $healthFailures = 0
        continue
      }

      # A process can still exist after its Electron main loop freezes. The
      # local API runs in that main process, so repeated health timeouts mean
      # the app is no longer able to protect or control the PC.
      $healthy = $false
      try {
        $health = Invoke-WebRequest -Uri "http://127.0.0.1:5001/api/admin/status" -UseBasicParsing -TimeoutSec 3 -EA Stop
        if ($health.StatusCode -eq 200) { $healthy = $true }
      } catch {}

      if ($healthy) {
        if ($healthFailures -gt 0) { Write-Log "Health check recovered." }
        $healthFailures = 0
      } else {
        $healthFailures++
        Write-Log "Health check failed ($healthFailures/$healthFailureLimit)."
        if ($healthFailures -ge $healthFailureLimit) {
          Write-Log "App remained unhealthy. Terminating it so the watchdog can relaunch it."
          try { $proc | Stop-Process -Force -EA SilentlyContinue } catch {}
          $healthFailures = 0
          Start-Sleep -Seconds 3
          continue
        }
      }
      Start-Sleep -Seconds $poll
    }
  } finally {
    try { Remove-Item $LockFile -Force -EA SilentlyContinue } catch {}
    Write-Log "Watchdog process exiting."
  }
}

# ===========================================================================
# UNINSTALL MODE
# ===========================================================================
function Invoke-Uninstall {
  param([string]$data)

  # Stop the running watchdog process (if any) via the lockfile PID, making sure
  # it is actually a PowerShell process before killing it.
  if ($data -ne "") {
    $lock = Join-Path $data "watchdog.lock"
    if (Test-Path $lock) {
      try {
        $wpid = (Get-Content $lock -EA SilentlyContinue | Select-Object -First 1)
        if ($wpid) { $wpid = "$wpid".Trim() }
        if ($wpid) {
          $p = Get-Process -Id $wpid -EA SilentlyContinue
          if ($p -and $p.ProcessName -match '^(powershell|pwsh)$') {
            Stop-Process -Id $wpid -Force -EA SilentlyContinue
            Write-Host "Stopped running watchdog (PID=$wpid)." -ForegroundColor Green
          }
        }
        Remove-Item $lock -Force -EA SilentlyContinue
      } catch {}
    }
  }

  try {
    Stop-ScheduledTask -TaskName $TaskName -EA SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -EA Stop
    Write-Host "Removed scheduled task '$TaskName'." -ForegroundColor Green
  } catch {
    Write-Host "No scheduled task '$TaskName' found (nothing to remove)." -ForegroundColor Yellow
  }
}

# ===========================================================================
# INSTALL MODE - register the task + start it now (run by the operator once)
# ===========================================================================
function Invoke-Install {
  param([string]$exe, [string]$data, [int]$poll)

  if ($exe -eq "") {
    Write-Host "ERROR: Watchdog target path is empty." -ForegroundColor Red
    return
  }

  try { if (-not (Test-Path $data)) { New-Item -ItemType Directory -Path $data -Force | Out-Null } } catch {}
  $installLog = Join-Path $data "watchdog-install.log"
  function Write-InstallLog([string]$message) {
    try {
      Add-Content -Path $installLog -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message) -EA Stop
    } catch {}
  }
  Write-InstallLog "Installing watchdog for $exe"

  # Install stable copies of both files together so the task keeps working
  # even if the operator deletes the files they ran from the Desktop.
  $installedScript = Join-Path $data "denfi-watchdog.ps1"
  $installedLauncher = Join-Path $data "denfi-watchdog-launch.vbs"
  $launcherSource = Join-Path (Split-Path -Parent $PSCommandPath) "denfi-watchdog-launch.vbs"
  try {
    if (-not $PSCommandPath -or -not (Test-Path $launcherSource)) {
      throw "denfi-watchdog-launch.vbs must be beside denfi-watchdog.ps1."
    }
    if ($PSCommandPath -ne $installedScript) { Copy-Item -Path $PSCommandPath -Destination $installedScript -Force -EA Stop }
    if ($launcherSource -ne $installedLauncher) { Copy-Item -Path $launcherSource -Destination $installedLauncher -Force -EA Stop }
  } catch {
    Write-InstallLog "FAILED to install watchdog files: $($_.Exception.Message)"
    Write-Host "Failed to install watchdog files: $($_.Exception.Message)" -ForegroundColor Red
    return
  }

  $argLine = "//B //Nologo `"$installedLauncher`" -Watch -TargetExe `"$exe`" -DataDir `"$data`" -PollSeconds $poll"

  try {
    $action   = New-ScheduledTaskAction -Execute "wscript.exe" -Argument $argLine
    $trigger  = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force -RunLevel Limited | Out-Null
    Write-InstallLog "Scheduled task registered (windowless launcher)."
    Write-Host "Installed scheduled task '$TaskName' (runs at every logon)." -ForegroundColor Green
  } catch {
    Write-InstallLog "FAILED to register scheduled task: $($_.Exception.Message)"
    Write-Host "Failed to register scheduled task: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Try running this script as Administrator." -ForegroundColor Yellow
    return
  }

  # Start it now so you do not have to log off/on.
  try {
    # Reinstalling an older task must stop its visible PowerShell instance
    # before starting the windowless one.
    if ((Get-ScheduledTask -TaskName $TaskName -EA Stop).State -eq 'Running') {
      Stop-ScheduledTask -TaskName $TaskName -EA Stop
    }
    $oldProcess = $null
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
      $lock = Join-Path $data "watchdog.lock"
      if (-not (Test-Path $lock)) { $oldProcess = $null; break }
      $oldPid = Get-Content $lock -EA SilentlyContinue | Select-Object -First 1
      $oldProcess = if ($oldPid -match '^\d+$') { Get-Process -Id $oldPid -EA SilentlyContinue }
      if (-not $oldProcess -or $oldProcess.ProcessName -notmatch '^(powershell|pwsh)$') { break }
      Start-Sleep -Milliseconds 250
    }
    if ($oldProcess -and $oldProcess.ProcessName -match '^(powershell|pwsh)$') {
      throw "The previous watchdog is still running. Close its old window, then rerun the silent launcher."
    }
    Start-ScheduledTask -TaskName $TaskName
    Write-InstallLog "Scheduled task started. Check watchdog.log for the watchdog startup."
    Write-Host "Watchdog started now." -ForegroundColor Green
  } catch {
    Write-InstallLog "Could not start scheduled task immediately: $($_.Exception.Message)"
    Write-Host "Could not start the task immediately: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "It will start automatically at the next logon." -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "Watching : $exe"
  Write-Host "Data dir : $data"
  Write-Host "Log file : $(Join-Path $data 'watchdog.log')"
  Write-Host ""
  Write-Host "All set. The watchdog now runs independently and survives 'End task'." -ForegroundColor Cyan
}

# ===========================================================================
# Entry point
# ===========================================================================
$exe  = Find-TargetExe -hint $TargetExe
$data = Resolve-DataDir -exe $exe -hint $DataDir

if ($Uninstall) {
  Invoke-Uninstall -data $data
}
elseif ($Watch) {
  # Launched by the scheduled task.
  if ($exe -eq "") { $exe = Find-TargetExe -hint "" }
  if ($data -eq "") { $data = Resolve-DataDir -exe $exe -hint "" }
  Invoke-WatchLoop -exe $exe -data $data -poll $PollSeconds
}
else {
  # Launched by the operator (default) -> install + start.
  Invoke-Install -exe $exe -data $data -poll $PollSeconds
}
