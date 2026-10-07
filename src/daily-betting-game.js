const crypto = require('node:crypto');

// Use the Points machine's calendar, matching the shared daily-play allowance.
function dayKey(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return dayKey(Date.now());
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function resolveGame(policy, seed, now = Date.now()) {
  if (policy.game !== 'random') return { game: policy.game || 'wheel', dayKey: null };
  if (typeof seed !== 'string' || !/^[a-f0-9]{64}$/.test(seed)) {
    throw new Error('Daily game selection requires its persisted Points seed.');
  }
  const day = dayKey(now);
  const ticket = crypto.createHmac('sha256', seed).update(`betting-game:${day}`).digest()[0];
  return { game: ticket % 2 === 0 ? 'wheel' : 'dice', dayKey: day };
}

module.exports = { dayKey, resolveGame };
