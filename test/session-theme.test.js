const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerSessionTheme } = require('../src/session-theme');

async function fixture(t, role, extra = {}) {
  let state = {}, notices = 0;
  const app = express(); app.use(express.json());
  const settings = {
    getSettings: () => ({ ...state }),
    updateSettings: updates => { state = { ...state, ...updates }; },
  };
  const service = registerSessionTheme(app, {
    settings, appRole: role,
    verifyToken: (req, res, next) => req.headers['x-admin-token'] === 'test-admin' ?
      next() : res.status(401).json({ success: false }),
    authorizeKioskMission: (req, res, next) => req.headers['x-untrusted'] ?
      res.status(403).json({ success: false }) : next(),
    getPointsUrl: () => '', broadcastSettings: () => ++notices, pollMs: 100000,
    ...extra,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  t.after(() => { service.close(); server.closeAllConnections(); server.close(); });
  const url = 'http://127.0.0.1:' + server.address().port;
  async function request(route, body, headers = {}) {
    const response = await fetch(url + route, { headers: {
      'Content-Type': 'application/json', 'x-admin-token': 'test-admin', ...headers,
    }, ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    return { status: response.status, ...await response.json() };
  }
  return { url, request, service, settings, notices: () => notices };
}

test('one authenticated kiosk publishes centrally; another polls, switches back, and keeps last theme offline', async t => {
  const points = await fixture(t, 'points');
  let online = true;
  const a = await fixture(t, 'auto-shutdown', { getPointsUrl: () => points.url });
  const b = await fixture(t, 'auto-shutdown', {
    getPointsUrl: () => online ? points.url : '',
  });
  const initial = await a.request('/api/admin/session-theme');
  assert.equal(initial.policy.theme, 'default');
  const saved = await a.request('/api/admin/session-theme', {
    theme: 'halloween', expectedRevision: initial.policy.revision,
  });
  assert.equal(saved.status, 200); assert.equal(saved.policy.theme, 'halloween');
  assert.equal(points.settings.getSettings().sessionTheme, 'halloween');
  await b.service.poll();
  assert.equal((await b.request('/api/session-theme')).policy.theme, 'halloween');
  assert.equal(b.notices(), 1);
  await b.service.poll(); assert.equal(b.notices(), 1, 'unchanged polls do not rewrite/broadcast');
  online = false;
  const off = await b.request('/api/admin/session-theme', { theme: 'default', expectedRevision: saved.policy.revision });
  assert.equal(off.status, 503);
  assert.equal((await b.request('/api/session-theme')).policy.theme, 'halloween');
  const reverted = await a.request('/api/admin/session-theme', { theme: 'default', expectedRevision: saved.policy.revision });
  assert.equal(reverted.policy.theme, 'default');
  online = true; await b.service.poll();
  assert.equal((await b.request('/api/session-theme')).policy.theme, 'default');
  const stale = await a.request('/api/admin/session-theme', { theme: 'halloween', expectedRevision: saved.policy.revision });
  assert.equal(stale.status, 409);
  assert.equal(points.settings.getSettings().sessionTheme, 'default');
});

test('renderer checks read through Points without an admin reload and retain the last theme offline', async t => {
  const points = await fixture(t, 'points');
  let online = true;
  const kiosk = await fixture(t, 'auto-shutdown', {
    getPointsUrl: () => online ? points.url : '',
  });
  await kiosk.service.poll();
  const saved = await points.request('/api/admin/session-theme', {
    theme: 'halloween', expectedRevision: 'initial',
  });
  const live = await kiosk.request('/api/session-theme');
  assert.equal(live.policy.theme, 'halloween');
  assert.equal(live.connected, true);
  assert.equal(kiosk.notices(), 1);
  online = false;
  const offline = await kiosk.request('/api/session-theme');
  assert.equal(offline.policy.theme, 'halloween');
  assert.equal(offline.connected, false);
  await points.request('/api/admin/session-theme', {
    theme: 'default', expectedRevision: saved.policy.revision,
  });
  online = true;
  const restored = await kiosk.request('/api/session-theme');
  assert.equal(restored.policy.theme, 'default');
  assert.equal(restored.connected, true);
});

test('online PCs follow the timer without any renderer or admin request', async t => {
  const points = await fixture(t, 'points');
  const kiosk = await fixture(t, 'auto-shutdown', {
    getPointsUrl: () => points.url, pollMs: 15,
  });
  await kiosk.service.poll();
  await points.request('/api/admin/session-theme', {
    theme: 'halloween', expectedRevision: 'initial',
  });
  const deadline = Date.now() + 1500;
  while (kiosk.settings.getSettings().sessionTheme !== 'halloween' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  assert.equal(kiosk.settings.getSettings().sessionTheme, 'halloween');
  assert.equal(kiosk.notices(), 1);
});

test('authentication, strict choices, browser publication blocking and old Points builds', async t => {
  const p = await fixture(t, 'points');
  assert.equal((await p.request('/api/admin/session-theme', undefined, { 'x-admin-token': '' })).status, 401);
  assert.equal((await p.request('/api/admin/session-theme', { theme: 'spectral' })).status, 400);
  const body = { theme: 'halloween', expectedRevision: 'initial' };
  for (const headers of [{}, { 'x-denfi-kiosk-server': 'auto-shutdown', origin: 'http://player' },
    { 'x-denfi-kiosk-server': 'auto-shutdown', 'sec-fetch-site': 'same-origin' },
    { 'x-denfi-kiosk-server': 'auto-shutdown', 'x-untrusted': '1' }]) {
    assert.equal((await p.request('/api/admin/kiosk-session-theme', body, headers)).status, 403);
  }
  const old = await fixture(t, 'auto-shutdown', { getPointsUrl: () => p.url,
    fetchImpl: async () => new Response('{}', { status: 404 }) });
  const load = await old.request('/api/admin/session-theme');
  assert.equal(load.status, 409); assert.match(load.error, /Update.*Denfi Points/);
  assert.equal((await old.request('/api/session-theme')).policy.theme, 'default');
});

test('save verification is not interrupted by polling; stale in-flight poll cannot overwrite a save', async t => {
  const p = await fixture(t, 'points');
  let release, started, delay = false;
  const began = new Promise(resolve => { started = resolve; });
  const a = await fixture(t, 'auto-shutdown', { getPointsUrl: () => p.url,
    fetchImpl: async (url, options) => {
      const response = await fetch(url, options);
      if (delay && url.endsWith('/api/sync/session-theme')) {
        delay = false; started();
        await new Promise(resolve => { release = resolve; });
      }
      return response;
    } });
  await a.request('/api/admin/session-theme');
  delay = true;
  const stalePoll = a.service.poll(); await began;
  const saved = await a.request('/api/admin/session-theme', { theme: 'halloween', expectedRevision: 'initial' });
  assert.equal(saved.status, 200);
  release(); await stalePoll;
  assert.equal((await a.request('/api/session-theme')).policy.theme, 'halloween');
});

test('a connection switch during save cannot apply a policy from the old server', async t => {
  const p = await fixture(t, 'points');
  let url = p.url;
  const a = await fixture(t, 'auto-shutdown', { getPointsUrl: () => url,
    fetchImpl: async (target, options) => {
      const response = await fetch(target, options);
      if (options.method === 'POST') url = '';
      return response;
    } });
  const saved = await a.request('/api/admin/session-theme', { theme: 'halloween', expectedRevision: 'initial' });
  assert.equal(saved.status, 409);
  assert.equal((await a.request('/api/session-theme')).policy.theme, 'default');
});

test('real signed settings survive restart without altering unrelated fields', () => {
  const settings = require('../src/settings-store');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-theme-settings-'));
  settings.setDataDir(directory); settings.setAppRole('points', true);
  try {
    settings.updateSettings({ computerName: 'Retain station', sessionTheme: 'halloween',
      sessionThemeRevision: '12345678-1234-1234-1234-123456789abc' });
    delete require.cache[require.resolve('../src/settings-store')];
    const restarted = require('../src/settings-store');
    restarted.setDataDir(directory); restarted.setAppRole('points', true);
    assert.equal(restarted.getSettings().sessionTheme, 'halloween');
    assert.equal(restarted.getPublicSettings().sessionTheme, 'halloween');
    assert.equal(restarted.getSettings().computerName, 'Retain station');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
