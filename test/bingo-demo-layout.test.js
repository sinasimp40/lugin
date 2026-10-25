'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('Bingo preview uses the isolated room member and dock placement, not the generic preview identity', async()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/session.html'),'utf8');
  const start=html.indexOf('    async function loadStatus()');
  const end=html.indexOf('      try {',start);
  assert.ok(start>=0 && end>start);
  for(const [search,expected,placement] of [
    ['?preview=1&bingoDemo=1&demoMember=mem-demo-pc1','mem-demo-pc1','above'],
    ['?preview=1&bingoDemo=1&demoMember=mem-demo-pc3&demoPlacement=below','mem-demo-pc3','below'],
    ['?preview=1&bingoDemo=1&demoMember=mem-demo-empty','mem-demo-empty','above'],
    ['?preview=1&username=mem-custom-long-name','mem-custom-long-name','above'],
    ['?preview=1&bingoDemo=1&demoMember=mem-real-account','mem-player-one','above'],
  ]){
    const run=new Function('location','URLSearchParams',`
      const previewMode=true;
      let sessionUsername='',sessionOverlayPlacement='above',timeLeft=0;
      function syncOrderStatusSession(){}
      function setDisplayedUsername(){}
      function setPcLabel(){}
      function setPoints(){}
      function setAttendance(){}
      function updateAttendanceButton(){}
      function updateTimer(){}
      function finishInitialSessionStatus(){}
      ${html.slice(start,end)} }
      return loadStatus().then(()=>({username:sessionUsername,placement:sessionOverlayPlacement}));
    `);
    assert.deepEqual(await run({search},URLSearchParams),{username:expected,placement});
  }
});
test('demo polling never reparents the live iframe; only an explicit dock change moves it',()=>{
  const script=fs.readFileSync(path.join(__dirname,'../public/bingo-test.js'),'utf8');
  const begin=script.indexOf('  function applyDock(pc)');
  const end=script.indexOf('  function configureFrames()',begin);
  let moves=0;
  const classes={toggle(){}};
  const select={value:'above'};
  const nodes={
    '.desktop':{classList:classes,insertBefore(){moves++;}},
    '[data-slot]':{classList:classes},
    '.monitor':{},'[data-dock-label]':{},'[data-placement]':select,
    '.pc-empty':{classList:classes}
  };
  const pc={dataset:{},querySelector:key=>nodes[key]};
  const apply=new Function(`function frameMember(){return 'mem-demo-pc1';} ${script.slice(begin,end)} return applyDock;`)();
  apply(pc);assert.equal(moves,2);
  for(let i=0;i<10;i++)apply(pc);
  assert.equal(moves,2,'unchanged snapshot leaves browsing context intact');
  select.value='below';apply(pc);assert.equal(moves,4);
  apply(pc);assert.equal(moves,4);
});
