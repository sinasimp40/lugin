// Isolated browser fixture: never uses the shop's data or payout hardware.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const settings = require('../../src/settings-store');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-manual-preview-'));
process.env.DENFI_TEST_DATA_DIR = dir;
process.env.DENFI_APP_ROLE = 'points';
process.env.DENFI_POINTS_SQLITE = '1';
process.env.NODE_ENV = 'test';
process.env.PORT = process.env.PORT || '5101';
settings.setAppRole('points');
settings.setDataDir(dir);
settings.registerAdmin('ManualPoints-Test-Only');
settings.updateSettings({ computerName: 'DENFI POINTS TEST', attendanceEnabled: false,
  pointRates: [{ id: 'fixture-rate', pesos: 1, points: 1 }] });
require('../../src/coin-log-store').setDataDir(dir);
require('../../src/attendance-store').setDataDir(dir);
require('../../src/order-store').setDataDir(dir);
global.fetch = async () => {
  throw new Error('External calls disabled in manual points test fixture');
};
require('../../server');
const logs = require('../../src/coin-log-store');
const rates = settings.getSettings().pointRates;
logs.appendLog({ username: 'mem-ui-test', amount: 100, ip: 'fixture-one', mac: 'fixture-one' }, rates);
logs.appendLog({ username: 'mem-other-test', amount: 20, ip: 'fixture-two', mac: 'fixture-two' }, rates);
function stop() {
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
console.log('Isolated manual-points fixture on port', process.env.PORT);