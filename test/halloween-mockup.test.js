const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('mockup ghost floats both directions inside the details area without intercepting controls', () => {
  const css = fs.readFileSync(path.join(__dirname, '../mockups/halloween/spectral.css'), 'utf8');
  const ghost = css.slice(css.indexOf('.strip::after'), css.indexOf('/* Travel'));
  assert.match(ghost, /left: 140px/);
  assert.match(ghost, /right: 132px/);
  assert.match(ghost, /pointer-events: none/);
  assert.match(ghost, /z-index: 1/);
  assert.match(ghost, /min\(82px, 100%\)/);
  assert.match(ghost, /spectral-ghost-patrol 18s ease-in-out infinite/);
  assert.match(css, /0%, 100% \{ background-position: center, 100% 50%; \}/);
  assert.match(css, /50% \{ background-position: center, 0% 50%; \}/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(ghost, /text-overflow|font-size|display:\s*none/);
});
