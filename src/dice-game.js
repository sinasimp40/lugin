const crypto = require('node:crypto');

function defaultDice() {
  return { winRate: 50, loseRate: 50, payoutMultiplier: 2 };
}

function parseDice(input) {
  if (!input || input.payoutMultiplier !== 2) return null;
  const valid = value => typeof value === 'number' && Number.isFinite(value) &&
    value >= 0 && value <= 100 &&
    Math.abs(Math.round(value * 100) - value * 100) < 1e-8;
  if (!valid(input.winRate) || !valid(input.loseRate) ||
      Math.round(input.winRate * 100) + Math.round(input.loseRate * 100) !== 10000) return null;
  return { winRate: input.winRate, loseRate: input.loseRate, payoutMultiplier: 2 };
}

function classify(total) {
  return total <= 7 ? 'low' : 'high';
}

// Points chooses the monetary result. The visible dice must agree with that
// result; animation on a kiosk is never allowed to choose a different payout.
function rollDice(choice, policy, randomInt = crypto.randomInt) {
  if (!['high', 'low'].includes(choice) || !parseDice(policy)) {
    throw new Error('Invalid dice choice or winning rates.');
  }
  const won = randomInt(10000) < Math.round(policy.winRate * 100);
  const pairs = [];
  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) {
      if ((classify(a + b) === choice) === won) pairs.push([a, b]);
    }
  }
  const dice = pairs[randomInt(pairs.length)];
  const total = dice[0] + dice[1];
  return { game: 'dice', choice, dice, total, result: classify(total), rulesVersion: 2,
    multiplier: won ? 2 : 0 };
}

function publicDiceRules() {
  return { diceCount: 2, low: [2, 7], high: [8, 12], rulesVersion: 2, payoutMultiplier: 2 };
}

module.exports = { defaultDice, parseDice, classify, rollDice, publicDiceRules };
