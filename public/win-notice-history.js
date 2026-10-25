(function (window) {
  'use strict';
  const key = 'denfi-shown-win-notices-v1';
  const limit = 200;
  const seen = new Set();
  // HTML samples must not consume the real PC's winner notifications.
  const preview = new URLSearchParams(window.location?.search || '').get('preview') === '1';
  let warned = false;
  function storageError(error) {
    if (!warned) window.console?.warn('[Wins] Popup history could not be saved or read:', error.message);
    warned = true;
  }
  function read() {
    if (preview) return;
    try {
      const saved = JSON.parse(window.localStorage.getItem(key) || '[]');
      if (!Array.isArray(saved)) throw new Error('Invalid winner popup history');
      for (const id of saved.slice(-limit))
        if (typeof id === 'string' && id.length > 0 && id.length <= 180) seen.add(id);
      while (seen.size > limit) seen.delete(seen.values().next().value);
    } catch (error) { storageError(error); }
  }
  window.DenfiWinNotices = {
    isSeen(id) { read(); return seen.has(id); },
    markSeen(id) {
      if (typeof id !== 'string' || !id || id.length > 180) return;
      read();
      seen.delete(id);
      seen.add(id);
      while (seen.size > limit) seen.delete(seen.values().next().value);
      if (!preview) {
        try { window.localStorage.setItem(key, JSON.stringify([...seen])); }
        catch (error) { storageError(error); }
      }
    }
  };
})(window);
