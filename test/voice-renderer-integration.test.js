'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'session.html'), 'utf8');

function section(startMarker, endMarker) {
  const start = page.indexOf(startMarker);
  const end = page.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `source section should exist: ${startMarker}`);
  return page.slice(start, end);
}

function rendererVoiceHelpers({ previewMode = false, api, pending = null, ownRequest = null } = {}) {
  const calls = [];
  const storage = {
    getItem(key) { return key === 'denfi-wheel-pending:mem-alice' && pending ? JSON.stringify(pending) : null; }
  };
  const source = section('    function wheelPendingKey(username) {', '    function clearPendingWheel(');
  const run = new Function('previewMode', 'window', 'sessionStorage', 'wheelRequestUsername',
    'wheelRequestId', `${source}\nreturn { notifyBettingVoice, reportVoiceSession };`);
  const functions = run(
    previewMode,
    api === false ? {} : { electronAPI: api === undefined ? { notifyBettingVoice: value => calls.push(value) } : api },
    storage,
    ownRequest ? 'mem-alice' : '',
    ownRequest
  );
  return { ...functions, calls };
}

test('spin begin notification follows durable pending-wheel persistence and precedes the POST', () => {
  const spin = section('    async function spinWheel() {', '    function attendanceDateLabel(');
  const persist = spin.indexOf('writePendingWheel(requestUsername, wheelRequestId');
  const begin = spin.indexOf("notifyBettingVoice({ phase: 'begin'");
  const post = spin.indexOf("fetch('/api/session/wheel/spin'");
  assert.ok(persist >= 0 && begin > persist && post > begin,
    'the pending request is saved before the voice begin signal, and both precede network settlement');
  assert.match(spin.slice(spin.lastIndexOf('if (!recovering)', persist), begin), /if \(!recovering\)/,
    'only a new request needs to create its pending record; retries retain the original one');
});

test('revealed notification is emitted only inside the guarded reel animation callback', () => {
  const spin = section('    async function spinWheel() {', '    function attendanceDateLabel(');
  const callbackStart = spin.indexOf('setTimeout(() => {');
  const callbackEnd = spin.indexOf('}, settle);', callbackStart);
  const reveal = spin.indexOf("phase: 'revealed'");
  const memberGuard = spin.indexOf("if (String(sessionUsername || '').toLowerCase() !== String(requestUsername || '').toLowerCase())",
    callbackStart);
  assert.ok(callbackStart >= 0 && callbackEnd > callbackStart);
  assert.ok(reveal > callbackStart && reveal < callbackEnd,
    'settlement is reported only after the reel animation callback starts');
  assert.ok(memberGuard > callbackStart && reveal > memberGuard && memberGuard < callbackEnd,
    'the callback exits for a changed session before reporting private result details');
});

test('uncertain network failures retain the same pending wheel request for a retry', () => {
  const spin = section('    async function spinWheel() {', '    function attendanceDateLabel(');
  const catchBlock = spin.slice(spin.indexOf('      } catch (e) {'));
  const knownFailure = catchBlock.indexOf("e.code === 'KNOWN_NOT_SETTLED'");
  const genericFailure = catchBlock.indexOf("button.textContent = 'RETRY SAME REQUEST'");
  assert.ok(knownFailure >= 0 && genericFailure > knownFailure);
  assert.match(catchBlock.slice(knownFailure, genericFailure), /clearPendingWheel\(requestUsername, wheelRequestId\)/,
    'a definitive not-settled response may clear its record');
  assert.doesNotMatch(catchBlock.slice(genericFailure), /clearPendingWheel|wheelRequestId\s*=\s*null/,
    'a network or uncertain response must keep the request id and persisted retry record');
  assert.match(catchBlock.slice(genericFailure), /RETRY SAME REQUEST/);
});

test('both live WebSocket and initial HTTP session status report voice state', () => {
  const ws = section('    function connectWs() {', '    function setPcLabel(');
  const http = section('    async function loadStatus() {', "    const coinSuccessAudio =");
  const wsStatus = ws.slice(ws.indexOf("if (msg.type === 'status' && msg.data)"));
  const wsReport = wsStatus.indexOf('reportVoiceSession(sessionUsername)');
  const wsFinish = wsStatus.indexOf('finishInitialSessionStatus()');
  assert.ok(wsReport > wsFinish && wsStatus.slice(0, wsReport).includes('sessionUsername = msg.data.username'),
    'WebSocket login status sets identity and finishes early notices before reporting voice state');

  const httpLogin = http.slice(http.indexOf('if (data.success && data.data && data.data.isLogin)'));
  const httpReport = httpLogin.indexOf('reportVoiceSession(sessionUsername)');
  const httpFinish = httpLogin.indexOf('finishInitialSessionStatus()');
  assert.ok(httpReport > httpFinish && httpReport >= 0,
    'initial HTTP status also reports voice state after initial status is known');
  assert.ok(httpLogin.slice(0, httpReport).includes('sessionUsername = data.data.username'));
});

test('renderer voice bridge is optional, reports recovered pending requests, and never sends in preview mode', () => {
  const missingApi = rendererVoiceHelpers({ api: false });
  assert.doesNotThrow(() => missingApi.notifyBettingVoice({ phase: 'begin' }));
  assert.deepEqual(missingApi.calls, []);

  const absent = rendererVoiceHelpers({ api: null });
  assert.doesNotThrow(() => absent.notifyBettingVoice({ phase: 'begin' }));

  const previewCalls = [];
  const preview = rendererVoiceHelpers({
    previewMode: true,
    api: { notifyBettingVoice: value => previewCalls.push(value) }
  });
  assert.doesNotThrow(() => preview.notifyBettingVoice({ phase: 'begin' }));
  preview.reportVoiceSession('mem-alice');
  assert.deepEqual(previewCalls, [], 'preview mode must not send private renderer voice IPC');

  const calls = [];
  const live = rendererVoiceHelpers({
    api: { notifyBettingVoice: value => calls.push(value) },
    pending: { requestId: 'saved-request', expectedStake: 10, multipliers: [0, 2], oddsToken: 'odds' }
  });
  live.reportVoiceSession('mem-alice');
  assert.deepEqual(calls, [{ phase: 'state', username: 'mem-alice', requestId: 'saved-request' }]);

  const own = rendererVoiceHelpers({
    api: { notifyBettingVoice: value => calls.push(value) },
    pending: { requestId: 'saved-request', expectedStake: 10, multipliers: [0, 2], oddsToken: 'odds' },
    ownRequest: 'live-request'
  });
  own.reportVoiceSession('mem-alice');
  assert.deepEqual(calls[1], { phase: 'state', username: 'mem-alice', requestId: 'live-request' },
    'the active in-memory request takes precedence over recovered storage');
});