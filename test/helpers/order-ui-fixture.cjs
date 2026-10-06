'use strict';
// Local test transport only. Real order routes, hub, stores, polling and UI;
// Telegram/Hotspot are replaced so this fixture can never contact an operator.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createHub, installHubRoutes } = require('../../src/order-workflow');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-order-ui-'));
process.env.PORT = '5012';
process.env.DENFI_APP_ROLE = 'auto-shutdown';
process.env.DENFI_LISTEN_HOST = '127.0.0.1';
process.env.DENFI_TEST_DATA_DIR = dir;
const settings = require('../../src/settings-store');
settings.setAppRole('auto-shutdown');
settings.setDataDir(dir);
settings.updateSettings({ products: [{ id: 'water', name: 'Bottled Water', price: 20 },
  { id: 'snack', name: 'Potato Chips', price: 30 }], computerName: 'PC 3' });
settings.updateTelegramSettings({ botToken: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345', channelId: '-1001234567890' });
require('../../src/order-store').setDataDir(dir);
require('../../src/coin-log-store').setDataDir(dir);
require('../../src/attendance-store').setDataDir(dir);
const transport = express();
transport.use(express.json());
installHubRoutes(transport, createHub({ filename: () => path.join(dir, 'hub.json') }));
const messages = new Map();
const updates = [];
let nextId = 100, updateId = 1;
let activeUsername = 'mem-order-test';
transport.get('/test/messages', (req, res) => res.json([...messages.values()]));
transport.post('/test/action/:id/:phase', (req, res) => {
  const message = messages.get(Number(req.params.id));
  if (!message) return res.status(404).json({ success: false });
  const id = /ORDER ID: ([a-z0-9]+)/i.exec(message.text)?.[1];
  updates.push({ update_id: updateId++, callback_query: {
    id: `test-${updateId}`, data: `do:${req.params.phase}:${id}`,
    message: { message_id: message.message_id, chat: { id: -1001234567890 } },
  } });
  res.json({ success: true });
});
transport.post('/test/member', (req, res) => {
  activeUsername = req.body.username;
  res.json({ success: true });
});
transport.get('/api/sync/settings', (req, res) => res.json({ success: false }));
transport.get('/api/sync/attendance/config', (req, res) => res.json({ success: false }));
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  if (String(url) === 'http://pisonet.app/status') return new Response(JSON.stringify({
    isLogin: !!activeUsername, username: activeUsername, sessionTimeLeft: activeUsername ? 7200 : 0,
    ip: '127.0.0.1', units: { '127.0.0.1': 'PC 3' },
  }));
  if (String(url).startsWith('https://api.telegram.org/')) {
    const method = String(url).split('/').pop();
    const body = JSON.parse(options.body);
    let result = true;
    if (method === 'sendMessage') {
      result = { message_id: nextId++, chat: { id: -1001234567890 }, text: body.text, reply_markup: body.reply_markup };
      messages.set(result.message_id, result);
    } else if (method === 'editMessageText') {
      result = messages.get(body.message_id);
      if (!result) throw new Error('Fixture message missing');
      Object.assign(result, { text: body.text, reply_markup: body.reply_markup });
    } else if (method === 'getUpdates') result = updates.filter(update => update.update_id >= (body.offset || 0));
    return new Response(JSON.stringify({ ok: true, result }));
  }
  // Block unrelated discovery/network traffic in this isolated fixture.
  if (!String(url).startsWith('http://127.0.0.1:5013/api/sync/order-workflow')) {
    return new Response(JSON.stringify({ success: false }), { status: 503 });
  }
  return originalFetch(url, options);
};
transport.listen(5013, '127.0.0.1', () => {
  require('../../server').setSyncServer('http://127.0.0.1:5013', false);
  console.log('Order fixture ready: kiosk 5012; fake operator transport 5013');
});
function cleanup() {
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
