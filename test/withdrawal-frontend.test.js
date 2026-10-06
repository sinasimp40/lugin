'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sessionSource = fs.readFileSync(path.join(__dirname, '../public/withdrawal-session.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(__dirname, '../public/withdrawal-admin.js'), 'utf8');

class StubNode {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.listeners = Object.create(null);
    this.dataset = Object.create(null);
    this.style = Object.create(null);
    this.className = '';
    this.value = '';
    this.textContent = '';
    this.disabled = false;
    this.checked = false;
    this.hidden = false;
    this.colSpan = 1;
    this.classList = {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; }
    };
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
  }
}

function jsonResponse(body, status = 200) {
  if (body.enabled !== undefined) {
    body = { machine: { busy: false, state: 'idle', message: '' }, ...body };
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeSessionHarness({ fetch, storageBlocked = false, initialUser = 'mem-a', seed, clock = () => Date.now(), search = '' } = {}) {
  const elements = new Map();
  const saved = new Map();
  let username = initialUser;
  let canStart = true;
  const pointsWrites = [];
  const intervals = [];

  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new StubNode());
    return elements.get(id);
  };
  const localStorage = {
    getItem(key) {
      if (storageBlocked) throw new Error('storage blocked');
      return saved.has(key) ? saved.get(key) : null;
    },
    setItem(key, value) {
      if (storageBlocked) throw new Error('storage blocked');
      saved.set(key, String(value));
    },
    removeItem(key) {
      if (storageBlocked) throw new Error('storage blocked');
      saved.delete(key);
    }
  };
  if (seed) {
    for (const [key, value] of Object.entries(seed)) saved.set(key, JSON.stringify(value));
  }

  const bridge = {
    context: () => ({ username, member: Boolean(username), balance: 30, canStart }),
    setPoints(value) { pointsWrites.push(value); },
    resize() {},
    open() {},
    setUser(value) { username = value; },
    setCanStart(value) { canStart = value; },
    get pointWrites() { return pointsWrites; }
  };
  const window = { DenfiWithdrawalBridge: bridge };
  const document = {
    readyState: 'complete',
    getElementById: element,
    addEventListener() {}
  };
  const context = {
    URLSearchParams,
    location: { search },
    document,
    window,
    localStorage,
    crypto: { randomUUID: () => 'request-a' },
    fetch,
    setTimeout,
    setInterval(callback, delay) { intervals.push({ callback, delay }); },
    performance: { now: clock },
    queueMicrotask,
    console,
    Date,
    Number,
    Math,
    JSON,
    encodeURIComponent
  };
  vm.runInNewContext(sessionSource, context, { filename: 'public/withdrawal-session.js' });
  return { bridge, context, element, saved, intervals };
}

const adminIds = [
  'admin-withdrawal-form',
  'admin-withdrawal-save',
  'admin-withdrawal-enabled',
  'admin-withdrawal-min',
  'admin-withdrawal-max',
  'admin-withdrawal-daily-limit',
  'admin-withdrawal-url',
  'admin-withdrawal-username',
  'admin-withdrawal-password',
  'admin-withdrawal-secret-state',
  'admin-withdrawal-connection',
  'admin-withdrawal-save-status',
  'admin-withdrawal-test-login',
  'admin-withdrawal-test-status',
  'admin-withdrawal-reload',
  'admin-withdrawals-refresh',
  'admin-withdrawals-status',
  'admin-withdrawals-list'
];

