(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const allowedMembers = new Set(['mem-demo-pc1', 'mem-demo-pc3', 'mem-demo-empty']);
  const frames = [...document.querySelectorAll('.pc iframe')];
  const cards = [...document.querySelectorAll('.pc')];
  let roomId = '';
  let snapshot = null;
  let busy = false;
  let pollTimer = 0;
  let pollBusy = false;
  let dead = false;

  function safeText(value, fallback = '—') {
    return value == null || value === '' ? fallback : String(value);
  }
  function points(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${Number(number.toFixed(2)).toLocaleString()} pts` : '—';
  }
  function setStatus(message, isError) {
    const status = $('status');
    status.textContent = message;
    status.classList.toggle('error', !!isError);
  }
  function statePhase(state) {
    return state && state.event ? safeText(state.event.phase, 'waiting').toUpperCase() : 'WAITING';
  }
  function updateSnapshot(data) {
    if (!data || typeof data !== 'object') throw new Error('The demo service returned an invalid snapshot.');
    snapshot = data;
    if (data.roomId) roomId = String(data.roomId);
    $('room-label').textContent = roomId ? `ROOM ${roomId}` : 'ROOM NOT READY';
    const state = Array.isArray(data.states) ? data.states[0] : null;
    const event = state && state.event ? state.event : {};
    $('phase').textContent = statePhase(state);
    $('pot').textContent = points(event.pot);
    const called = Array.isArray(event.called) ? event.called : [];
    $('call-count').textContent = `${called.length} / 75`;
    const letters = ['B', 'I', 'N', 'G', 'O'];
    const callLabel = called.length
      ? called.map(n => `${letters[Math.floor((Number(n) - 1) / 15)] || '?'}${n}`).join(' · ')
      : 'none yet';
    $('calls').replaceChildren();
    const callLead = document.createElement('strong');
    callLead.textContent = 'Called: ';
    $('calls').append(callLead, document.createTextNode(callLabel));

    const balances = $('balances');
    balances.replaceChildren();
    const users = Array.isArray(data.members) ? data.members : [];
    users.forEach(member => {
      const row = document.createElement('div');
      row.className = 'member-row';
      const user = document.createElement('span');
      user.textContent = `${safeText(member.username)}${member.station ? ` · ${member.station}` : ''}`;
      const value = document.createElement('strong');
      const balance = data.balances && data.balances[member.username];
      value.textContent = points(balance);
      const payout = (event.winners || []).filter(winner => winner.username === member.username)
        .reduce((sum, winner) => sum + (Number(winner.payout) || 0), 0);
      if (payout > 0) {
        value.textContent += `  ·  +${points(payout)}`;
        value.className = 'paid';
      }
      row.append(user, value);
      balances.append(row);
    });
    $('telegram-text').textContent = typeof data.telegramText === 'string'
      ? data.telegramText : 'No simulated Telegram message is available yet.';
    if (roomId) configureFrames();
    updateButtons();
  }
  async function requestJson(url, options) {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options });
    let data;
    try { data = await response.json(); } catch (_) { throw new Error(`Demo API returned ${response.status} without JSON.`); }
    if (!response.ok || data.success === false) throw new Error(data.error || `Demo API request failed (${response.status}).`);
    return data;
  }
  function frameMember(pc) {
    const selector = $(pc.id === 'pc1' ? 'pc1-member' : 'pc3-member');
    const value = selector.value;
    return allowedMembers.has(value) ? value : 'mem-demo-pc1';
  }
  function applyDock(pc) {
    const desktop = pc.querySelector('.desktop');
    const slot = pc.querySelector('[data-slot]');
    const monitor = pc.querySelector('.monitor');
    const caption = pc.querySelector('[data-dock-label]');
    const placement = pc.querySelector('[data-placement]').value === 'below' ? 'below' : 'above';
    desktop.classList.toggle('below', placement === 'below');
    slot.classList.toggle('below', placement === 'below');
    caption.textContent = `SESSION BAR · DOCK ${placement.toUpperCase()}`;
    // Reparenting an iframe destroys its browsing context, even when its URL
    // is unchanged. Snapshot polling must never move the live session frame.
    if (pc.dataset.placement !== placement) {
      if (placement === 'below') {
        desktop.insertBefore(monitor, slot);
        desktop.insertBefore(slot, caption);
      } else {
        desktop.insertBefore(caption, slot);
        desktop.insertBefore(slot, monitor);
      }
      pc.dataset.placement = placement;
    }
    pc.querySelector('.pc-empty').classList.toggle('active', frameMember(pc) === 'mem-demo-empty');
  }
  function configureFrames() {
    cards.forEach(pc => {
      applyDock(pc);
      pc.dataset.member = frameMember(pc);
      const iframe = pc.querySelector('iframe');
      const params = new URLSearchParams({
        preview: '1',
        bingoDemo: '1',
        demoRoom: roomId,
        demoMember: frameMember(pc),
        demoPlacement: pc.querySelector('[data-placement]').value
      });
      const nextSrc = `/session.html?${params.toString()}`;
      if (iframe.getAttribute('src') !== nextSrc) iframe.src = nextSrc;
    });
  }
  async function refreshSnapshot() {
    if (!roomId || pollBusy || busy || dead) return;
    pollBusy = true;
    try {
      const data = await requestJson(`/api/demo/bingo/${encodeURIComponent(roomId)}`);
      updateSnapshot(data);
      if ($('status').classList.contains('error')) setStatus('Connected to the in-memory demo room.');
    } catch (error) {
      setStatus(error.message || 'Could not refresh the demo room.', true);
    } finally {
      pollBusy = false;
    }
  }
  function updateButtons() {
    document.querySelectorAll('.action').forEach(button => {
      button.disabled = busy || (!roomId && button.id !== 'start-btn');
    });
  }
  async function createRoom() {
    busy = true;
    updateButtons();
    setStatus('Creating an isolated in-memory room…');
    try {
      const data = await requestJson('/api/demo/bingo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
      });
      updateSnapshot(data);
      setStatus('Ready. Changes stay in the in-memory demo ledger.');
      if (!pollTimer) pollTimer = window.setInterval(refreshSnapshot, 1000);
    } catch (error) {
      setStatus(`${error.message || 'Could not create a demo room.'} Use Start new round to retry.`, true);
    } finally {
      busy = false;
      updateButtons();
    }
  }
  async function control(action, successMessage) {
    if (!roomId || busy) return;
    busy = true;
    updateButtons();
    setStatus('Applying round control…');
    try {
      const data = await requestJson(`/api/demo/bingo/${encodeURIComponent(roomId)}/control`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action })
      });
      updateSnapshot(data);
      setStatus(successMessage);
    } catch (error) {
      setStatus(error.message || 'The round control could not be applied.', true);
    } finally {
      busy = false;
      updateButtons();
    }
  }

  $('start-btn').addEventListener('click', () => {
    if (roomId) control('start', 'Fresh round started; fake balances are isolated from production.');
    else createRoom();
  });
  $('next-btn').addEventListener('click', () => control('next', 'One ball advanced through the game engine.'));
  $('finish-btn').addEventListener('click', () => control('finish', 'Round fast-forwarded to the first winning call.'));
  $('cancel-btn').addEventListener('click', () => control('cancel', 'Round cancelled; demo entry points refunded.'));
  $('example-btn').addEventListener('click', () => control('example', 'Seeded 2-vs-1 example ready. Use Run to winner to complete it.'));
  cards.forEach(pc => {
    pc.querySelector('[data-placement]').addEventListener('change', configureFrames);
  });
  $('pc1-member').addEventListener('change', configureFrames);
  $('pc3-member').addEventListener('change', configureFrames);

  window.addEventListener('message', event => {
    if (event.origin !== location.origin || !frames.some(frame => frame.contentWindow === event.source)) return;
    const data = event.data;
    if (!data || data.type !== 'denfi-overlay-resize') return;
    const frame = frames.find(candidate => candidate.contentWindow === event.source);
    if (!frame) return;
    if (Number.isFinite(Number(data.width)) && Number(data.width) > 0) frame.style.width = `${Number(data.width)}px`;
    if (data.expanded === true && Number.isFinite(Number(data.height)) && Number(data.height) > 0) {
      frame.style.height = `${Number(data.height)}px`;
    } else if (data.expanded === false) {
      frame.style.height = `${Math.ceil(96 * 0.72)}px`;
    }
  });
  window.addEventListener('pagehide', () => {
    dead = true;
    window.clearInterval(pollTimer);
  }, { once: true });
  createRoom();
})();
