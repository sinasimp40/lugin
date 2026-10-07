const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { DatabaseSync } = require('node:sqlite');
const { defaultDice, parseDice, rollDice } = require('../src/dice-game');
const { defaultWheel, parseWheel, oddsToken } = require('../src/wheel-config');

test('dice settings validate exact percentages, fixed 2x payout and exclusive game selection', () => {
  assert.deepEqual(parseDice(defaultDice()), defaultDice());
  for (const rates of [[0, 100], [100, 0], [12.34, 87.66]]) {
    assert.ok(parseDice({ winRate: rates[0], loseRate: rates[1], payoutMultiplier: 2 }));
  }
  for (const rates of [[50, 49.99], [-1, 101], [NaN, 50], [50.001, 49.999], ['50', 50]]) {
    assert.equal(parseDice({ winRate: rates[0], loseRate: rates[1], payoutMultiplier: 2 }), null);
  }
  assert.equal(parseDice({ ...defaultDice(), payoutMultiplier: 3 }), null);
  assert.equal(parseWheel({ ...defaultWheel(), game: 'both' }), null);
  assert.equal(parseWheel({ ...defaultWheel(), dice: { ...defaultDice(), winRate: 90 } }), null);
  const legacy = parseWheel({ enabled: true, outcomes: [{ multiplier: 2, weight: 100 }] });
  assert.equal(legacy.game, 'wheel');
  assert.deepEqual(legacy.dice, defaultDice());
  const base = defaultWheel();
  assert.notEqual(oddsToken(base, 'private-key'), oddsToken(base));
  assert.notEqual(oddsToken(base, 'private-key'), oddsToken(base, 'different-key'));
  assert.notEqual(oddsToken(base), oddsToken({ ...base, game: 'dice' }));
  assert.notEqual(oddsToken(base), oddsToken({ ...base, dice: { ...defaultDice(), winRate: 20, loseRate: 80 } }));
});

test('every dice pair agrees with LOW 2–7 / HIGH 8–12 and exact odds boundaries hold', () => {
  for (const choice of ['low', 'high']) {
    for (const won of [true, false]) {
      const count = (choice === 'low') === won ? 21 : 15;
      for (let pairIndex = 0; pairIndex < count; pairIndex++) {
        let calls = 0;
        const spin = rollDice(choice, defaultDice(), max => {
          assert.equal(max, calls === 0 ? 10000 : count);
          return calls++ === 0 ? (won ? 4999 : 5000) : pairIndex;
        });
        assert.equal(spin.total, spin.dice[0] + spin.dice[1]);
        assert.ok(spin.dice.every(face => Number.isInteger(face) && face >= 1 && face <= 6));
        assert.equal(spin.multiplier, won ? 2 : 0);
        assert.equal(spin.result === choice, won);
        if (spin.total === 7) {
          assert.equal(spin.result, 'low');
          assert.equal(spin.multiplier, choice === 'low' ? 2 : 0);
        }
        assert.equal(spin.rulesVersion, 2);
      }
    }
  }
  assert.equal(rollDice('low', { winRate: 0, loseRate: 100, payoutMultiplier: 2 }, () => 0).multiplier, 0);
  assert.equal(rollDice('high', { winRate: 100, loseRate: 0, payoutMultiplier: 2 }, () => 0).multiplier, 2);
  assert.throws(() => rollDice('middle', defaultDice()), /Invalid/);
});

