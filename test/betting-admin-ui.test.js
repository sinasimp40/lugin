const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const bindings = `const {adminWheelLoaded, adminWheelSaving, adminWheelConnected,
  adminWheelSupportsPolicy, adminWheelSupportsGames, adminWheelDirty,
  adminWheelDraft, adminWheelActive, adminWheel} = state;
  function isPointsAdmin() { return state.role === 'points'; }`;
function state(overrides = {}) {
  return {
    role: 'auto-shutdown', adminWheelLoaded: true, adminWheelSaving: false,
    adminWheelConnected: false, adminWheelSupportsPolicy: true, adminWheelSupportsGames: true,
    adminWheelDirty: true, adminWheelDraft: false,
    adminWheelActive: { enabled: true, game: 'dice', maxSpinsPerDay: 5, allowCustomStake: true },
    adminWheel: { outcomes: [{ multiplier: 0 }, { multiplier: 2 }] }, ...overrides
  };
}
function render(options) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { classList: { toggle() {}, remove() {} } });
    return nodes.get(id);
  };
  const document = { getElementById: node, querySelector: () => node('add'),
    querySelectorAll: () => [] };
  const start = page.indexOf('    function setWheelAdminReadOnly()');
  const end = page.indexOf('    async function loadAdminWheel(', start);
  assert.ok(start >= 0 && end > start);
  new Function('document', 'state', 'wheelEditorState', bindings +
    page.slice(start, end) + ';setWheelAdminReadOnly();')(
    document, options, () => ({ wins: [{ multiplier: 2 }] }));
  return node;
}

test('Auto Shutdown betting removes draft notices, reload button and test link', () => {
  const node = render(state());
  assert.equal(node('admin-wheel-save').hidden, true);
  assert.equal(node('admin-game-actions').hidden, true);
  assert.equal(node('admin-wheel-status').hidden, true);
  assert.equal(node('admin-wheel-status').textContent, '');
  assert.doesNotMatch(page, /Save local draft|Reload latest policy and discard these edits|Open session game test bench/);
  assert.doesNotMatch(page, /id="admin-wheel-reload"/);
  assert.match(page, /id="admin-wheel-daily-limit"/);
  assert.match(page, /id="admin-wheel-custom-stake"/);
});

test('connected Auto Shutdown retains Publish while Points stays read-only', () => {
  const node = render(state({ adminWheelConnected: true }));
  assert.equal(node('admin-wheel-save').hidden, false);
  assert.equal(node('admin-game-actions').hidden, false);
  assert.equal(node('admin-wheel-save').disabled, false);
  assert.equal(node('admin-wheel-save').textContent, 'Publish to Denfi Points');
  const points = render(state({ role: 'points', adminWheelConnected: true }));
  assert.equal(points('admin-wheel-save').hidden, true);
  assert.equal(points('admin-wheel-status').hidden, false);
  assert.match(points('admin-wheel-status').textContent, /Read-only/);
});

test('offline Auto Shutdown cannot invoke a local-draft write through the removed action', async () => {
  const start = page.indexOf('    async function saveWheelSettings()');
  const end = page.indexOf('    function setAttendanceManaged(', start);
  assert.ok(start >= 0 && end > start);
  let writes = 0;
  let notice = '';
  await new Function('state', 'fetch', 'showAdminMsg', bindings +
    page.slice(start, end) + ';return saveWheelSettings();')(
    state(), () => { writes++; }, (_, text) => { notice = text; });
  assert.equal(writes, 0);
  assert.match(notice, /Connect Denfi Points/);
});

test('reconnecting makes publishing available without discarding unsubmitted offline edits', async () => {
  const start = page.indexOf('    async function loadAdminWheel(');
  const end = page.indexOf('    async function saveWheelSettings()', start);
  assert.ok(start >= 0 && end > start);
  const edited = { game: 'dice', dice: { winRate: 30, loseRate: 70 } };
  const result = await new Function('fetch', 'edited', `
    let adminToken = 'fixture-token', adminWheelLoadSeq = 0;
    let adminWheelDirty = true, adminWheelConnected = false, adminWheelLoaded = true;
    let adminWheel = edited, adminWheelDraft, adminWheelActive, adminWheelActiveOddsToken;
    let adminWheelSupportsPolicy, adminWheelSupportsGames;
    const document = { querySelector: () => ({}) };
    function renderAdminWheel() {}
    function setWheelAdminReadOnly() {}
    function isPointsAdmin() { return false; }
    function editableWheel() { throw new Error('Must preserve offline edits'); }
    function showAdminMsg(_, text) { throw new Error(text); }
    ${page.slice(start, end)}
    return loadAdminWheel().then(() => ({
      connected: adminWheelConnected, dirty: adminWheelDirty,
      wheel: adminWheel, token: adminWheelActiveOddsToken
    }));
  `)(async () => ({
    ok: true, json: async () => ({
      success: true, connected: true, pointsSupportsPolicy: true, pointsSupportsGames: true,
      wheel: { game: 'wheel' }, activeWheel: { game: 'wheel' }, activeOddsToken: 'a'.repeat(64)
    })
  }), edited);
  assert.equal(result.connected, true);
  assert.equal(result.dirty, true);
  assert.equal(result.wheel, edited);
  assert.equal(result.token, 'a'.repeat(64));
});
