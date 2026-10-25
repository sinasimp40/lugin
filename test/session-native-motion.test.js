const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('only the native session renderer explicitly enables its requested effects', () => {
  const html = read('public/session.html');
  const script = html.match(/<script>([\s\S]*?dataset\.sessionMotion[\s\S]*?)<\/script>/)[1];
  const browserRoot = { dataset: {} };
  vm.runInNewContext(script, { window: {}, document: { documentElement: browserRoot } });
  assert.equal(browserRoot.dataset.sessionMotion, undefined);
  const desktopRoot = { dataset: {} };
  vm.runInNewContext(script, { window: { electronAPI: {} }, document: { documentElement: desktopRoot } });
  assert.equal(desktopRoot.dataset.sessionMotion, 'full');
  assert.doesNotMatch(read('public/index.html'), /dataset\.sessionMotion/);
});

test('reduced motion cannot silently disable native ghost and light sweep', () => {
  for (const file of ['public/themes/halloween.css', 'public/points-logo.css']) {
    const css = read(file);
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    const selectors = reduced.match(/[^{}]+(?=\{[^{}]*animation: none)/g);
    assert.ok(selectors?.length, `${file} retains browser reduced-motion support`);
    for (const selector of selectors) {
      assert.match(selector, /html:not\(\[data-session-motion="full"\]\)/);
    }
  }
  const desktop = read('main.js');
  const widget = desktop.slice(desktop.indexOf('function showSessionWindow('));
  assert.match(widget, /backgroundThrottling: false/);
  assert.match(widget, /preload: require\('path'\)\.join\(__dirname, 'preload.js'\)/);
  const config = JSON.parse(read('package.json'));
  assert.ok(config.build.files.includes('public/**/*'));
  assert.ok(config.build.files.includes('preload.js'));
});
