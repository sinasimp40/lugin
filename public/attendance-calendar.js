(() => {
  const modal = document.getElementById('attendance-modal');
  const grid = document.getElementById('attendance-modal-grid');
  const status = document.getElementById('attendance-modal-status');
  const detail = document.getElementById('attendance-modal-detail');
  const source = document.getElementById('attendance-modal-source');
  const monthLabel = document.getElementById('attendance-modal-month');
  const previous = document.getElementById('attendance-modal-prev');
  const next = document.getElementById('attendance-modal-next');
  const closeButton = document.getElementById('attendance-modal-close');
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  let selectedMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let requestId = 0;
  let lastFocus = null;

  function localDay(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }

  function showError(message) {
    status.className = 'attendance-modal-status error';
    status.textContent = message;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => loadMonth(selectedMonth));
    status.appendChild(retry);
  }

  function render(days, selected) {
    grid.replaceChildren();
    const today = localDay(new Date());
    const year = selected.getFullYear();
    const month = selected.getMonth();
      const panel = document.createElement('section');
      panel.className = 'attendance-month';
      panel.setAttribute('aria-label', `${months[month]} ${year}`);
      const weekdays = document.createElement('div');
      weekdays.className = 'attendance-weekdays';
      for (const label of ['S','M','T','W','T','F','S']) {
        const cell = document.createElement('span');
        cell.textContent = label;
        weekdays.appendChild(cell);
      }
      const dates = document.createElement('div');
      dates.className = 'attendance-days';
      const first = new Date(year, month, 1).getDay();
      for (let i = 0; i < first; i++) dates.appendChild(document.createElement('span'));
      const length = new Date(year, month + 1, 0).getDate();
      for (let day = 1; day <= length; day++) {
        const key = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const record = days[key];
        const state = ['completed','incomplete','attended-no-mission','absent','no-mission','upcoming'].includes(record?.status)
          ? record.status : 'no-mission';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = day;
        button.className = `is-${state}${key === today ? ' is-today' : ''}`;
        const dateText = `${months[month]} ${day}, ${year}`;
        const description = state === 'completed' ? 'mission completed' :
          state === 'incomplete' ? 'attended, mission not completed' :
          state === 'attended-no-mission' ? 'attended, no mission that day' :
          state === 'absent' ? 'absent' : state === 'upcoming' ? 'future date' : 'no mission scheduled';
        button.setAttribute('aria-label', `${dateText}: ${description}`);
        button.title = `${dateText}: ${description}`;
        button.addEventListener('click', () => {
          const played = record?.seconds ? `${Math.floor(record.seconds / 60)}m ${record.seconds % 60}s played` : 'No play time recorded';
          const goal = record?.goalSeconds ? ` / ${Math.floor(record.goalSeconds / 60)}m target` : '';
          const reward = state === 'completed' ? ` · +${record.points} points awarded` : '';
          detail.textContent = `${dateText} · ${description} · ${played}${goal}${reward}`;
        });
        dates.appendChild(button);
      }
      panel.append(weekdays, dates);
      grid.appendChild(panel);
  }

  async function loadMonth(selected) {
    selectedMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
    const year = selectedMonth.getFullYear();
    const current = new Date().getFullYear();
    const thisRequest = ++requestId;
    monthLabel.textContent = `${months[selectedMonth.getMonth()]} ${year}`;
    previous.disabled = year === 2000 && selectedMonth.getMonth() === 0;
    next.disabled = year === current && selectedMonth.getMonth() === 11;
    source.textContent = '';
    detail.textContent = 'Choose a date to see your progress.';
    grid.replaceChildren();
    status.className = 'attendance-modal-status';
    status.textContent = 'Loading attendance history...';
    try {
      const response = await fetch(`/api/session/attendance?year=${year}`);
      const payload = await response.json();
      if (thisRequest !== requestId || modal.hidden) return;
      if (!response.ok || !payload.success || payload.year !== year ||
          !payload.days || typeof payload.days !== 'object') {
        throw new Error(payload.error || 'Could not load attendance history.');
      }
      source.textContent = `${payload.username} · ${payload.source === 'denfi-points' ? 'Denfi Points' : 'Local record'}`;
      status.textContent = '';
      render(payload.days, selectedMonth);
    } catch (error) {
      if (thisRequest !== requestId || modal.hidden) return;
      showError(error.message || 'Attendance history is unavailable. Please try again.');
    }
  }

  function close() {
    modal.hidden = true;
    requestId++;
    if (lastFocus?.isConnected) lastFocus.focus();
  }

  function open() {
    if (!document.getElementById('session-panel').classList.contains('attendance-available')) return;
    lastFocus = document.activeElement;
    modal.hidden = false;
    closeButton.focus();
    loadMonth(new Date());
  }

  closeButton.addEventListener('click', close);
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  document.addEventListener('keydown', event => {
    if (modal.hidden) return;
    if (event.key === 'Escape') close();
  });
  previous.addEventListener('click', () => {
    if (selectedMonth.getFullYear() > 2000 || selectedMonth.getMonth() > 0) {
      loadMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1));
    }
  });
  next.addEventListener('click', () => {
    if (selectedMonth.getFullYear() < new Date().getFullYear() || selectedMonth.getMonth() < 11) {
      loadMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1));
    }
  });
  window.DenfiAttendance = { open, close };
})();