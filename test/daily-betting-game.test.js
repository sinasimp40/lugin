const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { dayKey, resolveGame } = require('../src/daily-betting-game');
const { defaultWheel, parseWheel, oddsToken } = require('../src/wheel-config');

test('daily selection is stable, equally seeded between two games, and uses the Points calendar', () => {
  const policy = { ...defaultWheel(), game: 'random' };
  const seed = 'a'.repeat(64);
  assert.equal(parseWheel(policy).game, 'random');
  const morning = new Date(2026, 9, 7, 0, 0, 0);
  const night = new Date(2026, 9, 7, 23, 59, 59);
  assert.deepEqual(resolveGame(policy, seed, morning), resolveGame(policy, seed, night));
  assert.equal(resolveGame(policy, seed, morning).dayKey, '2026-10-07');
  assert.equal(dayKey(new Date(2026, 9, 8)), '2026-10-08');
  const choices = new Set();
  for (let day = 1; day <= 31; day++) choices.add(resolveGame(policy, seed, new Date(2026, 9, day)).game);
  assert.deepEqual([...choices].sort(), ['dice', 'wheel']);
  assert.deepEqual(resolveGame({ game: 'dice' }, null), { game: 'dice', dayKey: null });
  assert.throws(() => resolveGame(policy, null), /persisted/);
  const playing = { ...policy, game: 'wheel', randomDayKey: '2026-10-07' };
  assert.notEqual(oddsToken(playing), oddsToken({ ...playing, randomDayKey: '2026-10-08' }),
    'even a repeated game requires a fresh daily review');
  assert.notEqual(oddsToken(policy), oddsToken(playing), 'admin policy versions are not playable daily versions');
});

test('Auto Shutdown rejects unsupported Random daily before any central or local write', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = source.indexOf("app.post('/api/admin/wheel',");
  const end = source.indexOf("app.post('/api/admin/kiosk-attendance',", start);
  assert.ok(start >= 0 && end > start);
  let handler;
  const routes = [];
  const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  new Function('app', 'verifyToken', 'appRole', 'parseWheel', 'settings', 'fetchPointsWheel',
    'wheelErrorResponse', source.slice(start, end))(
    { post: (_, __, callback) => { handler = callback; } }, () => {}, 'auto-shutdown', parseWheel,
    { updateSettings() { throw new Error('No local writes allowed'); } },
    async route => { routes.push(route); return { wheel: defaultWheel(), gamesPolicyVersion: 2 }; },
    (res, error) => res.status(error.status).json({ error: error.message }));
  await handler({ body: { ...defaultWheel(), game: 'random', mode: 'publish' } }, response);
  assert.equal(response.code, 409);
  assert.match(response.body.error, /Random daily/);
  assert.deepEqual(routes, ['/api/sync/wheel-config']);
});

