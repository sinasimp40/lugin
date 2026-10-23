(function (root) {
  'use strict';

  function startSessionBrandRotation(zone, image, clock = globalThis) {
    if (!zone || !image) return () => {};
    let timer = null;
    let logoVisible = false;
    function stop() {
      if (timer !== null) clock.clearInterval(timer);
      timer = null;
      logoVisible = false;
      zone.dataset.brandFace = 'balance';
    }
    function start() {
      stop();
      if (!image.naturalWidth) return;
      // Use a real content state, not CSS animation timing. Windows animation
      // preferences, button focus, and hover must not prevent the logo appearing.
      timer = clock.setInterval(() => {
        logoVisible = !logoVisible;
        zone.dataset.brandFace = logoVisible ? 'logo' : 'balance';
      }, 3000);
    }
    image.addEventListener('load', start);
    image.addEventListener('error', stop);
    if (image.complete) start();
    return () => {
      stop();
      image.removeEventListener('load', start);
      image.removeEventListener('error', stop);
    };
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { startSessionBrandRotation };
  } else {
    const dispose = startSessionBrandRotation(
      root.document.getElementById('points-zone'),
      root.document.getElementById('points-brand-logo')
    );
    root.addEventListener('pagehide', dispose, { once: true });
  }
})(globalThis);
