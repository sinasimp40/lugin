import { useState } from 'react';
import { LogOut, ShoppingBag, Trophy } from 'lucide-react';
import './_group.css';

export function PlayerCard() {
  const [selected, setSelected] = useState('');
  const [toast, setToast] = useState(false);
  const act = (name: string) => setSelected(selected === name ? '' : name);
  return <div className="sb-root">
    <div className="sb-hint">Hypothesis 02 / <b>player card</b></div>
    <div className="sb-bar" style={{ height: 62, borderColor: 'rgba(255,176,61,.55)' }} aria-label="Player card session overlay">
      <div style={{ width: 145, height: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '0 11px', borderRight: '1px solid rgba(255,140,0,.23)', background: 'linear-gradient(120deg,rgba(255,140,0,.14),transparent)' }}>
        <div style={{ width: 27, height: 27, display: 'grid', placeItems: 'center', border: '1px solid #ff9d28', color: '#ffb13d', font: '11px OrbitronLocal,monospace' }}>MP</div>
        <div style={{ minWidth: 0 }}><div className="sb-user" style={{ color: '#f6dfbf', fontSize: 9, maxWidth: 92 }}>mem-player-one</div><div className="sb-pc" style={{ marginTop: 4 }}>PC-07 / ACTIVE</div><div style={{ color: '#ffd740', font: '700 9px OrbitronLocal,monospace', marginTop: 4 }}>86.50 <span style={{ fontSize: 6, color: '#a78a57' }}>PTS</span></div></div>
      </div>
      <div style={{ padding: '0 12px', minWidth: 108 }}><div style={{ color: '#8e6942', font: '7px OrbitronLocal,monospace', letterSpacing: 1.2, marginBottom: 5 }}>REMAINING</div><div className="sb-time" style={{ fontSize: 17 }}>01:27:07</div></div>
      <div className="sb-actions" style={{ marginLeft: 'auto' }}>
        <button className={`sb-btn sb-quick ${selected === 'order' ? 'active' : ''}`} onClick={() => act('order')}><ShoppingBag size={10} className="sb-icon"/>ORDER</button>
        <button className={`sb-btn sb-quick ${selected === 'top' ? 'active' : ''}`} onClick={() => act('top')}><Trophy size={10} className="sb-icon"/>TOP 5</button>
        <button className="sb-btn sb-logout" onClick={() => { setToast(true); window.setTimeout(() => setToast(false), 1600); }}><LogOut size={9} className="sb-icon"/>LOGOUT</button>
      </div>
    </div>
    {toast && <div className="sb-toast">LOGOUT CONFIRMED</div>}
  </div>;
}
export default PlayerCard;