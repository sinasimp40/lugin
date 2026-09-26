const { app, Tray, Menu, nativeImage, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const appLock = require('./src/app-lock');

process.env.DENFI_APP_ROLE = 'points';
app.setName('Denfi Points');
const pointsUserData = path.join(app.getPath('appData'), 'denfi-points');
fs.mkdirSync(pointsUserData, { recursive: true });
app.setPath('userData', pointsUserData);

let tray = null;
let serverModule = null;

const gotPointsLock = app.requestSingleInstanceLock();
if (!gotPointsLock) {
  app.exit(0);
}

app.on('ready', async () => {
  const exeDir = path.dirname(app.getPath('exe'));
  const dataDir = path.join(exeDir, 'data');
  // Only another Denfi Points instance on this PC blocks startup.
  const lockResult = await appLock.acquireLock('points', dataDir);
  if (!lockResult.acquired) {
    try {
      const { dialog } = require('electron');
      dialog.showErrorBox(
        'Denfi Points',
        'Cannot start: Denfi Points is already running on this PC, or its local lock is in use.'
      );
    } catch (_) {}
    app.exit(1);
    return;
  }

  const kioskHolder = await appLock.queryHolder('auto-shutdown');
  if (appLock.sameDataDir(dataDir, kioskHolder?.dataDir)) {
    const { dialog } = require('electron');
    dialog.showErrorBox('Denfi Points',
      'Denfi Points and Auto Shutdown can run on the same PC, but cannot share one data folder. Install them in separate folders before starting both.');
    app.quit();
    return;
  }
  process.env.PORT = '5000';
  process.env.DENFI_LISTEN_HOST = '0.0.0.0';

  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  } catch (e) {
    console.error('[Denfi Points] Cannot create data dir:', e.message);
  }

  const settings = require('./src/settings-store');
  const coinLogs = require('./src/coin-log-store');
  const orderStore = require('./src/order-store');
  const attendance = require('./src/attendance-store');
  settings.setAppRole('points');
  settings.setDataDir(dataDir);
  coinLogs.setDataDir(dataDir);
  orderStore.setDataDir(dataDir);
  attendance.setDataDir(dataDir);

  try {
    const db = require('./src/points-database').initialize(dataDir);
    coinLogs.useSqlite(db);
    attendance.useSqlite(db);
    serverModule = require('./server');
  } catch (err) {
    console.error('[Denfi Points] Failed to start server:', err);
    const { dialog } = require('electron');
    dialog.showErrorBox('Denfi Points', 'Server failed to start:\n' + err.message);
    app.quit();
    return;
  }

  let iconPath = path.join(__dirname, 'public', 'icon.png');
  if (!fs.existsSync(iconPath)) iconPath = path.join(__dirname, 'icon.png');

  let trayIcon;
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } else {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Denfi Points Server — Running on port 5000');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Denfi Points Server', enabled: false },
    { label: 'Port: 5000 (0.0.0.0)', enabled: false },
    { label: 'Data: ' + dataDir, enabled: false },
    { type: 'separator' },
    {
      label: 'Open Coin Logs Panel',
      click: () => {
        const win = new BrowserWindow({
          width: 900,
          height: 700,
          title: 'Denfi Points — Coin Logs',
          icon: fs.existsSync(iconPath) ? iconPath : undefined,
          webPreferences: { nodeIntegration: false, contextIsolation: true }
        });
        win.setMenuBarVisibility(false);
        win.loadURL('http://127.0.0.1:5000');
        win.webContents.on('did-finish-load', () => {
          win.webContents.executeJavaScript(`
            setTimeout(() => {
              const evt = new KeyboardEvent('keydown', { key: 'c', code: 'KeyC' });
              document.dispatchEvent(evt);
            }, 1000);
          `);
        });
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    contextMenu.items[4].click();
  });

  console.log('[Denfi Points] Server running on 0.0.0.0:5000');
  console.log('[Denfi Points] Data directory:', dataDir);
  console.log('[Denfi Points] Right-click tray icon for options');
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('before-quit', () => {
  try { appLock.releaseLock(); } catch (_) {}
});
