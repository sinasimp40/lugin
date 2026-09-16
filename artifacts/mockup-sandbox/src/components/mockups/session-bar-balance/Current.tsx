import { useState } from 'react';
import { LogOut } from 'lucide-react';
import './_group.css';

export function Current() {
  const [active, setActive] = useState<'ORDER' | 'TOP 5' | null>(null);
  const [toast, setToast] = useState(false);
  const click = (label: 'ORDER' | 'TOP 5') => setActive(active === label ? null : label);
  const logout = () => { setToast(true); window.setTimeout(() => setToast(false), 1800); };
  return <div className="sb-root">
    <div className="sb-hint">Gameplay overlay / <b>collapsed session</b></div>
    <div className="sb-bar" aria-label="Current session overlay">
      <div className="sb-points"><strong>86.50</strong><span>POINTS</span></div>
      <div className="sb-main"><div className="sb-time">01:27:07</div><div className="sb-userline"><i className="sb-dot" /><span className="sb-user">mem-player-one</span><span className="sb-pc">[ PC-07 ]</span></div></div>
      <div className="sb-actions">
        <button className={`sb-btn sb-quick ${active === 'ORDER' ? 'active' : ''}`} onClick={() => click('ORDER')}>ORDER</button>
        <button className={`sb-btn sb-quick ${active === 'TOP 5' ? 'active' : ''}`} onClick={() => click('TOP 5')}>TOP 5</button>
        <button className="sb-btn sb-logout" onClick={logout}><span className="sb-icon"><LogOut size={9}/></span>LOGOUT</button>
      </div>
    </div>
    {toast && <div className="sb-toast">SESSION END REQUESTED</div>}
  </div>;
}
export default Current;