const test = require('node:test');
const assert = require('node:assert/strict');
const { stationFromHotspot } = require('../src/kiosk-station');

test('station comes from the current hotspot IP, not the first PC or cloned configuration', () => {
  const active = { ip: '10.10.10.10', units: {
    '10.10.10.1': 'PC 1', '10.10.10.10': 'PC 10'
  }, pisonetUnitName: 'PC 1' };
  assert.equal(stationFromHotspot(active), 'PC 10');
  active.ip = '10.10.10.1';
  assert.equal(stationFromHotspot(active), 'PC 1');
  active.ip = ' 10.10.10.10 ';
  assert.equal(stationFromHotspot(active), 'PC 10');
});

test('missing or unusable station mappings report unknown instead of claiming PC 1', () => {
  for (const units of [null, {}, [], { '10.10.10.10': '' }, { '10.10.10.10': {} }]) {
    assert.equal(stationFromHotspot({ ip: '10.10.10.10', units }), 'Unknown PC (10.10.10.10)');
  }
  assert.equal(stationFromHotspot(null), 'Unknown PC');
  assert.equal(stationFromHotspot({ ip: 'bad\nPC 1', units: {} }), 'Unknown PC');
  assert.equal(stationFromHotspot({ ip: '10.10.10.10', units: { '10.10.10.10': ' PC 10\r\n ' } }), 'PC 10');
});