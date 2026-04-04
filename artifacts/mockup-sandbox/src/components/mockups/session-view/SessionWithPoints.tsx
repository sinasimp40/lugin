import React from 'react';

export function SessionWithPoints() {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center',
      padding: '0 12px',
      background: 'linear-gradient(180deg, #0d0d0d 0%, #080808 100%)',
      borderRadius: '3px',
      borderLeft: '2px solid #ff8c00',
      borderRight: '2px solid #ff8c00',
      borderTop: 'none',
      borderBottom: 'none',
      position: 'relative',
      overflow: 'hidden',
      fontFamily: "'Segoe UI', sans-serif",
      boxSizing: 'border-box',
    }}>
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: 0, width: 2,
        background: 'linear-gradient(180deg, transparent 0%, #ff8c00 20%, #ffb347 50%, #ff8c00 80%, transparent 100%)',
        boxShadow: '0 0 6px rgba(255,140,0,0.5), 0 0 15px rgba(255,140,0,0.25)',
        zIndex: 2,
      }} />
      <div style={{
        position: 'absolute', top: 0, bottom: 0, right: 0, width: 2,
        background: 'linear-gradient(180deg, transparent 0%, #ff8c00 20%, #ffb347 50%, #ff8c00 80%, transparent 100%)',
        boxShadow: '0 0 6px rgba(255,140,0,0.5), 0 0 15px rgba(255,140,0,0.25)',
        zIndex: 2,
      }} />

      <div style={{
        position: 'absolute', top: '10%', bottom: '10%', left: 0, width: 10,
        background: 'radial-gradient(ellipse at left, rgba(255,140,0,0.12), transparent 70%)',
        pointerEvents: 'none', zIndex: 1,
      }} />
      <div style={{
        position: 'absolute', top: '10%', bottom: '10%', right: 0, width: 10,
        background: 'radial-gradient(ellipse at right, rgba(255,140,0,0.12), transparent 70%)',
        pointerEvents: 'none', zIndex: 1,
      }} />

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
        <div style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 22,
          fontWeight: 700,
          color: '#ff8c00',
          letterSpacing: 3,
          lineHeight: 1,
          textShadow: '0 0 8px rgba(255,140,0,0.5), 0 0 20px rgba(255,140,0,0.2)',
        }}>
          01:23:45
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 5, height: 5, borderRadius: '50%',
            background: '#00ff88',
            boxShadow: '0 0 4px #00ff88, 0 0 8px rgba(0,255,136,0.3)',
            flexShrink: 0,
          }} />
          <div style={{
            fontFamily: "'Courier New', monospace",
            fontSize: 9,
            fontWeight: 700,
            color: 'rgba(255,140,0,0.7)',
            letterSpacing: 0.5,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 80,
            textShadow: '0 0 4px rgba(255,140,0,0.2)',
          }}>
            mem-raprap
          </div>
          <div style={{
            fontFamily: "'Courier New', monospace",
            fontSize: 7,
            fontWeight: 700,
            color: '#ffd740',
            letterSpacing: 0.5,
            textShadow: '0 0 6px rgba(255,215,64,0.4)',
            whiteSpace: 'nowrap',
          }}>
            ★ 12.50 pts
          </div>
        </div>
      </div>

      <div style={{ flexShrink: 0, marginLeft: 6, zIndex: 3 }}>
        <button style={{
          background: 'rgba(255,140,0,0.1)',
          border: '1px solid rgba(255,140,0,0.3)',
          color: '#ff8c00',
          fontFamily: "'Courier New', monospace",
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: 1,
          padding: '4px 10px',
          borderRadius: 2,
          cursor: 'pointer',
          textShadow: '0 0 4px rgba(255,140,0,0.3)',
        }}>
          LOGOUT
        </button>
      </div>
    </div>
  );
}

export default SessionWithPoints;
