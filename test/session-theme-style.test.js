const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Halloween ghost floats both directions inside the details area without intercepting controls', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/themes/halloween.css'), 'utf8');
  const ghost = css.slice(css.indexOf('.session-ghost-track'), css.indexOf('/* Travel'));
  assert.match(ghost, /left: 140px/);
  assert.match(ghost, /right: 132px/);
  assert.match(ghost, /pointer-events: none/);
  assert.match(ghost, /z-index: 1/);
  assert.match(ghost, /min\(82px, 100%\)/);
  assert.match(ghost, /spectral-ghost-patrol 18s ease-in-out infinite/);
  assert.match(css, /0%, 100% \{ transform: translate3d\(0, 0, 0\); \}/);
  assert.match(css, /50% \{ transform: translate3d\(calc\(-100% \+ min\(82px, 100%\)\), 0, 0\); \}/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(ghost, /text-overflow|font-size|display:\s*none|background-position/);
});

test('ghost uses transform-only layers without changing sizing or adding a JavaScript frame loop', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/themes/halloween.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../public/session.html'), 'utf8');
  const keyframes = css.slice(css.indexOf('@keyframes spectral-ghost-patrol'), css.indexOf('@media'));
  assert.doesNotMatch(keyframes, /background-position|filter|left:|right:|width:/);
  assert.match(css, /contain: layout paint/);
  assert.match(css, /will-change: transform/);
  assert.match(html, /\.session-ghost-track \{ display: none; \}/);
  assert.match(html, /class="session-ghost-track" aria-hidden="true"/);
  assert.match(html, /<img src="\/themes\/halloween-ghost\.png" alt="" draggable="false">/);
  assert.doesNotMatch(html, /requestAnimationFrame\([^)]*ghost/i);
});
