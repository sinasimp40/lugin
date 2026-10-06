'use strict';

// Telegram sendMessage has no idempotency key. Never expire a dispatch record:
// a timeout or a crash after POST may mean the message already exists.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const REVIEW = 'Telegram delivery is uncertain. Automatic resending is paused to prevent duplicates. Check Telegram and the delivery history.';
const validKey = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function createJournal({ getDir, now = Date.now }) {
  function file(key) {
    if (!validKey(key)) throw new Error('Invalid delivery key');
    const dir = path.join(getDir(), 'telegram-delivery');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, key + '.json');
  }
  function read(key) {
    const filename = file(key);
    if (!fs.existsSync(filename)) return null;
    // Corrupt or unreadable guards must fail closed, never become unsent.
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
  }
  function change(key, action) {
    const filename = file(key);
    const lock = filename + '.lock';
    const fd = fs.openSync(lock, 'wx', 0o600);
    try {
      const { record, value } = action(read(key));
      if (record) {
        const temp = filename + '.' + crypto.randomUUID() + '.tmp';
        const recordFd = fs.openSync(temp, 'w', 0o600);
        try {
          fs.writeFileSync(recordFd, JSON.stringify(record));
          fs.fsyncSync(recordFd);
        } finally { fs.closeSync(recordFd); }
        fs.renameSync(temp, filename);
      }
      return value;
    } finally {
      fs.closeSync(fd);
      fs.unlinkSync(lock);
    }
  }
  function claim(input) {
    if (!validKey(input.token) || typeof input.kind !== 'string' || input.kind.length > 40 ||
        typeof input.eventId !== 'string' || input.eventId.length > 200) throw new Error('Invalid delivery claim');
    return change(input.key, current => {
      if (current && (current.state !== 'rejected' || current.retryAt > now())) {
        return { value: { acquired: false, record: current } };
      }
      const record = { key: input.key, token: input.token, kind: input.kind,
        eventId: input.eventId, state: 'sending', createdAt: current?.createdAt || now(),
        updatedAt: now(), attempts: (current?.attempts || 0) + 1 };
      return { record, value: { acquired: true, record } };
    });
  }
  function settle({ key, token, result }) {
    if (!validKey(token) || !result || typeof result.sent !== 'boolean') throw new Error('Invalid delivery receipt');
    if (result.sent && (!Number.isSafeInteger(result.messageId) || result.messageId <= 0)) {
      throw new Error('A sent receipt requires a Telegram message ID');
    }
    return change(key, current => {
      if (!current || current.token !== token) throw new Error('Delivery claim does not match');
      if (current.state === 'sent') return { value: current };
      const record = { ...current, updatedAt: now(), state: result.sent ? 'sent' :
        result.uncertain ? 'uncertain' : 'rejected' };
      if (result.sent) {
        record.messageId = result.messageId;
        record.chatId = String(result.chatId || '');
        delete record.error;
      } else {
        record.error = String(result.error || REVIEW).slice(0, 300);
        record.retryAt = now() + Math.max(0, Math.min(86400, Number(result.retryAfter) || 0)) * 1000;
      }
      return { record, value: record };
    });
  }
  function list() {
    const dir = path.dirname(file('0'.repeat(64)));
    return fs.readdirSync(dir).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => {
      const { token, ...record } = read(name.slice(0, -5));
      return record;
    }).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100);
  }
  return { claim, settle, read, list };
}

function receipt(record) {
  if (record?.state === 'sent') return { sent: true, messageId: record.messageId,
    chatId: record.chatId, deduplicated: true };
  if (record?.state === 'rejected') return { sent: false, error: record.error,
    retryAfter: Math.max(0, Math.ceil((record.retryAt - Date.now()) / 1000)) };
  return { sent: false, uncertain: true, error: REVIEW };
}

