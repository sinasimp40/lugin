'use strict';

// A single elected kiosk consumes callbacks for each bot. Denfi Points owns the
// durable cursor and order states; it never needs the kiosks' Telegram tokens.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const STATES = ['pending', 'preparing', 'ready', 'served', 'cancelled'];
const NEXT = { pending: ['preparing', 'served', 'cancelled'], preparing: ['ready', 'served', 'cancelled'],
  ready: ['served', 'cancelled'], served: [], cancelled: [] };
const validId = value => typeof value === 'string' && /^[a-z0-9]{8,32}$/i.test(value);
const validKey = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hashBot = token => crypto.createHash('sha256').update(token).digest('hex');
const equal = (a, b) => validKey(a) && validKey(b) &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function publicOrder(order) {
  return { id: order.id, username: order.username, station: order.station, items: order.items,
    total: order.total, status: order.status, createdAt: order.createdAt, updatedAt: order.updatedAt };
}
function orderMessage(order) {
  const headings = { pending: 'NEW KIOSK ORDER', preparing: 'ORDER CONFIRMED — PREPARING',
    ready: 'ORDER READY FOR PICKUP', served: 'ORDER SERVED', cancelled: 'ORDER CANCELLED' };
  return [headings[order.status] || headings.pending, '', `ORDER ID: ${order.id}`,
    `PC: ${order.station}`, `USERNAME: ${order.username}`,
    `ORDER TIME: ${new Date(order.createdAt).toLocaleString()}`, '',
    ...order.items.map(item => `- ${item.name} x${item.quantity} — ₱${(item.price * item.quantity).toFixed(2)}`),
    '', `TOTAL: ₱${Number(order.total).toFixed(2)}`].join('\n');
}
function orderKeyboard(order) {
  const action = order.status === 'pending' ? ['Confirm order', 'p'] :
    order.status === 'preparing' ? ['Order ready', 'r'] : null;
  return { inline_keyboard: action ? [[{ text: action[0], callback_data: `do:${action[1]}:${order.id}` }]] : [] };
}

