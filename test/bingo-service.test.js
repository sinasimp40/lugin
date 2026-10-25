'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createStore } = require('../src/coin-log-sqlite-store');
const { createBingoService, makeCard, wins, ball } = require('../src/bingo-service');
const { createHub } = require('../src/order-workflow');
const { formatAnnouncement, KioskVoiceCoordinator } = require('../src/voice-announcements');
const rates = [{ pesos: 1, points: 1 }];
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-bingo-'));
  let db = new DatabaseSync(path.join(dir, 'points.db'));
  let store = createStore(db);
  let time = Date.now();
  const service = () => createBingoService({ getDb: () => db, coinLogs: store,
    getRates: () => rates, now: () => time });
  let bingo = service();
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return {
    dir, get db() { return db; }, get bingo() { return bingo; }, get store() { return store; },
    advance(ms) { time += ms; }, get now() { return time; },
    credit(username, amount = 20) { store.appendLog({ username, amount }, rates); },
    start(messageId = 100) { return bingo.start({ botHash: 'a'.repeat(64), chatId: '-10012345', messageId }); },
    join(username, amount, eventId, requestId = cryptoId()) {
      return bingo.join({ username, station: 'PC 1', amount, eventId, requestId });
    },
    restart() { db.close(); db = new DatabaseSync(path.join(dir, 'points.db')); store = createStore(db); bingo = service(); },
    alter(id, fn) {
      const e = JSON.parse(db.prepare('SELECT payload FROM bingo_events WHERE id=?').get(id).payload);
      fn(e);
      db.prepare('UPDATE bingo_events SET payload=? WHERE id=?').run(JSON.stringify(e), id);
    }
  };
}
const cryptoId = () => require('node:crypto').randomUUID();
test('cards have valid unique column numbers, free center and correct line rules', () => {
  for (let i = 0; i < 500; i++) {
    const card = makeCard();
    assert.equal(card.numbers.length, 25);
    assert.equal(card.numbers[12], null);
    for (let col = 0; col < 5; col++) {
      const nums = card.numbers.filter((n, index) => index % 5 === col && n !== null);
      assert.equal(new Set(nums).size, nums.length);
      assert.ok(nums.every(n => n >= col * 15 + 1 && n <= (col + 1) * 15));
    }
    assert.equal(wins(card, new Set()), false);
    for (const pattern of [[0,1,2,3,4], [0,5,10,15,20], [0,6,12,18,24], [4,8,12,16,20]])
      assert.equal(wins(card, new Set(pattern.map(index => card.numbers[index]))), true);
  }
  assert.deepEqual([1,15,16,30,31,45,46,60,61,75].map(n => ball(n).letter),
    ['B','B','I','I','N','N','G','G','O','O']);
});
test('central join bypasses normal allowance; duplicate PCs/retries cannot debit twice; cards stay private', t => {
  const f = fixture(t); f.credit('mem-alice');
  const started = f.start();
  assert.equal(f.start().event.id, started.event.id);
  assert.match(f.start(101).error, /already in progress/);
  const requestId = cryptoId();
  const entered = f.join('mem-alice', 5, started.event.id, requestId);
  assert.equal(entered.balance, 15);
  assert.equal(entered.participant.cardCount, 5);
  assert.equal(f.join('mem-alice', 5, started.event.id, requestId).replayed, true);
  assert.equal(f.join('mem-alice', 5, started.event.id).balance, 15);
  assert.throws(() => f.join('mem-alice', 4, started.event.id), /original bet/);
  assert.throws(() => f.join('mem-bob', 5, started.event.id, requestId), /different entry/);
  assert.throws(() => f.join('mem-empty', 1, started.event.id), /Not enough points/);
  assert.equal(f.bingo.state('mem-empty').participant, null);
  assert.doesNotMatch(JSON.stringify(f.bingo.state('mem-empty')), /numbers|deck|requestId/);
  assert.equal(f.bingo.state().event.totalCards, 5);
  const cards = entered.participant.cards;
  f.restart();
  assert.deepEqual(f.bingo.state('mem-alice').participant.cards, cards);
  assert.equal(f.join('mem-alice', 5, started.event.id, requestId).balance, 15);
  f.store.recalcAllPoints([{ pesos: 1, points: 2 }]);
  assert.equal(f.store.getMemberPoints('mem-alice'), 35, 'rate recalculation preserves Bingo debit');
});
test('custom card policy is shared, enforced on Points, and frozen for each active event', t => {
  const f = fixture(t); f.credit('mem-alice'); f.credit('mem-bob');
  const initial = f.bingo.state();
  assert.equal(initial.config.allowCustomStake, true);
  const published = f.bingo.configure({ ...initial.config, allowCustomStake: false }, initial.version);
  const fixed = f.start().event;
  assert.equal(fixed.config.allowCustomStake, false);
  assert.throws(() => f.join('mem-alice', 2, fixed.id), /Custom card amounts are disabled/);
  assert.equal(f.store.getMemberPoints('mem-alice'), 20, 'rejected custom stake never debits');
  assert.equal(f.join('mem-alice', 1, fixed.id).participant.cardCount, 1);
  f.bingo.configure({ ...published.config, allowCustomStake: true }, published.version);
  assert.throws(() => f.join('mem-bob', 2, fixed.id), /Custom card amounts are disabled/,
    'enabling custom amounts cannot change an already-started event');
  f.bingo.cancel(fixed.id);
  const custom = f.start(102).event;
  assert.equal(f.join('mem-bob', 3, custom.id).participant.cardCount, 3);
  assert.equal(f.store.getMemberPoints('mem-bob'), 17);
  f.restart();
  assert.equal(f.bingo.state().config.allowCustomStake, true);
  assert.equal(f.bingo.state('mem-bob').participant.cardCount, 3);
});
test('invalid custom-amount settings are rejected without changing the shared policy', t => {
  const f = fixture(t), saved = f.bingo.state();
  assert.throws(() => f.bingo.configure({ ...saved.config, allowCustomStake: 'false' }, saved.version),
    /enabled or disabled/);
  assert.equal(f.bingo.state().version, saved.version);
  assert.equal(f.bingo.state().config.allowCustomStake, true);
});
test('join and debit roll back together if event persistence fails', t => {
  const f = fixture(t); f.credit('mem-alice');
  const id = f.start().event.id;
  f.db.exec(`CREATE TRIGGER fail_bingo_save BEFORE UPDATE ON bingo_events
    BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END;`);
  assert.throws(() => f.join('mem-alice', 5, id), /fixture write failure/);
  assert.equal(f.store.getMemberPoints('mem-alice'), 20);
  assert.equal(f.bingo.state().event.pot, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM coin_logs WHERE source='bingo'").get().n, 0);
});
test('30-second deadline is strict; cancelled/empty events refund exactly once', t => {
  const f = fixture(t); f.credit('mem-alice');
  const id = f.start().event.id;
  f.join('mem-alice', 5, id);
  f.advance(30000);
  assert.throws(() => f.join('mem-bob', 1, id), /closed/);
  assert.equal(f.bingo.state().event.phase, 'cancelled');
  assert.equal(f.bingo.state().event.called.length, 0);
  assert.match(f.bingo.state().event.reason, /Not enough participants/);
  assert.equal(f.bingo.cancel(id).event.phase, 'cancelled');
  assert.equal(f.store.getMemberPoints('mem-alice'), 20);
  f.bingo.cancel(id); f.restart(); f.bingo.cancel(id);
  assert.equal(f.store.getMemberPoints('mem-alice'), 20);
  const empty = f.start(102).event.id;
  f.advance(30000);
  assert.equal(f.bingo.state().event.phase, 'cancelled');
  assert.equal(f.bingo.state().event.id, empty);
});
test('two winning cards versus one receive two versus one shares, payout commits once and survives restart', t => {
  const f = fixture(t); f.credit('mem-alice'); f.credit('mem-bob');
  const id = f.start().event.id;
  const requestId = cryptoId();
  f.join('mem-alice', 5, id, requestId); f.join('mem-bob', 1, id);
  f.alter(id, event => {
    const template = makeCard(max => max - 1);
    event.participants[0].cards.forEach((card, i) => {
      card.numbers = [...template.numbers]; if (i > 1) card.numbers[0] = 2;
    });
    event.participants[1].cards[0].numbers = [...template.numbers];
    event.deck = [1,16,31,46,61, ...Array.from({length:75},(_,i)=>i+1).filter(n=>![1,16,31,46,61].includes(n))];
  });
  f.advance(30000); f.bingo.advance();
  for (let i = 0; i < 5; i++) { f.advance(5000); f.bingo.advance(); }
  const event = f.bingo.state().event;
  assert.equal(event.phase, 'finished');
  assert.deepEqual(event.winners.map(w => [w.username,w.winningCards,w.payout]).sort(),
    [['mem-alice',2,4],['mem-bob',1,2]]);
  const botHash='a'.repeat(64);
  const resultMessage=f.bingo.edits(botHash).find(message=>message.messageId===100);
  assert.match(resultMessage.text,/BINGO EVENT FINISHED/);
  assert.match(resultMessage.text,/WINNERS:\n/);
  assert.match(resultMessage.text,/Username: mem-alice \(PC 1\) — 4\.00 points · 2 winning card/);
  assert.match(resultMessage.text,/Username: mem-bob \(PC 1\) — 2\.00 points · 1 winning card/);
  // A prior build's completed receipt must be refreshed in place, not reposted.
  f.bingo.edited(botHash,resultMessage.key,`finished:2:${event.called.length}`);
  assert.equal(f.bingo.edits(botHash).find(message=>message.messageId===100).version,resultMessage.version);
  f.bingo.edited(botHash,resultMessage.key,resultMessage.version);
  assert.equal(f.bingo.edits(botHash).some(message=>message.messageId===100),false);
  assert.equal(f.store.getMemberPoints('mem-alice'), 19);
  assert.equal(f.store.getMemberPoints('mem-bob'), 21);
  assert.equal(event.winners.reduce((n,w)=>n+w.payout,0), event.pot);
  for (let i=0;i<10;i++) f.bingo.advance();
  f.restart();
  assert.equal(f.store.getMemberPoints('mem-alice'),19);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM coin_logs WHERE source='bingo'").get().n,4);
  assert.throws(()=>f.bingo.cancel(id),/paid/);
  f.start(103);
  assert.equal(f.join('mem-alice',5,id,requestId).event.id,id,'old retry returns original settled event');
  assert.equal(f.store.getMemberPoints('mem-alice'),19);
});
test('all calls are unique and synchronized; outage resumes one visible call rather than fast-forwarding', t => {
  const f = fixture(t); f.credit('mem-alice'); f.credit('mem-bob');
  const id = f.start().event.id; f.join('mem-alice',1,id); f.join('mem-bob',1,id);
  f.advance(30000); f.bingo.advance();
  f.advance(3600000); f.restart();
  const first = f.bingo.state('mem-alice');
  assert.equal(first.event.called.length,1);
  assert.deepEqual(f.bingo.state('mem-bob').event.called,first.event.called);
  while(f.bingo.state().event.phase==='drawing') { f.advance(5000); f.bingo.advance(); }
  const called=f.bingo.state().event.called;
  assert.equal(new Set(called).size,called.length);
  assert.ok(called.length<=75);
});
test('new events draw every three seconds and a cancelled solo entry survives restart without double refunds',t=>{
  const f=fixture(t);f.credit('mem-alice');f.credit('mem-bob');
  const solo=f.start().event.id;f.join('mem-alice',5,solo);
  // Upgrade compatibility: old builds allowed solo rounds to begin drawing.
  f.alter(solo,event=>{event.phase='drawing';event.called=[1];});
  f.advance(30000);
  assert.equal(f.bingo.state().event.phase,'cancelled');
  assert.equal(f.store.getMemberPoints('mem-alice'),20);
  f.restart();f.bingo.advance();f.bingo.cancel(solo);
  assert.equal(f.store.getMemberPoints('mem-alice'),20);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM coin_logs WHERE source='bingo' AND points>0").get().n,1);
  const next=f.start(104).event.id;f.join('mem-alice',1,next);f.join('mem-bob',1,next);
  f.advance(30000);const drawing=f.bingo.state().event;
  assert.equal(drawing.phase,'drawing');
  assert.equal(drawing.config.drawSeconds,3);
  f.advance(2999);assert.equal(f.bingo.state().event.called.length,0);
  f.advance(1);assert.equal(f.bingo.state().event.called.length,1);
  f.advance(3000);assert.equal(f.bingo.state().event.called.length,2);
  assert.match(formatAnnouncement({type:'bingo-cancelled',username:'mem-alice',
    refundedPoints:5,insufficientParticipants:true}),/Not enough participants joined.*5 points have been refunded/);
});
test('settings reject stale writers and snapshot active rules; pending withdrawal blocks joining', t => {
  const f=fixture(t); f.credit('mem-alice');
  const settings=f.bingo.state();
  const id=f.start().event.id;
  f.bingo.configure({...settings.config,joinSeconds:60,maxCardsPerMember:1},settings.version);
  assert.throws(()=>f.bingo.configure(settings.config,settings.version),/another PC/);
  f.join('mem-alice',2,id);
  assert.equal(f.bingo.state().event.joinClosesAt,f.now+30000);
  f.credit('mem-bob');
  f.store.reserveWithdrawal({username:'mem-bob',requestId:'fixture-withdrawal',amount:1,
    station:'PC 2',min:1,max:1000,pointRates:rates});
  assert.throws(()=>f.join('mem-bob',1,id),/pending withdrawal/);
  assert.throws(()=>f.join('mem-zero',0,id),/whole-number/);
  assert.throws(()=>f.join('mem-zero',1.5,id),/whole-number/);
});
test('active Bingo participants cannot have their funding ledger deleted; cancellation releases the safeguard', t => {
  const f=fixture(t); f.credit('mem-alice'); const id=f.start().event.id;
  f.join('mem-alice',5,id);
  const log=f.store.getLogs({},rates).logs.find(l=>l.username==='mem-alice');
  assert.throws(()=>f.store.deleteLog(log.id),/Cancel the active Bingo/);
  assert.throws(()=>f.store.deleteMemberLogs('mem-alice'),/Cancel the active Bingo/);
  assert.throws(()=>f.store.clearAllLogs(),/Cancel the active Bingo/);
  f.bingo.cancel(id);
  assert.equal(f.store.getMemberPoints('mem-alice'),20);
  assert.equal(f.store.deleteMemberLogs('mem-alice'),true);
});
test('elected Telegram consumer accepts only fresh /bingo channel posts, retains edits, and never starts twice', t => {
  const f=fixture(t); const botHash='a'.repeat(64),owner='b'.repeat(64);
  const hub=createHub({filename:()=>path.join(f.dir,'workflow.json'),now:()=>f.now,
    onChannelPost:input=>f.bingo.start(input),
    bingoEdits:hash=>f.bingo.edits(hash),bingoEdited:(...args)=>f.bingo.edited(...args)});
  const lease=hub.claim(botHash,owner,'-10012345');
  const post=(update_id,more={})=>({update_id,channel_post:{message_id:update_id,
    text:'/bingo',date:Math.floor(f.now/1000),chat:{id:-10012345,type:'channel'},...more}});
  hub.consume(botHash,lease.token,[post(1,{chat:{id:-99999,type:'channel'}}),
    post(2,{date:Math.floor(f.now/1000)-3600}),post(3,{text:'please /bingo'}),
    post(4,{chat:{id:-10012345,type:'group'}})]);
  assert.equal(f.bingo.state().event,null);
  hub.consume(botHash,lease.token,[post(5),post(5)]);
  const id=f.bingo.state().event.id;
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM bingo_events').get().n,1);
  const message=hub.eventEdits(botHash,lease.token).messages[0];
  assert.equal(message.messageId,5); assert.match(message.text,/BINGO EVENT STARTED/);
  hub.eventEdited(botHash,lease.token,message.key,message.version);
  assert.equal(hub.eventEdits(botHash,lease.token).messages.length,0);
  f.credit('mem-alice'); f.join('mem-alice',2,id);
  assert.equal(hub.eventEdits(botHash,lease.token).messages.length,1,'retry same message edit after state changes');
  assert.equal(hub.claim(botHash,'c'.repeat(64),'-10012345').acquired,false);
  f.restart(); assert.equal(f.start(5).event.id,id);
});
test('Telegram lists every accepted player and actual card bet throughout the event, editing the same message',t=>{
  const f=fixture(t),hash='a'.repeat(64),id=f.start().event.id;
  const players=[['mem-alice',2],['mem-bob',1],['mem-carol',2],['mem-dana',1]];
  const initial=f.bingo.edits(hash)[0];
  f.bingo.edited(hash,initial.key,initial.version);
  for(const [index,[username,amount]] of players.entries()) {
    f.credit(username);
    f.bingo.join({username,amount,station:`PC ${index+1}`,eventId:id,requestId:cryptoId()});
    const edit=f.bingo.edits(hash)[0];
    assert.equal(edit.messageId,100);
    assert.notEqual(edit.version,initial.version);
    assert.match(edit.text,new RegExp(`${username} \\(PC ${index+1}\\) — Bet: ${amount} points · ${amount} card\\(s\\)`));
    f.bingo.edited(hash,edit.key,edit.version);
  }
  f.advance(30000);f.bingo.advance();f.advance(3000);f.bingo.advance();
  const live=f.bingo.edits(hash)[0];
  assert.match(live.text,/BINGO DRAWING LIVE/);
  assert.match(live.text,/Players: 4 · Cards: 6/);
  assert.match(live.text,/Prize pool: 6 points/);
  assert.match(live.text,/PLAYERS & BETS:/);
  for(const [username] of players)assert.ok(live.text.includes(username));
  f.bingo.edited(hash,live.key,live.version);
  assert.equal(f.bingo.edits(hash).length,0);
  f.bingo.cancel(id);
  const cancelled=f.bingo.edits(hash)[0];
  assert.match(cancelled.text,/All bets refunded/);
  assert.match(cancelled.text,/mem-alice \(PC 1\) — Bet: 2 points · 2 card\(s\)/);
});
test('Bingo voice says actual points, not multipliers, validates calls and keeps member failures private', async () => {
  assert.match(formatAnnouncement({type:'bingo-win',username:'mem-alice',payout:4,winningCards:2}),/4 points.*2 winning cards/);
  assert.doesNotMatch(formatAnnouncement({type:'bingo-win',username:'mem-alice',payout:4,winningCards:2}),/multiplier|mem-/);
  assert.match(formatAnnouncement({type:'bingo-failed',username:'mem-alice',insufficient:true}),/not enough points/);
  assert.equal(formatAnnouncement({type:'bingo-call',username:'mem-alice',letter:'B',number:1}),'B. 1.');
  assert.throws(()=>formatAnnouncement({type:'bingo-call',username:'mem-alice',letter:'O',number:1}),/Invalid/);
  const c=new KioskVoiceCoordinator({generate:async()=>Buffer.alloc(0),play:async()=>{},log:()=>{}});
  c.observeStatus({isLogin:true,sessionTimeLeft:100,username:'mem-bob'});
  const voice={id:'bingo-fail:1',type:'bingo-failed',username:'mem-alice',insufficient:true,expiresAt:Date.now()+10000};
  assert.equal(c.bingoEvent(voice),false);
  c.close();
});