function createSender({ journal, getTelegram, coordinator, fetchImpl = fetch }) {
  async function post(config, text, replyMarkup) {
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: config.channelId, text, disable_web_page_preview: true,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
        signal: AbortSignal.timeout(8000),
      });
      const data = await response.json();
      if (response.ok && data.ok === true && Number.isSafeInteger(data.result?.message_id) && data.result.message_id > 0) {
        return { sent: true, messageId: data.result.message_id,
          chatId: String(data.result.chat?.id || config.channelId) };
      }
      // Only an explicit non-5xx rejection is safe to retry.
      if (response.status < 500 && data.ok === false) {
        return { sent: false, error: 'Telegram rejected the message: ' +
          String(data.description || response.status).replaceAll(config.botToken, '[redacted]').slice(0, 200),
        retryAfter: data.parameters?.retry_after || 0 };
      }
    } catch (_) {
      // Never log the exception/URL: fetch errors can contain the bot token.
    }
    return { sent: false, uncertain: true, error: REVIEW };
  }
  return async function send(text, replyMarkup, event = {}) {
    const config = getTelegram();
    if (!config.botToken || !config.channelId) return { sent: false,
      error: 'Telegram bot token and channel ID are not configured' };
    if (!event.localOnly && coordinator?.available && !coordinator.available()) return { sent: false,
      error: 'Connect updated Denfi Points to enable duplicate-protected Telegram delivery.' };
    const key = hash(event.key || 'content:' + text + '\0' + JSON.stringify(replyMarkup || {}));
    const token = crypto.randomBytes(32).toString('hex');
    const shared = event.localOnly ? null : coordinator;
    let claim;
    try { claim = journal.claim({ key, token, kind: event.kind || 'test', eventId: event.id || 'manual-test' }); }
    catch (_) { return { sent: false, error: 'Could not save the delivery guard. No Telegram request was made.' }; }
    if (!claim.acquired) {
      if (shared) {
        try {
          if (claim.record.state === 'sent') {
            // Repair a lost shared receipt without posting again.
            await shared.settle({ key, token: claim.record.token, result: receipt(claim.record) });
          } else {
            const remote = await shared.read(key);
            if (remote?.state === 'sent') {
              journal.settle({ key, token: claim.record.token, result: receipt(remote) });
              return receipt(remote);
            }
          }
        } catch (_) { /* Keep the durable local guard; never resend. */ }
      }
      return receipt(claim.record);
    }
    if (shared) {
      try {
        const remote = await shared.claim({ key, token, kind: event.kind || 'test', eventId: event.id || 'manual-test' });
        if (!remote.acquired) {
          const result = receipt(remote.record);
          journal.settle({ key, token, result });
          return result;
        }
      } catch (error) {
        if ([400, 403, 404, 405].includes(error.status)) {
          const result = { sent: false, error: 'Update/reconnect Denfi Points to enable duplicate-protected Telegram delivery.' };
          journal.settle({ key, token, result });
          return result;
        }
        // The claim itself could have succeeded before its response was lost.
        // No bot request was made here, but do not bypass the shared guard.
        const result = { sent: false, uncertain: true, error:
          'Could not confirm the shared delivery guard. Update/reconnect Denfi Points and check delivery history; resending is paused.' };
        journal.settle({ key, token, result });
        return result;
      }
    }
    const result = await post(config, text, replyMarkup);
    try { journal.settle({ key, token, result }); }
    catch (_) { /* The sending guard remains durable even if saving the receipt fails. */ }
    if (shared) {
      try { await shared.settle({ key, token, result }); }
      catch (_) { /* The local receipt repairs this on retry; never repeat the POST. */ }
    }
    return result;
  };
}

function installRoutes(app, journal, authorize) {
  app.get('/api/sync/telegram-delivery', authorize, (req, res) => {
    try { res.json({ success: true, records: journal.list() }); }
    catch (_) { res.status(503).json({ success: false, error: 'Delivery history is unavailable.' }); }
  });
  for (const action of ['claim', 'settle']) {
    app.post('/api/sync/telegram-delivery/' + action, authorize, (req, res) => {
      try { res.json({ success: true, ...(action === 'claim'
        ? journal.claim(req.body) : { record: journal.settle(req.body) }) }); }
      catch (_) { res.status(409).json({ success: false, error: 'Delivery guard could not be confirmed. Do not resend.' }); }
    });
  }
  app.get('/api/sync/telegram-delivery/:key', authorize, (req, res) => {
    try { res.json({ success: true, record: journal.read(req.params.key) }); }
    catch (_) { res.status(409).json({ success: false, error: 'Delivery history needs operator review.' }); }
  });
}

module.exports = { createJournal, createSender, installRoutes, hash, REVIEW };
