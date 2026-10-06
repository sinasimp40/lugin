const { randomUUID } = require('node:crypto');
const { stationFromHotspot } = require('./kiosk-station');

const DEFAULT_EVENT_TTL_MS = 30000;
const EXTENSION_JITTER_SECONDS = 5;
const MINUTE_ROUNDING_TOLERANCE_SECONDS = 5;

function normalizedUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function finiteSeconds(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function reportedSecondsAdded(seconds) {
  const nearestMinute = Math.round(seconds / 60) * 60;
  if (nearestMinute > 0 && Math.abs(seconds - nearestMinute) <= MINUTE_ROUNDING_TOLERANCE_SECONDS) {
    return nearestMinute;
  }
  return seconds;
}

class VoiceSessionTracker {
  constructor({
    emit = () => {},
    idFactory = randomUUID,
    now = Date.now,
    stationFromHotspot: getStation = stationFromHotspot,
    eventTtlMs = DEFAULT_EVENT_TTL_MS
  } = {}) {
    this.emit = emit;
    this.idFactory = idFactory;
    this.now = now;
    this.stationFromHotspot = getStation;
    this.eventTtlMs = eventTtlMs;
    this.baseline = null;
    this.explicitLogoutEvent = null;
  }

  reset() {
    this.baseline = null;
    this.explicitLogoutEvent = null;
  }

  explicitLogout(username) {
    const member = normalizedUsername(username);
    if (!member || !this.baseline?.active || member !== this.baseline.username ||
        this.explicitLogoutEvent?.username === member && this.now() < this.explicitLogoutEvent.expiresAt) return false;
    const event = this.createEvent('logout', member, this.baseline.station);
    this.explicitLogoutEvent = event;
    // Keep the confirmed status baseline intact; do not turn a stale active
    // sample into a new welcome while the upstream logout is propagating.
    this.emit(event);
    return true;
  }

  observe(data) {
    if (!data || typeof data.isLogin !== 'boolean') return [];
    const username = data?.isLogin ? normalizedUsername(data.username) : '';
    const timeLeft = finiteSeconds(data?.sessionTimeLeft);
    if (data.isLogin && (!username || timeLeft === null)) return [];
    const current = {
      active: Boolean(data?.isLogin && username && timeLeft !== null && timeLeft > 0),
      username,
      timeLeft,
      station: this.stationFromHotspot(data)
    };

    if (!this.baseline) {
      this.baseline = current;
      return [];
    }

    const previous = this.baseline;
    const events = [];
    const logoutAlreadySpoken = this.explicitLogoutEvent?.username === previous.username &&
      this.now() < this.explicitLogoutEvent.expiresAt;
    if (previous.active && current.active) {
      if (previous.username !== current.username) {
        if (!logoutAlreadySpoken) events.push(this.createEvent('logout', previous.username, previous.station));
        events.push(this.createEvent('welcome', current.username, current.station));
      } else if (previous.timeLeft !== null && current.timeLeft !== null) {
        const increase = current.timeLeft - previous.timeLeft;
        if (increase > EXTENSION_JITTER_SECONDS) {
          events.push(this.createEvent(
            'extended',
            current.username,
            current.station,
            reportedSecondsAdded(increase)
          ));
        }
      }
    } else if (previous.active && !current.active) {
      if (!logoutAlreadySpoken) events.push(this.createEvent('logout', previous.username, previous.station));
    } else if (!previous.active && current.active) {
      events.push(this.createEvent('welcome', current.username, current.station));
    }

    this.baseline = current;
    if (!current.active || this.explicitLogoutEvent?.username !== current.username) this.explicitLogoutEvent = null;
    for (const event of events) this.emit(event);
    return events;
  }

  createEvent(type, username, station, secondsAdded = 0) {
    const createdAt = this.now();
    return {
      id: this.idFactory(),
      type,
      username,
      station,
      secondsAdded,
      createdAt,
      expiresAt: createdAt + this.eventTtlMs
    };
  }
}

module.exports = { VoiceSessionTracker };