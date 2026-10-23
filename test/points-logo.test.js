const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initPointsLogo } = require('../public/points-logo');

function fixture(loaded = true) {
  let onMutation;
  const previous = global.MutationObserver;
  global.MutationObserver = class {
    constructor(callback) { onMutation = callback; }
    observe() {}
    disconnect() {}
  };
  let active = true;
  const attrs = {};
  const button = { inert:false, disabled:true };
  const zone = {
    classList:{ contains:() => active },
    querySelector:() => button,
    setAttribute:(key, value) => { attrs[key] = value; },
    removeAttribute:key => { delete attrs[key]; }
  };
  const events = {};
  const image = { complete:loaded, naturalWidth:loaded ? 256 : 0, addEventListener:(key, callback) => { events[key] = callback; } };
  const timers = new Map();
  let id = 0;
  const destroy = initPointsLogo(zone, image, (fn, ms) => {
    assert.equal(ms, 5000);
    timers.set(++id, fn);
    return id;
  }, key => timers.delete(key));
  global.MutationObserver = previous;
  return {
    button, attrs, timers, image, events, destroy,
    mutate() { onMutation(); },
    active(value) { active = value; onMutation(); },
    tick() { assert.equal(timers.size, 1); const [key, fn] = timers.entries().next().value; timers.delete(key); fn(); }
  };
}

test('balance and logo alternate every five seconds without changing button policy', () => {
  const f = fixture();
  assert.equal(f.attrs['data-logo-phase'], undefined);
  f.tick();
  assert.equal(f.attrs['data-logo-phase'], 'logo');
  assert.equal(f.button.inert, true);
  assert.equal(f.button.disabled, true);
  f.mutate();
  assert.equal(f.attrs['data-logo-phase'], 'logo', 'status updates do not restart the cycle');
  assert.equal(f.timers.size, 1);
  f.tick();
  assert.equal(f.attrs['data-logo-phase'], undefined);
  assert.equal(f.button.inert, false);
  f.destroy();
  assert.equal(f.timers.size, 0);
});

test('logout stops and resets the cycle; a new active session starts with its balance', () => {
  const f = fixture();
  f.tick();
  f.active(false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.attrs['data-logo-phase'], undefined);
  assert.equal(f.button.inert, false);
  f.active(true);
  assert.equal(f.timers.size, 1);
  assert.equal(f.attrs['data-logo-phase'], undefined);
  f.destroy();
});

test('missing logo never hides balance; load starts the cycle and errors restore it', () => {
  const f = fixture(false);
  assert.equal(f.timers.size, 0);
  f.image.naturalWidth = 256;
  f.events.load();
  f.tick();
  assert.equal(f.attrs['data-logo-phase'], 'logo');
  f.events.error();
  assert.equal(f.timers.size, 0);
  assert.equal(f.attrs['data-logo-phase'], undefined);
  assert.equal(f.button.inert, false);
  f.destroy();
});

test('logo is the supplied asset and stays isolated from overlay sizing', () => {
  const root = path.join(__dirname, '..');
  assert.deepEqual(fs.readFileSync(path.join(root, 'assets/icon.png')), fs.readFileSync(path.join(root, 'public/icon.png')));
  const css = fs.readFileSync(path.join(root, 'public/points-logo.css'), 'utf8');
  assert.match(css, /position: absolute/);
  assert.match(css, /points-logo-sway 5s ease-in-out infinite/);
  assert.match(css, /rotateY\(-8deg\)/);
  assert.match(css, /rotateY\(8deg\)/);
  assert.doesNotMatch(css, /translateX|rotateZ/);
  assert.doesNotMatch(css, /display:\s*none/);
  const session = fs.readFileSync(path.join(root, 'public/session.html'), 'utf8');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(session, /href="\/points-logo\.css"/);
  assert.ok(config.build.files.includes('public/**/*'), 'Windows build includes the same animation');
});

test('light sweep is masked to the logo, follows its tilt, and cannot block controls', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/points-logo.css'), 'utf8');
  assert.match(css, /mask: url\("\/icon\.png"\) center \/ contain no-repeat/);
  assert.match(css, /\.points-logo::after\s*\{[^}]*pointer-events: none/s);
  assert.match(css, /animation: points-logo-sway 5s ease-in-out infinite,\s*points-logo-light-sweep 5s ease-in-out infinite/);
  assert.match(css, /@keyframes points-logo-light-sweep/);
  assert.match(css, /background-position: -150% 0; opacity: 0/);
});