test('admin login test checks saved credentials only and displays safe diagnostic information', async () => {
  let probes = 0;
  const app = makeAdminHarness(async (url, options) => {
    if (url === '/api/admin/withdrawal') return jsonResponse({
      success: true, connected: true, version: 1, dailyLimitSupported: true, writeAuthorized: true, loginTestSupported: true,
      withdrawal: { enabled: true, min: 1, max: 20, loginUrl: 'http://fake-controller/admin/api/login',
        username: 'fake-user', dailyLimit: 0, passwordConfigured: true }
    });
    if (url.endsWith('/test-login')) {
      probes++;
      assert.equal(options.method, 'POST');
      assert.equal(options.body, '{}');
      return jsonResponse({ success: true, authenticated: false, coinsRequested: false,
        message: 'Login returned a webpage. No coins were requested.',
        diagnostics: { httpStatus: 200, bodyFormat: 'html', tokenSource: null }
      });
    }
    return jsonResponse({ success: true, withdrawals: [] });
  });
  await app.window.DenfiWithdrawalAdmin.load();
  const button = app.elements.get('admin-withdrawal-test-login');
  assert.equal(button.disabled, false);
  await button.listeners.click();
  assert.equal(probes, 1);
  assert.match(app.elements.get('admin-withdrawal-test-status').textContent, /HTTP 200.*html/);
  app.elements.get('admin-withdrawal-password').value = 'changed-fake-password';
  await button.listeners.click();
  assert.equal(probes, 1, 'unsaved passwords must not be tested against old saved settings');
  assert.match(app.elements.get('admin-withdrawal-test-status').textContent, /Save the changed credentials/);
});

function makeAdminHarness(fetch, { prompts = [], confirms = [] } = {}) {
  const elements = new Map(adminIds.map((id) => [id, new StubNode()]));
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new StubNode());
      return elements.get(id);
    },
    createElement(tagName) {
      return new StubNode(tagName);
    }
  };
  const window = {
    getDenfiAdminToken: () => 'local-admin-token',
    prompt: () => prompts.shift() ?? null,
    confirm: () => confirms.shift() ?? false
  };
  const context = {
    document,
    window,
    fetch,
    Node: StubNode,
    Intl,
    Date,
    Number,
    JSON,
    encodeURIComponent
  };
  vm.runInNewContext(adminSource, context, { filename: 'public/withdrawal-admin.js' });
  return { elements, window };
}

test('session withdrawal requires explicit notFound on status-check 404 and rechecks pending game before retry', async () => {
  let reportNoRecord = false;
  let postCount = 0;
  const app = makeSessionHarness({
    fetch: async (url, options) => {
      if (url === '/api/session/withdrawal' && !options?.method) {
        return jsonResponse({ success: true, enabled: true, min: 1, max: 99, balance: 30, withdrawal: null });
      }
      if (url === '/api/session/withdrawal' && options?.method === 'POST') {
        postCount += 1;
        return jsonResponse({
          success: true,
          balance: 25,
          withdrawal: { requestId: 'request-a', username: 'mem-a', amount: 5, status: 'reserved' }
        });
      }
      return jsonResponse({ success: false, error: 'not found', notFound: reportNoRecord }, 404);
    }
  });

  await nextTurn(); // allow the source's initial policy poll to settle
  await app.context.window.DenfiWithdrawalSession.refresh();
  app.element('withdrawal-amount').value = '5';
  await app.context.window.DenfiWithdrawalSession.submit();
  await app.element('withdrawal-check').listeners.click({ type: 'click', target: app.element('withdrawal-check') });
  assert.equal(app.element('withdrawal-submit').disabled, true, 'ordinary feature/API 404 must not permit retry');

  reportNoRecord = true;
  await app.element('withdrawal-check').listeners.click({ type: 'click', target: app.element('withdrawal-check') });
  assert.equal(app.element('withdrawal-submit').disabled, false, 'the explicit no-record response permits same-ID retry');

  app.bridge.setCanStart(false);
  await app.context.window.DenfiWithdrawalSession.submit();
  assert.equal(postCount, 1, 'a confirmed-no-record retry is still blocked by a pending points game');
});

