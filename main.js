const { app, BrowserWindow, Menu, ipcMain, globalShortcut } = require('electron');
const { exec, execFileSync, spawn } = require('child_process');
const path = require('path');
const appLock = require('./src/app-lock');
const settingsStore = require('./src/settings-store');

process.env.DENFI_APP_ROLE = 'auto-shutdown';


let activeSentinelFile = null;

function writeAdminStopSentinel() {
  if (!activeSentinelFile) return;
  try {
    require('fs').writeFileSync(activeSentinelFile, String(Date.now()));
    console.log('[Watchdog] Sentinel written:', activeSentinelFile);
  } catch (e) {
    console.log('[Watchdog] Failed to write sentinel:', e.message);
  }
}


app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setName('Denfi Auto Shutdown');
const autoUserData = path.join(app.getPath('appData'), 'denfi-auto-shutdown');
require('fs').mkdirSync(autoUserData, { recursive: true });
app.setPath('userData', autoUserData);

const PORT = 5001;
const APP_URL = `http://127.0.0.1:${PORT}`;

let kioskHookProcess = null;

function enableKioskLockdown() {
  if (process.platform !== 'win32') return;
  console.log('[Kiosk] Enabling lockdown...');

  startKeyboardHook();
  startLockEnforcement();
}

function disableKioskLockdown() {
  if (process.platform !== 'win32') return;
  console.log('[Kiosk] Disabling lockdown...');

  stopKeyboardHook();
  stopLockEnforcement();
}

// While the lock screen is active, no other application may hold the
// foreground. Exclusive-fullscreen games (e.g. GTA) can render ABOVE an
// always-on-top "screen-saver" level window, visually bypassing the lock.
// To defeat that, a single persistent PowerShell guard continuously
// force-minimizes any foreground window whose owning process is not OUR app.
//
// Trust is decided by the full executable PATH (not the process name) so it
// (a) cannot be spoofed by simply renaming an exe, and (b) correctly trusts
// every Electron helper process (gpu/renderer) which all share our exe path.
const LOCK_GUARD_SCRIPT = `
param(
  [Parameter(Mandatory=$$true)][string]$$SelfPath,
  [int]$$PollMs = 1000
)
$$ErrorActionPreference = "Continue"
Add-Type -MemberDefinition @"
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmd);
"@ -Name W -Namespace LG
$$self = $$SelfPath.ToLower()
while ($$true) {
  try {
    $$h = [LG.W]::GetForegroundWindow()
      if ($$h -ne [IntPtr]::Zero) {
      $$fpid = 0
      [LG.W]::GetWindowThreadProcessId($$h, [ref]$$fpid) | Out-Null
      $$p = Get-Process -Id $$fpid -EA SilentlyContinue
      $$path = ""
      if ($$p) { try { $$path = $$p.Path } catch { $$path = "" } }
        # Start menu and some Windows shell surfaces do not expose a normal
        # executable path. Treat those foreground surfaces as untrusted too.
        if (!$$path -or $$path.ToLower() -ne $$self) {
        [LG.W]::ShowWindowAsync($$h, 11) | Out-Null
          [Console]::Out.WriteLine("RECLAIMING LOCK FOCUS")
        [Console]::Out.Flush()
      }
    }
  } catch {}
  Start-Sleep -Milliseconds $$PollMs
}
`.replace(/\$\$/g, '$');

let lockGuardProcess = null;
let lockGuardScriptPath = null;

function cleanupLockGuardScript() {
  if (lockGuardScriptPath) {
    try { require('fs').unlinkSync(lockGuardScriptPath); } catch (e) {}
    lockGuardScriptPath = null;
  }
}

function startLockEnforcement() {
  if (process.platform !== 'win32') return;
  if (lockGuardProcess) return;
  const os = require('os');
  const fs = require('fs');
  const crypto = require('crypto');
  const uniqueId = crypto.randomBytes(8).toString('hex');
  const guardPath = path.join(os.tmpdir(), `denfi-lock-guard-${uniqueId}.ps1`);
  try {
    fs.writeFileSync(guardPath, LOCK_GUARD_SCRIPT, { encoding: 'utf8', mode: 0o600 });
    lockGuardScriptPath = guardPath;

    lockGuardProcess = spawn('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-WindowStyle', 'Hidden',
      '-NoProfile',
      '-File', guardPath,
      '-SelfPath', app.getPath('exe'),
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

    lockGuardProcess.stdout.on('data', (data) => {
      const line = data.toString().trim();
      if (line) {
        console.log('[Lock]', line, '- reclaiming lock focus');
        reclaimFocus();
      }
    });
    lockGuardProcess.stderr.on('data', (data) => {
      console.log('[Lock Guard Error]', data.toString().trim());
    });
    lockGuardProcess.on('error', (err) => {
      console.log('[Lock Guard] spawn error:', err.message);
      lockGuardProcess = null;
      cleanupLockGuardScript();
    });
    lockGuardProcess.on('exit', (code) => {
      console.log('[Lock Guard] exited with code', code);
      lockGuardProcess = null;
      cleanupLockGuardScript();
    });
    console.log('[Lock] Foreground enforcement started.');
  } catch (e) {
    console.log('[Lock] Failed to start foreground enforcement:', e.message);
    cleanupLockGuardScript();
  }
}

function stopLockEnforcement() {
  if (lockGuardProcess) {
    const pid = lockGuardProcess.pid;
    try { lockGuardProcess.kill('SIGKILL'); } catch (_) {}
    lockGuardProcess = null;
    cleanupLockGuardScript();
    if (process.platform === 'win32' && pid) {
      try {
        require('child_process').execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'ignore' });
      } catch (_) {}
    }
    console.log('[Lock] Foreground enforcement stopped.');
  }
}

