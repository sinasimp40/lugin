'use strict';
// Test rooms own independent, memory-only ledgers. Never use the shop's database,
// settings, Telegram consumer, session identity, or voice broadcast here.
const crypto = require('node:crypto');
const { createStore } = require('./coin-log-sqlite-store');
const { createBingoService, wins } = require('./bingo-service');
const MEMBERS = [
  { username:'mem-demo-pc1', station:'PC 1' },
  { username:'mem-demo-pc3', station:'PC 3' },
  { username:'mem-demo-empty', station:'No points' }
];
const rates = [{ pesos:1, points:1 }];
const TTL = 30 * 60 * 1000;
function createDemoRoom() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  const store = createStore(db);
  const room = { id:crypto.randomUUID(), db, store, offset:0, commands:0, touched:Date.now() };
  room.now = () => Date.now() + room.offset;
  room.service = createBingoService({ getDb:()=>db, coinLogs:store, getRates:()=>rates, now:room.now });
  for (const member of MEMBERS.slice(0,2)) store.appendLog({username:member.username,amount:100},rates);
  return room;
}
function snapshot(room) {
  const states = MEMBERS.map(m=>room.service.state(m.username));
  const command = room.db.prepare('SELECT * FROM bingo_commands ORDER BY rowid DESC LIMIT 1').get();
  return { success:true, demo:true, roomId:room.id, members:MEMBERS, states,
    balances:Object.fromEntries(MEMBERS.map(m=>[m.username,room.store.getMemberPoints(m.username)])),
    telegramText:command ? room.service.commandText(command).text : 'Type /bingo to start a round.',
    telegramMessageId:command?.message_id || null };
}
function start(room) {
  if (room.commands >= 20) throw Object.assign(new Error('This sample has reached 20 rounds. Reload the test page for a new fake ledger.'),{status:409});
  const current = room.service.state().event;
  if (current && ['joining','drawing'].includes(current.phase)) room.service.cancel(current.id);
  return room.service.start({botHash:'d'.repeat(64),chatId:'-10000001',messageId:++room.commands});
}
function next(room) {
  let current = room.service.state().event;
  if (!current || !['joining','drawing'].includes(current.phase)) return;
  room.offset += Math.max(0,(current.phase==='joining' ? current.joinClosesAt : current.nextDrawAt)-room.now());
  current = room.service.advance();
  if (current.phase==='drawing' && current.called.length===0) {
    room.offset += Math.max(0,current.nextDrawAt-room.now());
    room.service.advance();
  }
}
function example(room) {
  const event = start(room).event;
  for (const member of MEMBERS.slice(0,2)) {
    const delta = Number((100-room.store.getMemberPoints(member.username)).toFixed(2));
    if (delta) room.store.adjustMemberPoints({username:member.username,delta,requestId:crypto.randomUUID(),
      reason:'Reset fake balance for the seeded Bingo example'},rates);
  }
  room.service.join({ ...MEMBERS[0],eventId:event.id,amount:5,requestId:crypto.randomUUID() });
  room.service.join({ ...MEMBERS[1],eventId:event.id,amount:4,requestId:crypto.randomUUID() });
  const row = room.db.prepare('SELECT payload FROM bingo_events WHERE id=?').get(event.id);
  const current = JSON.parse(row.payload);
  // Deliberately seeded example ONLY in this room. Production cards remain random.
  const target = [1,16,31,46,61], called = new Set(target);
  const winnerNumbers = Array.from({length:25},(_,i)=> (i%5)*15+Math.floor(i/5)+1);
  winnerNumbers[12]=null;
  for (const p of current.participants) {
    for (const card of p.cards) {
      // Any accidentally matching random card becomes a known losing card.
      if (wins(card,called)) {
        card.numbers = winnerNumbers.map(n=>n==null ? null : n+5);
      }
    }
    const count = p.username===MEMBERS[0].username ? 2 : 1;
    for (const card of p.cards.slice(0,count)) card.numbers = [...winnerNumbers];
  }
  current.deck = [...target,...current.deck.filter(n=>!called.has(n))];
  room.db.prepare('UPDATE bingo_events SET payload=? WHERE id=?').run(JSON.stringify(current),event.id);
}
function registerBingoDemoRoutes(app) {
  const rooms = new Map();
  function prune() {
    for (const [id,room] of rooms) if (Date.now()-room.touched>TTL) {room.db.close();rooms.delete(id);}
  }
  const timer = setInterval(prune,60000); timer.unref();
  function wrap(fn) {
    return (req,res)=>{
      res.setHeader('Cache-Control','no-store');
      try {
        const room = req.params.room ? rooms.get(req.params.room) : null;
        if (req.params.room && !room) throw Object.assign(new Error('Sample expired. Reload this test page.'),{status:404});
        if (room) room.touched=Date.now();
        res.json(fn(req,room));
      } catch (err) {
        res.status([400,404,409,429,503].includes(err.status)?err.status:503)
          .json({success:false,demo:true,error:err.status ? err.message : 'The isolated Bingo sample could not run. No shop points were changed.'});
      }
    };
  }
  app.post('/api/demo/bingo',wrap(()=>{
    prune();
    if (rooms.size>=32) throw Object.assign(new Error('Too many sample sessions are open. Wait for an unused sample to expire.'),{status:429});
    const room=createDemoRoom(); rooms.set(room.id,room); start(room); return snapshot(room);
  }));
  app.get('/api/demo/bingo/:room',wrap((_req,room)=>snapshot(room)));
  app.get('/api/demo/bingo/:room/member/:username',wrap((req,room)=>{
    if (!MEMBERS.some(m=>m.username===req.params.username)) throw Object.assign(new Error('Choose a sample PC.'),{status:400});
    return room.service.state(req.params.username,Number(req.query.cardOffset || 0));
  }));
  app.post('/api/demo/bingo/:room/join',wrap((req,room)=>{
    const member=MEMBERS.find(m=>m.username===req.body?.username);
    if (!member) throw Object.assign(new Error('Choose a sample PC.'),{status:400});
    return room.service.join({...member,eventId:req.body.eventId,amount:req.body.amount,requestId:req.body.requestId});
  }));
  app.post('/api/demo/bingo/:room/control',wrap((req,room)=>{
    const action=req.body?.action;
    if (action==='start') start(room);
    else if (action==='next') next(room);
    else if (action==='finish') {
      for (let i=0;i<76;i++) {
        const phase=room.service.state().event?.phase;
        if (!['joining','drawing'].includes(phase)) break;
        next(room);
      }
    } else if (action==='cancel') {
      const current=room.service.state().event;
      if (current) room.service.cancel(current.id);
    } else if (action==='example') example(room);
    else throw Object.assign(new Error('Unknown sample action.'),{status:400});
    return snapshot(room);
  }));
  return { close:()=>{clearInterval(timer);for(const room of rooms.values())room.db.close();rooms.clear();} };
}
module.exports={registerBingoDemoRoutes,createDemoRoom,snapshot,start,next,example};
