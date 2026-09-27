const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let dataDir = path.join(__dirname, '..', 'data');
let ordersPath = path.join(dataDir, 'orders.json');
const HMAC_KEY = 'denfi-orders-integrity-v1';

function setDataDir(dir) {
  dataDir = dir;
  ordersPath = path.join(dataDir, 'orders.json');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function computeHmac(data) {
  return crypto.createHmac('sha256', HMAC_KEY).update(JSON.stringify(data.orders || [])).digest('hex');
}

function load() {
  try {
    if (!fs.existsSync(ordersPath)) return { orders: [] };
    const data = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
    if (data._sig && data._sig !== computeHmac(data)) {
      console.log('[Orders] WARNING: Data integrity mismatch — preserving and re-signing.');
      save(data);
    }
    return { orders: Array.isArray(data.orders) ? data.orders : [] };
  } catch (error) {
    console.log('[Orders] Failed to read orders:', error.message);
    return { orders: [] };
  }
}

function save(data) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  data._sig = computeHmac(data);
  const tmp = ordersPath + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, ordersPath);
}

function createOrder(order) {
  const data = load();
  const created = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    username: order.username,
    station: order.station,
    items: order.items,
    total: order.total,
    status: 'pending',
    timeLeft: order.timeLeft,
    telegramStatus: 'pending',
    telegramAttempts: 0,
    createdAt: Date.now(),
  };
  data.orders.unshift(created);
  data.orders = data.orders.slice(0, 200);
  save(data);
  return created;
}

function getOrders() {
  return load().orders.sort((a, b) => b.createdAt - a.createdAt);
}

function getPendingTelegramOrders() {
  // Older orders have no delivery state. Do not replay them: some were already
  // delivered before this queue existed.
  return getOrders().filter(order =>
    order.status === 'pending' && order.telegramStatus === 'pending').reverse();
}

function updateTelegramDelivery(id, result) {
  const data = load();
  const order = data.orders.find(item => item.id === id);
  if (!order) return null;
  order.telegramStatus = result.sent ? 'sent' : 'pending';
  order.telegramAttempts = (order.telegramAttempts || 0) + 1;
  order.telegramLastAttemptAt = Date.now();
  if (result.sent) delete order.telegramLastError;
  else order.telegramLastError = String(result.error || 'Telegram delivery failed').slice(0, 200);
  save(data);
  return order;
}

function updateOrderStatus(id, status) {
  const data = load();
  const order = data.orders.find(item => item.id === id);
  if (!order) return null;
  order.status = status;
  order.updatedAt = Date.now();
  save(data);
  return order;
}

function deleteOrder(id) {
  const data = load();
  const next = data.orders.filter(item => item.id !== id);
  if (next.length === data.orders.length) return false;
  data.orders = next;
  save(data);
  return true;
}

module.exports = {
  setDataDir, createOrder, getOrders, getPendingTelegramOrders,
  updateTelegramDelivery, updateOrderStatus, deleteOrder
};