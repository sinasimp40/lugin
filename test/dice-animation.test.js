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
  assert.equal(label('high', 7, 0), 'LOSE · SEVEN');
  assert.doesNotMatch(page, /dice-total|dice-sum/);
  assert.match(page, /Roll 2–6 · Win ×2/);
  assert.match(page, /Roll 8–12 · Win ×2/);
  assert.match(page, /\.dice-choice small[^}]+14px\/1\.4/);
  assert.match(page, /\.dice-stage[^}]+justify-content:center/);
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

test('dice tumble for four seconds, stop separately, and finish on the confirmed faces', async () => {
  const cubes = [cube(), cube()];
  let revealed = false;
  const rolling = roll(cubes, [2, 5]).then(() => { revealed = true; });
  assert.equal(cubes[0].animations[0].options.duration, 3400);
  assert.equal(cubes[1].animations[0].options.duration, 4000);
  assert.match(cubes[0].innerHTML, /dice-face-6/);
  assert.equal(cubes[0].attributes['aria-label'], 'Die 1 rolling');
  cubes[0].animations[0].finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cubes[0].attributes['aria-label'], 'Die 1: 2');
  assert.equal(cubes[1].attributes['aria-label'], 'Die 2 rolling');
  assert.equal(revealed, false, 'result stays pending while the second die is rolling');
  cubes[1].animations[0].finish();
  await rolling;
  assert.equal(cubes[1].attributes['aria-label'], 'Die 2: 5');
  assert.match(cubes[0].style.transform, /rotateY\(-90deg\)/);
  assert.match(cubes[1].style.transform, /rotateY\(90deg\)/);
  assert.ok(cubes.every(value => !value.classes.has('rolling') && value.animations[0].cancelled));
});

test('reduced motion displays every valid face without tumbling or suspense delay', async () => {
  for (let value = 1; value <= 6; value++) {
    const cubes = [cube(), cube()];
    await roll(cubes, [value, 7 - value], { reducedMotion: true });
    assert.equal(cubes[0].attributes['aria-label'], `Die 1: ${value}`);
    assert.ok(cubes.every(die => die.animations.length === 0));
  }
  await assert.rejects(roll([cube(), cube()], [0, 7]), /valid dice/);
});

test('request waiting immediately replaces old faces and stops its loop before settling or retry', async () => {
  const cubes = [cube(), cube()];
  begin(cubes);
  assert.ok(cubes.every(die => die.animations[0].options.iterations === Infinity));
  assert.ok(cubes.every(die => die.classes.has('rolling')));
  await roll(cubes, [3, 4], { reducedMotion: true });
  assert.ok(cubes.every(die => die.animations[0].cancelled));
  begin(cubes);
  assert.equal(cubes[0].attributes['aria-label'], 'Die 1 rolling');
  stop(cubes);
  assert.ok(cubes.every(die => !die.classes.has('rolling') && die.animations[1].cancelled));
});
