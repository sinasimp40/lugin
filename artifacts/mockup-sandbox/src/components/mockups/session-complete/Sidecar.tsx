import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Gamepad2,
  LogOut,
  Minus,
  Plus,
  ShoppingBag,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";

type Tool = "games" | "order" | "ranking" | "attendance";

const products = [
  { id: "coffee", name: "Iced Coffee", price: 55, detail: "Cold brew · 16 oz", mark: "IC" },
  { id: "water", name: "Bottled Water", price: 20, detail: "Still · chilled", mark: "BW" },
  { id: "noodles", name: "Cup Noodles", price: 45, detail: "Chicken · hot water", mark: "CN" },
  { id: "chips", name: "Potato Chips", price: 30, detail: "Salted · 60 g", mark: "PC" },
  { id: "sandwich", name: "Ham Sandwich", price: 65, detail: "Toasted on request", mark: "HS" },
  { id: "cola", name: "Coke", price: 35, detail: "Can · 330 ml", mark: "CK" },
];

const members = [
  { name: "mem-carlo", points: 22.48 },
  { name: "mem-alice", points: 11.38 },
  { name: "mem-gina", points: 2.3 },
  { name: "mem-player-one", points: 2 },
  { name: "mem-diana", points: 1.5 },
];

const toolItems: { id: Tool; label: string; Icon: typeof Gamepad2 }[] = [
  { id: "games", label: "Games", Icon: Gamepad2 },
  { id: "order", label: "Order", Icon: ShoppingBag },
  { id: "ranking", label: "Ranking", Icon: Trophy },
  { id: "attendance", label: "Attendance", Icon: CalendarDays },
];

const money = (amount: number) => `₱${amount.toFixed(2).replace(/\.00$/, "")}`;

