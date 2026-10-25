(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const demoBingo = params.get('preview') === '1' && params.get('bingoDemo') === '1';
  const demoRoom = params.get('demoRoom') || '';
  const demoMember = params.get('demoMember') || '';
  const demoMemberAllowlist = new Set(['mem-demo-pc1', 'mem-demo-pc3', 'mem-demo-empty']);
  const demoRoomValid = /^[A-Za-z0-9_-]{1,100}$/.test(demoRoom);
  const demoMemberValid = demoMemberAllowlist.has(demoMember);
  const preview = params.get('preview') === '1' && ['joining', 'drawing', 'finished', 'insufficient'].includes(params.get('bingo'));
  const inertPreview = params.get('preview') === '1' && !demoBingo && !preview;
  let requestBusy = false, pollBusy = false, alive = true, currentMember = '', currentEvent = '';
  let offset = 0, bingoState = null, refreshTimer = null, countdownTimer = null, lastPhase = '', serverReceivedAt = 0;
  let stakeDefaultEvent = '';
  let deferredTimer = null;
  let cardRenderKey = '';
  let nativeLockSent = null;
  const publicResultIds = new Set();
  const refundNoticeIds = new Set();
  const letters = ['B', 'I', 'N', 'G', 'O'];
  const $ = id => document.getElementById(id);

  function context() {
    return window.DenfiBingoSessionContext ? window.DenfiBingoSessionContext() : { username: '', busy: true };
  }
  function storageKey(member, event) { return `denfi-bingo-seen:${member.toLowerCase()}:${event}`; }
  function requestKey(member, event) { return `denfi-bingo-request:${member.toLowerCase()}:${event}`; }
  function getPromptState(key) {
    try { return localStorage.getItem(key); } catch (_) { return sessionStorage.getItem(key); }
  }
  function setPromptState(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { sessionStorage.setItem(key, value); }
  }
  function clearRequest(member, event) {
    const key = requestKey(member, event);
    sessionStorage.removeItem(key); sessionStorage.removeItem(key + ':amount');
  }
  function getRequestId(member, event, amount) {
    const key = requestKey(member, event);
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = `bingo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      sessionStorage.setItem(key, id);
    }
    if (!sessionStorage.getItem(key + ':amount')) sessionStorage.setItem(key + ':amount', String(amount));
    return id;
  }
  function eventActive(e) { return e && ['joining', 'drawing'].includes(e.phase); }
  function isLocked() {
    return !!bingoState?.participant && eventActive(bingoState.event) &&
      (preview || String(bingoState.username || '').toLowerCase() === String(context().username || '').toLowerCase());
  }
  function syncLock() {
    const locked = !!isLocked();
    document.body?.classList.toggle('bingo-session-locked', locked);
    const logout = $('logout-btn');
    if (logout) logout.disabled = locked;
    if (window.electronAPI?.setBingoSessionLocked && nativeLockSent !== locked) {
      nativeLockSent = locked;
      window.electronAPI.setBingoSessionLocked(locked);
    }
  }
  function setStatus(message, error) {
    const el = $('bingo-status-msg');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('error', !!error);
    el.hidden = !message;
  }
  function requestResize() {
    if (window.DenfiBingoSessionContext) window.DenfiBingoSessionContext().resize();
  }
  function makePreviewState(which, cardOffset = 0) {
    const cardsCount = which === 'drawing' ? 18 : which === 'insufficient' ? 1 : 3;
    const called = which === 'drawing' || which === 'finished' ? [7, 19, 32, 46, 63, 11, 28, 51, 70, 4, 22, 39, 58] : [];
    const numbers = Array.from({ length: 25 }, (_, i) => {
      if (i === 12) return null;
      const col = i % 5, row = Math.floor(i / 5);
      return col * 15 + 1 + ((row * 2 + col * 3 + 1) % 15);
    });
    return {
      success: true, serverNow: Date.now(), version: 1,
      config: { enabled: true, allowCustomStake: params.get('bingoFixedCard') !== '1', joinSeconds: 45, drawSeconds: 7, maxCardsPerMember: 100 },
      event: { id: 'preview-night', phase: which === 'finished' ? 'finished' : which === 'drawing' ? 'drawing' : 'joining',
        startedAt: Date.now() - 24000, joinClosesAt: Date.now() + 21000, nextDrawAt: Date.now() + 6000,
        called, latestCall: called.length ? { letter: 'G', number: called[called.length - 1] } : null,
        pot: 147.5, players: 8, totalCards: 37,
        winners: which === 'finished' ? [{ username: 'mem-ana', station: 'PC 04', winningCards: 2, payout: 73.75, cardIds: ['demo-a', 'demo-b'] }] : [],
        finishedAt: which === 'finished' ? Date.now() : null, reason: '' },
      participant: which === 'insufficient' || which === 'joining' ? null : {
        username: 'mem-preview', stake: 4, cardCount: cardsCount, cardOffset,
        payout: which === 'finished' ? 147.5 : 0, winningCardIds: which === 'finished' ? ['preview-card-1'] : [],
        cards: Array.from({ length: Math.max(cardsCount - cardOffset, 0) }, (_, index) => ({
          id: `preview-card-${cardOffset + index + 1}`, numbers: numbers.slice()
        }))
      }, balance: which === 'insufficient' ? 0 : 36.5
    };
  }
  function fetchState(cardOffset, quiet) {
    if (inertPreview) return Promise.resolve();
    if (!alive) return Promise.resolve();
    if (demoBingo) {
      const session = context();
      const requestedOffset = cardOffset == null ? offset : cardOffset;
      if (!demoRoomValid || !demoMemberValid) {
        if ($('bingo-join-btn')) $('bingo-join-btn').disabled = true;
        setStatus(!demoRoomValid ? 'This demo room token is missing or invalid. No production endpoint was contacted.' :
          'This demo member is not on the test allowlist.', true);
        return Promise.resolve();
      }
      if (String(session.username || '').toLowerCase() !== demoMember) return Promise.resolve();
      if (pollBusy) return Promise.resolve();
      pollBusy = true;
      return fetch(`/api/demo/bingo/${encodeURIComponent(demoRoom)}/member/${encodeURIComponent(demoMember)}?cardOffset=${encodeURIComponent(requestedOffset)}`, {
        credentials: 'include', cache: 'no-store'
      })
        .then(response => completeCards(response, nextOffset => fetch(
          `/api/demo/bingo/${encodeURIComponent(demoRoom)}/member/${encodeURIComponent(demoMember)}?cardOffset=${nextOffset}`,
          {credentials:'include',cache:'no-store'}), demoMember))
        .then(({ ok, data }) => {
          if (!alive || String(context().username || '').toLowerCase() !== demoMember) return;
          if (!ok || data.success === false) throw new Error(data.error || 'Demo Bingo state is unavailable.');
          applyState(data, quiet ? undefined : requestedOffset);
        })
        .catch(error => {
          if (alive && String(context().username || '').toLowerCase() === demoMember) {
            if ($('bingo-join-btn')) $('bingo-join-btn').disabled = true;
            setStatus(error.message || 'Could not reach the in-memory Bingo room.', true);
          }
        })
        .finally(() => { pollBusy = false; });
    }
    if (preview) {
      if (preview) applyState(makePreviewState(params.get('bingo'), cardOffset == null ? offset : cardOffset), cardOffset == null ? offset : cardOffset);
      return Promise.resolve();
    }
    const session = context();
    const user = session.username;
    if (!user) {
      if (currentMember && session.ready) stopForMemberChange();
      document.querySelectorAll('.bingo-result-notice').forEach(notice=>notice.remove());
      return Promise.resolve();
    }
    if (!user.toLowerCase().startsWith('mem-')) {
      if (currentMember) stopForMemberChange();
      return Promise.resolve();
    }
    const normalizedMember = user.toLowerCase();
    if (currentMember && currentMember !== normalizedMember) {
      if (window.__denfiBingoAbort) window.__denfiBingoAbort.abort();
      currentEvent = ''; bingoState = null; offset = 0;
      $('bingo-opener')?.classList.remove('active', 'event-active');
      document.getElementById('session-panel')?.classList.remove('bingo-active');
      if (context().activeDrawer === 'bingo') context().closeDrawer();
    }
    currentMember = normalizedMember;
    if (pollBusy) return Promise.resolve();
    pollBusy = true;
    const requestedMember = normalizedMember;
    const requestEvent = currentEvent;
    const requestedOffset = cardOffset == null ? offset : cardOffset;
    const controller = new AbortController();
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 12000);
    window.__denfiBingoAbort = controller;
    return fetch(`/api/session/bingo?cardOffset=${encodeURIComponent(requestedOffset)}`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(r => completeCards(r, nextOffset => fetch(`/api/session/bingo?cardOffset=${nextOffset}`,
        {credentials:'include',cache:'no-store',signal:controller.signal}), requestedMember))
      .then(({ ok, data }) => {
        if (!alive || String(context().username || '').toLowerCase() !== requestedMember ||
            (requestEvent && currentEvent && currentEvent !== requestEvent)) return;
        if (!ok || data.success === false) throw new Error(data.error || 'Bingo state is unavailable.');
        if (String(data.username || '').toLowerCase() !== requestedMember) return;
        applyState(data, quiet ? undefined : requestedOffset);
      })
      .catch(error => {
        if ((error.name !== 'AbortError' || timedOut) && String(context().username || '').toLowerCase() === requestedMember &&
            (!requestEvent || currentEvent === requestEvent)) {
          if ($('bingo-join-btn')) $('bingo-join-btn').disabled = true;
          setStatus(timedOut ? 'Denfi Points did not respond. Retrying shortly.' :
            error.message || 'Cannot reach Denfi Points. Retrying shortly.', true);
        }
      })
      .finally(() => { clearTimeout(deadline); pollBusy = false; });
  }
  // Older Points builds return batches of twelve. Collect those privately into
  // one complete card list, without exposing paging controls or losing cards.
  async function completeCards(response, requestPage, member) {
    let data = await response.json();
    if (!response.ok || !data.success || !data.participant ||
        String(data.username || '').toLowerCase() !== member.toLowerCase()) return {ok:response.ok,data};
    const count = Number(data.participant.cardCount);
    if (!Number.isSafeInteger(count) || count < 1 || count > 1000 ||
        Number(data.participant.cardOffset || 0) !== 0) throw new Error('Bingo cards could not be loaded completely.');
    const eventId = data.event?.id;
    let cards = [...(data.participant.cards || [])];
    while (cards.length < count) {
      const next = await requestPage(cards.length);
      const page = await next.json();
      if (!next.ok || !page.success || page.event?.id !== eventId ||
          String(page.username || '').toLowerCase() !== member.toLowerCase() ||
          page.participant?.cardCount !== count || page.participant?.cardOffset !== cards.length ||
          !page.participant?.cards?.length) throw new Error('Bingo cards changed or could not finish loading. Refreshing shortly.');
      cards.push(...page.participant.cards);
      data = page;
    }
    if (cards.length !== count || new Set(cards.map(card=>card.id)).size !== count)
      throw new Error('Bingo returned an incomplete or duplicate card list.');
    return {ok:true,data:{...data,participant:{...data.participant,cardOffset:0,cards}}};
  }
  function applyState(state, requestedOffset) {
    if (!state || !state.success) return;
    const eventId = state.event && String(state.event.id || '');
    const changedEvent = eventId !== currentEvent;
    if (changedEvent) {
      currentEvent = eventId;
      cardRenderKey = '';
      offset = 0;
      lastPhase = '';
      if (eventId) {
        const retained = sessionStorage.getItem(requestKey(context().username, eventId));
        if (retained && state.participant) clearRequest(context().username, eventId);
      }
    }
    bingoState = state;
    if (state.participant && eventId) clearRequest(context().username, eventId);
    if (Number.isFinite(state.balance) && typeof context().updateBalance === 'function') context().updateBalance(state.balance);
    serverReceivedAt = Date.now();
    if (state.participant && Number.isFinite(Number(state.participant.cardOffset))) {
      const pageStart = Number(state.participant.cardOffset) || 0;
      const selected = requestedOffset == null ? offset : requestedOffset;
      const pageLength = (state.participant.cards || []).length;
      offset = selected >= pageStart && selected < pageStart + pageLength ? selected : pageStart;
    }
    render();
    syncLock();
    if (changedEvent && eventActive(state.event)) {
      if (typeof context().dismissRecentWins === 'function') context().dismissRecentWins();
      else if (context().activeDrawer === 'wins') context().closeDrawer();
    }
    if (state.event?.phase === 'cancelled' && state.participant?.stake > 0 &&
        state.serverNow - state.event.finishedAt < 90000 &&
        String(state.username || '').toLowerCase() === String(context().username || '').toLowerCase() &&
        !refundNoticeIds.has(state.event.id)) {
      refundNoticeIds.add(state.event.id);
      const refund = {game:'bingo-refund',id:`bingo-refund:${state.event.id}:${state.username}`,
        username:state.username,payout:state.participant.stake,createdAt:state.event.finishedAt,
        reason:state.event.reason || 'Bingo cancelled. Your points have been refunded.'};
      if (typeof context().notifyRefund === 'function') context().notifyRefund(refund);
      else {
        const notice=document.createElement('div');
        notice.className='bingo-result-notice';notice.setAttribute('role','status');
        notice.textContent=`BINGO REFUNDED · ${money(refund.payout)} returned · ${refund.reason}`;
        document.body.appendChild(notice);
        setTimeout(()=>notice.remove(),15000);
      }
    }
    if (state.event?.phase === 'finished' && state.serverNow - state.event.finishedAt < 90000 &&
        typeof context().notifyWin === 'function') {
      // Public notices still reach everyone. When winners share the same call,
      // keep this member's own payout as their final visible notice.
      const member = String(context().username || '').toLowerCase();
      const notices = [...(state.event.winners || [])].sort((a,b)=>
        Number(a.username.toLowerCase()===member)-Number(b.username.toLowerCase()===member));
      for (const winner of notices) context().notifyWin({
        ...winner, game: 'bingo', id: `bingo:${state.event.id}:${winner.username}`,
        createdAt: state.event.finishedAt
      });
    }
    if (typeof context().notifyWin !== 'function') publicResult(state.event);
    managePrompt();
    requestResize();
  }
  function publicResult(e) {
    if (!context().ready || !context().username) {
      document.querySelectorAll('.bingo-result-notice').forEach(notice=>notice.remove());
      return;
    }
    if (!e || e.phase !== 'finished' || Date.now()-Number(e.finishedAt)>90000) return;
    if (typeof context().notifyWin === 'function') {
      for(const winner of e.winners || []) context().notifyWin({
        ...winner,game:'bingo',id:`bingo:${e.id}:${winner.username}`,createdAt:e.finishedAt
      });
    } else if (!publicResultIds.has(e.id) && e.winners?.length) {
      const winners = e.winners.filter(w=>!window.DenfiWinNotices?.isSeen(`bingo:${e.id}:${w.username}`));
      if (!winners.length) return;
      publicResultIds.add(e.id);
      const notice = document.createElement('div');
      notice.className = 'bingo-result-notice'; notice.setAttribute('role','status');
      notice.textContent = `BINGO WINNER${winners.length>1?'S':''} · ` +
        winners.map(w=>`${w.username} · ${w.winningCards} winning cards · ${money(w.payout)}`).join(' / ');
      document.body.appendChild(notice);
      for (const winner of winners) window.DenfiWinNotices?.markSeen(`bingo:${e.id}:${winner.username}`);
      setTimeout(()=>notice.remove(),15000);
    }
  }
  function money(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${Number(n.toFixed(2)).toLocaleString()} pts` : '—';
  }
  function calledSet(event) { return new Set((event?.called || []).map(Number)); }
  function renderCard(card, index, event, participant) {
    const winning = (participant?.winningCardIds || []).includes(card.id);
    const used = calledSet(event);
    const article = document.createElement('article');
    article.className = `bingo-card${winning ? ' is-winner' : ''}`;
    const head = document.createElement('div'); head.className = 'bingo-card-head';
    head.innerHTML = `<span>CARD ${Number(participant.cardOffset || 0) + index + 1} / ${participant.cardCount || 1}</span><span>${winning ? 'WINNING CARD' : '75 BALL'}</span>`;
    const grid = document.createElement('div'); grid.className = 'bingo-grid'; grid.setAttribute('role', 'grid');
    letters.forEach(letter => { const h = document.createElement('span'); h.className = 'bingo-letter'; h.textContent = letter; grid.appendChild(h); });
    (card.numbers || []).slice(0, 25).forEach((num, i) => {
      const cell = document.createElement('span'); cell.className = 'bingo-cell'; cell.setAttribute('role', 'gridcell');
      if (i === 12 && num == null) { cell.classList.add('free', 'marked'); cell.textContent = 'FREE'; cell.setAttribute('aria-label', 'Free center, automatically marked'); }
      else {
        const n = Number(num);
        cell.textContent = Number.isFinite(n) ? String(n) : '—';
        if (Number.isFinite(n) && used.has(n)) cell.classList.add('marked');
        cell.setAttribute('aria-label', Number.isFinite(n) ? `${n}${used.has(n) ? ', called' : ''}` : 'No number');
      }
      grid.appendChild(cell);
    });
    const foot = document.createElement('div'); foot.className = 'bingo-card-foot';
    foot.innerHTML = `<span>${winning ? 'WINNER' : 'MARKED NUMBERS'}</span><span>${(event?.called || []).length} calls</span>`;
    article.append(head, grid, foot);
    return article;
  }
  function render() {
    const e = bingoState?.event, participant = bingoState?.participant;
    const showOpener = !!e && eventActive(e) && !!context().username;
    $('bingo-opener')?.classList.toggle('event-active', showOpener);
    $('bingo-opener')?.setAttribute('aria-hidden', String(!(e && eventActive(e))));
    $('bingo-opener')?.setAttribute('aria-expanded', String(context().activeDrawer === 'bingo'));
    if (!e) {
      cardRenderKey = '';
      $('bingo-phase').textContent = 'NO EVENT';
      $('bingo-countdown').textContent = '—';
      $('bingo-metric-pot').textContent = '—';
      $('bingo-metric-players').textContent = '—';
      $('bingo-current-ball').textContent = '—';
      $('bingo-current-ball').classList.add('is-empty');
      $('bingo-current-copy').textContent = 'Waiting for shop event';
      $('bingo-history').innerHTML = '<span class="bingo-history-label">CALLS</span>';
      $('bingo-card-area').replaceChildren();
      $('bingo-join-area').hidden = true;
      $('bingo-winners').hidden = true;
      setStatus('Bingo is not active right now.');
      return;
    }
    $('bingo-phase').textContent = e.phase === 'joining' ? 'JOINING OPEN' : e.phase === 'drawing' ? 'LIVE DRAW' : e.phase === 'finished' ? 'EVENT FINISHED' : 'EVENT CANCELLED';
    $('bingo-countdown').textContent = e.phase === 'joining' ? `CLOSES ${timeLeft(e.joinClosesAt)}` : e.phase === 'drawing' ? `NEXT ${timeLeft(e.nextDrawAt)}` : '';
    $('bingo-metric-pot').textContent = money(e.pot);
    $('bingo-metric-players').textContent = `${Number(e.players) || 0} / ${Number(e.totalCards) || 0} cards`;
    const latest = e.latestCall;
    $('bingo-current-ball').classList.toggle('is-empty', !latest);
    $('bingo-current-ball').textContent = latest ? `${latest.letter}${latest.number}` : '—';
    $('bingo-current-copy').textContent = latest ? `BALL ${latest.letter}${latest.number} CALLED` : 'Waiting for first call';
    const history = $('bingo-history'); history.replaceChildren();
    const label = document.createElement('span'); label.className = 'bingo-history-label'; label.textContent = 'CALLS'; history.appendChild(label);
    (e.called || []).slice(-8).forEach(n => { const el = document.createElement('span'); el.className = 'bingo-history-ball'; el.textContent = `${letters[Math.floor((Number(n) - 1) / 15)]}${n}`; history.appendChild(el); });
    const area = $('bingo-card-area');
    const cards = participant?.cards || [];
    const nextCardKey = JSON.stringify([e.id,e.phase,cards,(participant?.winningCardIds || []),e.called]);
    const previousScroll = area.querySelector?.('.bingo-card-list')?.scrollTop || 0;
    if (nextCardKey !== cardRenderKey) {
    area.replaceChildren();
    if (participant && cards.length) {
      const note = document.createElement('div'); note.className = 'bingo-card-count';
      note.textContent = `${participant.cardCount} CARD${participant.cardCount === 1 ? '' : 'S'} · ALL IN THIS POPUP`;
      const list = document.createElement('div'); list.className = `bingo-card-list${cards.length > 1 ? ' is-multi' : ''}`;
      list.tabIndex = 0; list.setAttribute('role','region'); list.setAttribute('aria-label','All your Bingo cards; scroll to see more');
      cards.forEach((card,index)=>list.appendChild(renderCard(card,index,e,participant)));
      area.append(note,list);
      list.scrollTop = previousScroll;
    } else if (participant) {
      area.innerHTML = '<div class="bingo-message">Your cards are loading…</div>';
    } else {
      const cardMessage = e.phase === 'joining' ? 'Your cards will appear here after you join.' :
        e.phase === 'drawing' ? 'The join window is closed. No cards are assigned to this account.' :
          'No cards were entered from this account.';
      area.innerHTML = `<div class="bingo-message">${cardMessage}</div>`;
    }
    cardRenderKey = nextCardKey;
    }
    const winners = e.winners || [];
    $('bingo-winners').hidden = !winners.length;
    $('bingo-winners').textContent = winners.length
      ? `WINNER${winners.length > 1 ? 'S' : ''} · ${winners.map(w => `${w.username} · ${w.winningCards} winning ${w.winningCards === 1 ? 'card' : 'cards'} · ${money(w.payout)} total`).join(' / ')}`
      : '';
    const joinArea = $('bingo-join-area');
    joinArea.hidden = !!participant || e.phase !== 'joining';
    if (!joinArea.hidden) {
      $('bingo-balance').textContent = money(bingoState.balance);
      const eventLimit = Number(e.config?.maxCardsPerMember);
      const cardLimit = Number.isFinite(eventLimit) ? eventLimit : Number(bingoState.config?.maxCardsPerMember) || 100;
      const amountInput = $('bingo-amount');
      const allowCustomStake = typeof e.config?.allowCustomStake === 'boolean'
        ? e.config.allowCustomStake : bingoState.config?.allowCustomStake !== false;
      const oneCardOnly = !allowCustomStake;
      amountInput.max = String(oneCardOnly ? 1 : cardLimit);
      const heldAmount = sessionStorage.getItem(requestKey(context().username, e.id) + ':amount');
      amountInput.readOnly = oneCardOnly || !!heldAmount || requestBusy;
      amountInput.disabled = oneCardOnly;
      if (oneCardOnly) amountInput.value = '1';
      else if (heldAmount) amountInput.value = heldAmount;
      else if (stakeDefaultEvent !== e.id) {
        const balance = Number(bingoState.balance);
        const affordableCards = Number.isFinite(balance) ? Math.floor(balance) : 1;
        amountInput.value = String(Math.max(1, Math.min(cardLimit, affordableCards)));
        stakeDefaultEvent = e.id;
      }
      $('bingo-join-btn').disabled = requestBusy;
      $('bingo-join-btn').textContent = requestBusy ? 'JOINING…' : 'BUY CARDS';
      $('bingo-amount').setAttribute('aria-label', oneCardOnly ? 'One card per member for this event' : 'Number of Bingo cards');
      if (bingoState.balance < 1) setStatus('You need at least 1 point to join. This event stays open while you add points.', true);
      else if (lastPhase !== e.phase) setStatus('', false);
    }
    if (e.phase === 'finished' && !participant) setStatus(e.reason || 'The draw is finished.');
    if (participant && ['joining', 'drawing'].includes(e.phase)) {
      setStatus(`Bet confirmed · ${participant.cardCount} card${participant.cardCount === 1 ? '' : 's'} · ${money(participant.stake)} entered.`, false);
    }
    if (e.phase === 'cancelled') setStatus(e.reason || 'This event was cancelled. Any refunds are handled by Denfi Points.');
    if (participant?.payout > 0) setStatus(`You received ${money(participant.payout)} across your winning card${participant.winningCardIds?.length === 1 ? '' : 's'}.`, false);
    lastPhase = e.phase;
  }
  function timeLeft(target) {
    const parseTime = value => {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : Date.now();
    };
    const serverNow = parseTime(bingoState?.serverNow) + Math.max(0, Date.now() - serverReceivedAt);
    const remaining = Math.max(0, Math.ceil((parseTime(target) - serverNow) / 1000));
    return `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  }
  function updateCountdown() {
    const e = bingoState?.event;
    if (!e) return;
    $('bingo-countdown').textContent = e.phase === 'joining' ? `CLOSES ${timeLeft(e.joinClosesAt)}` : e.phase === 'drawing' ? `NEXT ${timeLeft(e.nextDrawAt)}` : '';
  }
  function isBusy() {
    const c = context();
    return !!c.busy || requestBusy;
  }
  function managePrompt() {
    const e = bingoState?.event;
    if (!e) return;
    if (!eventActive(e)) {
      if (context().activeDrawer === 'bingo') context().closeDrawer();
      return;
    }
    // Accepted entries are restored from Points, never from the local prompt
    // dismissal flag. A reload or reboot cannot dismiss a paid, active game.
    if (isLocked()) {
      if (context().activeDrawer !== 'bingo') context().openBingo();
      return;
    }
    if (e.phase !== 'joining') {
      if (context().activeDrawer === 'bingo' && !requestBusy) context().closeDrawer();
      return;
    }
    if (preview) return;
    const member = context().username;
    if (!member || !member.toLowerCase().startsWith('mem-')) return;
    const key = storageKey(member, e.id);
    if (bingoState.balance < 1) {
      setPromptState(key,'insufficient');
      if(context().activeDrawer === 'bingo') context().closeDrawer();
      return;
    }
    if (getPromptState(key)) return;
    if (isBusy() || (context().activeDrawer && context().activeDrawer !== 'bingo')) {
      clearTimeout(deferredTimer);
      deferredTimer = setTimeout(managePrompt, 700);
      return;
    }
    setPromptState(key, 'prompted');
    if (context().activeDrawer !== 'bingo') context().openBingo();
  }
  function stopForMemberChange() {
    clearTimeout(deferredTimer);
    document.querySelectorAll('.bingo-result-notice').forEach(notice=>notice.remove());
    if (window.__denfiBingoAbort) window.__denfiBingoAbort.abort();
    bingoState = null;
    syncLock();
    if (context().activeDrawer === 'bingo') context().closeDrawer();
    $('bingo-opener')?.classList.remove('active', 'event-active');
    document.getElementById('session-panel')?.classList.remove('bingo-active');
    bingoState = null; currentEvent = ''; offset = 0; cardRenderKey = '';
    if ($('bingo-amount')) $('bingo-amount').value = '1';
    stakeDefaultEvent = '';
    setStatus('', false);
    currentMember = '';
  }
  async function join() {
    if ((preview && !demoBingo) || inertPreview || requestBusy) return;
    const event = bingoState?.event, member = context().username;
    if (!event || event.phase !== 'joining' || bingoState.participant || !member) return;
    if (demoBingo && (!demoRoomValid || !demoMemberValid || String(member).toLowerCase() !== demoMember)) {
      setStatus('Demo join is blocked: the room or member is not valid for this safe test.', true);
      return;
    }
    const heldAmount = sessionStorage.getItem(requestKey(member, event.id) + ':amount');
    const allowCustomStake = typeof event.config?.allowCustomStake === 'boolean'
      ? event.config.allowCustomStake : bingoState.config?.allowCustomStake !== false;
    const fixedOneCard = !allowCustomStake;
    const amount = fixedOneCard ? 1 : Number(heldAmount || $('bingo-amount').value);
    const eventLimit = Number(event.config?.maxCardsPerMember);
    const cardLimit = Number.isFinite(eventLimit) ? eventLimit : Number(bingoState.config?.maxCardsPerMember) || 100;
    const max = cardLimit;
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > max) {
      setStatus(`Choose 1 to ${Math.max(0, Math.floor(max))} cards. One point buys one card.`, true); return;
    }
    requestBusy = true; $('bingo-join-btn').disabled = true;
    const eventAtSubmit = event.id, memberAtSubmit = member.toLowerCase();
    const requestId = getRequestId(member, eventAtSubmit, amount);
    $('bingo-amount').readOnly = true;
    setStatus('Confirming your cards with Denfi Points…', false);
    requestResize();
    try {
      const response = await fetch(demoBingo
        ? `/api/demo/bingo/${encodeURIComponent(demoRoom)}/join`
        : '/api/session/bingo/join', {
        method: 'POST', credentials: 'include', signal: AbortSignal.timeout(12000), headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(demoBingo
          ? { username: member, amount, eventId: eventAtSubmit, requestId }
          : { eventId: eventAtSubmit, amount, requestId })
      });
      const {data:result} = await completeCards(response, nextOffset => fetch(demoBingo
        ? `/api/demo/bingo/${encodeURIComponent(demoRoom)}/member/${encodeURIComponent(demoMember)}?cardOffset=${nextOffset}`
        : `/api/session/bingo?cardOffset=${nextOffset}`, {credentials:'include',cache:'no-store',signal:AbortSignal.timeout(12000)}), memberAtSubmit);
      if (context().username.toLowerCase() !== memberAtSubmit || currentEvent !== eventAtSubmit) return;
      if (!response.ok || result.success === false) {
        if ([400, 401, 403, 409, 429].includes(response.status)) clearRequest(member, eventAtSubmit);
        if (/insufficient|balance|points/i.test(result.error || '')) {
          setStatus(result.error || 'Not enough points. Add points and retry.', true);
          setPromptState(storageKey(member,eventAtSubmit),'insufficient');
          context().closeDrawer();
        }
        else setStatus(result.error || 'Join was not confirmed. Retry uses the same request and cannot charge twice.', true);
        return;
      }
      if (String(result.username || '').toLowerCase() !== memberAtSubmit) return;
      if (result.participant) clearRequest(member, eventAtSubmit);
      applyState(result, offset);
      if (!result.participant) setStatus('Your request was accepted; cards are still syncing. Refreshing state.', false);
    } catch (_) {
      if (context().username.toLowerCase() === memberAtSubmit && currentEvent === eventAtSubmit) {
        setStatus('Network response uncertain. Retry manually; the saved request identity prevents a second charge.', true);
      }
    } finally {
      requestBusy = false;
      if (context().username.toLowerCase() === memberAtSubmit && currentEvent === eventAtSubmit) {
        $('bingo-join-btn').disabled = false; render(); requestResize();
      }
    }
  }
  function decline() {
    if (isLocked() || requestBusy) return;
    const e = bingoState?.event, member = context().username;
    if (e && member) setPromptState(storageKey(member, e.id), 'declined');
    if (context().activeDrawer === 'bingo') context().closeDrawer();
  }
  function open() {
    const e = bingoState?.event, member = context().username;
    if (!e || !member) return;
    if (e.phase === 'joining' && !bingoState.participant) setPromptState(storageKey(member, e.id), 'prompted');
    context().openBingo();
    fetchState(offset, true);
  }
  function init() {
    if (!$('bingo-view')) return;
    $('bingo-opener')?.addEventListener('click', open);
    $('bingo-decline').addEventListener('click', decline);
    $('bingo-join-form').addEventListener('submit', event => { event.preventDefault(); join(); });
    if (preview) {
      applyState(makePreviewState(params.get('bingo'), 0));
      document.body.classList.add('bingo-preview-mode');
      $('bingo-join-btn').textContent = 'DEMO ONLY';
      $('bingo-join-btn').disabled = true;
      setTimeout(() => context().openBingo(), 0);
      return;
    }
    refreshTimer = setInterval(() => fetchState(bingoState?.participant ? Number(bingoState.participant.cardOffset) || 0 : 0, true), 1000);
    countdownTimer = setInterval(updateCountdown, 250);
    fetchState(0, false);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchState(offset, true); });
  }
  function rememberDismissal() {
    const e = bingoState?.event, member = context().username;
    if (e && member) setPromptState(storageKey(member, e.id), 'closed');
  }
  window.DenfiBingoSession = { init, open, close: decline, isLocked, publicResult, rememberDismissal, stop: stopForMemberChange, refresh: () => fetchState(offset, true) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
