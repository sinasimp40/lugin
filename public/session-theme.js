(() => {
  'use strict';
  const link = document.getElementById('session-halloween-theme');
  if (!link) return;
  let wsThemeVersion = 0;
  function apply(theme) {
    if (!['default', 'halloween'].includes(theme)) return;
    link.media = theme === 'halloween' ? 'all' : 'not all';
    document.documentElement.dataset.sessionTheme = theme;
  }
  window.DenfiSessionTheme = { apply(theme) { ++wsThemeVersion; apply(theme); } };
  async function load() {
    const version = wsThemeVersion;
    try {
      const response = await fetch('/api/session-theme', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      const data = await response.json();
      if (response.ok && data.success && version === wsThemeVersion) apply(data.policy?.theme);
    } catch (_) { /* Keep the last confirmed style during a connection interruption. */ }
  }
  void load();
  // Rehydrate after a WS reconnect or a missed notification, without replacing session state.
  setInterval(load, 5000);
})();