test('real Points API shares its daily choice, resets allowance, rejects stale bets, and preserves replays across days/restarts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-random-api-'));
  const clock = path.join(dir, 'clock.txt');
  fs.writeFileSync(clock, String(new Date(2026, 9, 7, 12).getTime()));
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const launch = () => spawn(process.execPath, ['-e', `
    const fs=require('node:fs'),path=require('node:path');
    const dir=process.env.DENFI_TEST_DATA_DIR;
    Date.now=()=>Number(fs.readFileSync(path.join(dir,'clock.txt'),'utf8'));
    const s=require('./src/settings-store');s.setAppRole('points');s.setDataDir(dir);
    const logs=require('./src/coin-log-store');logs.setDataDir(dir);
    require('./src/attendance-store').setDataDir(dir);
    require('./src/order-store').setDataDir(dir);
    if (!logs.getMemberPoints('mem-random-api',[{pesos:1,points:1}]))
      logs.appendLog({username:'mem-random-api',amount:20,ip:'fixture',mac:'fixture'},[{pesos:1,points:1}]);
    s.updateSettings({pointRates:[{pesos:1,points:1}]});
    require('./server');
  `], { cwd: path.join(__dirname, '..'), env: { ...process.env, NODE_ENV: 'test', PORT: String(port),
    DENFI_APP_ROLE: 'points', DENFI_POINTS_SQLITE: '1', DENFI_TEST_DATA_DIR: dir,
    DENFI_LISTEN_HOST: '127.0.0.1' }, stdio: 'ignore' });
  let child = launch();
  const request = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  };
  const status = () => request('/api/sync/wheel/status/mem-random-api');
  const ready = async () => {
    for (let attempt = 0; attempt < 80; attempt++) {
      try { if ((await request('/api/sync/wheel-config')).status === 200) return; } catch (_) {}
      if (child.exitCode !== null) throw new Error('Points fixture stopped');
      await delay(100);
    }
    throw new Error('Points fixture did not become ready');
  };
  const stop = async () => {
    if (child.exitCode !== null) return;
    const ended = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    await ended;
  };
  try {
    await ready();
    const config = { ...defaultWheel(), game: 'random', allowCustomStake: true, maxSpinsPerDay: 2,
      dice: { winRate: 100, loseRate: 0, payoutMultiplier: 2 }, outcomes: [{ multiplier: 2, weight: 100 }] };
    assert.equal((await request('/api/admin/kiosk-wheel', config)).status, 200);
    const first = (await status()).data;
    const shared = (await request('/api/sync/wheel-config')).data;
    const other = (await request('/api/sync/wheel/status/mem-other-random')).data;
    assert.equal(shared.wheel.game, 'random');
    assert.equal(shared.randomDailyVersion, 1);
    assert.equal(shared.activeGame, first.game);
    assert.equal(other.game, first.game);
    assert.equal(first.randomDayKey, '2026-10-07');
    assert.doesNotMatch(JSON.stringify(first), /winRate|loseRate|weight|dailyBettingSeed/);
    assert.notEqual(first.oddsToken, shared.oddsToken);
    const wager = { username: 'mem-random-api', requestId: crypto.randomUUID(), game: first.game,
      ...(first.game === 'dice' ? { choice: 'low' } : {}),
      expectedStake: 1, expectedBalance: 20, oddsToken: first.oddsToken };
    assert.equal((await request('/api/sync/wheel/spin', {
      ...wager, game: first.game === 'dice' ? 'wheel' : 'dice', choice: 'high'
    })).status, 409);
    const settled = await request('/api/sync/wheel/spin', wager);
    assert.equal(settled.status, 200);
    assert.equal(settled.data.spin.balance, 21);
    const next = (await status()).data;
    assert.equal((await request('/api/sync/wheel/spin', {
      ...wager, requestId: crypto.randomUUID(), expectedBalance: next.balance, oddsToken: next.oddsToken
    })).status, 200);
    assert.equal((await request('/api/sync/wheel/spin', {
      ...wager, requestId: crypto.randomUUID(), expectedBalance: 22
    })).status, 429);
    fs.writeFileSync(clock, String(new Date(2026, 9, 8, 0, 0, 0).getTime()));
    const tomorrow = (await status()).data;
    assert.equal(tomorrow.randomDayKey, '2026-10-08');
    assert.equal(tomorrow.spinsUsed, 0);
    assert.equal(tomorrow.spinsRemaining, 2);
    assert.notEqual(tomorrow.oddsToken, first.oddsToken);
    assert.equal((await request('/api/sync/wheel/spin', {
      ...wager, requestId: crypto.randomUUID(), expectedBalance: 22
    })).status, 409);
    assert.equal((await request('/api/sync/wheel/spin', wager)).data.spin.id, settled.data.spin.id);
    assert.equal((await status()).data.balance, 22);
    assert.equal((await request('/api/sync/wheel/spin', {
      username: wager.username, requestId: crypto.randomUUID(), game: tomorrow.game,
      ...(tomorrow.game === 'dice' ? { choice: 'high' } : {}),
      expectedStake: 1, expectedBalance: 22, oddsToken: tomorrow.oddsToken
    })).status, 200);
    await stop();
    child = launch();
    await ready();
    const restarted = (await status()).data;
    assert.equal(restarted.game, tomorrow.game);
    assert.equal(restarted.randomDayKey, tomorrow.randomDayKey);
    assert.equal(restarted.spinsUsed, 1);
    assert.equal(restarted.balance, 23);
    assert.equal((await request('/api/sync/wheel/spin', wager)).data.spin.id, settled.data.spin.id);
  } finally {
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
