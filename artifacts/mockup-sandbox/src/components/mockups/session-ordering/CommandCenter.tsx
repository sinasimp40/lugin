import React, { useMemo, useState } from 'react';
import { ChevronRight, Clock3, Coffee, Gamepad2, LogOut, Minus, Plus, ShoppingBag, Sparkles, Trophy, X, Zap } from 'lucide-react';

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Orbitron:wght@500;700;800;900&display=swap');
  .cc-root { width:100%; min-height:100%; box-sizing:border-box; background:#11100d; color:#f5e9cf; font-family:'DM Mono', monospace; overflow:auto; position:relative; }
  .cc-root:before { content:""; position:fixed; inset:0; pointer-events:none; opacity:.2; background:repeating-linear-gradient(0deg,transparent 0,transparent 3px,rgba(255,168,50,.025) 3px,rgba(255,168,50,.025) 4px); }
  .cc-shell { max-width:1320px; min-height:720px; margin:auto; padding:24px 28px; position:relative; z-index:1; display:flex; flex-direction:column; gap:20px; }
  .cc-top { display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #3d2a16; padding-bottom:18px; }
  .brand { display:flex; align-items:center; gap:12px; }
  .brand-mark { width:34px;height:34px;display:grid;place-items:center;color:#16120a;background:#f5a623;box-shadow:4px 4px 0 #8f4e12; }
  .brand-title { font-family:Orbitron,sans-serif; font-weight:900; letter-spacing:3px; font-size:16px; color:#ffb52e; }
  .brand-sub { color:#947b58; font-size:9px; letter-spacing:2px; margin-top:3px; }
  .top-actions { display:flex; align-items:center; gap:18px; }
  .live { color:#79d475; font-size:10px; letter-spacing:1.5px; display:flex; align-items:center; gap:7px; }
  .live i { width:7px;height:7px;border-radius:50%;background:#79d475;box-shadow:0 0 12px #79d475; }
  .logout { background:transparent;border:1px solid #69441f;color:#d9a052;padding:9px 13px;font:500 10px 'DM Mono';letter-spacing:1px;cursor:pointer;display:flex;gap:8px;align-items:center;transition:.18s; }
  .logout:hover { color:#1a1309;background:#e3a12d;border-color:#e3a12d; }
  .grid { display:grid; grid-template-columns:240px minmax(0,1fr) 290px; gap:16px; flex:1; }
  .panel { background:#181511; border:1px solid #3d2a16; position:relative; overflow:hidden; }
  .panel:after { content:"";position:absolute;top:0;right:0;width:55px;height:1px;background:#f5a623; }
  .eyebrow { color:#9c7a4d; font-size:9px; letter-spacing:2px; }
  .session-panel { padding:21px 18px; display:flex; flex-direction:column; justify-content:space-between; background:linear-gradient(145deg,#211a11,#161412 70%); }
  .session-head { display:flex;justify-content:space-between;align-items:center; }
  .session-head strong { color:#f2d8a0;font:700 11px Orbitron;letter-spacing:1px; }
  .session-tag { color:#71bd67;font-size:8px;border:1px solid #315733;padding:4px 6px; }
  .timer { margin-top:28px; }
  .timer-value { font:800 32px Orbitron;color:#ffb52e;letter-spacing:1px;text-shadow:0 0 18px rgba(245,166,35,.26); }
  .timer-label { margin-top:7px;color:#846b45;font-size:9px;letter-spacing:2px; }
  .session-line { height:1px;background:#49351e;margin:26px 0 18px; }
  .user-label { color:#856d4a;font-size:9px;letter-spacing:2px;margin-bottom:6px; }
  .user-name { font:700 14px Orbitron;color:#f1e0bb; }
  .balance { margin-top:auto;border-top:1px solid #3d2a16;padding-top:18px; }
  .balance-row { display:flex;justify-content:space-between;align-items:end; }
  .balance-number { font:800 26px Orbitron;color:#ffd36b; }
  .balance-unit { color:#aa7b2f;font-size:9px;letter-spacing:1px; }
  .progress {height:4px;background:#302517;margin-top:13px;position:relative;}
  .progress span {display:block;width:68%;height:100%;background:#e79e2b;box-shadow:0 0 10px rgba(231,158,43,.45);}
  .center { display:flex;flex-direction:column;min-width:0; }
  .center-head { display:flex;justify-content:space-between;align-items:end;margin-bottom:12px; }
  .center-title { font:700 18px Orbitron;color:#f2dfb9;letter-spacing:1px;margin-top:6px; }
  .filters { display:flex;gap:6px; }
  .filter { border:1px solid #49351e;background:#15120f;color:#9f8258;font:10px 'DM Mono';padding:8px 10px;cursor:pointer; }
  .filter.active,.filter:hover { color:#171109;background:#eda431;border-color:#eda431; }
  .product-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px; }
  .product { min-height:151px;padding:14px;background:#1c1813;border:1px solid #382817;cursor:pointer;transition:transform .18s,border-color .18s,background .18s;display:flex;flex-direction:column; }
  .product:hover { transform:translateY(-2px);border-color:#c77f25;background:#211a11; }
  .product-top {display:flex;justify-content:space-between;align-items:start;}
  .product-icon {width:32px;height:32px;display:grid;place-items:center;color:#f1a936;background:#322214;border:1px solid #5e3c1c;}
  .stock {font-size:8px;color:#70955d;letter-spacing:1px;}
  .product-name {font:700 12px Orbitron;color:#e8d6af;margin-top:18px;letter-spacing:.4px;}
  .product-desc {font-size:9px;color:#836c4c;margin-top:6px;line-height:1.4;}
  .product-bottom {display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:14px;}
  .price {font:700 14px Orbitron;color:#ffb52e;}
  .add {width:27px;height:27px;display:grid;place-items:center;color:#171109;background:#e9a12e;border:0;cursor:pointer;transition:.15s;}
  .add:hover {background:#ffd36b;transform:scale(1.07);}
  .cart-panel {padding:18px;display:flex;flex-direction:column;}
  .cart-header {display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;}
  .cart-title {font:700 13px Orbitron;color:#f1ddb8;letter-spacing:1px;}
  .cart-count {color:#171109;background:#edaa32;font-size:9px;padding:3px 6px;}
  .cart-items {display:flex;flex-direction:column;gap:11px;min-height:150px;}
  .cart-empty {color:#776044;font-size:10px;line-height:1.6;padding:24px 2px;border-top:1px dashed #48341f;border-bottom:1px dashed #48341f;}
  .cart-item {display:grid;grid-template-columns:1fr auto;gap:8px;border-bottom:1px solid #302418;padding-bottom:10px;}
  .cart-name {font-size:10px;color:#e4d0a6;}
  .cart-price {font-size:10px;color:#ecaa35;text-align:right;}
  .qty {display:flex;gap:8px;align-items:center;margin-top:7px;color:#90734b;font-size:9px;}
  .qty button {width:17px;height:17px;background:#2b2117;border:1px solid #513719;color:#dca03a;cursor:pointer;display:grid;place-items:center;padding:0;}
  .order-footer {border-top:1px solid #4a351e;margin-top:auto;padding-top:15px;}
  .total-row {display:flex;justify-content:space-between;align-items:center;}
  .total-label {color:#977a50;font-size:9px;letter-spacing:1.5px;}
  .total {font:700 20px Orbitron;color:#ffd36b;}
  .order-btn {width:100%;margin-top:14px;border:0;background:#eca42e;color:#191209;padding:12px;font:700 10px Orbitron;letter-spacing:1.3px;cursor:pointer;transition:.18s;}
  .order-btn:hover:not(:disabled) {background:#ffd36b;box-shadow:0 0 16px rgba(236,164,46,.25);}
  .order-btn:disabled {opacity:.35;cursor:not-allowed;}
  .rank-strip {margin-top:16px;border-top:1px solid #3d2a16;padding-top:15px;}
  .rank-title {display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;}
  .rank-title strong {font:700 11px Orbitron;color:#e9d7b1;}
  .rank-title span {font-size:8px;color:#93744b;}
  .rank-row {display:grid;grid-template-columns:22px 1fr auto;align-items:center;gap:6px;padding:7px 0;border-bottom:1px solid #2d2217;}
  .rank {font:700 11px Orbitron;color:#bd8a35;}
  .rank:nth-child(1) {color:#f1bc4b;}
  .rank-user {font-size:9px;color:#b49a6f;}
  .rank-points {font:500 10px 'DM Mono';color:#e9b143;}
  .toast {position:fixed;right:28px;bottom:22px;background:#eaa32e;color:#191209;padding:11px 14px;font-size:10px;letter-spacing:.3px;box-shadow:0 5px 22px #0b0906;z-index:4;animation:toast-in .2s ease-out;}
  @keyframes toast-in {from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}
  @media(max-width:900px){.cc-shell{padding:18px;min-height:100dvh}.grid{grid-template-columns:210px 1fr}.cart-panel{grid-column:1/-1}.product-grid{grid-template-columns:repeat(3,1fr)}}
  @media(max-width:650px){.cc-top{align-items:flex-start}.top-actions{gap:8px}.live{display:none}.grid{grid-template-columns:1fr}.session-panel{min-height:220px}.product-grid{grid-template-columns:repeat(2,1fr)}.filters{overflow:auto}.center-head{align-items:flex-start;flex-direction:column;gap:12px}.cart-panel{grid-column:auto}.timer-value{font-size:27px}}
`;

type Product = { id: string; name: string; description: string; price: number; category: string; icon: React.ReactNode };
type CartItem = Product & { quantity: number };

const products: Product[] = [
  { id: 'volt', name: 'VOLT ENERGY', description: 'Citrus charge / 330ml', price: 65, category: 'drinks', icon: <Zap size={16} /> },
  { id: 'coldbrew', name: 'COLD BREW', description: 'Black coffee / 240ml', price: 85, category: 'drinks', icon: <Coffee size={16} /> },
  { id: 'chips', name: 'PIXEL CRUNCH', description: 'Sea salt crisps / 60g', price: 45, category: 'snacks', icon: <Sparkles size={16} /> },
  { id: 'noodles', name: 'QUICK RAMEN', description: 'Spicy miso cup / 65g', price: 70, category: 'snacks', icon: <Gamepad2 size={16} /> },
  { id: 'water', name: 'HYDR8', description: 'Purified water / 500ml', price: 35, category: 'drinks', icon: <Coffee size={16} /> },
  { id: 'cookie', name: 'GG COOKIE', description: 'Double chocolate / 55g', price: 50, category: 'snacks', icon: <Sparkles size={16} /> },
];

const rankings = [
  ['01', 'mem-kraken', '1,840'], ['02', 'mem-raprap', '1,275'], ['03', 'mem-luna', '980'], ['04', 'mem-sage', '740'], ['05', 'mem-ace', '615'],
];

export function CommandCenter() {
  const [category, setCategory] = useState('all');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [toast, setToast] = useState('');
  const [loggedOut, setLoggedOut] = useState(false);
  const visibleProducts = category === 'all' ? products : products.filter((p) => p.category === category);
  const total = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart]);
  const count = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);

  const add = (product: Product) => {
    setCart((items) => items.some((item) => item.id === product.id)
      ? items.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
      : [...items, { ...product, quantity: 1 }]);
    setToast(`${product.name} added to cart`);
    window.setTimeout(() => setToast(''), 1800);
  };
  const change = (id: string, delta: number) => setCart((items) => items.flatMap((item) => item.id === id ? (item.quantity + delta > 0 ? [{ ...item, quantity: item.quantity + delta }] : []) : [item]));
  const order = () => { if (!cart.length) return; setCart([]); setToast('Order sent to station counter'); window.setTimeout(() => setToast(''), 2200); };

  if (loggedOut) return <div style={{ minHeight: '100%', background: '#11100d', color: '#e9a32d', display: 'grid', placeItems: 'center', fontFamily: 'DM Mono' }}><div><div style={{ fontFamily: 'Orbitron', fontSize: 20 }}>SESSION CLOSED</div><div style={{ marginTop: 10, color: '#947b58', fontSize: 11 }}>You may safely leave the station.</div></div></div>;

  return <div className="cc-root"><style>{styles}</style><main className="cc-shell">
    <header className="cc-top"><div className="brand"><div className="brand-mark"><Gamepad2 size={19} /></div><div><div className="brand-title">DENFI // STATION 07</div><div className="brand-sub">PLAYER COMMAND CENTER</div></div></div><div className="top-actions"><div className="live"><i /> SESSION ACTIVE</div><button className="logout" onClick={() => setLoggedOut(true)}><LogOut size={13} /> LOGOUT</button></div></header>
    <div className="grid">
      <section className="panel session-panel"><div><div className="session-head"><strong>SESSION STATUS</strong><span className="session-tag">ONLINE</span></div><div className="timer"><div className="timer-value">29:23:59:12</div><div className="timer-label">TIME REMAINING</div></div><div className="session-line" /><div className="user-label">CURRENT PLAYER</div><div className="user-name">mem-raprap</div></div><div className="balance"><div className="balance-row"><div><div className="user-label">POINT BALANCE</div><div className="balance-number">12.50</div></div><div className="balance-unit">PTS</div></div><div className="progress"><span /></div></div></section>
      <section className="center"><div className="center-head"><div><div className="eyebrow">STATION STORE / QUICK ORDER</div><div className="center-title">FUEL YOUR SESSION</div></div><div className="filters">{['all', 'drinks', 'snacks'].map((item) => <button key={item} className={`filter ${category === item ? 'active' : ''}`} onClick={() => setCategory(item)}>{item.toUpperCase()}</button>)}</div></div><div className="product-grid">{visibleProducts.map((product) => <article className="product" key={product.id} onClick={() => add(product)}><div className="product-top"><div className="product-icon">{product.icon}</div><div className="stock">IN STOCK</div></div><div className="product-name">{product.name}</div><div className="product-desc">{product.description}</div><div className="product-bottom"><div className="price">₱{product.price}</div><button className="add" aria-label={`Add ${product.name}`} onClick={(event) => { event.stopPropagation(); add(product); }}><Plus size={16} /></button></div></article>)}</div><div className="rank-strip"><div className="rank-title"><strong><Trophy size={13} style={{ verticalAlign: 'middle', marginRight: 7, color: '#eca42e' }} /> TOP MEMBERS</strong><span>COIN LOG / ALL TIME</span></div>{rankings.map(([rank, user, points]) => <div className="rank-row" key={user}><div className="rank">{rank}</div><div className="rank-user">{user}</div><div className="rank-points">{points} PTS</div></div>)}</div></section>
      <aside className="panel cart-panel"><div className="cart-header"><div className="cart-title"><ShoppingBag size={15} style={{ verticalAlign: 'middle', marginRight: 8, color: '#eca42e' }} /> CART</div><div className="cart-count">{count} ITEMS</div></div><div className="cart-items">{cart.length === 0 ? <div className="cart-empty">Your order queue is clear.<br />Select a station fuel item to begin.</div> : cart.map((item) => <div className="cart-item" key={item.id}><div><div className="cart-name">{item.name}</div><div className="qty"><button onClick={() => change(item.id, -1)}><Minus size={10} /></button>{item.quantity}<button onClick={() => change(item.id, 1)}><Plus size={10} /></button></div></div><div className="cart-price">₱{item.price * item.quantity}</div></div>)}</div><div className="order-footer"><div className="total-row"><span className="total-label">ORDER TOTAL</span><span className="total">₱{total}</span></div><button className="order-btn" disabled={!cart.length} onClick={order}>PLACE ORDER <ChevronRight size={13} style={{ verticalAlign: 'middle' }} /></button></div></aside>
    </div>
  </main>{toast && <div className="toast">{toast}</div>}</div>;
}

export default CommandCenter;