(() => {
  'use strict';
  const form = document.getElementById('theme-settings-form');
  if (!form) return;
  const select = document.getElementById('admin-session-theme');
  const save = document.getElementById('admin-theme-save');
  const reload = document.getElementById('admin-theme-reload');
  const status = document.getElementById('admin-theme-status');
  let revision = null, busy = false, sequence = 0;
  function controls() { save.disabled = busy || revision === null; reload.disabled = busy; select.disabled = busy || revision === null; }
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
      select.value = value.theme; revision = value.revision;
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
      revision = value.revision; select.value = value.theme;
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
    reset() { ++sequence; revision = null; busy = false; controls(); status.textContent = ''; },
  };
  controls();
})();
