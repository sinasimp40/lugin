import { useEffect, useMemo, useState } from "react";
import "./Club.css";

type ToolTab = "attendance" | "order" | "games" | "ranking";

const products = [
  { name: "Coke", price: 35, mark: "C" },
  { name: "Water", price: 20, mark: "W" },
  { name: "Noodles", price: 45, mark: "N" },
  { name: "Chips", price: 30, mark: "S" },
];
const members = [
  { name: "mem-carlo", points: "22.48" },
  { name: "mem-alice", points: "11.38" },
  { name: "mem-gina", points: "2.30" },
  { name: "mem-player-one", points: "2.00" },
];
const tabList: { id: ToolTab; label: string; icon: string }[] = [
  { id: "attendance", label: "Attendance", icon: "◷" },
  { id: "order", label: "Quick Order", icon: "＋" },
  { id: "games", label: "Games", icon: "◇" },
  { id: "ranking", label: "Ranking", icon: "♙" },
];
const attendedDays = new Set([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 20, 21]);

function makeCalendar(year: number, month: number) {
  const first = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysPrev = new Date(year, month, 0).getDate();
  return Array.from({ length: 35 }, (_, idx) => {
    const n = idx - first + 1;
    if (n < 1) return { day: daysPrev + n, other: true };
    if (n > daysInMonth) return { day: n - daysInMonth, other: true };
    return { day: n, other: false };
  });
}

