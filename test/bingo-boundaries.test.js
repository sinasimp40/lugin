const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registerBingoRoutes } = require('../src/bingo-routes');

test('Bingo central writes reject browser requests and still require trusted-network authorization', () => {
  const routes = new Map();
  const app = {
    get(url, ...handlers) { routes.set('GET ' + url, handlers); },
    post(url, ...handlers) { routes.set('POST ' + url, handlers); },
  };
  registerBingoRoutes(app, {
    appRole: 'points', coinLogs: {}, settings: { getSettings: () => ({}) },
    verifyToken: (_req, res) => res.status(401).json({ success: false }),
    authorizeKioskMission: (req, res, next) => req.headers.trusted === 'yes' ? next() : res.status(403).json({ success: false }),
    broadcast() {},
  });
  function request(url, headers) {
    const handlers = routes.get('POST ' + url);
    let status = 200, data;
    const res = { status(value) { status = value; return this; }, json(value) { data = value; return this; } };
    let i = 0;
    const next = () => handlers[i++]?.({ headers, body: {}, query: {} }, res, next);
    next();
    return { status, data };
  }
  for (const route of ['/api/sync/bingo/join', '/api/admin/kiosk-bingo', '/api/admin/kiosk-bingo/cancel']) {
    assert.equal(request(route, { 'x-denfi-kiosk-server': 'auto-shutdown' }).status, 403);
    for (const extra of [{}, { origin: 'http://player' }, { referer: 'http://player' }, { 'sec-fetch-site': 'same-origin' }]) {
      const headers = { trusted: 'yes', ...extra };
      if (Object.keys(extra).length) headers['x-denfi-kiosk-server'] = 'auto-shutdown';
      const blocked = request(route, headers);
      assert.equal(blocked.status, 403);
      assert.match(blocked.data.error, /trusted Auto Shutdown server/);
    }
  }
});

test('both Windows builds bundle Bingo, voice, ledger and native session integration', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  for (const config of [JSON.parse(read('package.json')).build, JSON.parse(read('electron-builder-points.json'))]) {
    assert.ok(config.files.includes('public/**/*'));
    assert.ok(config.files.includes('src/**/*'));
  }
  assert.match(read('server.js'), /registerBingoRoutes/);
  assert.match(read('preload.js'), /setBingoSessionLocked/);
  const main = read('main.js');
  assert.match(main, /event\.senderFrame !== sessionWindow\.webContents\.mainFrame/);
  assert.match(main, /foregroundProbe\.query/);
  assert.doesNotMatch(main.slice(main.indexOf('function checkForegroundAndManage()'), main.indexOf('foregroundCheckInterval = setInterval')),
    /exec\('powershell/);
});
