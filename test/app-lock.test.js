const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');

function freshAppLock() {
  const modulePath = require.resolve('../src/app-lock');
  delete require.cache[modulePath];
  return require(modulePath);
}

async function availablePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port < 65535 ? port : availablePort();
}

test('Points and Auto Shutdown can hold separate same-PC locks, but duplicates cannot', async () => {
  const previous = process.env.DENFI_LOCK_PORT;
  process.env.DENFI_LOCK_PORT = String(await availablePort());
  const points = freshAppLock();
  const kiosk = freshAppLock();
  const secondPoints = freshAppLock();
  const secondKiosk = freshAppLock();
  try {
    assert.equal(kiosk.lockPortForRole('auto-shutdown'), points.lockPortForRole('points') + 1);
    const pointsDir = path.join('/tmp', 'denfi-points');
    const kioskDir = path.join('/tmp', 'denfi-kiosk');
    assert.equal((await points.acquireLock('points', pointsDir)).acquired, true);
    assert.equal((await kiosk.acquireLock('auto-shutdown', kioskDir)).acquired, true);
    assert.equal((await secondPoints.acquireLock('points', pointsDir)).acquired, false);
    assert.equal((await secondKiosk.acquireLock('auto-shutdown', kioskDir)).acquired, false);
    assert.equal((await kiosk.queryHolder('points')).role, 'points');
    assert.equal((await points.queryHolder('auto-shutdown')).role, 'auto-shutdown');
    assert.equal(points.sameDataDir((await kiosk.queryHolder('points')).dataDir, '/tmp/denfi-points'), true);
    assert.equal(points.sameDataDir((await kiosk.queryHolder('auto-shutdown')).dataDir, '/tmp/denfi-points'), false);
    points.releaseLock();
    kiosk.releaseLock();
    assert.equal((await kiosk.acquireLock('auto-shutdown', kioskDir)).acquired, true);
    assert.equal((await points.acquireLock('points', pointsDir)).acquired, true);
  } finally {
    points.releaseLock();
    kiosk.releaseLock();
    if (previous === undefined) delete process.env.DENFI_LOCK_PORT;
    else process.env.DENFI_LOCK_PORT = previous;
  }
});

test('simultaneous startup publishes both data folders before either app checks for overlap', async () => {
  const previous = process.env.DENFI_LOCK_PORT;
  process.env.DENFI_LOCK_PORT = String(await availablePort());
  const points = freshAppLock();
  const kiosk = freshAppLock();
  try {
    const sameFolder = path.join('/tmp', 'shared-denfi-data');
    const [pointsResult, kioskResult] = await Promise.all([
      points.acquireLock('points', sameFolder),
      kiosk.acquireLock('auto-shutdown', sameFolder)
    ]);
    assert.equal(pointsResult.acquired, true);
    assert.equal(kioskResult.acquired, true);
    assert.equal(points.sameDataDir(sameFolder, (await points.queryHolder('auto-shutdown')).dataDir), true);
    assert.equal(kiosk.sameDataDir(sameFolder, (await kiosk.queryHolder('points')).dataDir), true);
  } finally {
    points.releaseLock();
    kiosk.releaseLock();
    if (previous === undefined) delete process.env.DENFI_LOCK_PORT;
    else process.env.DENFI_LOCK_PORT = previous;
  }
});