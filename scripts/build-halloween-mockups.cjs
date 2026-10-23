const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const pub = path.join(root, 'public');
const output = path.join(pub, 'halloween-mockups');
const source = fs.readFileSync(path.join(pub, 'session.html'), 'utf8');
const uri = file => {
  const ext = path.extname(file);
  const type = ({ '.png':'image/png', '.woff2':'font/woff2', '.wav':'audio/wav', '.mp3':'audio/mpeg' })[ext];
  return `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
};
const inlineCss = text => text.replace(/url\((['"]?)([^)'"]+)\1\)/g, (all, quote, url) => {
  if (/^(data:|https?:)/.test(url)) return all;
  const file = path.join(pub, url.replace(/^\//, ''));
  return fs.existsSync(file) ? `url("${uri(file)}")` : all;
});
let extracted = source
  .replace(/<link rel="stylesheet" href="([^"]+)"\s*\/?>/g, (_, url) =>
    `<style>${inlineCss(fs.readFileSync(path.join(pub, url), 'utf8'))}</style>`)
  .replace(/<script src="([^"]+)"><\/script>/g, (_, url) =>
    `<script>${fs.readFileSync(path.join(pub, url), 'utf8')
      .replace('const params = new URLSearchParams(location.search);', "const params = new URLSearchParams('preview=1&withdraw=1');")
      .replace(/<\/script/gi, '<\\/script')}</script>`);
extracted = inlineCss(extracted)
  .replaceAll('src="/icon.png"', `src="${uri(path.join(pub, 'icon.png'))}"`)
  .replace(/new Audio\('([^']+)'\)/g, (_, file) => `new Audio('${uri(path.join(pub, file))}')`)
  .replace("const previewMode = new URLSearchParams(location.search).get('preview') === '1';", 'const previewMode = true;')
  .replaceAll('}, location.origin);', "}, '*');")
  .replace("const demoUsername = new URLSearchParams(location.search).get('username') || '';",
    "const demoUsername = 'mem-this-is-a-long-member-username';")
  .replace('    syncOrderStatusSession();\n    loadStatus();', `
    window.addEventListener('message', event => {
      if (event.source !== parent) return;
      if (event.data?.type === 'mockup-username' && /^mem-[a-z0-9._-]{1,80}$/i.test(event.data.value)) {
        sessionUsername = event.data.value;
        setDisplayedUsername(sessionUsername);
        updateAttendanceButton();
      }
    });
    syncOrderStatusSession();
    loadStatus();`);
const helpers = `
<style>
  .strip { height:auto; min-height:96px; }
  .user { white-space:normal; overflow-wrap:anywhere; overflow:visible; text-overflow:clip; }
  .rank-user { white-space:normal; overflow-wrap:anywhere; text-overflow:clip; }
  .main-section { min-width:0; }
  .user-row { align-items:flex-start; }
  .status-dot { margin-top:5px; }
  .pc-label { flex-shrink:0; }
  .overlay-shell { justify-content:flex-end; }
  .drawer { bottom:var(--mockup-strip-height,96px); }
  .overlay-shell.drawer-below .drawer { top:var(--mockup-strip-height,96px); bottom:auto; }
  * { -webkit-app-region:no-drag !important; }
</style>
<script>
// Mockups never talk to real session, shop, or payout endpoints.
window.fetch = () => Promise.reject(new Error('Live API disabled in this design mockup.'));
window.electronAPI = {
  resizeSessionOverlayWidth: width => parent.postMessage({type:'mockup-width',width}, '*'),
  resizeSessionOverlayHeight: height => parent.postMessage({type:'mockup-height',height}, '*'),
  resizeSessionOverlay: expanded => parent.postMessage({type:'mockup-expanded',expanded}, '*')
};
window.addEventListener('DOMContentLoaded', () => {
  new ResizeObserver(() => {
    const strip=document.getElementById('strip');
    document.documentElement.style.setProperty('--mockup-strip-height',strip.offsetHeight+'px');
    parent.postMessage({type:'mockup-strip-height',height:strip.getBoundingClientRect().height}, '*');
  }).observe(document.getElementById('strip'));
});
</script>`;
extracted = extracted.replace('</head>', `${helpers}</head>`);
fs.mkdirSync(path.join(root, 'mockups/halloween'), { recursive:true });
fs.writeFileSync(path.join(root, 'mockups/halloween/_extracted-session.html'), extracted);
if (process.argv.includes('--extract-only')) process.exit(0);
fs.mkdirSync(output, { recursive:true });
const themes = [
  { id:'ember', name:'Pumpkin Ember', label:'01 / LANTERN LIGHT', subtitle:'Warm amber glass, carved-pumpkin glow, dark bronze edges.', asset:'pumpkin', source:'https://www.vecteezy.com/png/27156608-3d-realistic-halloween-angry-pumpkin-isolated-on-transparent-background-halloween-black-pumpkin' },
  { id:'spectral', name:'Spectral Glass', label:'02 / GHOST LIGHT', subtitle:'A softly lit 3D ghost floats end to end behind the session details.', asset:'ghost', source:'https://www.vecteezy.com/png/87307734-cute-3d-halloween-ghost-character-isolated-on-transparent-background' },
  { id:'moon', name:'Haunted Moon', label:'03 / MIDNIGHT SCENE', subtitle:'Moonlit depth, violet shadows, and a miniature haunted scene.', asset:'haunted', source:'https://www.vecteezy.com/png/30722780-3d-rendering-halloween-tree-pumpkin-skull-bats-and-ghost' }
];
const documents = themes.map(theme => {
  const css = fs.readFileSync(path.join(root, `mockups/halloween/${theme.id}.css`), 'utf8');
  return extracted.replace('</head>', `<style>:root{--halloween-art:url("${uri(path.join(root, `attached_assets/halloween/${theme.asset}.png`))}")}${css}</style></head>`);
});
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const cardHtmls = themes.map((t, i) => `
<article class="concept ${t.id}" id="${t.id}">
  <div class="card-head"><span>${t.label}</span><b>THEME ONLY</b></div>
  <h2>${t.name}</h2><p>${t.subtitle}</p>
  <div class="stage"><div class="desktop-lines"></div><span class="stage-label">LIVE SESSION PREVIEW</span>
    <iframe title="${t.name} interactive session" srcdoc="${escape(documents[i])}" sandbox="allow-scripts allow-same-origin"></iframe>
  </div>
  <footer>Try Order, Ranking, Attendance, Betting Games, or Logout.<br><a href="${t.source}" target="_blank" rel="noopener noreferrer">3D artwork source: Vecteezy</a></footer>
</article>`);
const cards = cardHtmls.join('');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Denfi · Halloween session concepts</title>
<style>
*{box-sizing:border-box}body{margin:0;color:#f3ede5;background:#101012;font-family:Arial,sans-serif}main{max-width:1740px;margin:auto;padding:38px 28px}
.eyebrow{font-size:11px;letter-spacing:3px;color:#ffab65}h1{font-size:clamp(28px,4vw,46px);letter-spacing:-1.5px;margin:15px 0}header p{color:#a7a5ac;max-width:740px;line-height:1.7;font-size:14px}
.controls{display:flex;gap:20px;align-items:end;flex-wrap:wrap;background:#1a191d;padding:18px 20px;margin:26px 0;border:1px solid #333039;border-radius:12px}
label{display:flex;flex-direction:column;gap:8px;font-size:11px;color:#c9c2b9;letter-spacing:.5px}input,select,button{background:#101014;border:1px solid #514449;border-radius:5px;color:#fff;padding:10px 12px;font-size:13px}input{width:min(460px,calc(100vw - 100px))}button{cursor:pointer;color:#ffbe89}button:hover{border-color:#f7ab6f}.hint{font-size:11px;color:#96909b;margin:0 0 4px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;align-items:start}
.concept{min-width:0;border:1px solid #383239;border-radius:15px;background:#19171c;overflow:hidden}.card-head{display:flex;justify-content:space-between;padding:22px 22px 0;font-size:9px;letter-spacing:1.8px;color:#ffb374}.card-head b{font-size:8px;font-weight:400;color:#827c89;letter-spacing:1px}h2{font-size:25px;margin:13px 22px 9px;letter-spacing:-.6px}.concept>p{font-size:12px;line-height:1.6;color:#a6a1ac;min-height:40px;margin:0 22px 20px}.stage{position:relative;margin:0 12px;background:radial-gradient(ellipse at 50% 60%,#352c26 0,transparent 68%),linear-gradient(130deg,#242329,#14151c);border:1px solid #39353e;border-radius:9px;min-height:220px;padding:0 0 10px;display:flex;align-items:flex-end;justify-content:center;overflow:hidden}
.spectral .stage{background:radial-gradient(ellipse at 50% 60%,#243d42,transparent 70%),#14191f}.moon .stage{background:radial-gradient(ellipse at 70% 10%,#4a3a62,transparent 70%),#151522}.stage-label{position:absolute;top:18px;left:15px;font-size:8px;color:#7f7889;letter-spacing:1.8px}.desktop-lines{position:absolute;inset:0;background:linear-gradient(135deg,transparent 47%,#ffffff03 47.2%,transparent 47.5%);pointer-events:none}iframe{position:relative;display:block;border:0;width:100%;max-width:100%;height:148px;background:transparent;z-index:1}footer{padding:17px 22px 22px;font-size:10px;color:#99909f;line-height:1.8}a{color:#b6a295;text-underline-offset:3px}.notice{font-size:11px;color:#8d8790;margin-top:24px;line-height:1.8}
@media(max-width:1100px){.grid{grid-template-columns:1fr}.concept{max-width:900px}.stage{min-height:210px}.concept>p{min-height:0}iframe{max-width:720px}.grid{gap:28px}}@media(max-width:480px){main{padding:24px 10px}.controls{padding:15px;gap:12px}input{width:calc(100vw - 54px)}.stage{margin:0 5px}.card-head{padding:18px 16px 0}h2{margin-left:16px}}
</style></head><body><main><header><div class="eyebrow">DENFI / SEASONAL EXPLORATION</div><h1>Halloween, without changing how it works.</h1><p>Three themes built from your actual session view. Transparent 3D artwork adds depth behind the controls. Names stay fully visible. The logo still alternates every five seconds, with its restrained tilt and light sweep.</p></header>
<section class="controls"><label>MEMBER USERNAME<input id="member-name" maxlength="84" value="mem-this-is-a-long-member-username"></label><button id="long-name">Test longest name</button><label>PREVIEW WIDTH<select id="preview-width"><option value="auto">Fit available space</option><option value="340">Compact · 340px</option><option value="500">Standard · 500px</option><option value="720">Wide · 720px</option></select></label><p class="hint">All actions use demo data. No live account is affected.</p></section>
<section class="grid">${cards}</section><p class="notice">Mockups only — your live session view and Windows executable have not been changed. Narrow previews wrap the username rather than truncate it. Transparent artwork is sourced from the web for evaluation; check its license before production use.</p></main>
<script>
const frames=[...document.querySelectorAll('iframe')],input=document.getElementById('member-name');
function updateName(){if(!/^mem-[a-z0-9._-]{1,80}$/i.test(input.value)){input.setCustomValidity('Use mem- followed by 1–80 letters, numbers, dots, underscores or hyphens.');return;}input.setCustomValidity('');frames.forEach(f=>f.contentWindow.postMessage({type:'mockup-username',value:input.value},'*'));}
input.addEventListener('input',updateName);
document.getElementById('long-name').onclick=()=>{input.value='mem-'+ 'long-member-name-'.repeat(5).slice(0,80);updateName();};
document.getElementById('preview-width').onchange=e=>{frames.forEach(f=>{f.style.width=e.target.value==='auto'?'100%':e.target.value+'px';});};
frames.forEach(f=>f.addEventListener('load',updateName));
window.addEventListener('message',e=>{
  const f=frames.find(f=>f.contentWindow===e.source);if(!f)return;
  const d=e.data||{};
  const restingHeight=()=>Math.max(148,Number(f.dataset.stripHeight||0)+14);
  if(d.type==='mockup-strip-height'){
    f.dataset.stripHeight=String(d.height);
    if(f.dataset.drawerOpen!=='1')f.style.height=restingHeight()+'px';
  }
  if(d.type==='mockup-height'&&Number.isFinite(d.height)){
    f.dataset.drawerOpen='1';
    f.style.height=Math.min(900,Math.max(restingHeight(),d.height+14))+'px';
  }else if(d.type==='mockup-expanded'){
    f.dataset.drawerOpen=d.expanded?'1':'0';
    f.style.height=(d.expanded?Math.max(520,restingHeight()):restingHeight())+'px';
  }
});
</script></body></html>`;
fs.writeFileSync(path.join(output, 'index.html'), html);
const animatedGhost = html
  .replace('<title>Denfi · Halloween session concepts</title>', '<title>Denfi · Animated Spectral Glass mockup</title>')
  .replace('<h1>Halloween, without changing how it works.</h1>', '<h1>Spectral Glass, now floating.</h1>')
  .replace('Three themes built from your actual session view. Transparent 3D artwork adds depth behind the controls. Names stay fully visible. The logo still alternates every five seconds, with its restrained tilt and light sweep.',
    'The transparent 3D ghost drifts slowly from one end of the session details to the other, then floats back. Its gentle up-and-down movement stays behind the information, clear of all buttons. Controls, full usernames, and the original logo transition are unchanged.')
  .replace(`<section class="grid">${cards}</section>`, `<section class="grid single">${cardHtmls[1]}</section>`)
  .replace('</style></head>', '.grid.single{display:block}.grid.single .concept{max-width:900px;margin:auto}.grid.single iframe{max-width:100%}</style></head>');
fs.writeFileSync(path.join(output, 'spectral-animated.html'), animatedGhost);
themes.forEach((t,i) => fs.writeFileSync(path.join(output, `${t.id}.html`), documents[i]));
console.log(`Built 3 self-contained themes and comparison (${Math.round(Buffer.byteLength(html)/1024)} KiB).`);
