// The cash policy uses the shop's UTC+8 calendar, independent of the host's
// timezone. Neither a daily reset nor a restart erases withdrawal history.
const DAY_MS = 86400000;
const OFFSET_MS = 8 * 3600000;
const TIME_ZONE = 'Asia/Manila';

function withdrawalDayBounds(timestamp = Date.now()) {
  if (!Number.isFinite(timestamp)) throw new Error('Invalid withdrawal clock.');
  const start = Math.floor((timestamp + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS;
  const end = start + DAY_MS;
  return { dayKey: new Date(start + OFFSET_MS).toISOString().slice(0, 10),
    start, end, resetAt: end, timeZone: TIME_ZONE };
}

function getDailyUsage(records, username, timestamp = Date.now()) {
  const { dayKey, start, end, resetAt, timeZone } = withdrawalDayBounds(timestamp);
  const used = records.reduce((count, record) => {
    // updatedAt is the durable confirmation time, also set by PAID
    // reconciliation. Notification delivery does not modify it.
    const confirmedAt = Number(record.updatedAt);
    return count + (record.username === username && record.status === 'success' &&
      Number.isFinite(confirmedAt) && confirmedAt >= start && confirmedAt < end ? 1 : 0);
  }, 0);
  return { dayKey, used, resetAt, timeZone };
}

module.exports = { withdrawalDayBounds, getDailyUsage };