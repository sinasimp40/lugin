import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Gamepad2,
  Medal,
  Minus,
  Plus,
  ShoppingBag,
  Sparkles,
  Star,
  X,
  LogOut,
} from "lucide-react";
import "./CommandDeck.css";

type Tool = "order" | "ranking" | "attendance" | "games";

const products = [
  { id: "coke", name: "Coke", price: 35, note: "Chilled · 330 ml", mark: "COLA", tone: "red" },
  { id: "water", name: "Bottled water", price: 20, note: "Cold · 500 ml", mark: "PURE", tone: "blue" },
  { id: "noodles", name: "Cup noodles", price: 45, note: "Chicken · hot water", mark: "HOT", tone: "yellow" },
  { id: "chips", name: "Potato chips", price: 30, note: "Sea salt · 60 g", mark: "CRISP", tone: "green" },
  { id: "coffee", name: "Iced coffee", price: 55, note: "House blend · 12 oz", mark: "BREW", tone: "purple" },
  { id: "sandwich", name: "Ham sandwich", price: 65, note: "Toasted on request", mark: "DELI", tone: "orange" },
];

const leaderboard = [
  { name: "mem-carlo", points: 22.48, initials: "C", color: "gold" },
  { name: "mem-alice", points: 11.38, initials: "A", color: "pink" },
  { name: "mem-gina", points: 2.3, initials: "G", color: "teal" },
  { name: "mem-player-one", points: 2, initials: "P", color: "lime" },
  { name: "mem-diana", points: 1.5, initials: "D", color: "blue" },
];

const attendanceDays: Record<number, "done" | "played" | "missed" | "today"> = {
  1: "done", 2: "done", 3: "played", 4: "done", 5: "done", 7: "done",
  8: "missed", 9: "done", 10: "done", 11: "done", 12: "played", 14: "done",
  15: "done", 16: "done", 17: "done", 18: "today",
};

const navItems: { id: Tool; label: string; detail: string; icon: typeof ShoppingBag }[] = [
  { id: "order", label: "Quick order", detail: "Cafe counter", icon: ShoppingBag },
  { id: "ranking", label: "Ranking", detail: "This month", icon: Medal },
  { id: "attendance", label: "Attendance", detail: "18 of 24 days", icon: CalendarDays },
  { id: "games", label: "Betting games", detail: "5 spins left", icon: Gamepad2 },
];

