const { app, BrowserWindow, Menu, ipcMain, globalShortcut } = require('electron');
const { exec, spawn } = require('child_process');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const PORT = 5000;
const APP_URL = `http://127.0.0.1:${PORT}`;

let kioskHookProcess = null;

function enableKioskLockdown() {
  if (process.platform !== 'win32') return;
  console.log('[Kiosk] Enabling lockdown...');

  startKeyboardHook();
}

function disableKioskLockdown() {
  if (process.platform !== 'win32') return;
  console.log('[Kiosk] Disabling lockdown...');

  stopKeyboardHook();
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
            if (vkCode == 162 || vkCode == 163) return (IntPtr)1;
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
});

process.on('admin-stop-app', () => {
  console.log('[Electron] Admin stop-app received, cleaning up...');
  try { stopKeyboardHook(); } catch (e) {}
  try { cleanupHookScript(); } catch (e) {}
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

const SESSION_WIDTH = 210;
const SESSION_HEIGHT = 50;

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

app.whenReady().then(() => {
  process.env.PORT = String(PORT);

  const path = require('path');
  const settings = require('./src/settings-store');
  const portableDataDir = path.join(path.dirname(app.getPath('exe')), 'data');
  settings.setDataDir(portableDataDir);
  console.log('[Electron] Data dir (portable):', portableDataDir);

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
              if (data.registered !== undefined) {
                resolve();
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

  try {
    require('./server');
  } catch (err) {
    console.error('[Electron] Failed to start server:', err);
    const { dialog } = require('electron');
    dialog.showErrorBox('Denfi Auto Shutdown', 'Server failed to start:\n' + err.message);
    app.quit();
    return;
  }

  waitForServer(40).then(() => {
    showLoginWindow();
  }).catch((err) => {
    console.error('[Electron] Server startup failed:', err.message);
    const { dialog } = require('electron');
    dialog.showErrorBox('Denfi Auto Shutdown', 'Server did not respond.\nPort 5000 may be in use by another program.\n\nClose any other instances and try again.');
    app.quit();
  });
});

function showLoginWindow() {
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

  loginWindow.webContents.on('context-menu', (e) => e.preventDefault());

  let windowShown = false;

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
        if (!loginWindow.isFocused()) {
          loginWindow.moveTop();
          loginWindow.focus();
        }
      }
    }, 2000);
  }
}

function showSessionWindow(onShown) {
  const { screen } = require('electron');
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  const sessionX = sw - SESSION_WIDTH - 10;
  const sessionY = sh - SESSION_HEIGHT - 10;

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

  let sessionReady = false;

  sessionWindow.on('will-move', (event, newBounds) => {
    if (!sessionReady) return;
    event.preventDefault();
    const { width: dw, height: dh } = require('electron').screen.getPrimaryDisplay().workAreaSize;
    const clampedX = Math.max(0, Math.min(newBounds.x, dw - SESSION_WIDTH));
    const clampedY = Math.max(0, Math.min(newBounds.y, dh - SESSION_HEIGHT));
    sessionWindow.setBounds({ x: clampedX, y: clampedY, width: SESSION_WIDTH, height: SESSION_HEIGHT });
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
    }, 150);
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

ipcMain.on('trigger-shutdown', () => {
  console.log('[Electron] Shutdown triggered from renderer');
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

let transitionTimer = null;

function handleStateChange(state) {
  if (transitionTimer) { clearTimeout(transitionTimer); transitionTimer = null; }

  if (state === 'logged-in') {
    if (currentState === 'logged-in' && sessionWindow && !sessionWindow.isDestroyed()) return;
    currentState = 'logged-in';
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
      if (currentState !== 'logged-in') return;
      if (loginToDestroy && !loginToDestroy.isDestroyed()) {
        try { loginToDestroy.setKiosk(false); } catch (e) {}
        try { loginToDestroy.setAlwaysOnTop(false); } catch (e) {}
        try { loginToDestroy.setOpacity(0); } catch (e) {}
        setTimeout(() => {
          if (loginToDestroy && !loginToDestroy.isDestroyed()) {
            loginToDestroy.destroy();
          }
        }, 100);
      }
    });
    startPolling();
  } else if (state === 'logged-out') {
    if (currentState === 'logged-out' && loginWindow && !loginWindow.isDestroyed()) return;
    currentState = 'logged-out';
    stopPolling();
    enableKioskLockdown();

    if (sessionWindow && !sessionWindow.isDestroyed()) {
      try { sessionWindow.setOpacity(0); } catch (e) {}
    }

    if (focusGuardInterval) {
      clearInterval(focusGuardInterval);
      focusGuardInterval = null;
    }

    if (loginWindow && !loginWindow.isDestroyed()) {
      loginWindow.destroy();
      loginWindow = null;
    }
    showLoginWindow();

    transitionTimer = setTimeout(() => {
      transitionTimer = null;
      if (currentState === 'logged-out' && sessionWindow && !sessionWindow.isDestroyed()) {
        sessionWindow.destroy();
        sessionWindow = null;
      }
    }, 300);
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
