// Isolated browser fixture. Never run against shop data or Telegram.
'use strict';
if (process.env.NODE_ENV !== 'test') throw new Error('This fixture requires NODE_ENV=test.');
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const database = require('../../src/points-database');
const coinLogs = require('../../src/coin-log-store');
const { registerBingoRoutes } = require('../../src/bingo-routes');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-bingo-browser-'));
const db = database.initialize(dir);
coinLogs.useSqlite(db);
const rates = [{ pesos: 1, points: 1 }];
for (const username of ['mem-bingo-a', 'mem-bingo-b']) coinLogs.appendLog({ username, amount: 50 }, rates);
const config = { pointRates: rates };
const settings = { getSettings: () => config };
const next = (_req, _res, next) => next();
const username = req => /bingo_fixture_member=(mem-[a-z0-9-]+)/.exec(req.headers.cookie || '')?.[1] || 'mem-bingo-a';
const member = async req => ({ username: username(req), station: username(req).endsWith('b') ? 'PC 3' : 'PC 1' });
const realNow = Date.now;
let clockOffset = 0;
Date.now = () => realNow() + clockOffset;
const points = express(); points.use(express.json());
const pointsService = registerBingoRoutes(points, {
  appRole: 'points', coinLogs, settings, verifyToken: next, authorizeKioskMission: next,
  requireLocalPlayer: next, activeMember: member, fetchPoints: () => { throw new Error('Not a kiosk'); }, broadcast: () => {}
});
const pointsServer = points.listen(3310, '127.0.0.1');
const kiosk = express(); kiosk.use(express.json());
const voices = [];
let ws;
const broadcast = message => {
  if (message.type === 'bingo-voice-event') voices.push(message.data);
  for (const client of ws?.clients || []) if (client.readyState === 1) client.send(JSON.stringify(message));
};
registerBingoRoutes(kiosk, {
  appRole: 'auto-shutdown', coinLogs, settings, verifyToken: next, authorizeKioskMission: next,
  requireLocalPlayer: next, activeMember: member, broadcast,
  fetchPoints: async (route, options) => {
    const response = await fetch('http://127.0.0.1:3310' + route, options);
    const data = await response.json();
    if (!response.ok || !data.success) throw Object.assign(new Error(data.error), { status: response.status });
    return data;
  }
});
kiosk.get('/__fixture/start', (_req, res) => {
  res.json(pointsService.start({ botHash: 'a'.repeat(64), chatId: '-10012345', messageId: Date.now() }));
});
kiosk.get('/__fixture/advance', (req, res) => {
  clockOffset += Math.max(0, Math.min(3600000, Number(req.query.ms) || 0));
  pointsService.advance(); res.json(pointsService.state());
});
kiosk.get('/__fixture/state', (_req, res) => res.json({ state: pointsService.state(), voices,
  balances: Object.fromEntries(['mem-bingo-a','mem-bingo-b','mem-bingo-empty'].map(u=>[u,coinLogs.getMemberPoints(u)])) }));
kiosk.get('/__fixture/finish', (_req, res) => {
  for (let i=0; i<76 && ['joining','drawing'].includes(pointsService.state().event?.phase); i++) {
    clockOffset += 31000; pointsService.advance();
  }
  res.json(pointsService.state());
});
const status = req => ({ isLogin: true, username: username(req), sessionTimeLeft: 3600,
  pcName: username(req).endsWith('b') ? 'PC 3' : 'PC 1', memberPoints: coinLogs.getMemberPoints(username(req)) });
kiosk.get('/api/hotspot/status', (req,res)=>res.json({success:true,data:status(req)}));
kiosk.get('/api/session/orders/status', (req,res)=>res.json({success:true,username:username(req),orders:[]}));
kiosk.get('/api/session/withdrawal', (_req,res)=>res.json({success:true,enabled:false}));
kiosk.get('/api/settings', (_req,res)=>res.json({success:true,settings:{}}));
kiosk.get('/api/admin/status', (_req,res)=>res.json({success:true,settings:{},appRole:'auto-shutdown'}));
kiosk.get('/session.html', (req,res,next)=>{
  if (/^mem-bingo-(a|b|empty)$/.test(req.query.member || ''))
    res.setHeader('Set-Cookie',`bingo_fixture_member=${req.query.member}; Path=/; SameSite=Lax`);
  next();
});
kiosk.use(express.static(path.join(__dirname,'../../public')));
const kioskServer = http.createServer(kiosk);
ws = new WebSocketServer({server:kioskServer,path:'/ws/session'});
ws.on('connection',(socket,req)=>{
  const send=()=>socket.readyState===1 && socket.send(JSON.stringify({type:'status',data:status(req)}));
  send(); const timer=setInterval(send,1000); socket.on('close',()=>clearInterval(timer));
});
const fixturePort = Number(process.env.DENFI_BINGO_FIXTURE_PORT || 3311);
const fixtureHost = process.env.DENFI_BINGO_FIXTURE_HOST || '127.0.0.1';
kioskServer.listen(fixturePort,fixtureHost,()=>console.log(`BINGO fixture ready on ${fixturePort}; isolated temporary ledger.`));
function stop() {
  ws.close(); kioskServer.close(); pointsServer.close();
  database.close(); fs.rmSync(dir,{recursive:true,force:true}); process.exit(0);
}
process.on('SIGTERM',stop); process.on('SIGINT',stop);
