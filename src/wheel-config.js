const crypto = require('crypto');

const DEFAULT_OUTCOMES = Object.freeze([
  { multiplier: 0, weight: 35 },
  { multiplier: 1.5, weight: 20 },
  { multiplier: 1.8, weight: 20 },
  { multiplier: 2, weight: 15 },
  { multiplier: 5, weight: 10 }
]);

const LEGACY_DEFAULT_OUTCOMES = [
  { multiplier: 0, weight: 35 },
  { multiplier: 0.5, weight: 20 },
  { multiplier: 1, weight: 20 },
  { multiplier: 2, weight: 15 },
  { multiplier: 5, weight: 10 }
];

function defaultWheel() {
  return {
    enabled: true,
    maxSpinsPerDay: 1,
    allowCustomStake: false,
    outcomes: DEFAULT_OUTCOMES.map(item => ({ ...item }))
  };
}

function validHundredths(value) {
  return typeof value === 'number' && Number.isFinite(value) &&
    Math.abs(Math.round(value * 100) - value * 100) < 1e-8;
}

function parseWheel(input) {
  if (!input || typeof input.enabled !== 'boolean' ||
      (input.maxSpinsPerDay !== undefined &&
        (!Number.isInteger(input.maxSpinsPerDay) || input.maxSpinsPerDay < 1 || input.maxSpinsPerDay > 100)) ||
      (input.allowCustomStake !== undefined && typeof input.allowCustomStake !== 'boolean') ||
      !Array.isArray(input.outcomes) || input.outcomes.length < 2 || input.outcomes.length > 12) return null;
  const seen = new Set();
  let total = 0;
  const outcomes = [];
  for (const item of input.outcomes) {
    if (!item || !validHundredths(item.multiplier) || item.multiplier < 0 || item.multiplier > 100 ||
        !validHundredths(item.weight) || item.weight < 0.01 || item.weight > 100 ||
        seen.has(item.multiplier)) return null;
    seen.add(item.multiplier);
    total += Math.round(item.weight * 100);
    outcomes.push({ multiplier: item.multiplier, weight: item.weight });
  }
  return total === 10000 ? {
    enabled: input.enabled,
    maxSpinsPerDay: input.maxSpinsPerDay === undefined ? 1 : input.maxSpinsPerDay,
    allowCustomStake: input.allowCustomStake === undefined ? false : input.allowCustomStake,
    outcomes
  } : null;
}

function currentWheel(input) {
  const wheel = parseWheel(input) || defaultWheel();
  // Upgrade only the exact old default; preserve every operator-customized distribution.
  const wasLegacyDefault = wheel.outcomes.length === LEGACY_DEFAULT_OUTCOMES.length &&
    wheel.outcomes.every((item, index) => item.multiplier === LEGACY_DEFAULT_OUTCOMES[index].multiplier &&
      item.weight === LEGACY_DEFAULT_OUTCOMES[index].weight);
  return wasLegacyDefault ? { ...wheel, outcomes: defaultWheel().outcomes } : wheel;
}

function pickOutcome(outcomes) {
  let ticket = crypto.randomInt(10000);
  for (const outcome of outcomes) {
    ticket -= Math.round(outcome.weight * 100);
    if (ticket < 0) return outcome.multiplier;
  }
  throw new Error('Invalid wheel probability distribution');
}

function oddsToken(wheel) {
  return crypto.createHash('sha256').update(JSON.stringify({
    enabled: wheel.enabled,
    maxSpinsPerDay: wheel.maxSpinsPerDay,
    allowCustomStake: wheel.allowCustomStake,
    outcomes: wheel.outcomes
  })).digest('hex');
}

module.exports = { defaultWheel, currentWheel, parseWheel, pickOutcome, oddsToken };