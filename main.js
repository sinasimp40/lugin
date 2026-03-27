const { app, BrowserWindow, Menu, ipcMain } = require('electron');

const PORT = 5000;
const APP_URL = `http://127.0.0.1:${PORT}`;

process.on('uncaughtException', (err) => {
  console.error('[Electron] Uncaught exception:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[Electron] Unhandled rejection:', err?.message || err);
});

let loginWindow;
let sessionWindow;
let isQuitting = false;

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

app.on('before-quit', (event) => {
  if (!isQuitting) {
    isQuitting = true;
    event.preventDefault();
    console.log('[Electron] App closing, performing logout...');
    performLogout().finally(() => {
      console.log('[Electron] Logout done, quitting.');
      app.exit(0);
    });
  }
});

app.whenReady().then(() => {
  process.env.PORT = String(PORT);
  require('./server');
  showLoginWindow();
});

function showLoginWindow() {
  const { screen } = require('electron');
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;

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
    skipTaskbar: false,
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: require('path').join(__dirname, 'preload.js'),
    },
  });

  Menu.setApplicationMenu(null);
  loginWindow.loadURL(APP_URL);

  loginWindow.once('ready-to-show', () => {
    loginWindow.show();
    loginWindow.setBounds({ x, y, width, height });
    loginWindow.setAlwaysOnTop(true, 'screen-saver');
    loginWindow.moveTop();
    loginWindow.focus();
  });

  loginWindow.on('blur', () => {
    if (loginWindow && !loginWindow.isDestroyed()) {
      loginWindow.setAlwaysOnTop(true, 'screen-saver');
      loginWindow.moveTop();
      loginWindow.focus();
    }
  });
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
    skipTaskbar: false,
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

function handleStateChange(state) {
  if (state === 'logged-in') {
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
