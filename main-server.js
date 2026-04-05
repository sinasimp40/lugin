const { app, Tray, Menu, nativeImage, BrowserWindow } = require('electron');
const path = require('path');

let tray = null;
let serverModule = null;

app.on('ready', () => {
  process.env.DENFI_LISTEN_HOST = '0.0.0.0';

  const exeDir = path.dirname(app.getPath('exe'));
  const dataDir = path.join(exeDir, 'data');
  process.env.DENFI_DATA_DIR = dataDir;

  const fs = require('fs');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  serverModule = require('./server');

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
    contextMenu.items[3].click();
  });

  console.log('[Denfi Points] Server running on 0.0.0.0:5000');
  console.log('[Denfi Points] Data directory:', dataDir);
  console.log('[Denfi Points] Right-click tray icon for options');
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});
