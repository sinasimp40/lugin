import React, { useMemo, useState } from 'react';
import { ArrowUpRight, Clock3, Coffee, Crown, LogOut, Plus, ShoppingBag, Swords, Zap } from 'lucide-react';

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Space+Mono:wght@400;700&display=swap');
  .cl-root { min-height:100%; width:100%; background:#0b0c0e; color:#f7eee0; font-family:'Space Mono',monospace; overflow:hidden; position:relative; }
  .cl-root * { box-sizing:border-box; }
  .cl-root:before { content:""; position:absolute; inset:0; pointer-events:none; opacity:.25; background:repeating-linear-gradient(0deg, transparent 0, transparent 3px, rgba(255,167,65,.025) 3px, rgba(255,167,65,.025) 4px); }
  .cl-root:after { content:""; position:absolute; inset:0; pointer-events:none; background:radial-gradient(circle at 12% 18%, rgba(255,126,22,.12), transparent 28%), radial-gradient(circle at 88% 85%, rgba(255,202,64,.07), transparent 24%); }
  .cl-shell { position:relative; z-index:1; width:min(1180px, calc(100% - 40px)); min-height:680px; margin:auto; padding:28px 0 24px; display:flex; flex-direction:column; gap:20px; }
  .cl-topbar { height:58px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid #3c2a1b; }
  .cl-brand { display:flex; align-items:center; gap:12px; }
  .cl-mark { width:34px; height:34px; display:grid; place-items:center; background:#ff8b24; color:#111; font-family:'Barlow Condensed',sans-serif; font-weight:800; font-size:21px; transform:skew(-10deg); box-shadow:5px 5px 0 #5d3216; }
  .cl-brand-copy { line-height:1; }
  .cl-brand-name { font:800 24px 'Barlow Condensed',sans-serif; letter-spacing:2px; color:#ffb13d; }
  .cl-brand-sub { color:#8d7864; font-size:9px; letter-spacing:2px; margin-top:5px; }
  .cl-session { display:flex; align-items:center; gap:18px; }
  .cl-time { color:#ff9d28; font-size:13px; letter-spacing:1px; }
  .cl-time small { display:block; color:#8d7864; font-size:8px; letter-spacing:2px; margin-bottom:4px; }
  .cl-user { padding-left:18px; border-left:1px solid #3c2a1b; display:flex; align-items:center; gap:10px; }
  .cl-avatar { width:28px; height:28px; border:1px solid #ff8b24; color:#ffb13d; display:grid; place-items:center; font-size:11px; }
  .cl-user strong { display:block; color:#f7eee0; font-size:11px; }
  .cl-user span { display:block; color:#76c66e; font-size:8px; margin-top:3px; }
  .cl-logout { border:1px solid #5a3b21; background:transparent; color:#a88e73; height:30px; padding:0 11px; font:700 9px 'Space Mono'; cursor:pointer; display:flex; gap:7px; align-items:center; }
  .cl-logout:hover { border-color:#ff8b24; color:#ffb13d; }
  .cl-grid { display:grid; grid-template-columns: 1.35fr .85fr; gap:20px; flex:1; min-height:0; }
  .cl-panel { background:#121417; border:1px solid #382719; position:relative; overflow:hidden; }
  .cl-panel:before { content:""; position:absolute; left:0; top:0; width:3px; height:78px; background:#ff8b24; }
  .cl-panel-head { height:74px; display:flex; justify-content:space-between; align-items:center; padding:0 24px; border-bottom:1px solid #2d2118; }
  .cl-kicker { color:#9b8064; letter-spacing:2px; font-size:9px; }
  .cl-title { font:700 30px 'Barlow Condensed',sans-serif; letter-spacing:1px; line-height:1; margin-top:5px; text-transform:uppercase; }
  .cl-live { color:#76c66e; font-size:9px; display:flex; align-items:center; gap:7px; }
  .cl-live i { width:6px; height:6px; border-radius:50%; background:#76c66e; box-shadow:0 0 8px #76c66e; }
  .cl-rankings { padding:7px 14px 15px; }
  .cl-row { display:grid; grid-template-columns:40px 1fr auto 60px; align-items:center; min-height:69px; padding:0 12px; border-bottom:1px solid #282019; position:relative; }
  .cl-row:last-child { border:0; }
  .cl-row.current { background:linear-gradient(90deg, rgba(255,139,36,.16), transparent); border-left:2px solid #ff8b24; }
  .cl-rank { font:800 21px 'Barlow Condensed'; color:#79634f; }
  .cl-row:nth-child(1) .cl-rank { color:#ffd465; }
  .cl-row:nth-child(2) .cl-rank { color:#cac6bf; }
  .cl-row:nth-child(3) .cl-rank { color:#b77c56; }
  .cl-player { display:flex; align-items:center; gap:11px; min-width:0; }
  .cl-mini-avatar { width:31px; height:31px; display:grid; place-items:center; font-size:10px; color:#f8e9d5; background:#25272b; border:1px solid #524333; }
  .cl-player strong { font-size:11px; color:#f5e7d8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .cl-player span { display:block; font-size:8px; color:#857260; margin-top:4px; }
  .cl-medal { color:#df9d43; }
  .cl-coins { color:#ffb13d; font-weight:700; font-size:11px; }
  .cl-coins small { display:block; color:#806b57; text-align:right; font-size:7px; letter-spacing:1px; margin-top:3px; }
  .cl-streak { font-size:8px; color:#76c66e; text-align:right; }
  .cl-me-card { margin:1px 24px 24px; padding:15px 17px; border:1px solid #68401f; background:#1a1713; display:flex; align-items:center; justify-content:space-between; }
  .cl-me-label { font-size:8px; letter-spacing:2px; color:#9b8064; }
  .cl-me-rank { font:700 25px 'Barlow Condensed'; color:#ffb13d; margin-top:4px; }
  .cl-me-copy { font-size:9px; color:#c9aa8b; text-align:right; line-height:1.6; }
  .cl-me-copy b { color:#f5e7d8; }
  .cl-store { display:flex; flex-direction:column; }
  .cl-store .cl-panel-head { height:74px; }
  .cl-products { padding:13px; display:grid; gap:9px; }
  .cl-product { min-height:73px; display:grid; grid-template-columns:38px 1fr auto; gap:11px; align-items:center; padding:10px; border:1px solid #30251c; background:#17191c; transition:transform .18s, border-color .18s; }
  .cl-product:hover { transform:translateX(-3px); border-color:#9c5c25; }
  .cl-product-icon { width:36px; height:36px; display:grid; place-items:center; background:#2a211a; color:#ff9d28; }
  .cl-product strong { display:block; font:700 16px 'Barlow Condensed'; letter-spacing:.5px; }
  .cl-product span { display:block; color:#806e5c; font-size:8px; margin-top:4px; }
  .cl-price { color:#ffb13d; font-size:11px; font-weight:700; text-align:right; }
  .cl-add { border:0; color:#111; background:#ff9d28; width:26px; height:24px; display:grid; place-items:center; cursor:pointer; margin-top:7px; margin-left:auto; }
  .cl-add:hover { background:#ffd064; }
  .cl-cart { margin:4px 13px 13px; margin-top:auto; padding:15px; background:#201811; border:1px solid #64401f; }
  .cl-cart-head { display:flex; justify-content:space-between; font-size:9px; letter-spacing:1.5px; color:#d8b38d; }
  .cl-cart-items { margin:11px 0; color:#f5e7d8; font-size:10px; line-height:1.8; max-height:46px; overflow:auto; }
  .cl-cart-total { border-top:1px solid #5a3b21; padding-top:11px; display:flex; justify-content:space-between; color:#ffb13d; font-size:12px; font-weight:700; }
  .cl-order { width:100%; height:37px; margin-top:12px; border:0; background:#ff8b24; color:#15110d; font:800 11px 'Space Mono'; letter-spacing:1px; cursor:pointer; display:flex; justify-content:center; align-items:center; gap:8px; }
  .cl-order:hover { background:#ffd064; }
  .cl-order:disabled { opacity:.5; cursor:not-allowed; }
  .cl-toast { position:absolute; bottom:24px; left:50%; transform:translateX(-50%); background:#f3c057; color:#1a130d; font-size:10px; padding:10px 16px; z-index:4; box-shadow:0 5px 20px rgba(0,0,0,.35); }
  @media(max-width:760px) { .cl-shell { width:calc(100% - 24px); padding-top:14px; } .cl-topbar { height:auto; padding-bottom:14px; align-items:flex-start; gap:12px; } .cl-session { gap:8px; flex-wrap:wrap; justify-content:flex-end; } .cl-time { display:none; } .cl-user { padding-left:0; border:0; } .cl-grid { grid-template-columns:1fr; } .cl-panel-head { padding:0 17px; } .cl-store { min-height:520px; } }
`;

type Product = { id: number; name: string; detail: string; price: number; icon: 'coffee' | 'zap' | 'bag' };
const products: Product[] = [
  { id: 1, name: 'Kopiko 78°', detail: 'candy • quick boost', price: 12, icon: 'coffee' },
  { id: 2, name: 'Pocari Sweat', detail: '350ml • cold', price: 35, icon: 'zap' },
  { id: 3, name: 'Piattos Cheese', detail: '85g • crunch', price: 28, icon: 'bag' },
  { id: 4, name: 'Lucky Me! Cup', detail: 'chicken • hot water', price: 32, icon: 'coffee' },
];
const players = [
  ['01', 'zai.exe', '8,420', 'WIN STREAK 04', 'ZX'],
  ['02', 'migs_gg', '7,965', 'WIN STREAK 02', 'MG'],
  ['03', 'kurtcobain', '7,230', 'WIN STREAK 01', 'KC'],
  ['04', 'mem-raprap', '6,840', 'YOU • +120 TODAY', 'MR'],
  ['05', 'nicsensei', '6,405', 'WIN STREAK 03', 'NS'],
];

export function CompetitiveLounge() {
  const [cart, setCart] = useState<number[]>([]);
  const [notice, setNotice] = useState('');
  const cartProducts = useMemo(() => cart.map((id) => products.find((p) => p.id === id)).filter(Boolean) as Product[], [cart]);
  const total = cartProducts.reduce((sum, item) => sum + item.price, 0);
  const add = (id: number) => setCart((items) => [...items, id]);
  const order = () => {
    if (!cart.length) return;
    setNotice('ORDER SENT TO COUNTER');
    setCart([]);
    window.setTimeout(() => setNotice(''), 2500);
  };
  const iconFor = (icon: Product['icon']) => icon === 'coffee' ? <Coffee size={16} /> : icon === 'zap' ? <Zap size={16} /> : <ShoppingBag size={16} />;
  return (
    <div className="cl-root">
      <style>{styles}</style>
      <main className="cl-shell">
        <header className="cl-topbar">
          <div className="cl-brand"><div className="cl-mark">D</div><div className="cl-brand-copy"><div className="cl-brand-name">DENFI / LOUNGE</div><div className="cl-brand-sub">PLAY HARD • STAY LOCAL</div></div></div>
          <div className="cl-session">
            <div className="cl-time"><small>SESSION REMAINING</small>29d 23:59:59</div>
            <div className="cl-user"><div className="cl-avatar">MR</div><div><strong>mem-raprap</strong><span>● ONLINE / 12.50 PTS</span></div></div>
            <button className="cl-logout"><LogOut size={12} /> LOGOUT</button>
          </div>
        </header>
        <section className="cl-grid">
          <section className="cl-panel">
            <div className="cl-panel-head"><div><div className="cl-kicker">DENFI COIN LOG / LIVE BOARD</div><div className="cl-title">The regulars</div></div><div className="cl-live"><i /> UPDATING LIVE</div></div>
            <div className="cl-rankings">
              {players.map(([rank, name, points, streak, initials], index) => <div className={`cl-row ${index === 3 ? 'current' : ''}`} key={name}>
                <div className="cl-rank">{rank}</div><div className="cl-player"><div className="cl-mini-avatar">{index === 0 ? <Crown size={14} className="cl-medal" /> : initials}</div><div><strong>{name}</strong><span>{index < 3 ? 'ACTIVE THIS WEEK' : 'PLAYING RIGHT NOW'}</span></div></div>
                <div className="cl-coins">{points}<small>COINS</small></div><div className="cl-streak">{index === 3 ? <Swords size={13} /> : streak}</div>
              </div>)}
            </div>
            <div className="cl-me-card"><div><div className="cl-me-label">YOUR POSITION</div><div className="cl-me-rank">#04 <ArrowUpRight size={17} /></div></div><div className="cl-me-copy">You need <b>391 coins</b><br />to overtake <b>kurtcobain</b></div></div>
          </section>
          <section className="cl-panel cl-store">
            <div className="cl-panel-head"><div><div className="cl-kicker">COUNTER / QUICK ORDER</div><div className="cl-title">Fuel up</div></div><div className="cl-live" style={{ color: '#ffb13d' }}><Clock3 size={13} /> 5–8 MIN</div></div>
            <div className="cl-products">{products.map((product) => <div className="cl-product" key={product.id}><div className="cl-product-icon">{iconFor(product.icon)}</div><div><strong>{product.name}</strong><span>{product.detail}</span></div><div className="cl-price">₱{product.price}<button className="cl-add" onClick={() => add(product.id)} aria-label={`Add ${product.name}`}><Plus size={14} /></button></div></div>)}</div>
            <div className="cl-cart"><div className="cl-cart-head"><span>CURRENT ORDER</span><span>{cartProducts.length} ITEMS</span></div><div className="cl-cart-items">{cartProducts.length ? cartProducts.map((item, index) => <div key={`${item.id}-${index}`}>{item.name} <span style={{ color: '#ffb13d' }}>₱{item.price}</span></div>) : <span style={{ color: '#806e5c' }}>Pick a snack for your session.</span>}</div><div className="cl-cart-total"><span>TOTAL</span><span>₱{total}</span></div><button className="cl-order" disabled={!cart.length} onClick={order}>PLACE ORDER <ArrowUpRight size={14} /></button></div>
          </section>
        </section>
      </main>
      {notice && <div className="cl-toast">{notice}</div>}
    </div>
  );
}

export default CompetitiveLounge;