'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  duration, formatAnnouncement, identity, spokenName, KioskVoiceCoordinator
} = require('../src/voice-announcements');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function harness(options = {}) {
  let clock = options.startTime ?? 1700000000000;
  const generated = [];
  const played = [];
  const logs = [];
  const coordinator = new KioskVoiceCoordinator({
    generate: async text => {
      generated.push(text);
      return `wav:${text}`;
    },
    play: async wav => { played.push(wav); },
    now: () => clock,
    log: message => logs.push(message),
    ...options
  });
  return {
    coordinator, generated, played, logs,
    now: () => clock,
    advance: ms => { clock += ms; }
  };
}

async function idle(coordinator) {
  for (let i = 0; i < 100 && coordinator.draining; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(coordinator.draining, false, 'announcement queue should become idle');
}

function active(coordinator, username = 'mem-alice') {
  coordinator.observeStatus({ isLogin: true, username, sessionTimeLeft: 300 });
}

function win(id, username = 'mem-bob', extra = {}) {
  return { id, username, multiplier: 2, createdAt: 1700000000000, ...extra };
}

function reveal(coordinator, {
  username = 'mem-alice', requestId = 'request-1', spinId = 'spin-1',
  multiplier = 0, net = -10, balance = 90
} = {}) {
  return coordinator.bettingState({
    phase: 'revealed', username, requestId, spinId, multiplier, net, balance
  });
}

test('name normalization, duration formatting, and all announcement types', () => {
  assert.equal(identity('  MEM-Alice.Jones  '), 'mem-alice.jones');
  assert.equal(spokenName('MEM-Alice.Jones'), 'alice jones');
  assert.equal(duration(3661), '1 hour and 1 minute and 1 second');
  assert.equal(duration(120), '2 minutes');
  assert.equal(duration(0), '');
  assert.equal(duration(Infinity), '');

  assert.equal(formatAnnouncement({ type: 'welcome', username: 'mem-alice' }),
    'Hi alice, welcome to Den Pie Computer Shop.');
  assert.equal(formatAnnouncement({ type: 'logout', username: 'mem-alice' }),
    'alice, you are now logged out. Thank you for visiting Den Pie Computer Shop.');
  assert.equal(formatAnnouncement({
    type: 'extended', station: 'Computer 004', secondsAdded: 3661
  }), 'PC 4, your time has been extended by 1 hour and 1 minute and 1 second.');
  assert.equal(formatAnnouncement({
    type: 'extended', station: '<script>PC 3</script>', secondsAdded: 0
  }), 'Your time has been extended.');
  assert.equal(formatAnnouncement({ type: 'win', username: 'mem-alice', multiplier: 5 }),
    'alice, you won with a 5 times multiplier. Congratulations!');
  assert.equal(formatAnnouncement({
    type: 'loss', username: 'mem-alice', balance: 12.345
  }), 'alice, you lost this round. Your balance is now 12.35 Points.');
  assert.equal(formatAnnouncement({
    type: 'even', username: 'mem-alice', multiplier: 1
  }), 'alice, this round ended with a 1 times multiplier.');
});

test('public wins never speak or leak financial values supplied as extra properties', () => {
  const financialSecrets = ['987654321', '999999', '123456', '-77', 'SECRET'];
  const message = formatAnnouncement({
    type: 'win', username: 'mem-alice', multiplier: 8,
    balance: financialSecrets[0], stake: financialSecrets[1],
    payout: financialSecrets[2], net: financialSecrets[3], Points: financialSecrets[4]
  });
  for (const secret of financialSecrets) assert.equal(message.includes(secret), false);
  assert.doesNotMatch(message, /balance|stake|payout|net|points/i);
});

test('startup/status observations and startup welcome/logout events do not cause speech', async () => {
  const h = harness();
  h.coordinator.observeStatus({ isLogin: true, username: 'mem-alice', sessionTimeLeft: 300 });
  h.coordinator.observeStatus({ isLogin: true, username: 'mem-alice', sessionTimeLeft: 299 });
  h.coordinator.observeStatus({ isLogin: false, sessionTimeLeft: 0 });
  await idle(h.coordinator);
  assert.deepEqual(h.generated, []);
  assert.deepEqual(h.played, []);
});

test('session announcements are gated to the logged-in member and status updates are silent', async () => {
  const h = harness();
  const event = (id, type, username) => ({
    id, type, username, expiresAt: h.now() + 30000, secondsAdded: 60, station: 'PC 02'
  });
  assert.equal(h.coordinator.sessionEvent(event('before-login', 'welcome', 'mem-alice')), false);
  active(h.coordinator);
  assert.equal(h.coordinator.sessionEvent(event('other-welcome', 'welcome', 'mem-bob')), false);
  assert.equal(h.coordinator.sessionEvent(event('alice-welcome', 'welcome', 'mem-alice')), true);
  await idle(h.coordinator);
  h.coordinator.observeStatus({ isLogin: true, username: 'mem-alice', sessionTimeLeft: 299 });
  assert.equal(h.coordinator.sessionEvent(event('alice-extension', 'extended', 'mem-alice')), true);
  await idle(h.coordinator);
  assert.equal(h.coordinator.sessionEvent(event('alice-logout', 'logout', 'mem-alice')), true);
  h.coordinator.observeStatus({ isLogin: false, sessionTimeLeft: 0 });
  assert.equal(h.coordinator.sessionEvent(event('late-welcome', 'welcome', 'mem-alice')), false);
  await idle(h.coordinator);
  assert.deepEqual(h.generated, [
    'Hi alice, welcome to Den Pie Computer Shop.',
    'PC 2, your time has been extended by 1 minute.',
    'alice, you are now logged out. Thank you for visiting Den Pie Computer Shop.'
  ]);
});

test('public wins are spoken on every PC, including locked kiosks', async () => {
  const pcs = [harness(), harness(), harness()];
  active(pcs[0].coordinator, 'mem-alice');
  active(pcs[1].coordinator, 'mem-charlie');
  // The third coordinator has observed a locked/logged-out kiosk.
  pcs[2].coordinator.observeStatus({ isLogin: false, sessionTimeLeft: 0 });
  for (const pc of pcs) {
    assert.equal(pc.coordinator.publicWin(win('global-win', 'mem-bob')), true);
  }
  await Promise.all(pcs.map(pc => idle(pc.coordinator)));
  for (const pc of pcs) {
    assert.equal(pc.generated.length, 1);
    assert.match(pc.generated[0], /bob, you won/);
    assert.equal(pc.played.length, 1);
  }
});

test('a burst of more than 24 public wins remains queued and is spoken in order', async () => {
  const h = harness();
  active(h.coordinator);
  for (let i = 0; i < 40; i++) {
    assert.equal(h.coordinator.publicWin(win(`burst-${i}`, `mem-winner-${i}`)), true);
  }
  await idle(h.coordinator);
  assert.equal(h.generated.length, 40);
  assert.equal(h.played.length, 40);
  assert.match(h.generated[0], /winner 0, you won/);
  assert.match(h.generated.at(-1), /winner 39, you won/);
});

test('replay history is ignored while live public wins are accepted', async () => {
  const h = harness();
  assert.equal(h.coordinator.publicWin(win('history-win'), { replay: true }), false);
  assert.equal(h.coordinator.publicWin(win('live-win'), { replay: false }), true);
  await idle(h.coordinator);
  assert.equal(h.generated.length, 1);
});

test('duplicate event identities are suppressed in memory and after coordinator restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-dedupe-'));
  const seenFile = path.join(dir, 'seen.json');
  try {
    const first = harness({ seenFile });
    const event = {
      id: 'stable-event', type: 'welcome', username: 'mem-alice',
      expiresAt: first.now() + 30000
    };
    active(first.coordinator);
    assert.equal(first.coordinator.sessionEvent(event), true);
    assert.equal(first.coordinator.sessionEvent(event), false);
    await idle(first.coordinator);

    const restarted = harness({ seenFile });
    active(restarted.coordinator);
    assert.equal(restarted.coordinator.sessionEvent({
      ...event, expiresAt: restarted.now() + 30000
    }), false);
    assert.equal(restarted.coordinator.publicWin(win('stable-win')), true);
    assert.equal(restarted.coordinator.publicWin(win('stable-win')), false);
    await idle(restarted.coordinator);

    const third = harness({ seenFile });
    assert.equal(third.coordinator.publicWin(win('stable-win')), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(seenFile, 'utf8')).map(entry => entry[0]).sort(),
      ['stable-event', 'win:stable-win']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('async synthesis and playback are strictly serial with no overlapping events', async () => {
  const firstGeneration = deferred();
  const firstPlayback = deferred();
  const started = [];
  const h = harness({
    generate: text => {
      started.push(`generate:${text}`);
      if (started.filter(item => item.startsWith('generate:')).length === 1) return firstGeneration.promise;
      return Promise.resolve(`wav:${text}`);
    },
    play: wav => {
      started.push(`play:${wav}`);
      if (started.filter(item => item.startsWith('play:')).length === 1) return firstPlayback.promise;
      return Promise.resolve();
    }
  });
  active(h.coordinator);
  h.coordinator.sessionEvent({
    id: 'serial-1', type: 'welcome', username: 'mem-alice', expiresAt: h.now() + 30000
  });
  h.coordinator.sessionEvent({
    id: 'serial-2', type: 'extended', username: 'mem-alice', station: 'PC 1',
    secondsAdded: 60, expiresAt: h.now() + 30000
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started.filter(item => item.startsWith('generate:')).length, 1);
  firstGeneration.resolve('wav:first');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started.filter(item => item.startsWith('play:')).length, 1);
  assert.equal(started.filter(item => item.startsWith('generate:')).length, 1,
    'second synthesis waits for first playback to finish');
  firstPlayback.resolve();
  await idle(h.coordinator);
  assert.equal(started.filter(item => item.startsWith('generate:')).length, 2);
  assert.equal(started.filter(item => item.startsWith('play:')).length, 2);
});

test('own win is held until its matching spin reveal; initial own state unknown is also held', async () => {
  const h = harness();
  active(h.coordinator);
  assert.equal(h.coordinator.publicWin(win('initial-unknown', 'mem-alice')), true);
  await idle(h.coordinator);
  assert.equal(h.generated.length, 0);

  assert.equal(h.coordinator.bettingState({
    phase: 'state', username: 'mem-alice'
  }), true);
  await idle(h.coordinator);
  assert.equal(h.generated.length, 1, 'an initial win is released once renderer state is known and idle');
  assert.equal(h.coordinator.bettingState({
    phase: 'state', username: 'mem-alice', requestId: 'request-1'
  }), true);
  assert.equal(h.coordinator.publicWin(win('spin-1', 'mem-alice')), true);
  await idle(h.coordinator);
  assert.equal(h.generated.length, 1, 'the in-flight spin win remains held before reveal');
  assert.equal(reveal(h.coordinator, { multiplier: 2, net: 10 }), true);
  await idle(h.coordinator);
  assert.equal(h.generated.length, 2, 'the win matching the active spin releases after confirmation');
  assert.ok(h.generated.every(text => text.includes('you won')));
});

test('a previously revealed own spin is not held by the next pending spin', async () => {
  const h = harness();
  active(h.coordinator);
  h.coordinator.bettingState({ phase: 'state', username: 'mem-alice', requestId: 'request-1' });
  assert.equal(reveal(h.coordinator, { spinId: 'spin-1' }), true);
  await idle(h.coordinator);
  h.coordinator.bettingState({ phase: 'state', username: 'mem-alice', requestId: 'request-2' });
  assert.equal(h.coordinator.publicWin(win('spin-1', 'mem-alice')), true);
  await idle(h.coordinator);
  assert.equal(h.generated.filter(text => text.includes('you won')).length, 1);
});

test('confirmed losses and even results are distinguished, including a 1x outcome', async () => {
  const h = harness();
  active(h.coordinator);
  h.coordinator.bettingState({ phase: 'state', username: 'mem-alice', requestId: 'loss-request' });
  assert.equal(reveal(h.coordinator, {
    requestId: 'loss-request', spinId: 'loss-spin', multiplier: 0, net: -10, balance: 90
  }), true);
  h.coordinator.bettingState({ phase: 'state', username: 'mem-alice', requestId: 'even-request' });
  assert.equal(reveal(h.coordinator, {
    requestId: 'even-request', spinId: 'even-spin', multiplier: 1, net: 0, balance: 90
  }), true);
  await idle(h.coordinator);
  assert.equal(h.generated.length, 2);
  assert.match(h.generated[0], /lost this round/);
  assert.match(h.generated[1], /round ended with a 1 times multiplier/);
});

test('unconfirmed spins, mismatched requests, and inconsistent results are never announced', async () => {
  const h = harness();
  active(h.coordinator);
  h.coordinator.bettingState({ phase: 'state', username: 'mem-alice', requestId: 'expected' });
  assert.equal(reveal(h.coordinator, { requestId: 'different' }), false);
  assert.equal(reveal(h.coordinator, { requestId: 'expected', multiplier: 4, net: -1 }), false);
  assert.equal(reveal(h.coordinator, { requestId: 'expected', multiplier: 0, net: 1 }), false);
  assert.equal(reveal(h.coordinator, { requestId: 'expected', multiplier: 1, net: 2 }), false);
  assert.equal(h.coordinator.pendingSpin.requestId, 'expected',
    'invalid or mismatched responses cannot confirm/clear a spin');
  await idle(h.coordinator);
  assert.deepEqual(h.generated, []);
});

test('revealing the same spin more than once is idempotently rejected', async () => {
  const h = harness();
  active(h.coordinator);
  h.coordinator.bettingState({ phase: 'state', username: 'mem-alice', requestId: 'one' });
  assert.equal(reveal(h.coordinator, { requestId: 'one', spinId: 'same-spin' }), true);
  assert.equal(reveal(h.coordinator, { requestId: 'one', spinId: 'same-spin' }), false);
  await idle(h.coordinator);
  assert.equal(h.generated.length, 1);
});

test('stale private losses are dropped after the session changes and never broadcast', async () => {
  const firstGeneration = deferred();
  const h = harness({
    generate: text => {
      h.generated.push(text);
      return h.generated.length === 1 ? firstGeneration.promise : Promise.resolve(`wav:${text}`);
    }
  });
  active(h.coordinator);
  h.coordinator.publicWin(win('blocking-win', 'mem-bob'));
  h.coordinator.bettingState({ phase: 'state', username: 'mem-alice', requestId: 'loss-request' });
  assert.equal(reveal(h.coordinator, {
    requestId: 'loss-request', spinId: 'private-loss', multiplier: 0, net: -1, balance: 9
  }), true);
  h.coordinator.observeStatus({ isLogin: true, username: 'mem-bob', sessionTimeLeft: 200 });
  firstGeneration.resolve('first-wav');
  await idle(h.coordinator);
  assert.deepEqual(h.generated, ['bob, you won with a 2 times multiplier. Congratulations!']);
  assert.deepEqual(h.played, ['first-wav']);
});

test('events expired before synthesis and while synthesis is blocked are not played', async () => {
  const gate = deferred();
  const h = harness({ generate: async text => {
    h.generated.push(text);
    if (h.generated.length === 1) return gate.promise;
    return `wav:${text}`;
  } });
  active(h.coordinator);
  h.coordinator.sessionEvent({
    id: 'slow', type: 'welcome', username: 'mem-alice', expiresAt: h.now() + 1000
  });
  h.coordinator.sessionEvent({
    id: 'expire-in-queue', type: 'extended', username: 'mem-alice', station: 'PC 1',
    secondsAdded: 60, expiresAt: h.now() + 500
  });
  await new Promise(resolve => setImmediate(resolve));
  h.advance(1001);
  gate.resolve('slow-wav');
  await idle(h.coordinator);
  assert.deepEqual(h.played, []);
  assert.deepEqual(h.generated, ['Hi alice, welcome to Den Pie Computer Shop.'],
    'an expired queued event is discarded before synthesis');
});

test('queue overflow rejects new work without interrupting active synthesis', async () => {
  const gate = deferred();
  const h = harness({
    maxQueue: 1,
    generate: text => {
      h.generated.push(text);
      return h.generated.length === 1 ? gate.promise : Promise.resolve(`wav:${text}`);
    }
  });
  active(h.coordinator);
  const sessionEvent = id => ({
    id, type: 'welcome', username: 'mem-alice', expiresAt: h.now() + 30000
  });
  assert.equal(h.coordinator.sessionEvent(sessionEvent('queue-1')), true);
  assert.equal(h.coordinator.sessionEvent(sessionEvent('queue-2')), true);
  assert.equal(h.coordinator.sessionEvent(sessionEvent('queue-3')), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.generated.length, 1);
  gate.resolve('first-wav');
  await idle(h.coordinator);
  assert.equal(h.generated.length, 2);
  assert.equal(h.played.length, 2);
});

test('synthesis has one bounded retry, while playback failures are never retried', async () => {
  let generationCalls = 0;
  let playbackCalls = 0;
  const h = harness({
    generate: async () => {
      generationCalls++;
      if (generationCalls === 1) throw new Error('temporary synthesis error');
      return 'synthesized-wav';
    },
    play: async () => {
      playbackCalls++;
      throw new Error('audio failed');
    }
  });
  active(h.coordinator);
  h.coordinator.sessionEvent({
    id: 'retry-event', type: 'welcome', username: 'mem-alice', expiresAt: h.now() + 30000
  });
  await idle(h.coordinator);
  assert.equal(generationCalls, 2, 'generation is attempted at most twice');
  assert.equal(playbackCalls, 1, 'playback is attempted at most once');
  assert.equal(h.logs.filter(message => /retrying once/.test(message)).length, 1);

  let failures = 0;
  const failed = harness({
    generate: async () => { failures++; throw new Error('persistent synthesis error'); }
  });
  active(failed.coordinator);
  failed.coordinator.sessionEvent({
    id: 'failed-event', type: 'welcome', username: 'mem-alice', expiresAt: failed.now() + 30000
  });
  await idle(failed.coordinator);
  assert.equal(failures, 2);
  assert.equal(failed.played.length, 0);
});

test('close cancels queued work and prevents active synthesis from reaching playback', async () => {
  const gate = deferred();
  const h = harness({ generate: async text => {
    h.generated.push(text);
    return gate.promise;
  } });
  active(h.coordinator);
  h.coordinator.sessionEvent({
    id: 'closing-first', type: 'welcome', username: 'mem-alice', expiresAt: h.now() + 30000
  });
  h.coordinator.sessionEvent({
    id: 'closing-queued', type: 'extended', username: 'mem-alice', station: 'PC 1',
    secondsAdded: 60, expiresAt: h.now() + 30000
  });
  await new Promise(resolve => setImmediate(resolve));
  h.coordinator.close();
  gate.resolve('late-wav');
  await idle(h.coordinator);
  assert.equal(h.generated.length, 1);
  assert.deepEqual(h.played, []);
  assert.equal(h.coordinator.sessionEvent({
    id: 'after-close', type: 'welcome', username: 'mem-alice', expiresAt: h.now() + 30000
  }), false);
});

test('malicious and malformed event fields are rejected or safely sanitized', async () => {
  const h = harness();
  active(h.coordinator);
  for (const bad of [
    null,
    { id: '', type: 'welcome', username: 'mem-alice', expiresAt: h.now() + 30000 },
    { id: 'bad-user', type: 'welcome', username: '<img src=x>', expiresAt: h.now() + 30000 },
    { id: 'bad-multiplier', type: 'win', username: 'mem-bob', multiplier: Infinity, expiresAt: h.now() + 30000 },
    { id: 'bad-loss', type: 'loss', username: 'mem-alice', balance: -5, expiresAt: h.now() + 30000 },
    { id: 'expired', type: 'welcome', username: 'mem-alice', expiresAt: h.now() },
    { id: 'infinite-expiry', type: 'welcome', username: 'mem-alice', expiresAt: Infinity }
  ]) {
    assert.equal(h.coordinator.sessionEvent(bad), false);
  }
  assert.equal(h.coordinator.publicWin(win('bad-created-at', 'mem-bob', { createdAt: NaN })), false);
  assert.equal(h.coordinator.publicWin(win('bad-public-name', '<script>')), false);
  assert.throws(() => formatAnnouncement({ type: 'unknown', username: 'mem-a' }), /Unknown/);
  assert.throws(() => formatAnnouncement({ type: 'win', username: 'mem-a', multiplier: 1 }), /multiplier/);
  await idle(h.coordinator);
  assert.deepEqual(h.generated, []);
});