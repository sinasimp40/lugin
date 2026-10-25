'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const historySource = fs.readFileSync(path.join(__dirname, '../public/win-notice-history.js'), 'utf8');
const sessionSource = fs.readFileSync(path.join(__dirname, '../public/session.html'), 'utf8');
function loadWindow(storage = new Map(), search = '') {
  const window = { location:{search}, console,
    localStorage:{getItem:key=>storage.get(key) || null, setItem:(key,value)=>storage.set(key,value)} };
  new Function('window',historySource)(window);
  return window;
}
function session(window, username = 'mem-current') {
  const start=sessionSource.indexOf('    const seenWinNoticeIds = new Set();');
  const end=sessionSource.indexOf('    function wheelPendingKey(',start);
  const nodes={};
  const node=()=>({textContent:'',children:[],setAttribute(){},
    replaceChildren(){this.children=[];},appendChild(child){this.children.push(child);}});
  const document={getElementById:id=>nodes[id] ||= node(),createElement:node,querySelector:()=>({textContent:''})};
  return new Function('window','document',`
    const MAX_RECENT_WIN_NOTICES = 120, MAX_QUEUED_WIN_NOTICES = 120;
    let sessionUsername=${JSON.stringify(username)},timeLeft=100,wheelRequestId=null,activeDrawer=null;
    function readPendingWheel(){return null;}
    function resizeDrawerToContent(){}
    function openDrawer(view){activeDrawer=view;}
    ${sessionSource.slice(start,end)}
    return {receive:receiveWinNotice,ready:finishInitialSessionStatus,
      close(){activeDrawer=null;displayedWinNotice=null;pendingWinNotice=null;},
      current(){return activeDrawer;}};
  `)(window,document);
}
test('a closed winner never returns after logout, session recreation, or another member login',()=>{
  const storage=new Map();
  const win={id:'previous-win',username:'mem-winner',multiplier:5,createdAt:100};
  const first=session(loadWindow(storage));
  first.ready();first.receive(win);
  assert.equal(first.current(),'wins');
  first.close();
  assert.equal(first.current(),null);
  for(const username of ['mem-current','mem-different']) {
    const next=session(loadWindow(storage),username);
    next.receive(win);next.ready();
    assert.equal(next.current(),null,'a replay before initial status must also be ignored');
    next.receive(win);
    assert.equal(next.current(),null,'a later replay cannot reopen the old popup');
  }
  const fresh=session(loadWindow(storage));
  fresh.ready();fresh.receive({...win,id:'new-win',createdAt:200});
  assert.equal(fresh.current(),'wins','a genuinely new win still appears');
});
test('logged-out sessions do not display or consume new win notifications',()=>{
  const window=loadWindow();
  const page=session(window,'');
  page.ready();page.receive({id:'idle-win',username:'mem-winner',multiplier:3,createdAt:100});
  assert.equal(page.current(),null);
  assert.equal(window.DenfiWinNotices.isSeen('idle-win'),false);
});
test('unrevealed wins are not consumed by persistent popup history',()=>{
  const window=loadWindow();
  const page=session(window);
  page.receive({id:'early-win',username:'mem-winner',multiplier:3,createdAt:100});
  assert.equal(window.DenfiWinNotices.isSeen('early-win'),false);
  page.ready();
  assert.equal(window.DenfiWinNotices.isSeen('early-win'),true);
});
test('popup history is bounded and preview samples cannot affect real notifications',()=>{
  const storage=new Map(),window=loadWindow(storage);
  for(let i=0;i<205;i++)window.DenfiWinNotices.markSeen('win-'+i);
  assert.equal(window.DenfiWinNotices.isSeen('win-0'),false);
  assert.equal(loadWindow(storage).DenfiWinNotices.isSeen('win-204'),true);
  loadWindow(storage,'?preview=1').DenfiWinNotices.markSeen('sample-win');
  assert.equal(loadWindow(storage).DenfiWinNotices.isSeen('sample-win'),false);
});
