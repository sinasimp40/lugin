import './_group.css';

export function GlassPanel() {
  return (
    <div style={{
      width: 230, height: 50, position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(135deg, rgba(20,15,10,0.95) 0%, rgba(30,20,10,0.9) 100%)',
      borderRadius: 8,
      border: '1px solid rgba(255,160,50,0.12)',
      display: 'flex', alignItems: 'center',
      padding: '0 12px',
      gap: 10,
      fontFamily: "'Share Tech Mono', monospace",
      backdropFilter: 'blur(10px)',
      boxShadow: '0 4px 20px rgba(0,0,0,0.4), 0 0 1px rgba(255,140,0,0.2)',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 20, right: 20, height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(255,180,50,0.25), transparent)',
      }} />

      <div style={{
        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
        background: 'radial-gradient(circle, #ff8c00 30%, #ff6a00 100%)',
        boxShadow: '0 0 6px rgba(255,140,0,0.5), 0 0 12px rgba(255,140,0,0.2)',
        animation: 'pulse 2s ease-in-out infinite',
      }} />
      <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>

      <div style={{ flex: 1, position: 'relative', zIndex: 2 }}>
        <div style={{
          fontFamily: "'Orbitron', monospace", fontSize: 14, fontWeight: 700,
          color: '#ffb347', letterSpacing: 2, lineHeight: 1,
          textShadow: '0 0 8px rgba(255,179,71,0.3)',
        }}>30d 04:15:46</div>
        <div style={{
          fontSize: 8, color: 'rgba(255,179,71,0.45)', letterSpacing: 1, marginTop: 3,
        }}>mem-raptrap</div>
      </div>

      <div style={{
        background: 'linear-gradient(135deg, rgba(255,140,0,0.12), rgba(255,140,0,0.06))',
        border: '1px solid rgba(255,140,0,0.2)',
        color: '#ffb347', padding: '4px 10px', borderRadius: 4,
        fontSize: 7, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase',
        cursor: 'pointer', position: 'relative', zIndex: 2,
      }}>LOGOUT</div>
    </div>
  );
}
