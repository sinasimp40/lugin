document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('settings-form');
  const statusBar = document.getElementById('status-bar');
  const testBtn = document.getElementById('test-btn');
  const testText = document.getElementById('test-text');
  const testSpinner = document.getElementById('test-spinner');
  const testResult = document.getElementById('test-result');

  const existing = await window.api.getConfig();
  if (existing) {
    document.getElementById('router-host').value = existing.host || '';
    document.getElementById('router-port').value = existing.apiPort || 8728;
    document.getElementById('router-user').value = existing.apiUser || '';
  }

  document.getElementById('go-back').addEventListener('click', (e) => {
    e.preventDefault();
    window.api.resize({ width: 460, height: 620 });
    window.api.navigate('index');
  });

  function showStatus(msg, type) {
    statusBar.textContent = msg;
    statusBar.className = `status-bar ${type}`;
    statusBar.classList.remove('hidden');
  }

  function getConfig() {
    return {
      host: document.getElementById('router-host').value.trim(),
      apiPort: parseInt(document.getElementById('router-port').value) || 8728,
      apiUser: document.getElementById('router-user').value.trim(),
      apiPassword: document.getElementById('router-password').value,
    };
  }

  testBtn.addEventListener('click', async () => {
    const config = getConfig();
    if (!config.host || !config.apiUser) {
      showStatus('Enter router IP and username first.', 'error');
      return;
    }
    testBtn.disabled = true;
    testText.classList.add('hidden');
    testSpinner.classList.remove('hidden');
    statusBar.classList.add('hidden');
    testResult.classList.add('hidden');

    const result = await window.api.testConnection(config);
    testBtn.disabled = false;
    testText.classList.remove('hidden');
    testSpinner.classList.add('hidden');

    if (result.success) {
      testResult.innerHTML = `<span style="color:#2ecc71">&#10003; Connected to <strong>${result.identity}</strong></span>`;
      testResult.classList.remove('hidden');
      showStatus('Connection successful!', 'success');
    } else {
      showStatus(`Connection failed: ${result.error}`, 'error');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const config = getConfig();
    if (!config.host || !config.apiUser || !config.apiPassword) {
      showStatus('All fields are required.', 'error');
      return;
    }
    const result = await window.api.testConnection(config);
    if (result.success) {
      showStatus(`Saved! Connected to ${result.identity}`, 'success');
      setTimeout(() => {
        window.api.resize({ width: 460, height: 620 });
        window.api.navigate('index');
      }, 1200);
    } else {
      showStatus(`Cannot connect: ${result.error}`, 'error');
    }
  });
});
