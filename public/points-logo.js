(function () {
  'use strict';

  function initPointsLogo(zone, image, schedule = setTimeout, cancel = clearTimeout) {
    if (!zone || !image) return;
    const button = zone.querySelector('.games-zone-btn');
    let ready = image.complete && image.naturalWidth > 0;
    let active = false;
    let timer = null;
    let logoVisible = false;

    function showLogo(value) {
      logoVisible = value;
      if (value) zone.setAttribute('data-logo-phase', 'logo');
      else zone.removeAttribute('data-logo-phase');
      // Do not let a keyboard user activate the temporarily hidden button.
      // Its existing disabled/member-visible state remains untouched.
      if (button) button.inert = value;
    }
    function tick() {
      showLogo(!logoVisible);
      timer = schedule(tick, 5000);
    }
    function sync() {
      const next = ready && zone.classList.contains('active');
      if (next === active) return;
      active = next;
      if (timer !== null) cancel(timer);
      timer = null;
      showLogo(false);
      if (active) timer = schedule(tick, 5000);
    }
    image.addEventListener('load', () => { ready = image.naturalWidth > 0; sync(); });
    image.addEventListener('error', () => { ready = false; sync(); });
    // Balance updates do not restart the five-second cycle.
    const observer = new MutationObserver(sync);
    observer.observe(zone, { attributes: true, attributeFilter: ['class'] });
    sync();
    return function destroy() {
      observer.disconnect();
      if (timer !== null) cancel(timer);
      showLogo(false);
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { initPointsLogo };
  else initPointsLogo(document.getElementById('points-zone'), document.getElementById('points-logo-image'));
})();
