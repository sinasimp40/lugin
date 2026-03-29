import './_group.css';

export function Current() {
  return (
    <div style={{
      width: 230, height: 50, position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(135deg, #0a0a0a 0%, #111 50%, #0a0a0a 100%)',
      borderRadius: 4, border: '1px solid rgba(255,140,0,0.15)',
      padding: '6px 10px',
      display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2,
      fontFamily: "'Share Tech Mono', monospace",
    }}>
      <div style={{
        position: 'absolute', inset: -1, borderRadius: 5, pointerEvents: 'none',
        background: 'conic-gradient(from 0deg, transparent 0%, rgba(255,140,0,0.4) 10%, transparent 20%, transparent 45%, rgba(255,69,0,0.3) 55%, transparent 65%, transparent 90%, rgba(255,200,0,0.3) 100%)',
        WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
        WebkitMaskComposite: 'xor', padding: 1,
        animation: 'spin 4s linear infinite',
      }} />
      <style>{`@keyframes spin { to { rotate: 360deg; } }`}</style>
      <div style={{
        fontFamily: "'Orbitron', monospace", fontSize: 16, fontWeight: 700,
        color: '#ff8c00', textAlign: 'center', letterSpacing: 3, lineHeight: 1,
        textShadow: '0 0 10px rgba(255,140,0,0.5), 0 0 25px rgba(255,140,0,0.2)',
        position: 'relative', zIndex: 3,
      }}>30d 04:15:46</div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'relative', zIndex: 3,
      }}>
        <div style={{ fontSize: 9, color: 'rgba(255,140,0,0.75)', letterSpacing: 1, textShadow: '0 0 6px rgba(255,140,0,0.3)' }}>mem-raptrap</div>
        <div style={{
          background: 'rgba(255,140,0,0.06)', border: '1px solid rgba(255,140,0,0.25)',
          color: '#ff8c00', padding: '2px 8px', borderRadius: 2, fontSize: 8, fontWeight: 600,
          letterSpacing: 2, textTransform: 'uppercase',
        }}>LOGOUT</div>
      </div>
    </div>
  );
}