test('real session pending storage preserves dice side, game, stake, balance and version across reload', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'session.html'), 'utf8');
  const start = page.indexOf('    function wheelPendingKey(');
  const end = page.indexOf('    function notifyBettingVoice(', start);
  assert.ok(start >= 0 && end > start);
  const saved = new Map();
  const storage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) };
  const loadRenderer = () => new Function('sessionStorage', 'previewMode',
    page.slice(start, end) + '; return {readPendingWheel, writePendingWheel};')(storage, false);
  const original = loadRenderer();
  const id = crypto.randomUUID(), token = 'f'.repeat(64);
  original.writePendingWheel('mem-pending', id, 5.25, 100, [0, 2], token, 'dice', 'high');
  assert.deepEqual(loadRenderer().readPendingWheel('mem-pending'), {
    requestId: id, expectedStake: 5.25, expectedBalance: 100, multipliers: [0, 2],
    oddsToken: token, game: 'dice', choice: 'high', legacy: false
  });
  original.writePendingWheel('mem-pending', id, 5.25, 100, [0, 2], token, 'dice', 'low');
  assert.equal(loadRenderer().readPendingWheel('mem-pending').choice, 'low');
  assert.equal(loadRenderer().readPendingWheel('mem-other'), null);
  const preview = new Function('sessionStorage', 'previewMode',
    page.slice(start, end) + '; return {readPendingWheel, writePendingWheel};')(storage, true);
  assert.equal(preview.readPendingWheel('mem-pending'), null);
  preview.writePendingWheel('mem-pending', id, 90, 100, [0, 2], token, 'dice', 'high');
  assert.equal(loadRenderer().readPendingWheel('mem-pending').expectedStake, 5.25);
  const syncStart = page.indexOf('    function syncWheelStakeInput(');
  const syncEnd = page.indexOf('    function updateWheelControls(', syncStart);
  const input = { value: '100.00' };
  const sync = new Function('document', 'wheelData', 'wheelRequestId', 'wheelExpectedStake',
    'previewMode', 'sessionUsername', 'nextWheelStakeValue', `
      let wheelStakeMember = null;
      ${page.slice(syncStart, syncEnd)}
      syncWheelStakeInput();
    `);
  sync({ getElementById: () => input }, { balance: 100, allowCustomStake: true },
    id, 5.25, false, 'mem-pending', () => '100.00');
  assert.equal(input.value, '5.25', 'the disabled input must show the pending stake, not the full balance');
});

test('fake game previews cannot initialize real withdrawal requests or receipt handling', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'withdrawal-session.js'), 'utf8');
  for (const query of ['?preview=1&games=1&test=1', '?preview=1&games=1']) {
    // No DOM, window or network stubs: entering any real initialization would
    // fail this test rather than allowing the fake page to contact live funds.
    assert.doesNotThrow(() => new Function('location', source)({ search: query }));
  }
});