test('session withdrawal aborts before POST when request persistence fails', async () => {
  let postCount = 0;
  const app = makeSessionHarness({
    storageBlocked: true,
    fetch: async (_url, options) => {
      if (options?.method === 'POST') postCount += 1;
      return jsonResponse({ success: true, enabled: true, min: 1, max: 50, balance: 30, withdrawal: null });
    }
  });

  await nextTurn();
  await app.context.window.DenfiWithdrawalSession.refresh();
  app.element('withdrawal-amount').value = '3';
  await app.context.window.DenfiWithdrawalSession.submit();
  assert.equal(postCount, 0, 'no request may leave the kiosk without a persisted ID');
  assert.match(app.element('withdrawal-status').textContent, /could not safely save/i);
});

test('late member A result cannot clear member B pending state or apply A balance', async () => {
  let releaseFirstRequest;
  let signalFirstRequest;
  const delayedA = new Promise((resolve) => { releaseFirstRequest = resolve; });
  const firstRequestStarted = new Promise((resolve) => { signalFirstRequest = resolve; });
  let firstGet = true;
  const app = makeSessionHarness({
    seed: {
      'denfi.withdrawal.pending:mem-b': {
        requestId: 'request-b',
        amount: 4,
        username: 'mem-b'
      }
    },
    fetch: async (url) => {
      if (firstGet) {
        firstGet = false;
        signalFirstRequest();
        return delayedA;
      }
      if (url === '/api/session/withdrawal/request-b') {
        return jsonResponse({
          success: true,
          balance: 26,
          withdrawal: { requestId: 'request-b', username: 'mem-b', amount: 4, status: 'reserved' }
        });
      }
      return jsonResponse({ success: true, enabled: true, min: 1, max: 50, balance: 26, withdrawal: null });
    }
  });

  await firstRequestStarted;
  app.bridge.setUser('mem-b');
  await app.context.window.DenfiWithdrawalSession.refresh();
  releaseFirstRequest(jsonResponse({
    success: true,
    enabled: true,
    min: 1,
    max: 50,
    balance: 7,
    withdrawal: { requestId: 'old-a', username: 'mem-a', amount: 1, status: 'success' }
  }));
  await nextTurn();
  await nextTurn();

  assert.equal(app.saved.get('denfi.withdrawal.pending:mem-b'), JSON.stringify({
    requestId: 'request-b',
    amount: 4,
    username: 'mem-b'
  }), 'late A completion must not clear B request storage');
  assert.equal(app.bridge.pointWrites.includes(7), false, 'A balance must never be applied to B');
});

test('an unknown payout status stays held and the actual CHECK STATUS click queries the same request', async () => {
  let requestId, checks = 0;
  const app = makeSessionHarness({ fetch: async (url, options = {}) => {
    if (options.method === 'POST') {
      const input = JSON.parse(options.body);
      requestId = input.requestId;
      return jsonResponse({ success: true, balance: 20,
        withdrawal: { ...input, username: 'mem-a', status: 'pending' } });
    }
    if (url !== '/api/session/withdrawal') {
      checks++;
      assert.ok(url.endsWith('/' + requestId));
      return jsonResponse({ success: true, balance: 20,
        withdrawal: { requestId, amount: 10, username: 'mem-a', status: 'sending' } });
    }
    return jsonResponse({ success: true, enabled: true, min: 1, max: 50, balance: 30, withdrawal: null });
  } });
  await nextTurn();
  app.element('withdrawal-amount').value = '10';
  await app.context.window.DenfiWithdrawalSession.submit();
  assert.equal(app.element('withdrawal-form').dataset.recordStatus, 'unconfirmed');
  assert.equal(app.element('withdrawal-submit').disabled, true);
  assert.equal(app.element('withdrawal-check-wrap').style.display, '');
  assert.ok(app.saved.has('denfi.withdrawal.pending:mem-a'));
  await app.element('withdrawal-check').listeners.click({ type: 'click' });
  assert.equal(checks, 1);
  assert.equal(app.element('withdrawal-form').dataset.recordStatus, 'sending');
});

