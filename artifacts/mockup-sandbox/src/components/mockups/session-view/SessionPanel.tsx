import React from 'react';

export function SessionPanel() {
  return (
    <div style={{
      width: 260, height: 80,
      fontFamily: "'Segoe UI', sans-serif",
    }}>
      <div style={{
        padding: '10px 14px',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 6,
        background: 'linear-gradient(135deg, #0a0a0a 0%, #141414 50%, #0a0a0a 100%)',
        borderRadius: 4,
        border: '1px solid rgba(255,140,0,0.2)',
        boxShadow: '0 0 20px rgba(255,140,0,0.1)',
        boxSizing: 'border-box',
      }}>
        <div style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 20,
          fontWeight: 700,
          color: '#ff8c00',
          textAlign: 'center',
          letterSpacing: 3,
          lineHeight: 1,
          textShadow: '0 0 10px rgba(255,140,0,0.6), 0 0 20px rgba(255,140,0,0.3)',
        }}>
          01:23:45
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{
            fontFamily: "'Courier New', monospace",
            fontSize: 10,
            color: 'rgba(255,140,0,0.4)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 80,
            letterSpacing: 1,
          }}>
            mem-raprap
          </div>

          <div style={{
            fontFamily: "'Courier New', monospace",
            fontSize: 8,
            fontWeight: 700,
            color: '#ffd740',
            letterSpacing: 0.5,
            textShadow: '0 0 6px rgba(255,215,64,0.4)',
            whiteSpace: 'nowrap',
          }}>
            ★ 12.50 pts
          </div>

          <button style={{
            background: 'rgba(255,140,0,0.08)',
            border: '1px solid rgba(255,140,0,0.3)',
            color: '#ff8c00',
            fontFamily: "'Courier New', monospace",
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: 1,
            padding: '3px 8px',
            borderRadius: 2,
            cursor: 'pointer',
            textShadow: '0 0 4px rgba(255,140,0,0.3)',
          }}>
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}

export default SessionPanel;