for (const backend of ['json', 'sqlite']) {
  test(`${backend}: dice settlement is atomic, idempotent, rate-proof, and shares wheel daily limits`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-dice-ledger-'));
    const db = backend === 'sqlite' ? new DatabaseSync(':memory:') : null;
    const store = db ? require('../src/coin-log-sqlite-store').createStore(db) : require('../src/coin-log-store');
    if (!db) store.setDataDir(dir);
    const rates = [{ pesos: 1, points: 1 }];
    try {
      store.appendLog({ username: 'mem-dice-test', amount: 20, ip: 'test', mac: 'test' }, rates);
      const policy = { game: 'dice', dice: { winRate: 100, loseRate: 0, payoutMultiplier: 2 },
        choice: 'high', username: 'mem-dice-test', requestId: crypto.randomUUID(), outcomes: defaultWheel().outcomes,
        expectedStake: 3, expectedBalance: 20, allowCustomStake: true, maxSpinsPerDay: 2, pointRates: rates };
      const win = store.appendWheelSpin(policy);
      assert.deepEqual([win.stake, win.payout, win.net, win.balance], [3, 6, 3, 23]);
      assert.equal(win.game, 'dice');
      assert.ok(win.total >= 8 && win.total <= 12);
      const publicWin = store.getRecentWheelWins(0, win.createdAt + 6100)[0];
      assert.equal(publicWin.game, 'dice');
      assert.equal(publicWin.choice, 'high');
      assert.equal(publicWin.balance, undefined);
      assert.equal(publicWin.net, undefined);
      assert.equal(store.appendWheelSpin(policy).id, win.id);
      assert.equal(store.getMemberPoints('mem-dice-test', rates), 23);
      assert.throws(() => store.appendWheelSpin({ ...policy, choice: 'low' }), /different game or dice choice/);
      assert.throws(() => store.appendWheelSpin({ ...policy, game: 'wheel' }), /different game or dice choice/);
      assert.throws(() => store.appendWheelSpin({ ...policy, username: 'mem-other' }), /different member/);
      assert.throws(() => store.appendWheelSpin({ ...policy, requestId: crypto.randomUUID() }), /Balance changed/);
      const second = store.appendWheelSpin({ ...policy, game: 'wheel', requestId: crypto.randomUUID(),
        expectedStake: 2, expectedBalance: 23, outcomes: [{ multiplier: 0, weight: 100 }] });
      assert.equal(second.balance, 21);
      assert.equal(store.getDailyWheelStatus('mem-dice-test', 2).spinsRemaining, 0);
      assert.throws(() => store.appendWheelSpin({ ...policy, requestId: crypto.randomUUID(), expectedBalance: 21 }), /daily spin limit/);
      const originalRandom = crypto.randomInt;
      try {
        // Pair index 5 in the LOW pool is [1,6]: exercise actual 7 settlements.
        crypto.randomInt = max => max === 10000 ? 0 : Math.min(5, max - 1);
        for (const choice of ['low', 'high']) {
          const username = `mem-seven-${choice}`;
          store.appendLog({ username, amount: 5, ip: 'fixture', mac: 'fixture' }, rates);
          const spin = store.appendWheelSpin({ ...policy, username, choice, requestId: crypto.randomUUID(),
            expectedStake: 5, expectedBalance: 5,
            dice: { winRate: choice === 'low' ? 100 : 0, loseRate: choice === 'low' ? 0 : 100, payoutMultiplier: 2 } });
          assert.equal(spin.total, 7);
          assert.equal(spin.result, 'low');
          assert.equal(spin.rulesVersion, 2);
          assert.equal(spin.multiplier, choice === 'low' ? 2 : 0);
          assert.equal(spin.balance, choice === 'low' ? 10 : 0);
          assert.equal(store.appendWheelSpin({ ...policy, username, choice, requestId: spin.requestId }).id, spin.id);
        }
      } finally { crypto.randomInt = originalRandom; }
      store.recalcAllPoints([{ pesos: 1, points: 2 }]);
      assert.equal(store.getMemberPoints('mem-dice-test'), 41);
      assert.equal(store.getWheelSpin(win.requestId).net, 3);
      const claim = store.claimWheelNotification();
      assert.equal(claim.spin.game, 'dice');
      assert.equal(store.acknowledgeWheelNotification(claim.spin.requestId, claim.leaseToken), true);
      store.appendLog({ username: 'mem-loss-test', amount: 5, ip: 'loss', mac: 'loss' }, rates);
      const loss = store.appendWheelSpin({ ...policy, username: 'mem-loss-test', requestId: crypto.randomUUID(),
        dice: { winRate: 0, loseRate: 100, payoutMultiplier: 2 }, expectedStake: 5, expectedBalance: 5, allowCustomStake: false });
      assert.deepEqual([loss.stake, loss.payout, loss.net, loss.balance], [5, 0, -5, 0]);
      assert.notEqual(loss.result, 'high');
    } finally {
      if (db) db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('Points API switches games, hides rates, rejects stale/invalid bets, and recovers settled dice after disable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-dice-api-'));
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const launch = () => spawn(process.execPath, ['-e', `
    const dir=process.env.DENFI_TEST_DATA_DIR;
    const s=require('./src/settings-store');s.setAppRole('points');s.setDataDir(dir);
    const logs=require('./src/coin-log-store');logs.setDataDir(dir);
    require('./src/attendance-store').setDataDir(dir);
    require('./src/order-store').setDataDir(dir);
    if (!logs.getMemberPoints('mem-dice-api',[{pesos:1,points:1}]))
      logs.appendLog({username:'mem-dice-api',amount:20,ip:'test',mac:'test'},[{pesos:1,points:1}]);
    s.updateSettings({pointRates:[{pesos:1,points:1}]});
    require('node:crypto').randomInt=max=>max===10000?0:Math.min(5,max-1);
    require('./server');
  `], { cwd: path.join(__dirname, '..'), env: { ...process.env, NODE_ENV: 'test', PORT: String(port),
    DENFI_APP_ROLE: 'points', DENFI_POINTS_SQLITE: '1', DENFI_TEST_DATA_DIR: dir, DENFI_LISTEN_HOST: '127.0.0.1' }, stdio: 'ignore' });
  let child = launch();
  const request = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };
  try {
    for (let attempt = 0; attempt < 80; attempt++) {
      try { if ((await request('/api/sync/wheel-config')).status === 200) break; } catch (_) {}
      if (child.exitCode !== null) throw new Error('Test Points server stopped');
      await delay(100);
    }
    const initial = (await request('/api/sync/wheel/status/mem-dice-api')).data;
    const config = { ...defaultWheel(), game: 'dice', allowCustomStake: true, maxSpinsPerDay: 3,
      dice: { winRate: 100, loseRate: 0, payoutMultiplier: 2 } };
    assert.equal((await request('/api/admin/kiosk-wheel', { ...config, expectedOddsToken: initial.oddsToken })).status, 200);
    const current = (await request('/api/sync/wheel/status/mem-dice-api')).data;
    assert.notEqual(current.oddsToken, oddsToken(config), 'public version tokens cannot expose rates by brute force');
    assert.equal((await request('/api/sync/wheel-config')).data.oddsToken, current.oddsToken);
    assert.equal(current.game, 'dice');
    assert.deepEqual(current.multipliers, [0, 2]);
    assert.deepEqual(current.diceRules.low, [2, 7]);
    assert.deepEqual(current.diceRules.high, [8, 12]);
    assert.equal(current.diceRules.rulesVersion, 2);
    assert.equal(current.diceRules.losingTotal, undefined);
    assert.equal(JSON.stringify(current).includes('winRate'), false);
    assert.equal(JSON.stringify(current).includes('loseRate'), false);
    assert.equal((await request('/api/admin/kiosk-wheel', { ...config, expectedOddsToken: initial.oddsToken })).status, 409);
    assert.equal((await request('/api/admin/kiosk-wheel', { ...config, dice: { ...config.dice, winRate: 99 } })).status, 400);
    const wager = { username: 'mem-dice-api', game: 'dice', choice: 'low', requestId: crypto.randomUUID(),
      expectedStake: 3, expectedBalance: 20, oddsToken: current.oddsToken };
    assert.equal((await request('/api/sync/wheel/spin', { ...wager, game: 'wheel' })).status, 409);
    assert.equal((await request('/api/sync/wheel/spin', { ...wager, choice: 'middle' })).status, 400);
    assert.equal((await request('/api/sync/wheel/spin', { ...wager, oddsToken: initial.oddsToken })).status, 409);
    const [first, retry] = await Promise.all([
      request('/api/sync/wheel/spin', wager), request('/api/sync/wheel/spin', wager)]);
    assert.equal(first.status, 200);
    assert.equal(retry.data.spin.id, first.data.spin.id);
    assert.equal(first.data.spin.balance, 23);
    assert.equal(first.data.spin.result, 'low');
    assert.equal(first.data.spin.total, 7);
    assert.equal(first.data.spin.multiplier, 2);
    assert.equal((await request('/api/sync/wheel/spin', { ...wager, choice: 'high' })).status, 409);
    assert.equal((await request('/api/admin/kiosk-wheel', { ...config, enabled: false })).status, 200);
    assert.equal((await request('/api/sync/wheel/spin', wager)).data.spin.id, first.data.spin.id);
    assert.equal((await request('/api/sync/wheel/spin', { ...wager, requestId: crypto.randomUUID(), expectedBalance: 23 })).status, 403);
    const later = (await request('/api/sync/wheel/status/mem-dice-api')).data;
    assert.equal(later.enabled, false);
    assert.equal(later.balance, 23);
    assert.equal(later.spinsUsed, 1);
    assert.equal((await request('/api/admin/kiosk-wheel', { ...defaultWheel(), maxSpinsPerDay: 3 })).status, 200);
    const switched = (await request('/api/sync/wheel/status/mem-dice-api')).data;
    assert.equal(switched.game, 'wheel');
    assert.equal(switched.spinsUsed, 1);
    assert.equal((await request('/api/sync/wheel/spin', wager)).data.spin.id, first.data.spin.id);
    const stopped = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await stopped;
    child = launch();
    for (let attempt = 0; attempt < 80; attempt++) {
      try { if ((await request('/api/sync/wheel-config')).status === 200) break; } catch (_) {}
      if (child.exitCode !== null) throw new Error('Restarted Points fixture stopped');
      await delay(100);
    }
    const restarted = (await request('/api/sync/wheel/status/mem-dice-api')).data;
    assert.notEqual(restarted.oddsToken, switched.oddsToken, 'a restarted Points process creates a new opaque review token');
    assert.equal(restarted.balance, 23, 'SQLite preserves settled balance across restart');
    assert.equal(restarted.spinsUsed, 1);
    assert.equal((await request('/api/sync/wheel/spin', wager)).data.spin.id, first.data.spin.id,
      'old tokens still recover an already-settled dice request after Points restarts');
  } finally {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill(); await exited;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
