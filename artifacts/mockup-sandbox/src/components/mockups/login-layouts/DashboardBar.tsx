import React, { useState } from 'react';
import './_group.css';

export function DashboardBar() {
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e0e0e0] font-['Share_Tech_Mono'] relative overflow-hidden flex flex-col p-4 md:p-8">
      {/* Background elements */}
      <div 
        className="absolute inset-0 z-0 opacity-10"
        style={{
          backgroundImage: `url('/__mockup/images/loginimage.jpg')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'grayscale(100%) sepia(100%) hue-rotate(10deg) saturate(500%) brightness(0.8)'
        }}
      />
      <div 
        className="absolute inset-0 z-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: `
            linear-gradient(var(--neon-orange) 1px, transparent 1px),
            linear-gradient(90deg, var(--neon-orange) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
        }}
      />
      <div 
        className="absolute inset-0 z-0 pointer-events-none opacity-10"
        style={{
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, var(--neon-orange) 2px, var(--neon-orange) 4px)'
        }}
      />

      {/* Header */}
      <header className="relative z-10 w-full border-b border-[#ff8c00]/30 pb-4 mb-6 flex justify-between items-end">
        <div>
          <h1 className="font-['Orbitron'] text-4xl font-black text-[#ff8c00] tracking-widest" style={{ textShadow: '0 0 20px rgba(255,140,0,0.5)' }}>
            COMPUTER SHOP
          </h1>
          <div className="text-xs text-[#ff8c00]/70 uppercase tracking-widest mt-1 flex items-center gap-2">
            <span className="w-2 h-2 bg-[#ff8c00] rounded-full animate-pulse shadow-[0_0_8px_#ff8c00]"></span>
            SYSTEM ONLINE // TERMINAL READY
          </div>
        </div>
        <div className="text-right">
          <div className="text-[#ff8c00] font-['Orbitron'] text-xl font-bold tracking-wider">
            TERMINAL // 04
          </div>
        </div>
      </header>

      {/* Main Content 3-Column Layout */}
      <main className="relative z-10 flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        
        {/* Left Column - Authentication */}
        <div className="bg-[#111] border border-[#ff8c00]/20 rounded-sm relative shadow-[0_0_30px_rgba(0,0,0,0.8)] backdrop-blur-md flex flex-col h-full">
          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-[#ff8c00]"></div>
          <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-[#ff8c00]"></div>
          <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-[#ff8c00]"></div>
          <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-[#ff8c00]"></div>

          <div className="p-1 border-b border-[#ff8c00]/20 flex">
            <button 
              className={`flex-1 py-3 text-center uppercase tracking-widest text-sm font-bold transition-all ${activeTab === 'login' ? 'bg-[#ff8c00]/10 text-[#ff8c00] border-b-2 border-[#ff8c00]' : 'text-[#e0e0e0]/50 hover:bg-[#ff8c00]/5'}`}
              onClick={() => setActiveTab('login')}
            >
              Access
            </button>
            <button 
              className={`flex-1 py-3 text-center uppercase tracking-widest text-sm font-bold transition-all ${activeTab === 'register' ? 'bg-[#ff8c00]/10 text-[#ff8c00] border-b-2 border-[#ff8c00]' : 'text-[#e0e0e0]/50 hover:bg-[#ff8c00]/5'}`}
              onClick={() => setActiveTab('register')}
            >
              Initialize
            </button>
          </div>

          <div className="p-6 flex-1 flex flex-col justify-center">
            {activeTab === 'login' ? (
              <div className="space-y-5 animate-in fade-in zoom-in duration-300">
                <div className="space-y-1">
                  <label className="text-xs text-[#ff8c00] uppercase tracking-widest">Username // Identity</label>
                  <input 
                    type="text" 
                    className="w-full bg-black/50 border border-[#ff8c00]/30 rounded-sm p-3 text-[#e0e0e0] focus:border-[#ff8c00] focus:outline-none focus:ring-1 focus:ring-[#ff8c00]/50 transition-all font-['Share_Tech_Mono']"
                    placeholder="Enter user ID"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-[#ff8c00] uppercase tracking-widest">Passcode // Key</label>
                  <input 
                    type="password" 
                    className="w-full bg-black/50 border border-[#ff8c00]/30 rounded-sm p-3 text-[#e0e0e0] focus:border-[#ff8c00] focus:outline-none focus:ring-1 focus:ring-[#ff8c00]/50 transition-all font-['Share_Tech_Mono']"
                    placeholder="••••••••"
                  />
                </div>
                <button className="w-full mt-4 bg-gradient-to-r from-[#ff8c00]/80 to-[#ff4500]/80 hover:from-[#ff8c00] hover:to-[#ff4500] text-black font-['Orbitron'] font-bold tracking-widest py-4 rounded-sm transition-all border border-[#ff8c00] shadow-[0_0_15px_rgba(255,140,0,0.4)] hover:shadow-[0_0_25px_rgba(255,140,0,0.6)] uppercase">
                  AUTHENTICATE
                </button>
              </div>
            ) : (
              <div className="space-y-5 animate-in fade-in zoom-in duration-300">
                <div className="space-y-1">
                  <label className="text-xs text-[#ffd700] uppercase tracking-widest">New Identity</label>
                  <input 
                    type="text" 
                    className="w-full bg-black/50 border border-[#ffd700]/30 rounded-sm p-3 text-[#e0e0e0] focus:border-[#ffd700] focus:outline-none focus:ring-1 focus:ring-[#ffd700]/50 transition-all font-['Share_Tech_Mono']"
                    placeholder="Desired username"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-[#ffd700] uppercase tracking-widest">Secure Key</label>
                  <input 
                    type="password" 
                    className="w-full bg-black/50 border border-[#ffd700]/30 rounded-sm p-3 text-[#e0e0e0] focus:border-[#ffd700] focus:outline-none focus:ring-1 focus:ring-[#ffd700]/50 transition-all font-['Share_Tech_Mono']"
                    placeholder="••••••••"
                  />
                </div>
                <button className="w-full mt-4 bg-gradient-to-r from-[#ffd700]/80 to-[#ff8c00]/80 hover:from-[#ffd700] hover:to-[#ff8c00] text-black font-['Orbitron'] font-bold tracking-widest py-4 rounded-sm transition-all border border-[#ffd700] shadow-[0_0_15px_rgba(255,215,0,0.4)] hover:shadow-[0_0_25px_rgba(255,215,0,0.6)] uppercase">
                  REGISTER & INSERT COIN
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Center Column - Status & Timer (Focal Point) */}
        <div className="flex flex-col gap-6">
          {/* Shutdown Timer */}
          <div className="bg-[#111]/80 border border-[#ff4500]/40 rounded-sm p-8 flex flex-col items-center justify-center relative shadow-[0_0_40px_rgba(255,69,0,0.15)] flex-1 backdrop-blur-sm">
             {/* Corner accents */}
             <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-[#ff4500]"></div>
             <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-[#ff4500]"></div>

             <div className="text-[#ff4500] font-['Share_Tech_Mono'] uppercase tracking-[0.3em] text-sm mb-4">
               Auto-Shutdown Imminent
             </div>
             
             <div className="font-['Orbitron'] text-7xl lg:text-8xl font-black text-[#ff4500] mb-8 tabular-nums tracking-widest" style={{ textShadow: '0 0 30px rgba(255,69,0,0.6), 0 0 60px rgba(255,69,0,0.3)' }}>
               03:00
             </div>

             <div className="w-full max-w-sm h-3 bg-black border border-[#ff4500]/30 rounded-full overflow-hidden relative">
               <div className="absolute top-0 left-0 h-full w-[15%] bg-gradient-to-r from-[#ff8c00] to-[#ff4500] shadow-[0_0_10px_#ff4500] animate-pulse"></div>
             </div>
             
             <div className="mt-4 text-[#e0e0e0]/50 text-xs uppercase tracking-widest">
               Insert coin to extend session
             </div>
          </div>

          {/* System Status */}
          <div className="bg-black/60 border border-red-500/30 p-4 rounded-sm relative">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500/50"></div>
            <div className="font-['Share_Tech_Mono'] text-red-400 text-sm break-words flex items-start gap-3">
              <span className="text-red-500 animate-pulse mt-1">⚠️</span>
              <div>
                [ hotspot offline: Cannot reach pisonet.app: fetch failed ]
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Announcements */}
        <div className="bg-[#111]/80 border border-[#ff8c00]/20 rounded-sm relative p-6 flex flex-col backdrop-blur-sm">
           {/* Corner accents */}
           <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-[#ff8c00]/50"></div>
           <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-[#ff8c00]/50"></div>

           <div className="flex items-center justify-between border-b border-[#ff8c00]/20 pb-3 mb-4">
             <h2 className="font-['Orbitron'] text-[#ff8c00] uppercase tracking-widest text-lg font-bold">Network Broadcasts</h2>
             <div className="flex gap-1">
               <div className="w-2 h-2 bg-[#ff8c00]/50 rounded-sm"></div>
               <div className="w-2 h-2 bg-[#ff8c00]/50 rounded-sm"></div>
               <div className="w-2 h-2 bg-[#ff8c00] rounded-sm"></div>
             </div>
           </div>

           <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar">
             {/* Announcement Item */}
             <div className="bg-[#ff8c00]/5 border-l-2 border-[#ff8c00] p-3">
               <div className="text-[#ff8c00]/60 text-xs mb-1">SYSTEM_ADMIN // 14:02</div>
               <div className="text-[#e0e0e0] text-sm">hahaha</div>
             </div>
             
             {/* Announcement Item */}
             <div className="bg-white/5 border-l-2 border-white/20 p-3">
               <div className="text-white/40 text-xs mb-1">MAINTENANCE // 09:00</div>
               <div className="text-[#e0e0e0]/70 text-sm">Servers will reboot at 0300 hours. Please save all work.</div>
             </div>

              {/* Announcement Item */}
              <div className="bg-[#ffd700]/5 border-l-2 border-[#ffd700]/50 p-3">
               <div className="text-[#ffd700]/60 text-xs mb-1">PROMO_SYS // 00:00</div>
               <div className="text-[#e0e0e0]/70 text-sm">Double time credits active between 2AM - 6AM.</div>
             </div>
           </div>

           <div className="mt-4 pt-4 border-t border-[#ff8c00]/20 flex justify-between items-center text-xs text-[#ff8c00]/40">
             <span>END OF FEED</span>
             <span>v2.4.9</span>
           </div>
        </div>

      </main>
      
      {/* Custom Scrollbar CSS */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.5);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 140, 0, 0.3);
          border-radius: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 140, 0, 0.6);
        }
      `}} />
    </div>
  );
}
