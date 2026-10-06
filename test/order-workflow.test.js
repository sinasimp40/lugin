'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHub, createClient, orderKeyboard, orderMessage, publicOrder } = require('../src/order-workflow');
const { KioskVoiceCoordinator, formatAnnouncement } = require('../src/voice-announcements');
const { speechParts } = require('../src/instant-voice');
const vm = require('node:vm');

const key = 'a'.repeat(64), botHash = 'b'.repeat(64), owner = 'c'.repeat(64);
const order = { id: 'order12345', username: 'mem-alice', station: 'PC 3',
  status: 'pending', items: [{ name: 'Water', quantity: 2, price: 15 }], total: 30, createdAt: 1700000000000 };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-order-workflow-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let clock = order.createdAt + 10000;
  const filename = () => path.join(dir, 'workflow.json');
  const hub = createHub({ filename, now: () => clock });
  const register = (extras = {}) => hub.register({ order, key, botHash, chatId: '-10012345', messageId: 42, ...extras });
  return { hub, filename, register, advance: n => clock += n };
}
function update(id, phase = 'p', extra = {}) {
  return { update_id: id, callback_query: { id: `callback-${id}`, data: `do:${phase}:${order.id}`,
    message: { message_id: 42, chat: { id: -10012345 } }, ...extra } };
}

test('same Telegram message advances pending -> preparing -> ready with durable cursor and no duplicate transitions', t => {
  const { hub, register, filename, advance } = fixture(t);
  register();
  const lease = hub.claim(botHash, owner);
  assert.equal(hub.claim(botHash, 'd'.repeat(64)).acquired, false);
  hub.consume(botHash, lease.token, [update(101)]);
  const preparing = hub.state(order.id, key);
  assert.equal(preparing.status, 'preparing');
  advance(100);
  hub.consume(botHash, lease.token, [update(101), update(102)]);
  assert.equal(hub.state(order.id, key).updatedAt, preparing.updatedAt);
  assert.equal(hub.edits(botHash, lease.token)[0].messageId, 42);
  assert.equal(orderKeyboard(preparing).inline_keyboard[0][0].text, 'Order ready');
  hub.edited(botHash, lease.token, order.id, 'preparing');
  assert.equal(hub.edits(botHash, lease.token).length, 0);
  hub.consume(botHash, lease.token, [update(103, 'r')]);
  assert.equal(hub.state(order.id, key).status, 'ready');
  assert.deepEqual(orderKeyboard(hub.state(order.id, key)), { inline_keyboard: [] });
  assert.match(orderMessage(hub.state(order.id, key)), /ORDER READY FOR PICKUP/);
  const restored = createHub({ filename });
  assert.equal(restored.state(order.id, key).status, 'ready');
  assert.equal(restored.claim(botHash, owner).offset, 104);
});

test('wrong chat, wrong message, wrong capability, and out-of-order ready do not advance an order', t => {
  const { hub, register } = fixture(t);
  register();
  const lease = hub.claim(botHash, owner);
  assert.throws(() => hub.state(order.id, 'e'.repeat(64)), /authorized/);
  hub.consume(botHash, lease.token, [
    update(1, 'p', { message: { message_id: 42, chat: { id: -5555 } } }),
    update(2, 'p', { message: { message_id: 43, chat: { id: -10012345 } } }),
    update(3, 'r'),
  ]);
  assert.equal(hub.state(order.id, key).status, 'pending');
  assert.throws(() => hub.transition(order.id, key, 'ready'), /another stage/);
  assert.throws(() => hub.register({ order, key: 'e'.repeat(64), botHash, chatId: '-10012345' }), /match/);
});

test('lease expiry elects another kiosk; stale consumer cannot consume callbacks or edit acknowledgements', t => {
  const { hub, register, advance } = fixture(t);
  register();
  const old = hub.claim(botHash, owner);
  advance(31000);
  const next = hub.claim(botHash, 'd'.repeat(64));
  assert.equal(next.acquired, true);
  assert.throws(() => hub.consume(botHash, old.token, [update(1)]), /expired/);
  hub.consume(botHash, next.token, [update(1)]);
  assert.equal(hub.state(order.id, key).status, 'preparing');
  assert.throws(() => hub.edited(botHash, old.token, order.id, 'preparing'), /expired/);
});

