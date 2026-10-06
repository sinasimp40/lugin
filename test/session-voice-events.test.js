const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { VoiceSessionTracker } = require('../src/session-voice-events');

test('explicit matching logout emits immediately, retains the status baseline, and suppresses later polling duplication', () => {
  const emitted = [];
  const tracker = new VoiceSessionTracker({ emit: event => emitted.push(event) });
  const active = { isLogin: true, username: 'mem-alice', sessionTimeLeft: 300 };
  tracker.observe(active);
  assert.equal(tracker.explicitLogout('mem-bob'), false);
  assert.equal(tracker.explicitLogout('MEM-ALICE'), true);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, 'logout');
  assert.equal(tracker.baseline.active, true);
  assert.equal(tracker.explicitLogout('mem-alice'), false);
  tracker.observe({ ...active, sessionTimeLeft: 299 });
  assert.equal(emitted.length, 1, 'an upstream active sample cannot produce a phantom welcome');
  tracker.observe({ isLogin: false, sessionTimeLeft: 0 });
  assert.equal(emitted.length, 1, 'confirmed automatic logout cannot repeat the explicit speech');
  tracker.observe(active);
  assert.equal(emitted[1].type, 'welcome', 'a genuinely new session remains audible');
});

test('session trigger rejects a stale member before locking or announcing a newer session', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
  const start = source.indexOf("app.post('/api/session/trigger'");
  const end = source.indexOf("app.get('/api/session/poll'", start);
  let handler, status = 200, response;
  const spoken = [];
  const context = {
    app: { post: (_path, callback) => { handler = callback; } },
    appRole: 'auto-shutdown', sessionEvent: null,
    lastSessionData: { isLogin: true, username: 'mem-alice' },
    voiceSessionTracker: { explicitLogout: username => spoken.push(username) },
    console: { log() {} }
  };
  vm.runInNewContext(source.slice(start, end), context);
  const res = { status(code) { status = code; return this; }, json(body) { response = body; } };
  handler({ body: { action: 'logged-out', username: 'mem-bob' } }, res);
  assert.equal(status, 409);
  assert.equal(context.sessionEvent, null);
  assert.deepEqual(spoken, []);
  status = 200;
  handler({ body: { action: 'logged-out', username: 'MEM-ALICE' } }, res);
  assert.equal(status, 200);
  assert.equal(response.success, true);
  assert.equal(context.sessionEvent, 'logged-out');
  assert.deepEqual(spoken, ['mem-alice']);
});

function createTracker(options = {}) {
  const events = [];
  let id = 0;
  let now = 1700000000000;
  const tracker = new VoiceSessionTracker({
    emit: event => events.push(event),
    idFactory: () => `voice-event-${++id}`,
    now: () => now++,
    ...options
  });
  return { tracker, events };
}

function active(username, sessionTimeLeft, ip = '10.10.10.10') {
  return {
    isLogin: true,
    username,
    sessionTimeLeft,
    ip,
    units: { [ip]: `Station ${ip.split('.').pop()}` }
  };
}

test('first snapshot establishes baseline without startup welcome or logout', () => {
  const { tracker, events } = createTracker();
  assert.deepEqual(tracker.observe(active('mem-first', '600')), []);
  assert.deepEqual(tracker.observe(active('mem-first', 598)), []);
  assert.deepEqual(events, []);

  tracker.reset();
  assert.deepEqual(tracker.observe({ isLogin: false }), []);
  assert.deepEqual(events, [], 'reset polling also begins with a silent baseline');
});

test('a later login emits a normalized welcome with station, UUID, and expiry timestamps', () => {
  const { tracker, events } = createTracker();
  tracker.observe({ isLogin: false });
  const login = active('  Mem-ALICE  ', 600);
  const emitted = tracker.observe(login);

  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0], {
    id: 'voice-event-1',
    type: 'welcome',
    username: 'mem-alice',
    station: 'Station 10',
    secondsAdded: 0,
    createdAt: 1700000000000,
    expiresAt: 1700000030000
  });
  assert.deepEqual(events, emitted, 'the event is emitted exactly once');
  assert.equal(login.username, '  Mem-ALICE  ', 'observing does not mutate hotspot data');
});

