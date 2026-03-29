import './_group.css';

export function NeonStrip() {
  return (
    <div style={{
      width: 230, height: 50, position: 'relative', overflow: 'hidden',
      background: '#0a0a0a',
      borderRadius: 6,
      display: 'flex', alignItems: 'center',
      padding: '0 10px',
      gap: 8,
      fontFamily: "'Share Tech Mono', monospace",
      boxShadow: '0 0 15px rgba(255,100,0,0.15), inset 0 0 20px rgba(0,0,0,0.5)',
    }}>
      <div style={{
        position: 'absolute', left: 0, top: 4, bottom: 4, width: 3,
        background: 'linear-gradient(180deg, #ff8c00, #ff4500)',
        borderRadius: '0 2px 2px 0',
        boxShadow: '0 0 8px rgba(255,140,0,0.6), 0 0 16px rgba(255,69,0,0.3)',
      }} />

      <div style={{
        position: 'absolute', inset: 0, borderRadius: 6, pointerEvents: 'none',
        border: '1px solid rgba(255,140,0,0.08)',
      }} />

      <div style={{ flex: 1, paddingLeft: 6, position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <div style={{
            fontFamily: "'Orbitron', monospace", fontSize: 17, fontWeight: 800,
            color: '#ff8c00', letterSpacing: 1, lineHeight: 1,
            textShadow: '0 0 10px rgba(255,140,0,0.4)',
          }}>30d 04:15:46</div>
        </div>
        <div style={{
          fontSize: 8, color: 'rgba(255,140,0,0.5)', letterSpacing: 1, marginTop: 3,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{
            display: 'inline-block', width: 4, height: 4, borderRadius: '50%',
            background: '#22c55e', boxShadow: '0 0 4px rgba(34,197,94,0.6)',
          }} />
          mem-raptrap
        </div>
      </div>

      <div style={{
        background: 'transparent',
        border: '1px solid rgba(255,140,0,0.3)',
        color: 'rgba(255,140,0,0.7)', padding: '4px 10px', borderRadius: 3,
        fontSize: 7, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase',
        cursor: 'pointer', position: 'relative', zIndex: 2,
        transition: 'all 0.3s',
      }}>LOGOUT</div>
    </div>
  );
}
