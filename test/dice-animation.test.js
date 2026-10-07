const test = require('node:test');
const assert = require('node:assert/strict');
const { begin, stop, roll } = require('../public/dice-animation');
const fs = require('node:fs');
const path = require('node:path');

test('dice presentation has readable ranges, centered dice without a total, and explicit win/loss labels', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'session.html'), 'utf8');
  const start = page.indexOf('    function diceOutcomeText(');
  const end = page.indexOf('    function updateWheelControls()', start);
  assert.ok(start >= 0 && end > start);
  const label = new Function(page.slice(start, end) + ';return diceOutcomeText;')();
  assert.equal(label('low', 5, 2), 'WIN ×2 · LOW');
  assert.equal(label('high', 10, 2), 'WIN ×2 · HIGH');
  assert.equal(label('low', 10, 0), 'LOSE · LOW MISSED');
  assert.equal(label('low', 7, 2), 'WIN ×2 · LOW');
  assert.equal(label('high', 7, 0), 'LOSE · HIGH MISSED');
  assert.doesNotMatch(page, /dice-total|dice-sum/);
  assert.match(page, /Roll 2–7 · Win ×2/);
  assert.match(page, /Roll 8–12 · Win ×2/);
  assert.match(page, /\.dice-choice small[^}]+14px\/1\.4/);
  assert.match(page, /\.dice-stage[^}]+justify-content:center/);
});

test('seven wins on LOW, loses on HIGH, and old settled losses are accepted only for recovery', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'session.html'), 'utf8');
  const start = page.indexOf('    function diceReceiptValid(');
  const end = page.indexOf('    function updateWheelControls()', start);
  const valid = new Function(page.slice(start, end) + ';return diceReceiptValid;')();
  const seven = { game: 'dice', dice: [3,4], total: 7, result: 'low', rulesVersion: 2 };
  assert.equal(valid({ ...seven, choice: 'low', multiplier: 2 }, 'low'), true);
  assert.equal(valid({ ...seven, choice: 'high', multiplier: 0 }, 'high'), true);
  assert.equal(valid({ ...seven, choice: 'low', multiplier: 0 }, 'low'), false);
  assert.equal(valid({ ...seven, choice: 'high', multiplier: 2 }, 'high'), false);
  const oldLoss = { ...seven, rulesVersion: undefined, result: 'seven', choice: 'low', multiplier: 0 };
  assert.equal(valid(oldLoss, 'low'), false);
  assert.equal(valid(oldLoss, 'low', true), true);
  assert.equal(valid({ ...oldLoss, rulesVersion: 2 }, 'low', true), false);
  assert.match(page, /wheelData\.diceRules\?\.rulesVersion !== 2/);
  assert.doesNotMatch(page, /2–6 LOW|7 ALWAYS LOSES/);
});

function cube() {
  const classes = new Set();
  const attributes = {};
  return {
    style: {}, innerHTML: '', attributes, classes, animations: [],
    classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
    setAttribute: (key, value) => { attributes[key] = value; },
    animate(frames, options) {
      let finish;
      const animation = {
        frames, options, finished: new Promise(resolve => { finish = resolve; }),
        finish: () => finish(), cancelled: false,
        cancel() { this.cancelled = true; }
      };
      this.animations.push(animation);
      return animation;
    }
  };
}

