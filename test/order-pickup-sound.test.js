'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PickupSound = require('../public/order-pickup-sound');

function environment() {
  let intervals = 0, cleared = 0, tones = 0, stopped = 0;
  const context = {
    state: 'running', currentTime: 0, destination: {},
    createOscillator: () => ({
      frequency: {}, connect() {}, disconnect() {},
      start() { tones++; }, stop() { stopped++; }
    }),
    createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} })
  };
  return {
    AudioContext: function () { return context; },
    setInterval() { intervals++; return intervals; },
    clearInterval() { cleared++; },
    stats: () => ({ intervals, cleared, tones, stopped })
  };
}
test('one reminder loop serves multiple orders; completing one does not silence the other', async () => {
  const env = environment(), sound = new PickupSound(env);
  sound.begin('order-a'); sound.begin('order-b');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.stats().intervals, 1);
  assert.equal(env.stats().tones, 2);
  sound.end('order-a');
  assert.equal(sound.pending.size, 1);
  assert.equal(env.stats().cleared, 0);
  sound.end('order-b');
  assert.equal(sound.pending.size, 0);
  assert.equal(env.stats().cleared, 1);
  assert.equal(sound.timer, null);
});
test('reset, logout and sound disable stop every scheduled beep', async () => {
  const env = environment(), sound = new PickupSound(env);
  sound.begin('order-a');
  await new Promise(resolve => setImmediate(resolve));
  sound.setEnabled(false);
  assert.equal(sound.timer, null);
  assert.equal(sound.pending.size, 1);
  sound.setEnabled(true);
  assert.equal(env.stats().intervals, 2);
  sound.clear();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sound.pending.size, 0);
  assert.equal(sound.timer, null);
  assert.equal(env.stats().cleared, 2);
});
