(() => {
  'use strict';
  // Shared by the session overlay and lock-screen renderer. Each page supplies
  // its own theme stylesheet; toggling never replaces forms or session state.
  const link = document.getElementById('session-halloween-theme');
  if (!link) return;
  let wsThemeVersion = 0;
  let loading = false;
  function apply(theme) {
    if (!['default', 'halloween'].includes(theme)) return;
    link.media = theme === 'halloween' ? 'all' : 'not all';
    document.documentElement.dataset.sessionTheme = theme;
  }
  window.DenfiSessionTheme = { apply(theme) { ++wsThemeVersion; apply(theme); } };
  async function load() {
    if (loading) return;
    loading = true;
    const version = wsThemeVersion;
    try {
      // The kiosk may need up to six seconds to confirm with Points.
      const response = await fetch('/api/session-theme', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      if (response.ok && data.success && version === wsThemeVersion) {
        apply(data.policy?.theme);
        window.DenfiThemeAdmin?.sync(data.policy, data.connected === true);
      }
    } catch (_) { /* Keep the last confirmed style during a connection interruption. */ }
    finally { loading = false; }
  }
  void load();
  // Rehydrate after a WS reconnect or a missed notification, without replacing session state.
  setInterval(load, 5000);
  // Windows can suspend timers while the renderer is hidden. Catch up on resume.
  window.addEventListener('focus', load);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void load();
  });
})();
