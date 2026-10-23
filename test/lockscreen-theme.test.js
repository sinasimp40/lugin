const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('lock screen subscribes to the same confirmed theme without changing login or timer handlers', () => {
  const html = read('public/index.html');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /id="session-halloween-theme"[^>]*href="\/themes\/halloween-lockscreen\.css"[^>]*media="not all"/);
  assert.match(head, /<script src="\/session-theme\.js"><\/script>/);
  assert.match(html, /function applySettings\(s\) \{\s*appSettings = s;\s*if \(window\.DenfiSessionTheme\) window\.DenfiSessionTheme\.apply\(s\.sessionTheme\);/);
  assert.match(html, /applyThemeColors\(s\.loginColor, s\.registerColor\)/);
  assert.match(html, /updateCurfewUI\(s\)/);
  assert.match(html, /setIdleShutdownConfig\(s\.autoShutdownSeconds \|\| 0\)/);
  for (const id of ['username', 'password', 'reg-username', 'reg-password', 'curfew-start-display',
    'curfew-end-display', 'shutdown-timer', 'curfew-shutdown-timer']) {
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id);
  }
});

test('both Windows packaging configurations include the shared client and all local theme files', () => {
  const auto = JSON.parse(read('package.json')).build;
  const points = JSON.parse(read('electron-builder-points.json'));
  for (const config of [auto, points]) {
    assert.ok(config.files.includes('public/**/*'));
    assert.ok(config.files.includes('src/**/*'));
    assert.equal(config.files.some(pattern => /^!public\/(?:themes|session-theme)/.test(pattern)), false);
  }
  for (const name of ['public/session-theme.js', 'public/theme-settings.js', 'public/themes/halloween.css',
    'public/themes/halloween-lockscreen.css', 'public/themes/halloween-ghost.png', 'src/session-theme.js']) {
    assert.ok(fs.statSync(path.join(root, name)).size > 0, name);
  }
});

test('Halloween accents never substitute scenery for operator-owned backgrounds and form images', () => {
  const css = read('public/themes/halloween-lockscreen.css');
  assert.doesNotMatch(css, /halloween-haunted-night/);
  assert.doesNotMatch(css, /#bg-layer(?:::before|::after)?\s*\{/);
  assert.doesNotMatch(css, /\.login-right::before\s*\{[^}]*url\(/);
});

test('Halloween mobile registration overrides the legacy inline desktop row reversal', () => {
  const css = read('public/themes/halloween-lockscreen.css');
  const mobile = css.slice(css.indexOf('@media (max-width: 700px)'), css.indexOf('@media (prefers-reduced-motion'));
  assert.match(mobile, /\.login-split\s*\{[^}]*flex-direction:\s*column\s*!important/);
  assert.match(mobile, /\.login-split-wrap\s*\{[^}]*width:\s*100%[^}]*flex-shrink:\s*0/);
  assert.match(mobile, /\.login-left\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/);
});