export function CommandDeck() {
  const [active, setActive] = useState<Tool>("order");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<"success" | "error" | "">("");
  const [toastMessage, setToastMessage] = useState("");
  const [timeLeft, setTimeLeft] = useState(1 * 3600 + 42 * 60 + 18);
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(18);
  const [spins, setSpins] = useState(5);
  const [stake, setStake] = useState("2.00");
  const [gameResult, setGameResult] = useState("");
  const [gameError, setGameError] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => setTimeLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const clock = useMemo(() => {
    const h = Math.floor(timeLeft / 3600);
    const m = Math.floor((timeLeft % 3600) / 60);
    const s = timeLeft % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [timeLeft]);
  const cartCount = Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  const cartTotal = products.reduce((sum, product) => sum + (cart[product.id] || 0) * product.price, 0);
  const month = new Date(2026, 5 + monthOffset, 1);
  const monthLabel = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const calendarCells = Array.from({ length: new Date(month.getFullYear(), month.getMonth(), 1).getDay() }, () => 0)
    .concat(Array.from({ length: new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate() }, (_, i) => i + 1));

  const announce = (type: "success" | "error", message?: string) => {
    setToast(type);
    setToastMessage(message || (type === "success" ? "Demo only — nothing was sent." : "Demo action could not be completed."));
    window.setTimeout(() => setToast(""), 3200);
  };

  const add = (id: string, amount: number) =>
    setCart((current) => ({ ...current, [id]: Math.max(0, (current[id] || 0) + amount) }));

  const spinDemo = () => {
    if (isSpinning || spins === 0 || Number(stake) <= 0 || Number(stake) > 12.4) return;
    setGameError(false);
    setGameResult("");
    setIsSpinning(true);
    window.setTimeout(() => {
      setIsSpinning(false);
      setSpins((remaining) => Math.max(0, remaining - 1));
      setGameResult("Illustrative server reply: 2×");
    }, 850);
  };

  return (
    <main className="cd-scene">
      <div className="cd-game-screen" aria-hidden="true">
        <div className="cd-game-top"><span>DENFI INTERNET CAFE</span><span>SESSION HUD / 02</span></div>
        <div className="cd-game-world">
          <div className="cd-horizon" />
          <div className="cd-mountain cd-mountain-a" />
          <div className="cd-mountain cd-mountain-b" />
          <div className="cd-grid-floor" />
          <div className="cd-game-copy"><span>PAUSED AT YOUR DESK</span><strong>Match lobby</strong><small>Overlay stays within reach. Your game stays in view.</small></div>
          <div className="cd-minimap"><i /><i /><i /><b /></div>
        </div>
      </div>
      <div className={`cd-console ${closed ? "cd-console--collapsed" : ""}`}>
        {!closed && (
          <section className="cd-deck">
            <header className="cd-deck-head">
              <div className="cd-brand">
                <span className="cd-brand-glyph"><Gamepad2 size={18} strokeWidth={2.5} /></span>
                <div><b>DENFI <em>PLAY DESK</em></b><small>YOUR SESSION, AT A GLANCE</small></div>
              </div>
              <div className="cd-tool-nav" role="tablist" aria-label="Session tools">
                {navItems.map(({ id, label, icon: Icon }) => (
                  <button key={id} role="tab" aria-selected={active === id} className={`cd-nav-btn ${active === id ? "is-active" : ""}`} onClick={() => setActive(id)}>
                    <Icon size={15} /><span>{label}</span>{active === id && <i />}
                  </button>
                ))}
              </div>
              <button className="cd-close" aria-label="Collapse session deck" onClick={() => setClosed(true)}><X size={17} /></button>
            </header>

            <div className="cd-overview">
              <div className="cd-timer-block">
                <span className="cd-micro-label"><Clock3 size={12} /> TIME REMAINING</span>
                <strong>{clock}</strong>
                <span className="cd-timer-caption"><i /> SESSION ACTIVE <b>·</b> PC 04</span>
              </div>
              <div className="cd-member-block">
                <div className="cd-avatar">C</div>
                <div><span className="cd-micro-label">SIGNED IN AS</span><strong>mem-carlo</strong><small>Station 04 <b>·</b> Member since 2024</small></div>
              </div>
              <div className="cd-points-block"><span className="cd-micro-label"><Sparkles size={12} /> POINTS BALANCE</span><strong>22.48 <small>PTS</small></strong><span className="cd-points-note">Monthly ranking <b>#1</b></span></div>
              <button className="cd-logout" onClick={() => announce("success", "Demo only — logout would return to the lock screen.")}><LogOut size={15} /> Log out</button>
            </div>

            <section className="cd-tool-body" aria-live="polite">
              {active === "order" && (
                <div className="cd-order-view">
                  <div className="cd-section-heading"><div><span className="cd-kicker">THE COUNTER</span><h2>Need a refill?</h2></div><span className="cd-order-hint"><CircleHelp size={13} /> Demo cart only · no order sent</span></div>
                  <div className="cd-product-grid">
                    {products.map((product) => (
                      <article className={`cd-product cd-product--${product.tone}`} key={product.id}>
                        <div className="cd-product-mark">{product.mark}</div><div className="cd-product-info"><b>{product.name}</b><small>{product.note}</small><strong>₱{product.price}</strong></div>
                        <div className="cd-qty">
                          {(cart[product.id] || 0) > 0 && <button aria-label={`Remove one ${product.name}`} onClick={() => add(product.id, -1)}><Minus size={13} /></button>}
                          {(cart[product.id] || 0) > 0 && <b>{cart[product.id]}</b>}
                          <button aria-label={`Add ${product.name}`} onClick={() => add(product.id, 1)}><Plus size={14} /></button>
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="cd-cart-bar">
                    <div className="cd-cart-icon"><ShoppingBag size={16} /><span>{cartCount}</span></div>
                    <div className="cd-cart-caption"><b>{cartCount} {cartCount === 1 ? "item" : "items"}</b><small>{cartCount ? "Ready to review" : "Your tray is empty"}</small></div>
                    <strong className="cd-cart-total">₱{cartTotal}</strong>
                    <button className="cd-clear" onClick={() => setCart({})} disabled={!cartCount}>Clear</button>
                    <button className="cd-order-submit" disabled={!cartCount} onClick={() => { setCart({}); announce("success", "Demo cart only — nothing was sent."); }}>Review demo order <ChevronRight size={15} /></button>
                  </div>
                </div>
              )}

              {active === "ranking" && (
                <div className="cd-ranking-view">
                  <div className="cd-section-heading"><div><span className="cd-kicker">JUNE LADDER · RESETS MONTHLY</span><h2>Earn your seat.</h2></div><div className="cd-rank-your-place"><span>YOUR PLACE</span><b>#01 <small>of 38</small></b></div></div>
                  <div className="cd-leaderboard">
                    {leaderboard.map((player, index) => <div className={`cd-rank-row ${player.name === "mem-carlo" ? "cd-rank-row--you" : ""}`} key={player.name}>
                      <span className={`cd-rank-number ${index < 3 ? "cd-rank-number--top" : ""}`}>{String(index + 1).padStart(2, "0")}</span>
                      <span className={`cd-rank-avatar cd-rank-avatar--${player.color}`}>{player.initials}</span>
                      <span className="cd-rank-name">{player.name}{player.name === "mem-carlo" && <em>YOU</em>}</span>
                      <div className="cd-rank-meter"><i style={{ width: `${Math.max(9, (player.points / 22.48) * 100)}%` }} /></div>
                      <b className="cd-rank-points">{player.points.toFixed(2)} <small>PTS</small></b>
                    </div>)}
                  </div>
                  <div className="cd-rank-foot"><Medal size={14} /> Keep playing to climb the monthly ladder <span>LOCAL DEMO DATA</span></div>
                </div>
              )}

              {active === "attendance" && (
                <div className="cd-attendance-view">
                  <div className="cd-section-heading"><div><span className="cd-kicker">SHOW UP, STACK DAYS</span><h2>Your streak has legs.</h2></div>
                    <div className="cd-month-switch"><button aria-label="Previous month" onClick={() => setMonthOffset((v) => Math.max(-12, v - 1))}><ChevronLeft size={17} /></button><b>{monthLabel}</b><button aria-label="Next month" onClick={() => setMonthOffset((v) => Math.min(0, v + 1))}><ChevronRight size={17} /></button></div>
                  </div>
                  <div className="cd-attendance-content">
                    <div className="cd-calendar">
                      <div className="cd-weekdays">{["S", "M", "T", "W", "T", "F", "S"].map((day, i) => <span key={`${day}${i}`}>{day}</span>)}</div>
                      <div className="cd-days">{calendarCells.map((day, index) => {
                        const status = monthOffset === 0 ? attendanceDays[day] : undefined;
                        return day === 0 ? <span key={`empty${index}`} /> : <button key={day} className={`cd-day ${status ? `cd-day--${status}` : ""} ${selectedDay === day ? "cd-day--selected" : ""}`} aria-label={`Select day ${day}${status ? `, ${status}` : ""}`} onClick={() => setSelectedDay(day)}>{day}{status === "done" && <i />}</button>;
                      })}</div>
                    </div>
                    <div className="cd-attendance-summary">
                      <div className="cd-streak-number"><strong>18</strong><span>/ 24 DAYS</span></div>
                      <div className="cd-progress-track"><i style={{ width: "75%" }} /></div>
                      <b className="cd-next-reward"><Star size={14} /> 6 more visits to next reward</b>
                      <div className="cd-day-detail"><span>SELECTED DAY</span><strong>{month.toLocaleDateString("en-US", { month: "short" })} {selectedDay}</strong><small>{selectedDay === 18 && monthOffset === 0 ? "Today · Session in progress" : (monthOffset === 0 && attendanceDays[selectedDay]) ? `${attendanceDays[selectedDay] === "done" ? "Attendance complete" : attendanceDays[selectedDay] === "played" ? "Attended · mission unfinished" : attendanceDays[selectedDay]}` : "No attendance recorded"}</small></div>
                    </div>
                  </div>
                  <div className="cd-attendance-legend"><span><i className="done" />Completed</span><span><i className="played" />Attended</span><span><i className="missed" />Missed</span><span><i className="future" />No record</span><small>DEMO ATTENDANCE</small></div>
                </div>
              )}

              {active === "games" && (
                <div className="cd-games-view">
                  <div className="cd-game-intro"><span className="cd-kicker">DENFI POINTS · VISUAL REEL</span><h2>One spin. <em>Your call.</em></h2><p>Result is decided by the server. Tiles are decoration, not odds.</p></div>
                  <div className="cd-game-table">
                    <div className={`cd-reel ${isSpinning ? "cd-reel--spinning" : ""}`} aria-label="Visual-only reel; not a representation of odds">
                      <div className="cd-reel-pointer" />
                      <div className="cd-reel-track">{["2×", "5×", "1×", "3×", "2×", "10×", "1×", "5×"].map((tile, index) => <span key={index} className={`cd-reel-tile cd-reel-tile--${index % 4}`}>{tile}</span>)}</div>
                      <div className="cd-reel-center"><span>DENFI</span><b>PLAY</b></div>
                    </div>
                    <div className="cd-game-controls">
                      <div className="cd-balance-line"><span>POINTS AVAILABLE</span><b>22.48 <small>PTS</small></b></div>
                      <label className="cd-stake-label" htmlFor="cd-stake">DEMO STAKE <span>NO POINTS SPENT</span></label>
                      <div className="cd-stake-control"><button onClick={() => setStake((v) => Math.max(0.5, Number(v) - 0.5).toFixed(2))} aria-label="Lower demo stake"><Minus size={14} /></button><input id="cd-stake" type="number" min="0.5" max="12.4" step="0.5" value={stake} onChange={(e) => setStake(e.target.value)} /><span>PTS</span><button onClick={() => setStake((v) => Math.min(12.4, Number(v) + 0.5).toFixed(2))} aria-label="Raise demo stake"><Plus size={14} /></button></div>
                      <div className="cd-spins-left"><span>DEMO SPINS LEFT</span><b>{spins} <i>{Array.from({ length: 5 }, (_, i) => <span key={i} className={i < spins ? "on" : ""} />)}</i></b></div>
                      <button className="cd-spin-button" onClick={spinDemo} disabled={isSpinning || spins === 0 || Number(stake) <= 0 || Number(stake) > 12.4}>{isSpinning ? "Reading demo response…" : "Preview a demo spin"} <ChevronRight size={16} /></button>
                      <div className={`cd-result ${gameError ? "cd-result--error" : gameResult ? "cd-result--success" : ""}`} role="status">{gameError ? <><X size={14} /> Demo timeout · no result confirmed</> : gameResult ? <><Check size={14} /> {gameResult} · no balance change</> : <>Result will appear here</>}</div>
                    </div>
                  </div>
                  <div className="cd-game-disclaimer"><span><i />VISUAL ONLY</span><span>PRIVATE ODDS · NOT SHOWN</span><span>SERVER-DECIDED RESULT</span><button onClick={() => { setGameError(true); setGameResult(""); }}>Simulate error</button></div>
                </div>
              )}
            </section>
          {toast && <div className={`cd-toast cd-toast--${toast}`} role="status"><span>{toast === "success" ? <Check size={14} /> : <X size={14} />}</span>{toastMessage}<button aria-label="Dismiss notification" onClick={() => setToast("")}><X size={13} /></button></div>}
          </section>
        )}
        <footer className="cd-status-rail">
          <div className="cd-rail-logo"><span><Gamepad2 size={16} /></span><b>DENFI</b><small>SESSION</small></div>
          <div className="cd-rail-member"><i /> <b>mem-carlo</b><span>PC 04</span></div>
          <div className="cd-rail-time"><Clock3 size={15} /><span>{clock}</span><small>REMAINING</small></div>
          <div className="cd-rail-points"><Sparkles size={15} /><span>22.48</span><small>POINTS</small></div>
          <div className="cd-rail-attendance"><span>ATTENDANCE</span><div><i style={{ width: "75%" }} /></div><b>18/24</b></div>
          <div className="cd-rail-tools">{navItems.map(({ id, label, icon: Icon }) => <button key={id} aria-label={label} title={label} className={active === id ? "is-active" : ""} onClick={() => { setActive(id); setClosed(false); }}><Icon size={17} /></button>)}</div>
          <button className="cd-rail-logout" onClick={() => announce("success", "Demo only — logout would return to the lock screen.")} aria-label="Log out"><LogOut size={15} /><span>LOG OUT</span></button>
          {closed && <button className="cd-expand" onClick={() => setClosed(false)}>Open play desk <ChevronRight size={14} /></button>}
        </footer>
      </div>
    </main>
  );
}