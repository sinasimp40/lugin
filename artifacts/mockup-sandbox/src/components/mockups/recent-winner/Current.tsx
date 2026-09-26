import './_group.css';

export function Current() {
  return <div className="winner-stage">
    <div className="winner-caption">CURRENT / SESSION POPUP</div>
    <div className="winner-drawer">
      <header className="winner-head"><div className="winner-title">WINNER</div><button className="winner-close" aria-label="Close">×</button></header>
      <div className="winner-body"><div className="winner-panel" role="status">
        <div className="winner-user">mem-diana</div>
        <div className="winner-result"><strong>2×</strong><span>MULTIPLIER</span></div>
      </div></div>
    </div>
    <div className="winner-strip"><strong>86.50</strong><small>01:27:58 · mem-player-one · PC 09</small><nav><span>ORDER</span><span>RANKING</span></nav></div>
  </div>;
}