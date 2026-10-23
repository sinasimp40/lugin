const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = fs.readFileSync(path.join(__dirname, '../public/session.html'), 'utf8');

function harness() {
  const nodes = {
    'points-zone': { classList: { contains: () => true }, css: { width: '92px' } },
    'withdraw-btn': { css: { display: 'flex', width: '36px' } },
    'username': { intrinsic: 220, textContent: '' },
    'pc-label': { intrinsic: 74 },
    'status-dot': { css: { width: '6px' } },
    '.main-section': { css: { paddingLeft: '16px', paddingRight: '16px' } },
    '.user-row': { css: { gap: '7px' } },
    '.action-area': { css: { flexBasis: '132px' } },
  };
  const document = { getElementById: name => nodes[name], querySelector: name => nodes[name] };
  const widths = [];
  const constants = page.slice(page.indexOf('    const OVERLAY_SCALE'), page.indexOf('    let wheelSpinInFlight'));
  const start = page.indexOf('    function resizeOverlayToContent()');
  const end = page.indexOf('    function setOverlayExpanded(', start);
  const view = new Function('document', 'window', 'requestAnimationFrame', 'getComputedStyle', `
    ${constants}
    let activeDrawer = null, overlayWidth = 0;
    const previewMode = false;
    function measureIntrinsicWidth(el) { return el ? el.intrinsic : 0; }
    ${page.slice(start, end)}
    return { resizeOverlayToContent, setDisplayedUsername,
      drawer: value => { activeDrawer = value; }, width: () => overlayWidth };
  `)(document, { addEventListener() {}, electronAPI: { resizeSessionOverlayWidth: width => widths.push(width) } },
    callback => callback(), el => el.css);
  return { nodes, widths, view };
}

test('session width includes withdrawal button, full username and PC label', () => {
  const { nodes, widths, view } = harness();
  view.setDisplayedUsername('mem-a-long-member-name');
  assert.equal(nodes.username.title, 'mem-a-long-member-name');
  assert.equal(widths.at(-1), Math.ceil((36 + 92 + 32 + 6 + 220 + 74 + 14 + 132 + 4) * .72));
  nodes['withdraw-btn'].css.display = 'none';
  view.resizeOverlayToContent();
  assert.equal(widths.at(-1), Math.ceil((92 + 32 + 6 + 220 + 74 + 14 + 132 + 4) * .72));
  nodes.username.intrinsic = 656; // Full valid 84-character member ID at 13px.
  nodes['withdraw-btn'].css.display = 'flex';
  view.resizeOverlayToContent();
  assert.ok(widths.at(-1) > 560, 'long valid names are not stopped by the old width cap');
  assert.ok(widths.at(-1) <= 900);
});

test('username uses real unscaled DOM glyph width, not its clipped flex box or canvas font metrics', () => {
  const start = page.indexOf('    function measureIntrinsicWidth(element)');
  const end = page.indexOf('    function resizeOverlayToContent()', start);
  assert.ok(start >= 0 && end > start);
  const text = 'mem-r'.padEnd(84, 'x');
  let removed = false;
  const clone = {
    style:{}, scrollWidth:656, removeAttribute: name => assert.equal(name, 'id'),
    getBoundingClientRect:() => ({ width:655.3 }), remove:() => { removed = true; }
  };
  const user = { id:'username', textContent:text, classList:{ contains:() => false }, cloneNode:() => clone };
  const measure = new Function('document', `
    ${page.slice(start, end)}
    return measureIntrinsicWidth;
  `)({ body:{ appendChild: element => assert.equal(element.style.width, 'max-content') } });
  assert.equal(measure(user), 658);
  assert.equal(clone.style.flex, '0 0 auto');
  assert.ok(removed);
});

test('open drawers allow necessary username growth, never shrink or repeatedly resize', () => {
  const { nodes, widths, view } = harness();
  view.resizeOverlayToContent();
  const count = widths.length;
  view.resizeOverlayToContent();
  assert.equal(widths.length, count);
  view.drawer('games');
  nodes.username.intrinsic = 600;
  view.setDisplayedUsername('mem-another-long-name');
  assert.equal(widths.length, count + 1, 'longer username can grow even with an open drawer');
  view.resizeOverlayToContent();
  assert.equal(widths.length, count + 1, 'no repeated transparent-window repaint');
  nodes.username.intrinsic = 80;
  view.resizeOverlayToContent();
  assert.equal(widths.length, count + 1, 'no shrinking during tool use');
  view.drawer(null);
  view.resizeOverlayToContent();
  assert.equal(widths.length, count + 2);
});

test('a long timer is included even with a short username', () => {
  const { nodes, widths, view } = harness();
  nodes.username.intrinsic = 10;
  nodes.timer = { intrinsic:400 };
  view.resizeOverlayToContent();
  assert.equal(widths.at(-1), Math.ceil((36 + 92 + 32 + 400 + 132 + 4) * .72));
});

test('renderer/native width limits match, with refresh after fonts and withdrawal visibility changes', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  assert.equal(Number(main.match(/SESSION_MAX_WIDTH = (\d+)/)[1]),
    Number(page.match(/MAX_OVERLAY_WIDTH = (\d+)/)[1]));
  assert.match(page, /document\.fonts\.ready\.then\(resizeOverlayToContent\)/);
  assert.match(page, /resize: \(\) => \{\s*resizeOverlayToContent\(\);\s*resizeDrawerToContent\(\);/);
});