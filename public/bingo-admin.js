(function () {
  'use strict';
  let active = false, polling = false, dirty = false, saving = false, currentVersion = null, currentState = null, interval = null;
  const $ = id => document.getElementById(id);
  const fields = ['bingo-enabled', 'bingo-allow-custom-stake', 'bingo-join-seconds', 'bingo-draw-seconds', 'bingo-max-cards'];
  function getToken() { return window.DenfiGetAdminToken ? window.DenfiGetAdminToken() : null; }
  function configFromForm() {
    return {
      enabled: $('bingo-enabled').checked,
      allowCustomStake: $('bingo-allow-custom-stake').checked,
      joinSeconds: Number($('bingo-join-seconds').value),
      drawSeconds: Number($('bingo-draw-seconds').value),
      maxCardsPerMember: Number($('bingo-max-cards').value)
    };
  }
  function setDirty(value) {
    dirty = value;
    $('bingo-admin-dirty').classList.toggle('visible', dirty);
  }
  function setStatus(text, error) {
    const el = $('bingo-admin-status');
    el.textContent = text;
    el.classList.toggle('error', !!error);
  }
  function usable(state) {
    return !!(state && state.success && state.connected && state.supportsBingo === true &&
      Number(state.bingoVersion) === 1 && getToken());
  }
  function supported(state) {
    return !!(state && state.supportsBingo === true && Number(state.bingoVersion) === 1);
  }
  function updateAvailability() {
    const allowed = usable(currentState) && !saving;
    $('bingo-admin-save').disabled = !allowed;
    $('bingo-admin-refresh').disabled = polling;
    $('bingo-admin-cancel').disabled = !allowed || !currentState?.event || !['joining', 'drawing'].includes(currentState.event.phase);
    fields.forEach(id => { $(id).disabled = !currentState?.success || !supported(currentState) || !currentState?.connected; });
  }
  function renderState(state, source) {
    if (!state || !state.success) {
      currentState = state || null;
      setStatus(state?.error || 'No verified state returned by Denfi Points. Nothing was saved locally.', true);
      $('bingo-admin-connection').textContent = !state?.connected ? 'DISCONNECTED' : !supported(state) ? 'OUTDATED' : 'ERROR';
      $('bingo-admin-phase').textContent = 'Unavailable';
      $('bingo-admin-summary').textContent = '—';
      updateAvailability();
      return;
    }
    currentState = state;
    const event = state.event;
    $('bingo-admin-connection').textContent = !state.connected ? 'DISCONNECTED' : !supported(state) ? 'OUTDATED' : 'READY';
    $('bingo-admin-phase').textContent = event ? String(event.phase || 'active').toUpperCase() : 'No event';
    $('bingo-admin-summary').textContent = event ? `${Number(event.pot || 0).toLocaleString()} pts · ${Number(event.players || 0)} players` : 'No live pot';
    const snapshot = $('bingo-admin-snapshot');
    snapshot.hidden = !event;
    if (event) {
      const eventConfig = event.config || {};
      snapshot.textContent = `ACTIVE EVENT SNAPSHOT · ${Number(eventConfig.joinSeconds ?? state.config?.joinSeconds ?? 30)} sec join · ${Number(eventConfig.drawSeconds ?? state.config?.drawSeconds ?? 5)} sec draw · ${Number(eventConfig.maxCardsPerMember ?? state.config?.maxCardsPerMember ?? 100)} cards/member · ${eventConfig.allowCustomStake === false ? 'one card/member' : 'custom amount'}. Global edits apply to the next event; this event's settings do not change.`;
    }
    if (!state.connected) setStatus('Denfi Points is disconnected. Publishing is disabled; no local settings were changed.', true);
    else if (!supported(state)) setStatus('The connected Denfi Points service is outdated or has no Bingo v1 support. Update the central service before publishing.', true);
    else if (source === 'conflict') setStatus('Conflict: shared configuration changed while this editor had unsaved changes. Your edits are preserved; reload central settings before publishing.', true);
    else if (dirty && source === 'poll' && Number(state.version) !== Number(currentVersion)) {
      setStatus('Conflict: central version changed. Your unsaved values are preserved.', true);
    } else if (!dirty || source === 'save' || source === 'manual') {
      setStatus(`Verified central state · version ${state.version}. ${event ? `Event ${event.id} is ${event.phase}.` : 'No event is active.'}`);
    }
    if (dirty && source === 'poll' && Number(state.version) !== Number(currentVersion)) {
      setStatus('Conflict: shared settings changed in Denfi Points. Your editor was not overwritten.', true);
    } else if (!dirty || source === 'save' || source === 'manual') {
      const c = state.config || {};
      $('bingo-enabled').checked = c.enabled !== false;
      $('bingo-allow-custom-stake').checked = c.allowCustomStake !== false;
      $('bingo-join-seconds').value = Number(c.joinSeconds ?? 30);
      $('bingo-draw-seconds').value = Number(c.drawSeconds ?? 3);
      $('bingo-max-cards').value = Number(c.maxCardsPerMember ?? 100);
      currentVersion = state.version;
      if (source === 'save' || source === 'manual') setDirty(false);
    }
    updateAvailability();
  }
  async function readState(source = 'poll') {
    if (polling || !active) return;
    const token = getToken();
    if (!token) {
      currentState = null;
      setStatus('Admin authentication is required to inspect or change Bingo. Sign in, then reopen this tab.', true);
      $('bingo-admin-connection').textContent = 'LOCKED';
      updateAvailability();
      return;
    }
    polling = true; updateAvailability();
    try {
      const response = await fetch('/api/admin/bingo', { credentials: 'include', cache: 'no-store', headers: { 'x-admin-token': token } });
      const state = await response.json().catch(() => ({}));
      if (!response.ok || !state.success) {
        renderState({ ...state, success: false, connected: state.connected, supportsBingo: state.supportsBingo }, source);
        return;
      }
      const conflict = dirty && currentVersion != null && Number(state.version) !== Number(currentVersion);
      renderState(state, conflict ? 'conflict' : source);
    } catch (_) {
      renderState({ success: false, connected: false, error: 'Cannot reach central Bingo state. Retry when the connection returns.' }, source);
    } finally {
      polling = false; updateAvailability();
    }
  }
  function valid(config) {
    return Number.isInteger(config.joinSeconds) && config.joinSeconds >= 30 && config.joinSeconds <= 300
      && Number.isInteger(config.drawSeconds) && config.drawSeconds >= 3 && config.drawSeconds <= 30
      && Number.isInteger(config.maxCardsPerMember) && config.maxCardsPerMember >= 1 && config.maxCardsPerMember <= 1000;
  }
  async function save() {
    if (saving || !usable(currentState)) return;
    const config = configFromForm();
    if (!valid(config)) {
      setStatus('Check the allowed ranges: join 30–300 seconds, draw 3–30 seconds, cards 1–1000.', true); return;
    }
    if (currentVersion == null) { setStatus('Central version is unknown. Refresh before publishing.', true); return; }
    saving = true; updateAvailability(); setStatus('Publishing to Denfi Points and waiting for verified state…');
    try {
      const response = await fetch('/api/admin/bingo', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': getToken() },
        body: JSON.stringify({ config, expectedVersion: currentVersion })
      });
      const state = await response.json().catch(() => ({}));
      if (!response.ok || !state.success) {
        if (response.status === 409 || /version|conflict/i.test(state.error || '')) {
          setStatus('Conflict: central state rejected this version. Your values remain unsaved; refresh central state before retrying.', true);
          void readState('poll');
        } else renderState({ ...state, success: false }, 'save');
        return;
      }
      renderState(state, 'save');
      setStatus(`Published and verified by Denfi Points · version ${state.version}.`);
    } catch (_) {
      setStatus('Publish response uncertain. Refresh central state before retrying; no local save was assumed.', true);
    } finally {
      saving = false; updateAvailability();
    }
  }
  async function cancel() {
    const event = currentState?.event;
    if (!event || !usable(currentState)) return;
    $('bingo-cancel-dialog').hidden = true;
    setStatus('Cancellation sent. Waiting for Denfi Points to verify cancellation and refunds…');
    $('bingo-cancel-confirm').disabled = true;
    try {
      const response = await fetch('/api/admin/bingo/cancel', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': getToken() },
        body: JSON.stringify({ eventId: event.id })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        renderState({ ...result, success: false }, 'cancel');
        return;
      }
      renderState(result, 'manual');
      setStatus('Denfi Points confirmed the event cancellation. Refund handling remains central.');
    } catch (_) { setStatus('Cancellation response uncertain. Refresh central state to verify; do not assume refunds completed.', true); }
    finally { $('bingo-cancel-confirm').disabled = false; updateAvailability(); }
  }
  function activate() {
    active = true;
    if (!interval) interval = setInterval(() => readState('poll'), 1000);
    void readState('manual');
  }
  function deactivate() {
    active = false;
    if (interval) clearInterval(interval);
    interval = null;
  }
  function init() {
    if (!$('bingo-admin-save')) return;
    fields.forEach(id => $(id).addEventListener('input', () => setDirty(true)));
    $('bingo-admin-refresh').addEventListener('click', () => {
      if (dirty && !window.confirm('Reload the verified central configuration and discard your local edits?')) return;
      setDirty(false); void readState('manual');
    });
    $('bingo-admin-save').addEventListener('click', save);
    $('bingo-admin-cancel').addEventListener('click', () => { $('bingo-cancel-dialog').hidden = false; $('bingo-cancel-confirm').focus(); });
    $('bingo-cancel-back').addEventListener('click', () => { $('bingo-cancel-dialog').hidden = true; $('bingo-admin-cancel').focus(); });
    $('bingo-cancel-confirm').addEventListener('click', cancel);
    $('bingo-cancel-dialog').addEventListener('keydown', event => {
      if (event.key === 'Escape') { $('bingo-cancel-dialog').hidden = true; $('bingo-admin-cancel').focus(); }
    });
  }
  window.DenfiBingoAdmin = { activate, deactivate };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
