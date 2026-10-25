(() => {
  'use strict';
  const form = document.getElementById('theme-settings-form');
  if (!form) return;
  const select = document.getElementById('admin-session-theme');
  const save = document.getElementById('admin-theme-save');
  const reload = document.getElementById('admin-theme-reload');
  const status = document.getElementById('admin-theme-status');
  const selection = document.getElementById('admin-theme-selection');
  const choices = Array.from(document.querySelectorAll('[data-theme-value]'));
  let revision = null, busy = false, sequence = 0, pending = false;
  const label = value => value === 'halloween' ? 'Halloween' : 'Default';
  function controls() {
    save.disabled = busy || revision === null;
    reload.disabled = busy;
    choices.forEach(button => {
      button.disabled = busy;
      button.setAttribute('aria-pressed', String(button.dataset.themeValue === select.value));
    });
    selection.textContent = 'Selected: ' + label(select.value) + (pending ?
      '. Not published. ' + (revision === null ?
        'Connect Denfi Points in Runtime, reload the selection, then save the shared theme.' :
        'Click Save shared theme to apply this to connected PCs.') :
      '. Choose a theme, then save it to Denfi Points.');
  }
  choices.forEach(button => button.addEventListener('click', () => {
    if (busy) return;
    select.value = button.dataset.themeValue;
    pending = true;
    controls();
  }));
  async function request(options) {
    const token = window.getDenfiAdminToken();
    if (!token) throw new Error('Sign in to the admin panel first.');
    const response = await fetch('/api/admin/session-theme', {
      ...options, headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Could not confirm the shared theme.');
    if (!['default', 'halloween'].includes(data.policy?.theme) || !data.policy.revision) throw new Error('Invalid theme response.');
    return data.policy;
  }
  async function load() {
    const current = ++sequence;
    busy = true; revision = null; controls();
    status.textContent = 'Checking the shared selection on Denfi Points…';
    try {
      const value = await request();
      if (current !== sequence) return;
      window.DenfiSessionTheme?.apply(value.theme);
      if (!pending) select.value = value.theme;
      revision = value.revision;
      status.textContent = 'Active on Denfi Points: ' + (value.theme === 'halloween' ? 'Halloween' : 'Default') + '.';
    } catch (error) {
      if (current === sequence) status.textContent = error.message + ' No change was published.';
    } finally { if (current === sequence) { busy = false; controls(); } }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || revision === null) return;
    const current = ++sequence;
    busy = true; controls(); status.textContent = 'Saving and verifying on Denfi Points…';
    try {
      const value = await request({ method: 'POST',
        body: JSON.stringify({ theme: select.value, expectedRevision: revision }) });
      if (current !== sequence) return;
      window.DenfiSessionTheme?.apply(value.theme);
      revision = value.revision; select.value = value.theme;
      pending = false;
      status.textContent = 'Verified: ' + (value.theme === 'halloween' ? 'Halloween' : 'Default') +
        ' is saved on Denfi Points. Connected PCs apply it automatically, normally within 5 seconds.';
    } catch (error) {
      if (current === sequence) {
        revision = null;
        status.textContent = error.message + ' Reload to confirm the active selection before trying again.';
      }
    } finally { if (current === sequence) { busy = false; controls(); } }
  });
  reload.addEventListener('click', load);
  window.DenfiThemeAdmin = {
    load,
    sync(value, connected) {
      if (busy || !window.getDenfiAdminToken() ||
          !['default', 'halloween'].includes(value?.theme) || !value.revision) return;
      if (!connected) {
        revision = null;
        status.textContent = 'Denfi Points is disconnected. Keeping the last confirmed theme. Automatic updates resume when reconnected.';
      } else {
        const changed = revision !== value.revision;
        revision = value.revision;
        if (!pending) select.value = value.theme;
        if (changed) status.textContent = 'Active on Denfi Points: ' + label(value.theme) +
          '. Selection updated automatically.' + (pending ? ' Your unsaved choice is unchanged.' : '');
      }
      controls();
    },
    reset() { ++sequence; revision = null; busy = false; pending = false; select.value = 'default'; controls(); status.textContent = ''; },
  };
  controls();
})();
