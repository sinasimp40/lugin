import { useState } from 'react';
import { LogOut, ShoppingBag, Trophy } from 'lucide-react';
import './_group.css';

export function CompactDock() {
  const [selected, setSelected] = useState('');
  const [toast, setToast] = useState(false);
  const act = (name: string) => setSelected(selected === name ? '' : name);
  return <div className="sb-root">
    <div className="sb-hint">Hypothesis 03 / <b>compact dock</b></div>
    <div className="sb-bar" style={{ height: 60, width: 430, borderRadius: 8, border: '1px solid rgba(255,140,0,.45)' }} aria-label="Compact dock session overlay">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, padding: '0 12px' }}>
        <div style={{ width: 4, height: 34, background: '#ff8c00', boxShadow: '0 0 8px rgba(255,140,0,.5)' }} />
        <div style={{ minWidth: 0 }}><div className="sb-time" style={{ fontSize: 16 }}>01:27:07</div><div className="sb-userline" style={{ marginTop: 5 }}><i className="sb-dot" /><span className="sb-user" style={{ color: '#f0d6ac', fontSize: 9 }}>mem-player-one</span><span className="sb-pc">/ PC-07</span></div></div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}><div style={{ color: '#8e6942', font: '6px OrbitronLocal,monospace', letterSpacing: 1 }}>POINTS</div><div style={{ color: '#ffd740', font: '900 14px OrbitronLocal,monospace', marginTop: 3 }}>86.50</div></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: 4, marginRight: 5, border: '1px solid rgba(255,140,0,.18)', background: 'rgba(255,140,0,.045)' }}>
        <button className={`sb-btn sb-quick ${selected === 'order' ? 'active' : ''}`} onClick={() => act('order')}><ShoppingBag size={10} className="sb-icon"/>ORDER</button>
        <button className={`sb-btn sb-quick ${selected === 'top' ? 'active' : ''}`} onClick={() => act('top')}><Trophy size={10} className="sb-icon"/>TOP 5</button>
        <button className="sb-btn sb-logout" onClick={() => { setToast(true); window.setTimeout(() => setToast(false), 1600); }} aria-label="Logout"><LogOut size={11}/></button>
      </div>
    </div>
    {toast && <div className="sb-toast">SESSION CLOSED</div>}
  </div>;
}
export default CompactDock;