test('dice tumble for five seconds, stop separately, and finish on the confirmed faces', async t => {
  t.mock.timers.enable({ apis:['setTimeout','setInterval'] });
  const cubes = [cube(), cube()];
  let revealed = false;
  const rolling = roll(cubes, [2, 5]).then(() => { revealed = true; });
  assert.equal(cubes[0].animations[0].options.duration, 4400);
  assert.equal(cubes[1].animations[0].options.duration, 5000);
  assert.match(cubes[0].innerHTML, /dice-face-6/);
  assert.equal(cubes[0].attributes['aria-label'], 'Die 1 rolling');
  cubes[0].animations[0].finish();
  t.mock.timers.tick(4400);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cubes[0].attributes['aria-label'], 'Die 1: 2');
  assert.equal(cubes[1].attributes['aria-label'], 'Die 2 rolling');
  assert.equal(revealed, false, 'result stays pending while the second die is rolling');
  cubes[1].animations[0].finish();
  t.mock.timers.tick(600);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(revealed, false, 'settled result waits until the final reveal');
  t.mock.timers.tick(200);
  await rolling;
  assert.equal(cubes[1].attributes['aria-label'], 'Die 2: 5');
  assert.match(cubes[0].style.transform, /rotateY\(-90deg\)/);
  assert.match(cubes[1].style.transform, /rotateY\(90deg\)/);
  assert.ok(cubes.every(value => !value.classes.has('rolling') && value.animations[0].cancelled));
});

test('Windows reduced motion shuffles faces and keeps the full suspense delay without tumbling', async t => {
  t.mock.timers.enable({ apis:['setTimeout','setInterval'] });
  for (let value = 1; value <= 6; value++) {
    const cubes = [cube(), cube()];
    let revealed = false;
    const rolling = roll(cubes, [value, 7 - value], { reducedMotion: true }).then(() => { revealed = true; });
    const before = cubes[0].style.transform;
    t.mock.timers.tick(240);
    assert.notEqual(cubes[0].style.transform, before, 'faces visibly change while rolling');
    assert.equal(cubes[0].attributes['aria-label'], 'Die 1 rolling');
    assert.equal(revealed, false);
    t.mock.timers.tick(4960);
    await rolling;
    assert.equal(cubes[0].attributes['aria-label'], `Die 1: ${value}`);
    assert.ok(cubes.every(die => die.animations.length === 0));
  }
  await assert.rejects(roll([cube(), cube()], [0, 7]), /valid dice/);
});

test('request waiting immediately replaces old faces and stops its loop before settling or retry', async t => {
  t.mock.timers.enable({ apis:['setTimeout','setInterval'] });
  const cubes = [cube(), cube()];
  begin(cubes);
  assert.ok(cubes.every(die => die.animations[0].options.iterations === Infinity));
  assert.ok(cubes.every(die => die.classes.has('rolling')));
  const rolling = roll(cubes, [3, 4], { reducedMotion: true });
  t.mock.timers.tick(5200);
  await rolling;
  assert.ok(cubes.every(die => die.animations[0].cancelled));
  begin(cubes);
  assert.equal(cubes[0].attributes['aria-label'], 'Die 1 rolling');
  stop(cubes);
  assert.ok(cubes.every(die => !die.classes.has('rolling') && die.animations[1].cancelled));
});

test('a renderer without Web Animations still rolls faces, waits, and stops its waiting loop', async t => {
  t.mock.timers.enable({ apis:['setTimeout','setInterval'] });
  const cubes = [cube(), cube()];
  cubes.forEach(die => { delete die.animate; });
  begin(cubes);
  const before = cubes[0].style.transform;
  t.mock.timers.tick(240);
  assert.notEqual(cubes[0].style.transform, before);
  stop(cubes);
  const stopped = cubes[0].style.transform;
  t.mock.timers.tick(1000);
  assert.equal(cubes[0].style.transform, stopped);
  const rolling = roll(cubes, [6,1]);
  assert.equal(cubes[0].attributes['aria-label'], 'Die 1 rolling');
  t.mock.timers.tick(5200);
  await rolling;
  assert.equal(cubes[0].attributes['aria-label'], 'Die 1: 6');
  assert.equal(cubes[1].attributes['aria-label'], 'Die 2: 1');
  const final = cubes[0].style.transform;
  t.mock.timers.tick(1000);
  assert.equal(cubes[0].style.transform, final, 'shuffle timers are cleaned up after landing');
});
