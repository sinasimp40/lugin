(function () {
  'use strict';

  const PREPARING_MESSAGE = 'Your order has been received and is being prepared. Please wait.';
  const READY_MESSAGE = 'Your order is ready for pickup.';
  const COMPLETE_MESSAGE = 'Your order is complete. Thank you';
  const STATUS_RANK = { pending: 0, preparing: 1, ready: 2, served: 3, cancelled: 3 };
  let activeUsername = '';
  let stack = null;
  let mountTarget = null;
  let sessionPresentation = false;
  let stackChangeQueued = false;
  let completeOrder = null;
  const knownStatuses = new Map();
  const visibleCards = new Map();

  function cleanUsername(value) {
    return String(value || '').trim();
  }
  function usernameKey(value) {
    return cleanUsername(value).toLowerCase();
  }
  function displayName(value) {
    return cleanUsername(value).replace(/^mem-/i, '') || 'Member';
  }
  function normalizeStatus(value) {
    const status = String(value || '').trim().toLowerCase();
    if (status === 'preparing') return 'preparing';
    if (status === 'ready') return 'ready';
    if (status === 'served' || status === 'complete' || status === 'completed') return 'served';
    if (status === 'cancelled' || status === 'canceled') return 'cancelled';
    if (status === 'pending' || status === 'new' || status === 'received') return 'pending';
    return '';
  }
  function orderId(order) {
    if (!order) return '';
    return String(order.id ?? order.orderId ?? order.order_id ?? '').trim();
  }
  function makeKey(username, id) {
    return usernameKey(username) + ':' + id;
  }
  function storageKey(type, username, id, status) {
    return 'denfi-order-' + type + ':' + encodeURIComponent(usernameKey(username)) + ':' + encodeURIComponent(id) + (status ? ':' + status : '');
  }
  function readStoredStatus(username, id) {
    try {
      const stored = sessionStorage.getItem(storageKey('state', username, id));
      return STATUS_RANK[stored] === undefined ? '' : stored;
    } catch (_) { return ''; }
  }
  function storeStatus(username, id, status) {
    try { sessionStorage.setItem(storageKey('state', username, id), status); } catch (_) {}
  }
  function isDismissed(username, id, status) {
    try { return sessionStorage.getItem(storageKey('dismissed', username, id, status)) === '1'; } catch (_) { return false; }
  }
  function markDismissed(username, id, status) {
    try { sessionStorage.setItem(storageKey('dismissed', username, id, status), '1'); } catch (_) {}
  }
  function ensureStack() {
    if (stack && stack.isConnected) return stack;
    stack = document.createElement('div');
    stack.className = 'denfi-order-stack' + (sessionPresentation ? ' denfi-order-stack--session' : '');
    stack.setAttribute('aria-label', 'Order updates');
    stack.setAttribute('aria-live', 'polite');
    stack.setAttribute('aria-relevant', 'additions text');
    (mountTarget && mountTarget.isConnected ? mountTarget : document.body).appendChild(stack);
    return stack;
  }
  function notifyStackChange() {
    if (stackChangeQueued) return;
    stackChangeQueued = true;
    window.requestAnimationFrame(function () {
      stackChangeQueued = false;
      window.dispatchEvent(new CustomEvent('denfi-order-stack-change', {
        detail: {
          count: visibleCards.size,
          height: stack && stack.isConnected ? stack.offsetHeight : 0
        }
      }));
    });
  }
  function safeItems(order) {
    return Array.isArray(order.items) ? order.items.map(function (item) {
      const quantity = Math.max(0, Number(item && item.quantity) || 0);
      const name = String(item && (item.name || item.title) || 'Item');
      return quantity ? quantity + ' × ' + name : '';
    }).filter(Boolean) : [];
  }
  function totalText(order) {
    const amount = Number(order.total ?? order.amount);
    if (!Number.isFinite(amount)) return '';
    const currency = String(order.currency || '₱');
    return currency + (Number.isInteger(amount) ? amount : amount.toFixed(2));
  }
  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function removeCard(key, animate) {
    const card = visibleCards.get(key);
    if (!card) return;
    if (window.DenfiPickupSound) window.DenfiPickupSound.end(card.dataset.orderId);
    visibleCards.delete(key);
    if (animate && card.isConnected) {
      card.classList.add('denfi-order-exit');
      window.setTimeout(function () { card.remove(); notifyStackChange(); }, 190);
    } else {
      card.remove();
      notifyStackChange();
    }
  }
  function render(order, status, username, id, key) {
    removeCard(key, false);
    if (status !== 'ready' && isDismissed(username, id, status)) return;
    const container = ensureStack();
    const card = makeElement('article', 'denfi-order-card');
    card.dataset.status = status;
    card.dataset.orderId = id;
    const top = makeElement('div', 'denfi-order-top');
    const state = makeElement('div', 'denfi-order-state', status === 'ready' ? 'READY FOR PICKUP' : 'PREPARING');
    const close = makeElement('button', 'denfi-order-close', 'X');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss order ' + id + ' update');
    close.addEventListener('click', function () {
      markDismissed(username, id, status);
      removeCard(key, true);
    });
    top.append(state);
    if (status !== 'ready') top.append(close);
    const message = makeElement('p', 'denfi-order-message', status === 'ready' ? READY_MESSAGE : PREPARING_MESSAGE);
    const detail = makeElement('div', 'denfi-order-detail');
    detail.append(
      makeElement('span', 'denfi-order-name', displayName(order.displayName || order.display_name || username)),
      makeElement('span', 'denfi-order-total', totalText(order))
    );
    const items = makeElement('div', 'denfi-order-items', safeItems(order).join('  ·  ') || 'Order details unavailable');
    const reference = makeElement('div', 'denfi-order-id', 'ORDER ' + id);
    card.append(top, message, detail, items, reference);
    if (status === 'ready') {
      const reminder = makeElement('div', 'denfi-order-reminder', 'Pickup beep starts after the announcement.');
      const complete = makeElement('button', 'denfi-order-complete', 'Order complete');
      complete.type = 'button';
      complete.setAttribute('aria-label', 'Order complete ' + id);
      complete.addEventListener('click', async function () {
        if (complete.disabled) return;
        complete.disabled = true;
        complete.textContent = 'Completing…';
        if (window.DenfiPickupSound) window.DenfiPickupSound.end(id);
        try {
          if (!completeOrder) throw new Error('Order completion is not available.');
          const result = await completeOrder(order);
          if (!result || orderId(result) !== id ||
              usernameKey(result.username) !== usernameKey(username) || normalizeStatus(result.status) !== 'served') {
            throw new Error('Order completion was not confirmed. Please try again.');
          }
          // Never close another member's card if the session changed in flight.
          if (usernameKey(activeUsername) !== usernameKey(username)) return;
          update(result);
        } catch (error) {
          if (!card.isConnected || usernameKey(activeUsername) !== usernameKey(username)) return;
          complete.disabled = false;
          complete.textContent = 'Order complete';
          reminder.textContent = error.message || 'Could not complete order. Please try again.';
          reminder.setAttribute('role', 'alert');
          try {
            if (sessionStorage.getItem(storageKey('heard', username, id)) === '1') startReminder(id, username);
          } catch (_) {}
          notifyStackChange();
        }
      });
      card.append(reminder, complete);
    }
    container.appendChild(card);
    visibleCards.set(key, card);
    try {
      if (status === 'ready' && sessionStorage.getItem(storageKey('heard', username, id)) === '1') {
        startReminder(id, username);
      }
    } catch (_) {}
    notifyStackChange();
  }
  function setSession(username) {
    const next = cleanUsername(username);
    if (usernameKey(next) === usernameKey(activeUsername)) {
      activeUsername = next;
      return;
    }
    visibleCards.forEach(function (card) { card.remove(); });
    visibleCards.clear();
    if (window.DenfiPickupSound) window.DenfiPickupSound.clear();
    knownStatuses.clear();
    activeUsername = next;
    notifyStackChange();
  }
  function update(order) {
    if (!order || !activeUsername) return false;
    if (usernameKey(order.username || order.memberUsername || order.member_username) !== usernameKey(activeUsername)) return false;
    const id = orderId(order);
    const status = normalizeStatus(order.status);
    if (!id || !status || status === 'pending') return false;
    const key = makeKey(activeUsername, id);
    const runtimeStatus = knownStatuses.get(key);
    const oldStatus = runtimeStatus || readStoredStatus(activeUsername, id);
    if (oldStatus && STATUS_RANK[oldStatus] > STATUS_RANK[status]) return false;
    if (runtimeStatus === status) return false;
    knownStatuses.set(key, status);
    storeStatus(activeUsername, id, status);
    if (status === 'served' || status === 'cancelled') {
      removeCard(key, false);
      return true;
    }
    render(order, status, activeUsername, id, key);
    return true;
  }
  function clear() {
    visibleCards.forEach(function (card) { card.remove(); });
    visibleCards.clear();
    if (window.DenfiPickupSound) window.DenfiPickupSound.clear();
    notifyStackChange();
  }
  function reconcile(orders) {
    if (!Array.isArray(orders)) return;
    const current = orders.filter(function (order) {
      return usernameKey(order.username) === usernameKey(activeUsername);
    });
    const ids = new Set(current.map(orderId));
    let removed = false;
    visibleCards.forEach(function (card, key) {
      if (!ids.has(card.dataset.orderId)) { removeCard(key, false); removed = true; }
    });
    current.forEach(update);
    if (removed) notifyStackChange();
  }
  function mount(element, presentation) {
    if (!element || !element.appendChild) return;
    mountTarget = element;
    sessionPresentation = presentation === 'session';
    if (sessionPresentation && stack) stack.classList.add('denfi-order-stack--session');
    if (stack && stack.isConnected) element.appendChild(stack);
  }
  function prepare(order) {
    if (!order) return false;
    return update(Object.assign({}, order, { status: 'preparing' }));
  }
  function speechText(order) {
    const username = displayName((order && (order.displayName || order.display_name)) || (order && (order.username || order.memberUsername || order.member_username)))
      .toLowerCase().replace(/[_.-]+/g, ' ');
    const status = normalizeStatus(order && order.status);
    const message = status === 'served' ? COMPLETE_MESSAGE : status === 'ready' ? READY_MESSAGE : PREPARING_MESSAGE;
    return message + ' ' + username + '.';
  }
  function configure(options) {
    completeOrder = options && options.complete;
  }
  function startReminder(id, username) {
    if (!activeUsername || usernameKey(username) !== usernameKey(activeUsername)) return false;
    const key = makeKey(username, String(id));
    const status = knownStatuses.get(key);
    if (status && ['served', 'cancelled'].includes(status)) return false;
    try { sessionStorage.setItem(storageKey('heard', username, String(id)), '1'); } catch (_) {}
    const card = visibleCards.get(key);
    if (!card || card.dataset.status !== 'ready') return false;
    if (card.querySelector('.denfi-order-complete')?.disabled) return false;
    if (window.DenfiPickupSound) window.DenfiPickupSound.begin(String(id));
    const note = card.querySelector('.denfi-order-reminder');
    if (note && !note.hasAttribute('role')) note.textContent = 'Pickup reminder • click Order complete to stop.';
    notifyStackChange();
    return true;
  }

  window.DenfiOrderStatus = { setSession: setSession, update: update, clear: clear, reconcile: reconcile, prepare: prepare, speechText: speechText, mount: mount, configure: configure, startReminder: startReminder };
}());