export function Club() {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<ToolTab>(() =>
    new URLSearchParams(window.location.search).get("tab") === "attendance" ? "attendance" : "ranking",
  );
  const [cart, setCart] = useState<Record<string, number>>({});
  const [orderNote, setOrderNote] = useState("");
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutDone, setLogoutDone] = useState(false);
  const [selectedDay, setSelectedDay] = useState(18);
  const [month, setMonth] = useState(8);
  const [year, setYear] = useState(2026);
  const [elapsed, setElapsed] = useState(1 * 3600 + 42 * 60 + 18);
  const [spinning, setSpinning] = useState(false);
  const [spinResult, setSpinResult] = useState("");

  useEffect(() => {
    const interval = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const time = useMemo(() => {
    const h = Math.floor(elapsed / 3600).toString().padStart(2, "0");
    const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, "0");
    const s = (elapsed % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  }, [elapsed]);

  const totalItems = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  const cartTotal = products.reduce((sum, product) => sum + product.price * (cart[product.name] || 0), 0);
  const calendarDays = useMemo(() => makeCalendar(year, month), [year, month]);
  const monthLabel = new Date(year, month, 1).toLocaleDateString("en", { month: "long", year: "numeric" });

  const shiftMonth = (delta: number) => {
    const date = new Date(year, month + delta, 1);
    setYear(date.getFullYear());
    setMonth(date.getMonth());
    setSelectedDay(1);
  };
  const addItem = (name: string) => {
    setOrderNote("");
    setCart((current) => ({ ...current, [name]: (current[name] || 0) + 1 }));
  };
  const removeItem = (name: string) => {
    setOrderNote("");
    setCart((current) => {
      const next = { ...current };
      if ((next[name] || 0) <= 1) delete next[name];
      else next[name] -= 1;
      return next;
    });
  };
  const placeDemoOrder = () => {
    if (!totalItems) return;
    setOrderNote(`Demo order noted · ${totalItems} item${totalItems === 1 ? "" : "s"} · ₱${cartTotal}`);
    setCart({});
  };
  const spinDemo = () => {
    if (spinning) return;
    setSpinning(true);
    setSpinResult("");
    window.setTimeout(() => {
      const outcome = ["Practice round: no points changed.", "Demo landed on 2×. Preview only.", "Demo landed on Try again. Preview only."][
        Math.floor(Math.random() * 3)
      ];
      setSpinResult(outcome);
      setSpinning(false);
    }, 900);
  };

  return (
    <main className="club-session">
      <div className="club-world" aria-hidden="true">
        <div className="club-haze" />
        <div className="club-context">
          LIVE PLAY <span>GAME WINDOW · IMMERSIVE MODE</span>
        </div>
      </div>

      <section className="club-overlay" aria-label="Denfi session controls">
        {open && (
          <section className="club-popup" aria-label="Session tools">
            <header className="club-pop-head">
              <div className="club-head-left">
                <div className="club-crest" aria-hidden="true">D</div>
                <div>
                  <div className="club-head-title">Denfi Club</div>
                  <div className="club-head-sub">Your session, just off-screen</div>
                </div>
              </div>
              <button className="club-close" onClick={() => setOpen(false)} aria-label="Close tools" title="Close">×</button>
            </header>
            <nav className="club-tabs" aria-label="Session tools">
              {tabList.map((item) => (
                <button
                  className={`club-tab${tab === item.id ? " active" : ""}`}
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  aria-pressed={tab === item.id}
                >
                  <span className="club-tab-icon" aria-hidden="true">{item.icon}</span>{item.label}
                </button>
              ))}
            </nav>
            <div className="club-scroll">
              {tab === "attendance" && (
                <section className="club-attendance" aria-label="Attendance">
                  <h2 className="club-section-title">A good month in the making.</h2>
                  <p className="club-section-note">Your visits add up. Keep your streak going.</p>
                  <div className="club-progress-head">
                    <div className="club-progress-count">18<small> / 24 visits</small></div>
                    <div className="club-progress-hint">6 more to monthly goal</div>
                  </div>
                  <div className="club-progress-track" aria-label="18 of 24 visits">
                    <div className="club-progress-fill" />
                  </div>
                  <div className="club-calendar">
                    <div className="club-month">
                      <strong>{monthLabel}</strong>
                      <div className="club-month-nav">
                        <button onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
                        <button onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
                      </div>
                    </div>
                    <div className="club-week" aria-hidden="true">
                      {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
                    </div>
                    <div className="club-days">
                      {calendarDays.map((date, index) => {
                        const attended = !date.other && month === 8 && year === 2026 && attendedDays.has(date.day);
                        const isSelected = !date.other && date.day === selectedDay;
                        return (
                          <button
                            key={`${index}-${date.day}`}
                            className={`club-date${date.other ? " other" : ""}${attended ? " attended" : ""}${isSelected ? " selected" : ""}${!date.other && date.day === 18 && month === 8 && year === 2026 ? " today" : ""}`}
                            onClick={() => !date.other && setSelectedDay(date.day)}
                            disabled={date.other}
                            aria-label={`${monthLabel} ${date.day}${attended ? ", attended" : ""}`}
                            aria-pressed={isSelected}
                          >
                            {date.day}
                          </button>
                        );
                      })}
                    </div>
                    <div className="club-calendar-foot">
                      <span className="club-key"><i /> Attended</span>
                      <span>Selected: {monthLabel.split(" ")[0]} {selectedDay}</span>
                    </div>
                  </div>
                </section>
              )}

              {tab === "order" && (
                <section aria-label="Quick Order">
                  <h2 className="club-section-title">A little refuel?</h2>
                  <p className="club-section-note">Add something to your session. Nothing is charged in this preview.</p>
                  <div className="club-products">
                    {products.map((product) => (
                      <div className="club-product" key={product.name}>
                        <div className="club-product-mark" aria-hidden="true">{product.mark}</div>
                        <div className="club-product-name">{product.name}<span className="club-product-price">₱{product.price}</span></div>
                        {cart[product.name] ? (
                          <>
                            <button className="club-step" onClick={() => removeItem(product.name)} aria-label={`Remove one ${product.name}`}>−</button>
                            <span style={{ minWidth: 14, textAlign: "center", fontSize: 11 }}>{cart[product.name]}</span>
                          </>
                        ) : null}
                        <button className="club-step" onClick={() => addItem(product.name)} aria-label={`Add ${product.name}`}>+</button>
                      </div>
                    ))}
                  </div>
                  <div className="club-cart">
                    <div><div className="club-cart-label">{totalItems} {totalItems === 1 ? "item" : "items"} in your tray</div><div className="club-cart-total">₱{cartTotal}</div></div>
                    <div className="club-cart-actions">
                      {totalItems > 0 && <button className="club-clear" onClick={() => { setCart({}); setOrderNote(""); }}>Clear</button>}
                      <button className="club-button" onClick={placeDemoOrder} disabled={!totalItems}>Review order</button>
                    </div>
                  </div>
                  {orderNote && <div className="club-inline-status" role="status">{orderNote} · No order sent.</div>}
                </section>
              )}

              {tab === "games" && (
                <section aria-label="Betting Games">
                  <h2 className="club-section-title">A quick side game</h2>
                  <p className="club-section-note">A local preview for fun while your game loads.</p>
                  <div className="club-demo-line">
                    <div className="club-demo-label"><strong>Practice reel</strong>Demo balance · no value</div>
                    <div style={{ color: "#e1e5b0", font: '600 12px "Space Mono", monospace' }}>22.48 pts</div>
                  </div>
                  <div className="club-reel" aria-label="Demo reel">
                    <div className="club-reel-cell">{spinning ? "· · ·" : "1×"}</div>
                    <div className="club-reel-cell">{spinning ? "· · ·" : "2×"}</div>
                    <div className="club-reel-cell">{spinning ? "· · ·" : "3×"}</div>
                  </div>
                  <div className="club-demo-result" role="status">{spinResult}</div>
                  <button className="club-button" style={{ width: "100%" }} onClick={spinDemo} disabled={spinning}>
                    {spinning ? "Playing preview…" : "Try a demo spin"}
                  </button>
                  <div className="club-disclaimer">Entertainment preview only. Real odds are private, and all real outcomes are decided by the server. This button never uses points.</div>
                </section>
              )}

              {tab === "ranking" && (
                <section aria-label="Monthly ranking">
                  <h2 className="club-section-title">The regulars</h2>
                  <p className="club-section-note">Monthly points · Top members this month</p>
                  <div className="club-ranking">
                    {members.map((member, index) => (
                      <div className={`club-rank${index === 0 ? " me" : ""}`} key={member.name}>
                        <div className="club-rank-no">{String(index + 1).padStart(2, "0")}</div>
                        <div className="club-rank-name">{member.name}{index === 0 ? " · you" : ""}</div>
                        <div className="club-rank-points">{member.points}<small>points</small></div>
                      </div>
                    ))}
                  </div>
                  <p className="club-honesty">A little friendly competition. Rankings refresh with the club’s monthly tally.</p>
                </section>
              )}
            </div>
          </section>
        )}

        {logoutOpen && (
          <div className="club-logout-preview" role="dialog" aria-label="End session preview">
            <strong>{logoutDone ? "Session ended in preview" : "Ready to call it a night?"}</strong>
            <p>{logoutDone ? "No account or real session was changed." : "This is only a local preview. Your real session will not be affected."}</p>
            <div className="club-logout-buttons">
              <button onClick={() => setLogoutOpen(false)}>Keep playing</button>
              {!logoutDone && <button onClick={() => setLogoutDone(true)}>Preview logout</button>}
              {logoutDone && <button onClick={() => { setLogoutOpen(false); setLogoutDone(false); }}>Done</button>}
            </div>
          </div>
        )}
        <div className="club-bar">
          <div className="club-bar-mark" aria-hidden="true">D</div>
          <div className="club-bar-user">
            <div className="club-bar-name">{logoutDone ? "Session preview ended" : "mem-carlo"}</div>
            <div className="club-bar-meta">PC 04 <span aria-hidden="true">·</span> <b>22.48 pts</b></div>
          </div>
          <div className="club-bar-session">
            <div className="club-time">{time}</div>
            <div className="club-time-label">SESSION TIME</div>
          </div>
          <div className="club-bar-progress" title="18 of 24 attendance visits">
            <div className="club-progress-mini"><i /></div>
            <small>18 / 24</small>
          </div>
          <button className="club-logout" onClick={() => { setLogoutOpen((value) => !value); setLogoutDone(false); }}>Log out</button>
          <button className="club-open" onClick={() => setOpen((value) => !value)} aria-label={open ? "Close Denfi Club tools" : "Open Denfi Club tools"} title={open ? "Close tools" : "Open tools"}>
            {open ? "⌄" : "D"}
          </button>
        </div>
      </section>
    </main>
  );
}