test('shared processing, paused, or unknown availability blocks requests without queueing or saving an ID', async () => {
  let posts = 0;
  let machine = { busy: true, state: 'processing', message: 'Coin machine busy — please wait. Nothing is queued.' };
  const app = makeSessionHarness({ fetch: async (url, options = {}) => {
    if (options.method === 'POST') {
      posts++;
      const input = JSON.parse(options.body);
      return jsonResponse({ success: true, balance: 25, machine,
        withdrawal: { ...input, username: 'mem-a', status: 'success' } });
    }
    return jsonResponse({ success: true, enabled: true, min: 1, max: 50, balance: 30, withdrawal: null, machine });
  } });
  await nextTurn();
  app.element('withdrawal-amount').value = '5';
  for (const state of ['processing', 'unconfirmed', 'unknown']) {
    machine = state === 'unknown' ? null : { busy: true, state, message: 'Please wait for the machine or an admin check.' };
    await app.context.window.DenfiWithdrawalSession.refresh();
    assert.equal(app.element('withdrawal-machine').hidden, false);
    assert.equal(app.element('withdrawal-submit').disabled, true);
    assert.equal(app.element('withdrawal-amount').disabled, true);
    await app.context.window.DenfiWithdrawalSession.submit();
    assert.equal(posts, 0);
    assert.equal(app.saved.size, 0, 'waiting must not create a future queued payout or reserve points');
  }
  machine = { busy: false, state: 'idle', message: '' };
  await app.context.window.DenfiWithdrawalSession.refresh();
  assert.equal(app.element('withdrawal-submit').disabled, false);
  assert.equal(app.element('withdrawal-amount').value, '5');
  assert.equal(posts, 0, 'becoming idle must not automatically submit the waiting amount');
  await app.context.window.DenfiWithdrawalSession.submit();
  assert.equal(posts, 1);
});

test('cooldown counts down smoothly but only a server idle response unlocks; expiry never queues a payout', async () => {
  let time = 1000, posts = 0, unavailable = false;
  let machine = { busy: true, state: 'cooldown', cooldownRemainingMs: 10000 };
  const app = makeSessionHarness({ clock: () => time, fetch: async (_url, options = {}) => {
    if (options.method === 'POST') posts++;
    if (unavailable) throw new Error('Points offline');
    return jsonResponse({ success: true, enabled: true, min: 1, max: 50, balance: 30, machine });
  } });
  await nextTurn();
  const tick = app.intervals.find(timer => timer.delay === 250).callback;
  assert.equal(app.element('withdrawal-submit').textContent, 'WAIT 10s');
  app.element('withdrawal-amount').value = '5';
  time += 1000;
  tick();
  assert.equal(app.element('withdrawal-submit').textContent, 'WAIT 9s');
  await app.context.window.DenfiWithdrawalSession.submit();
  assert.equal(posts, 0);
  time += 9000;
  unavailable = true;
  tick();
  assert.equal(app.element('withdrawal-submit').disabled, true);
  await nextTurn();
  assert.equal(app.element('withdrawal-submit').disabled, true, 'offline expiry must not unlock');
  unavailable = false;
  machine = { busy: false, state: 'idle', message: '' };
  await app.context.window.DenfiWithdrawalSession.refresh();
  assert.equal(app.element('withdrawal-submit').disabled, false);
  assert.equal(app.element('withdrawal-submit').textContent, 'REQUEST');
  assert.equal(posts, 0, 'no automatic submission after cooldown');
  assert.equal(app.element('withdrawal-amount').value, '5');
});

test('a stale result for another request cannot clear the current request or apply its balance even for the same member', async () => {
  const key = 'denfi.withdrawal.pending:mem-a';
  const current = { username: 'mem-a', requestId: 'current-request', amount: 5 };
  const app = makeSessionHarness({ seed: { [key]: current }, fetch: async url => {
    if (url === '/api/session/withdrawal') return jsonResponse({
      success: true, enabled: true, min: 1, max: 50, balance: 30, withdrawal: null,
    });
    return jsonResponse({ success: true, balance: 1,
      withdrawal: { username: 'mem-a', requestId: 'older-request', amount: 5, status: 'success' } });
  } });
  await nextTurn();
  assert.equal(app.saved.get(key), JSON.stringify(current));
  assert.ok(!app.bridge.pointWrites.includes(1));
  assert.equal(app.element('withdrawal-submit').disabled, true);
});

