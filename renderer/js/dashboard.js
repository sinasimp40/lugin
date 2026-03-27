let currentUser = null;
let pollInterval = null;
let limitTotalSeconds = 0;

// ─── Time Parsing ─────────────────────────────────────────────────────────────

function parseUptime(str) {
  if (!str) return 0;
  let total = 0;
  const w = str.match(/(\d+)w/); if (w) total += parseInt(w[1]) * 7 * 86400;
  const d = str.match(/(\d+)d/); if (d) total += parseInt(d[1]) * 86400;
  const h = str.match(/(\d+)h/); if (h) total += parseInt(h[1]) * 3600;
  const m = str.match(/(\d+)m/); if (m) total += parseInt(m[1]) * 60;
  const s = str.match(/(\d+)s/); if (s) total += parseInt(s[1]);
  return total;
}

function formatHMS(seconds) {
  if (seconds <= 0) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

function formatBytes(bytes) {
  const n = parseInt(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ─── Status bar ───────────────────────────────────────────────────────────────

function showToast(msg, type) {
  const bar = document.getElementById('status-bar');
  bar.textContent = msg;
  bar.className = `status-bar ${type}`;
  bar.classList.remove('hidden');
  clearTimeout(bar._timer);
  bar._timer = setTimeout(() => bar.classList.add('hidden'), 4000);
}

// ─── Countdown ───────────────────────────────────────────────────────────────

function updateCountdown(uptimeSeconds, limitSeconds) {
  const section = document.getElementById('countdown-section');
  const timerEl = document.getElementById('countdown-display');
  const barEl = document.getElementById('countdown-bar');
  const warningEl = document.getElementById('countdown-warning');
  const criticalEl = document.getElementById('countdown-critical');

  if (!limitSeconds || limitSeconds <= 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  const remaining = Math.max(0, limitSeconds - uptimeSeconds);
  timerEl.textContent = formatHMS(remaining);

  const pct = Math.max(0, Math.min(100, (remaining / limitSeconds) * 100));
  barEl.style.width = pct + '%';

  section.classList.remove('warning-mode', 'critical-mode');
  warningEl.classList.add('hidden');
  criticalEl.classList.add('hidden');

  if (remaining <= 0) {
    section.classList.add('critical-mode');
    criticalEl.textContent = '⛔ Session expired! Add time or reconnect.';
    criticalEl.classList.remove('hidden');
    clearInterval(pollInterval);
  } else if (remaining <= 300) {
    section.classList.add('critical-mode');
    criticalEl.textContent = '🚨 CRITICAL — Less than 5 minutes left!';
    criticalEl.classList.remove('hidden');
  } else if (remaining <= 600) {
    section.classList.add('warning-mode');
    warningEl.classList.remove('hidden');
  }
}

// ─── Poll / Refresh ───────────────────────────────────────────────────────────

async function pollSession() {
  if (!currentUser) return;
  const result = await window.api.poll(currentUser.name);
  if (!result.success) return;

  const user = result.user;

  // Status indicator
  const statusEl = document.getElementById('status-display');
  if (result.isActive) {
    statusEl.innerHTML = '<span style="color:#2ecc71">● Online</span>';
  } else {
    statusEl.innerHTML = '<span style="color:#e74c3c">● Offline</span>';
  }

  // Uptime card
  document.getElementById('uptime-display').textContent = user.uptime || '0s';

  // Limit card
  const limitDisplay = user.limitUptime || 'Unlimited';
  document.getElementById('limit-display').textContent = limitDisplay;
  limitTotalSeconds = parseUptime(user.limitUptime);

  // IP
  document.getElementById('ip-display').textContent = user.address || '—';

  // Network stats
  document.getElementById('bytes-in').textContent = formatBytes(user.bytesIn);
  document.getElementById('bytes-out').textContent = formatBytes(user.bytesOut);
  document.getElementById('mac-display').textContent = user.macAddress || '—';

  // Countdown
  const uptimeSec = parseUptime(user.uptime);
  updateCountdown(uptimeSec, limitTotalSeconds);
}

// ─── Add Time ─────────────────────────────────────────────────────────────────

window.addTime = async function(minutes) {
  if (!currentUser) return;
  const btn = event.target;
  btn.disabled = true;
  const result = await window.api.addTime({ username: currentUser.name, additionalMinutes: minutes });
  btn.disabled = false;
  if (result.success) {
    showToast(`✓ Added ${minutes} min. New limit: ${result.newLimit}`, 'success');
    await pollSession();
  } else {
    showToast(result.error || 'Failed to add time.', 'error');
  }
};

window.addTimeCustom = async function() {
  const input = document.getElementById('custom-minutes');
  const mins = parseInt(input.value);
  if (!mins || mins < 1) { showToast('Enter a valid number of minutes.', 'error'); return; }
  if (!currentUser) return;
  const result = await window.api.addTime({ username: currentUser.name, additionalMinutes: mins });
  if (result.success) {
    showToast(`✓ Added ${mins} min. New limit: ${result.newLimit}`, 'success');
    input.value = '';
    await pollSession();
  } else {
    showToast(result.error || 'Failed to add time.', 'error');
  }
};

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const stored = sessionStorage.getItem('currentUser');
  if (!stored) { window.api.navigate('index'); return; }

  currentUser = JSON.parse(stored);

  document.getElementById('dash-username').textContent = currentUser.name;
  document.getElementById('dash-profile').textContent = `Profile: ${currentUser.profile || 'default'}`;
  document.getElementById('uptime-display').textContent = currentUser.uptime || '—';
  document.getElementById('limit-display').textContent = currentUser.limitUptime || 'Unlimited';
  document.getElementById('ip-display').textContent = currentUser.address || '—';
  document.getElementById('mac-display').textContent = currentUser.macAddress || '—';
  document.getElementById('bytes-in').textContent = formatBytes(currentUser.bytesIn);
  document.getElementById('bytes-out').textContent = formatBytes(currentUser.bytesOut);

  if (currentUser.isActive) {
    document.getElementById('status-display').innerHTML = '<span style="color:#2ecc71">● Online</span>';
  }

  limitTotalSeconds = parseUptime(currentUser.limitUptime);
  if (limitTotalSeconds > 0) {
    updateCountdown(parseUptime(currentUser.uptime), limitTotalSeconds);
  }

  document.getElementById('logout-btn').addEventListener('click', async () => {
    clearInterval(pollInterval);
    await window.api.logout(currentUser.name);
    sessionStorage.removeItem('currentUser');
    window.api.resize({ width: 460, height: 620 });
    window.api.navigate('index');
  });

  // Poll every 5 seconds to update live data from router
  await pollSession();
  pollInterval = setInterval(pollSession, 5000);
});
