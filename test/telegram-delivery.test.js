const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJournal, createSender, hash } = require('../src/telegram-delivery');

const config = { botToken: '123456789:FAKE_ONLY_NOT_A_REAL_BOT_TOKEN', channelId: '-1001234567' };
const accepted = () => new Response(JSON.stringify({ ok: true, result: {
  message_id: 42, chat: { id: config.channelId } } }));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-delivery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const journal = name => createJournal({ getDir: () => path.join(dir, name) });
  const hub = journal('hub');
  const coordinator = {
    claim: async input => hub.claim(input),
    settle: async input => hub.settle(input),
    read: async key => hub.read(key),
  };
  return { dir, journal, hub, coordinator };
}

test('orders, betting, withdrawals and monthly reports deduplicate by event, not formatted message text', async t => {
  const f = fixture(t);
  let posts = 0;
  const send = createSender({ journal: f.journal('pc'), getTelegram: () => config,
    coordinator: f.coordinator, fetchImpl: async () => { posts++; return accepted(); } });
  for (const key of ['order:abc', 'bet:abc', 'withdrawal:abc:success', 'monthly:2026-09']) {
    const event = { key, kind: key.split(':')[0], id: key };
    assert.equal((await send('original text', undefined, event)).sent, true);
    const retry = await send('different text and timestamp', undefined, event);
    assert.equal(retry.sent, true);
    assert.equal(retry.deduplicated, true);
    assert.equal(retry.messageId, 42);
  }
  assert.equal(posts, 4);
  assert.ok(f.hub.list().every(record => !('token' in record)));
  assert.ok(!JSON.stringify(f.hub.list()).includes(config.botToken));
});

test('two kiosks racing for one order make exactly one Telegram POST', async t => {
  const f = fixture(t);
  let posts = 0, release;
  const waiting = new Promise(resolve => { release = resolve; });
  const fetchImpl = async () => { posts++; await waiting; return accepted(); };
  const sender = name => createSender({ journal: f.journal(name), getTelegram: () => config,
    coordinator: f.coordinator, fetchImpl });
  const a = sender('a'), b = sender('b');
  const event = { key: 'order:same-id', kind: 'order', id: 'same-id' };
  const first = a('message', undefined, event);
  await new Promise(resolve => setImmediate(resolve));
  const second = await b('message', undefined, event);
  assert.equal(second.uncertain, true);
  release();
  assert.equal((await first).sent, true);
  assert.equal((await b('message', undefined, event)).sent, true, 'other kiosk recovers the shared receipt');
  assert.equal(posts, 1);
});

test('Telegram accepts then connection breaks: repeated calls and process restart never repost', async t => {
  const f = fixture(t);
  let posts = 0;
  const factory = () => createSender({ journal: f.journal('pc'), getTelegram: () => config,
    coordinator: f.coordinator, fetchImpl: async () => { posts++; throw new Error('connection lost'); } });
  const event = { key: 'bet:lost-response', kind: 'betting', id: 'lost-response' };
  assert.equal((await factory()('message', undefined, event)).uncertain, true);
  for (let i = 0; i < 8; i++) assert.equal((await factory()('message', undefined, event)).uncertain, true);
  assert.equal(posts, 1);
  assert.equal(f.hub.read(hash(event.key)).state, 'uncertain');
});

test('an interrupted sending guard never expires or reposts after restart', async t => {
  const f = fixture(t);
  const journal = f.journal('pc');
  const key = hash('order:interrupted');
  journal.claim({ key, token: 'a'.repeat(64), kind: 'order', eventId: 'interrupted' });
  let posts = 0;
  const send = createSender({ journal: f.journal('pc'), getTelegram: () => config,
    fetchImpl: async () => { posts++; return accepted(); } });
  assert.equal((await send('message', undefined, { key: 'order:interrupted' })).uncertain, true);
  assert.equal(posts, 0);
});

test('HTTP 5xx, malformed JSON and missing message IDs are uncertain, never automatically retried', async t => {
  const f = fixture(t);
  const responses = [
    () => new Response(JSON.stringify({ ok: false, description: 'server error' }), { status: 500 }),
    () => new Response('invalid JSON'),
    () => new Response(JSON.stringify({ ok: true, result: {} })),
  ];
  for (let i = 0; i < responses.length; i++) {
    let posts = 0;
    const send = createSender({ journal: f.journal('case-' + i), getTelegram: () => config,
      fetchImpl: async () => { posts++; return responses[i](); } });
    const event = { key: 'order:' + i };
    assert.equal((await send('message', undefined, event)).uncertain, true);
    await send('message', undefined, event);
    assert.equal(posts, 1);
  }
});

