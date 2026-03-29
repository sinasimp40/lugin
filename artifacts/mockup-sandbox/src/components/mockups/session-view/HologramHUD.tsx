import './_group.css';

export function HologramHUD() {
  return (
    <div style={{
      width: 230, height: 50, position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(180deg, #050a0f 0%, #0a1520 100%)',
      borderRadius: 3,
      border: '1px solid rgba(0,200,255,0.2)',
      display: 'flex', alignItems: 'center',
      padding: '0 10px',
      gap: 8,
      fontFamily: "'Share Tech Mono', monospace",
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(0,200,255,0.6), transparent)',
      }} />
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(0,200,255,0.3), transparent)',
      }} />
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,200,255,0.02) 2px, rgba(0,200,255,0.02) 4px)',
      }} />

      <div style={{ flex: 1, position: 'relative', zIndex: 2 }}>
        <div style={{
          fontFamily: "'Orbitron', monospace", fontSize: 15, fontWeight: 700,
          color: '#00d4ff', letterSpacing: 2, lineHeight: 1,
          textShadow: '0 0 8px rgba(0,212,255,0.5), 0 0 20px rgba(0,212,255,0.2)',
        }}>30d 04:15:46</div>
        <div style={{
          fontSize: 8, color: 'rgba(0,200,255,0.6)', letterSpacing: 1, marginTop: 3,
          textTransform: 'uppercase',
        }}>
          <span style={{ color: 'rgba(0,255,150,0.7)' }}>●</span>{' '}mem-raptrap
        </div>
      </div>

      <div style={{
        width: 1, height: 30, background: 'rgba(0,200,255,0.15)', flexShrink: 0,
      }} />

      <div style={{
        background: 'rgba(0,200,255,0.08)',
        border: '1px solid rgba(0,200,255,0.3)',
        color: '#00d4ff', padding: '4px 10px', borderRadius: 2,
        fontSize: 7, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase',
        cursor: 'pointer', position: 'relative', zIndex: 2,
        textShadow: '0 0 4px rgba(0,212,255,0.3)',
      }}>LOGOUT</div>
    </div>
  );
}
