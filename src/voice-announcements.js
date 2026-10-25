'use strict';

const fs = require('node:fs');
const path = require('node:path');

function identity(value) {
  return typeof value === 'string' && /^[a-z0-9._-]{1,84}$/i.test(value.trim())
    ? value.trim().toLowerCase() : '';
}
function spokenName(value) {
  const member = identity(value);
  if (!member) throw new Error('Invalid announcement username');
  return member.replace(/^mem-/, '').replace(/[_.-]+/g, ' ');
}
function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 7 * 86400) return '';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  const parts = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (minutes) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  if (remainder) parts.push(`${remainder} ${remainder === 1 ? 'second' : 'seconds'}`);
  return parts.join(' and ');
}
function formatAnnouncement(event) {
  const name = event.type === 'extended' ? '' : spokenName(event.username);
  switch (event.type) {
    case 'welcome': return `Hi ${name}, welcome to Den Pie Computer Shop.`;
    case 'logout': return `${name}, you are now logged out. Thank you for visiting Den Pie Computer Shop.`;
    case 'extended': {
      const station = typeof event.station === 'string'
        ? event.station.replace(/[^\w .-]/g, '').trim().slice(0, 64) : '';
      const pc = /^(?:pc|computer)\s*0*(\d{1,3})$/i.exec(station);
      const who = pc ? `PC ${Number(pc[1])}, your` : 'Your';
      const added = duration(event.secondsAdded);
      return `${who} time has been extended${added ? ` by ${added}` : ''}.`;
    }
    case 'win': {
      const multiplier = Number(event.multiplier);
      if (!Number.isFinite(multiplier) || multiplier <= 1 || multiplier > 1000000) {
        throw new Error('Invalid public win multiplier');
      }
      // Deliberately never use balance, payout, stake, or net in a public message.
      return `${name}, you won with a ${multiplier} times multiplier. Congratulations!`;
    }
    case 'loss': {
      const balance = Number(event.balance);
      if (!Number.isFinite(balance) || balance < 0 || balance > 1e12) throw new Error('Invalid private balance');
      return `${name}, you lost this round. Your balance is now ${Number(balance.toFixed(2))} Points.`;
    }
    case 'even': return `${name}, this round ended with a ${Number(event.multiplier)} times multiplier.`;
    case 'order-preparing': return `Your order has been received and is being prepared. Please wait. ${name}.`;
    case 'order-ready': return `Your order is ready for pickup. ${name}.`;
    case 'order-complete': return `Your order is complete. Thank you ${name}.`;
    case 'bingo-start': return 'Bingo Time! A special event has started. Join from your Bingo popup before the countdown ends. One point buys one card.';
    case 'bingo-joined': {
      if (!Number.isSafeInteger(event.cardCount) || event.cardCount < 1 || event.cardCount > 1000)
        throw new Error('Invalid Bingo card count');
      return `${name}, your Bingo bet is confirmed. You have ${event.cardCount} ${event.cardCount === 1 ? 'card' : 'cards'}. Good luck!`;
    }
    case 'bingo-failed': return event.insufficient
      ? `${name}, not enough points for this Bingo entry. Your Bingo invitation is now closed.`
      : `${name}, your Bingo entry was not accepted. Please check the message on your screen.`;
    case 'bingo-cancelled': {
      if (Number.isFinite(event.refundedPoints) && event.refundedPoints > 0)
        return `${name}, Bingo has been cancelled.${event.insufficientParticipants ? ' Not enough participants joined.' : ''} Your ${event.refundedPoints} points have been refunded.`;
      return 'The Bingo event has been cancelled. All accepted bets have been refunded.';
    }
    case 'bingo-call': {
      if (!Number.isInteger(event.number) || event.number < 1 || event.number > 75 ||
          event.letter !== 'BINGO'[Math.floor((event.number - 1) / 15)]) throw new Error('Invalid Bingo call');
      return `${event.letter}. ${event.number}.`;
    }
    case 'bingo-win': {
      if (!Number.isFinite(event.payout) || event.payout <= 0 || event.payout > 1000000 ||
          !Number.isSafeInteger(event.winningCards) || event.winningCards < 1)
        throw new Error('Invalid Bingo prize');
      return `Bingo! ${name}, you won ${Number(event.payout.toFixed(2))} points with ${event.winningCards} winning ${event.winningCards === 1 ? 'card' : 'cards'}. Congratulations!`;
    }
    default: throw new Error('Unknown voice announcement type');
  }
}