test('explicit rejection is retryable; a later acceptance still cannot be posted twice', async t => {
  const f = fixture(t);
  let posts = 0;
  const send = createSender({ journal: f.journal('pc'), getTelegram: () => config,
    coordinator: f.coordinator, fetchImpl: async () => ++posts === 1
      ? new Response(JSON.stringify({ ok: false, description: 'rejected' }), { status: 429 }) : accepted() });
  const event = { key: 'order:rejected' };
  assert.equal((await send('message', undefined, event)).sent, false);
  assert.equal((await send('message', undefined, event)).sent, true);
  await send('message', undefined, event);
  assert.equal(posts, 2);
});

test('Telegram retry_after is honored', async t => {
  const f = fixture(t);
  let posts = 0;
  const send = createSender({ journal: f.journal('pc'), getTelegram: () => config,
    fetchImpl: async () => { posts++; return new Response(JSON.stringify({
      ok: false, parameters: { retry_after: 30 } }), { status: 429 }); } });
  const event = { key: 'bet:rate-limit' };
  await send('message', undefined, event);
  await send('message', undefined, event);
  assert.equal(posts, 1);
});

test('lost shared receipt is repaired from local receipt without resending', async t => {
  const f = fixture(t);
  let fail = true, posts = 0;
  const coordinator = { ...f.coordinator, settle: async input => {
    if (fail) throw new Error('Points offline');
    return f.hub.settle(input);
  } };
  const send = createSender({ journal: f.journal('pc'), getTelegram: () => config,
    coordinator, fetchImpl: async () => { posts++; return accepted(); } });
  const event = { key: 'withdrawal:receipt:success' };
  assert.equal((await send('message', undefined, event)).sent, true);
  fail = false;
  assert.equal((await send('message', undefined, event)).sent, true);
  assert.equal(f.hub.read(hash(event.key)).state, 'sent');
  assert.equal(posts, 1);
});

test('lost shared claim response never bypasses the reservation', async t => {
  const f = fixture(t);
  let posts = 0;
  const coordinator = { ...f.coordinator, claim: async input => {
    f.hub.claim(input); throw new Error('response lost');
  } };
  const send = createSender({ journal: f.journal('pc'), getTelegram: () => config, coordinator,
    fetchImpl: async () => { posts++; return accepted(); } });
  const event = { key: 'order:lost-claim' };
  assert.equal((await send('message', undefined, event)).uncertain, true);
  await send('message', undefined, event);
  assert.equal(posts, 0);
});

test('old or disconnected Points cannot silently bypass protection', async t => {
  const f = fixture(t);
  let posts = 0, available = false, old = true;
  const send = createSender({ journal: f.journal('pc'), getTelegram: () => config,
    coordinator: { ...f.coordinator, available: () => available, claim: async input => {
      if (old) throw Object.assign(new Error('not found'), { status: 404 });
      return f.hub.claim(input);
    } }, fetchImpl: async () => { posts++; return accepted(); } });
  const event = { key: 'order:compatibility' };
  await send('message', undefined, event);
  available = true;
  assert.equal((await send('message', undefined, event)).uncertain, undefined);
  old = false;
  assert.equal((await send('message', undefined, event)).sent, true);
  assert.equal(posts, 1);
});

test('corrupt guards and stale receipts fail closed', async t => {
  const f = fixture(t);
  const journal = f.journal('pc'), key = hash('order:corrupt');
  journal.claim({ key, token: 'a'.repeat(64), kind: 'order', eventId: 'corrupt' });
  assert.throws(() => journal.settle({ key, token: 'b'.repeat(64), result: { sent: true, messageId: 42 } }), /match/);
  fs.writeFileSync(path.join(f.dir, 'pc', 'telegram-delivery', key + '.json'), 'corrupt');
  let posts = 0;
  const send = createSender({ journal, getTelegram: () => config,
    fetchImpl: async () => { posts++; return accepted(); } });
  assert.equal((await send('message', undefined, { key: 'order:corrupt' })).sent, false);
  assert.equal(posts, 0);
});