test('production event ids are UUIDs and expiry uses the injected local clock', () => {
  const clock = 123456789;
  const tracker = new VoiceSessionTracker({ now: () => clock });
  tracker.observe({ isLogin: false });
  const [event] = tracker.observe(active('mem-uuid', 60));
  assert.match(event.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(event.createdAt, clock);
  assert.equal(event.expiresAt, clock + 30000);
});

test('a username change emits the previous logout before the new welcome', () => {
  const { tracker, events } = createTracker();
  tracker.observe(active('mem-old', 300, '10.10.10.1'));
  const changed = tracker.observe(active('MEM-NEW', 900, '10.10.10.2'));

  assert.deepEqual(changed.map(event => [event.type, event.username, event.station]), [
    ['logout', 'mem-old', 'Station 1'],
    ['welcome', 'mem-new', 'Station 2']
  ]);
  assert.deepEqual(events, changed);
  assert.notEqual(changed[0].id, changed[1].id);
});

test('only meaningful same-user increases emit extensions; countdown and repeated samples do not duplicate', () => {
  const { tracker, events } = createTracker();
  tracker.observe(active('mem-alice', 600));
  assert.deepEqual(tracker.observe(active('mem-alice', 598)), [], 'countdown is ignored');
  assert.deepEqual(tracker.observe(active('mem-alice', 600)), [], '2-second jitter is ignored');

  const extension = tracker.observe(active('mem-alice', 660));
  assert.equal(extension.length, 1);
  assert.equal(extension[0].type, 'extended');
  assert.equal(extension[0].secondsAdded, 60, 'minute-like duration rounds cleanly');
  assert.deepEqual(tracker.observe(active('mem-alice', 660)), [], 'same increase is not replayed');
  assert.deepEqual(tracker.observe(active('mem-alice', 650)), [], 'decreases never announce');
  const afterDecrease = tracker.observe(active('mem-alice', 690));
  assert.equal(afterDecrease.length, 1, 'an increase from the latest lower sample is meaningful');
  assert.equal(afterDecrease[0].secondsAdded, 40);
  assert.deepEqual(tracker.observe(active('mem-alice', 690)), [], 'repeated increased samples stay deduplicated');
  assert.equal(events.length, 2);
});

test('extension reports raw seconds unless close to a minute and never crosses usernames', () => {
  const { tracker, events } = createTracker();
  tracker.observe(active('mem-a', 500));
  const extension = tracker.observe(active('mem-a', 537));
  assert.equal(extension[0].secondsAdded, 37);

  const changedUser = tracker.observe(active('mem-b', 800));
  assert.deepEqual(changedUser.map(event => event.type), ['logout', 'welcome']);
  assert.ok(changedUser.every(event => event.type !== 'extended'));
  assert.equal(events.length, 3);
});

test('confirmed active-to-inactive observation logs out the previous username', () => {
  const { tracker, events } = createTracker();
  tracker.observe(active('mem-leaving', 120, '10.10.10.4'));
  const logout = tracker.observe({ isLogin: false, sessionTimeLeft: 0 });
  assert.deepEqual(logout.map(({ type, username, station }) => ({ type, username, station })), [{
    type: 'logout',
    username: 'mem-leaving',
    station: 'Station 4'
  }]);
  assert.deepEqual(events, logout);
});

test('invalid times cannot produce extensions and observation leaves source data untouched', () => {
  const { tracker, events } = createTracker();
  const first = active('mem-safe', 'not-a-time');
  tracker.observe(first);
  const next = active('mem-safe', 300);
  const original = JSON.stringify(next);
  assert.deepEqual(tracker.observe(next), []);
  assert.equal(JSON.stringify(next), original);
  assert.deepEqual(events, []);
  assert.deepEqual(tracker.observe(active('mem-safe', null)), []);
  assert.deepEqual(tracker.observe(active('mem-safe', false)), []);
  assert.deepEqual(tracker.observe({}), []);
  assert.deepEqual(tracker.observe(active('mem-safe', 295)), []);
});

test('server observes only confirmed logout samples and does not replay voice events on connect', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const pollStart = server.indexOf('async function pollHotspotForWs()');
  const pollEnd = server.indexOf('\nfunction startWsPolling()', pollStart);
  assert.ok(pollStart >= 0 && pollEnd > pollStart);
  const poll = server.slice(pollStart, pollEnd);
  const confirmationGuard = poll.indexOf('confirmedLoggedOutSamples < LOGOUT_CONFIRMATION_SAMPLES');
  const observe = poll.indexOf('voiceSessionTracker.observe(data)');
  const assignLast = poll.indexOf('lastSessionData = data');
  assert.ok(confirmationGuard >= 0);
  assert.ok(observe > confirmationGuard, 'voice transition observation follows the authoritative logout guard');
  assert.ok(observe > assignLast, 'current status is committed before the independent voice tracker emits events');
  assert.ok(observe > poll.indexOf("broadcast({ type: 'status', data })"),
    'the audio owner receives the new identity before a welcome or extension');
  assert.match(poll.slice(confirmationGuard, observe), /return;/,
    'tentative logged-out samples exit before voice observation');

  const connectionStart = server.indexOf("wss.on('connection'");
  const connectionEnd = server.indexOf("\nfunction broadcast(", connectionStart);
  const connection = server.slice(connectionStart, connectionEnd);
  assert.doesNotMatch(connection, /voice-session-event/,
    'session voice events are not replayed to reconnecting WebSocket clients');
  assert.match(connection, /data: item\.win, replay: true/,
    'cached wheel notices identify themselves as replay history');
  assert.match(server, /const firstBatch = wheelWinsBaseline === null/);
  assert.match(server, /broadcast\(\{ type: 'wheel-win', data: win, replay: firstBatch \}\)/,
    'the first polled wheel batch is identified as history without altering win.data');
});