import React from 'react';

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Share+Tech+Mono&display=swap');

  .b-root {
    width: 250px; height: 50px;
    display: flex; flex-direction: column;
    background: linear-gradient(180deg, #0d0d0d 0%, #080808 100%);
    border-radius: 3px;
    border-left: 2px solid #ff8c00;
    border-right: 2px solid #ff8c00;
    position: relative; overflow: hidden;
    box-sizing: border-box;
  }

  .b-neon-l, .b-neon-r {
    position: absolute; top: 0; bottom: 0; width: 2px;
    background: linear-gradient(180deg, transparent 0%, #ff8c00 20%, #ffb347 50%, #ff8c00 80%, transparent 100%);
    box-shadow: 0 0 6px rgba(255,140,0,0.5), 0 0 15px rgba(255,140,0,0.25);
    z-index: 2;
  }
  .b-neon-l { left: 0; }
  .b-neon-r { right: 0; }

  .b-scan {
    position: absolute; inset: 0; pointer-events: none; z-index: 1;
    background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,140,0,0.012) 2px, rgba(255,140,0,0.012) 4px);
  }

  .b-sweep {
    position: absolute; top: 0; left: -60%; width: 40%; height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,140,0,0.02), rgba(255,140,0,0.05), rgba(255,140,0,0.02), transparent);
    animation: b-sweep-anim 3s ease-in-out infinite;
    pointer-events: none; z-index: 1;
  }
  @keyframes b-sweep-anim { 0% { left: -40%; } 100% { left: 140%; } }

  .b-particles {
    position: absolute; inset: 0; pointer-events: none; z-index: 0;
    background: radial-gradient(1px 1px at 20% 30%, rgba(255,140,0,0.3), transparent),
                radial-gradient(1px 1px at 60% 70%, rgba(255,140,0,0.2), transparent),
                radial-gradient(1px 1px at 80% 20%, rgba(255,140,0,0.25), transparent),
                radial-gradient(1px 1px at 40% 80%, rgba(255,140,0,0.15), transparent);
  }

  .b-top {
    display: flex; align-items: center; justify-content: space-between;
    padding: 4px 10px 0 10px;
    position: relative; z-index: 3;
    flex: 1;
  }

  .b-timer {
    font-family: 'Orbitron', monospace;
    font-size: 15px; font-weight: 700;
    color: #ff8c00;
    letter-spacing: 1px; line-height: 1;
    text-shadow: 0 0 8px rgba(255,140,0,0.4), 0 0 20px rgba(255,140,0,0.15);
    white-space: nowrap;
  }

  .b-pts-inline {
    font-family: 'Orbitron', monospace;
    font-size: 15px; font-weight: 900;
    color: #ffd740;
    letter-spacing: 1px; line-height: 1;
    text-shadow: 0 0 10px rgba(255,215,64,0.7), 0 0 20px rgba(255,215,64,0.35);
    white-space: nowrap;
  }
  .b-pts-unit {
    font-size: 7px; font-weight: 700;
    color: rgba(255,215,64,0.5);
    letter-spacing: 1px;
    margin-left: 2px;
  }

  .b-bottom {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 10px 4px 10px;
    position: relative; z-index: 3;
  }

  .b-user-row {
    display: flex; align-items: center; gap: 4px;
  }

  .b-dot {
    width: 4px; height: 4px; border-radius: 50%;
    background: #22cc44;
    box-shadow: 0 0 3px rgba(34,204,68,0.6), 0 0 6px rgba(34,204,68,0.3);
    flex-shrink: 0;
    animation: b-dot-pulse 2s ease-in-out infinite;
  }
  @keyframes b-dot-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

  .b-user {
    font-family: 'Share Tech Mono', monospace;
    font-size: 8px; color: rgba(255,140,0,0.7);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    max-width: 100px; letter-spacing: 0.5px;
  }

  .b-logout {
    background: transparent;
    border: 1px solid rgba(255,140,0,0.3);
    color: #ff8c00; padding: 2px 8px;
    border-radius: 2px; cursor: pointer;
    font-family: 'Share Tech Mono', monospace;
    font-size: 7px; font-weight: 600;
    letter-spacing: 1.5px; text-transform: uppercase;
  }

  .b-divider {
    height: 1px; margin: 0 10px;
    background: linear-gradient(90deg, transparent, rgba(255,140,0,0.2), rgba(255,215,64,0.15), rgba(255,140,0,0.2), transparent);
    position: relative; z-index: 3;
  }
`;

export function LayoutB() {
  return (
    <div style={{ background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
      <style>{styles}</style>
      <div className="b-root">
        <div className="b-particles" />
        <div className="b-scan" />
        <div className="b-sweep" />
        <div className="b-neon-l" />
        <div className="b-neon-r" />
        <div className="b-top">
          <div className="b-timer">01:23:45</div>
          <div className="b-pts-inline">12.50<span className="b-pts-unit">PTS</span></div>
        </div>
        <div className="b-divider" />
        <div className="b-bottom">
          <div className="b-user-row">
            <div className="b-dot" />
            <div className="b-user">mem-raprap</div>
          </div>
          <button className="b-logout">LOGOUT</button>
        </div>
      </div>
    </div>
  );
}

export default LayoutB;
