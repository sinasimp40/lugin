import React from 'react';

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Share+Tech+Mono&display=swap');

  .c-root {
    width: 250px; height: 50px;
    display: flex; align-items: center;
    background: linear-gradient(180deg, #0d0d0d 0%, #080808 100%);
    border-radius: 3px;
    border-left: 2px solid #ff8c00;
    border-right: 2px solid #ff8c00;
    position: relative; overflow: hidden;
    box-sizing: border-box;
    padding: 0 10px;
  }

  .c-neon-l, .c-neon-r {
    position: absolute; top: 0; bottom: 0; width: 2px;
    background: linear-gradient(180deg, transparent 0%, #ff8c00 20%, #ffb347 50%, #ff8c00 80%, transparent 100%);
    box-shadow: 0 0 6px rgba(255,140,0,0.5), 0 0 15px rgba(255,140,0,0.25);
    z-index: 2;
  }
  .c-neon-l { left: 0; }
  .c-neon-r { right: 0; }

  .c-scan {
    position: absolute; inset: 0; pointer-events: none; z-index: 1;
    background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,140,0,0.012) 2px, rgba(255,140,0,0.012) 4px);
  }

  .c-sweep {
    position: absolute; top: 0; left: -60%; width: 40%; height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,140,0,0.02), rgba(255,140,0,0.05), rgba(255,140,0,0.02), transparent);
    animation: c-sweep-anim 3s ease-in-out infinite;
    pointer-events: none; z-index: 1;
  }
  @keyframes c-sweep-anim { 0% { left: -40%; } 100% { left: 140%; } }

  .c-particles {
    position: absolute; inset: 0; pointer-events: none; z-index: 0;
    background: radial-gradient(1px 1px at 20% 30%, rgba(255,140,0,0.3), transparent),
                radial-gradient(1px 1px at 60% 70%, rgba(255,140,0,0.2), transparent),
                radial-gradient(1px 1px at 80% 20%, rgba(255,140,0,0.25), transparent),
                radial-gradient(1px 1px at 40% 80%, rgba(255,140,0,0.15), transparent);
  }

  .c-left {
    display: flex; flex-direction: column; gap: 1px;
    position: relative; z-index: 3;
    min-width: 0;
  }

  .c-timer {
    font-family: 'Orbitron', monospace;
    font-size: 14px; font-weight: 700;
    color: #ff8c00;
    letter-spacing: 1px; line-height: 1;
    text-shadow: 0 0 8px rgba(255,140,0,0.4), 0 0 20px rgba(255,140,0,0.15);
    white-space: nowrap;
  }

  .c-user-row {
    display: flex; align-items: center; gap: 4px;
  }

  .c-dot {
    width: 4px; height: 4px; border-radius: 50%;
    background: #22cc44;
    box-shadow: 0 0 3px rgba(34,204,68,0.6), 0 0 6px rgba(34,204,68,0.3);
    flex-shrink: 0;
    animation: c-dot-pulse 2s ease-in-out infinite;
  }
  @keyframes c-dot-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

  .c-user {
    font-family: 'Share Tech Mono', monospace;
    font-size: 8px; color: rgba(255,140,0,0.7);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    max-width: 70px; letter-spacing: 0.5px;
  }

  .c-spacer { flex: 1; }

  .c-center {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    position: relative; z-index: 3;
    padding: 0 8px;
    border-left: 1px solid rgba(255,140,0,0.15);
    border-right: 1px solid rgba(255,215,64,0.15);
    align-self: stretch;
  }

  .c-logout {
    background: transparent;
    border: 1px solid rgba(255,140,0,0.3);
    color: #ff8c00; padding: 3px 8px;
    border-radius: 2px; cursor: pointer;
    font-family: 'Share Tech Mono', monospace;
    font-size: 7px; font-weight: 600;
    letter-spacing: 1.5px; text-transform: uppercase;
  }

  .c-right {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    position: relative; z-index: 3;
    padding-left: 8px;
    align-self: stretch;
  }

  .c-pts-val {
    font-family: 'Orbitron', monospace;
    font-size: 16px; font-weight: 900;
    color: #ffd740;
    letter-spacing: 1px; line-height: 1;
    text-shadow: 0 0 10px rgba(255,215,64,0.7), 0 0 20px rgba(255,215,64,0.35);
    white-space: nowrap;
  }

  .c-pts-lbl {
    font-family: 'Orbitron', monospace;
    font-size: 5px; font-weight: 700;
    letter-spacing: 2px;
    color: rgba(255,215,64,0.5);
    margin-top: 2px;
  }
`;

export function LayoutC() {
  return (
    <div style={{ background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
      <style>{styles}</style>
      <div className="c-root">
        <div className="c-particles" />
        <div className="c-scan" />
        <div className="c-sweep" />
        <div className="c-neon-l" />
        <div className="c-neon-r" />
        <div className="c-left">
          <div className="c-timer">01:23:45</div>
          <div className="c-user-row">
            <div className="c-dot" />
            <div className="c-user">mem-raprap</div>
          </div>
        </div>
        <div className="c-spacer" />
        <div className="c-center">
          <button className="c-logout">LOGOUT</button>
        </div>
        <div className="c-right">
          <span className="c-pts-val">12.50</span>
          <span className="c-pts-lbl">POINTS</span>
        </div>
      </div>
    </div>
  );
}

export default LayoutC;
