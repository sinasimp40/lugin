import React, { useMemo, useState } from 'react';
import { ArrowRight, Check, ChevronDown, Clock3, Coffee, CupSoda, LogOut, Minus, Plus, ShoppingBag, Sparkles, Trophy, Utensils } from 'lucide-react';

type Product = {
  id: string;
  name: string;
  detail: string;
  price: number;
  category: 'cold' | 'snack' | 'hot';
  icon: React.ReactNode;
  tone: string;
};

const products: Product[] = [
  { id: 'coke', name: 'Coke Zero', detail: '330 ml · cold', price: 45, category: 'cold', icon: <CupSoda size={23} strokeWidth={1.8} />, tone: 'coral' },
  { id: 'water', name: 'Mineral Water', detail: '500 ml · chilled', price: 25, category: 'cold', icon: <span className="bottle-mark" />, tone: 'aqua' },
  { id: 'chips', name: 'Chili Cheese Chips', detail: '60 g · crunchy', price: 55, category: 'snack', icon: <span className="chips-mark">▰</span>, tone: 'gold' },
  { id: 'noodles', name: 'Beef Noodles', detail: 'instant · hot serve', price: 85, category: 'hot', icon: <Utensils size={23} strokeWidth={1.8} />, tone: 'orange' },
];

const members = [
  { rank: 1, name: 'pixel_king', coins: 4380 },
  { rank: 2, name: 'jhay.exe', coins: 3615 },
  { rank: 3, name: 'mem-raprap', coins: 2840, current: true },
  { rank: 4, name: 'no_scope_nina', coins: 2195 },
  { rank: 5, name: 'ctrl_alt_jm', coins: 1870 },
];

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap');
  .sf-shell, .sf-shell * { box-sizing: border-box; }
  .sf-shell {
    --ink: #13100e; --paper: #f6ead6; --paper-deep: #ead6b8; --orange: #ed651d;
    --orange-dark: #ad3f16; --yellow: #ffc247; --muted: #7d6655; --line: rgba(54,34,22,.16);
    width: 100%; height: 100%; min-height: 560px; padding: 16px;
    color: var(--ink); background: #241b17; font-family: 'Space Mono', monospace;
    overflow: auto; position: relative;
  }
  .sf-shell:before { content:''; position:absolute; inset:0; pointer-events:none; opacity:.16;
    background-image: radial-gradient(rgba(255,213,144,.42) .55px, transparent .55px); background-size: 5px 5px; }
  .sf-frame { max-width: 1248px; min-height: 100%; margin:auto; position:relative; z-index:1; background:var(--paper);
    border: 1px solid #5e3822; box-shadow: 8px 8px 0 rgba(0,0,0,.22); display:flex; flex-direction:column; }
  .sf-topbar { height: 72px; flex-shrink:0; display:flex; align-items:center; gap:24px; padding:0 25px;
    color:#fce8c9; background:var(--ink); border-bottom:4px solid var(--orange); }
  .sf-logo { font-family:'Barlow Condensed', sans-serif; font-size:31px; letter-spacing:2px; font-weight:900; line-height:.8; color:var(--yellow); }
  .sf-logo small { display:block; color:#a89584; font: 8px 'Space Mono'; letter-spacing:2px; margin-top:8px; }
  .sf-navline { width:1px; height:30px; background:#554239; }
  .sf-context { font-size:10px; letter-spacing:1px; color:#bdab99; text-transform:uppercase; }
  .sf-session { margin-left:auto; display:flex; align-items:center; gap:18px; font-size:10px; }
  .sf-session-block { display:flex; align-items:center; gap:8px; }
  .sf-session-label { color:#8d7a6a; font-size:8px; letter-spacing:1.2px; }
  .sf-time { color:var(--yellow); font:700 19px 'Space Mono'; letter-spacing:-1px; }
  .sf-user { color:#fff2db; font-weight:700; }
  .sf-dot { width:7px; height:7px; background:#55d976; border-radius:50%; box-shadow:0 0 0 3px rgba(85,217,118,.15); }
  .sf-points { color:var(--yellow); font-weight:700; }
  .sf-logout { border:1px solid #765343; background:transparent; color:#dfc4a8; padding:9px 11px; display:flex; gap:7px; align-items:center;
    cursor:pointer; font:700 9px 'Space Mono'; letter-spacing:.8px; transition:background .18s, color .18s; }
  .sf-logout:hover { background:var(--orange); color:white; }
  .sf-main { display:grid; grid-template-columns:minmax(0, 1fr) 294px; gap:18px; padding:22px 24px 24px; flex:1; }
  .sf-store { min-width:0; }
  .sf-kicker { font-size:9px; font-weight:700; letter-spacing:2px; color:var(--orange-dark); text-transform:uppercase; }
  .sf-heading { display:flex; align-items:end; justify-content:space-between; margin:5px 0 17px; gap:12px; }
  .sf-heading h1 { margin:0; font:900 clamp(34px,4.2vw,53px)/.9 'Barlow Condensed',sans-serif; letter-spacing:-1px; text-transform:uppercase; }
  .sf-heading p { margin:0 0 2px; color:var(--muted); font-size:10px; line-height:1.6; max-width:210px; text-align:right; }
  .sf-tabs { display:flex; gap:7px; margin-bottom:13px; }
  .sf-tab { border:1px solid var(--line); color:var(--muted); background:transparent; padding:7px 11px; cursor:pointer; font:700 9px 'Space Mono'; }
  .sf-tab.active, .sf-tab:hover { color:#fff7e9; border-color:var(--orange); background:var(--orange); }
  .sf-products { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:11px; }
  .sf-product { position:relative; min-height:221px; padding:12px; display:flex; flex-direction:column; background:#f9f0df; border:1px solid var(--line);
    transition:transform .18s, border-color .18s; }
  .sf-product:hover { transform:translateY(-3px); border-color:var(--orange); }
  .sf-product-art { height:100px; display:grid; place-items:center; margin-bottom:10px; position:relative; overflow:hidden; }
  .sf-product-art:after { content:''; position:absolute; width:90px;height:90px;border-radius:50%; opacity:.5; }
  .sf-product-art.coral { background:#f4c1a5; color:#9d3518; } .sf-product-art.coral:after { background:#ed651d; }
  .sf-product-art.aqua { background:#bbd8d1; color:#24675f; } .sf-product-art.aqua:after { background:#77bcb4; }
  .sf-product-art.gold { background:#f5d98a; color:#8d5b15; } .sf-product-art.gold:after { background:#e9a52c; }
  .sf-product-art.orange { background:#f1b06a; color:#8f3013; } .sf-product-art.orange:after { background:#dc5b19; }
  .sf-product-art svg, .bottle-mark, .chips-mark { position:relative; z-index:1; }
  .bottle-mark { width:28px; height:52px; border:3px solid #24675f; border-radius:7px 7px 9px 9px; background:#d4f0e8; }
  .bottle-mark:before { content:''; display:block; width:12px; height:7px; border:2px solid #24675f; border-bottom:0; margin:-9px auto 0; border-radius:3px 3px 0 0; }
  .chips-mark { font:900 31px 'Barlow Condensed'; transform:rotate(-12deg); }
  .sf-product-name { font:700 14px 'Barlow Condensed'; letter-spacing:.3px; text-transform:uppercase; }
  .sf-product-detail { color:var(--muted); font-size:8px; margin-top:3px; }
  .sf-product-foot { margin-top:auto; padding-top:10px; display:flex; justify-content:space-between; align-items:center; }
  .sf-price { color:var(--orange-dark); font:700 13px 'Space Mono'; }
  .sf-add { width:28px;height:28px; display:grid;place-items:center; border:0; color:#fff7e7; background:var(--ink); cursor:pointer; transition:background .18s, transform .18s; }
  .sf-add:hover { background:var(--orange); transform:rotate(90deg); } .sf-add:active { transform:scale(.9); }
  .sf-side { display:flex; flex-direction:column; gap:13px; min-width:0; }
  .sf-cart, .sf-rank { border:1px solid var(--line); background:#f9f0df; }
  .sf-card-head { padding:13px 14px 11px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); }
  .sf-card-title { font:800 18px 'Barlow Condensed'; text-transform:uppercase; letter-spacing:.5px; }
  .sf-count { background:var(--orange); color:#fff; padding:4px 6px; font:700 9px 'Space Mono'; }
  .sf-cart-body { padding:12px 14px; min-height:93px; }
  .sf-cart-empty { color:var(--muted); font-size:9px; line-height:1.7; padding:7px 0; }
  .sf-cart-item { display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:10px; font-size:10px; }
  .sf-cart-item strong { font-family:'Barlow Condensed'; font-size:15px; letter-spacing:.2px; }
  .sf-cart-item small { display:block; color:var(--muted); font-size:8px; margin-top:2px; }
  .sf-qty { display:flex; align-items:center; gap:7px; color:var(--orange-dark); }
  .sf-qty button { border:0; background:var(--paper-deep); width:18px;height:18px; display:grid;place-items:center; cursor:pointer; color:var(--ink); }
  .sf-cart-total { display:flex; justify-content:space-between; border-top:1px dashed #bfaa90; padding:11px 14px 0; font-size:10px; }
  .sf-cart-total strong { color:var(--orange-dark); font-size:15px; }
  .sf-order { margin:12px 14px 14px; width:calc(100% - 28px); border:0; background:var(--orange); color:#fff8e9; padding:12px; font:700 10px 'Space Mono'; letter-spacing:.6px; cursor:pointer; display:flex; justify-content:center; gap:8px; align-items:center; }
  .sf-order:hover { background:var(--orange-dark); }
  .sf-rank .sf-card-head { background:var(--ink); color:#ffe4b8; border-bottom:0; }
  .sf-rank .sf-card-title { display:flex; align-items:center; gap:8px; }
  .sf-rank-list { list-style:none; margin:0; padding:6px 13px 10px; }
  .sf-rank-row { display:grid; grid-template-columns:20px 1fr auto; gap:7px; align-items:center; min-height:31px; border-bottom:1px solid rgba(54,34,22,.1); font-size:9px; }
  .sf-rank-row:last-child { border-bottom:0; } .sf-rank-num { color:var(--orange-dark); font-weight:700; }
  .sf-rank-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } .sf-rank-coins { color:var(--muted); font-size:8px; }
  .sf-rank-row.current { color:var(--orange-dark); font-weight:700; background:#f3dfc2; margin:0 -5px; padding:0 5px; }
  .sf-rank-foot { color:var(--muted); padding:0 14px 12px; font-size:8px; display:flex; align-items:center; gap:6px; }
  .sf-toast { position:fixed; left:50%; bottom:20px; transform:translateX(-50%); background:var(--ink); color:#fff1d5; border:1px solid var(--orange); padding:11px 15px; z-index:10; font-size:10px; box-shadow:4px 4px 0 var(--orange-dark); }
  .sf-toast strong { color:var(--yellow); }
  @media (max-width: 850px) {
    .sf-topbar { height:auto; min-height:72px; flex-wrap:wrap; padding:14px 17px; gap:12px; }
    .sf-navline, .sf-context { display:none; } .sf-session { width:100%; margin-left:0; justify-content:space-between; }
    .sf-main { grid-template-columns:1fr; padding:18px; } .sf-side { display:grid; grid-template-columns:1fr 1fr; align-items:start; }
    .sf-products { grid-template-columns:repeat(2,minmax(0,1fr)); } .sf-heading p { display:none; }
  }
  @media (max-width: 520px) { .sf-shell { padding:0; } .sf-frame { box-shadow:none; } .sf-main { padding:16px 13px; }
    .sf-session-block:nth-child(2) { display:none; } .sf-side { display:flex; } .sf-product { min-height:195px; }
  }
`;

export function StoreFirst() {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<'all' | Product['category']>('all');
  const [notice, setNotice] = useState('');
  const [loggedOut, setLoggedOut] = useState(false);
  const visibleProducts = filter === 'all' ? products : products.filter((product) => product.category === filter);
  const cartItems = useMemo(() => products.filter((product) => cart[product.id]), [cart]);
  const cartCount = Object.values(cart).reduce((sum, count) => sum + count, 0);
  const total = cartItems.reduce((sum, product) => sum + product.price * (cart[product.id] || 0), 0);

  const changeQty = (id: string, delta: number) => {
    setCart((current) => {
      const next = Math.max(0, (current[id] || 0) + delta);
      const copy = { ...current };
      if (next) copy[id] = next; else delete copy[id];
      return copy;
    });
  };
  const addProduct = (product: Product) => {
    changeQty(product.id, 1);
    setNotice(`${product.name} added to cart`);
    window.setTimeout(() => setNotice(''), 1700);
  };
  const placeOrder = () => {
    if (!cartCount) { setNotice('Pick a snack or drink first'); window.setTimeout(() => setNotice(''), 1700); return; }
    setNotice(`Order queued at PC-17 · ₱${total}`);
    setCart({});
    window.setTimeout(() => setNotice(''), 2400);
  };

  if (loggedOut) return <div className="sf-shell"><style>{styles}</style><div className="sf-frame" style={{ display:'grid', placeItems:'center', minHeight:'100%' }}><div style={{ textAlign:'center', padding:30 }}><div className="sf-kicker">SESSION CLOSED</div><div className="sf-heading" style={{ justifyContent:'center' }}><h1>See you next match.</h1></div><button className="sf-order" style={{ maxWidth:220, margin:'15px auto' }} onClick={() => setLoggedOut(false)}>RETURN TO SESSION</button></div></div></div>;

  return (
    <div className="sf-shell">
      <style>{styles}</style>
      <div className="sf-frame">
        <header className="sf-topbar">
          <div className="sf-logo">DENFI<small>PC SHOP / STATION 17</small></div>
          <div className="sf-navline" />
          <div className="sf-context">QUICK STORE <span style={{ color:'#ed651d' }}>//</span> BETWEEN MATCHES</div>
          <div className="sf-session">
            <div className="sf-session-block"><Clock3 size={14} color="#ed651d" /><span className="sf-session-label">TIME LEFT</span><span className="sf-time">29:42:18</span></div>
            <div className="sf-session-block"><span className="sf-dot" /><span className="sf-user">mem-raprap</span></div>
            <div className="sf-session-block"><span className="sf-session-label">POINTS</span><span className="sf-points">2,840</span></div>
            <button className="sf-logout" onClick={() => setLoggedOut(true)}><LogOut size={12} /> LOG OUT</button>
          </div>
        </header>
        <main className="sf-main">
          <section className="sf-store">
            <div className="sf-kicker">DENFI QUICK PICK / 04 ITEMS READY</div>
            <div className="sf-heading"><h1>Grab &amp; go.</h1><p>Order now. We’ll drop it at your station while you stay in the game.</p></div>
            <div className="sf-tabs">
              {(['all', 'cold', 'snack', 'hot'] as const).map((tab) => <button key={tab} className={`sf-tab ${filter === tab ? 'active' : ''}`} onClick={() => setFilter(tab)}>{tab === 'all' ? 'ALL ITEMS' : tab.toUpperCase()}</button>)}
            </div>
            <div className="sf-products">
              {visibleProducts.map((product) => <article className="sf-product" key={product.id}>
                <div className={`sf-product-art ${product.tone}`}>{product.icon}</div>
                <div className="sf-product-name">{product.name}</div><div className="sf-product-detail">{product.detail}</div>
                <div className="sf-product-foot"><div className="sf-price">₱{product.price}</div><button className="sf-add" aria-label={`Add ${product.name}`} onClick={() => addProduct(product)}><Plus size={17} /></button></div>
              </article>)}
            </div>
          </section>
          <aside className="sf-side">
            <section className="sf-cart">
              <div className="sf-card-head"><div className="sf-card-title"><ShoppingBag size={17} /> Your order</div><div className="sf-count">{cartCount} {cartCount === 1 ? 'ITEM' : 'ITEMS'}</div></div>
              <div className="sf-cart-body">{cartItems.length ? cartItems.map((product) => <div className="sf-cart-item" key={product.id}><div><strong>{product.name}</strong><small>₱{product.price} each</small></div><div className="sf-qty"><button onClick={() => changeQty(product.id, -1)}><Minus size={10} /></button><span>{cart[product.id]}</span><button onClick={() => changeQty(product.id, 1)}><Plus size={10} /></button></div></div>) : <div className="sf-cart-empty">Your cart is clear.<br />Add something for the next round.</div>}</div>
              <div className="sf-cart-total"><span>TOTAL</span><strong>₱{total}</strong></div>
              <button className="sf-order" onClick={placeOrder}>PLACE ORDER <ArrowRight size={14} /></button>
            </section>
            <section className="sf-rank">
              <div className="sf-card-head"><div className="sf-card-title"><Trophy size={16} color="#ffc247" /> Top players</div><ChevronDown size={15} color="#bdab99" /></div>
              <ol className="sf-rank-list">{members.map((member) => <li key={member.name} className={`sf-rank-row ${member.current ? 'current' : ''}`}><span className="sf-rank-num">0{member.rank}</span><span className="sf-rank-name">{member.name}</span><span className="sf-rank-coins">{member.coins.toLocaleString()}</span></li>)}</ol>
              <div className="sf-rank-foot"><Sparkles size={11} color="#ed651d" /> coins from completed sessions</div>
            </section>
          </aside>
        </main>
      </div>
      {notice && <div className="sf-toast"><Check size={13} style={{ verticalAlign:'-2px', marginRight:6 }} /><strong>{notice}</strong></div>}
    </div>
  );
}

export default StoreFirst;