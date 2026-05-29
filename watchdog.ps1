param(
  [string]$DataDir = "",
  [int]$PollSeconds = 5
)
$ErrorActionPreference = "Continue"

# ---------------------------------------------------------------------------
# Denfi Auto Shutdown - standalone watchdog
#
# This script ships next to the app (in <install>\resources\watchdog.ps1) and
# is launched by a Windows Scheduled Task, NOT as a child of the app. Running
# under Task Scheduler means it lives OUTSIDE the app's process job-object, so
# ending the app from Task Manager can never kill the watchdog. The watchdog
# then relaunches the app whenever it is missing (covers both the login lock
# screen and active session mode, because it simply watches the .exe).
#
# Admin "Stop App" is honored via a sentinel file: when present, the watchdog
# removes it and exits cleanly until the next logon.
# ---------------------------------------------------------------------------

# --- Self-locate the application (install root is the parent of this folder) ---
$InstallRoot = Split-Path -Parent $PSScriptRoot
$ExeName = "denfi-auto-shutdown"
$TargetExe = Join-Path $InstallRoot ($ExeName + ".exe")

if ($DataDir -eq "") { $DataDir = Join-Path $InstallRoot "data" }
try { if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir -Force | Out-Null } } catch {}

$SentinelFile = Join-Path $DataDir "admin-stopped.flag"
$LockFile     = Join-Path $DataDir "watchdog.lock"
$LogFile      = Join-Path $DataDir "watchdog.log"

function Write-Log($msg) {
  try {
    Add-Content -Path $LogFile -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg) -EA SilentlyContinue
  } catch {}
}

# --- Single-instance guard: if another live watchdog holds the lock, exit ---
if (Test-Path $LockFile) {
  try {
    $otherPid = (Get-Content $LockFile -EA SilentlyContinue | Select-Object -First 1)
    if ($otherPid) { $otherPid = "$otherPid".Trim() }
    if ($otherPid) {
      $other = Get-Process -Id $otherPid -EA SilentlyContinue
      # Only trust the lock if the PID is alive AND is actually a PowerShell
      # process. This avoids a false positive when the OS has recycled the PID
      # for some unrelated program (which would otherwise disable protection).
      if ($other -and $other.ProcessName -match '^(powershell|pwsh)$') {
        Write-Log "Another watchdog (PID=$otherPid) already running. Exiting."
        exit 0
      }
    }
  } catch {}
}
try { Set-Content -Path $LockFile -Value $PID -EA Stop } catch { Write-Log "Lockfile write failed: $($_.Exception.Message)" }

# --- Rotate log if it grows past 512 KB ---
if (Test-Path $LogFile) {
  try {
    if ((Get-Item $LogFile).Length -gt 524288) {
      $tail = Get-Content $LogFile -Tail 200
      Set-Content -Path $LogFile -Value $tail
    }
  } catch {}
}

Write-Log "Watchdog started PID=$PID Target=$TargetExe DataDir=$DataDir"

try {
  while ($true) {
    if (Test-Path $SentinelFile) {
      Write-Log "Sentinel detected -- admin stop. Removing sentinel and exiting."
      try { Remove-Item $SentinelFile -Force -EA SilentlyContinue } catch {}
      break
    }
    $proc = Get-Process -Name $ExeName -EA SilentlyContinue
    if (-not $proc) {
      # Grace window: an admin-stop may have just been issued and the app
      # exited before its sentinel was observed. Wait, then re-check.
      Start-Sleep -Seconds 3
      if (Test-Path $SentinelFile) {
        Write-Log "Sentinel appeared during grace period -- admin stop. Exiting."
        try { Remove-Item $SentinelFile -Force -EA SilentlyContinue } catch {}
        break
      }
      if (-not (Test-Path $TargetExe)) {
        Write-Log "Target exe not found at $TargetExe. Waiting."
        Start-Sleep -Seconds $PollSeconds
        continue
      }
      Write-Log "Target '$ExeName' not running. Relaunching: $TargetExe"
      try { Start-Process -FilePath $TargetExe -EA Stop; Write-Log "Relaunch issued." }
      catch { Write-Log "Relaunch FAILED: $($_.Exception.Message)" }
      Start-Sleep -Seconds 10
      continue
    }
    Start-Sleep -Seconds $PollSeconds
  }
} finally {
  try { Remove-Item $LockFile -Force -EA SilentlyContinue } catch {}
  Write-Log "Watchdog process exiting."
}
