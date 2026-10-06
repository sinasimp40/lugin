const MAX_WITHDRAWAL = 1000;

function defaultWithdrawal() {
  return { enabled: false, min: 1, max: 100, dailyLimit: 0, loginUrl: '', username: '' };
}

function parseWithdrawal(input) {
  if (input?.dailyLimit !== undefined && (!Number.isSafeInteger(input.dailyLimit) ||
      input.dailyLimit < 0 || input.dailyLimit > 1000)) {
    throw new Error('Withdrawals per member per day must be a whole number from 0 to 1000 (0 = no daily limit).');
  }
  if (!input || typeof input.enabled !== 'boolean' ||
      !Number.isSafeInteger(input.min) || input.min < 1 ||
      !Number.isSafeInteger(input.max) || input.max < input.min || input.max > MAX_WITHDRAWAL ||
      typeof input.loginUrl !== 'string' || input.loginUrl.length > 512 ||
      typeof input.username !== 'string' || input.username.length > 120 ||
      (input.password !== undefined && (typeof input.password !== 'string' || input.password.length > 512))) {
    throw new Error('Enter whole-number limits from 1 to 1000, with maximum at least minimum.');
  }
  const loginUrl = input.loginUrl.trim();
  if (loginUrl) {
    let url;
    try { url = new URL(loginUrl); } catch (_) {}
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.search || url.hash || /[\r\n]/.test(loginUrl)) {
      throw new Error('Enter an HTTP or HTTPS Pisonet API login URL without embedded credentials.');
    }
  }
  const username = input.username.trim();
  if (input.enabled && (!loginUrl || !username)) {
    throw new Error('Pisonet API login URL and username are required before enabling withdrawals.');
  }
  return { enabled: input.enabled, min: input.min, max: input.max,
    dailyLimit: input.dailyLimit ?? 0, loginUrl, username };
}

module.exports = { MAX_WITHDRAWAL, defaultWithdrawal, parseWithdrawal };