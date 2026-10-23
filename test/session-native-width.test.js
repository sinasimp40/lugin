const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

test('native resizing checks actual bounds, not an already-cached requested width', () => {
  const start = main.indexOf("ipcMain.on('session-overlay-size'");
  const end = main.indexOf("ipcMain.handle('session-overlay-placement'", start);
  let handler;
  let bounds = { x:1559, y:1000, width:331, height:70 };
  const changes = [];
  const webContents = { send() {} };
  const sessionWindow = {
    webContents, isDestroyed:() => false,
    getBounds:() => ({ ...bounds }),
    setBounds(value) { changes.push(value); bounds = { ...value }; }
  };
  const run = new Function('ipcMain', 'sessionWindow', 'require', `
    const SESSION_WIDTH=331, SESSION_HEIGHT=70, SESSION_MAX_WIDTH=900, SESSION_EXPANDED_HEIGHT=600;
    let currentSessionWidth=500, currentSessionHeight=70, currentSessionPlacement='above';
    ${main.slice(start, end)}
  `);
  run({ on:(name, fn) => { handler = fn; } }, sessionWindow, () => ({
    screen:{ getDisplayMatching:() => ({ workArea:{ x:0, y:0, width:1920, height:1080 } }) }
  }));
  handler({ sender:webContents }, { width:500 });
  assert.equal(bounds.width, 500, 'cached request must not suppress actual growth');
  assert.equal(bounds.x, 1420, 'growth stays on screen');
  handler({ sender:webContents }, { width:500 });
  assert.equal(changes.length, 1, 'identical applied bounds do not repaint');
  handler({ sender:{} }, { width:600 });
  assert.equal(bounds.width, 500, 'other renderers cannot resize the overlay');
  handler({ sender:webContents }, { width:4000 });
  assert.equal(bounds.width, 900, 'native limit remains enforced');
});
