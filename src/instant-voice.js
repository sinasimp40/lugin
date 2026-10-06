'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { formatAnnouncement, spokenName, duration } = require('./voice-announcements');

const CUES = Object.freeze({
  welcome: 'Welcome to Den Pie Computer Shop.',
  logout: 'You are now logged out.',
  extended: 'Your time has been extended.',
  win: 'Congratulations! We have a winner.',
  loss: 'You lost this round.',
  even: 'This round has ended.',
  'order-preparing': 'Your order has been received and is being prepared. Please wait.',
  'order-ready': 'Your order is ready for pickup.',
  'order-complete': 'Your order is complete.'
});

function speechParts(event) {
  // Apply the same validation and financial-privacy rules as full announcements.
  formatAnnouncement(event);
  const name = spokenName(event.username);
  let body;
  switch (event.type) {
    case 'welcome': body = `Hi ${name}.`; break;
    case 'logout': body = `${name}, thank you for visiting Den Pie Computer Shop.`; break;
    case 'extended': {
      const station = typeof event.station === 'string'
        ? event.station.replace(/[^\w .-]/g, '').trim().slice(0, 64) : '';
      const pc = /^(?:pc|computer)\s*0*(\d{1,3})$/i.exec(station);
      const added = duration(event.secondsAdded);
      body = added ? `${pc ? `PC ${Number(pc[1])}, ` : ''}${added} has been added.` : '';
      break;
    }
    case 'win': body = `${name}, you won with a ${Number(event.multiplier)} times multiplier.`; break;
    case 'loss': body = `${name}, your balance is now ${Number(Number(event.balance).toFixed(2))} Points.`; break;
    case 'even': body = `${name}, the multiplier is ${Number(event.multiplier)} times.`; break;
    case 'order-preparing':
    case 'order-ready': body = `${name}.`; break;
    case 'order-complete': body = `Thank you ${name}.`; break;
  }
  return { cue: event.type, body };
}

class InstantVoice {
  constructor({ cueDir, generate, play, onUnavailable = () => {} }) {
    this.generate = generate;
    this.play = play;
    this.prepared = new Map();
    this.closed = false;
    this.cues = new Map(Object.keys(CUES).map(type => {
      const loaded = fs.readFile(path.join(cueDir, `${type}.wav`)).then(wav => {
        if (wav.length < 44 || wav.length > 1024 * 1024 ||
            wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
          throw new Error(`Invalid offline ${type} voice cue`);
        }
        return wav;
      });
      loaded.catch(onUnavailable);
      return [type, loaded];
    }));
  }
  prepare(event) {
    if (this.closed) return null;
    const { body } = speechParts(event);
    if (!body) return null;
    if (this.prepared.has(body)) return this.prepared.get(body);
    const record = { bytes: 0 };
    record.promise = Promise.resolve().then(() => this.generate(body)).then(wav => {
      record.bytes = wav.byteLength || 0;
      let bytes = Array.from(this.prepared.values()).reduce((sum, entry) => sum + entry.bytes, 0);
      for (const [key, entry] of this.prepared) {
        if (bytes <= 16 * 1024 * 1024) break;
        this.prepared.delete(key);
        bytes -= entry.bytes;
      }
      return wav;
    });
    this.prepared.set(body, record);
    // Bound RAM as well as the engine's separate persistent disk cache.
    while (this.prepared.size > 32) this.prepared.delete(this.prepared.keys().next().value);
    record.promise.catch(() => {
      if (this.prepared.get(body) === record) this.prepared.delete(body);
    });
    return record;
  }
  async announce(event, relevant) {
    if (this.closed || !relevant()) return;
    const cancelled = Symbol('cancelled');
    let cancel;
    const interrupted = new Promise(resolve => { cancel = () => resolve(cancelled); });
    this.cancelCurrent = cancel;
    try {
      const { cue } = speechParts(event);
      const prepared = this.prepare(event);
      const opening = await Promise.race([this.cues.get(cue), interrupted]);
      if (opening === cancelled || this.closed || !relevant()) return;
      // The opening clip needs no model initialization or inference at event time.
      await Promise.race([this.play(opening), interrupted]);
      if (this.closed || !relevant() || !prepared) return;
      const body = await Promise.race([prepared.promise, interrupted]);
      if (body !== cancelled && !this.closed && relevant()) await this.play(body);
    } finally {
      if (this.cancelCurrent === cancel) this.cancelCurrent = null;
    }
  }
  interrupt() {
    this.cancelCurrent?.();
  }
  close() {
    this.closed = true;
    this.interrupt();
    this.prepared.clear();
  }
}

module.exports = { CUES, speechParts, InstantVoice };