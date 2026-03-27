let allUsers = [];
let allProfiles = [];

function showStatus(msg, type) {
  const bar = document.getElementById('status-bar');
  bar.textContent = msg;
  bar.className = `status-bar ${type}`;
  bar.classList.remove('hidden');
  setTimeout(() => bar.classList.add('hidden'), 4000);
}

function formatUptime(str) {
  return str || '—';
}

function renderUsersTable(users) {
  const wrap = document.getElementById('users-table-wrap');
  if (!users || users.length === 0) {
    wrap.innerHTML = '<div class="loading-msg">No users found.</div>';
    return;
  }

  const rows = users.map(u => `
    <tr>
      <td><strong>${u.name}</strong></td>
      <td><span class="badge badge-gray">${u.profile}</span></td>
      <td>${formatUptime(u.limitUptime)}</td>
      <td>${u.active ? `<span class="badge badge-green">Online</span>` : `<span class="badge badge-gray">Offline</span>`}</td>
      <td>${u.uptime || '—'}</td>
      <td>${u.address || '—'}</td>
      <td>${u.comment || '—'}</td>
      <td>
        <div class="table-actions">
          <button class="btn btn-sm btn-outline" onclick="toggleUser('${u.id}', ${u.disabled})">
            ${u.disabled ? 'Enable' : 'Disable'}
          </button>
          <button class="btn btn-sm btn-danger" onclick="deleteUser('${u.id}', '${u.name}')">Del</button>
        </div>
      </td>
    </tr>
  `).join('');

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Username</th>
          <th>Profile</th>
          <th>Time Limit</th>
          <th>Status</th>
          <th>Uptime</th>
          <th>IP</th>
          <th>Comment</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderActiveTable(sessions) {
  const wrap = document.getElementById('active-table-wrap');
  document.getElementById('active-summary').textContent = `Active sessions: ${sessions.length}`;

  if (!sessions || sessions.length === 0) {
    wrap.innerHTML = '<div class="loading-msg">No active sessions.</div>';
    return;
  }

  const rows = sessions.map(s => `
    <tr>
      <td><strong>${s.user || '—'}</strong></td>
      <td>${s.address || '—'}</td>
      <td>${s['mac-address'] || '—'}</td>
      <td>${s.uptime || '—'}</td>
      <td>${formatBytes(s['bytes-in'] || '0')}</td>
      <td>${formatBytes(s['bytes-out'] || '0')}</td>
      <td>
        <button class="btn btn-sm btn-danger" onclick="disconnectSession('${s['.id']}')">Kick</button>
      </td>
    </tr>
  `).join('');

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>User</th>
          <th>IP</th>
          <th>MAC</th>
          <th>Uptime</th>
          <th>Download</th>
          <th>Upload</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderProfiles(profiles) {
  const wrap = document.getElementById('profiles-wrap');
  if (!profiles || profiles.length === 0) {
    wrap.innerHTML = '<div class="loading-msg">No profiles found.</div>';
    return;
  }

  const cards = profiles.map(p => `
    <div class="profile-card">
      <div class="profile-name">${p.name}</div>
      <div class="profile-stat">Shared Users: ${p.sharedUsers || 1}</div>
      <div class="profile-stat">Session Timeout: ${p.sessionTimeout || 'Unlimited'}</div>
      <div class="profile-stat">Rate Limit: ${p.rateLimit || 'None'}</div>
    </div>
  `).join('');

  wrap.innerHTML = `<div class="profiles-grid">${cards}</div>`;
}

function formatBytes(bytes) {
  if (!bytes || bytes === '0') return '0 B';
  const n = parseInt(bytes);
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

async function loadData() {
  const [usersResult, profilesResult] = await Promise.all([
    window.api.getAllUsers(),
    window.api.getProfiles(),
  ]);

  if (usersResult.success) {
    allUsers = usersResult.users;
    renderUsersTable(allUsers);
  } else {
    document.getElementById('users-table-wrap').innerHTML = `<div class="loading-msg" style="color:#e74c3c">${usersResult.error || 'Failed to load users.'}</div>`;
  }

  if (profilesResult.success) {
    allProfiles = profilesResult.profiles;
    renderProfiles(allProfiles);
    const selects = ['modal-profile'];
    selects.forEach(id => {
      const sel = document.getElementById(id);
      if (sel && allProfiles.length > 0) {
        sel.innerHTML = allProfiles.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
      }
    });
  }

  const activeResult = await window.api.getActiveSessions();
  if (activeResult.success) {
    renderActiveTable(activeResult.sessions);
  }
}

window.deleteUser = async function(id, name) {
  if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return;
  const result = await window.api.deleteUser({ id, username: name });
  if (result.success) {
    showStatus(`User "${name}" deleted.`, 'success');
    await loadData();
  } else {
    showStatus(result.error || 'Failed to delete user.', 'error');
  }
};

window.toggleUser = async function(id, currentlyDisabled) {
  const disable = !currentlyDisabled;
  const result = await window.api.disableUser({ id, disable });
  if (result.success) {
    showStatus(`User ${disable ? 'disabled' : 'enabled'}.`, 'success');
    await loadData();
  } else {
    showStatus(result.error || 'Failed to update user.', 'error');
  }
};

window.disconnectSession = async function(sessionId) {
  const result = await window.api.disconnectUser(sessionId);
  if (result.success) {
    showStatus('Session disconnected.', 'success');
    const activeResult = await window.api.getActiveSessions();
    if (activeResult.success) renderActiveTable(activeResult.sessions);
  } else {
    showStatus(result.error || 'Failed to disconnect.', 'error');
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  await loadData();

  document.getElementById('refresh-btn').addEventListener('click', () => loadData());

  document.getElementById('back-btn').addEventListener('click', () => {
    window.api.resize({ width: 480, height: 640 });
    window.api.navigate('index');
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  document.getElementById('search-users').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = allUsers.filter(u =>
      u.name.toLowerCase().includes(q) || (u.comment || '').toLowerCase().includes(q)
    );
    renderUsersTable(filtered);
  });

  const modal = document.getElementById('user-modal');
  const modalForm = document.getElementById('modal-form');

  document.getElementById('add-user-btn').addEventListener('click', () => {
    document.getElementById('modal-title').textContent = 'Add User';
    modalForm.reset();
    modal.classList.remove('hidden');
  });

  document.getElementById('modal-close').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('modal-cancel').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('modal-overlay').addEventListener('click', () => modal.classList.add('hidden'));

  modalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('modal-username').value.trim();
    const password = document.getElementById('modal-password').value;
    const profile = document.getElementById('modal-profile').value;
    const limitUptime = document.getElementById('modal-limit').value.trim();
    const comment = document.getElementById('modal-comment').value.trim();

    if (!username || !password) {
      showStatus('Username and password required.', 'error');
      return;
    }

    const result = await window.api.register({ username, password, profile, limitUptime, comment });
    if (result.success) {
      showStatus(`User "${username}" created successfully!`, 'success');
      modal.classList.add('hidden');
      await loadData();
    } else {
      showStatus(result.error || 'Failed to create user.', 'error');
    }
  });
});