test('idle withdrawal refresh updates visible authoritative balance but not a pending game result', async () => {
  const app = makeSessionHarness({ fetch: async () => jsonResponse({
    success: true, enabled: true, min: 1, max: 50, balance: 24.75, withdrawal: null,
    machine: { busy: false, state: 'idle' }
  }) });
  await nextTurn();
  assert.ok(app.bridge.pointWrites.includes(24.75));
  app.bridge.pointWrites.length = 0;
  app.bridge.setCanStart(false);
  await app.context.window.DenfiWithdrawalSession.refresh();
  assert.equal(app.bridge.pointWrites.length, 0);
});

test('existing kiosk admin login opens settings and history directly, and expiry hides private fields', async () => {
  let denyHistory = false;
  let historyCalls = 0;
  const historyRows = [
    { requestId: 'paid-request', username: 'mem-a', station: 'PC 01', amount: 8, balance: 20, status: 'unconfirmed' },
    { requestId: 'not-paid-request', username: 'mem-b', station: 'PC 02', amount: 9, balance: 22, status: 'unconfirmed' }
  ];
  const fetch = async (url, options = {}) => {
    assert.equal(options.headers?.['x-admin-token'], 'local-admin-token');
    if (url === '/api/admin/withdrawal') {
      return jsonResponse({
        success: true,
        connected: true,
          writeAuthorized: true,
        version: 1,
        dailyLimitSupported: true,
        withdrawal: {
          enabled: true,
          min: 1,
          max: 100,
          dailyLimit: 0,
          loginUrl: 'https://private-pisonet.invalid',
          username: 'private-pisonet-user',
          passwordConfigured: true
        }
      });
    }
    if (url === '/api/admin/withdrawals') {
      historyCalls += 1;
      if (denyHistory) return jsonResponse({ success: false, error: 'write authorization expired' }, 401);
      return jsonResponse({ success: true, withdrawals: historyRows });
    }
    if (url.endsWith('/resolve')) return jsonResponse({ success: true, withdrawal: { status: 'success' } });
    throw new Error('Unexpected request: ' + url);
  };
  const app = makeAdminHarness(fetch);
  await app.window.DenfiWithdrawalAdmin.load();

  assert.equal(app.elements.get('admin-withdrawal-connection').dataset.state, 'success', 'connected but unauthorized is not shown offline');
  assert.equal(app.elements.get('admin-withdrawal-save').disabled, false);
  assert.equal(app.elements.get('admin-withdrawal-url').value, 'https://private-pisonet.invalid');
  assert.equal(app.elements.get('admin-withdrawal-username').value, 'private-pisonet-user');
  assert.equal(app.elements.get('admin-withdrawal-password').value, '', 'saved Pisonet passwords are not returned');
  assert.equal(historyCalls, 1);

  denyHistory = true;
  await app.window.DenfiWithdrawalAdmin.loadHistory();
  assert.equal(app.elements.get('admin-withdrawal-save').disabled, true, '401 revokes local write controls');
  assert.equal(app.elements.get('admin-withdrawal-url').value, '', 'expiration clears protected credentials');
  assert.equal(app.elements.get('admin-withdrawal-connection').dataset.state, 'error');
  assert.match(app.elements.get('admin-withdrawal-connection').textContent, /Auto Shutdown admin session expired/i);
});

test('withdrawal page has no secondary Points password or authorization button', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.ok(!html.includes('admin-withdrawal-points-password'));
  assert.ok(!html.includes('admin-withdrawal-authorize'));
  assert.ok(!adminSource.includes('pointsPassword'));
});

