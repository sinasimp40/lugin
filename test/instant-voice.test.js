'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { InstantVoice, CUES, speechParts } = require('../src/instant-voice');
const { KioskVoiceCoordinator } = require('../src/voice-announcements');

const cueDir = path.resolve(__dirname, '../assets/voice-cues');
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('all bundled cues match their Heart 1x manifest and WAV checksums', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(cueDir, 'manifest.json')));
  assert.equal(manifest.voice, 'af_heart');
  assert.equal(manifest.speed, 1);
  for (const [type, text] of Object.entries(CUES)) {
    const wav = fs.readFileSync(path.join(cueDir, `${type}.wav`));
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(manifest.entries[type].text, text);
    assert.equal(manifest.entries[type].sha256, crypto.createHash('sha256').update(wav).digest('hex'));
  }
});

test('instant lead-in starts while personal speech is still generating; no overlapping clips', async () => {
  const generation = deferred(), playback = deferred(), started = deferred();
  const played = [];
  const instant = new InstantVoice({
    cueDir, generate: () => generation.promise,
    play: async wav => {
      played.push(wav);
      if (played.length === 1) { started.resolve(); await playback.promise; }
    }
  });
  const body = Buffer.from('prepared-personal-speech');
  const job = instant.announce({ type: 'welcome', username: 'mem-alice' }, () => true);
  await started.promise;
  assert.equal(played.length, 1, 'speech starts before model generation completes');
  generation.resolve(body);
  await tick();
  assert.equal(played.length, 1, 'body must wait for opening playback to finish');
  playback.resolve();
  await job;
  assert.equal(played[1], body);
  instant.close();
});

test('preparation is silent and deduplicated, with no stale personal tail after logout', async () => {
  const generation = deferred(), opening = deferred(), started = deferred();
  let active = true, generated = 0;
  const played = [];
  const instant = new InstantVoice({
    cueDir, generate: () => { generated++; return generation.promise; },
    play: async wav => { played.push(wav); started.resolve(); await opening.promise; }
  });
  const event = { type: 'loss', username: 'mem-alice', balance: 75 };
  assert.equal(instant.prepare(event), instant.prepare(event));
  await tick();
  assert.equal(generated, 1);
  assert.equal(played.length, 0);
  const job = instant.announce(event, () => active);
  await started.promise;
  active = false;
  opening.resolve();
  generation.resolve(Buffer.from('must-not-play'));
  await job;
  assert.equal(played.length, 1);
  instant.close();
});

test('public prepared speech excludes financial details and preserves DEN PIE branding', () => {
  const parts = speechParts({ type: 'win', username: 'mem-alice', multiplier: 5,
    balance: 987654, payout: 555555, stake: 333333 });
  assert.equal(parts.body, 'alice, you won with a 5 times multiplier.');
  assert.doesNotMatch(parts.body + CUES.win, /balance|points|987654|555555|333333/i);
  assert.match(CUES.welcome, /Den Pie/);
});

test('interrupting a stale detail generation releases the voice queue without waiting for the model', async () => {
  const generation = deferred(), started = deferred();
  let completed = false;
  const instant = new InstantVoice({
    cueDir, generate: () => generation.promise,
    play: async () => { started.resolve(); }
  });
  const job = instant.announce({ type: 'welcome', username: 'mem-alice' }, () => true)
    .then(() => { completed = true; });
  await started.promise;
  await tick();
  assert.equal(completed, false);
  instant.interrupt();
  await job;
  assert.equal(completed, true, 'logout must not wait on obsolete personal synthesis');
  generation.resolve(Buffer.from('late-details'));
  instant.close();
});

test('bet result preparation cannot play a result or clear the pending reveal', async () => {
  const prepared = [], played = [];
  const coordinator = new KioskVoiceCoordinator({
    generate: async text => text, play: async wav => played.push(wav),
    prepare: event => prepared.push(event), log: () => {}
  });
  coordinator.observeStatus({ isLogin: true, username: 'mem-alice', sessionTimeLeft: 300 });
  coordinator.bettingState({ phase: 'begin', username: 'mem-alice', requestId: 'request-1' });
  const result = { phase: 'prepare', username: 'mem-alice', requestId: 'request-1',
    spinId: 'spin-1', multiplier: 0, net: -25, balance: 75 };
  assert.equal(coordinator.bettingState(result), true);
  assert.equal(coordinator.pendingSpin.requestId, 'request-1');
  await tick();
  assert.equal(played.length, 0);
  assert.equal(prepared.at(-1).type, 'loss');
  assert.equal(coordinator.bettingState({ ...result, requestId: 'different' }), false);
  assert.equal(coordinator.bettingState({ ...result, username: 'mem-bob' }), false);
  assert.equal(coordinator.bettingState({ ...result, phase: 'revealed' }), true);
  await tick();
  assert.equal(played.length, 1);
  coordinator.close();
});

test('same member logging out and back in cannot revive a stale private announcement', async () => {
  const blocked = deferred(), played = [];
  let interrupted = 0;
  const coordinator = new KioskVoiceCoordinator({
    generate: () => blocked.promise, play: async wav => played.push(wav),
    interrupt: () => { interrupted++; }, log: () => {}
  });
  coordinator.observeStatus({ isLogin: true, username: 'mem-alice', sessionTimeLeft: 300 });
  coordinator.sessionEvent({ id: 'old-welcome', type: 'welcome', username: 'mem-alice', expiresAt: Date.now() + 30000 });
  await tick();
  coordinator.observeStatus({ isLogin: false, sessionTimeLeft: 0 });
  coordinator.observeStatus({ isLogin: true, username: 'mem-alice', sessionTimeLeft: 300 });
  blocked.resolve('stale-audio');
  await tick();
  assert.equal(interrupted, 2);
  assert.deepEqual(played, []);
  coordinator.close();
});