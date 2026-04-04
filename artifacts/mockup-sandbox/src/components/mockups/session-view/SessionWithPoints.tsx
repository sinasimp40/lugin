import React from 'react';

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Share+Tech+Mono&display=swap');

  .strip-root {
    width: 300px; height: 50px;
    display: flex; align-items: center;
    padding: 0 12px;
    background: linear-gradient(180deg, #0d0d0d 0%, #080808 100%);
    border-radius: 3px;
    border: none;
    border-left: 2px solid #ff8c00;
    border-right: 2px solid #ff8c00;
    position: relative; overflow: hidden;
    box-sizing: border-box;
  }

  .neon-line-l, .neon-line-r {
    position: absolute; top: 0; bottom: 0; width: 2px;
    background: linear-gradient(180deg, transparent 0%, #ff8c00 20%, #ffb347 50%, #ff8c00 80%, transparent 100%);
    box-shadow: 0 0 6px rgba(255,140,0,0.5), 0 0 15px rgba(255,140,0,0.25);
    z-index: 2;
  }
  .neon-line-l { left: 0; }
  .neon-line-r { right: 0; }

  .neon-glow-l, .neon-glow-r {
    position: absolute; top: 10%; bottom: 10%; width: 10px;
    pointer-events: none; z-index: 1;
  }
  .neon-glow-l { left: 0; background: radial-gradient(ellipse at left, rgba(255,140,0,0.12), transparent 70%); }
  .neon-glow-r { right: 0; background: radial-gradient(ellipse at right, rgba(255,140,0,0.12), transparent 70%); }

  .scanline-bg {
    position: absolute; inset: 0; pointer-events: none; z-index: 1;
    background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,140,0,0.012) 2px, rgba(255,140,0,0.012) 4px);
  }

  .sweep-bg {
    position: absolute; top: 0; left: -60%; width: 40%; height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,140,0,0.02), rgba(255,140,0,0.05), rgba(255,140,0,0.02), transparent);
    animation: sweep-anim 3s ease-in-out infinite;
    pointer-events: none; z-index: 1;
  }
  @keyframes sweep-anim { 0% { left: -40%; } 100% { left: 140%; } }

  .bg-particles {
    position: absolute; inset: 0; pointer-events: none; z-index: 0;
    background: radial-gradient(1px 1px at 20% 30%, rgba(255,140,0,0.3), transparent),
                radial-gradient(1px 1px at 60% 70%, rgba(255,140,0,0.2), transparent),
                radial-gradient(1px 1px at 80% 20%, rgba(255,140,0,0.25), transparent),
                radial-gradient(1px 1px at 40% 80%, rgba(255,140,0,0.15), transparent),
                radial-gradient(1px 1px at 10% 60%, rgba(255,140,0,0.2), transparent),
                radial-gradient(1px 1px at 90% 50%, rgba(255,140,0,0.15), transparent);
  }

  .left-sec {
    display: flex; flex-direction: column; gap: 1px;
    flex: 1; min-width: 0;
    position: relative; z-index: 3;
  }

  .timer-text {
    font-family: 'Orbitron', monospace;
    font-size: 14px; font-weight: 700;
    color: #ff8c00;
    letter-spacing: 1px; line-height: 1;
    text-shadow: 0 0 8px rgba(255,140,0,0.4), 0 0 20px rgba(255,140,0,0.15);
    white-space: nowrap;
  }

  .user-row {
    display: flex; align-items: center; gap: 4px;
  }

  .status-dot {
    width: 4px; height: 4px; border-radius: 50%;
    background: #22cc44;
    box-shadow: 0 0 3px rgba(34,204,68,0.6), 0 0 6px rgba(34,204,68,0.3);
    flex-shrink: 0;
    animation: dot-pulse 2s ease-in-out infinite;
  }
  @keyframes dot-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .user-text {
    font-family: 'Share Tech Mono', monospace;
    font-size: 8px; color: rgba(255,140,0,0.7);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    max-width: 80px; letter-spacing: 0.5px;
    text-shadow: 0 0 4px rgba(255,140,0,0.2);
  }

  .right-sec {
    flex-shrink: 0;
    margin-left: 8px;
    display: flex; align-items: center; gap: 8px;
    position: relative; z-index: 3;
  }

  .pts-badge {
    font-family: 'Orbitron', monospace;
    display: flex; flex-direction: column; align-items: flex-end;
    text-align: right; line-height: 1;
    color: #ffd740;
    text-shadow: 0 0 8px rgba(255,215,64,0.6), 0 0 16px rgba(255,215,64,0.3);
    white-space: nowrap;
  }
  .pts-badge .pts-val { font-size: 13px; font-weight: 900; }
  .pts-badge .pts-lbl { font-size: 6px; font-weight: 700; letter-spacing: 2px; color: rgba(255,215,64,0.6); margin-top: 1px; }

  .logout-btn {
    background: transparent;
    border: 1px solid rgba(255,140,0,0.3);
    color: #ff8c00; padding: 3px 8px;
    border-radius: 2px; cursor: pointer;
    font-family: 'Share Tech Mono', monospace;
    font-size: 7px; font-weight: 600;
    letter-spacing: 1.5px; text-transform: uppercase;
  }
`;

export function SessionWithPoints() {
  return (
    <div style={{ background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
      <style>{styles}</style>
      <div className="strip-root">
        <div className="bg-particles" />
        <div className="scanline-bg" />
        <div className="sweep-bg" />
        <div className="neon-line-l" />
        <div className="neon-line-r" />
        <div className="neon-glow-l" />
        <div className="neon-glow-r" />
        <div className="left-sec">
          <div className="timer-text">01:23:45</div>
          <div className="user-row">
            <div className="status-dot" />
            <div className="user-text">mem-raprap</div>
          </div>
        </div>
        <div className="right-sec">
          <div className="pts-badge">
            <span className="pts-val">{'\u2605'} 12.50</span>
            <span className="pts-lbl">POINTS</span>
          </div>
          <button className="logout-btn">LOGOUT</button>
        </div>
      </div>
    </div>
  );
}

export default SessionWithPoints;
