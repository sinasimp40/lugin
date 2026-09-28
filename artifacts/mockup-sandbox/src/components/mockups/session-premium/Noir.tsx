import { useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Crown,
  Gamepad2,
  LogOut,
  Minus,
  Plus,
  ShoppingBag,
  Trophy,
  X,
} from "lucide-react";
import "./Noir.css";

type Tool = "games" | "order" | "attendance" | "ranking";

const products = [
  { name: "Coke", price: 35, mark: "C" },
  { name: "Water", price: 20, mark: "W" },
  { name: "Noodles", price: 45, mark: "N" },
  { name: "Chips", price: 30, mark: "S" },
];

const members = [
  ["mem-carlo", "22.48"],
  ["mem-alice", "11.38"],
  ["mem-gina", "2.30"],
  ["mem-player-one", "2.00"],
];

const monthNames = ["June", "July", "August", "September", "October"];

export function Noir() {
  const [open, setOpen] = useState(true);
  const [tool, setTool] = useState<Tool>("games");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState("");
  const [spinning, setSpinning] = useState(false);
  const [monthIndex, setMonthIndex] = useState(2);
  const [selectedDay, setSelectedDay] = useState(18);
  const [logoutConfirm, setLogoutConfirm] = useState(false);

  const cartCount = Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  const cartTotal = products.reduce((sum, product) => sum + product.price * (cart[product.name] || 0), 0);

  const selectTool = (nextTool: Tool) => {
    setTool(nextTool);
    setNotice("");
    setLogoutConfirm(false);
    setOpen(true);
  };

  const changeQty = (name: string, delta: number) => {
    setCart((current) => {
      const nextQty = Math.max(0, (current[name] || 0) + delta);
      return { ...current, [name]: nextQty };
    });
    setNotice("");
  };

  const playDemo = () => {
    if (spinning) return;
    setSpinning(true);
    setNotice("");
    window.setTimeout(() => {
      setSpinning(false);
      setNotice("Preview only — no points or rewards were used.");
    }, 1050);
  };

  return (
    <main className="noirRoot">
      <div className="noirAtmosphere" aria-hidden="true">
        <div className="noirRoomLight" />
        <div className="noirShadowShape" />
        <div className="noirCornerFade" />
      </div>
      <div className="noirSceneCaption" aria-hidden="true">
        <span className="sceneDot" />
        <span>GAME IN SESSION</span>
      </div>

      {open && (
        <section className="noirPopup" aria-label="Session tools">
          <header className="popupHeader">
            <div className="popupIdentity">
              <span className="brandSeal"><span>D</span></span>
              <div>
                <div className="popupEyebrow">DENFI · PLAYER DESK</div>
                <h1>{tool === "games" ? "Betting Games" : tool === "order" ? "Quick Order" : tool === "attendance" ? "Attendance" : "Monthly ranking"}</h1>
              </div>
            </div>
            <button className="iconButton closeButton" aria-label="Close tools" onClick={() => setOpen(false)}>
              <X size={16} strokeWidth={1.8} />
            </button>
          </header>

          <nav className="toolNav" aria-label="Session tools">
            <button className={tool === "games" ? "toolTab isActive" : "toolTab"} onClick={() => selectTool("games")} aria-pressed={tool === "games"}>
              <Gamepad2 size={14} /><span>Games</span>
            </button>
            <button className={tool === "order" ? "toolTab isActive" : "toolTab"} onClick={() => selectTool("order")} aria-pressed={tool === "order"}>
              <ShoppingBag size={14} /><span>Order</span>{cartCount > 0 && <i className="cartCount">{cartCount}</i>}
            </button>
            <button className={tool === "attendance" ? "toolTab isActive" : "toolTab"} onClick={() => selectTool("attendance")} aria-pressed={tool === "attendance"}>
              <CalendarDays size={14} /><span>Attendance</span>
            </button>
            <button className={tool === "ranking" ? "toolTab isActive" : "toolTab"} onClick={() => selectTool("ranking")} aria-pressed={tool === "ranking"}>
              <Trophy size={14} /><span>Ranking</span>
            </button>
          </nav>

          <div className="popupContent">
            {tool === "games" && (
              <div className="gamesContent">
                <div className="gameBalanceRow">
                  <div>
                    <span className="sectionEyebrow">AVAILABLE POINTS</span>
                    <strong className="balanceValue">22.48 <small>pts</small></strong>
                  </div>
                  <span className="demoPill"><span /> LOCAL PREVIEW</span>
                </div>
                <div className="honestyNote">
                  <CircleHelp size={14} />
                  <span>Practice view only. Real odds are private; all outcomes are decided by the server.</span>
                </div>
                <div className={`reelWindow ${spinning ? "isSpinning" : ""}`} aria-label="Demo reel">
                  <div className="reelMarker" />
                  <div className="reelTrack">
                    <div className="reelTile"><span>×2</span><small>DOUBLE</small></div>
                    <div className="reelTile reelTileMuted"><span>—</span><small>TRY AGAIN</small></div>
                    <div className="reelTile reelTileActive"><span>×3</span><small>PREVIEW</small></div>
                    <div className="reelTile"><span>×2</span><small>DOUBLE</small></div>
                    <div className="reelTile reelTileMuted"><span>—</span><small>TRY AGAIN</small></div>
                  </div>
                </div>
                <div className="reelLabelRow">
                  <span>DEMO REEL</span><span>NO POINTS AT RISK</span>
                </div>
                <button className="primaryAction spinAction" onClick={playDemo} disabled={spinning}>
                  {spinning ? <><span className="buttonPulse" /> Previewing…</> : "Try a local preview"}
                  {!spinning && <ChevronRight size={16} />}
                </button>
                <div className={`inlineNotice ${notice ? "noticeVisible" : ""}`} aria-live="polite">{notice || " "}</div>
              </div>
            )}

            {tool === "order" && (
              <div className="orderContent">
                <div className="contentIntro">
                  <div><span className="sectionEyebrow">AT YOUR STATION</span><p>Something for the next round.</p></div>
                  <span className="sampleBadge">SAMPLE MENU</span>
                </div>
                <div className="productList">
                  {products.map((product) => {
                    const qty = cart[product.name] || 0;
                    return (
                      <div className="productRow" key={product.name}>
                        <div className="productMark">{product.mark}</div>
                        <div className="productInfo"><strong>{product.name}</strong><span>₱{product.price}</span></div>
                        {qty ? (
                          <div className="qtyControl">
                            <button onClick={() => changeQty(product.name, -1)} aria-label={`Remove one ${product.name}`}><Minus size={13} /></button>
                            <span>{qty}</span>
                            <button onClick={() => changeQty(product.name, 1)} aria-label={`Add one ${product.name}`}><Plus size={13} /></button>
                          </div>
                        ) : (
                          <button className="addProduct" onClick={() => changeQty(product.name, 1)} aria-label={`Add ${product.name}`}>
                            <Plus size={15} /><span>Add</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="cartCheckout">
                  <div className="cartTotal"><span>{cartCount} {cartCount === 1 ? "item" : "items"} · preview cart</span><strong>₱{cartTotal}</strong></div>
                  <button className="primaryAction orderAction" disabled={!cartCount} onClick={() => setNotice("Order preview saved locally — nothing was submitted.")}>Review</button>
                </div>
                <div className="inlineNotice" aria-live="polite">{notice || " "}</div>
              </div>
            )}

            {tool === "attendance" && (
              <div className="attendanceContent">
                <div className="attendanceSummary">
                  <div><span className="sectionEyebrow">THIS MONTH</span><strong>18 <small>/ 24 days</small></strong></div>
                  <div className="progressRing" aria-label="75 percent complete"><span>75%</span></div>
                </div>
                <div className="attendanceProgress"><span /></div>
                <div className="calendarHeading">
                  <strong>{monthNames[monthIndex]} 2025</strong>
                  <div className="monthControls">
                    <button onClick={() => setMonthIndex(Math.max(0, monthIndex - 1))} disabled={monthIndex === 0} aria-label="Previous month"><ChevronLeft size={16} /></button>
                    <button onClick={() => setMonthIndex(Math.min(monthNames.length - 1, monthIndex + 1))} disabled={monthIndex === monthNames.length - 1} aria-label="Next month"><ChevronRight size={16} /></button>
                  </div>
                </div>
                <div className="calendarGrid" role="grid" aria-label={`${monthNames[monthIndex]} attendance calendar`}>
                  {["M", "T", "W", "T", "F", "S", "S"].map((day, i) => <span className="calendarWeekday" key={`${day}${i}`}>{day}</span>)}
                  {Array.from({ length: 35 }, (_, index) => {
                    const day = index - 1;
                    const inMonth = day >= 1 && day <= 30;
                    const attended = inMonth && day <= 18 && day % 7 !== 0;
                    return <button key={index} className={`calendarDay ${!inMonth ? "dayOutside" : ""} ${attended ? "dayAttended" : ""} ${selectedDay === day ? "daySelected" : ""}`} disabled={!inMonth} onClick={() => setSelectedDay(day)}>{inMonth ? day : ""}</button>;
                  })}
                </div>
                <div className="calendarFoot"><span><i /> Attended</span><span>{selectedDay} {monthNames[monthIndex]} selected</span></div>
              </div>
            )}

            {tool === "ranking" && (
              <div className="rankingContent">
                <div className="rankingIntro">
                  <div><span className="sectionEyebrow">MONTHLY POINTS</span><p>Quietly climbing.</p></div>
                  <span className="monthTag">AUG ’25</span>
                </div>
                <div className="rankingList">
                  {members.map(([name, points], index) => (
                    <div className={`rankingRow ${index === 0 ? "rankingCurrent" : ""}`} key={name}>
                      <span className={`rankNumber ${index === 0 ? "rankLead" : ""}`}>{String(index + 1).padStart(2, "0")}</span>
                      <div className="memberMonogram">{name.slice(4, 5).toUpperCase()}</div>
                      <span className="memberName">{name}{index === 0 && <i className="youMarker">YOU</i>}</span>
                      <strong className="rankPoints">{points}<small> pts</small></strong>
                    </div>
                  ))}
                </div>
                <div className="rankingNote"><Crown size={13} /><span>Monthly standings · updated at session end</span></div>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="sessionDock" aria-label="Your session">
        <div className="dockAccent" />
        <div className="dockIdentity">
          <div className="avatarSeal">C</div>
          <div className="dockMember"><strong>mem-carlo</strong><span>PC 04 <b>·</b> ACTIVE</span></div>
        </div>
        <div className="dockMetrics">
          <div className="dockTime"><Clock3 size={13} /><strong>01:42:18</strong><span>SESSION</span></div>
          <div className="dockPoints"><strong>22.48</strong><span>PTS</span></div>
        </div>
        <div className="dockAttendance" title="18 of 24 attendance days">
          <div className="attendanceLabel"><span>ATTENDANCE</span><strong>18<span>/24</span></strong></div>
          <div className="attendanceMiniTrack"><i /></div>
        </div>
        <div className="dockActions">
          <button className={`dockToolButton ${open ? "dockOpen" : ""}`} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={open ? "Close session tools" : "Open session tools"}>
            <span className="toolButtonMark"><Gamepad2 size={16} /></span><span>Tools</span>
          </button>
          <button className="dockLogout" onClick={() => { setTool("games"); setOpen(true); setLogoutConfirm(true); }} aria-label="Log out preview">
            <LogOut size={15} />
          </button>
        </div>
      </section>

      {logoutConfirm && open && (
        <div className="logoutPopover" role="dialog" aria-label="Logout preview">
          <button className="popoverClose" onClick={() => setLogoutConfirm(false)} aria-label="Cancel logout"><X size={14} /></button>
          <span className="sectionEyebrow">END SESSION?</span>
          <p>Logout is a preview only. Your session will stay active.</p>
          <button className="cancelLogout" onClick={() => setLogoutConfirm(false)}>Keep playing</button>
        </div>
      )}
    </main>
  );
}