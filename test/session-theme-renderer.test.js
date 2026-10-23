const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('renderer swaps only the theme stylesheet and preserves the original page', async () => {
  const link = { media: 'not all' }, root = { dataset: {} };
  let interval, resolveFetch;
  const context = {
    document: { getElementById: () => link, documentElement: root },
    window: {}, AbortSignal,
    fetch: () => new Promise(resolve => { resolveFetch = resolve; }),
    setInterval: fn => { interval = fn; },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/session-theme.js'), 'utf8'), context);
  context.window.DenfiSessionTheme.apply('halloween');
  assert.equal(link.media, 'all');
  assert.equal(root.dataset.sessionTheme, 'halloween');
  resolveFetch({ ok: true, json: async () => ({ success: true, policy: { theme: 'default' } }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(link.media, 'all', 'late bootstrap response must not undo a newer WS theme');
  context.window.DenfiSessionTheme.apply('invalid');
  assert.equal(link.media, 'all');
  context.window.DenfiSessionTheme.apply('default');
  assert.equal(link.media, 'not all', 'Default disables every Halloween override and animation');
  const loaded = interval();
  resolveFetch({ ok: true, json: async () => ({ success: true, policy: { theme: 'halloween' } }) });
  await loaded;
  assert.equal(link.media, 'all', 'polling rehydrates a missed WS update');
});
