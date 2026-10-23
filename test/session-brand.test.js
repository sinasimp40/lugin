const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startSessionBrandRotation } = require('../public/session-brand');

function harness({ complete = true, naturalWidth = 256 } = {}) {
  const jobs = new Map();
  const listeners = new Map();
  let id = 0;
  const zone = { dataset: {} };
  const image = {
    complete, naturalWidth,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name)
  };
  const clock = {
    setInterval(fn, delay) {
      assert.equal(delay, 3000);
      jobs.set(++id, fn);
      return id;
    },
    clearInterval: id => jobs.delete(id)
  };
  const dispose = startSessionBrandRotation(zone, image, clock);
  return { zone, image, listeners, jobs, dispose, tick: () => [...jobs.values()].forEach(fn => fn()) };
}

test('cached logo rotates every three seconds repeatedly without relying on CSS animation', () => {
  const h = harness();
  assert.equal(h.zone.dataset.brandFace, 'balance');
  for (let i = 0; i < 20; i++) {
    h.tick();
    assert.equal(h.zone.dataset.brandFace, i % 2 ? 'balance' : 'logo');
  }
});

test('uncached logo starts after load; repeated loads never create duplicate timers', () => {
  const h = harness({ complete: false });
  assert.equal(h.jobs.size, 0);
  h.listeners.get('load')();
  h.listeners.get('load')();
  assert.equal(h.jobs.size, 1);
  h.tick();
  assert.equal(h.zone.dataset.brandFace, 'logo');
});

test('broken logo preserves balance, including an error after rotation has started', () => {
  const broken = harness({ naturalWidth: 0 });
  assert.equal(broken.jobs.size, 0);
  assert.equal(broken.zone.dataset.brandFace, 'balance');
  const h = harness();
  h.tick();
  h.listeners.get('error')();
  assert.equal(h.jobs.size, 0);
  assert.equal(h.zone.dataset.brandFace, 'balance');
});

test('cleanup removes the timer and image handlers', () => {
  const h = harness();
  h.dispose();
  assert.equal(h.jobs.size, 0);
  assert.equal(h.listeners.size, 0);
});

test('reduced motion and control focus do not disable content rotation', () => {
  const html = fs.readFileSync(require.resolve('../public/session.html'), 'utf8');
  const styles = html.slice(html.indexOf('.points-brand-stage'), html.indexOf('  .main-section {', html.indexOf('.points-brand-stage')));
  assert.match(styles, /prefers-reduced-motion:reduce/);
  assert.match(styles, /data-brand-face="logo"/);
  assert.doesNotMatch(styles, /:hover|:focus-within/);
  assert.doesNotMatch(html, /brand-ready/);
  assert.match(html, /<script src="session-brand\.js"><\/script>/);
});
