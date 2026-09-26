import './_group.css';

export function Refined() {
  return <div className="winner-stage">
    <div className="winner-caption">REFINED / SESSION POPUP</div>
    <div className="winner-drawer refined">
      <header className="winner-head"><div className="winner-title">LATEST WIN</div><button className="winner-close" aria-label="Close">×</button></header>
      <div className="winner-body"><div className="winner-panel" role="status">
        <div className="winner-crest" aria-hidden="true"><span>✦</span></div>
        <div className="winner-user-group"><span className="winner-eyebrow">MEMBER WINNER</span><div className="winner-user">mem-diana</div></div>
        <div className="winner-result"><strong>2×</strong><span>MULTIPLIER</span></div>
      </div></div>
    </div>
    <div className="winner-strip"><strong>86.50</strong><small>01:27:58 · mem-player-one · PC 09</small><nav><span>ORDER</span><span>RANKING</span></nav></div>
  </div>;
}