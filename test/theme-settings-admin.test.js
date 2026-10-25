const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup() {
  const element = (value = '') => ({ value, disabled: false, textContent: '', listeners: {}, attributes: {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
    setAttribute(key, value) { this.attributes[key] = value; } });
  const ids = Object.fromEntries(['theme-settings-form', 'admin-session-theme', 'admin-theme-save',
    'admin-theme-reload', 'admin-theme-status', 'admin-theme-selection'].map(id => [id, element()]));
  ids['admin-session-theme'].value = 'default';
  const buttons = ['default', 'halloween'].map(themeValue => Object.assign(element(), { dataset: { themeValue } }));
  let connected = false, published = [], active = { theme: 'default', revision: 'initial' };
  const context = { window: { getDenfiAdminToken: () => 'fixture-admin' }, AbortSignal,
    document: { getElementById: id => ids[id], querySelectorAll: () => buttons },
    fetch: async (_url, options) => {
      if (!connected) return { ok: false, json: async () => ({ success: false, error: 'Denfi Points is disconnected.' }) };
      if (options?.method === 'POST') {
        const body = JSON.parse(options.body); published.push(body);
        active = { theme: body.theme, revision: 'saved' };
      }
      return { ok: true, json: async () => ({ success: true, policy: active }) };
    } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/theme-settings.js'), 'utf8'), context);
  return { ids, buttons, context, published, connect() { connected = true; } };
}

test('disconnected theme choices remain clickable without allowing an unconfirmed save', async () => {
  const f = setup();
  await f.context.window.DenfiThemeAdmin.load();
  assert.ok(f.buttons.every(button => !button.disabled));
  f.buttons[1].listeners.click();
  assert.equal(f.ids['admin-session-theme'].value, 'halloween');
  assert.equal(f.buttons[1].attributes['aria-pressed'], 'true');
  assert.equal(f.buttons[0].attributes['aria-pressed'], 'false');
  assert.match(f.ids['admin-theme-selection'].textContent, /Not published.*Connect Denfi Points/);
  assert.equal(f.ids['admin-theme-save'].disabled, true);
  await f.ids['theme-settings-form'].listeners.submit({ preventDefault() {} });
  assert.equal(f.published.length, 0);
});

test('reconnect preserves the selected choice; verified save publishes it with the server revision', async () => {
  const f = setup();
  await f.context.window.DenfiThemeAdmin.load();
  f.buttons[1].listeners.click();
  f.connect();
  await f.context.window.DenfiThemeAdmin.load();
  assert.equal(f.ids['admin-session-theme'].value, 'halloween', 'reload must not discard the offline choice');
  assert.equal(f.ids['admin-theme-save'].disabled, false);
  await f.ids['theme-settings-form'].listeners.submit({ preventDefault() {} });
  assert.equal(f.published.length, 1);
  assert.equal(f.published[0].theme, 'halloween');
  assert.equal(f.published[0].expectedRevision, 'initial');
  assert.match(f.ids['admin-theme-status'].textContent, /Verified: Halloween is saved/);
  assert.doesNotMatch(f.ids['admin-theme-selection'].textContent, /Not published/);
  f.context.window.DenfiThemeAdmin.reset();
  assert.equal(f.ids['admin-theme-save'].disabled, true);
  assert.equal(f.ids['admin-session-theme'].value, 'default');
  assert.ok(f.buttons.every(button => !button.disabled));
});

test('background confirmation updates the displayed selection without Reload Selection', () => {
  const f = setup();
  const sync = f.context.window.DenfiThemeAdmin.sync;
  sync({ theme: 'halloween', revision: 'from-other-pc' }, true);
  assert.equal(f.ids['admin-session-theme'].value, 'halloween');
  assert.equal(f.buttons[1].attributes['aria-pressed'], 'true');
  assert.match(f.ids['admin-theme-status'].textContent, /updated automatically/);
  assert.equal(f.ids['admin-theme-save'].disabled, false);
  f.buttons[0].listeners.click();
  sync({ theme: 'halloween', revision: 'newer' }, true);
  assert.equal(f.ids['admin-session-theme'].value, 'default', 'an unsaved admin choice stays selected');
  assert.match(f.ids['admin-theme-status'].textContent, /unsaved choice is unchanged/);
  assert.equal(f.published.length, 0, 'automatic refresh never publishes a draft');
  sync({ theme: 'halloween', revision: 'newer' }, false);
  assert.equal(f.ids['admin-theme-save'].disabled, true);
  assert.match(f.ids['admin-theme-status'].textContent, /disconnected/);
  sync({ theme: 'halloween', revision: 'newer' }, true);
  assert.equal(f.ids['admin-theme-save'].disabled, false, 'reconnect needs no manual reload');
});
