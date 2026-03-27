const { app, BrowserWindow, Menu, ipcMain, globalShortcut } = require('electron');

const PORT = 5000;
const APP_URL = `http://127.0.0.1:${PORT}`;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

process.on('uncaughtException', (err) => {
  console.error('[Electron] Uncaught exception:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[Electron] Unhandled rejection:', err?.message || err);
});

let loginWindow;
let sessionWindow;
let isQuitting = false;
let currentState = 'logged-out';
let focusGuardInterval = null;

const SESSION_WIDTH = 260;
const SESSION_HEIGHT = 80;

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
    loginWindow.setKiosk(true);
    loginWindow.setAlwaysOnTop(true, 'screen-saver');
    loginWindow.moveTop();
    loginWindow.focus();
  }
}

function registerKeyBlocks() {
  const shortcuts = [
    'Alt+Tab', 'Alt+F4', 'Alt+Escape', 'Alt+Space',
    'Super', 'Super+D', 'Super+E', 'Super+R', 'Super+L',
    'Super+Tab', 'Super+X', 'Super+I', 'Super+S', 'Super+A',
    'Ctrl+Shift+Escape',
    'Ctrl+Escape',
    'F11',
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
  const userDataDir = path.join(app.getPath('userData'), 'pisonet-data');
  settings.setDataDir(userDataDir);
  console.log('[Electron] Data dir:', userDataDir);

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
    dialog.showErrorBox('Pisonet App Error', 'Server failed to start:\n' + err.message);
    app.quit();
    return;
  }

  waitForServer(40).then(() => {
    showLoginWindow();
  }).catch((err) => {
    console.error('[Electron] Server startup failed:', err.message);
    const { dialog } = require('electron');
    dialog.showErrorBox('Pisonet App Error', 'Server did not respond.\nPort 5000 may be in use by another program.\n\nClose any other Pisonet instances and try again.');
    app.quit();
  });
});

function showLoginWindow() {
  const { screen } = require('electron');
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;

  currentState = 'logged-out';
  registerKeyBlocks();

  loginWindow = new BrowserWindow({
    x, y, width, height,
    title: 'Pisonet App',
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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: require('path').join(__dirname, 'preload.js'),
    },
  });

  Menu.setApplicationMenu(null);

  function showWindow() {
    if (loginWindow && !loginWindow.isDestroyed() && !loginWindow.isVisible()) {
      loginWindow.setBounds({ x, y, width, height });
      loginWindow.setKiosk(true);
      loginWindow.setAlwaysOnTop(true, 'screen-saver');
      loginWindow.show();
      loginWindow.moveTop();
      loginWindow.focus();
    }
  }

  loginWindow.loadURL(APP_URL);

  loginWindow.once('ready-to-show', showWindow);

  loginWindow.webContents.on('did-fail-load', () => {
    console.log('[Electron] Page failed to load, retrying in 1s...');
    setTimeout(() => {
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.loadURL(APP_URL);
      }
    }, 1000);
  });

  setTimeout(showWindow, 5000);

  loginWindow.on('blur', () => {
    if (currentState === 'logged-out' && loginWindow && !loginWindow.isDestroyed()) {
      setTimeout(() => {
        if (currentState === 'logged-out' && loginWindow && !loginWindow.isDestroyed()) {
          loginWindow.setKiosk(true);
          loginWindow.setAlwaysOnTop(true, 'screen-saver');
          loginWindow.moveTop();
          loginWindow.focus();
        }
      }, 100);
    }
  });

  focusGuardInterval = setInterval(() => {
    if (currentState === 'logged-out' && loginWindow && !loginWindow.isDestroyed()) {
      if (!loginWindow.isFocused()) {
        loginWindow.setKiosk(true);
        loginWindow.setAlwaysOnTop(true, 'screen-saver');
        loginWindow.moveTop();
        loginWindow.focus();
      }
    }
  }, 500);
}

function showSessionWindow() {
  const { screen } = require('electron');
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  sessionWindow = new BrowserWindow({
    width: SESSION_WIDTH,
    height: SESSION_HEIGHT,
    x: sw - SESSION_WIDTH - 10,
    y: sh - SESSION_HEIGHT - 10,
    title: 'Pisonet Session',
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    closable: false,
    fullscreen: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: require('path').join(__dirname, 'preload.js'),
    },
  });

  sessionWindow.once('ready-to-show', () => {
    sessionWindow.setFullScreen(false);
    sessionWindow.setBounds({
      width: SESSION_WIDTH,
      height: SESSION_HEIGHT,
      x: sw - SESSION_WIDTH - 10,
      y: sh - SESSION_HEIGHT - 10,
    });
    sessionWindow.show();
  });

  sessionWindow.loadURL(`${APP_URL}/session.html`);
}

ipcMain.on('session-state', (event, state) => {
  console.log('[Electron] session-state:', state);
  handleStateChange(state);
});

ipcMain.on('trigger-shutdown', () => {
  console.log('[Electron] Shutdown triggered from renderer');
  const { exec } = require('child_process');
  exec('shutdown /s /t 10 /f', (err) => {
    if (err) {
      console.log('[Electron] Shutdown command failed (non-Windows?):', err.message);
      exec('shutdown -h now', (err2) => {
        if (err2) console.log('[Electron] Linux shutdown also failed:', err2.message);
      });
    }
  });
});

function handleStateChange(state) {
  if (state === 'logged-in') {
    currentState = 'logged-in';
    unregisterKeyBlocks();
    if (focusGuardInterval) {
      clearInterval(focusGuardInterval);
      focusGuardInterval = null;
    }

    if (sessionWindow && !sessionWindow.isDestroyed()) return;
    showSessionWindow();
    setTimeout(() => {
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.destroy();
        loginWindow = null;
      }
    }, 500);
    startPolling();
  } else if (state === 'logged-out') {
    currentState = 'logged-out';
    stopPolling();
    if (loginWindow && !loginWindow.isDestroyed()) return;
    showLoginWindow();
    setTimeout(() => {
      if (sessionWindow && !sessionWindow.isDestroyed()) {
        sessionWindow.destroy();
        sessionWindow = null;
      }
    }, 500);
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