const HOOK_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class KioskHook {
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private static IntPtr hookId = IntPtr.Zero;
    private static HookProc hookProc;
    private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string lpModuleName);
    public static void Install() {
        hookProc = HookCallback;
        hookId = SetWindowsHookEx(WH_KEYBOARD_LL, hookProc, GetModuleHandle(null), 0);
    }
    public static void Uninstall() {
        if (hookId != IntPtr.Zero) { UnhookWindowsHookEx(hookId); hookId = IntPtr.Zero; }
    }
    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            int vkCode = Marshal.ReadInt32(lParam);
            if (vkCode == 91 || vkCode == 92) return (IntPtr)1;
            if (vkCode == 164 || vkCode == 165) return (IntPtr)1;
            if (vkCode == 46) return (IntPtr)1;
            if ((int)wParam == WM_SYSKEYDOWN || (int)wParam == WM_KEYDOWN) {
                bool alt = (Control.ModifierKeys & Keys.Alt) != 0;
                if (alt && vkCode == 9) return (IntPtr)1;
                if (alt && vkCode == 27) return (IntPtr)1;
                if (alt && vkCode == 115) return (IntPtr)1;
            }
        }
        return CallNextHookEx(hookId, nCode, wParam, lParam);
    }
}
"@ -ReferencedAssemblies System.Windows.Forms
[KioskHook]::Install()
[Console]::Out.WriteLine("KIOSK_HOOK_ACTIVE")
[Console]::Out.Flush()
try { while ($$true) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 50 } }
finally { [KioskHook]::Uninstall() }
`.replace(/\$\$/g, '$');

let kioskHookScriptPath = null;

function cleanupHookScript() {
  if (kioskHookScriptPath) {
    try { require('fs').unlinkSync(kioskHookScriptPath); } catch (e) {}
    kioskHookScriptPath = null;
  }
}

function startKeyboardHook() {
  if (kioskHookProcess) return;
  const os = require('os');
  const fs = require('fs');
  const crypto = require('crypto');
  const uniqueId = crypto.randomBytes(8).toString('hex');
  const hookPath = path.join(os.tmpdir(), `pisonet-kiosk-hook-${uniqueId}.ps1`);
  try {
    fs.writeFileSync(hookPath, HOOK_SCRIPT, { encoding: 'utf8', mode: 0o600 });
    kioskHookScriptPath = hookPath;
    console.log('[Kiosk] Hook script written to:', hookPath);

    kioskHookProcess = spawn('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-WindowStyle', 'Hidden',
      '-File', hookPath
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

    kioskHookProcess.stdout.on('data', (data) => {
      console.log('[Kiosk Hook]', data.toString().trim());
    });
    kioskHookProcess.stderr.on('data', (data) => {
      console.log('[Kiosk Hook Error]', data.toString().trim());
    });
    kioskHookProcess.on('error', (err) => {
      console.log('[Kiosk Hook] spawn error:', err.message);
      kioskHookProcess = null;
      cleanupHookScript();
    });
    kioskHookProcess.on('exit', (code) => {
      console.log('[Kiosk Hook] exited with code', code);
      kioskHookProcess = null;
      cleanupHookScript();
    });
    console.log('[Kiosk] Keyboard hook started');
  } catch (e) {
    console.log('[Kiosk] Failed to start keyboard hook:', e.message);
    cleanupHookScript();
  }
}

function stopKeyboardHook() {
  if (kioskHookProcess) {
    const pid = kioskHookProcess.pid;
    try { kioskHookProcess.kill('SIGKILL'); } catch (_) {}
    kioskHookProcess = null;
    cleanupHookScript();
    if (process.platform === 'win32' && pid) {
      try {
        require('child_process').execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'ignore' });
      } catch (_) {}
    }
    console.log('[Kiosk] Keyboard hook stopped (pid:', pid, ')');
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.exit(0);
}

process.on('uncaughtException', (err) => {
  console.error('[Electron] Uncaught exception:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[Electron] Unhandled rejection:', err?.message || err);
});

process.on('exit', () => {
  try { stopKeyboardHook(); } catch (e) {}
  try { cleanupHookScript(); } catch (e) {}
  try { stopLockEnforcement(); } catch (e) {}
});

process.on('admin-stop-app', () => {
  console.log('[Electron] Admin stop-app received, cleaning up...');
  isQuitting = true;
  try { writeAdminStopSentinel(); } catch (e) {}
  try { appLock.releaseLock(); } catch (e) {}
  try { stopKeyboardHook(); } catch (e) {}
  try { cleanupHookScript(); } catch (e) {}
  try { stopLockEnforcement(); } catch (e) {}
  try { unregisterKeyBlocks(); } catch (e) {}
  if (focusGuardInterval) {
    clearInterval(focusGuardInterval);
    focusGuardInterval = null;
  }
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      execSync('taskkill /F /IM powershell.exe /FI "WINDOWTITLE eq pisonet*"', { stdio: 'ignore' });
    } catch (e) {}
  }
  try {
    if (sessionWindow && !sessionWindow.isDestroyed()) sessionWindow.destroy();
    if (loginWindow && !loginWindow.isDestroyed()) loginWindow.destroy();
  } catch (e) {}
  console.log('[Electron] Cleanup done, exiting.');
  app.exit(0);
});

let loginWindow;
let sessionWindow;
let isQuitting = false;
let currentState = 'logged-out';
let focusGuardInterval = null;
let idleShutdownTimer = null;
let idleShutdownConfiguredSeconds = 0;
let idleShutdownDeadline = 0;
let shutdownIssued = false;

function isLockState() {
  return currentState === 'logged-out' || currentState === 'restoring-session';
}

function issueSystemShutdown(reason) {
  if (shutdownIssued) return;
  shutdownIssued = true;
  if (idleShutdownTimer) clearTimeout(idleShutdownTimer);
  idleShutdownTimer = null;
  idleShutdownDeadline = 0;
  console.log('[Electron] System shutdown requested:', reason);

  if (process.platform === 'win32') {
    try {
      const child = spawn('shutdown', ['/s', '/t', '0', '/f'], {
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
      });
      child.unref();
    } catch (error) {
      console.error('[Electron] Could not issue Windows shutdown:', error.message);
      shutdownIssued = false;
      return;
    }
  } else {
    exec('shutdown -h now', (error) => {
      if (error) {
        console.log('[Electron] Non-Windows shutdown failed:', error.message);
        shutdownIssued = false;
      }
    });
  }

  // Cleanup is best-effort and must never delay the shutdown command.
  setImmediate(() => {
    try { closeConfiguredPrograms('shutdown'); } catch (_) {}
  });
}

function syncIdleShutdownTimer(force) {
  if (currentState !== 'logged-out' || idleShutdownConfiguredSeconds <= 0) {
    if (idleShutdownTimer) clearTimeout(idleShutdownTimer);
    idleShutdownTimer = null;
    idleShutdownDeadline = 0;
    return;
  }

  if (shutdownIssued) return;
  if (!force && idleShutdownTimer) return;
  if (idleShutdownTimer) clearTimeout(idleShutdownTimer);
  idleShutdownDeadline = Date.now() + (idleShutdownConfiguredSeconds * 1000);
  idleShutdownTimer = setTimeout(() => {
    idleShutdownTimer = null;
    issueSystemShutdown('idle lock-screen timer expired');
  }, idleShutdownConfiguredSeconds * 1000);
  console.log(`[Electron] Main-process idle shutdown armed for ${idleShutdownConfiguredSeconds}s`);
}

function setIdleShutdownConfig(seconds) {
  const nextSeconds = Math.max(0, Number(seconds) || 0);
  if (nextSeconds === idleShutdownConfiguredSeconds) return;
  idleShutdownConfiguredSeconds = nextSeconds;
  syncIdleShutdownTimer(true);
}

function closeConfiguredPrograms(reason) {
  if (process.platform !== 'win32') return;
  const names = settingsStore.getSettings().closeOnLock || [];
  if (!names.length) return;
  console.log(`[Electron] Closing configured programs before ${reason}:`, names.join(', '));
  const aliases = {
    'gta5.exe': ['GTA5.exe', 'GTA5_Enhanced.exe', 'PlayGTAV.exe', 'GTAVLauncher.exe'],
    'gta5_enhanced.exe': ['GTA5.exe', 'GTA5_Enhanced.exe', 'PlayGTAV.exe', 'GTAVLauncher.exe'],
    'roblox.exe': ['RobloxPlayerBeta.exe', 'RobloxPlayerLauncher.exe', 'RobloxCrashHandler.exe'],
  };
  const processNames = [...new Set(names.flatMap(name => aliases[name.toLowerCase()] || [name]))];
  for (const name of processNames) {
    try {
      execFileSync('taskkill', ['/F', '/T', '/IM', name], { windowsHide: true, stdio: 'ignore' });
    } catch (_) {
      // taskkill returns a failure code when the configured program is not running.
    }
  }
  // Some launchers briefly respawn a child process after the first kill pass.
  // Run a second pass so the lock screen does not leave a memory-heavy game
  // alive behind it.
  if (processNames.length) {
    try {
      execFileSync('timeout', ['/T', '1', '/NOBREAK'], { windowsHide: true, stdio: 'ignore' });
    } catch (_) {}
    for (const name of processNames) {
      try {
        execFileSync('taskkill', ['/F', '/T', '/IM', name], { windowsHide: true, stdio: 'ignore' });
      } catch (_) {}
    }
  }
}

// Keep the session overlay compact on top of fullscreen games. The HTML
// renders at its original logical size and scales itself to these bounds.
const SESSION_WIDTH = 331;
const SESSION_MAX_WIDTH = 560;
const SESSION_HEIGHT = 70;
const SESSION_EXPANDED_HEIGHT = 253;
let currentSessionWidth = SESSION_WIDTH;
let currentSessionHeight = SESSION_HEIGHT;
let currentSessionPlacement = 'above';

function performLogout() {
  return new Promise((resolve) => {
    const http = require('http');
    const statusReq = http.get(`${APP_URL}/api/hotspot/status`, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.success && data.data && data.data.isLogin) {
            const logoutLink = data.data.logoutLink || '';
            const postData = JSON.stringify({ logoutLink });
            const logoutReq = http.request(`${APP_URL}/api/hotspot/logout`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
            }, () => resolve());
            logoutReq.on('error', () => resolve());
            logoutReq.write(postData);
            logoutReq.end();
          } else {
            resolve();
          }
        } catch (e) { resolve(); }
      });
    });
    statusReq.on('error', () => resolve());
    setTimeout(resolve, 8000);
  });
}

function reclaimFocus() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    try { app.focus({ steal: true }); } catch (_) {}
    loginWindow.moveTop();
    loginWindow.focus();
  }
}

function registerKeyBlocks() {
  const shortcuts = [
    'Alt+Tab', 'Alt+F4', 'Alt+Escape', 'Alt+Space',
    'Alt+Enter', 'Alt+F1', 'Alt+F2',
    'Super', 'Super+D', 'Super+E', 'Super+R', 'Super+L',
    'Super+Tab', 'Super+X', 'Super+I', 'Super+S', 'Super+A',
    'Super+M', 'Super+P', 'Super+B', 'Super+T', 'Super+G',
    'Super+K', 'Super+H', 'Super+Q', 'Super+N', 'Super+V',
    'Super+C', 'Super+F', 'Super+O', 'Super+U', 'Super+W',
    'Super+1', 'Super+2', 'Super+3', 'Super+4', 'Super+5',
    'Super+6', 'Super+7', 'Super+8', 'Super+9', 'Super+0',
    'Super+Up', 'Super+Down', 'Super+Left', 'Super+Right',
    'Super+Shift+S',
    'Ctrl+Shift+Escape',
    'Ctrl+Escape',
    'Ctrl+Shift+Delete',
    'Ctrl+Alt+Tab',
    'F1', 'F2', 'F3', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  ];
  for (const sc of shortcuts) {
    try {
      const ok = globalShortcut.register(sc, reclaimFocus);
      if (!ok) console.log(`[Electron] Shortcut ${sc} not available (OS-reserved)`);
    } catch (e) {
      console.log(`[Electron] Could not register ${sc}:`, e.message);
    }
  }
}

function unregisterKeyBlocks() {
  try {
    globalShortcut.unregisterAll();
  } catch (e) {}
}

app.on('before-quit', (event) => {
  if (!isQuitting) {
    isQuitting = true;
    event.preventDefault();
    console.log('[Electron] App closing, performing logout...');
    try { appLock.releaseLock(); } catch (_) {}
    unregisterKeyBlocks();
    disableKioskLockdown();
    if (focusGuardInterval) {
      clearInterval(focusGuardInterval);
      focusGuardInterval = null;
    }
    performLogout().finally(() => {
      console.log('[Electron] Logout done, quitting.');
      app.exit(0);
    });
  }
});

app.on('second-instance', () => {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
  } else if (sessionWindow && !sessionWindow.isDestroyed()) {
    sessionWindow.focus();
  }
});

// Self-heal: an Electron app is several OS processes (main + GPU + renderer +
// utility helpers) — all show as "Denfi Auto Shutdown" in Task Manager. The
// external watchdog only relaunches when ALL of them are gone (i.e. the main
// process is killed). If someone instead ends a single child process (e.g. the
// window's renderer or the GPU process), the main process survives, so the
// watchdog stays idle and the app is left broken with no visible window. Catch
// those child deaths here and relaunch the whole app cleanly so it always
// comes back. The single-instance lock makes any race with the watchdog safe.
let isSelfHealing = false;
function selfHealRelaunch(tag, reason) {
  if (isQuitting || isSelfHealing) return;
  if (reason === 'clean-exit') return; // normal window teardown, not a kill
  isSelfHealing = true;
  console.error(`[Electron] ${tag} (reason=${reason}) — relaunching app to recover.`);
  try { app.relaunch(); } catch (_) {}
  app.exit(0);
}

function attachRendererRecovery(window, label) {
  if (!window || window.isDestroyed()) return;
  let unresponsiveTimer = null;
  const clearRecoveryTimer = () => {
    if (unresponsiveTimer) clearTimeout(unresponsiveTimer);
    unresponsiveTimer = null;
  };

  window.webContents.on('unresponsive', () => {
    if (isQuitting || isSelfHealing || unresponsiveTimer) return;
    console.error(`[Electron] ${label} renderer is unresponsive; waiting 10s before recovery.`);
    unresponsiveTimer = setTimeout(() => {
      unresponsiveTimer = null;
      selfHealRelaunch(`${label} renderer remained unresponsive`, 'unresponsive');
    }, 10000);
  });
  window.webContents.on('responsive', clearRecoveryTimer);
  window.webContents.once('destroyed', clearRecoveryTimer);
}

app.on('render-process-gone', (_event, _webContents, details) => {
  selfHealRelaunch('render-process-gone', details && details.reason);
});

app.on('child-process-gone', (_event, details) => {
  selfHealRelaunch('child-process-gone', details && details.reason);
});

app.whenReady().then(async () => {
  const path = require('path');
  const fs = require('fs');
  const settings = require('./src/settings-store');
  const coinLogs = require('./src/coin-log-store');
  const orderStore = require('./src/order-store');
  const attendance = require('./src/attendance-store');

  const defaultDataDir = path.join(path.dirname(app.getPath('exe')), 'data');
  let dataDir = defaultDataDir;

  let syncServerUrl = '';

  const dataPathFile = path.join(path.dirname(app.getPath('exe')), 'denfi-data-path.txt');
  try {
    if (fs.existsSync(dataPathFile)) {
      const raw = fs.readFileSync(dataPathFile, 'utf8').trim();
      const customPath = raw.split('\n')[0].trim();
      if (customPath && customPath.length > 2 && !customPath.startsWith('#')) {
        if (customPath.startsWith('http://') || customPath.startsWith('https://')) {
          syncServerUrl = customPath.replace(/\/+$/, '');
          console.log('[Electron] Using HTTP sync server:', syncServerUrl);
        } else {
          dataDir = customPath;
          console.log('[Electron] Using custom data path from denfi-data-path.txt:', dataDir);
        }
      }
    }
  } catch (e) {
    console.log('[Electron] Error reading denfi-data-path.txt:', e.message);
  }

  if (process.env.DENFI_DATA_DIR) {
    dataDir = process.env.DENFI_DATA_DIR;
    console.log('[Electron] Using data path from DENFI_DATA_DIR env:', dataDir);
  }

  if (process.env.DENFI_SYNC_SERVER) {
    syncServerUrl = process.env.DENFI_SYNC_SERVER.replace(/\/+$/, '');
    console.log('[Electron] Using sync server from env:', syncServerUrl);
  }

  if (dataDir !== defaultDataDir) {
    try {
      fs.accessSync(dataDir.replace(/\\[^\\]+$/, '\\'), fs.constants.F_OK);
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.accessSync(dataDir, fs.constants.W_OK);
      console.log('[Electron] Custom data dir OK:', dataDir);
    } catch (e) {
      console.log('[Electron] Cannot access custom data dir, falling back to portable:', e.message);
      dataDir = defaultDataDir;
    }
  }

  // Publish the data folder atomically with the role lock. The other app can
  // then reject a shared folder even when both are launched simultaneously.
  const lockResult = await appLock.acquireLock('auto-shutdown', dataDir);
  if (!lockResult.acquired) {
    const { dialog } = require('electron');
    dialog.showErrorBox('Denfi Auto Shutdown',
      'Cannot start: Auto Shutdown is already running on this PC, or its local lock is in use.');
    app.exit(1);
    return;
  }
  const pointsHolder = await appLock.queryHolder('points');
  if (appLock.sameDataDir(dataDir, pointsHolder?.dataDir)) {
    const { dialog } = require('electron');
    dialog.showErrorBox('Denfi Auto Shutdown',
      'Auto Shutdown and Denfi Points can run on the same PC, but cannot share one data folder. Install them in separate folders before starting both.');
    app.exit(1);
    return;
  }
  process.env.PORT = String(PORT);

  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  } catch (e) {
    console.log('[Electron] Cannot create data dir:', e.message);
  }

  settings.setAppRole('auto-shutdown');
  settings.setDataDir(dataDir);
  coinLogs.setDataDir(dataDir);
  orderStore.setDataDir(dataDir);
  attendance.setDataDir(dataDir);
  const connectionHint = require('./src/connection-hint');
  const existingPointsAddress = syncServerUrl || settings.getSettings().syncServerUrl;
  if (existingPointsAddress) {
    try { connectionHint.writeHint(existingPointsAddress); }
    catch (err) { console.log('[Electron] Could not preserve Points address across reinstall:', err.message); }
  } else {
    const restoredAddress = connectionHint.readHint();
    if (restoredAddress) {
      syncServerUrl = restoredAddress;
      settings.updateSettings({ syncServerUrl: restoredAddress });
      console.log('[Electron] Restored Denfi Points address from machine settings:', restoredAddress);
    }
  }
  currentState = 'restoring-session';
  setIdleShutdownConfig(settingsStore.getSettings().autoShutdownSeconds);
  console.log('[Electron] Data dir:', dataDir);

  // The watchdog is no longer baked into the app. It is now a standalone
  // PowerShell script (denfi-watchdog.ps1) that the operator installs ONCE per
  // PC and which runs independently under Task Scheduler. The app only records
  // where the admin-stop sentinel lives so "Stop App" can tell the external
  // watchdog to stand down.
  try { activeSentinelFile = path.join(dataDir, 'admin-stopped.flag'); } catch (_) {}

  function waitForServer(retries) {
    const http = require('http');
    return new Promise((resolve, reject) => {
      function check() {
        const req = http.get(`${APP_URL}/api/admin/status`, (res) => {
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => {
            try {
              const data = JSON.parse(body);
              if (data.registered !== undefined && data.appRole === 'auto-shutdown') {
                resolve();
              } else if (data.registered !== undefined && data.appRole && data.appRole !== 'auto-shutdown') {
                reject(new Error('Port ' + PORT + ' is serving another app.'));
              } else {
                retry();
              }
            } catch (_) {
              retry();
            }
          });
        });
        req.on('error', () => {
          retry();
        });
        req.setTimeout(1000, () => {
          try { req.destroy(); } catch (_) {}
        });

        function retry() {
          if (retries > 0) {
            retries--;
            setTimeout(check, 300);
          } else {
            reject(new Error('Server did not start in time'));
          }
        }
      }
      check();
    });
  }

  if (!syncServerUrl) {
    process.env.DENFI_LISTEN_HOST = '0.0.0.0';
    console.log('[Electron] Server mode: listening on all interfaces (0.0.0.0)');
  }

  let serverModule;
  try {
    serverModule = require('./server');
    if (syncServerUrl && serverModule.setSyncServer) {
      serverModule.setSyncServer(syncServerUrl);
    }
  } catch (err) {
    console.error('[Electron] Failed to start server:', err);
    const { dialog } = require('electron');
    dialog.showErrorBox('Denfi Auto Shutdown', 'Server failed to start:\n' + err.message);
    app.quit();
    return;
  }

  waitForServer(40).then(async () => {
    await bootInitialWindow();
  }).catch((err) => {
    console.error('[Electron] Server startup failed:', err.message);
    const { dialog } = require('electron');
    dialog.showErrorBox('Denfi Auto Shutdown', 'Server did not respond.\nPort ' + PORT + ' may be in use by another program.\n\nClose any other instances and try again.\n\n' + err.message);
    app.quit();
  });
});

function fetchSessionStatus() {
  return new Promise((resolve) => {
    const http = require('http');
    const req = http.get(`${APP_URL}/api/hotspot/status`, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (_) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(6000, () => { try { req.destroy(); } catch (_) {} resolve(null); });
  });
}

// Decide which UI to show at startup. The watchdog relaunches this app whenever
// it is killed/end-tasked. If that happens mid-session we must RESTORE the
// running session instead of dumping the user to the lock screen. If there is
// no active session (or time is up, or the hotspot is unreachable) we fail
// SAFE and show the lock screen so a paid game can never be played for free.
function bootInitialWindow() {
  // Fail safe immediately: display the protected lock screen before any
  // hotspot request. A slow or offline portal must not look like an app freeze.
  currentState = 'restoring-session';
  showLoginWindow();

  void (async () => {
  // The hotspot portal can be briefly unreachable right after a relaunch/boot.
  // Retry a few times so a slow portal does not wrongly drop an active session
  // to the lock screen. A definitive answer (portal reachable) breaks early.
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (currentState !== 'restoring-session') return;
    const status = await fetchSessionStatus();
    if (status && status.success && status.data) {
      const timeLeft = parseInt(status.data.sessionTimeLeft) || 0;
      if (status.data.isLogin && timeLeft > 0 && currentState === 'restoring-session') {
        console.log('[Electron] Active session detected after startup — restoring session mode.');
        handleStateChange('logged-in');
      } else if (currentState === 'restoring-session') {
        currentState = 'logged-out';
        shutdownIssued = false;
        syncIdleShutdownTimer(true);
      }
      return; // portal answered definitively — trust it
    }
    if (attempt < maxAttempts) {
      console.log(`[Electron] Session status not ready (attempt ${attempt}/${maxAttempts}), retrying...`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  if (currentState === 'restoring-session') {
    currentState = 'logged-out';
    shutdownIssued = false;
    syncIdleShutdownTimer(true);
  }
  console.log('[Electron] Session status unavailable at startup — keeping lock screen active.');
  })();
}

function showLoginWindow(onReady, options = {}) {
  const { screen } = require('electron');
  const initialBounds = screen.getPrimaryDisplay().bounds;

  registerKeyBlocks();
  enableKioskLockdown();

  loginWindow = new BrowserWindow({
    ...initialBounds,
    title: 'Denfi Auto Shutdown',
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    kiosk: true,
    fullscreen: true,
    fullscreenable: true,
    autoHideMenuBar: true,
    enableLargerThanScreen: true,
    backgroundColor: '#0a0a0a',
    icon: require('path').join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: false,
      autoplayPolicy: 'no-user-gesture-required',
      preload: require('path').join(__dirname, 'preload.js'),
    },
  });
  attachRendererRecovery(loginWindow, 'login');

  Menu.setApplicationMenu(null);

  function enforceLoginKiosk() {
    if (!loginWindow || loginWindow.isDestroyed() || !isLockState()) return;
    try {
      const bounds = screen.getPrimaryDisplay().bounds;
      if (loginWindow.isMinimized()) loginWindow.restore();
      loginWindow.setSkipTaskbar(true);
      loginWindow.setAlwaysOnTop(true, 'screen-saver');
      if (!loginWindow.isKiosk()) loginWindow.setKiosk(true);
      if (!loginWindow.isFullScreen()) loginWindow.setFullScreen(true);
      loginWindow.setBounds(bounds, false);
      loginWindow.moveTop();
    } catch (_) {}
  }

  loginWindow.webContents.on('before-input-event', (event, input) => {
    if (input.alt || input.meta || input.key === 'Meta' || input.key === 'OS') {
      event.preventDefault();
      setImmediate(forceLoginVisible);
    }
    if (input.control && input.shift && input.key === 'I') {
      event.preventDefault();
    }
    if (input.key === 'F12' || input.key === 'F11' || input.key === 'F5') {
      event.preventDefault();
    }
  });

  // Keep the kiosk context menu disabled everywhere except editable fields.
  // Editable fields need the native Paste action because operators may enter
  // long Telegram credentials from the clipboard.
  loginWindow.webContents.on('context-menu', (e, params) => {
    if (!params.isEditable) e.preventDefault();
  });

  // Force the lock screen back into view if anything minimizes or hides it
  // (e.g. Win+D / "Show desktop", Win+M, or a script calling ShowWindow).
  function forceLoginVisible() {
    if (!loginWindow || loginWindow.isDestroyed()) return;
    if (!isLockState()) return;
    try {
      if (loginWindow.isMinimized()) loginWindow.restore();
      if (!loginWindow.isVisible()) loginWindow.show();
      try { app.focus({ steal: true }); } catch (_) {}
      enforceLoginKiosk();
      loginWindow.focus();
    } catch (_) {}
  }
  loginWindow.on('minimize', (e) => { e.preventDefault(); setImmediate(forceLoginVisible); });
  loginWindow.on('hide', () => setImmediate(forceLoginVisible));
  loginWindow.on('restore', () => setImmediate(forceLoginVisible));
  loginWindow.on('leave-full-screen', () => setImmediate(forceLoginVisible));
  loginWindow.on('show', () => setImmediate(enforceLoginKiosk));
  loginWindow.on('focus', () => setImmediate(enforceLoginKiosk));
  loginWindow.webContents.on('focus', () => setImmediate(enforceLoginKiosk));

  const handleDisplayMetricsChanged = () => setImmediate(enforceLoginKiosk);
  screen.on('display-metrics-changed', handleDisplayMetricsChanged);
  loginWindow.once('closed', () => {
    screen.removeListener('display-metrics-changed', handleDisplayMetricsChanged);
  });

  let windowShown = false;
  let readyCalled = false;

  function fireReady() {
    if (readyCalled) return;
    readyCalled = true;
    if (typeof onReady === 'function') onReady();
  }

  function showWindow() {
    if (windowShown || !loginWindow || loginWindow.isDestroyed()) return;
    windowShown = true;
    try { app.focus({ steal: true }); } catch (_) {}
    enforceLoginKiosk();
    loginWindow.show();
    enforceLoginKiosk();
    loginWindow.moveTop();
    loginWindow.focus();
    // Closing a game can make Windows activate another application. Reclaim
    // focus repeatedly during the fullscreen transition, not only once.
    let focusAttempts = 0;
    const focusRecovery = setInterval(() => {
      if (!loginWindow || loginWindow.isDestroyed() || !isLockState() || focusAttempts++ >= 20) {
        clearInterval(focusRecovery);
        return;
      }
      reclaimFocus();
    }, 100);
    console.log('[Electron] Login window shown');
    fireReady();
  }

  const loginUrl = options.waitForLogoutConfirmation
    ? `${APP_URL}/?logoutPending=1`
    : APP_URL;
  loginWindow.loadURL(loginUrl);
  // Cover the desktop immediately during logout instead of waiting for the
  // renderer to finish loading and briefly exposing the Windows taskbar.
  setImmediate(showWindow);

  loginWindow.once('ready-to-show', () => {
    console.log('[Electron] ready-to-show fired');
    showWindow();
  });

  loginWindow.webContents.once('did-finish-load', () => {
    console.log('[Electron] did-finish-load fired');
    showWindow();
    startFocusGuard();
  });

  loginWindow.webContents.on('did-fail-load', (_event, errorCode, errorDesc) => {
    console.log('[Electron] Page failed to load:', errorCode, errorDesc, '- retrying in 1s...');
    setTimeout(() => {
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.loadURL(APP_URL);
      }
    }, 1000);
  });

  setTimeout(() => {
    showWindow();
    startFocusGuard();
  }, 5000);

  function startFocusGuard() {
    if (focusGuardInterval) return;

    loginWindow.on('blur', () => {
      if (isLockState() && loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.moveTop();
        loginWindow.focus();
      }
    });

    focusGuardInterval = setInterval(() => {
      if (isLockState() && loginWindow && !loginWindow.isDestroyed()) {
        // Defensive: re-apply skipTaskbar every tick. Windows clears this
        // flag when explorer.exe restarts (it broadcasts TaskbarCreated and
        // re-enumerates top-level windows), which would otherwise make our
        // kiosk window appear on the taskbar.
        enforceLoginKiosk();
        // Re-show if anything managed to minimize or hide the lock screen.
        if (loginWindow.isMinimized() || !loginWindow.isVisible()) {
          forceLoginVisible();
        } else if (!loginWindow.isFocused()) {
          loginWindow.moveTop();
          loginWindow.focus();
        }
      }
    }, 500);
  }
}

function showSessionWindow(onShown) {
  const { screen } = require('electron');
  const primaryWorkArea = screen.getPrimaryDisplay().workArea;
  currentSessionWidth = SESSION_WIDTH;
  currentSessionHeight = SESSION_HEIGHT;

  const sessionX = primaryWorkArea.x + primaryWorkArea.width - currentSessionWidth - 10;
  const sessionY = primaryWorkArea.y + primaryWorkArea.height - SESSION_HEIGHT - 10;

  sessionWindow = new BrowserWindow({
    width: currentSessionWidth,
    height: SESSION_HEIGHT,
    x: sessionX,
    y: sessionY,
    title: 'Denfi Auto Shutdown Session',
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    closable: false,
    fullscreen: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    transparent: true,
    hasShadow: false,
    show: false,
    focusable: false,
    thickFrame: false,
    useContentSize: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      autoplayPolicy: 'no-user-gesture-required',
      preload: require('path').join(__dirname, 'preload.js'),
    },
  });
  attachRendererRecovery(sessionWindow, 'session');

  // Block the right-click context menu so it cannot be used to hide/close
  // or otherwise tamper with the always-on-top session widget.
  sessionWindow.webContents.on('context-menu', (e) => e.preventDefault());

  // Suppress the native Windows system menu (Restore/Move/Size/Minimize/Close)
  // that pops up when right-clicking a frameless window's drag region. There is
  // no public API to remove WS_SYSMENU, so we intercept WM_INITMENU and cancel
  // the menu by toggling the window's enabled state (well-known Electron trick).
  if (process.platform === 'win32') {
    const WM_INITMENU = 0x0116;
    try {
      sessionWindow.hookWindowMessage(WM_INITMENU, () => {
        if (!sessionWindow || sessionWindow.isDestroyed()) return;
        sessionWindow.setEnabled(false);
        sessionWindow.setEnabled(true);
      });
    } catch (_) {}
  }

  let sessionReady = false;

  let clampMoveTimer = null;
  sessionWindow.on('move', () => {
    if (!sessionReady) return;
    if (clampMoveTimer) clearTimeout(clampMoveTimer);
    clampMoveTimer = setTimeout(() => {
      if (!sessionWindow || sessionWindow.isDestroyed()) return;
      const bounds = sessionWindow.getBounds();
      const workArea = require('electron').screen.getDisplayMatching(bounds).workArea;
      const clampedX = Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - bounds.width));
      const stripY = currentSessionHeight > SESSION_HEIGHT && currentSessionPlacement === 'above'
        ? bounds.y + bounds.height - SESSION_HEIGHT
        : bounds.y;
      const clampedStripY = Math.max(
        workArea.y,
        Math.min(stripY, workArea.y + workArea.height - SESSION_HEIGHT)
      );
      const clampedY = currentSessionHeight > SESSION_HEIGHT && currentSessionPlacement === 'above'
        ? clampedStripY - (bounds.height - SESSION_HEIGHT)
        : clampedStripY;
      if (clampedX !== bounds.x || clampedY !== bounds.y) {
        sessionWindow.setPosition(clampedX, clampedY, false);
      }
    }, 30);
  });

  sessionWindow.webContents.once('did-finish-load', () => {
    if (!sessionWindow || sessionWindow.isDestroyed()) return;
    sessionWindow.setOpacity(0);
    sessionWindow.setBounds({
      width: currentSessionWidth,
      height: SESSION_HEIGHT,
      x: sessionX,
      y: sessionY,
    });
    sessionWindow.setAlwaysOnTop(true, 'screen-saver');
    sessionReady = true;
    sessionWindow.showInactive();
    setTimeout(() => {
      if (!sessionWindow || sessionWindow.isDestroyed()) return;
      sessionWindow.setOpacity(1);
      if (typeof onShown === 'function') onShown();
    }, 50);
  });

  let fullscreenBypassList = [];
  let sessionHiddenForGame = false;
  let bypassRefreshInterval = null;
  let foregroundCheckInterval = null;
  let sessionVisibilityGuardInterval = null;
  let foregroundCheckSequence = 0;
  const managedSessionWindow = sessionWindow;

  function restoreSessionOverlay() {
    if (currentState !== 'logged-in' || sessionWindow !== managedSessionWindow || !managedSessionWindow || managedSessionWindow.isDestroyed() || sessionHiddenForGame) return;
    try {
      managedSessionWindow.setSkipTaskbar(true);
      managedSessionWindow.setAlwaysOnTop(true, 'screen-saver');
      if (!managedSessionWindow.isVisible() || managedSessionWindow.isMinimized()) {
        managedSessionWindow.restore();
        managedSessionWindow.showInactive();
      }
      managedSessionWindow.moveTop();
    } catch (_) {}
  }

  sessionWindow.on('closed', () => {
    if (clampMoveTimer) { clearTimeout(clampMoveTimer); clampMoveTimer = null; }
    if (bypassRefreshInterval) { clearInterval(bypassRefreshInterval); bypassRefreshInterval = null; }
    if (foregroundCheckInterval) { clearInterval(foregroundCheckInterval); foregroundCheckInterval = null; }
    if (sessionVisibilityGuardInterval) { clearInterval(sessionVisibilityGuardInterval); sessionVisibilityGuardInterval = null; }
  });
  sessionWindow.on('hide', () => {
    if (currentState === 'logged-in' && !sessionHiddenForGame) setImmediate(restoreSessionOverlay);
  });
  sessionWindow.on('minimize', () => {
    if (currentState === 'logged-in' && !sessionHiddenForGame) setImmediate(restoreSessionOverlay);
  });

  function refreshBypassList() {
    const http = require('http');
    http.get(`${APP_URL}/api/admin/settings-public`, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.fullscreenBypass) fullscreenBypassList = data.fullscreenBypass;
        } catch (e) {}
      });
    }).on('error', () => {});
  }

  refreshBypassList();
  bypassRefreshInterval = setInterval(refreshBypassList, 10000);

  function checkForegroundAndManage() {
    if (currentState !== 'logged-in' || sessionWindow !== managedSessionWindow || managedSessionWindow.isDestroyed()) return;
    const checkSequence = ++foregroundCheckSequence;
    if (process.platform !== 'win32') {
      restoreSessionOverlay();
      return;
    }
    if (fullscreenBypassList.length === 0) {
      sessionHiddenForGame = false;
      restoreSessionOverlay();
      return;
    }
    exec('powershell -NoProfile -Command "[System.Diagnostics.Process]::GetProcessById((Add-Type -MemberDefinition \'[DllImport(\\\"user32.dll\\\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\\\"user32.dll\\\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);\' -Name W -Namespace W -PassThru)::GetWindowThreadProcessId([W.W]::GetForegroundWindow(), [ref]($p = 0)) | Out-Null; $p).ProcessName"', { timeout: 3000, windowsHide: true }, (err, stdout) => {
      if (currentState !== 'logged-in' || sessionWindow !== managedSessionWindow || managedSessionWindow.isDestroyed()) return;
      if (checkSequence !== foregroundCheckSequence) return;
      if (err) {
        // A failed foreground probe must never leave the session hidden.
        sessionHiddenForGame = false;
        restoreSessionOverlay();
        return;
      }
      const normalizeExeName = (value) => {
        const base = String(value || '').trim().split(/[\\/]/).pop().toLowerCase();
        return base && !base.endsWith('.exe') ? base + '.exe' : base;
      };
      const procName = normalizeExeName(stdout);
      const isFullscreenGame = !!procName && fullscreenBypassList.some(g => {
        const configuredName = normalizeExeName(g);
        return !!configuredName && procName === configuredName;
      });
      if (isFullscreenGame) {
        if (!sessionHiddenForGame) {
          sessionHiddenForGame = true;
          try {
            managedSessionWindow.setAlwaysOnTop(false);
            managedSessionWindow.hide();
            console.log('[Session] Hidden for fullscreen game:', procName);
          } catch (_) {
            sessionHiddenForGame = false;
            restoreSessionOverlay();
          }
        }
      } else {
        const wasHidden = sessionHiddenForGame;
        sessionHiddenForGame = false;
        restoreSessionOverlay();
        if (wasHidden) console.log('[Session] Restored after game exit');
      }
    });
  }

  // Keep ordinary applications from covering the session strip even if
  // Windows clears an always-on-top or taskbar flag after an Explorer change.
  sessionVisibilityGuardInterval = setInterval(() => {
    if (sessionWindow && !sessionWindow.isDestroyed() && !sessionHiddenForGame) {
      restoreSessionOverlay();
    }
  }, 500);
  foregroundCheckInterval = setInterval(checkForegroundAndManage, 1000);

  sessionWindow.loadURL(`${APP_URL}/session.html`);
}

ipcMain.on('session-state', (event, state) => {
  console.log('[Electron] session-state:', state);
  handleStateChange(state);
});

ipcMain.on('session-overlay-size', (event, mode) => {
  if (!sessionWindow || sessionWindow.isDestroyed() || event.sender !== sessionWindow.webContents) return;
  const isObjectRequest = mode && typeof mode === 'object';
  const requestedWidth = isObjectRequest ? Number(mode.width) : NaN;
  const requestedHeight = isObjectRequest ? Number(mode.height) : NaN;
  const expanded = mode === 'expanded';
  const bounds = sessionWindow.getBounds();
  const workArea = require('electron').screen.getDisplayMatching(bounds).workArea;
  const maxWidth = Math.min(SESSION_MAX_WIDTH, workArea.width);
  const desiredWidth = Number.isFinite(requestedWidth) ? requestedWidth : currentSessionWidth;
  const nextWidth = Math.max(SESSION_WIDTH, Math.min(desiredWidth, maxWidth));
  const desiredHeight = expanded
    ? SESSION_EXPANDED_HEIGHT
    : mode === 'collapsed'
      ? SESSION_HEIGHT
      : Number.isFinite(requestedHeight)
        ? Math.ceil(requestedHeight)
        : currentSessionHeight;
  const nextHeight = Math.max(SESSION_HEIGHT, Math.min(desiredHeight, workArea.height));
  const direction = currentSessionPlacement;
  if (currentSessionWidth === nextWidth && currentSessionHeight === nextHeight) {
    sessionWindow.webContents.send('session-overlay-placement', direction);
    return;
  }
  const currentStripY = bounds.height > SESSION_HEIGHT && direction === 'above'
    ? bounds.y + bounds.height - SESSION_HEIGHT
    : bounds.y;
  const clampedStripY = Math.max(
    workArea.y,
    Math.min(currentStripY, workArea.y + workArea.height - SESSION_HEIGHT)
  );
  currentSessionWidth = nextWidth;
  currentSessionHeight = nextHeight;
  const x = Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - nextWidth));
  const y = nextHeight > SESSION_HEIGHT && direction === 'above'
    ? clampedStripY - (nextHeight - SESSION_HEIGHT)
    : clampedStripY;
  // Windows animates transparent BrowserWindow bounds by repeatedly
  // repainting the entire surface; switching drawers then flashes the strip.
  sessionWindow.setBounds({ x, y, width: nextWidth, height: nextHeight }, false);
  sessionWindow.webContents.send('session-overlay-placement', direction);
});

ipcMain.handle('session-overlay-placement', (event) => {
  if (!sessionWindow || sessionWindow.isDestroyed() || event.sender !== sessionWindow.webContents) return 'above';
  const bounds = sessionWindow.getBounds();
  const workArea = require('electron').screen.getDisplayMatching(bounds).workArea;
  const spaceAbove = bounds.y - workArea.y;
  const spaceBelow = workArea.y + workArea.height - (bounds.y + bounds.height);
  currentSessionPlacement = spaceBelow > spaceAbove ? 'below' : 'above';
  return currentSessionPlacement;
});

ipcMain.on('trigger-shutdown', (event) => {
  if (!loginWindow || loginWindow.isDestroyed() || event.sender !== loginWindow.webContents || currentState !== 'logged-out') return;
  if (!idleShutdownDeadline || Date.now() < idleShutdownDeadline) {
    console.log('[Electron] Ignored early renderer shutdown request; main-process deadline is authoritative.');
    return;
  }
  console.log('[Electron] Shutdown triggered from renderer');
  issueSystemShutdown('renderer countdown expired');
});

ipcMain.on('idle-shutdown-config', (event, seconds) => {
  if (!loginWindow || loginWindow.isDestroyed() || event.sender !== loginWindow.webContents || !isLockState()) return;
  setIdleShutdownConfig(seconds);
});

let transitionLock = false;
let transitionLockTimer = null;
let pendingState = null;

function unlockTransition() {
  transitionLock = false;
  if (transitionLockTimer) { clearTimeout(transitionLockTimer); transitionLockTimer = null; }
  if (pendingState) {
    const next = pendingState;
    pendingState = null;
    console.log('[Electron] Processing pending state:', next);
    handleStateChange(next);
  }
}

function handleStateChange(state) {
  if (transitionLock) {
    pendingState = state;
    console.log('[Electron] Transition locked, queued state:', state);
    return;
  }

  if (state === 'logged-in') {
    if (currentState === 'logged-in' && sessionWindow && !sessionWindow.isDestroyed()) return;
    currentState = 'logged-in';
    syncIdleShutdownTimer(true);
    transitionLock = true;
    if (transitionLockTimer) clearTimeout(transitionLockTimer);
    transitionLockTimer = setTimeout(() => { unlockTransition(); }, 5000);
    unregisterKeyBlocks();
    disableKioskLockdown();
    if (focusGuardInterval) {
      clearInterval(focusGuardInterval);
      focusGuardInterval = null;
    }

    if (sessionWindow && !sessionWindow.isDestroyed()) {
      sessionWindow.destroy();
      sessionWindow = null;
    }

    const loginToDestroy = loginWindow;
    loginWindow = null;

    showSessionWindow(() => {
      if (loginToDestroy && !loginToDestroy.isDestroyed()) {
        try { loginToDestroy.setKiosk(false); } catch (e) {}
        try { loginToDestroy.setAlwaysOnTop(false); } catch (e) {}
        try { loginToDestroy.setOpacity(0); } catch (e) {}
        setTimeout(() => {
          if (loginToDestroy && !loginToDestroy.isDestroyed()) {
            try { loginToDestroy.destroy(); } catch (e) {}
          }
        }, 50);
      }
      unlockTransition();
    });
    startPolling();
  } else if (state === 'logged-out') {
    if (currentState === 'logged-out' && loginWindow && !loginWindow.isDestroyed()) return;
    currentState = 'logged-out';
    shutdownIssued = false;
    syncIdleShutdownTimer(true);
    transitionLock = true;
    if (transitionLockTimer) clearTimeout(transitionLockTimer);
    transitionLockTimer = setTimeout(() => { unlockTransition(); }, 5000);
    stopPolling();
    // Block Alt+Tab and other escape paths before terminating any game.
    // This closes the race where Windows activates another app while the
    // configured game is being force-killed.
    enableKioskLockdown();
    closeConfiguredPrograms('login lock screen');

    if (focusGuardInterval) {
      clearInterval(focusGuardInterval);
      focusGuardInterval = null;
    }

    const sessionToDestroy = sessionWindow;
    sessionWindow = null;

    if (loginWindow && !loginWindow.isDestroyed()) {
      loginWindow.destroy();
      loginWindow = null;
    }

    showLoginWindow(() => {
      if (sessionToDestroy && !sessionToDestroy.isDestroyed()) {
        try { sessionToDestroy.setOpacity(0); } catch (e) {}
        setTimeout(() => {
          if (sessionToDestroy && !sessionToDestroy.isDestroyed()) {
            try { sessionToDestroy.destroy(); } catch (e) {}
          }
        }, 100);
      }
      unlockTransition();
    }, { waitForLogoutConfirmation: true });
  }
}

let pollInterval = null;
let pollRequest = null;
let pollGeneration = 0;

function startPolling() {
  stopPolling();
  const http = require('http');
  const generation = ++pollGeneration;

  function scheduleNextPoll() {
    if (generation !== pollGeneration || currentState !== 'logged-in') return;
    pollInterval = setTimeout(runPoll, 1000);
  }

  function runPoll() {
    pollInterval = null;
    if (generation !== pollGeneration || currentState !== 'logged-in') return;
    if (pollRequest) return;

    const request = http.get(`${APP_URL}/api/session/poll`, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (pollRequest !== request) return;
        pollRequest = null;
        if (generation !== pollGeneration || currentState !== 'logged-in') return;
        try {
          const data = JSON.parse(body);
          if (data.event === 'logged-out') {
            console.log('[Electron] Poll detected logout');
            handleStateChange('logged-out');
            return;
          }
        } catch (e) {}
        scheduleNextPoll();
      });
      res.on('aborted', () => {
        if (pollRequest !== request) return;
        pollRequest = null;
        scheduleNextPoll();
      });
    });
    pollRequest = request;
    request.on('error', () => {
      if (pollRequest !== request) return;
      pollRequest = null;
      scheduleNextPoll();
    });
    request.setTimeout(2500, () => {
      try { request.destroy(new Error('Session poll timeout')); } catch (_) {}
    });
  }

  scheduleNextPoll();
}

function stopPolling() {
  pollGeneration++;
  if (pollInterval) {
    clearTimeout(pollInterval);
    pollInterval = null;
  }
  if (pollRequest) {
    const request = pollRequest;
    pollRequest = null;
    try { request.destroy(); } catch (_) {}
  }
}

app.on('window-all-closed', (e) => {
});
