import { useEffect, useState } from "react";
import "./Carbon.css";

type Tab = "order" | "games" | "attendance" | "ranking";

const products = [
  { name: "Coke", price: 35, mark: "C" },
  { name: "Water", price: 20, mark: "W" },
  { name: "Noodles", price: 45, mark: "N" },
  { name: "Chips", price: 30, mark: "C+" },
];
const members = [
  ["mem-carlo", "22.48"],
  ["mem-alice", "11.38"],
  ["mem-gina", "2.30"],
  ["mem-player-one", "2.00"],
];
const reels = ["2×", "TRY", "1.4×", "—", "3×", "TRY", "1.8×", "—", "5×"];

export function Carbon() {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("order");
  const [cart, setCart] = useState<number[]>([]);
  const [notice, setNotice] = useState("");
  const [spin, setSpin] = useState(false);
  const [result, setResult] = useState("");
  const [selectedDay, setSelectedDay] = useState(18);
  const [month, setMonth] = useState(5);
  const [loggedOut, setLoggedOut] = useState(false);
  const [remaining, setRemaining] = useState(1 * 3600 + 42 * 60 + 18);

  useEffect(() => {
    const timer = window.setInterval(() => setRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const total = cart.reduce((sum, index) => sum + products[index].price, 0);
  const itemCount = cart.length;
  const countdown = [Math.floor(remaining / 3600), Math.floor((remaining % 3600) / 60), remaining % 60]
    .map((part) => String(part).padStart(2, "0")).join(":");
  const monthName = new Date(2025, month, 1).toLocaleString("en", { month: "long" });
  const spinReel = () => {
    if (spin) return;
    setSpin(true);
    setResult("");
    window.setTimeout(() => {
      setSpin(false);
      setResult("Demo preview · no points changed");
    }, 1100);
  };
  const switchTab = (next: Tab) => {
    setTab(next);
    setNotice("");
  };

  return (
    <main className="carbon-scene">
      <div className="carbon-game" aria-hidden="true">
        <div className="carbon-game-light" />
        <div className="carbon-game-silhouette" />
        <div className="carbon-game-caption"><i /> GAME IN PROGRESS <span>·</span> SESSION OVERLAY PREVIEW</div>
      </div>

      {open && (
        <section className="carbon-popover" aria-label={`${tab} tools`}>
          <header className="carbon-pop-head">
            <div className="carbon-heading">
              <span className="carbon-mark">D</span>
              <div><strong>{tab === "order" ? "Quick order" : tab === "games" ? "Betting games" : tab === "attendance" ? "Attendance" : "Monthly ranking"}</strong>
                <small>{tab === "order" ? "A quick break, delivered to your station" : tab === "games" ? "Local preview · outcomes are not real" : tab === "attendance" ? "Your monthly check-in record" : "Member points this month"}</small></div>
            </div>
            <button className="carbon-close" onClick={() => setOpen(false)} aria-label="Close tools">×</button>
          </header>
          <nav className="carbon-tabs" aria-label="Session tools">
            {([
              ["order", "Order"],
              ["games", "Games"],
              ["attendance", "Attendance"],
              ["ranking", "Ranking"],
            ] as [Tab, string][]).map(([key, label]) => (
              <button key={key} className={`carbon-tab ${tab === key ? "is-active" : ""}`} onClick={() => switchTab(key)}>{label}</button>
            ))}
          </nav>

          <div className="carbon-content">
            {tab === "order" && <>
              <div className="carbon-section-line"><span>STATION PICKS</span><span>4 ITEMS</span></div>
              <div className="carbon-products">
                {products.map((product, index) => <article className="carbon-product" key={product.name}>
                  <span className={`carbon-product-mark mark-${index}`}>{product.mark}</span>
                  <div className="carbon-product-info"><strong>{product.name}</strong><small>₱{product.price}.00</small></div>
                  <button className="carbon-add" aria-label={`Add ${product.name}`} onClick={() => setCart((items) => [...items, index])}>+</button>
                </article>)}
              </div>
              <div className="carbon-cart">
                <div className="carbon-cart-copy"><strong>{itemCount ? `${itemCount} in your tray` : "Your tray is clear"}</strong><small>{itemCount ? `₱${total}.00 · local demo only` : "Add a pick to preview a demo order"}</small></div>
                {itemCount > 0 && <button className="carbon-text-button" onClick={() => setCart((items) => items.slice(0, -1))} aria-label="Remove one item">− Remove</button>}
                <button className="carbon-primary" disabled={!itemCount} onClick={() => { setCart([]); setNotice("Demo preview only · nothing submitted"); }}>Review demo</button>
              </div>
            </>}

            {tab === "games" && <>
              <div className="carbon-game-intro"><span>REEL PREVIEW</span><b>22.48 <small>PTS</small></b></div>
              <div className="carbon-disclaimer">Preview only. Real odds are private and every outcome is decided by the server.</div>
              <div className={`carbon-reel ${spin ? "is-spinning" : ""}`}>
                {reels.slice(0, 5).map((reel, i) => <div key={i} className={`carbon-reel-tile ${i === 2 ? "reel-selected" : ""} ${reel === "TRY" ? "reel-muted" : ""}`}>{reel}</div>)}
                <span className="carbon-reel-marker" />
              </div>
              <div className="carbon-game-status">{result || (spin ? "Rolling preview…" : "Practice round · no points at stake")}</div>
              <button className="carbon-spin" onClick={spinReel} disabled={spin}>{spin ? "Rolling…" : "Try a demo spin"} <span>↗</span></button>
            </>}

            {tab === "attendance" && <>
              <div className="carbon-attendance-summary"><div><strong>18 <span>/ 24</span></strong><small>attendances this month</small></div><div className="carbon-progress"><i /></div><span className="carbon-percent">75%</span></div>
              <div className="carbon-calendar-head">
                <button onClick={() => setMonth((m) => Math.max(0, m - 1))} disabled={month <= 0} aria-label="Previous month">‹</button>
                <strong>{monthName} 2025</strong>
                <button onClick={() => setMonth((m) => Math.min(11, m + 1))} disabled={month >= 11} aria-label="Next month">›</button>
              </div>
              <div className="carbon-calendar">
                {["M", "T", "W", "T", "F", "S", "S"].map((day, i) => <span className="calendar-weekday" key={`${day}${i}`}>{day}</span>)}
                {Array.from({ length: 35 }, (_, i) => {
                  const day = i - 5;
                  const valid = day > 0 && day <= 30;
                  return <button key={i} disabled={!valid} onClick={() => setSelectedDay(day)} className={`${!valid ? "is-blank" : ""} ${valid && day <= 18 && day % 3 !== 0 ? "is-checked" : ""} ${selectedDay === day && valid ? "is-selected" : ""}`}>{valid ? day : ""}</button>;
                })}
              </div>
              <div className="carbon-calendar-foot"><span><i /> Checked in</span><span>Selected: {monthName.slice(0, 3)} {selectedDay}</span></div>
            </>}

            {tab === "ranking" && <>
              <div className="carbon-rank-meta"><span>MONTHLY LEADERBOARD</span><span>POINTS</span></div>
              <div className="carbon-rank-list">
                {members.map(([name, points], i) => <div className={`carbon-rank-row ${i === 0 ? "rank-self" : ""}`} key={name}>
                  <span className="carbon-rank-place">{String(i + 1).padStart(2, "0")}</span><strong>{name}{i === 0 && <em>YOU</em>}</strong><span className="carbon-rank-score">{points}</span>
                </div>)}
              </div>
              <div className="carbon-rank-foot">Rank resets in 6 days <span>·</span> Monthly standings</div>
            </>}
          </div>
          {notice && <div className="carbon-toast" role="status">{notice}</div>}
          <footer className="carbon-pop-foot"><span>DENFI SESSION</span><span>LOCAL PREVIEW</span></footer>
        </section>
      )}

      <aside className="carbon-bar" aria-label="Your active session">
        <div className="carbon-bar-main">
          <div className="carbon-bar-top">
            <span className="carbon-session-state"><i /> SESSION ACTIVE</span>
            <span className="carbon-time">{countdown}</span>
          </div>
          <div className="carbon-bar-bottom">
            <strong>mem-carlo</strong><span className="carbon-divider" /><span className="carbon-pc">PC 04</span>
            <div className="carbon-att-mini"><span>Attendance</span><strong>18/24</strong><i><b /></i></div>
          </div>
        </div>
        <div className="carbon-bar-points"><small>POINTS</small><strong>22.48</strong></div>
        <button className={`carbon-tool-toggle ${open ? "toggle-open" : ""}`} onClick={() => setOpen((value) => !value)} aria-label={open ? "Close session tools" : "Open session tools"}>
          <span className="carbon-toggle-icon">{open ? "×" : "⌘"}</span><span>{open ? "Close" : "Tools"}</span>
        </button>
        <button className="carbon-logout" onClick={() => setLoggedOut(true)} aria-label="Preview logout">↗</button>
      </aside>

      {loggedOut && <div className="carbon-confirm" role="dialog" aria-modal="true" aria-labelledby="carbon-confirm-title">
        <div className="carbon-confirm-box"><span className="carbon-confirm-kicker">SESSION CONTROL</span><h2 id="carbon-confirm-title">End this session?</h2><p>This is a preview. Your session will stay active.</p><div><button onClick={() => setLoggedOut(false)}>Keep playing</button><button className="confirm-end" onClick={() => { setLoggedOut(false); setNotice("Logout preview · session unchanged"); setOpen(true); }}>Preview logout</button></div></div>
      </div>}
    </main>
  );
}