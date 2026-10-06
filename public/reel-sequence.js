(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DenfiReelSequence = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function() {
  function build(multipliers, random = Math.random) {
    const values = Array.from(new Set(multipliers.map(Number)));
    if (!values.length || values.some(value => !Number.isFinite(value) || value < 0)) {
      throw new Error('No valid reel multipliers');
    }
    const cycleLength = Math.ceil(48 / values.length) * values.length;
    const cycle = [];
    while (cycle.length < cycleLength) {
      const bag = values.slice();
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      cycle.push(...bag);
    }
    // Identical long cycles make the pending animation loop seamless, while
    // shuffled bags remove the short, predictable admin-order repetition.
    return { cycleLength, tiles: [...cycle, ...cycle, ...cycle] };
  }

  function targetIndex(fromOffset, tileWidth = 82, random = Math.random) {
    if (!Number.isFinite(fromOffset) || !Number.isFinite(tileWidth) || tileWidth <= 0) {
      throw new Error('Invalid reel position');
    }
    // Pick a visual stopping slot only. The Points server still picks the result.
    return Math.ceil(Math.max(0, -fromOffset / tileWidth)) + 20 + Math.floor(random() * 13);
  }
  return { build, targetIndex };
});