import { useState } from 'react';
import { LogOut, ShoppingBag, Trophy } from 'lucide-react';
import './_group.css';

export function TimeFirst() {
  const [selected, setSelected] = useState('');
  const [toast, setToast] = useState(false);
  const act = (name: string) => setSelected(selected === name ? '' : name);
  return <div className="sb-root">
    <div className="sb-hint">Hypothesis 01 / <b>time-first</b></div>
    <div className="sb-bar" style={{ width: 430, height: 64 }} aria-label="Time-first session overlay">
      <div className="sb-main" style={{ paddingLeft: 15, gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><span className="sb-time" style={{ fontSize: 19 }}>01:27:07</span><span style={{ color: '#8e6942', font: '7px OrbitronLocal,monospace', letterSpacing: '1.2px' }}>TIME LEFT</span></div>
        <div className="sb-userline"><i className="sb-dot" /><span className="sb-user" style={{ fontSize: 10, color: '#f2d3a1' }}>mem-player-one</span><span className="sb-pc">PC-07</span></div>
      </div>
      <div className="sb-points"><strong style={{ fontSize: 14 }}>86.50</strong><span>PTS BALANCE</span></div>
      <div className="sb-actions">
        <button className={`sb-btn sb-quick ${selected === 'order' ? 'active' : ''}`} onClick={() => act('order')}><ShoppingBag size={10} className="sb-icon"/>ORDER</button>
        <button className={`sb-btn sb-quick ${selected === 'top' ? 'active' : ''}`} onClick={() => act('top')}><Trophy size={10} className="sb-icon"/>TOP 5</button>
        <button className="sb-btn sb-logout" onClick={() => { setToast(true); window.setTimeout(() => setToast(false), 1600); }}><LogOut size={9} className="sb-icon"/>END</button>
      </div>
    </div>
    {toast && <div className="sb-toast">ENDING SESSION…</div>}
  </div>;
}
export default TimeFirst;