function createHub({ filename, now = Date.now, onChannelPost, bingoEdits, bingoEdited }) {
  const leases = new Map();
  function load() {
    const file = filename();
    if (!fs.existsSync(file)) return { orders: [], cursors: {} };
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(data.orders) || !data.cursors) throw new Error('Order workflow storage is invalid');
    return data;
  }
  function save(data) {
    const file = filename();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  function register(input) {
    const { order, key, botHash, chatId, messageId } = input;
    if (!order || !validId(order.id) || !validKey(key) || !validKey(botHash) ||
        !/^mem-[a-z0-9._-]{1,80}$/i.test(order.username || '') ||
        typeof order.station !== 'string' || order.station.length > 80 ||
        !Number.isFinite(order.total) || order.total < 0 || order.total > 1000000 ||
        !Number.isFinite(order.createdAt) || !/^(?:-?\d{1,30}|@[A-Za-z0-9_]{5,64})$/.test(String(chatId)) ||
        !Array.isArray(order.items) || !order.items.length || order.items.length > 20 ||
        order.items.some(item => !item || typeof item.name !== 'string' || item.name.length > 120 ||
          !Number.isFinite(item.price) || item.price < 0 || !Number.isInteger(item.quantity) ||
          item.quantity < 1 || item.quantity > 10)) throw new Error('Invalid order registration');
    const data = load();
    let current = data.orders.find(item => item.id === order.id);
    const canonicalChat = current?.chatId.startsWith('@') && !current.messageId &&
      messageId !== undefined && /^-?\d{1,30}$/.test(String(chatId));
    if (current && (!equal(current.key, key) || current.botHash !== botHash ||
        current.chatId !== String(chatId) && !canonicalChat)) throw new Error('Order registration does not match');
    if (!current) {
      data.orders = data.orders.filter(item =>
        !['served', 'cancelled'].includes(item.status) || now() - item.updatedAt < 7 * 86400000);
      if (data.orders.length >= 2000) throw new Error('Order history is full; clear completed orders');
      current = { ...publicOrder(order), status: 'pending', key, botHash, chatId: String(chatId) };
      data.orders.push(current);
    }
    if (messageId !== undefined) {
      if (!Number.isSafeInteger(messageId) || messageId <= 0 ||
          current.messageId && current.messageId !== messageId) throw new Error('Invalid Telegram message ID');
      current.messageId = messageId;
      if (canonicalChat) current.chatId = String(chatId);
    }
    save(data);
    return publicOrder(current);
  }
  function state(id, key) {
    const order = load().orders.find(item => item.id === id);
    if (!order || !equal(order.key, key)) throw new Error('Order not found or not authorized');
    return publicOrder(order);
  }
  function transition(id, key, status) {
    const data = load();
    const order = data.orders.find(item => item.id === id);
    if (!order || !equal(order.key, key)) throw new Error('Order not found or not authorized');
    if (!STATES.includes(status) || status !== order.status && !NEXT[order.status]?.includes(status)) {
      throw new Error('Order has already moved to another stage');
    }
    if (status !== order.status) {
      order.status = status; order.updatedAt = now(); order.editNeeded = !!order.messageId;
      save(data);
    }
    return publicOrder(order);
  }
  function claim(botHash, owner, channelId) {
    if (!validKey(botHash) || !validKey(owner)) throw new Error('Invalid callback consumer');
    const old = leases.get(botHash);
    if (old && old.expiresAt > now() && old.owner !== owner) return { acquired: false };
    const lease = old?.owner === owner ? old : { owner, token: crypto.randomBytes(32).toString('hex') };
    if (channelId !== undefined) {
      if (!/^(?:-?\d{1,30}|@[A-Za-z0-9_]{5,64})$/.test(String(channelId))) throw new Error('Invalid Telegram channel');
      lease.channelId = String(channelId);
    }
    lease.expiresAt = now() + 30000;
    leases.set(botHash, lease);
    return { acquired: true, token: lease.token, offset: load().cursors[botHash] || 0 };
  }
  function authorize(botHash, token) {
    const lease = leases.get(botHash);
    if (!lease || lease.expiresAt <= now() || !equal(lease.token, token)) throw new Error('Callback lease expired');
  }
  function consume(botHash, token, updates) {
    authorize(botHash, token);
    if (!Array.isArray(updates) || updates.length > 30) throw new Error('Invalid Telegram updates');
    const data = load();
    const answers = [];
    for (const update of updates.sort((a, b) => a.update_id - b.update_id)) {
      if (!Number.isSafeInteger(update.update_id) || update.update_id < (data.cursors[botHash] || 0)) continue;
      const query = update.callback_query;
      const post = update.channel_post;
      const configuredChannel = leases.get(botHash)?.channelId;
      if (onChannelPost && post?.chat?.type === 'channel' && configuredChannel &&
          (configuredChannel === String(post.chat.id) ||
            configuredChannel.toLowerCase() === '@' + String(post.chat.username || '').toLowerCase()) &&
          /^\/bingo(?:@[a-z0-9_]+)?\s*$/i.test(post.text || '') &&
          Number.isSafeInteger(post.date) && Math.abs(now() - post.date * 1000) <= 120000) {
        onChannelPost({ botHash, chatId: String(post.chat.id), messageId: post.message_id });
      }
      if (query && typeof query.id === 'string') {
        const match = /^do:([pr]):([a-z0-9]{8,32})$/i.exec(query.data || '');
        const order = match && data.orders.find(item => item.id === match[2] && item.botHash === botHash);
        let text = 'This order button is no longer available.';
        if (order && order.messageId === query.message?.message_id &&
            order.chatId === String(query.message?.chat?.id)) {
          const from = match[1] === 'p' ? 'pending' : 'preparing';
          const to = match[1] === 'p' ? 'preparing' : 'ready';
          if (order.status === from) {
            order.status = to; order.updatedAt = now(); order.editNeeded = true;
            text = to === 'preparing' ? 'Order confirmed. The customer is being notified.' :
              'Order ready. The customer is being notified.';
          } else text = `Order is already ${order.status}.`;
        }
        answers.push({ id: query.id, text });
      }
      data.cursors[botHash] = update.update_id + 1;
    }
    save(data);
    return { answers, offset: data.cursors[botHash] || 0 };
  }
  function edits(botHash, token) {
    authorize(botHash, token);
    return load().orders.filter(order => order.botHash === botHash && order.editNeeded && order.messageId)
      .slice(0, 10).map(order => ({ ...publicOrder(order), chatId: order.chatId, messageId: order.messageId }));
  }
  function edited(botHash, token, id, status) {
    authorize(botHash, token);
    const data = load();
    const order = data.orders.find(item => item.id === id && item.botHash === botHash);
    if (order && order.status === status) { order.editNeeded = false; save(data); }
    return { success: true };
  }
  function eventEdits(botHash, token) {
    authorize(botHash, token);
    return { messages: bingoEdits ? bingoEdits(botHash) : [] };
  }
  function eventEdited(botHash, token, key, version) {
    authorize(botHash, token);
    bingoEdited?.(botHash, key, version);
    return { success: true };
  }
  return { register, state, transition, claim, consume, edits, edited, eventEdits, eventEdited };
}

function installHubRoutes(app, hub) {
  const wrap = handler => (req, res) => {
    try { res.json({ success: true, ...handler(req) }); }
    catch (error) { res.status(409).json({ success: false, error: error.message }); }
  };
  const root = '/api/sync/order-workflow';
  app.post(root + '/register', wrap(req => ({ order: hub.register(req.body) })));
  app.get(root + '/state/:id', wrap(req => ({ order: hub.state(req.params.id, req.headers['x-order-key']) })));
  app.post(root + '/state/:id', wrap(req => ({
    order: hub.transition(req.params.id, req.headers['x-order-key'], req.body.status) })));
  app.post(root + '/claim', wrap(req => hub.claim(req.body.botHash, req.body.owner, req.body.channelId)));
  app.post(root + '/consume', wrap(req => hub.consume(req.body.botHash, req.headers['x-order-lease'], req.body.updates)));
  app.post(root + '/edits', wrap(req => ({ orders: hub.edits(req.body.botHash, req.headers['x-order-lease']) })));
  app.post(root + '/edited', wrap(req => hub.edited(req.body.botHash, req.headers['x-order-lease'], req.body.id, req.body.status)));
  app.post(root + '/bingo-edits', wrap(req => hub.eventEdits(req.body.botHash, req.headers['x-order-lease'])));
  app.post(root + '/bingo-edited', wrap(req => hub.eventEdited(req.body.botHash, req.headers['x-order-lease'], req.body.key, req.body.version)));
}

