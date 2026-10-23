const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('order-only native overlay uses measured strip height, scaled once, for both placements and collapses on dismissal', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'session.html'), 'utf8');
  const start = page.indexOf('    function resizeOrderOverlayToContent()');
  const end = page.indexOf('    function resizeDrawerToContent()', start);
  const properties = {};
  const toggles = {};
  const shell = { style: { setProperty: (name, value) => properties[name] = value },
    classList: { toggle: (name, value) => toggles[name] = value } };
  const metrics = { count: 1, height: 182 };
  const heights = [], collapsed = [];
  let placement = 'above', queued;
  const window = { electronAPI: { getSessionOverlayPlacement: async () => placement,
    resizeSessionOverlayHeight: height => heights.push(height) } };
  window.parent = window;
  const run = new Function('window', 'document', 'metrics', 'setTimeout', 'clearTimeout', 'collapsed', `
    let orderOverlayResizeTimer, activeDrawer = null, sessionOverlayPlacement = 'above';
    const previewMode = false, OVERLAY_SCALE = 0.72;
    function getOrderStackMetrics() { return metrics; }
    function setOverlayExpanded(value) { collapsed.push(value); }
    function resizeOverlayToContent() {}
    function resizeDrawerToContent() {}
    ${page.slice(start, end)}
    return resizeOrderOverlayToContent;
  `)(window, { querySelector: () => shell, getElementById: () => ({ offsetHeight: 96 }) },
    metrics, callback => { queued = callback; return 1; }, () => {}, collapsed);
  run(); await queued();
  assert.equal(properties['--denfi-order-strip-height'], '96px');
  assert.equal(heights.at(-1), Math.ceil((96 + 182) * 0.72));
  assert.equal(toggles['drawer-below'], false);
  placement = 'below'; run(); await queued();
  assert.equal(toggles['drawer-below'], true);
  assert.equal(heights.at(-1), 201);
  metrics.count = 0; metrics.height = 0; run(); await queued();
  assert.deepEqual(collapsed, [false]);
});

test('order popups span the complete session strip and dock without a gap in either placement', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'order-status.css'), 'utf8');
  const above = css.match(/\.overlay-shell \.denfi-order-stack--session\s*\{([^}]+)\}/)[1];
  assert.match(above, /left:\s*0\s*;/);
  assert.match(above, /right:\s*0\s*;/);
  assert.match(above, /width:\s*100%\s*;/);
  assert.match(above, /bottom:\s*var\(--denfi-order-strip-height,\s*96px\)\s*;/);
  const below = css.match(/\.overlay-shell\.drawer-below \.denfi-order-stack--session\s*\{([^}]+)\}/)[1];
  assert.match(below, /top:\s*var\(--denfi-order-strip-height,\s*96px\)\s*;/);
  assert.match(below, /bottom:\s*auto\s*;/);
});

