document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('register-form');
  const statusBar = document.getElementById('status-bar');
  const btnText = document.getElementById('btn-text');
  const btnSpinner = document.getElementById('btn-spinner');
  const registerBtn = document.getElementById('register-btn');
  const profileSelect = document.getElementById('profile');

  // Load hotspot profiles from router
  const profiles = await window.api.getProfiles();
  if (profiles.success && profiles.profiles.length > 0) {
    profileSelect.innerHTML = profiles.profiles.map(p =>
      `<option value="${p.name}">${p.name}${p.sessionTimeout ? ` (${p.sessionTimeout})` : ''}</option>`
    ).join('');
  }

  document.getElementById('go-login').addEventListener('click', (e) => {
    e.preventDefault();
    window.api.resize({ width: 460, height: 620 });
    window.api.navigate('index');
  });

  function showStatus(msg, type, extra) {
    statusBar.innerHTML = msg + (extra ? `<br><small style="opacity:0.8">${extra}</small>` : '');
    statusBar.className = `status-bar ${type}`;
    statusBar.classList.remove('hidden');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const profile = profileSelect.value;
    const limitUptime = document.getElementById('limit-uptime').value.trim();
    const comment = document.getElementById('comment').value.trim();

    if (!username || !password) {
      showStatus('Username and password are required.', 'error');
      return;
    }
    if (username.length < 3) {
      showStatus('Username must be at least 3 characters.', 'error');
      return;
    }
    if (password !== confirmPassword) {
      showStatus('Passwords do not match.', 'error');
      return;
    }

    registerBtn.disabled = true;
    btnText.classList.add('hidden');
    btnSpinner.classList.remove('hidden');
    statusBar.classList.add('hidden');

    showStatus('Creating account and connecting to hotspot...', 'info');

    const result = await window.api.register({ username, password, profile, limitUptime, comment });

    registerBtn.disabled = false;
    btnText.classList.remove('hidden');
    btnSpinner.classList.add('hidden');

    if (result.success) {
      if (result.warning) {
        showStatus(`Account created! ${result.warning}`, 'warning');
        setTimeout(() => {
          window.api.resize({ width: 460, height: 620 });
          window.api.navigate('index');
        }, 3000);
      } else {
        // Registration + activation succeeded — go straight to dashboard
        sessionStorage.setItem('currentUser', JSON.stringify(result.user));
        window.api.resize({ width: 460, height: 760 });
        window.api.navigate('dashboard');
      }
    } else {
      showStatus(result.error || 'Registration failed.', 'error');
    }
  });
});