test('named Telegram channel registration canonicalizes to actual chat ID after sendMessage', t => {
  const { hub, register } = fixture(t);
  register({ chatId: '@denfishop', messageId: undefined });
  register({ chatId: '-10012345', messageId: 42 });
  const lease = hub.claim(botHash, owner);
  hub.consume(botHash, lease.token, [update(1)]);
  assert.equal(hub.state(order.id, key).status, 'preparing');
});

test('registration recovery cannot overwrite a progressed state; stale edit acknowledgement cannot hide newer status', t => {
  const { hub, register } = fixture(t);
  register();
  const lease = hub.claim(botHash, owner);
  hub.consume(botHash, lease.token, [update(1)]);
  register();
  assert.equal(hub.state(order.id, key).status, 'preparing');
  hub.consume(botHash, lease.token, [update(2, 'r')]);
  hub.edited(botHash, lease.token, order.id, 'preparing');
  assert.equal(hub.edits(botHash, lease.token)[0].status, 'ready');
  assert.equal(publicOrder({ ...order, key, workflowKey: key }).key, undefined);
  assert.equal(publicOrder({ ...order, workflowKey: key }).workflowKey, undefined);
});

test('order voice uses Heart cue text with stripped name and plays only once on ordering member PC', async () => {
  const played = [];
  const coordinator = new KioskVoiceCoordinator({
    generate: async text => text, play: async audio => played.push(audio), now: () => order.createdAt + 10000,
    log: () => {},
  });
  coordinator.observeStatus({ isLogin: true, username: order.username, sessionTimeLeft: 300 });
  assert.equal(coordinator.orderStatus({ ...order, username: 'mem-bob', status: 'preparing', updatedAt: order.createdAt }), false);
  const preparing = { ...order, status: 'preparing', updatedAt: order.createdAt + 5000 };
  assert.equal(coordinator.orderStatus(preparing), true);
  assert.equal(coordinator.orderStatus(preparing), false);
  for (let i = 0; i < 10 && coordinator.draining; i++) await new Promise(r => setImmediate(r));
  assert.deepEqual(played, ['Your order has been received and is being prepared. Please wait. alice.']);
  assert.equal(formatAnnouncement({ type: 'order-ready', username: 'mem-alice' }),
    'Your order is ready for pickup. alice.');
  assert.deepEqual(speechParts({ type: 'order-ready', username: 'mem-alice' }),
    { cue: 'order-ready', body: 'alice.' });
  coordinator.observeStatus({ isLogin: true, username: 'mem-bob', sessionTimeLeft: 300 });
  assert.equal(coordinator.orderStatus({ ...order, status: 'ready', updatedAt: order.createdAt }), false);
  await coordinator.close();
});

test('client keeps delivered order after edit failure and retries same message without duplicate voice', async t => {
  const { hub, register } = fixture(t);
  // The fake transport simulates two PCs using the same bot and shared Points.
  const token = 'fixture-telegram-token';
  const realHash = require('node:crypto').createHash('sha256').update(token).digest('hex');
  register({ botHash: realHash });
  let local = { ...order, workflowKey: key, telegramStatus: 'sent', telegramMessageId: 42, telegramChatId: '-10012345' };
  const updates = [update(1)];
  const editedMessages = [];
  const notices = [];
  let failEdit = true;
  const client = createClient({
    getSyncUrl: () => 'http://fixture', getTelegram: () => ({ botToken: token, channelId: '-10012345' }),
    store: { getOrders: () => [local], updateOrderStatus: (id, status, updatedAt) => (local = { ...local, status, updatedAt }) },
    onStatus: item => notices.push(item.status), log: () => {},
    fetchImpl: async (url, options) => {
      const body = options.body && JSON.parse(options.body);
      const headers = options.headers;
      let result;
      if (url.endsWith('/register')) result = { order: hub.register(body) };
      else if (url.includes('/state/')) result = { order: hub.state(order.id, headers['x-order-key']) };
      else if (url.endsWith('/claim')) result = hub.claim(body.botHash, body.owner);
      else if (url.endsWith('/consume')) result = hub.consume(body.botHash, headers['x-order-lease'], body.updates);
      else if (url.endsWith('/edits')) result = { orders: hub.edits(body.botHash, headers['x-order-lease']) };
      else if (url.endsWith('/edited')) result = hub.edited(body.botHash, headers['x-order-lease'], body.id, body.status);
      else if (url.endsWith('/getUpdates')) return new Response(JSON.stringify({ ok: true, result: updates.splice(0) }));
      else if (url.endsWith('/answerCallbackQuery')) return new Response(JSON.stringify({ ok: true, result: true }));
      else if (url.endsWith('/editMessageText')) {
        editedMessages.push(body.message_id);
        if (failEdit) { failEdit = false; return new Response(JSON.stringify({ ok: false, error_code: 500 })); }
        return new Response(JSON.stringify({ ok: true, result: true }));
      } else throw new Error('Unexpected request');
      return new Response(JSON.stringify({ success: true, ...result }));
    },
  });
  await client.tick();
  await client.tick();
  await client.tick();
  assert.deepEqual(editedMessages, [42, 42]);
  assert.deepEqual(notices, ['preparing']);
  assert.equal(local.status, 'preparing');
});