// A single instance per PC owns event dedupe, reveal ordering, and a serial audio queue.
// At-most-once is deliberate: do not replay partially played speech after an audio failure.
class KioskVoiceCoordinator {
  constructor({ generate, play, prepare, announce, interrupt, onFinished, seenFile, now = Date.now, log = console.log, maxQueue = 128 }) {
    this.generate = generate;
    this.play = play;
    this.prepare = prepare;
    this.announce = announce;
    this.interrupt = interrupt;
    this.onFinished = onFinished;
    this.currentEvent = null;
    this.bingoMemberships = new Map();
    this.latestBingoCalls = new Map();
    this.finishedBingoRounds = new Set();
    this.sessionEpoch = 0;
    this.now = now;
    this.log = log;
    this.seenFile = seenFile;
    this.maxQueue = maxQueue;
    this.activeUsername = '';
    this.sessionKnown = false;
    this.rendererStateKnown = false;
    this.pendingSpin = null;
    this.revealedSpins = new Set();
    this.heldWins = new Map();
    this.orderStates = new Map();
    this.seen = new Map();
    this.queue = [];
    this.draining = false;
    this.closed = false;
    this.loadSeen();
  }
  loadSeen() {
    if (!this.seenFile) return;
    try {
      if (fs.statSync(this.seenFile).size > 256000) throw new Error('Oversized voice dedupe file');
      const entries = JSON.parse(fs.readFileSync(this.seenFile, 'utf8'));
      if (!Array.isArray(entries)) throw new Error('Invalid voice dedupe file');
      for (const item of entries.slice(-1500)) {
        if (Array.isArray(item) && typeof item[0] === 'string' && item[0].length < 180 &&
            Number.isFinite(item[1]) && this.now() - item[1] < 6 * 3600000) this.seen.set(...item);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') this.log(`[Voice] Dedupe state could not load: ${error.message}`);
    }
  }
  persistSeen() {
    if (!this.seenFile) return;
    try {
      fs.mkdirSync(path.dirname(this.seenFile), { recursive: true });
      const temporary = this.seenFile + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify(Array.from(this.seen.entries())), { mode: 0o600 });
      fs.renameSync(temporary, this.seenFile);
    } catch (error) { this.log(`[Voice] Dedupe state could not save: ${error.message}`); }
  }
  observeStatus(data) {
    if (!data || typeof data.isLogin !== 'boolean') return;
    const next = data.isLogin && Number(data.sessionTimeLeft) > 0 ? identity(data.username) : '';
    if (!this.sessionKnown || next !== this.activeUsername) {
      this.sessionEpoch++;
      this.bingoMemberships.clear();
      this.latestBingoCalls.clear();
      if (this.currentEvent && ['welcome', 'extended', 'loss', 'even', 'order-preparing', 'order-ready', 'order-complete', 'bingo-start', 'bingo-joined', 'bingo-failed', 'bingo-call', 'bingo-cancelled'].includes(this.currentEvent.type)) {
        try { this.interrupt?.(); }
        catch (error) { this.log(`[Voice] Could not stop stale speech: ${error.message}`); }
      }
      this.activeUsername = next;
      this.rendererStateKnown = !next;
      this.pendingSpin = null;
      this.revealedSpins.clear();
      this.orderStates.clear();
      if (next) {
        this.prepareSafely({ type: 'welcome', username: next });
        this.prepareSafely({ type: 'logout', username: next });
      }
      // Wins remain public even when the winning member has logged out.
      for (const [id, event] of this.heldWins) {
        if (!next || identity(event.username) !== next) {
          this.heldWins.delete(id);
          this.enqueue(event);
        }
      }
    }
    this.sessionKnown = true;
  }
  sessionEvent(event) {
    if (!event || !['welcome', 'logout', 'extended'].includes(event.type)) return false;
    if (event.type === 'logout' && identity(event.username) === this.activeUsername &&
        typeof event.id === 'string' && event.id && event.id.length <= 180 &&
        Number.isFinite(event.expiresAt) && event.expiresAt > this.now() && !this.seen.has(event.id)) {
      // Explicit logout can arrive before the later confirmed hotspot sample.
      // Invalidate old private speech immediately, without weakening UI/session trust.
      this.sessionEpoch++;
      if (this.currentEvent && ['welcome', 'extended', 'loss', 'even', 'order-preparing', 'order-ready', 'order-complete'].includes(this.currentEvent.type)) {
        try { this.interrupt?.(); } catch (error) { this.log(`[Voice] Could not stop stale speech: ${error.message}`); }
      }
      this.pendingSpin = null;
      const accepted = this.enqueue(event);
      this.releaseWins();
      return accepted;
    }
    return this.enqueue(event);
  }
  prepareSafely(event) {
    if (this.closed || !this.prepare) return;
    try { this.prepare(event); }
    catch (error) { this.log(`[Voice] Preparation rejected: ${error.message}`); }
  }
  bingoEvent(event) {
    if (!event || !['bingo-start', 'bingo-joined', 'bingo-failed', 'bingo-call', 'bingo-cancelled', 'bingo-win'].includes(event.type)) return false;
    if (typeof event.id !== 'string' || !Number.isFinite(event.expiresAt) || !this.relevant(event)) return false;
    try { formatAnnouncement(event); } catch (_) { return false; }
    const round = event.eventId || event.id.split(':')[1];
    if (!round) return false;
    if (event.type === 'bingo-joined') this.bingoMemberships.set(round,identity(event.username));
    if (event.type === 'bingo-call') {
      // A current, private Points snapshot also restores membership if the
      // once-only join announcement was heard before the voice process restarted.
      if (event.joined === true) this.bingoMemberships.set(round,identity(event.username));
      if (this.bingoMemberships.get(round) !== this.activeUsername ||
          !Number.isSafeInteger(event.callIndex) || event.callIndex < 1 ||
          event.callIndex <= (this.latestBingoCalls.get(round) || 0)) return false;
      this.latestBingoCalls.set(round,event.callIndex);
      const current = this.currentEvent;
      if (current && (
          ['welcome','extended'].includes(current.type) ||
          ['bingo-call','bingo-start','bingo-joined','bingo-failed'].includes(current.type) &&
          (current.eventId || current.id.split(':')[1]) === round)) {
        try { this.interrupt?.(); } catch (_) {}
      }
    }
    if (['bingo-win','bingo-cancelled'].includes(event.type)) {
      this.finishedBingoRounds.add(round);
      if (this.currentEvent?.type?.startsWith('bingo-') &&
          !['bingo-win','bingo-cancelled'].includes(this.currentEvent.type) &&
          (this.currentEvent.eventId || this.currentEvent.id.split(':')[1]) === round) {
        try { this.interrupt?.(); } catch (_) {}
      }
    }
    // Bound per-PC state; membership is also tied to the current member identity.
    for (const collection of [this.bingoMemberships,this.latestBingoCalls,this.finishedBingoRounds])
      while (collection.size > 100) collection.delete(collection.keys().next().value);
    return this.enqueue(event);
  }
  publicWin(win, { replay = false } = {}) {
    if (replay || !win || typeof win.id !== 'string' || win.id.length > 120 ||
        !/^mem-[a-z0-9._-]{1,80}$/i.test(win.username || '') ||
        !Number.isSafeInteger(win.createdAt) || Number(win.multiplier) <= 1 ||
        !Number.isFinite(Number(win.multiplier))) return false;
    const event = {
      id: `win:${win.id}`, spinId: win.id, type: 'win', username: win.username,
      multiplier: Number(win.multiplier), expiresAt: this.now() + 300000
    };
    if (this.seen.has(event.id) || this.heldWins.has(win.id)) return false;
    const own = identity(win.username) === this.activeUsername;
    if (own && (!this.rendererStateKnown ||
        this.pendingSpin && !this.revealedSpins.has(win.id))) {
      if (this.heldWins.size >= 128) this.heldWins.delete(this.heldWins.keys().next().value);
      this.heldWins.set(win.id, event);
      this.prepareSafely(event);
      return true;
    }
    return this.enqueue(event);
  }
  bettingState(message) {
    if (!message || !this.activeUsername || identity(message.username) !== this.activeUsername) return false;
    const phases = ['state', 'begin', 'prepare', 'revealed'];
    if (!phases.includes(message.phase)) return false;
    const validId = value => typeof value === 'string' && /^[a-z0-9:_-]{1,120}$/i.test(value);
    if (message.phase === 'state' || message.phase === 'begin') {
      if (message.requestId && !validId(message.requestId)) return false;
      this.rendererStateKnown = true;
      this.pendingSpin = message.requestId
        ? { requestId: message.requestId, username: this.activeUsername } : null;
      if (!this.pendingSpin) this.releaseWins();
      return true;
    }
    if (!validId(message.spinId) || !validId(message.requestId) ||
        !this.pendingSpin || this.pendingSpin.requestId !== message.requestId) return false;
    const multiplier = Number(message.multiplier), net = Number(message.net), balance = Number(message.balance);
    if (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 1000000 ||
        !Number.isFinite(net) || !Number.isFinite(balance) || balance < 0 ||
        (multiplier > 1 && net < 0) || (multiplier < 1 && net > 0) ||
        (multiplier === 1 && net !== 0)) return false;
    if (message.phase === 'prepare') {
      // Trusted own renderer may prepare audio, but cannot speak or publish a win.
      this.prepareSafely({
        type: multiplier > 1 ? 'win' : net < 0 ? 'loss' : 'even',
        username: message.username, multiplier, balance
      });
      return true;
    }
    this.rendererStateKnown = true;
    this.pendingSpin = null;
    this.revealedSpins.add(message.spinId);
    if (this.revealedSpins.size > 100) this.revealedSpins.delete(this.revealedSpins.values().next().value);
    if (multiplier <= 1) {
      this.enqueue({
        id: `private:${message.spinId}`, type: net < 0 ? 'loss' : 'even',
        username: message.username, multiplier, balance, expiresAt: this.now() + 30000
      });
    }
    // Public wins only originate from the shared Points feed, never renderer IPC.
    this.releaseWins();
    return true;
  }
  releaseWins() {
    for (const [id, event] of this.heldWins) {
      if (this.pendingSpin && !this.revealedSpins.has(id)) continue;
      this.heldWins.delete(id);
      this.enqueue(event);
    }
  }
  relevant(event) {
    if (this.closed || this.now() >= event.expiresAt) return false;
    if (event.type?.startsWith('bingo-')) {
      const round=event.eventId || event.id?.split(':')[1];
      if (!['bingo-win','bingo-cancelled'].includes(event.type) && this.finishedBingoRounds.has(round)) return false;
      if (event.type === 'bingo-call' && event.callIndex < (this.latestBingoCalls.get(round) || 0)) return false;
      if (['bingo-start','bingo-joined'].includes(event.type) && this.latestBingoCalls.has(round)) return false;
    }
    if (event.orderId && ['served', 'cancelled'].includes(this.orderStates.get(event.orderId)) &&
        !(event.type === 'order-complete' && this.orderStates.get(event.orderId) === 'served')) return false;
    if (event.type === 'order-preparing' && this.orderStates.get(event.orderId) === 'ready') return false;
    return !['welcome', 'extended', 'loss', 'even', 'order-preparing', 'order-ready', 'order-complete', 'bingo-start', 'bingo-joined', 'bingo-failed', 'bingo-call', 'bingo-cancelled'].includes(event.type) ||
      identity(event.username) === this.activeUsername &&
      (event.sessionEpoch === undefined || event.sessionEpoch === this.sessionEpoch);
  }
  prepareOrder(order) {
    if (!order || identity(order.username) !== this.activeUsername) return false;
    this.prepareSafely({ type: 'order-preparing', username: order.username });
    this.prepareSafely({ type: 'order-ready', username: order.username });
    this.prepareSafely({ type: 'order-complete', username: order.username });
    return true;
  }
  orderStatus(order) {
    if (!order || !['preparing', 'ready', 'served', 'cancelled'].includes(order.status) ||
        typeof order.id !== 'string' || !/^[a-z0-9]{8,32}$/i.test(order.id) ||
        identity(order.username) !== this.activeUsername) return false;
    if (['served', 'cancelled'].includes(this.orderStates.get(order.id))) return false;
    if (['served', 'cancelled'].includes(order.status)) {
      this.orderStates.set(order.id, order.status);
      if (this.currentEvent?.orderId === order.id) {
        try { this.interrupt?.(); } catch (error) { this.log(`[Voice] Could not stop completed order speech: ${error.message}`); }
      }
      if (order.status === 'cancelled') return true;
      return this.enqueue({ id: `order:${order.id}:served`, type: 'order-complete',
        username: order.username, orderId: order.id, sessionEpoch: this.sessionEpoch,
        expiresAt: Number(order.updatedAt) + 60000 });
    }
    if (this.orderStates.get(order.id) === 'ready' && order.status === 'preparing') return false;
    this.orderStates.set(order.id, order.status);
    if (order.status === 'ready' && this.currentEvent?.type === 'order-preparing' &&
        this.currentEvent.orderId === order.id) this.interrupt?.();
    return this.enqueue({ id: `order:${order.id}:${order.status}`, type: `order-${order.status}`,
      username: order.username, orderId: order.id, sessionEpoch: this.sessionEpoch,
      expiresAt: Number(order.updatedAt) + 60000 });
  }
  enqueue(event) {
    if (this.closed || !event || typeof event.id !== 'string' || !event.id ||
        event.id.length > 180 || !Number.isFinite(event.expiresAt) ||
        this.seen.has(event.id) || !this.relevant(event)) return false;
    let text;
    try { text = formatAnnouncement(event); }
    catch (error) { this.log(`[Voice] Rejected event: ${error.message}`); return false; }
    this.queue = this.queue.filter(item => this.relevant(item.event));
    if (this.queue.length >= this.maxQueue) {
      this.log('[Voice] Queue full; rejected a new announcement rather than interrupting playback');
      return false;
    }
    this.seen.set(event.id, this.now());
    for (const [id, time] of this.seen) {
      if (this.now() - time >= 6 * 3600000 || this.seen.size > 1500) this.seen.delete(id);
    }
    this.persistSeen();
    this.prepareSafely(event);
    const item = { event: { ...event, sessionEpoch: this.sessionEpoch }, text };
    if (['bingo-call','bingo-win','bingo-cancelled'].includes(event.type)) this.queue.unshift(item);
    else this.queue.push(item);
    void this.drain();
    return true;
  }
  async drain() {
    if (this.draining || this.closed) return;
    this.draining = true;
    try {
      while (this.queue.length && !this.closed) {
        const { event, text } = this.queue.shift();
        if (!this.relevant(event)) continue;
        this.currentEvent = event;
        try {
          if (this.announce) {
            await this.announce(event, () => this.relevant(event));
            continue;
          }
          let wav;
          try { wav = await this.generate(text); }
          catch (error) {
            if (!this.relevant(event)) throw error;
            this.log(`[Voice] Synthesis failed, retrying once: ${error.message}`);
            wav = await this.generate(text);
          }
          if (this.relevant(event)) await this.play(wav);
        } catch (error) { this.log(`[Voice] ${event.type} announcement failed: ${error.message}`); }
        finally {
          if (event.type === 'order-ready' && this.relevant(event)) {
            try { this.onFinished?.(event); }
            catch (error) { this.log(`[Voice] Pickup reminder could not start: ${error.message}`); }
          }
          this.currentEvent = null;
        }
      }
    } finally { this.draining = false; }
  }
  close() {
    this.closed = true;
    this.queue.length = 0;
    this.heldWins.clear();
    this.persistSeen();
  }
}

module.exports = { identity, spokenName, duration, formatAnnouncement, KioskVoiceCoordinator };