export function Sidecar() {
  const [tool, setTool] = useState<Tool>("games");
  const [collapsed, setCollapsed] = useState(false);
  const [seconds, setSeconds] = useState(43 * 60 + 18);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<"success" | "error" | null>(null);
  const [stake, setStake] = useState("1.5");
  const [spinState, setSpinState] = useState<"ready" | "result" | "error">("ready");
  const [month, setMonth] = useState(new Date(2025, 3, 1));
  const [selectedDay, setSelectedDay] = useState(17);
  const [logoutConfirm, setLogoutConfirm] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(id);
  }, [toast]);

  const cartCount = Object.values(quantities).reduce((sum, value) => sum + value, 0);
  const cartTotal = products.reduce((sum, item) => sum + item.price * (quantities[item.id] || 0), 0);
  const timer = `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const calendar = useMemo(() => {
    const offset = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array(offset).fill(0), ...Array.from({ length: count }, (_, i) => i + 1)];
  }, [month]);
  const monthLabel = month.toLocaleDateString("en", { month: "long", year: "numeric" });

  const changeQuantity = (id: string, step: number) => {
    setQuantities((previous) => {
      const next = { ...previous, [id]: Math.max(0, (previous[id] || 0) + step) };
      if (!next[id]) delete next[id];
      return next;
    });
  };

  const shiftMonth = (delta: number) => {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
    setSelectedDay(0);
  };

  return (
    <main className="sc-stage">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; }
        .sc-stage {
          --ink:#273345; --muted:#8791a0; --edge:#e5e8ed; --paper:#f8f9fb; --white:#fff;
          --accent:#477d8d; --accent-soft:#e7f1f3; --lav:#f0eef8; --lav-ink:#756996;
          width:100%; min-height:100dvh; overflow:hidden; position:relative; background:#202a34;
          color:var(--ink); font-family:'Manrope',sans-serif;
        }
        .sc-game-bg { position:absolute; inset:0; background:
          radial-gradient(ellipse at 23% 46%,rgba(116,145,153,.23),transparent 32%),
          radial-gradient(ellipse at 70% 7%,rgba(83,113,126,.16),transparent 30%),
          linear-gradient(122deg,#27353e 0%,#1d2730 62%,#2b333b 100%); }
        .sc-game-bg:before { content:"";position:absolute;inset:0;opacity:.18;background-image:
          linear-gradient(rgba(220,232,235,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(220,232,235,.08) 1px,transparent 1px);
          background-size:62px 62px; mask-image:linear-gradient(90deg,#000,transparent 70%); }
        .sc-context { position:absolute; left:5.4%; top:9.5%; color:#bdc8c8; }
        .sc-context-kicker { font:500 10px 'DM Mono',monospace; letter-spacing:1.7px; text-transform:uppercase; opacity:.72; }
        .sc-context-title { font-size:25px; font-weight:600; letter-spacing:-.8px; margin-top:10px; color:#d1d9d7; }
        .sc-context-line { margin-top:14px;width:178px;height:1px;background:linear-gradient(90deg,#a3bdba66,transparent); }
        .sc-context-sub { margin-top:11px;font:10px 'DM Mono',monospace;letter-spacing:1px;color:#829397; }
        .sc-game-hud { position:absolute;left:5.4%;bottom:9%;display:flex;align-items:center;gap:12px;color:#b2c1c1;font:10px 'DM Mono',monospace;letter-spacing:1px; }
        .sc-hud-pip { width:7px;height:7px;border-radius:50%;background:#85aead;box-shadow:0 0 0 4px #85aead1e; }
        .sc-watermark {position:absolute;right:425px;top:25px;color:#c5d1d2;font:9px 'DM Mono',monospace;letter-spacing:1.6px;text-transform:uppercase;opacity:.6}
        .sc-panel { position:absolute;right:17px;top:17px;bottom:17px;width:min(440px,calc(100vw - 34px));display:flex;
          border:1px solid rgba(255,255,255,.46);border-radius:16px;background:var(--paper);
          box-shadow:0 18px 55px rgba(5,13,18,.38),0 2px 8px rgba(8,17,22,.12);overflow:hidden; }
        .sc-rail { width:67px;flex:none;background:#eff1f4;border-right:1px solid #e1e4e9;display:flex;flex-direction:column;align-items:center;padding:14px 7px 12px; }
        .sc-mark {width:34px;height:34px;border-radius:11px;background:#344957;color:#f5f7f7;display:grid;place-items:center;font:500 11px 'DM Mono',monospace;letter-spacing:-.8px;margin-bottom:20px;box-shadow:inset 0 0 0 1px #ffffff25;}
        .sc-rail-tools {display:flex;flex-direction:column;gap:7px;width:100%;}
        .sc-nav {height:49px;border:0;border-radius:10px;background:transparent;color:#8993a0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;font:600 8px 'Manrope',sans-serif;transition:background .16s,color .16s,transform .16s;}
        .sc-nav:hover {background:#e5e9ed;color:#3c5966;transform:translateY(-1px)}
        .sc-nav.active {background:#dce9ea;color:#356673;box-shadow:inset 0 0 0 1px #ccdedf;}
        .sc-nav.active:before {content:"";position:absolute;left:0;width:3px;height:25px;border-radius:0 3px 3px 0;background:#5b8a94;}
        .sc-rail-spacer {flex:1}
        .sc-rail-meta {font:9px 'DM Mono',monospace;color:#9aa2ac;writing-mode:vertical-rl;transform:rotate(180deg);letter-spacing:1.4px;}
        .sc-main {min-width:0;flex:1;display:flex;flex-direction:column;background:var(--paper);}
        .sc-head {padding:17px 17px 13px;border-bottom:1px solid var(--edge);background:linear-gradient(110deg,#fbfcfd,#f6f8fa);}
        .sc-topline {display:flex;align-items:center;justify-content:space-between;margin-bottom:13px;}
        .sc-session-label {display:flex;align-items:center;gap:7px;font:500 9px 'DM Mono',monospace;color:#828c98;letter-spacing:1.1px;text-transform:uppercase;}
        .sc-live {width:6px;height:6px;border-radius:50%;background:#63a28c;box-shadow:0 0 0 3px #63a28c1d;}
        .sc-collapse {display:grid;place-items:center;width:27px;height:27px;border:1px solid #e2e6ea;border-radius:8px;background:#fff;color:#83909b;cursor:pointer;}
        .sc-profile-row {display:flex;align-items:center;gap:11px;}
        .sc-avatar {width:36px;height:36px;border-radius:12px;display:grid;place-items:center;background:#e8eaf4;color:#655f81;font-size:12px;font-weight:800;letter-spacing:-.5px;}
        .sc-profile {min-width:0;flex:1;}
        .sc-member {font-size:12px;font-weight:800;letter-spacing:-.25px;color:#2d3948;}
        .sc-pc {font:10px 'DM Mono',monospace;color:#85909c;margin-top:3px;}
        .sc-logout {height:29px;display:flex;align-items:center;gap:5px;padding:0 8px;border:1px solid #e8e0e0;border-radius:8px;background:#fff;color:#9b7474;font:700 9px 'Manrope',sans-serif;cursor:pointer;}
        .sc-logout:hover {background:#fdf3f2;border-color:#eed3d1;color:#a35952;}
        .sc-clockrow {margin-top:14px;padding:10px 11px;border:1px solid #e6e9ec;border-radius:11px;background:#fff;display:flex;align-items:center;justify-content:space-between;}
        .sc-clockmeta {font:9px 'DM Mono',monospace;color:#8a95a0;letter-spacing:.65px;text-transform:uppercase;}
        .sc-clock {font:500 19px 'DM Mono',monospace;letter-spacing:.4px;color:#344b5a;line-height:1.1;}
        .sc-clock-right {display:flex;flex-direction:column;align-items:flex-end;gap:4px;}
        .sc-attendance-mini {font:9px 'DM Mono',monospace;color:#7b8791;}
        .sc-progress {width:105px;height:4px;border-radius:4px;background:#e8edf0;overflow:hidden;}
        .sc-progress i {display:block;width:50%;height:100%;background:#79a3a5;border-radius:4px;}
        .sc-workspace {min-height:0;flex:1;display:flex;flex-direction:column;}
        .sc-view-heading {padding:15px 17px 12px;}
        .sc-eyebrow {font:500 9px 'DM Mono',monospace;color:#87919c;letter-spacing:1.25px;text-transform:uppercase;}
        .sc-title-row {display:flex;align-items:flex-end;justify-content:space-between;margin-top:4px;}
        .sc-title {font-size:20px;line-height:1.2;font-weight:700;letter-spacing:-.8px;color:#2d3948;}
        .sc-caption {font-size:10px;color:#89939e;margin-top:4px;}
        .sc-scroll {min-height:0;flex:1;overflow:auto;padding:0 17px 14px;scrollbar-width:thin;scrollbar-color:#d6dce2 transparent;}
        .sc-order-list {display:flex;flex-direction:column;gap:7px;}
        .sc-product {height:59px;display:flex;align-items:center;gap:9px;padding:7px 8px;border:1px solid #e8ebef;border-radius:10px;background:#fff;}
        .sc-product-mark {width:34px;height:34px;flex:none;border-radius:9px;background:#eff2f5;color:#758492;display:grid;place-items:center;font:500 9px 'DM Mono',monospace;}
        .sc-product-info {flex:1;min-width:0}
        .sc-product-name {font-size:11px;font-weight:700;color:#354252;}
        .sc-product-desc {font-size:9px;color:#929ba5;margin-top:2px;}
        .sc-product-price {font:500 10px 'DM Mono',monospace;color:#607d83;margin-top:2px;}
        .sc-qty {display:flex;align-items:center;gap:5px;}
        .sc-qty button {width:24px;height:24px;border:1px solid #e5e9ed;border-radius:7px;background:#fff;color:#677c84;display:grid;place-items:center;cursor:pointer;}
        .sc-qty button:hover {background:#eef4f4}
        .sc-qty span {min-width:10px;text-align:center;font:11px 'DM Mono',monospace;color:#495868;}
        .sc-cart {margin-top:9px;padding:11px 12px;background:#f0f3f5;border-radius:10px;display:flex;align-items:center;gap:10px;}
        .sc-cart-main {flex:1;}
        .sc-cart-count {font-size:10px;color:#707c89;}
        .sc-cart-total {font:500 16px 'DM Mono',monospace;color:#344d59;margin-top:2px;}
        .sc-clear {border:0;background:none;color:#8e969e;font-size:9px;font-weight:700;cursor:pointer;padding:6px;}
        .sc-primary {height:34px;padding:0 13px;border:0;border-radius:9px;background:#4f7981;color:#fff;font:700 10px 'Manrope',sans-serif;letter-spacing:.2px;cursor:pointer;transition:background .15s,transform .15s;}
        .sc-primary:hover {background:#3e6971;transform:translateY(-1px)}
        .sc-primary:disabled {opacity:.45;cursor:not-allowed;transform:none}
        .sc-demo-note {margin-top:10px;display:flex;align-items:flex-start;gap:7px;color:#8a939d;font-size:9px;line-height:1.5;}
        .sc-rank-summary {display:flex;align-items:center;justify-content:space-between;padding:11px 12px;background:#efeff7;border:1px solid #e7e5f0;border-radius:10px;margin-bottom:11px;}
        .sc-rank-sumlabel {font:9px 'DM Mono',monospace;color:#89869d;letter-spacing:.8px;text-transform:uppercase;}
        .sc-rank-sumvalue {font:500 16px 'DM Mono',monospace;color:#5d5b78;margin-top:3px;}
        .sc-rank-place {font-size:10px;font-weight:700;color:#756d90;padding:5px 8px;background:#fff;border-radius:7px;}
        .sc-rank-row {height:47px;display:flex;align-items:center;gap:9px;border-bottom:1px solid #eaedf0;}
        .sc-rank-no {width:21px;text-align:center;font:10px 'DM Mono',monospace;color:#9aa2aa;}
        .sc-rank-avatar {width:27px;height:27px;border-radius:9px;background:#e9edf0;display:grid;place-items:center;color:#72818b;font:700 9px 'DM Mono',monospace;}
        .sc-rank-name {flex:1;font-size:10px;font-weight:700;color:#465463;}
        .sc-rank-points {font:500 10px 'DM Mono',monospace;color:#758594;}
        .sc-rank-row.me .sc-rank-no,.sc-rank-row.me .sc-rank-points {color:#527a81;}
        .sc-rank-row.me .sc-rank-avatar {background:#dce9e9;color:#47727a;}
        .sc-month {display:flex;align-items:center;justify-content:space-between;margin:0 0 10px;}
        .sc-month strong {font-size:12px;color:#3d4a58;}
        .sc-month-actions {display:flex;gap:5px;}
        .sc-month-actions button {width:25px;height:25px;border:1px solid #e5e8ed;border-radius:7px;background:white;color:#74818c;display:grid;place-items:center;cursor:pointer;}
        .sc-week,.sc-days {display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center;}
        .sc-week div {font:9px 'DM Mono',monospace;color:#a0a6ae;padding:4px 0 6px;}
        .sc-day {height:33px;border:1px solid transparent;border-radius:8px;background:transparent;color:#677483;font:10px 'DM Mono',monospace;cursor:pointer;}
        .sc-day:hover {background:#edf2f2}
        .sc-day.done {background:#e4efea;color:#528273;}
        .sc-day.played {background:#f0eee7;color:#9b8765;}
        .sc-day.absent {background:#f5e9e8;color:#b17f78;}
        .sc-day.today {border-color:#80a6a4;font-weight:700;}
        .sc-day.selected {box-shadow:inset 0 0 0 1px #5f8a8d;background:#dce9e9;color:#406d74;font-weight:800;}
        .sc-day.blank {pointer-events:none}
        .sc-att-card {margin-top:11px;padding:12px;border:1px solid #e7eaee;border-radius:10px;background:#fff;}
        .sc-att-card-top {display:flex;justify-content:space-between;align-items:center;}
        .sc-att-label {font-size:10px;font-weight:700;color:#4c5867;}
        .sc-att-status {font:9px 'DM Mono',monospace;color:#6e9685;}
        .sc-att-copy {font-size:9px;color:#929aa4;margin-top:5px;line-height:1.5;}
        .sc-streak {display:flex;align-items:center;gap:9px;margin-top:11px;padding:10px;background:#eff3f4;border-radius:9px;}
        .sc-streak-mark {width:27px;height:27px;border-radius:8px;background:#dde9e9;color:#668b8d;display:grid;place-items:center;}
        .sc-streak-text {font-size:10px;color:#596a73;font-weight:700;}
        .sc-streak-sub {font-size:9px;color:#929da3;margin-top:2px;}
        .sc-game-card {margin:0 0 9px;padding:12px;border:1px solid #e6e9ed;background:#fff;border-radius:11px;}
        .sc-game-top {display:flex;justify-content:space-between;align-items:center;}
        .sc-game-balance-label {font:9px 'DM Mono',monospace;letter-spacing:.7px;color:#929ca5;text-transform:uppercase;}
        .sc-balance {font:500 14px 'DM Mono',monospace;color:#465c66;margin-top:3px;}
        .sc-spin-count {font:9px 'DM Mono',monospace;color:#87929d;padding:5px 7px;background:#f1f3f5;border-radius:6px;}
        .sc-reel {margin-top:12px;height:72px;padding:8px;display:flex;align-items:stretch;gap:5px;position:relative;overflow:hidden;border-radius:9px;background:#edf0f3;border:1px solid #e1e5e9;}
        .sc-reel:after {content:"";position:absolute;inset:0;background:linear-gradient(90deg,#edf0f3 0%,transparent 17%,transparent 83%,#edf0f3 100%);pointer-events:none;}
        .sc-reel-cell {flex:1;display:grid;place-items:center;border:1px solid #e3e6ea;border-radius:7px;background:#fafbfc;color:#788392;font:500 13px 'DM Mono',monospace;}
        .sc-reel-cell.target {border:1px solid #a3bec0;background:#e7f0f0;color:#4e787d;box-shadow:inset 0 0 0 2px #fff;}
        .sc-reel-caption {position:absolute;right:8px;bottom:5px;z-index:1;font:8px 'DM Mono',monospace;letter-spacing:.6px;color:#8d969f;text-transform:uppercase;}
        .sc-result {margin-top:9px;padding:9px 10px;border-radius:8px;background:#f1f3f5;display:flex;align-items:center;gap:8px;}
        .sc-result.success {background:#e8f1ec;color:#5c8773;}
        .sc-result.error {background:#f7ecea;color:#a4756e;}
        .sc-result-copy {font-size:9px;line-height:1.45;color:#7d8993;}
        .sc-result strong {display:block;color:#596b73;font-size:10px;}
        .sc-stake-row {display:flex;align-items:center;justify-content:space-between;margin-top:11px;}
        .sc-stake-label {font-size:10px;font-weight:700;color:#566270;}
        .sc-stake-field {height:31px;width:106px;display:flex;align-items:center;gap:5px;padding:0 8px;background:#fff;border:1px solid #e3e7eb;border-radius:8px;color:#8a959f;font:10px 'DM Mono',monospace;}
        .sc-stake-field input {width:100%;min-width:0;border:0;outline:0;background:transparent;color:#465968;font:500 11px 'DM Mono',monospace;}
        .sc-play {width:100%;margin-top:10px;height:35px;}
        .sc-legal {margin-top:9px;padding:9px 10px;border-left:2px solid #b7c9ca;background:#f2f5f5;color:#828e96;font-size:9px;line-height:1.5;}
        .sc-foot {border-top:1px solid var(--edge);padding:10px 16px;display:flex;align-items:center;justify-content:space-between;background:#f7f8fa;}
        .sc-foot-label {font:9px 'DM Mono',monospace;color:#99a1a9;letter-spacing:.5px;}
        .sc-foot-points {font:500 12px 'DM Mono',monospace;color:#596e75;}
        .sc-toast {position:absolute;bottom:62px;left:80px;right:13px;z-index:5;padding:10px 12px;border-radius:9px;background:#e6f1e9;color:#4d7d63;font-size:10px;font-weight:700;box-shadow:0 5px 20px #24333b20;display:flex;align-items:center;gap:7px;}
        .sc-toast.error {background:#f6e9e7;color:#a36f68;}
        .sc-logout-shade {position:absolute;inset:0;z-index:8;background:#1f2c36aa;display:grid;place-items:center;padding:18px;}
        .sc-logout-dialog {width:100%;max-width:300px;padding:18px;border:1px solid #e2e6e9;border-radius:14px;background:#fff;box-shadow:0 16px 44px #17232d42;}
        .sc-dialog-title {font-weight:800;font-size:15px;color:#354453;}
        .sc-dialog-copy {font-size:11px;color:#7e8a95;line-height:1.55;margin-top:7px;}
        .sc-dialog-actions {display:flex;justify-content:flex-end;gap:7px;margin-top:16px;}
        .sc-secondary {height:32px;padding:0 12px;border:1px solid #e4e8eb;border-radius:8px;background:#fff;color:#697782;font-size:10px;font-weight:700;cursor:pointer;}
        .sc-panel.collapsed {width:67px;}
        .sc-panel.collapsed .sc-main {display:none;}
        @media(max-width:700px) {
          .sc-panel {right:8px;top:8px;bottom:8px;width:min(420px,calc(100vw - 16px));}
          .sc-context,.sc-game-hud,.sc-watermark {display:none}
        }
        @media(max-width:400px) {
          .sc-panel:not(.collapsed) {width:calc(100vw - 12px);right:6px;top:6px;bottom:6px}
          .sc-rail {width:58px}
          .sc-nav {height:45px}
        }
      `}</style>
      <div className="sc-game-bg" />
      <div className="sc-context">
        <div className="sc-context-kicker">DENFI · SESSION LINK</div>
        <div className="sc-context-title">Your game stays yours.</div>
        <div className="sc-context-line" />
        <div className="sc-context-sub">PC-07 · LOCAL PLAY SESSION</div>
      </div>
      <div className="sc-game-hud"><span className="sc-hud-pip" />SESSION ACTIVE <span style={{ opacity: 0.38 }}>—</span> DENFI LOUNGE</div>
      <div className="sc-watermark">Utility sidecar · preview</div>

      <section className={`sc-panel${collapsed ? " collapsed" : ""}`} aria-label="Denfi Session Sidecar">
        <nav className="sc-rail" aria-label="Session tools">
          <div className="sc-mark">d.</div>
          <div className="sc-rail-tools">
            {toolItems.map(({ id, label, Icon }) => (
              <button key={id} className={`sc-nav${tool === id ? " active" : ""}`} onClick={() => { setTool(id); setCollapsed(false); }} aria-pressed={tool === id} title={label}>
                <Icon size={16} strokeWidth={1.8} /><span>{label}</span>
              </button>
            ))}
          </div>
          <div className="sc-rail-spacer" />
          <div className="sc-rail-meta">PLAY WITHOUT PAUSE</div>
        </nav>

        {!collapsed && <div className="sc-main">
          <header className="sc-head">
            <div className="sc-topline">
              <div className="sc-session-label"><span className="sc-live" /> Active session</div>
              <button className="sc-collapse" onClick={() => setCollapsed(true)} aria-label="Collapse sidecar"><ArrowRight size={14} /></button>
            </div>
            <div className="sc-profile-row">
              <div className="sc-avatar">MP</div>
              <div className="sc-profile"><div className="sc-member">mem-player-one</div><div className="sc-pc">Station · PC-07</div></div>
              <button className="sc-logout" onClick={() => setLogoutConfirm(true)}><LogOut size={12} /> Logout</button>
            </div>
            <div className="sc-clockrow">
              <div><div className="sc-clockmeta">Time remaining</div><div className="sc-clock">{timer}</div></div>
              <div className="sc-clock-right"><div className="sc-attendance-mini">Attendance · 30 / 60 min</div><div className="sc-progress"><i /></div></div>
            </div>
          </header>

          <div className="sc-workspace">
            {tool === "order" && <>
              <div className="sc-view-heading"><div className="sc-eyebrow">From the counter</div><div className="sc-title-row"><div className="sc-title">Quick order</div><ShoppingBag size={17} color="#91a0a8" /></div><div className="sc-caption">Build a basket while your game is paused between rounds.</div></div>
              <div className="sc-scroll">
                <div className="sc-order-list">{products.map((product) => {
                  const quantity = quantities[product.id] || 0;
                  return <div className="sc-product" key={product.id}>
                    <div className="sc-product-mark">{product.mark}</div>
                    <div className="sc-product-info"><div className="sc-product-name">{product.name}</div><div className="sc-product-desc">{product.detail}</div><div className="sc-product-price">{money(product.price)}</div></div>
                    <div className="sc-qty">{quantity > 0 && <><button onClick={() => changeQuantity(product.id, -1)} aria-label={`Remove one ${product.name}`}><Minus size={11} /></button><span>{quantity}</span></>}<button onClick={() => changeQuantity(product.id, 1)} aria-label={`Add ${product.name}`}><Plus size={12} /></button></div>
                  </div>;
                })}</div>
                <div className="sc-cart"><div className="sc-cart-main"><div className="sc-cart-count">{cartCount} {cartCount === 1 ? "item" : "items"} in basket</div><div className="sc-cart-total">{money(cartTotal)}</div></div><button className="sc-clear" onClick={() => setQuantities({})} disabled={!cartCount}>Clear</button><button className="sc-primary" disabled={!cartCount} onClick={() => { setQuantities({}); setToast("success"); }}>Send demo order</button></div>
                <div className="sc-demo-note"><CircleHelp size={13} /> Preview only. This basket is not sent to the cafe and no order is placed.</div>
              </div>
            </>}

            {tool === "ranking" && <>
              <div className="sc-view-heading"><div className="sc-eyebrow">Monthly standing</div><div className="sc-title-row"><div className="sc-title">Points ranking</div><Trophy size={17} color="#8f8aa7" /></div><div className="sc-caption">A little friendly competition for this month.</div></div>
              <div className="sc-scroll">
                <div className="sc-rank-summary"><div><div className="sc-rank-sumlabel">Your points · April</div><div className="sc-rank-sumvalue">2.00 pts</div></div><div className="sc-rank-place">#4 this month</div></div>
                {members.map((member, index) => <div key={member.name} className={`sc-rank-row${member.name === "mem-player-one" ? " me" : ""}`}><div className="sc-rank-no">{String(index + 1).padStart(2, "0")}</div><div className="sc-rank-avatar">{member.name.slice(4, 6).toUpperCase()}</div><div className="sc-rank-name">{member.name}{member.name === "mem-player-one" ? " · you" : ""}</div><div className="sc-rank-points">{member.points.toFixed(2)} pts</div></div>)}
                <div className="sc-demo-note"><CircleHelp size={13} /> Demo member standings · points reset monthly.</div>
              </div>
            </>}

            {tool === "attendance" && <>
              <div className="sc-view-heading"><div className="sc-eyebrow">Your play history</div><div className="sc-title-row"><div className="sc-title">Attendance</div><CalendarDays size={17} color="#86a5a1" /></div><div className="sc-caption">Progress toward today’s one-hour visit goal.</div></div>
              <div className="sc-scroll">
                <div className="sc-month"><strong>{monthLabel}</strong><div className="sc-month-actions"><button aria-label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft size={14} /></button><button aria-label="Next month" onClick={() => shiftMonth(1)}><ChevronRight size={14} /></button></div></div>
                <div className="sc-week">{["Su","Mo","Tu","We","Th","Fr","Sa"].map((day) => <div key={day}>{day}</div>)}</div>
                <div className="sc-days">{calendar.map((day, index) => {
                  if (!day) return <div key={`blank-${index}`} className="sc-day blank" />;
                  const today = month.getMonth() === 3 && day === 17;
                  const type = day % 9 === 0 ? "absent" : day < 17 && [2,3,4,7,8,11,12,14,15,16].includes(day) ? "done" : day < 17 ? "played" : "";
                  return <button key={day} className={`sc-day ${type}${today ? " today" : ""}${selectedDay === day ? " selected" : ""}`} onClick={() => setSelectedDay(day)}>{day}</button>;
                })}</div>
                <div className="sc-att-card"><div className="sc-att-card-top"><div className="sc-att-label">{selectedDay ? `${month.toLocaleDateString("en",{month:"short"})} ${selectedDay} attendance` : "Select a date"}</div><div className="sc-att-status">{selectedDay === 17 ? "IN PROGRESS" : selectedDay && selectedDay < 17 ? "RECORDED" : "—"}</div></div><div className="sc-att-copy">{selectedDay === 17 ? "30 of 60 minutes played today. Your visit is underway." : selectedDay && selectedDay < 17 ? "Session recorded. 60 minutes · 5 points awarded." : "Choose a marked day to inspect your visit."}</div></div>
                <div className="sc-streak"><div className="sc-streak-mark"><Sparkles size={14} /></div><div><div className="sc-streak-text">3-day visit streak</div><div className="sc-streak-sub">Keep your routine going.</div></div></div>
                <div className="sc-demo-note"><CircleHelp size={13} /> Sample attendance record · not connected to your account.</div>
              </div>
            </>}

            {tool === "games" && <>
              <div className="sc-view-heading"><div className="sc-eyebrow">A little side quest</div><div className="sc-title-row"><div className="sc-title">Betting games</div><Gamepad2 size={17} color="#738e9b" /></div><div className="sc-caption">Use points for a demo spin, separate from your session.</div></div>
              <div className="sc-scroll">
                <div className="sc-game-card">
                  <div className="sc-game-top"><div><div className="sc-game-balance-label">Available points</div><div className="sc-balance">2.00 pts</div></div><div className="sc-spin-count">3 spins left</div></div>
                  <div className="sc-reel" aria-label="Illustrative multiplier reel, visuals only">
                    {["2×","5×","1×","3×","2×"].map((value,index) => <div key={index} className={`sc-reel-cell${index === 2 ? " target" : ""}`}>{value}</div>)}
                    <div className="sc-reel-caption">reel artwork · no odds shown</div>
                  </div>
                  <div className={`sc-result${spinState === "result" ? " success" : spinState === "error" ? " error" : ""}`}>
                    {spinState === "result" ? <Check size={14} /> : spinState === "error" ? <X size={14} /> : <Sparkles size={14} />}
                    <div className="sc-result-copy"><strong>{spinState === "result" ? "Sample response · 2×" : spinState === "error" ? "Demo request unavailable" : "Ready when you are"}</strong>{spinState === "result" ? "Illustrative UI state only. No points changed." : spinState === "error" ? "Try again in this local preview." : "A live outcome is decided by Denfi’s server."}</div>
                  </div>
                  <div className="sc-stake-row"><div className="sc-stake-label">Demo stake</div><label className="sc-stake-field"><span>pts</span><input aria-label="Demo stake points" type="number" min="0.01" max="2" step="0.01" value={stake} onChange={(event) => { setStake(event.target.value); setSpinState("ready"); }} /></label></div>
                  <button className="sc-primary sc-play" onClick={() => {
                    const amount = Number(stake);
                    if (!Number.isFinite(amount) || amount <= 0 || amount > 2) setSpinState("error");
                    else setSpinState("result");
                  }}>Preview spin response <ArrowDownToLine size={12} style={{ marginLeft: 5, verticalAlign: "middle" }} /></button>
                  <div className="sc-legal">Visual-only reel. Tile positions do not represent odds. This preview has no server connection and spends no points; real outcomes are server-decided.</div>
                </div>
                <div className="sc-demo-note"><CircleHelp size={13} /> Demo balance · 2 spins used today in sample data.</div>
              </div>
            </>}
          </div>
          <footer className="sc-foot"><div className="sc-foot-label">MEMBER POINTS</div><div className="sc-foot-points">2.00 pts <ChevronDown size={12} style={{ verticalAlign: "middle" }} /></div></footer>
        </div>}
        {toast && !collapsed && <div className={`sc-toast${toast === "error" ? " error" : ""}`}><Check size={14} /> Demo only — basket cleared; no order sent.</div>}
        {logoutConfirm && <div className="sc-logout-shade"><div className="sc-logout-dialog"><div className="sc-dialog-title">End this session?</div><div className="sc-dialog-copy">You’re still signed in at PC-07. This preview will not log you out or affect your session.</div><div className="sc-dialog-actions"><button className="sc-secondary" onClick={() => setLogoutConfirm(false)}>Stay here</button><button className="sc-primary" onClick={() => setLogoutConfirm(false)}>Got it</button></div></div></div>}
      </section>
      {collapsed && <button className="sc-collapse" style={{ position: "absolute", right: 25, top: 27, zIndex: 2 }} onClick={() => setCollapsed(false)} aria-label="Expand sidecar"><ArrowLeft size={14} /></button>}
    </main>
  );
}