test('switching session drawers measures the new panel instead of keeping the previous height', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'session.html'), 'utf8');
  const resizeStart = page.indexOf('    function resizeDrawerToContent()');
  const resizeEnd = page.indexOf('    function closeDrawer()', resizeStart);
  const openStart = page.indexOf('    async function openDrawer(view)');
  const openEnd = page.indexOf('    function isMemberSession()', openStart);
  assert.ok(resizeStart >= 0 && resizeEnd > resizeStart && openStart >= 0 && openEnd > openStart);

  let contentHeight = 560;
  let queued = null;
  const heights = [];
  const classes = () => ({
    values: new Set(),
    add(name) { this.values.add(name); },
    remove(name) { this.values.delete(name); },
    contains(name) { return this.values.has(name); },
    toggle(name, active) { if (active) this.add(name); else this.values.delete(name); }
  });
  const drawer = { classList:classes(), style:{} };
  Object.defineProperty(drawer, 'offsetHeight', {
    get:() => Math.max(contentHeight, parseInt(drawer.style.minHeight, 10) || 0)
  });
  const elements = new Map([
    ['drawer', drawer],
    ['strip', { offsetHeight:70 }]
  ]);
  for (const id of ['shop-btn', 'rank-btn', 'attendance-btn', 'games-btn', 'withdraw-btn']) {
    elements.set(id, { classList:classes() });
  }
  for (const id of ['store-view', 'rank-view', 'attendance-view', 'wins-view', 'wheel-view', 'withdrawal-view', 'cart-bar', 'rank-note', 'drawer-title']) {
    elements.set(id, { style:{}, textContent:'' });
  }
  const document = {
    getElementById:id => elements.get(id),
    querySelector:selector => selector === '.overlay-shell' ? { classList:classes(), style: { setProperty() {} } } : null
  };
  let withdrawalLoads = 0;
  const window = { electronAPI:{ resizeSessionOverlayHeight:height => heights.push(height) },
    addEventListener: () => {},
    DenfiWithdrawalSession:{ refresh:() => { withdrawalLoads++; } } };
  window.parent = window;
  const view = new Function('document', 'window', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', `
    let activeDrawer = null, drawerHeightFloor = 0, drawerResizeTimer = null, sessionOverlayPlacement = 'above';
    const pendingWinNotices = new Map();
    const recentWinNotices = new Map();
    let sessionUsername = 'mem-current', timeLeft = 100;
    const previewMode = true, OVERLAY_SCALE = 0.72;
    ${page.slice(resizeStart, resizeEnd)}
    ${page.slice(resizeEnd, openStart)}
    ${page.slice(openStart, openEnd)}
    function loadProducts() {}
    function loadLeaderboard() {}
    function loadAttendance() {}
    function loadWheel() {}
    function setOverlayExpanded() {}
    function resizeOverlayToContent() {}
    function showLatestWinNotice() {}
    function getOrderStackMetrics() { return { count:0, height:0 }; }
    function resizeOrderOverlayToContent() {}
    return {
      openDrawer, closeDrawer, resizeDrawerToContent, floor:() => drawerHeightFloor,
      active:() => activeDrawer, setPending:() => { pendingWinNotices.set('another-win', { id:'another-win' }); },
      pending:() => pendingWinNotices.size
    };
  `)(document, window,
    callback => { queued = callback; return 1; }, () => { queued = null; }, callback => callback());
  const flush = () => { const callback = queued; queued = null; if (callback) callback(); };

  await view.openDrawer('games');
  drawer.classList.add('active');
  flush();
  assert.equal(heights.at(-1), Math.ceil((560 + 70) * 0.72));
  contentHeight = 190;
  await view.openDrawer('shop');
  assert.equal(drawer.style.minHeight, '', 'the tall game minimum is removed when changing panels');
  flush();
  assert.equal(heights.at(-1), Math.ceil((190 + 70) * 0.72), 'Order can shrink the native overlay');
  contentHeight = 300;
  await view.openDrawer('rank');
  flush();
  assert.equal(heights.at(-1), Math.ceil((300 + 70) * 0.72));
  contentHeight = 240;
  await view.openDrawer('attendance');
  flush();
  assert.equal(heights.at(-1), Math.ceil((240 + 70) * 0.72));
  assert.equal(view.floor(), 240);
  contentHeight = 180;
  await view.openDrawer('withdrawal');
  flush();
  assert.equal(elements.get('withdrawal-view').style.display, 'block');
  assert.equal(elements.get('drawer-title').textContent, 'WITHDRAW POINTS');
  assert.equal(withdrawalLoads, 1);
  assert.equal(heights.at(-1), Math.ceil((180 + 70) * 0.72), 'Withdrawal measures its own bounds');
  contentHeight = 150;
  await view.openDrawer('wins');
  flush();
  assert.equal(elements.get('wins-view').style.display, '', 'the win popup uses the shared drawer');
  assert.equal(elements.get('drawer-title').textContent, 'RECENT WINNERS');
  assert.equal(heights.at(-1), Math.ceil((150 + 70) * 0.72));
  view.setPending();
  view.closeDrawer();
  assert.equal(view.active(), null, 'the shared X closes the win popup');
  assert.equal(view.pending(), 0, 'the shared X clears pending wins too');
  assert.equal(drawer.classList.contains('active'), false);
});