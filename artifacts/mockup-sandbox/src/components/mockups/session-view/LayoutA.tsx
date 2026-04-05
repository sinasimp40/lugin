import React from 'react';

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Share+Tech+Mono&display=swap');

  .a-root {
    width: 250px; height: 50px;
    display: flex; align-items: stretch;
    background: linear-gradient(180deg, #0d0d0d 0%, #080808 100%);
    border-radius: 3px;
    border-left: 2px solid #ff8c00;
    border-right: 2px solid #ff8c00;
    position: relative; overflow: hidden;
    box-sizing: border-box;
  }

  .a-neon-l, .a-neon-r {
    position: absolute; top: 0; bottom: 0; width: 2px;
    background: linear-gradient(180deg, transparent 0%, #ff8c00 20%, #ffb347 50%, #ff8c00 80%, transparent 100%);
    box-shadow: 0 0 6px rgba(255,140,0,0.5), 0 0 15px rgba(255,140,0,0.25);
    z-index: 2;
  }
  .a-neon-l { left: 0; }
  .a-neon-r { right: 0; }

  .a-glow-l, .a-glow-r {
    position: absolute; top: 10%; bottom: 10%; width: 10px;
    pointer-events: none; z-index: 1;
  }
  .a-glow-l { left: 0; background: radial-gradient(ellipse at left, rgba(255,140,0,0.12), transparent 70%); }
  .a-glow-r { right: 0; background: radial-gradient(ellipse at right, rgba(255,140,0,0.12), transparent 70%); }

  .a-scan {
    position: absolute; inset: 0; pointer-events: none; z-index: 1;
    background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,140,0,0.012) 2px, rgba(255,140,0,0.012) 4px);
  }

  .a-sweep {
    position: absolute; top: 0; left: -60%; width: 40%; height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,140,0,0.02), rgba(255,140,0,0.05), rgba(255,140,0,0.02), transparent);
    animation: a-sweep-anim 3s ease-in-out infinite;
    pointer-events: none; z-index: 1;
  }
  @keyframes a-sweep-anim { 0% { left: -40%; } 100% { left: 140%; } }

  .a-particles {
    position: absolute; inset: 0; pointer-events: none; z-index: 0;
    background: radial-gradient(1px 1px at 20% 30%, rgba(255,140,0,0.3), transparent),
                radial-gradient(1px 1px at 60% 70%, rgba(255,140,0,0.2), transparent),
                radial-gradient(1px 1px at 80% 20%, rgba(255,140,0,0.25), transparent),
                radial-gradient(1px 1px at 40% 80%, rgba(255,140,0,0.15), transparent);
  }

  .a-pts-zone {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: linear-gradient(180deg, rgba(255,215,64,0.12) 0%, rgba(255,215,64,0.04) 100%);
    border-right: 1px solid rgba(255,215,64,0.25);
    padding: 0 10px;
    min-width: 60px;
    position: relative; z-index: 3;
    box-shadow: inset -4px 0 8px rgba(255,215,64,0.04);
  }
  .a-pts-zone .a-pts-val {
    font-family: 'Orbitron', monospace;
    font-size: 16px; font-weight: 900;
    color: #ffd740;
    letter-spacing: 1px;
    text-shadow: 0 0 10px rgba(255,215,64,0.7), 0 0 20px rgba(255,215,64,0.35);
    line-height: 1;
  }
  .a-pts-zone .a-pts-lbl {
    font-family: 'Orbitron', monospace;
    font-size: 5px; font-weight: 700;
    letter-spacing: 2px;
    color: rgba(255,215,64,0.5);
    margin-top: 2px;
  }

  .a-main {
    flex: 1; min-width: 0;
    display: flex; align-items: center;
    padding: 0 10px;
    position: relative; z-index: 3;
  }

  .a-info {
    flex: 1; min-width: 0;
    display: flex; flex-direction: column; gap: 1px;
  }

  .a-timer {
    font-family: 'Orbitron', monospace;
    font-size: 14px; font-weight: 700;
    color: #ff8c00;
    letter-spacing: 1px; line-height: 1;
    text-shadow: 0 0 8px rgba(255,140,0,0.4), 0 0 20px rgba(255,140,0,0.15);
    white-space: nowrap;
  }

  .a-user-row {
    display: flex; align-items: center; gap: 4px;
  }

  .a-dot {
    width: 4px; height: 4px; border-radius: 50%;
    background: #22cc44;
    box-shadow: 0 0 3px rgba(34,204,68,0.6), 0 0 6px rgba(34,204,68,0.3);
    flex-shrink: 0;
    animation: a-dot-pulse 2s ease-in-out infinite;
  }
  @keyframes a-dot-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

  .a-user {
    font-family: 'Share Tech Mono', monospace;
    font-size: 8px; color: rgba(255,140,0,0.7);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    max-width: 80px; letter-spacing: 0.5px;
  }

  .a-logout {
    background: transparent;
    border: 1px solid rgba(255,140,0,0.3);
    color: #ff8c00; padding: 2px 6px;
    border-radius: 2px; cursor: pointer;
    font-family: 'Share Tech Mono', monospace;
    font-size: 6px; font-weight: 600;
    letter-spacing: 1px; text-transform: uppercase;
    flex-shrink: 0; margin-left: 6px;
    align-self: flex-end;
  }
`;

export function LayoutA() {
  return (
    <div style={{ background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
      <style>{styles}</style>
      <div className="a-root">
        <div className="a-particles" />
        <div className="a-scan" />
        <div className="a-sweep" />
        <div className="a-neon-l" />
        <div className="a-neon-r" />
        <div className="a-glow-l" />
        <div className="a-glow-r" />
        <div className="a-pts-zone">
          <span className="a-pts-val">12.50</span>
          <span className="a-pts-lbl">POINTS</span>
        </div>
        <div className="a-main">
          <div className="a-info">
            <div className="a-timer">01:23:45</div>
            <div className="a-user-row">
              <div className="a-dot" />
              <div className="a-user">mem-raprap</div>
            </div>
          </div>
          <button className="a-logout">LOGOUT</button>
        </div>
      </div>
    </div>
  );
}

export default LayoutA;
