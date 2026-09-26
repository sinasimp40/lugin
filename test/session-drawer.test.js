const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  for (const id of ['shop-btn', 'rank-btn', 'attendance-btn', 'games-btn']) {
    elements.set(id, { classList:classes() });
  }
  for (const id of ['store-view', 'rank-view', 'attendance-view', 'wins-view', 'wheel-view', 'cart-bar', 'rank-note', 'drawer-title', 'win-queue', 'win-queue-count']) {
    elements.set(id, { style:{}, textContent:'' });
  }
  const document = {
    getElementById:id => elements.get(id),
    querySelector:selector => selector === '.overlay-shell' ? { classList:classes() } : null
  };
  const window = { electronAPI:{ resizeSessionOverlayHeight:height => heights.push(height) } };
  window.parent = window;
  const view = new Function('document', 'window', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', `
    let activeDrawer = null, drawerHeightFloor = 0, drawerResizeTimer = null;
    let displayedWinNotice = null, sessionUsername = 'mem-current', timeLeft = 100;
    const queuedWinNotices = [];
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
    function showNextWinNotice() {}
    function updateWinQueueIndicator() {}
    return {
      openDrawer, closeDrawer, resizeDrawerToContent, floor:() => drawerHeightFloor,
      active:() => activeDrawer, queueWin:() => queuedWinNotices.push({ id:'another-win' }),
      queued:() => queuedWinNotices.length
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
  contentHeight = 150;
  await view.openDrawer('wins');
  flush();
  assert.equal(elements.get('wins-view').style.display, '', 'the win popup uses the shared drawer');
  assert.equal(elements.get('drawer-title').textContent, 'WINNER');
  assert.equal(heights.at(-1), Math.ceil((150 + 70) * 0.72));
  view.queueWin();
  view.closeDrawer();
  assert.equal(view.active(), null, 'the shared X closes the win popup');
  assert.equal(view.queued(), 0, 'the shared X clears pending wins too');
  assert.equal(drawer.classList.contains('active'), false);
});