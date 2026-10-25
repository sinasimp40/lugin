'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {registerBingoRoutes}=require('../src/bingo-routes');
const {KioskVoiceCoordinator,formatAnnouncement}=require('../src/voice-announcements');
test('every kiosk announces winners without an active member, with public-only data and deduped voice',async()=>{
  const routes=new Map(),messages=[];
  let tick;
  const interval=global.setInterval;
  const event={id:'round-all-pcs',phase:'finished',finishedAt:Date.now(),deck:[1,2],participants:[{cards:['private']}],
    winners:[{username:'mem-alice',station:'PC 1',payout:6,winningCards:2,cardIds:['secret']},
      {username:'mem-bob',station:'PC 3',payout:3,winningCards:1}]};
  global.setInterval=fn=>{tick=fn;return {unref(){}};};
  try {
    const app={get(path,...handlers){routes.set(path,handlers.at(-1));},post(){}};
    registerBingoRoutes(app,{appRole:'auto-shutdown',broadcast:m=>messages.push(m),
      fetchPoints:async()=>({success:true,supportsBingo:true,event}),
      activeMember:()=>{throw new Error('Public results must not require a logged-in member');}});
  } finally {global.setInterval=interval;}
  await tick();await tick();
  assert.equal(messages.filter(m=>m.type==='bingo-result').length,1);
  const voices=messages.filter(m=>m.type==='bingo-voice-event').map(m=>m.data);
  assert.equal(voices.length,2);
  assert.match(formatAnnouncement(voices[0]),/6 points with 2 winning cards/);
  assert.match(formatAnnouncement(voices[1]),/3 points with 1 winning card/);
  let result;
  routes.get('/api/bingo/result')({}, {setHeader(){},json:data=>{result=data;}});
  assert.doesNotMatch(JSON.stringify(result),/deck|participants|cardIds|private|secret/);
  const c=new KioskVoiceCoordinator({generate:async()=>Buffer.alloc(0),play:async()=>{},log(){}});
  assert.equal(c.bingoEvent(voices[0]),true);
  assert.equal(c.bingoEvent(voices[0]),false);
  c.close();
});
test('draw voice is emitted only for an accepted member, with confirmation before the first call',async()=>{
  const handlers=new Map(),messages=[];
  let member={username:'mem-bob'},participant=null;
  const event={id:'round-private',phase:'drawing',called:[1,7],latestCall:{letter:'B',number:7},winners:[]};
  const interval=global.setInterval;
  global.setInterval=()=>({unref(){}});
  try {
    registerBingoRoutes({get(path,...fn){handlers.set(path,fn.at(-1));},post(){}},{
      appRole:'auto-shutdown',broadcast:msg=>messages.push(msg),activeMember:async()=>member,
      fetchPoints:async()=>({success:true,username:member.username,event,participant})});
  } finally {global.setInterval=interval;}
  const get=()=>handlers.get('/api/session/bingo')({query:{}},{json(){}});
  await get();
  assert.equal(messages.length,0,'a nonparticipant must never get draw audio');
  // Mismatched member data cannot authorize this PC to hear somebody else.
  participant={username:'mem-alice',stake:2,cardCount:2};
  await get();assert.equal(messages.length,0);
  member={username:'mem-alice'};
  await get();
  assert.deepEqual(messages.map(m=>m.data.type),['bingo-joined','bingo-call']);
  assert.equal(messages[1].data.callIndex,2);
  assert.equal(messages[1].data.joined,true);
  assert.equal(messages[1].data.eventId,event.id);
  await get();assert.equal(messages.length,2,'polling must not repeat the same call');
});
test('native draw audio requires membership and coalesces late calls instead of playing behind the marks',async()=>{
  const heard=[],interrupts=[];
  let release;
  const c=new KioskVoiceCoordinator({log(){},interrupt(){interrupts.push(1);release?.();},
    announce:async(event,relevant)=>{
      if(event.type!=='bingo-call')return;
      if(event.number===1)await new Promise(resolve=>{release=resolve;});
      if(relevant())heard.push(event.number);
    }});
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  c.observeStatus({isLogin:true,sessionTimeLeft:100,username:'mem-alice'});
  const joined={type:'bingo-joined',id:'bingo-joined:private:mem-alice',eventId:'private',
    username:'mem-alice',cardCount:2,expiresAt:Date.now()+30000};
  const call=(index,number)=>({type:'bingo-call',id:`bingo-call:private:${number}:mem-alice`,
    eventId:'private',username:'mem-alice',callIndex:index,number,
    letter:'BINGO'[Math.floor((number-1)/15)],expiresAt:Date.now()+30000});
  assert.equal(c.bingoEvent(call(1,1)),false);
  assert.equal(c.bingoEvent(joined),true);
  assert.equal(c.bingoEvent(call(1,1)),true);
  await tick();
  assert.equal(c.bingoEvent(call(2,16)),true);
  assert.equal(c.bingoEvent(call(3,31)),true);
  await tick();
  assert.deepEqual(heard,[31],'obsolete audio and queued older calls are skipped');
  assert.equal(c.bingoEvent(call(2,16)),false);
  assert.ok(interrupts.length>0);
  c.observeStatus({isLogin:true,sessionTimeLeft:100,username:'mem-bob'});
  assert.equal(c.bingoMemberships.size,0);
  assert.equal(c.bingoEvent({...call(4,46),username:'mem-bob'}),false);
  assert.equal(c.bingoEvent({...call(4,46),username:'mem-bob',joined:true}),true,
    'the private member snapshot restores participation after a voice restart');
  c.close();
});
