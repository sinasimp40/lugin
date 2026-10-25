'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../public/bingo-session.js'), 'utf8');
function page(response, search = '', username = 'mem-alice') {
  const nodes = new Map();
  const makeNode = () => ({textContent:'',disabled:false,hidden:false,style:{},children:[],scrollTop:0,
    classList:{toggle(){},remove(){},add(){}},setAttribute(){},
    replaceChildren(){this.children=[];},appendChild(node){this.children.push(node);},
    append(...nodes){this.children.push(...nodes);},
    querySelector(selector){return this.children.find(n=>String(n.className||'').split(' ').includes(selector.slice(1))) || null;}});
  const document = {
    readyState: 'loading', addEventListener() {},
    querySelectorAll(){return [];},
    createElement:makeNode,
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id,makeNode());
      return nodes.get(id);
    }
  };
  const notices = [];
  const refunds = [];
  const controls = {activeDrawer:null,opens:0,closes:0};
  const window = { DenfiBingoSessionContext: () => ({ username, ready:true, resize() {},
    activeDrawer:controls.activeDrawer,busy:!!controls.activeDrawer && controls.activeDrawer !== 'bingo',
    openBingo(){controls.opens++;controls.activeDrawer='bingo';},
    closeDrawer(){if(controls.activeDrawer==='bingo' && window.DenfiBingoSession?.isLocked())return;controls.closes++;controls.activeDrawer=null;},
    notifyWin:win=>notices.push(win),notifyRefund:notice=>refunds.push(notice) }) };
  const requests = [];
  const storage = new Map();
  const sessionStorage = { getItem:k=>storage.get(k) || null, removeItem:k=>storage.delete(k), setItem:(k,v)=>storage.set(k,v) };
  vm.runInNewContext(script, { window, document, location:{search}, URLSearchParams, AbortController,
    setTimeout, clearTimeout, Date, sessionStorage, localStorage:sessionStorage,
    fetch:async url=>{requests.push(url);const result=typeof response==='function'?response(url):response;
      return {ok:result.ok,json:async()=>result.data};} });
  return { window, nodes, requests, notices, refunds, controls, storage };
}
test('fixed one-card event policy overrides balance defaults and a conflicting global setting', async () => {
  const state = {
    success:true, username:'mem-alice', serverNow:Date.now(), balance:50,
    config:{allowCustomStake:true,maxCardsPerMember:100},
    event:{id:'fixed-cards',phase:'joining',joinClosesAt:Date.now()+300000,
      pot:0,players:0,totalCards:0,called:[],winners:[],
      config:{allowCustomStake:false,maxCardsPerMember:100}},
    participant:null,
  };
  const p = page({ok:true,data:state});
  await p.window.DenfiBingoSession.refresh();
  const input = p.nodes.get('bingo-amount');
  assert.equal(input.value, '1');
  assert.equal(input.readOnly, true);
  assert.equal(String(input.max), '1');
});
test('failed Bingo state responses without a member identity display their error rather than being silently discarded', async () => {
  const p=page({ok:false,data:{success:false,error:'Denfi Points is disconnected.'}});
  await p.window.DenfiBingoSession.refresh();
  assert.equal(p.nodes.get('bingo-status-msg').textContent,'Denfi Points is disconnected.');
  assert.equal(p.nodes.get('bingo-join-btn').disabled,true);
});
test('successful Bingo state for a different member is never applied to the current session', async () => {
  const p=page({ok:true,data:{success:true,username:'mem-bob',balance:999,event:null}});
  await p.window.DenfiBingoSession.refresh();
  assert.equal(p.nodes.has('bingo-metric-pot'),false);
});
test('interactive sample sends Bingo reads only to its isolated demo namespace', async () => {
  const p=page({ok:false,data:{success:false,error:'Sample expired.'}},
    '?preview=1&bingoDemo=1&demoRoom=test-room&demoMember=mem-demo-pc1','mem-demo-pc1');
  await p.window.DenfiBingoSession.refresh();
  assert.equal(p.requests.length,1);
  assert.match(p.requests[0],/^\/api\/demo\/bingo\/test-room\/member\/mem-demo-pc1/);
});
test('a malformed demo cannot fall back to production Bingo APIs', async () => {
  const p=page({ok:false,data:{success:false}},'?preview=1&bingoDemo=1&demoMember=not-a-sample-member');
  await p.window.DenfiBingoSession.refresh();
  assert.equal(p.requests.length,0);
});
test('other HTML preview modes never contact live Bingo APIs', async () => {
  const p=page({ok:true,data:{success:true}},'?preview=1&games=1&test=1');
  await p.window.DenfiBingoSession.refresh();
  assert.equal(p.requests.length,0);
});
test('Bingo defaults to whole affordable cards, respects the event cap, and preserves a member edit', async () => {
  const joining = (id, balance, limit = 100) => ({
    success:true, username:'mem-alice', serverNow:Date.now(), balance,
    config:{maxCardsPerMember:limit},
    event:{id,phase:'joining',joinClosesAt:Date.now()+30000,pot:0,players:0,totalCards:0,
      called:[],winners:[],config:{maxCardsPerMember:limit}},
    participant:null
  });
  let state = joining('stake-default-one', 2.3);
  const p = page(() => ({ok:true,data:state}));
  await p.window.DenfiBingoSession.refresh();
  const input = p.nodes.get('bingo-amount');
  assert.equal(input.value, '2', '2.3 spendable points default to 2 cards');
  input.value = '1';
  await p.window.DenfiBingoSession.refresh();
  assert.equal(input.value, '1', 'polling does not overwrite a member-edited amount');
  state = joining('stake-default-two', 5.8, 3);
  await p.window.DenfiBingoSession.refresh();
  assert.equal(input.value, '3', 'a new event defaults to whole points but never exceeds its card cap');
});
test('simultaneous Bingo winners retain the current member own payout as the final visible notice', async () => {
  const now=Date.now();
  const p=page({ok:true,data:{success:true,username:'mem-alice',serverNow:now,balance:101,participant:null,
    event:{id:'sample',phase:'finished',finishedAt:now,pot:9,players:2,totalCards:9,called:[],
      winners:[{username:'mem-alice',winningCards:2,payout:6},{username:'mem-bob',winningCards:1,payout:3}]}}});
  await p.window.DenfiBingoSession.refresh();
  assert.deepEqual(p.notices.map(w=>w.username),['mem-bob','mem-alice']);
  assert.equal(p.notices.at(-1).payout,6);
});
function cardState(count=18) {
  const cards=Array.from({length:count},(_,i)=>({id:`card-${i+1}`,numbers:Array.from({length:25},(_,n)=>n===12?null:n+1)}));
  return {success:true,username:'mem-alice',serverNow:Date.now(),balance:2,
    event:{id:'all-cards',phase:'drawing',pot:count,players:1,totalCards:count,called:[1],winners:[]},
    participant:{username:'mem-alice',cardOffset:0,cardCount:count,stake:count,cards,winningCardIds:[]}};
}
test('all purchased cards render together with no page buttons, and polling preserves scroll',async()=>{
  const p=page({ok:true,data:cardState()});
  await p.window.DenfiBingoSession.refresh();
  const list=p.nodes.get('bingo-card-area').querySelector('.bingo-card-list');
  assert.equal(list.children.length,18);
  assert.match(list.children[17].children[0].innerHTML,/CARD 18 \/ 18/);
  assert.equal(p.nodes.get('bingo-card-area').querySelector('.bingo-pagination'),null);
  list.scrollTop=250;
  await p.window.DenfiBingoSession.refresh();
  assert.equal(p.nodes.get('bingo-card-area').querySelector('.bingo-card-list'),list);
  assert.equal(list.scrollTop,250);
});
test('older twelve-card responses are collected into one popup without losing or exposing cards',async()=>{
  const full=cardState(25);
  const p=page(url=>{
    const offset=Number(new URL(url,'http://demo.test').searchParams.get('cardOffset'));
    return {ok:true,data:{...full,participant:{...full.participant,cardOffset:offset,cards:full.participant.cards.slice(offset,offset+12)}}};
  });
  await p.window.DenfiBingoSession.refresh();
  assert.equal(p.requests.length,3);
  assert.equal(p.nodes.get('bingo-card-area').querySelector('.bingo-card-list').children.length,25);
});
test('accepted active cards reopen after a restart or dismissal flag and cannot be closed',async()=>{
  const p=page({ok:true,data:cardState(2)});
  p.storage.set('denfi-bingo-seen:mem-alice:all-cards','closed');
  await p.window.DenfiBingoSession.refresh();
  assert.equal(p.window.DenfiBingoSession.isLocked(),true);
  assert.equal(p.controls.activeDrawer,'bingo');
  p.window.DenfiBingoSession.close();
  assert.equal(p.controls.activeDrawer,'bingo');
  p.controls.activeDrawer='rank';
  await p.window.DenfiBingoSession.refresh();
  assert.equal(p.controls.activeDrawer,'bingo');
  assert.equal(p.controls.opens,2);
});
test('finishing the paid game unlocks and closes it after forwarding the public winner',async()=>{
  let state=cardState(2);
  const p=page(()=>({ok:true,data:state}));
  await p.window.DenfiBingoSession.refresh();
  state={...state,event:{...state.event,phase:'finished',finishedAt:Date.now(),
    winners:[{username:'mem-alice',payout:2,winningCards:1}]},participant:{...state.participant,payout:2}};
  await p.window.DenfiBingoSession.refresh();
  assert.equal(p.window.DenfiBingoSession.isLocked(),false);
  assert.equal(p.controls.activeDrawer,null);
  assert.equal(p.notices[0].payout,2);
});
test('no-points and declined invitations close and never reopen in the same event',async()=>{
  const state={...cardState(1),participant:null,balance:0};
  state.event={...state.event,phase:'joining',joinClosesAt:Date.now()+30000};
  const p=page({ok:true,data:state});
  p.controls.activeDrawer='bingo';
  await p.window.DenfiBingoSession.refresh();
  assert.equal(p.controls.activeDrawer,null);
  state.balance=20;
  await p.window.DenfiBingoSession.refresh();
  assert.equal(p.controls.opens,0);
  const q=page({ok:true,data:state});
  await q.window.DenfiBingoSession.refresh();
  assert.equal(q.controls.activeDrawer,'bingo');
  q.window.DenfiBingoSession.close();
  await q.window.DenfiBingoSession.refresh();
  assert.equal(q.controls.activeDrawer,null);
});
test('solo-entry cancellation unlocks Bingo and sends only the participant a deduplicated refund notice',async()=>{
  let state=cardState(25);
  const p=page(()=>({ok:true,data:state}));
  await p.window.DenfiBingoSession.refresh();
  state={...state,balance:100,event:{...state.event,phase:'cancelled',finishedAt:Date.now(),
    reason:'Not enough participants. At least two members must join. All bets refunded.'}};
  await p.window.DenfiBingoSession.refresh();
  await p.window.DenfiBingoSession.refresh();
  assert.equal(p.window.DenfiBingoSession.isLocked(),false);
  assert.equal(p.controls.activeDrawer,null);
  assert.equal(p.refunds.length,1);
  assert.equal(p.refunds[0].game,'bingo-refund');
  assert.equal(p.refunds[0].payout,25);
  assert.match(p.refunds[0].reason,/Not enough participants/);
  assert.equal(p.notices.length,0);
  const other=page({ok:true,data:{...state,username:'mem-bob',participant:null}},'mem-bob');
  await other.window.DenfiBingoSession.refresh();
  assert.equal(other.refunds.length,0);
});
test('a fresh Bingo event closes a blocking recent-winner popup before opening its invitation',async()=>{
  const state={...cardState(1),participant:null};
  state.event={...state.event,phase:'joining',joinClosesAt:Date.now()+30000};
  const p=page({ok:true,data:state});
  p.controls.activeDrawer='wins';
  await p.window.DenfiBingoSession.refresh();
  assert.equal(p.controls.closes,1);
  assert.equal(p.controls.activeDrawer,'bingo');
  await p.window.DenfiBingoSession.refresh();
  assert.equal(p.controls.opens,1);
  assert.equal(p.controls.closes,1);
});
test('a login screen never fetches or presents Bingo winner popups',async()=>{
  const p=page({ok:true,data:{success:true,event:null}},'','');
  p.window.DenfiBingoSession.publicResult({id:'old-result',phase:'finished',finishedAt:Date.now(),
    winners:[{username:'mem-alice',payout:5,winningCards:1}]});
  assert.equal(p.notices.length,0);
  await p.window.DenfiBingoSession.refresh();
  assert.equal(p.requests.length,0,'idle/login rendering must not poll the public winner feed');
});
