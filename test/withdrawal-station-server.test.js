const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { withdrawalMessage } = require('../src/withdrawal-service');

test('real kiosk withdrawal handler forwards the live PC 10 identity to ledger and Telegram', { timeout: 15000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-withdraw-station-'));
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const bootstrap = `
    const fs = require('node:fs'), path = require('node:path');
    const dir = process.env.DENFI_TEST_DATA_DIR;
    const settings = require('./src/settings-store');
    settings.setAppRole('auto-shutdown');
    settings.setDataDir(dir);
    settings.updateSettings({pisonetUnitName:'PC 1'});
    require('./src/coin-log-store').setDataDir(dir);
    require('./src/attendance-store').setDataDir(dir);
    require('./src/order-store').setDataDir(dir);
    global.fetch = async (url, options = {}) => {
      url = String(url);
      if (url === 'http://pisonet.app/status') {
        const input = JSON.parse(fs.readFileSync(path.join(dir, 'hotspot.json'), 'utf8'));
        return new Response(JSON.stringify(input));
      }
      if (url === 'http://fixture-points.test/api/sync/withdrawal' && options.method === 'POST') {
        const record = JSON.parse(options.body);
        record.status = 'success'; record.createdAt = Date.now(); record.balance = 20;
        fs.writeFileSync(path.join(dir, 'captured.json'), JSON.stringify(record));
        return new Response(JSON.stringify({success:true, withdrawal:record, balance:20}));
      }
      return new Response(JSON.stringify({success:true, settings:{}, attendance:{}, spin:null, notices:[]}));
    };
    const server = require('./server');
    server.setSyncServer('http://fixture-points.test', false);
  `;
  const hotspotFile = path.join(dir, 'hotspot.json');
  const active = { isLogin: true, username: 'mem-station-test', sessionTimeLeft: '3600',
    ip: '10.10.10.10', units: { '10.10.10.1': 'PC 1', '10.10.10.10': 'PC 10' } };
  fs.writeFileSync(hotspotFile, JSON.stringify(active));
  const child = spawn(process.execPath, ['-e', bootstrap], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DENFI_APP_ROLE: 'auto-shutdown',
      DENFI_TEST_DATA_DIR: dir, DENFI_LISTEN_HOST: '127.0.0.1', NODE_ENV: 'test' },
    stdio: 'ignore'
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const origin = 'http://127.0.0.1:' + port;
  let ready = false;
  for (let n = 0; n < 50; n++) {
    if (child.exitCode !== null) throw new Error('Kiosk fixture exited before ready');
    try {
      const response = await fetch(origin + '/api/admin/status');
      if (response.ok) { ready = true; break; }
    } catch (_) {}
    await delay(100);
  }
  assert.ok(ready);
  async function withdraw() {
    const response = await fetch(origin + '/api/session/withdrawal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: crypto.randomUUID(), amount: 1,
        station: 'PC 1', username: 'mem-forged' })
    });
    assert.equal(response.status, 200);
    return (await response.json()).withdrawal;
  }
  const paid = await withdraw();
  assert.equal(paid.station, 'PC 10');
  assert.equal(paid.username, active.username, 'browser cannot forge member or PC identity');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'captured.json'), 'utf8')).station, 'PC 10');
  assert.match(withdrawalMessage(paid), /^PC: PC 10$/m);
  assert.ok(!withdrawalMessage(paid).includes('PC: PC 1\n'));
  delete active.units;
  fs.writeFileSync(hotspotFile, JSON.stringify(active));
  const unknown = await withdraw();
  assert.equal(unknown.station, 'Unknown PC (10.10.10.10)');
  assert.match(withdrawalMessage(unknown), /^PC: Unknown PC \(10\.10\.10\.10\)$/m);
});