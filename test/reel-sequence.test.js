const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const reel = require('../public/reel-sequence');

function seededRandom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test('reel uses shuffled bags instead of repeating admin order and never mutates settings', () => {
  const values = [0, 1.5, 1.8, 2, 5];
  const original = values.slice();
  const a = reel.build(values, seededRandom(17));
  const b = reel.build(values, seededRandom(71));
  assert.deepEqual(values, original);
  assert.notDeepEqual(a.tiles, b.tiles);
  assert.notDeepEqual(a.tiles.slice(0, 25), Array.from({ length: 25 }, (_, i) => values[i % 5]));
  for (let i = 0; i < a.cycleLength; i += values.length) {
    assert.deepEqual(a.tiles.slice(i, i + values.length).sort((x, y) => x - y), values);
  }
  assert.deepEqual(a.tiles.slice(0, a.cycleLength), a.tiles.slice(a.cycleLength, a.cycleLength * 2),
    'pending loop must wrap without a visible jump');
});

test('random landing slots stay ahead of the reel and leave visible neighbors inside the strip', () => {
  const random = seededRandom(100);
  for (const values of [[0], [2], [0, 2], [0, 1.5, 1.8, 2, 5], Array.from({ length: 12 }, (_, i) => i)]) {
    const sequence = reel.build(values, random);
    const slots = new Set();
    for (let i = 0; i < 100; i++) {
      const fromIndex = 8 + random() * sequence.cycleLength;
      const index = reel.targetIndex(-fromIndex * 82, 82, random);
      slots.add(index - Math.ceil(fromIndex));
      assert.ok(index >= fromIndex + 20);
      assert.ok(index + 4 < sequence.tiles.length);
      assert.ok(index - 4 >= 0);
    }
    assert.ok(slots.size > 1, 'stopping distance is not fixed');
    assert.ok(sequence.tiles.every(value => values.includes(value)));
  }
  assert.throws(() => reel.build([]), /valid reel/);
  assert.throws(() => reel.targetIndex(NaN), /Invalid reel/);
});

test('real renderer builds shuffled tiles and its pending animation uses the full seamless cycle', () => {
  const page = fs.readFileSync(require.resolve('../public/session.html'), 'utf8');
  const start = page.indexOf('    function renderWheel(');
  const end = page.indexOf('    function stopReelRoll()', start);
  const elements = new Map();
  const element = () => ({
    children: [], dataset: {}, style: {}, offsetWidth: 500,
    classList: { remove() {} },
    replaceChildren() { this.children = []; },
    appendChild(child) { this.children.push(child); },
    animate(frames, options) { this.frames = frames; this.options = options; return { cancel() {} }; },
  });
  const context = vm.createContext({
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      },
      createElement: element,
    },
    DenfiReelSequence: reel,
    wheelData: { balance: 20, multipliers: [0, 1.5, 1.8, 2, 5] },
    wheelReelAnimation: null, wheelReelOffset: 0, wheelReelCycleLength: 48,
    wheelSettledStake: null, wheelMoney: String,
    syncWheelStakeInput() {}, updateWheelControls() {}, resizeDrawerToContent() {},
  });
  vm.runInContext(page.slice(start, end), context);
  vm.runInContext('renderWheel(); beginReelRoll(wheelData.multipliers);', context);
  const labels = elements.get('wheel-labels');
  assert.equal(labels.children.length, context.wheelReelCycleLength * 3);
  assert.equal(labels.children.filter(child => child.textContent === 'LOSE 0×').length,
    labels.children.length / 5);
  assert.equal(labels.frames[1].transform,
    `translateX(${context.wheelReelOffset - context.wheelReelCycleLength * 82}px)`);
  assert.equal(labels.options.iterations, Infinity);
  assert.equal(labels.options.duration, context.wheelReelCycleLength * 140);
});

test('compact copy preserves the stake loss warning and server result authority', () => {
  const page = fs.readFileSync(require.resolve('../public/session.html'), 'utf8');
  assert.match(page, /class="pts-label">BALANCE</);
  assert.doesNotMatch(page, /POINTS BALANCE|READY FOR A HIGH-STAKES SPIN|The reel is visual only/);
  assert.match(page, /0× LOSES YOUR STAKE/);
  assert.match(page, /FULL BALANCE AT STAKE/);
  assert.match(page, /const result = Number\(spin\.multiplier\)/);
  assert.match(page, /targetTile\.textContent = result === 0 \? 'LOSE 0×' : `\$\{result\}×`/);
});