test('simulation speech text exactly matches the native announcement, without extra order or item speech', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/order-status.js'), 'utf8'), context);
  for (const status of ['preparing', 'ready', 'served']) {
    const sample = { ...order, status, username: 'mem-Alice.Jones' };
    assert.equal(context.window.DenfiOrderStatus.speechText(sample),
      formatAnnouncement({ type: `order-${status === 'served' ? 'complete' : status}`, username: sample.username }));
  }
});

test('ready received before preparing suppresses obsolete preparing speech', async () => {
  const played = [];
  const coordinator = new KioskVoiceCoordinator({
    generate: async text => text, play: async audio => played.push(audio),
    now: () => order.createdAt + 10000, log: () => {},
  });
  coordinator.observeStatus({ isLogin: true, username: order.username, sessionTimeLeft: 300 });
  assert.equal(coordinator.orderStatus({ ...order, status: 'ready', updatedAt: order.createdAt + 5000 }), true);
  assert.equal(coordinator.orderStatus({ ...order, status: 'preparing', updatedAt: order.createdAt + 1000 }), false);
  for (let i = 0; i < 10 && coordinator.draining; i++) await new Promise(r => setImmediate(r));
  assert.deepEqual(played, ['Your order is ready for pickup. alice.']);
  await coordinator.close();
});

test('pickup reminder starts only after ready speech finishes, and not after completion or logout', async () => {
  for (const mode of ['normal', 'completed', 'logout']) {
    let release;
    const finished = [];
    const coordinator = new KioskVoiceCoordinator({
      generate: async text => text,
      play: text => text.startsWith('Your order is complete.') ? Promise.resolve() :
        new Promise(resolve => { release = resolve; }),
      onFinished: event => finished.push(event.orderId),
      now: () => order.createdAt + 10000, log: () => {},
    });
    coordinator.observeStatus({ isLogin: true, username: order.username, sessionTimeLeft: 300 });
    coordinator.orderStatus({ ...order, status: 'ready', updatedAt: order.createdAt + 5000 });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(finished, []);
    if (mode === 'completed') coordinator.orderStatus({ ...order, status: 'served', updatedAt: order.createdAt + 10000 });
    if (mode === 'logout') coordinator.observeStatus({ isLogin: false });
    release();
    for (let i = 0; i < 10 && coordinator.draining; i++) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(finished, mode === 'normal' ? [order.id] : []);
    await coordinator.close();
  }
});

test('completion speaks the stripped username once, privately, and cancelled orders stay silent', async () => {
  const played = [];
  const coordinator = new KioskVoiceCoordinator({
    generate: async text => text, play: async text => played.push(text),
    now: () => order.createdAt + 10000, log: () => {}
  });
  coordinator.observeStatus({ isLogin: true, username: order.username, sessionTimeLeft: 300 });
  const completed = { ...order, status: 'served', updatedAt: order.createdAt + 10000 };
  assert.equal(coordinator.orderStatus({ ...completed, username: 'mem-someone-else' }), false);
  assert.equal(coordinator.orderStatus(completed), true);
  assert.equal(coordinator.orderStatus(completed), false);
  assert.equal(coordinator.orderStatus({ ...completed, status: 'ready' }), false);
  assert.equal(coordinator.orderStatus({ ...completed, id: 'cancelled123', status: 'cancelled' }), true);
  for (let i = 0; i < 10 && coordinator.draining; i++) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(played, ['Your order is complete. Thank you alice.']);
  assert.equal(speechParts({ type: 'order-complete', username: 'mem-Alice_Jones' }).body, 'Thank you alice jones.');
  await coordinator.close();
});
