'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
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
