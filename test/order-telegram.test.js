const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

test('a failed order Telegram send is visible and retries without creating another order', { timeout: 30000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-order-telegram-'));
  const port = await freePort();
  const bootstrap = `
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = process.env.DENFI_TEST_DATA_DIR;
    const settings = require('./src/settings-store');
    settings.setAppRole('auto-shutdown');
    settings.setDataDir(dir);
    settings.updateSettings({ products: [{ id:'drink', name:'Drink', price:15 }] });
    settings.updateTelegramSettings({
      botToken:'123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345', channelId:'-1001234567890'
    });
    require('./src/coin-log-store').setDataDir(dir);
    require('./src/order-store').setDataDir(dir);
    require('./src/attendance-store').setDataDir(dir);
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      if (String(url) === 'http://pisonet.app/status') {
        return new Response(JSON.stringify({
          isLogin:true, username:'mem-customer', sessionTimeLeft:120, ip:'127.0.0.1'
        }), { status:200 });
      }
      if (String(url).startsWith('https://api.telegram.org/')) {
        const file = path.join(dir, 'attempts.json');
        const attempts = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
        attempts.push(JSON.parse(options.body).text);
        fs.writeFileSync(file, JSON.stringify(attempts));
        return new Response(JSON.stringify(attempts.length === 1
          ? { ok:false, description:'temporary failure' } : { ok:true, result:{ message_id:1 } }), {
          status:attempts.length === 1 ? 429 : 200
        });
      }
      return originalFetch(url, options);
    };
    require('./server');
  `;
  const child = spawn(process.execPath, ['-e', bootstrap], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DENFI_APP_ROLE: 'auto-shutdown',
      DENFI_TEST_DATA_DIR: dir, NODE_ENV: 'test', DENFI_LISTEN_HOST: '127.0.0.1' },
    stdio: 'ignore'
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null) throw new Error('Kiosk server exited before ready');
      try {
        const response = await fetch(base + '/api/admin/status');
        if (response.ok) { ready = true; break; }
      } catch (_) {}
      await delay(100);
    }
    assert.ok(ready, 'kiosk server started');
    const response = await fetch(base + '/api/session/orders', {
      method:'POST', headers:{ 'content-type':'application/json' },
      body:JSON.stringify({ items:[{ id:'drink', quantity:2 }] })
    });
    const placed = await response.json();
    assert.equal(placed.success, true);
    assert.equal(placed.telegramSent, false, 'the UI must not claim Telegram delivery');
    const ordersFile = path.join(dir, 'orders.json');
    let orders = JSON.parse(fs.readFileSync(ordersFile, 'utf8')).orders;
    assert.equal(orders.length, 1);
    assert.equal(orders[0].telegramStatus, 'pending');
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      orders = JSON.parse(fs.readFileSync(ordersFile, 'utf8')).orders;
      if (orders[0].telegramStatus === 'sent') break;
      await delay(200);
    }
    assert.equal(orders[0].telegramStatus, 'sent', 'pending order retries automatically');
    assert.equal(orders.length, 1, 'retry does not make another order');
    const attempts = JSON.parse(fs.readFileSync(path.join(dir, 'attempts.json'), 'utf8'));
    assert.equal(attempts.length, 2);
    assert.ok(attempts.every(message => message.includes(`ORDER ID: ${orders[0].id}`)));
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive:true, force:true });
  }
});