import React, { useState, useEffect } from "react";
import { ShieldAlert, WifiOff } from "lucide-react";

export function CRTTerminal() {
  const [cursorBlink, setCursorBlink] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setCursorBlink((prev) => !prev);
      setTime(new Date());
    }, 530);
    return () => clearInterval(interval);
  }, []);

  const terminalGreen = "#39ff14";
  const terminalDim = "#1a4f0d";
  const terminalRed = "#ff003c";
  
  const glowStyle = {
    textShadow: `0 0 5px ${terminalGreen}, 0 0 10px ${terminalGreen}`,
    color: terminalGreen,
    fontFamily: "'Share Tech Mono', 'Courier New', monospace",
  };

  const redGlowStyle = {
    textShadow: `0 0 5px ${terminalRed}`,
    color: terminalRed,
    fontFamily: "'Share Tech Mono', 'Courier New', monospace",
  };

  const scanlineStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    background: "linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.2))",
    backgroundSize: "100% 4px",
    pointerEvents: "none",
    zIndex: 50,
  };

  const borderStyle = {
    border: `2px solid ${terminalGreen}`,
    boxShadow: `0 0 10px ${terminalGreen}, inset 0 0 10px ${terminalGreen}`,
  };

  return (
    <div className="min-h-screen bg-black relative overflow-hidden flex flex-col justify-center items-center p-4 sm:p-8 select-none" style={{ color: terminalGreen, fontFamily: "'Share Tech Mono', 'Courier New', monospace" }}>
      {/* Background CRT Effects */}
      <div className="absolute inset-0 bg-[#051005]" />
      <div style={scanlineStyle} />
      <div className="absolute inset-0 bg-gradient-to-c from-transparent via-transparent to-black/80 pointer-events-none z-40 mix-blend-overlay" />
      
      {/* Content wrapper */}
      <div className="relative z-10 w-full max-w-5xl mx-auto flex flex-col gap-6 h-full min-h-[85vh]">
        
        {/* Header / Status Bar */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center text-lg sm:text-2xl font-bold uppercase tracking-widest border-b-2 pb-4" style={{ ...glowStyle, borderBottomColor: terminalGreen }}>
          <div className="flex flex-col">
            <span>[ NODE: COMPUTEI GWPP ]</span>
            <span>[ SYS_TIME: {time.toISOString().split('T')[0]} {time.toTimeString().split('T')[1].slice(0,8)} ]</span>
          </div>
          <div className="flex flex-col items-end mt-4 sm:mt-0" style={redGlowStyle}>
            <span className="flex items-center gap-2 animate-pulse"><WifiOff size={24} /> HOTSPOT: OFFLINE</span>
            <span>ERR_CODE: 0xDEADBEEF</span>
          </div>
        </div>

        {/* Marquee */}
        <div className="w-full overflow-hidden whitespace-nowrap py-2 border-b-2" style={{ borderBottomColor: terminalDim }}>
          <div className="inline-block animate-[marquee_20s_linear_infinite] text-sm sm:text-lg" style={glowStyle}>
            *** ANNOUNCEMENT: MAINTENANCE SCHEDULED FOR 0300 HOURS *** NO EXTENSIONS WILL BE GRANTED *** PLEASE SAVE YOUR WORK REGULARLY ***
          </div>
        </div>

        {/* Main Countdown Timer */}
        <div className="flex-1 flex flex-col items-center justify-center py-12 my-4 relative" style={borderStyle}>
          {/* Corner decorations */}
          <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2" style={{ borderColor: terminalGreen }}></div>
          <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2" style={{ borderColor: terminalGreen }}></div>
          <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2" style={{ borderColor: terminalGreen }}></div>
          <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2" style={{ borderColor: terminalGreen }}></div>

          <div className="text-xs sm:text-sm tracking-[0.5em] mb-4 text-center px-4" style={{ color: terminalDim }}>[ AUTO_SHUTDOWN_SEQUENCE_ENGAGED ]</div>
          <div className="text-8xl sm:text-[10rem] md:text-[14rem] font-bold tracking-tighter tabular-nums leading-none" style={{ ...glowStyle, textShadow: `0 0 20px ${terminalGreen}, 0 0 40px ${terminalGreen}, 0 0 80px ${terminalGreen}` }}>
            02:47
          </div>
          <div className="text-lg sm:text-2xl tracking-[0.2em] sm:tracking-widest mt-8 animate-pulse text-center px-4" style={glowStyle}>WARNING: FORCED_LOGOFF_IMMINENT</div>
        </div>

        {/* Auth Prompt */}
        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex-1 p-6 relative" style={borderStyle}>
            <div className="text-xl sm:text-2xl mb-8 flex justify-between border-b pb-2" style={{ ...glowStyle, borderBottomColor: terminalDim }}>
              <span>{isRegistering ? "> INITIALIZE_NEW_USER" : "> AUTHENTICATION_REQUIRED"}</span>
              <span className="animate-pulse"><ShieldAlert size={28} /></span>
            </div>
            
            <form className="space-y-6 sm:space-y-8" onSubmit={(e) => e.preventDefault()}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 group">
                <span className="w-40 text-lg sm:text-xl" style={glowStyle}>USERNAME_</span>
                <div className="flex-1 flex items-center bg-black/50 border border-transparent focus-within:border-[#39ff14] px-4 py-2 transition-colors">
                  <span className="mr-2" style={glowStyle}>{'>'}</span>
                  <input 
                    type="text" 
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toUpperCase())}
                    className="w-full bg-transparent outline-none text-xl sm:text-2xl font-bold uppercase tracking-widest"
                    style={glowStyle}
                    autoFocus
                  />
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <span className="w-40 text-lg sm:text-xl" style={glowStyle}>PASSWORD_</span>
                <div className="flex-1 flex items-center bg-black/50 border border-transparent focus-within:border-[#39ff14] px-4 py-2 transition-colors">
                  <span className="mr-2" style={glowStyle}>{'>'}</span>
                  <input 
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-transparent outline-none text-xl sm:text-2xl tracking-widest font-mono"
                    style={glowStyle}
                  />
                </div>
              </div>

              <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-6">
                <div className="text-lg">
                  <button 
                    type="button"
                    className="opacity-60 hover:opacity-100 transition-opacity focus:outline-none focus:ring-1 focus:ring-[#39ff14] px-2 py-1"
                    onClick={() => setIsRegistering(!isRegistering)}
                    style={glowStyle}
                  >
                    [{isRegistering ? "RETURN_TO_LOGIN_SEQ" : "REGISTER_NEW_NODE"}]
                  </button>
                </div>
                <button 
                  type="button"
                  className="w-full sm:w-auto px-8 py-4 text-black font-bold text-xl uppercase tracking-[0.2em] hover:bg-white focus:bg-white outline-none transition-all active:scale-95"
                  style={{ backgroundColor: terminalGreen, boxShadow: `0 0 15px ${terminalGreen}` }}
                >
                  {isRegistering ? "EXECUTE_CREATE" : "EXECUTE_LOGIN"}
                </button>
              </div>
            </form>
          </div>

          <div className="hidden md:flex w-72 p-6 flex-col justify-between" style={borderStyle}>
            <div className="flex flex-col gap-2 text-sm font-mono tracking-wider" style={{ color: terminalDim }}>
              <span className="mb-2 text-lg border-b pb-1" style={{ borderBottomColor: terminalDim }}>SYSTEM_LOG:</span>
              {[
                "BOOT_SEQ ........... [OK]",
                "MOUNTING_VFS ....... [OK]",
                "CHK_MEM ............ [OK]",
                "INIT_NET_IF ........ [ERR]",
                "NET_UNREACHABLE .... [WARN]",
                "LOAD_AUTH_MOD ...... [OK]",
              ].map((line, i) => (
                <span key={i}>{String.fromCharCode(62)} {line}</span>
              ))}
              <span className="mt-4 animate-pulse">{String.fromCharCode(62)} WAITING_FOR_INPUT...</span>
            </div>
            <div className="text-2xl mt-8" style={glowStyle}>
              root@computei:~# <span className={cursorBlink ? "opacity-100" : "opacity-0"}>█</span>
            </div>
          </div>
        </div>

      </div>

      {/* Marquee Animation Keyframes */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes marquee {
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
      `}} />
    </div>
  );
}