test('admin PAID choice sends released=true and NOT PAID sends released=false', async () => {
  const posted = [];
  const records = [
    { requestId: 'paid-request', username: 'mem-a', station: 'PC 01', amount: 8, balance: 20, status: 'unconfirmed' },
    { requestId: 'not-paid-request', username: 'mem-b', station: 'PC 02', amount: 9, balance: 22, status: 'unconfirmed' }
  ];
  const fetch = async (url, options = {}) => {
    if (url === '/api/admin/withdrawal') {
      return jsonResponse({
        success: true,
        connected: true,
        writeAuthorized: true,
        version: 1,
        dailyLimitSupported: true,
        withdrawal: { enabled: true, min: 1, max: 100, dailyLimit: 0, loginUrl: 'https://pisonet.invalid', username: 'operator' }
      });
    }
    if (url === '/api/admin/withdrawals') return jsonResponse({ success: true, withdrawals: records });
    if (url.endsWith('/resolve')) {
      posted.push(JSON.parse(options.body));
      return jsonResponse({ success: true, withdrawal: { status: 'success' } });
    }
    throw new Error('Unexpected request: ' + url);
  };
  const app = makeAdminHarness(fetch, {
    prompts: ['PAID', 'coin-machine receipt 1', 'NOT PAID', 'coin-machine receipt 2'],
    confirms: [true, true]
  });
  await app.window.DenfiWithdrawalAdmin.load();
  const rows = app.elements.get('admin-withdrawals-list').children;
  await rows[0].children[7].children[0].listeners.click();
  await rows[1].children[7].children[0].listeners.click();

  assert.deepEqual(posted.map((payload) => payload.released), [true, false]);
  assert.deepEqual(posted.map((payload) => payload.reason), ['coin-machine receipt 1', 'coin-machine receipt 2']);
});

test('admin daily withdrawal limit requires Points capability and publishes/readbacks an integer limit', async () => {
  let posted;
  const app = makeAdminHarness(async (url, options = {}) => {
    if (url === '/api/admin/withdrawal' && !options.method) return jsonResponse({
      success: true, connected: true, version: 1, dailyLimitSupported: true, writeAuthorized: true,
      withdrawal: { enabled: true, min: 1, max: 100, dailyLimit: 7, loginUrl: 'https://pisonet.invalid', username: 'operator' }
    });
    if (url === '/api/admin/withdrawal' && options.method === 'POST') {
      posted = JSON.parse(options.body);
      return jsonResponse({
        success: true, connected: true, version: 1, dailyLimitSupported: true, writeAuthorized: true,
        withdrawal: { enabled: true, min: 1, max: 100, dailyLimit: posted.dailyLimit, loginUrl: 'https://pisonet.invalid', username: 'operator' }
      });
    }
    return jsonResponse({ success: true, withdrawals: [] });
  });
  await app.window.DenfiWithdrawalAdmin.load();
  assert.equal(app.elements.get('admin-withdrawal-daily-limit').value, 7);
  app.elements.get('admin-withdrawal-daily-limit').value = '13';
  await app.elements.get('admin-withdrawal-form').listeners.submit({ preventDefault() {} });
  assert.equal(posted.dailyLimit, 13);
  assert.equal(app.elements.get('admin-withdrawal-daily-limit').value, 13, 'confirmed value is read back into the field');
  assert.match(app.elements.get('admin-withdrawal-save-status').textContent, /Published successfully/);
});

test('admin daily limit save is disabled with explicit update message when Points lacks the capability', async () => {
  const app = makeAdminHarness(async url => {
    if (url === '/api/admin/withdrawal') return jsonResponse({
      success: true, connected: true, version: 1, writeAuthorized: true,
      withdrawal: { enabled: true, min: 1, max: 100, dailyLimit: 0, loginUrl: 'https://pisonet.invalid', username: 'operator' }
    });
    return jsonResponse({ success: true, withdrawals: [] });
  });
  await app.window.DenfiWithdrawalAdmin.load();
  assert.equal(app.elements.get('admin-withdrawal-save').disabled, true);
  assert.equal(app.elements.get('admin-withdrawal-daily-limit').disabled, true);
  assert.match(app.elements.get('admin-withdrawal-connection').textContent, /update Denfi Points.*daily withdrawal limit/i);
});

