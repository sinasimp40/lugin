'use strict';
const crypto = require('node:crypto');
const DEFAULT_CONFIG = { enabled: true, allowCustomStake: true, joinSeconds: 30, drawSeconds: 3, maxCardsPerMember: 100 };
const MAX_EVENT_CARDS = 10000;
const memberRE = /^mem-[a-z0-9._-]{1,80}$/i;
const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
function shuffled(values, randomInt = crypto.randomInt) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function makeCard(randomInt = crypto.randomInt) {
  const columns = Array.from({ length: 5 }, (_, c) =>
    shuffled(Array.from({ length: 15 }, (_, n) => c * 15 + n + 1), randomInt).slice(0, 5));
  const numbers = Array.from({ length: 25 }, (_, i) => columns[i % 5][Math.floor(i / 5)]);
  numbers[12] = null;
  return { id: crypto.randomUUID(), numbers };
}
function wins(card, called) {
  const marked = index => card.numbers[index] === null || called.has(card.numbers[index]);
  for (let i = 0; i < 5; i++) {
    if (Array.from({ length: 5 }, (_, n) => i * 5 + n).every(marked) ||
        Array.from({ length: 5 }, (_, n) => n * 5 + i).every(marked)) return true;
  }
  return [0, 6, 12, 18, 24].every(marked) || [4, 8, 12, 16, 20].every(marked);
}
const ball = number => number ? { letter: 'BINGO'[Math.floor((number - 1) / 15)], number } : null;
function parseConfig(input) {
  if (!input || typeof input.enabled !== 'boolean') fail('Invalid Bingo settings.', 400);
  if (input.allowCustomStake !== undefined && typeof input.allowCustomStake !== 'boolean')
    fail('Allow custom card amount must be enabled or disabled.', 400);
  const limits = { joinSeconds: [30, 300], drawSeconds: [3, 30], maxCardsPerMember: [1, 1000] };
  const output = { enabled: input.enabled, allowCustomStake: input.allowCustomStake !== false };
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (!Number.isSafeInteger(input[key]) || input[key] < min || input[key] > max)
      fail(`${key} must be a whole number from ${min} to ${max}.`, 400);
    output[key] = input[key];
  }
  return output;
}
function createBingoService({ getDb, coinLogs, getRates, now = Date.now, randomInt = crypto.randomInt }) {
  let initializedDb;
  function db() {
    const connection = getDb();
    if (!connection) fail('Update Denfi Points to its database-enabled build before using Bingo.', 503);
    if (initializedDb !== connection) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS bingo_events (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS bingo_commands (
          command_key TEXT PRIMARY KEY, bot_hash TEXT NOT NULL, chat_id TEXT NOT NULL,
          message_id INTEGER NOT NULL, event_id TEXT, error TEXT, edited_version TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS coin_bingo_request ON coin_logs(request_id)
          WHERE source = 'bingo' AND request_id IS NOT NULL;
      `);
      initializedDb = connection;
    }
    return connection;
  }
  function atomic(fn) {
    const connection = db();
    if (connection.isTransaction) return fn();
    connection.exec('BEGIN IMMEDIATE');
    try { const result = fn(); connection.exec('COMMIT'); return result; }
    catch (error) { connection.exec('ROLLBACK'); throw error; }
  }
  function meta(key, fallback) {
    const row = db().prepare('SELECT value FROM metadata WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : fallback;
  }
  function setMeta(key, value) {
    db().prepare('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value));
  }
  function settings() {
    const saved = meta('bingo:config', { version: 1, config: { ...DEFAULT_CONFIG } });
    return { ...saved, config: { ...DEFAULT_CONFIG, ...saved.config } };
  }
  function event(id = meta('bingo:active', null)) {
    const row = id && db().prepare('SELECT payload FROM bingo_events WHERE id=?').get(id);
    return row ? JSON.parse(row.payload) : null;
  }
  function save(event) {
    db().prepare('INSERT INTO bingo_events(id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload')
      .run(event.id, JSON.stringify(event));
  }
  // Ledger entries and event changes always commit in the SAME SQLite transaction.
  function points(username, deltaCents, requestId, eventId, reason) {
    const old = db().prepare("SELECT payload FROM coin_logs WHERE source='bingo' AND request_id=?").get(requestId);
    if (old) {
      const log = JSON.parse(old.payload);
      if (log.username !== username || Math.round(log.points * 100) !== deltaCents)
        fail('Bingo ledger identity conflict.');
      return;
    }
    const balanceCents = Math.round(coinLogs.getMemberPoints(username) * 100);
    if (!Number.isSafeInteger(balanceCents + deltaCents) || balanceCents + deltaCents < 0)
      fail('Not enough points to join.', 400);
    const timestamp = now();
    const log = { id: crypto.randomUUID(), username, amount: 0, points: deltaCents / 100,
      source: 'bingo', requestId, bingoEventId: eventId, reason, timeAdded: reason,
      timestamp, date: new Date(timestamp).toISOString(), ip: '', mac: '' };
    db().prepare(`INSERT INTO coin_logs
      (id,username,timestamp,source,points,amount,request_id,attendance_day,payload)
      VALUES (?,?,?,'bingo',?,0,?,NULL,?)`)
      .run(log.id, username, timestamp, log.points, requestId, JSON.stringify(log));
    setMeta(`memberPoints:${username}`, (balanceCents + deltaCents) / 100);
  }
  function refund(current, reason) {
    for (const participant of current.participants) {
      points(participant.username, participant.stake * 100,
        `bingo-refund:${current.id}:${participant.username}`, current.id, 'Bingo event refund');
    }
    current.phase = 'cancelled'; current.reason = reason; current.finishedAt = now();
    save(current);
  }
  function advance() {
    return atomic(() => {
      const current = event();
      if (!current || !['joining', 'drawing'].includes(current.phase)) return current;
      if (current.participants.length < 2 && (current.phase === 'drawing' || now() >= current.joinClosesAt)) {
        refund(current, 'Not enough participants. At least two members must join. All bets refunded.');
        return current;
      }
      if (current.phase === 'joining' && now() >= current.joinClosesAt) {
        current.phase = 'drawing';
        // Do not fast-forward unseen calls after a Points restart or long outage.
        current.nextDrawAt = now() + current.config.drawSeconds * 1000;
        save(current);
      }
      if (current.phase !== 'drawing' || now() < current.nextDrawAt) return current;
      const number = current.deck[current.called.length];
      if (!number) { refund(current, 'The drawing could not be completed. All bets refunded.'); return current; }
      current.called.push(number);
      current.nextDrawAt = now() + current.config.drawSeconds * 1000;
      const called = new Set(current.called);
      const winning = current.participants.flatMap(p => p.cards.filter(card => wins(card, called))
        .map(card => ({ participant: p, card })));
      if (winning.length) {
        // Whole hundredths preserve the full pot. A shuffled remainder allocation
        // gives no systematic priority to the first PC/member in a simultaneous tie.
        const ordered = shuffled(winning, randomInt);
        const cents = current.pot * 100;
        const base = Math.floor(cents / ordered.length);
        const remainder = cents % ordered.length;
        const groups = new Map();
        ordered.forEach(({ participant: p, card }, i) => {
          const group = groups.get(p.username) || {
            username: p.username, station: p.station, winningCards: 0, payoutCents: 0, cardIds: []
          };
          group.winningCards++; group.cardIds.push(card.id);
          group.payoutCents += base + (i < remainder ? 1 : 0);
          groups.set(p.username, group);
        });
        current.winners = [...groups.values()].map(({ payoutCents, ...winner }) => ({
          ...winner, payout: payoutCents / 100
        }));
        for (const winner of current.winners) {
          points(winner.username, Math.round(winner.payout * 100),
            `bingo-win:${current.id}:${winner.username}`, current.id, 'Bingo prize');
        }
        current.phase = 'finished'; current.finishedAt = now();
      }
      save(current);
      return current;
    });
  }
  function publicEvent(current) {
    if (!current) return null;
    const { deck, participants, config, ...result } = current;
    return { ...result, config: { ...config }, players: participants.length,
      totalCards: participants.reduce((sum, p) => sum + p.cards.length, 0),
      latestCall: ball(current.called.at(-1)) };
  }
  function state(username, offset = 0, eventId) {
    if (username && !memberRE.test(username)) fail('Invalid Bingo member.', 400);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000) fail('Invalid card page.', 400);
    coinLogs.ensurePointsSync(getRates());
    const active = advance();
    const current = eventId ? event(eventId) : active;
    const mine = current?.participants.find(p => p.username === username);
    const winner = current?.winners.find(p => p.username === username);
    return { success: true, supportsBingo: true, supportsCustomStake: true, bingoVersion: 1, connected: true,
      serverNow: now(), ...settings(), event: publicEvent(current),
      participant: mine ? { username, stake: mine.stake, cardCount: mine.cards.length, cardOffset: offset,
        cards: mine.cards.slice(offset), payout: winner?.payout || 0,
        winningCardIds: winner?.cardIds || [] } : null,
      ...(username ? { username, balance: coinLogs.getMemberPoints(username) } : {}) };
  }
  function configure(config, expectedVersion) {
    const parsed = parseConfig(config);
    atomic(() => {
      const saved = settings();
      if (expectedVersion !== saved.version) fail('Bingo settings changed on another PC. Reload before publishing.');
      setMeta('bingo:config', { version: saved.version + 1, config: parsed });
    });
    return state();
  }
  function start({ botHash, chatId, messageId }) {
    if (!/^[a-f0-9]{64}$/.test(botHash || '') || !/^-?\d{1,30}$/.test(String(chatId)) ||
        !Number.isSafeInteger(messageId) || messageId < 1) fail('Invalid Bingo command.', 400);
    const key = `${botHash}:${chatId}:${messageId}`;
    return atomic(() => {
      const previous = db().prepare('SELECT * FROM bingo_commands WHERE command_key=?').get(key);
      if (previous) return { event: publicEvent(event(previous.event_id)), error: previous.error, replayed: true };
      const config = settings().config;
      const active = event();
      const error = !config.enabled ? 'Bingo events are disabled in the BINGO GAME admin settings.' :
        active && ['joining', 'drawing'].includes(active.phase) ? 'A Bingo event is already in progress.' : null;
      let current;
      if (!error) {
        current = { id: crypto.randomUUID(), phase: 'joining', startedAt: now(),
          joinClosesAt: now() + config.joinSeconds * 1000, nextDrawAt: null,
          config, pot: 0, called: [], deck: shuffled(Array.from({ length: 75 }, (_, i) => i + 1), randomInt),
          participants: [], winners: [], finishedAt: null };
        save(current); setMeta('bingo:active', current.id);
      }
      db().prepare(`INSERT INTO bingo_commands
        (command_key,bot_hash,chat_id,message_id,event_id,error) VALUES (?,?,?,?,?,?)`)
        .run(key, botHash, String(chatId), messageId, current?.id || null, error);
      return { event: publicEvent(current || active), error, replayed: false };
    });
  }
  function join({ username, station, eventId, amount, requestId }) {
    username = typeof username === 'string' ? username.trim() : '';
    if (!memberRE.test(username) || !Number.isSafeInteger(amount) || amount < 1 ||
        typeof requestId !== 'string' || !/^[a-z0-9:_-]{8,120}$/i.test(requestId) ||
        typeof station !== 'string' || station.length > 80) fail('Enter a whole-number bet of at least 1 point.', 400);
    coinLogs.ensurePointsSync(getRates());
    const result = atomic(() => {
      const current = event(eventId);
      if (!current) fail('This Bingo event is not available.');
      const oldRequest = db().prepare("SELECT payload FROM coin_logs WHERE source='bingo' AND request_id=?")
        .get(`bingo-join:${requestId}`);
      if (oldRequest) {
        const log = JSON.parse(oldRequest.payload);
        if (log.username !== username || log.bingoEventId !== eventId || log.points !== -amount)
          fail('This bet request was already used for a different entry.');
        return { replayed: true };
      }
      const existing = current.participants.find(p => p.username === username);
      if (existing) {
        if (existing.stake !== amount) fail('You already joined this event. Your original bet cannot be changed.');
        return { replayed: true };
      }
      if (current.phase !== 'joining' || now() >= current.joinClosesAt ||
          meta('bingo:active', null) !== current.id) fail('Bingo joining has closed.');
      if (current.config.allowCustomStake === false && amount !== 1)
        fail('Custom card amounts are disabled for this event. Buy one card for 1 point.', 400);
      if (amount > current.config.maxCardsPerMember) fail(`Maximum ${current.config.maxCardsPerMember} cards per member.`, 400);
      if (current.participants.reduce((sum, p) => sum + p.cards.length, 0) + amount > MAX_EVENT_CARDS)
        fail('This Bingo event has reached its card capacity.');
      if (coinLogs.getUnresolvedWithdrawal(username)) fail('Finish your pending withdrawal before joining Bingo.');
      points(username, -amount * 100, `bingo-join:${requestId}`, current.id, 'Bingo card entry');
      current.participants.push({ username, station, stake: amount,
        cards: Array.from({ length: amount }, () => makeCard(randomInt)) });
      current.pot += amount;
      save(current);
      return { replayed: false };
    });
    return { ...state(username, 0, eventId), ...result };
  }
  function cancel(eventId) {
    coinLogs.ensurePointsSync(getRates());
    atomic(() => {
      const current = event(eventId);
      if (!current) fail('Bingo event not found.');
      if (current.phase === 'cancelled') return;
      if (current.phase === 'finished') fail('A paid Bingo event cannot be cancelled.');
      refund(current, 'Cancelled by the operator. All bets refunded.');
    });
    return state();
  }
  function commandText(command) {
    const current = command.event_id ? event(command.event_id) : null;
    if (!current) return { version: 'error', text: `BINGO TIME\n\nEvent not started\n${command.error || 'Event unavailable.'}` };
    const heading = { joining: 'BINGO EVENT STARTED', drawing: 'BINGO DRAWING LIVE',
      finished: 'BINGO EVENT FINISHED', cancelled: 'BINGO EVENT CANCELLED' }[current.phase];
    const text = [`BINGO TIME!`, heading, '', `Event: ${current.id.slice(0, 8).toUpperCase()}`,
      current.phase === 'joining' ? `Joining closes: ${new Date(current.joinClosesAt).toLocaleTimeString()}` : null,
      '1 point = 1 random card · First row, column or diagonal wins.',
      `Players: ${current.participants.length} · Cards: ${current.pot}`,
      `Prize pool: ${current.pot} points`, '',
      current.participants.length ? 'PLAYERS & BETS:' : null,
      ...current.participants.map(p => `${p.username} (${p.station}) — Bet: ${p.stake} points · ${p.cards.length} card(s)`),
      current.participants.length ? '' : null,
      current.phase === 'joining' ? 'Join from your PC popup before the countdown ends.' : null,
      current.phase === 'drawing' && current.called.length ? `Last call: ${ball(current.called.at(-1)).letter}–${current.called.at(-1)}` : null,
      current.winners.length ? 'WINNERS:' : null,
      ...current.winners.map(w => `Username: ${w.username} (${w.station}) — ${w.payout.toFixed(2)} points · ${w.winningCards} winning card(s)`),
      current.reason || null].filter(line => line !== null).join('\n');
    // Refresh existing message receipts too, including already-finished rounds.
    return { version: `players-v3:${current.phase}:${current.participants.length}:${current.called.length}`, text };
  }
  function edits(botHash) {
    return db().prepare('SELECT * FROM bingo_commands WHERE bot_hash=? ORDER BY rowid DESC LIMIT 50')
      .all(botHash).map(command => {
        const message = commandText(command);
        return { key: command.command_key, chatId: command.chat_id, messageId: command.message_id, ...message,
          needed: command.edited_version !== message.version };
      }).filter(message => message.needed).slice(0, 10);
  }
  function edited(botHash, key, version) {
    db().prepare('UPDATE bingo_commands SET edited_version=? WHERE command_key=? AND bot_hash=?')
      .run(version, key, botHash);
  }
  return { state, configure, start, join, cancel, advance, edits, edited, commandText };
}
module.exports = { createBingoService, makeCard, wins, ball, parseConfig, DEFAULT_CONFIG };
