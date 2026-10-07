(function (root) {
  'use strict';
  const poses = [[0, 0], [0, -90], [-90, 0], [90, 0], [0, 90], [0, 180]];
  const pips = [[5], [1, 9], [1, 5, 9], [1, 3, 7, 9], [1, 3, 5, 7, 9], [1, 3, 4, 6, 7, 9]];
  const waiting = new WeakMap();
  function transform(x, y, lift = 0, tilt = 0) {
    return `translateY(${lift}px) rotateX(${x}deg) rotateY(${y}deg) rotateZ(${tilt}deg)`;
  }
  function build(cube) {
    cube.classList.add('dice-3d');
    cube.setAttribute('role', 'img');
    cube.innerHTML = pips.map((spots, i) =>
      `<span class="dice-face dice-face-${i + 1}" aria-hidden="true">${spots.map(spot =>
        `<i class="dice-pip" style="grid-area:${Math.ceil(spot / 3)}/${(spot - 1) % 3 + 1}"></i>`
      ).join('')}</span>`).join('');
  }
  function stop(cubes) {
    for (const cube of cubes) {
      if (waiting.has(cube)) waiting.get(cube).cancel();
      waiting.delete(cube);
      cube.classList.remove('rolling');
    }
  }
  function begin(cubes, reducedMotion = false) {
    stop(cubes);
    cubes.forEach((cube, index) => {
      build(cube);
      cube.style.transform = transform(0, 0);
      cube.setAttribute('aria-label', `Die ${index + 1} rolling`);
      cube.classList.add('rolling');
      if (!reducedMotion) waiting.set(cube, cube.animate([
        { transform: transform(0, 0) },
        { transform: transform(index ? -360 : 360, 720, -5) }
      ], { duration: 800, iterations: Infinity, easing: 'linear' }));
    });
  }
  async function roll(cubes, values, options = {}) {
    if (cubes.length !== 2 || values.length !== 2 ||
        values.some(value => !Number.isInteger(value) || value < 1 || value > 6)) {
      throw new Error('Two valid dice are required.');
    }
    const reduced = !!options.reducedMotion;
    stop(cubes);
    const animations = [];
    try {
      await Promise.all(cubes.map(async (cube, index) => {
        build(cube);
        const [x, y] = poses[values[index] - 1];
        cube.setAttribute('aria-label', `Die ${index + 1} rolling`);
        cube.classList.add('rolling');
        cube.style.transform = transform(0, 0);
        if (!reduced) {
          const direction = index === 0 ? 1 : -1;
          const animation = cube.animate([
            { transform: transform(0, 0), offset: 0 },
            { transform: transform(720 * direction, 1080, -10, 12 * direction), offset: .3 },
            { transform: transform(1800 * direction, 1800, -3, -7 * direction), offset: .7 },
            { transform: transform(2160 * direction + x, 2160 + y), offset: 1 }
          ], {
            duration: index === 0 ? 3400 : 4000,
            easing: 'cubic-bezier(.16,.58,.36,1)', fill: 'forwards'
          });
          animations.push(animation);
          await animation.finished;
        }
        // Lock each actual server-provided face only when that die lands.
        cube.style.transform = transform(x, y);
        cube.classList.remove('rolling');
        cube.setAttribute('aria-label', `Die ${index + 1}: ${values[index]}`);
      }));
      if (!reduced) await new Promise(resolve => setTimeout(resolve, 200));
    } finally {
      for (const animation of animations) animation.cancel();
      for (const cube of cubes) cube.classList.remove('rolling');
    }
  }
  const api = { begin, stop, roll };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DenfiDiceAnimation = api;
})(typeof window !== 'undefined' ? window : globalThis);