function createClient({ getSyncUrl, getTelegram, store, onStatus, fetchImpl = fetch, log = console.log }) {
  const owner = crypto.randomBytes(32).toString('hex');
  let running = false;
  let lastError = '';
  async function hub(route, body, headers = {}) {
    const url = getSyncUrl();
    if (!url) throw new Error('Connect an updated Denfi Points app to enable Telegram order buttons');
    const response = await fetchImpl(url + '/api/sync/order-workflow' + route, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Update Denfi Points to enable order confirmations');
    return data;
  }
  async function telegram(method, body) {
    const { botToken } = getTelegram();
    if (!botToken) throw new Error('Telegram is not configured');
    const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    if (!data.ok && !(method === 'editMessageText' && /message is not modified/i.test(data.description || ''))) {
      // Do not log fetch URLs: they contain the Telegram credential.
      throw new Error(`Telegram ${method} failed${data.error_code ? ` (${data.error_code})` : ''}`);
    }
    return data.result;
  }
  async function register(order) {
    const config = getTelegram();
    if (!config.botToken || !config.channelId) throw new Error('Telegram is not configured');
    if (!order.workflowKey) throw new Error('This older order has no confirmation workflow');
    return hub('/register', { order: publicOrder(order), key: order.workflowKey,
      botHash: hashBot(config.botToken), chatId: order.telegramChatId || config.channelId,
      ...(order.telegramMessageId ? { messageId: order.telegramMessageId } : {}) });
  }
  function apply(remote) {
    const local = store.getOrders().find(item => item.id === remote.id);
    if (!local || local.status === remote.status) return;
    const changed = store.updateOrderStatus(local.id, remote.status, remote.updatedAt);
    onStatus(changed);
  }
  async function setStatus(order, status) {
    if (order.workflowKey && order.telegramStatus === 'sent' && order.telegramMessageId) {
      await register(order);
      const result = await hub('/state/' + order.id, { status }, { 'x-order-key': order.workflowKey });
      apply(result.order);
      return store.getOrders().find(item => item.id === order.id);
    }
    const result = store.updateOrderStatus(order.id, status);
    if (result.status !== order.status) onStatus(result);
    return result;
  }
  async function tick() {
    if (running) return;
    const config = getTelegram();
    if (!config.botToken || !config.channelId || !getSyncUrl()) return;
    running = true;
    try {
      const botHash = hashBot(config.botToken);
      // Recover registrations if the app stopped just after sendMessage.
      const orders = store.getOrders().filter(order => order.workflowKey && order.telegramMessageId &&
        !['served', 'cancelled'].includes(order.status));
      for (const order of orders.slice(0, 30)) {
        await register(order);
        const result = await hub('/state/' + order.id, undefined, { 'x-order-key': order.workflowKey });
        apply(result.order);
      }
      const lease = await hub('/claim', { botHash, owner, channelId: config.channelId });
      if (lease.acquired) {
        const headers = { 'x-order-lease': lease.token };
        const updates = await telegram('getUpdates', { offset: lease.offset, limit: 30, timeout: 0,
          allowed_updates: ['callback_query', 'channel_post'] });
        if (Array.isArray(updates) && updates.length) {
          const result = await hub('/consume', { botHash, updates }, headers);
          for (const answer of result.answers) {
            try { await telegram('answerCallbackQuery', { callback_query_id: answer.id, text: answer.text }); }
            catch (_) { /* Callback acknowledgement expiry must not undo a saved order state. */ }
          }
        }
        const pending = await hub('/edits', { botHash }, headers);
        for (const order of pending.orders) {
          await telegram('editMessageText', { chat_id: order.chatId, message_id: order.messageId,
            text: orderMessage(order), reply_markup: orderKeyboard(order) });
          await hub('/edited', { botHash, id: order.id, status: order.status }, headers);
        }
        const bingo = await hub('/bingo-edits', { botHash }, headers);
        for (const message of bingo.messages || []) {
          await telegram('editMessageText', { chat_id: message.chatId,
            message_id: message.messageId, text: message.text });
          await hub('/bingo-edited', { botHash, key: message.key, version: message.version }, headers);
        }
      }
      lastError = '';
    } catch (error) {
      if (lastError !== error.message) log('[Orders] Confirmation sync:', error.message);
      lastError = error.message;
    } finally { running = false; }
  }
  return { register, tick, setStatus, telegram };
}

module.exports = { createHub, installHubRoutes, createClient, publicOrder, orderMessage, orderKeyboard };
