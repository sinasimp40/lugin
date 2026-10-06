document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('login-form');
  const statusBar = document.getElementById('status-bar');
  const btnText = document.getElementById('btn-text');
  const btnSpinner = document.getElementById('btn-spinner');
  const loginBtn = document.getElementById('login-btn');
  const configHint = document.getElementById('config-hint');

  const cfg = await window.api.getConfig();
  if (!cfg) {
    configHint.classList.remove('hidden');
  } else {
    configHint.classList.add('hidden');
  }

  document.getElementById('go-register').addEventListener('click', (e) => {
    e.preventDefault();
    window.api.resize({ width: 460, height: 680 });
    window.api.navigate('register');
  });

  document.getElementById('go-settings').addEventListener('click', (e) => {
    e.preventDefault();
    window.api.resize({ width: 460, height: 660 });
    window.api.navigate('settings');
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

    if (!username || !password) {
      showStatus('Please enter your username and password.', 'error');
      return;
    }

    loginBtn.disabled = true;
    btnText.classList.add('hidden');
    btnSpinner.classList.remove('hidden');
    statusBar.classList.add('hidden');

    showStatus('Connecting to hotspot...', 'info');

    const result = await window.api.login({ username, password });

    loginBtn.disabled = false;
    btnText.classList.remove('hidden');
    btnSpinner.classList.add('hidden');

    if (result.success) {
      sessionStorage.setItem('currentUser', JSON.stringify(result.user));
      window.api.resize({ width: 460, height: 760 });
      window.api.navigate('dashboard');
    } else {
      showStatus(result.error || 'Login failed.', 'error', result.hint || null);
    }
  });
});