test('admin rejects out-of-range daily limits and does not claim success when Points readback differs', async () => {
  let posts = 0;
  const app = makeAdminHarness(async (url, options = {}) => {
    if (url === '/api/admin/withdrawal' && !options.method) return jsonResponse({
      success: true, connected: true, version: 1, dailyLimitSupported: true, writeAuthorized: true,
      withdrawal: { enabled: true, min: 1, max: 100, dailyLimit: 0, loginUrl: 'https://pisonet.invalid', username: 'operator' }
    });
    if (url === '/api/admin/withdrawal' && options.method === 'POST') {
      posts++;
      return jsonResponse({
        success: true, connected: true, version: 1, dailyLimitSupported: true, writeAuthorized: true,
        withdrawal: { enabled: true, min: 1, max: 100, dailyLimit: 2, loginUrl: 'https://pisonet.invalid', username: 'operator' }
      });
    }
    return jsonResponse({ success: true, withdrawals: [] });
  });
  await app.window.DenfiWithdrawalAdmin.load();
  const field = app.elements.get('admin-withdrawal-daily-limit');
  field.value = '1001';
  await app.elements.get('admin-withdrawal-form').listeners.submit({ preventDefault() {} });
  assert.equal(posts, 0);
  assert.match(app.elements.get('admin-withdrawal-save-status').textContent, /whole number from 0 to 1000/);
  field.value = '1';
  await app.elements.get('admin-withdrawal-form').listeners.submit({ preventDefault() {} });
  assert.equal(posts, 1);
  assert.match(app.elements.get('admin-withdrawal-save-status').textContent, /did not confirm the saved daily withdrawal limit/);
  assert.doesNotMatch(app.elements.get('admin-withdrawal-save-status').textContent, /Published successfully/);
  assert.equal(app.elements.get('admin-withdrawal-save').disabled, true);
});

test('member daily limit blocks a new request and preserves the daily reset information', async () => {
  let posts = 0;
  const app = makeSessionHarness({ fetch: async (_url, options = {}) => {
    if (options.method === 'POST') posts++;
    return jsonResponse({
      success: true, enabled: true, min: 1, max: 50, balance: 30, withdrawal: null,
      daily: { dayKey: '2026-01-01', used: 2, limit: 2, remaining: 0, resetAt: '2026-01-02T16:00:00.000Z', timeZone: 'Asia/Manila', allowed: false }
    });
  } });
  await nextTurn();
  assert.equal(app.element('withdrawal-submit').disabled, true);
  assert.equal(app.element('withdrawal-submit').textContent, 'DAILY LIMIT');
  assert.equal(app.element('withdrawal-amount').disabled, true);
  assert.match(app.element('withdrawal-daily').textContent, /2 of 2 successful withdrawals used; 0 remaining/);
  assert.match(app.element('withdrawal-daily').textContent, /Resets/);
  app.element('withdrawal-amount').value = '5';
  await app.context.window.DenfiWithdrawalSession.submit();
  assert.equal(posts, 0);
  assert.equal(app.saved.size, 0);
});

test('demo daily limit counts successful simulated withdrawals without a payout API', async () => {
  const app = makeSessionHarness({
    search: '?preview=1&withdraw=1&dailyLimit=1&used=0&delay=250',
    fetch: async () => { throw new Error('demo must not call the server'); }
  });
  await nextTurn();
  assert.match(app.element('withdrawal-daily').textContent, /0 of 1 successful withdrawals used; 1 remaining/);
  app.element('withdrawal-amount').value = '5';
  await app.context.window.DenfiWithdrawalSession.submit();
  assert.equal(app.element('withdrawal-submit').textContent, 'DAILY LIMIT');
  assert.equal(app.element('withdrawal-submit').disabled, true);
  assert.match(app.element('withdrawal-daily').textContent, /1 of 1 successful withdrawals used; 0 remaining/);
});