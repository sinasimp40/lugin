import React from 'react';

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Share+Tech+Mono&display=swap');

  .panel-root {
    width: 250px; height: 80px;
  }

  .panel-compact {
    padding: 10px 14px; width: 100%; height: 100%;
    display: flex; flex-direction: column; justify-content: center; gap: 6px;
    background: linear-gradient(135deg, #0a0a0a 0%, #141414 50%, #0a0a0a 100%);
    border-radius: 4px;
    border: 1px solid rgba(255,140,0,0.2);
    box-shadow: 0 0 20px rgba(255,140,0,0.1);
    box-sizing: border-box;
  }

  .panel-timer {
    font-family: 'Orbitron', monospace;
    font-size: 20px; font-weight: 700;
    color: #ff8c00; text-align: center;
    letter-spacing: 3px; line-height: 1;
    text-shadow: 0 0 10px rgba(255,140,0,0.6), 0 0 20px rgba(255,140,0,0.3);
  }

  .panel-bottom {
    display: flex; align-items: center; justify-content: space-between;
  }

  .panel-user {
    font-family: 'Share Tech Mono', monospace;
    font-size: 10px; color: rgba(255,140,0,0.4);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    max-width: 70px; letter-spacing: 1px;
  }

  .panel-logout {
    background: rgba(255,140,0,0.08);
    border: 1px solid rgba(255,140,0,0.3);
    color: #ff8c00;
    font-family: 'Share Tech Mono', monospace;
    font-size: 8px; font-weight: 700;
    letter-spacing: 1px;
    padding: 3px 8px;
    border-radius: 2px;
    cursor: pointer;
    text-shadow: 0 0 4px rgba(255,140,0,0.3);
  }

  .panel-pts {
    font-family: 'Orbitron', monospace;
    font-size: 12px; font-weight: 900;
    color: #ffd740;
    letter-spacing: 0.5px;
    text-shadow: 0 0 8px rgba(255,215,64,0.6), 0 0 16px rgba(255,215,64,0.3);
    white-space: nowrap;
    background: linear-gradient(180deg, rgba(255,215,64,0.08) 0%, rgba(255,215,64,0.03) 100%);
    border: 1px solid rgba(255,215,64,0.25);
    border-radius: 3px;
    padding: 2px 8px;
    box-shadow: 0 0 8px rgba(255,215,64,0.08);
  }
`;

export function SessionPanel() {
  return (
    <div style={{ background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
      <style>{styles}</style>
      <div className="panel-root">
        <div className="panel-compact">
          <div className="panel-timer">01:23:45</div>
          <div className="panel-bottom">
            <div className="panel-user">mem-raprap</div>
            <button className="panel-logout">Logout</button>
            <div className="panel-pts">{'\u2605'} 12.50</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SessionPanel;
