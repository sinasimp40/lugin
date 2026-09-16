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
      if ($$path -and $$path.ToLower() -ne $$self) {
        [LG.W]::ShowWindowAsync($$h, 11) | Out-Null
        [Console]::Out.WriteLine("MINIMIZED " + $$p.ProcessName)
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

function closeConfiguredPrograms(reason) {
  if (process.platform !== 'win32') return;
  const names = settingsStore.getSettings().closeOnLock || [];
  if (!names.length) return;
  console.log(`[Electron] Closing configured programs before ${reason}:`, names.join(', '));
  const aliases = {
    'roblox.exe': ['RobloxPlayerBeta.exe', 'RobloxPlayerLauncher.exe', 'RobloxCrashHandler.exe']
  };
  const processNames = [...new Set(names.flatMap(name => aliases[name.toLowerCase()] || [name]))];
  for (const name of processNames) {
    try {
      execFileSync('taskkill', ['/F', '/T', '/IM', name], { windowsHide: true, stdio: 'ignore' });
    } catch (_) {
      // taskkill returns a failure code when the configured program is not running.
    }
  }
}

// Keep the session overlay compact on top of fullscreen games. The HTML
// renders at its original logical size and scales itself to these bounds.
const SESSION_WIDTH = 331;
const SESSION_HEIGHT = 50;
const SESSION_EXPANDED_HEIGHT = 253;
let currentSessionHeight = SESSION_HEIGHT;

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

app.on('render-process-gone', (_event, _webContents, details) => {
  selfHealRelaunch('render-process-gone', details && details.reason);
});

app.on('child-process-gone', (_event, details) => {
  selfHealRelaunch('child-process-gone', details && details.reason);
});

app.whenReady().then(async () => {
  // Cross-app mutual exclusion MUST be the first awaited step so no startup
  // side effects (server boot, window creation, watchdog spawn, task install)
  // happen if the lock is denied.
  const lockResult = await appLock.acquireLock('auto-shutdown');
  if (!lockResult.acquired) {
    const holder = lockResult.holder && lockResult.holder.role ? lockResult.holder.role : 'another Denfi app';
    const friendly = holder === 'points' ? 'Denfi Points' : holder;
    try {
      const { dialog } = require('electron');
      dialog.showErrorBox(
        'Denfi Auto Shutdown',
        `Cannot start: ${friendly} is already running on this PC.\n\n` +
        `Auto-Shutdown and Denfi Points cannot run at the same time.\n` +
        `Please close ${friendly} first, then try again.`
      );
    } catch (_) {}
    app.exit(1);
    return;
  }

  process.env.PORT = String(PORT);

  const path = require('path');
  const fs = require('fs');
  const settings = require('./src/settings-store');
  const coinLogs = require('./src/coin-log-store');
  const orderStore = require('./src/order-store');

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

  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  } catch (e) {
    console.log('[Electron] Cannot create data dir:', e.message);
  }

  settings.setAppRole('auto-shutdown');
  settings.setDataDir(dataDir);
  coinLogs.setDataDir(dataDir);
  orderStore.setDataDir(dataDir);
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
        http.get(`${APP_URL}/api/admin/status`, (res) => {
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => {
            try {
              const data = JSON.parse(body);
              if (data.registered !== undefined && data.appRole === 'auto-shutdown') {
                resolve();
              } else if (data.registered !== undefined && data.appRole && data.appRole !== 'auto-shutdown') {
                reject(new Error('Port ' + PORT + ' is being used by Denfi Points. Both apps cannot run on the same port.'));
              } else {
                retry();
              }
            } catch (_) {
              retry();
            }
          });
        }).on('error', () => {
          retry();
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
async function bootInitialWindow() {
  let restore = false;
  // The hotspot portal can be briefly unreachable right after a relaunch/boot.
  // Retry a few times so a slow portal does not wrongly drop an active session
  // to the lock screen. A definitive answer (portal reachable) breaks early.
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const status = await fetchSessionStatus();
    if (status && status.success && status.data) {
      const timeLeft = parseInt(status.data.sessionTimeLeft) || 0;
      if (status.data.isLogin && timeLeft > 0) restore = true;
      break; // portal answered definitively — trust it
    }
    if (attempt < maxAttempts) {
      console.log(`[Electron] Session status not ready (attempt ${attempt}/${maxAttempts}), retrying...`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  if (restore) {
    console.log('[Electron] Active session detected on boot — restoring session mode.');
    currentState = 'logged-in';
    if (sessionWindow && !sessionWindow.isDestroyed()) {
      sessionWindow.destroy();
      sessionWindow = null;
    }
    showSessionWindow(() => {});
    startPolling();
  } else {
    console.log('[Electron] No active session on boot — showing lock screen.');
    showLoginWindow();
  }
}

function showLoginWindow(onReady) {
  const { screen } = require('electron');
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;

  currentState = 'logged-out';
  registerKeyBlocks();
  enableKioskLockdown();

  loginWindow = new BrowserWindow({
    x, y, width, height,
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

  Menu.setApplicationMenu(null);

  loginWindow.webContents.on('before-input-event', (event, input) => {
    if (input.alt || input.meta || input.key === 'Meta' || input.key === 'OS') {
      event.preventDefault();
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
    if (currentState !== 'logged-out') return;
    try {
      if (loginWindow.isMinimized()) loginWindow.restore();
      if (!loginWindow.isVisible()) loginWindow.show();
      loginWindow.setKiosk(true);
      loginWindow.setAlwaysOnTop(true, 'screen-saver');
      loginWindow.moveTop();
      loginWindow.focus();
    } catch (_) {}
  }
  loginWindow.on('minimize', (e) => { e.preventDefault(); setImmediate(forceLoginVisible); });
  loginWindow.on('hide', () => setImmediate(forceLoginVisible));
  loginWindow.on('restore', () => setImmediate(forceLoginVisible));

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
    loginWindow.setBounds({ x, y, width, height });
    loginWindow.setKiosk(true);
    loginWindow.setAlwaysOnTop(true, 'screen-saver');
    loginWindow.show();
    loginWindow.moveTop();
    loginWindow.focus();
    console.log('[Electron] Login window shown');
    fireReady();
  }

  loginWindow.loadURL(APP_URL);

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
      if (currentState === 'logged-out' && loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.moveTop();
        loginWindow.focus();
      }
    });

    focusGuardInterval = setInterval(() => {
      if (currentState === 'logged-out' && loginWindow && !loginWindow.isDestroyed()) {
        // Defensive: re-apply skipTaskbar every tick. Windows clears this
        // flag when explorer.exe restarts (it broadcasts TaskbarCreated and
        // re-enumerates top-level windows), which would otherwise make our
        // kiosk window appear on the taskbar.
        try { loginWindow.setSkipTaskbar(true); } catch (_) {}
        // Re-show if anything managed to minimize or hide the lock screen.
        if (loginWindow.isMinimized() || !loginWindow.isVisible()) {
          forceLoginVisible();
        } else if (!loginWindow.isFocused()) {
          loginWindow.moveTop();
          loginWindow.focus();
        }
      }
    }, 2000);
  }
}

function showSessionWindow(onShown) {
  const { screen } = require('electron');
  const primaryWorkArea = screen.getPrimaryDisplay().workArea;
  currentSessionHeight = SESSION_HEIGHT;

  const sessionX = primaryWorkArea.x + primaryWorkArea.width - SESSION_WIDTH - 10;
  const sessionY = primaryWorkArea.y + primaryWorkArea.height - SESSION_HEIGHT - 10;

  sessionWindow = new BrowserWindow({
    width: SESSION_WIDTH,
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

  sessionWindow.on('will-move', (event, newBounds) => {
    if (!sessionReady) return;
    event.preventDefault();
    const workArea = require('electron').screen.getDisplayMatching(newBounds).workArea;
    const clampedX = Math.max(workArea.x, Math.min(newBounds.x, workArea.x + workArea.width - SESSION_WIDTH));
    const clampedY = Math.max(workArea.y, Math.min(newBounds.y, workArea.y + workArea.height - currentSessionHeight));
    sessionWindow.setBounds({ x: clampedX, y: clampedY, width: SESSION_WIDTH, height: currentSessionHeight });
  });

  sessionWindow.webContents.once('did-finish-load', () => {
    if (!sessionWindow || sessionWindow.isDestroyed()) return;
    sessionWindow.setOpacity(0);
    sessionWindow.setBounds({
      width: SESSION_WIDTH,
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

  sessionWindow.on('closed', () => {
    if (bypassRefreshInterval) { clearInterval(bypassRefreshInterval); bypassRefreshInterval = null; }
    if (foregroundCheckInterval) { clearInterval(foregroundCheckInterval); foregroundCheckInterval = null; }
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
    if (!sessionWindow || sessionWindow.isDestroyed()) return;
    // Defensive: re-apply skipTaskbar every tick. If explorer.exe crashes and
    // restarts, Windows broadcasts TaskbarCreated and re-enumerates top-level
    // windows, which would otherwise make the session overlay appear on the
    // taskbar. Re-applying here restores the hidden state within ~2s.
    try { sessionWindow.setSkipTaskbar(true); } catch (_) {}
    if (process.platform !== 'win32') {
      sessionWindow.setAlwaysOnTop(true, 'screen-saver');
      return;
    }
    if (fullscreenBypassList.length === 0) {
      if (sessionHiddenForGame) {
        sessionHiddenForGame = false;
        sessionWindow.showInactive();
      }
      sessionWindow.setAlwaysOnTop(true, 'screen-saver');
      if (!sessionWindow.isVisible()) {
        sessionWindow.showInactive();
      }
      sessionWindow.moveTop();
      return;
    }
    exec('powershell -NoProfile -Command "[System.Diagnostics.Process]::GetProcessById((Add-Type -MemberDefinition \'[DllImport(\\\"user32.dll\\\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\\\"user32.dll\\\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);\' -Name W -Namespace W -PassThru)::GetWindowThreadProcessId([W.W]::GetForegroundWindow(), [ref]($p = 0)) | Out-Null; $p).ProcessName"', { timeout: 3000, windowsHide: true }, (err, stdout) => {
      if (!sessionWindow || sessionWindow.isDestroyed()) return;
      if (err) {
        if (sessionHiddenForGame) {
          sessionHiddenForGame = false;
          sessionWindow.showInactive();
          sessionWindow.setAlwaysOnTop(true, 'screen-saver');
        }
        return;
      }
      const procName = (stdout || '').trim().toLowerCase() + '.exe';
      const isFullscreenGame = fullscreenBypassList.some(g => procName.includes(g));
      if (isFullscreenGame) {
        if (!sessionHiddenForGame) {
          sessionHiddenForGame = true;
          sessionWindow.setAlwaysOnTop(false);
          sessionWindow.hide();
          console.log('[Session] Hidden for fullscreen game:', procName);
        }
      } else {
        if (sessionHiddenForGame) {
          sessionHiddenForGame = false;
          sessionWindow.showInactive();
          console.log('[Session] Restored after game exit');
        }
        sessionWindow.setAlwaysOnTop(true, 'screen-saver');
        if (!sessionWindow.isVisible()) {
          sessionWindow.showInactive();
        }
        sessionWindow.moveTop();
      }
    });
  }

  foregroundCheckInterval = setInterval(checkForegroundAndManage, 2000);

  sessionWindow.loadURL(`${APP_URL}/session.html`);
}

ipcMain.on('session-state', (event, state) => {
  console.log('[Electron] session-state:', state);
  handleStateChange(state);
});

ipcMain.on('session-overlay-size', (event, mode) => {
  if (!sessionWindow || sessionWindow.isDestroyed() || event.sender !== sessionWindow.webContents) return;
  const expanded = mode === 'expanded';
  const nextHeight = expanded ? SESSION_EXPANDED_HEIGHT : SESSION_HEIGHT;
  if (currentSessionHeight === nextHeight) return;
  const bounds = sessionWindow.getBounds();
  const workArea = require('electron').screen.getDisplayMatching(bounds).workArea;
  currentSessionHeight = nextHeight;
  const x = Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - SESSION_WIDTH));
  const y = Math.max(workArea.y, Math.min(bounds.y + bounds.height - nextHeight, workArea.y + workArea.height - nextHeight));
  sessionWindow.setBounds({ x, y, width: SESSION_WIDTH, height: nextHeight }, true);
});

ipcMain.on('trigger-shutdown', () => {
  console.log('[Electron] Shutdown triggered from renderer');
  closeConfiguredPrograms('shutdown');
  const { exec } = require('child_process');
  exec('shutdown /s /t 0 /f', (err) => {
    if (err) {
      console.log('[Electron] Shutdown command failed (non-Windows?):', err.message);
      exec('shutdown -h now', (err2) => {
        if (err2) console.log('[Electron] Linux shutdown also failed:', err2.message);
      });
    }
  });
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
    closeConfiguredPrograms('login lock screen');
    transitionLock = true;
    if (transitionLockTimer) clearTimeout(transitionLockTimer);
    transitionLockTimer = setTimeout(() => { unlockTransition(); }, 5000);
    stopPolling();
    enableKioskLockdown();

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
    });
  }
}

let pollInterval = null;

function startPolling() {
  stopPolling();
  const http = require('http');
  pollInterval = setInterval(() => {
    http.get(`${APP_URL}/api/session/poll`, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.event === 'logged-out') {
            console.log('[Electron] Poll detected logout');
            handleStateChange('logged-out');
          }
        } catch (e) {}
      });
    }).on('error', () => {});
  }, 1000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

app.on('window-all-closed', (e) => {
});
