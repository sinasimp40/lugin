import React, { useState } from 'react';
import { User, Lock, Terminal, Activity, Zap, AlertTriangle, Monitor, ArrowRight } from 'lucide-react';
import './_group.css';

export function AsymmetricGrid() {
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e0e0e0] font-['Share_Tech_Mono'] relative overflow-hidden flex flex-col selection:bg-[#ff8c00] selection:text-black">
      {/* Ambient Grid Background */}
      <div 
        className="absolute inset-0 z-0 pointer-events-none opacity-30"
        style={{
          backgroundImage: `linear-gradient(rgba(255, 140, 0, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 140, 0, 0.2) 1px, transparent 1px)`,
          backgroundSize: '40px 40px'
        }}
      />
      {/* Scanlines */}
      <div 
        className="absolute inset-0 z-0 pointer-events-none opacity-20 mix-blend-overlay"
        style={{
          background: `repeating-linear-gradient(0deg, transparent, transparent 2px, #ff8c00 2px, #ff8c00 4px)`
        }}
      />

      <div className="relative z-10 flex-1 flex flex-col w-full h-screen p-4 md:p-6 lg:p-8">
        
        {/* ROW 1: BRANDING (Spans full top row) */}
        <header className="flex-none mb-6 relative flex justify-between items-end border-b border-[#ff8c00]/40 pb-4">
          <div>
            <div className="flex items-center gap-3 text-[#ff8c00] mb-2 opacity-80">
              <Activity size={18} className="animate-pulse" />
              <span className="tracking-[0.3em] text-xs uppercase">System Status: Online</span>
            </div>
            <h1 className="font-['Orbitron'] text-4xl md:text-5xl lg:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#ff8c00] to-[#ff4500] tracking-widest uppercase filter drop-shadow-[0_0_15px_rgba(255,140,0,0.6)]">
              COMPUTER SHOP
            </h1>
          </div>
          <div className="hidden md:flex items-center gap-2 text-[#ff8c00]/60 border border-[#ff8c00]/20 px-3 py-1 bg-black/50">
            <Monitor size={14} />
            <span className="text-xs tracking-wider">TERMINAL_01</span>
          </div>
          <div className="absolute bottom-0 left-0 h-[2px] w-1/3 bg-gradient-to-r from-[#ff8c00] to-transparent shadow-[0_0_10px_#ff8c00]" />
        </header>

        {/* ROW 2: ASYMMETRIC CONTENT GRID */}
        <main className="flex-1 grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6 min-h-0 mb-6">
          
          {/* CELL 1: LOGIN FORM (Larger bottom-left cell) */}
          <div className="relative flex flex-col bg-[#0a0a0a]/80 backdrop-blur-md border border-[#ff8c00]/30 shadow-[inset_0_0_40px_rgba(0,0,0,0.8)] overflow-hidden">
            <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-[#ff8c00] opacity-70" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-[#ff8c00] opacity-70" />
            
            <div className="p-8 lg:p-12 flex-1 flex flex-col h-full overflow-y-auto">
              {/* Tab Switcher */}
              <div className="flex gap-8 border-b border-[#ff8c00]/20 pb-4 mb-10">
                <button 
                  onClick={() => setActiveTab('login')}
                  className={`font-['Orbitron'] text-2xl uppercase tracking-[0.15em] transition-all relative pb-2 ${activeTab === 'login' ? 'text-[#ff8c00] drop-shadow-[0_0_8px_rgba(255,140,0,0.8)]' : 'text-[#ff8c00]/40 hover:text-[#ff8c00]/80'}`}
                >
                  <span className="relative z-10">LOGIN</span>
                  {activeTab === 'login' && (
                    <span className="absolute -bottom-[18px] left-0 w-full h-[3px] bg-[#ff8c00] shadow-[0_0_15px_#ff8c00]" />
                  )}
                </button>
                <button 
                  onClick={() => setActiveTab('register')}
                  className={`font-['Orbitron'] text-2xl uppercase tracking-[0.15em] transition-all relative pb-2 ${activeTab === 'register' ? 'text-[#ff8c00] drop-shadow-[0_0_8px_rgba(255,140,0,0.8)]' : 'text-[#ff8c00]/40 hover:text-[#ff8c00]/80'}`}
                >
                  <span className="relative z-10">REGISTER</span>
                  {activeTab === 'register' && (
                    <span className="absolute -bottom-[18px] left-0 w-full h-[3px] bg-[#ff8c00] shadow-[0_0_15px_#ff8c00]" />
                  )}
                </button>
              </div>

              {/* Form Area */}
              <div className="flex-1 flex flex-col justify-center max-w-xl w-full mx-auto space-y-8">
                <div className="space-y-3 relative">
                  <label className="text-[#ff8c00] text-sm tracking-[0.2em] flex items-center gap-2">
                    <User size={16} /> USERNAME_
                  </label>
                  <div className="relative">
                    <input 
                      type="text" 
                      className="w-full bg-black/60 border border-[#ff8c00]/40 px-6 py-4 text-xl text-white outline-none focus:border-[#ff8c00] focus:shadow-[0_0_20px_rgba(255,140,0,0.3)] transition-all font-['Share_Tech_Mono'] tracking-wider placeholder:text-[#ff8c00]/20" 
                      placeholder="ENTER_IDENTIFIER" 
                    />
                    <div className="absolute right-0 top-0 bottom-0 w-1 bg-gradient-to-b from-transparent via-[#ff8c00]/30 to-transparent" />
                  </div>
                </div>

                <div className="space-y-3 relative">
                  <label className="text-[#ff8c00] text-sm tracking-[0.2em] flex items-center gap-2">
                    <Lock size={16} /> PASSWORD_
                  </label>
                  <div className="relative">
                    <input 
                      type="password" 
                      className="w-full bg-black/60 border border-[#ff8c00]/40 px-6 py-4 text-xl text-white outline-none focus:border-[#ff8c00] focus:shadow-[0_0_20px_rgba(255,140,0,0.3)] transition-all font-['Share_Tech_Mono'] tracking-wider placeholder:text-[#ff8c00]/20" 
                      placeholder="ENTER_ACCESS_CODE" 
                    />
                    <div className="absolute right-0 top-0 bottom-0 w-1 bg-gradient-to-b from-transparent via-[#ff8c00]/30 to-transparent" />
                  </div>
                </div>

                <button className="mt-8 relative overflow-hidden bg-[#ff8c00]/10 border border-[#ff8c00] py-5 px-8 transition-all hover:bg-[#ff8c00]/20 hover:shadow-[0_0_30px_rgba(255,140,0,0.4)] group">
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#ff8c00]/30 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />
                  <span className="relative z-10 font-['Orbitron'] font-bold text-2xl tracking-[0.2em] text-[#ff8c00] group-hover:text-white transition-colors flex items-center justify-center gap-4">
                    <Zap size={24} className={activeTab === 'login' ? 'animate-pulse' : ''} />
                    {activeTab === 'login' ? 'AUTHENTICATE' : 'REGISTER & INSERT COIN'}
                    <ArrowRight size={24} className="opacity-0 group-hover:opacity-100 -translate-x-4 group-hover:translate-x-0 transition-all" />
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* CELL 2: TIMERS & STATUS (Smaller bottom-right cell with bleeding image) */}
          <div className="relative flex flex-col border border-[#ff8c00]/20 overflow-hidden bg-black/60">
            {/* Bleeding Background Image behind right column */}
            <div className="absolute inset-0 z-0 opacity-40 mix-blend-screen filter contrast-125 saturate-150">
              <img 
                src="/__mockup/images/loginimage.jpg" 
                className="w-full h-full object-cover object-center" 
                alt="Cyberpunk ambient background" 
              />
              <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a]/80 via-transparent to-[#0a0a0a]/90" />
              <div className="absolute inset-0 bg-[#ff8c00] mix-blend-overlay opacity-20" />
            </div>

            <div className="relative z-10 p-6 lg:p-8 flex flex-col h-full gap-6">
              {/* Tech Details Decor */}
              <div className="flex justify-between items-start mb-auto">
                <div className="flex flex-col gap-1">
                  <div className="h-[1px] w-12 bg-[#ff8c00]/40" />
                  <div className="h-[1px] w-8 bg-[#ff8c00]/40" />
                  <div className="h-[1px] w-4 bg-[#ff8c00]/40" />
                </div>
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-[#ff8c00]/60 animate-pulse" />
                  <div className="w-2 h-2 bg-[#ff8c00]/40" />
                  <div className="w-2 h-2 bg-[#ff8c00]/20" />
                </div>
              </div>

              {/* Shutdown Timer */}
              <div className="bg-black/80 backdrop-blur-sm border border-[#ff8c00]/40 p-6 shadow-[0_0_20px_rgba(0,0,0,0.8)] relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-[#ff8c00]/10 to-transparent pointer-events-none" />
                
                <h2 className="font-['Orbitron'] text-lg text-[#ff8c00]/80 tracking-[0.2em] mb-4 flex items-center gap-2">
                  <AlertTriangle size={18} className="text-[#ff8c00]" />
                  AUTO-SHUTDOWN
                </h2>
                
                <div className="font-['Orbitron'] text-7xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-[#ff8c00] mb-6 tracking-wider filter drop-shadow-[0_0_15px_rgba(255,140,0,0.8)] text-center">
                  03:00
                </div>
                
                <div className="h-4 w-full bg-black border border-[#ff8c00]/40 relative overflow-hidden p-[2px]">
                  <div 
                    className="h-full bg-gradient-to-r from-[#ff4500] to-[#ff8c00] shadow-[0_0_15px_#ff8c00] relative"
                    style={{ width: '45%' }}
                  >
                    <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPjxwYXRoIGQ9Ik0wIDBoNHY0SDB6IiBmaWxsPSJibGFjayIgZmlsbC1vcGFjaXR5PSIwLjIiLz48L3N2Zz4=')] opacity-50" />
                  </div>
                </div>
                <div className="flex justify-between text-sm text-[#ff8c00]/60 mt-3 font-mono">
                  <span>WARNING_LEVEL: CRITICAL</span>
                  <span>45%</span>
                </div>
              </div>

              {/* Hotspot Status */}
              <div className="bg-[#1a0500]/90 backdrop-blur-md border border-red-500/50 p-5 relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500 shadow-[0_0_10px_red]" />
                <div className="flex items-center gap-2 mb-3 font-bold text-red-500 tracking-wider text-sm">
                  <AlertTriangle size={16} className="animate-pulse" />
                  <span>HOTSPOT_STATUS</span>
                </div>
                <p className="text-red-400 font-mono text-sm leading-relaxed">
                  [ hotspot offline: Cannot reach pisonet.app: fetch failed ]
                </p>
              </div>
            </div>
          </div>
        </main>

        {/* ROW 3: ANNOUNCEMENTS (Thin full-width bar at bottom) */}
        <footer className="flex-none bg-black/80 backdrop-blur-md border border-[#ff8c00]/40 relative flex items-center overflow-hidden h-12 shadow-[0_-5px_20px_rgba(0,0,0,0.5)]">
          <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-[#ff8c00]" />
          <div className="flex items-center text-[#ff8c00] bg-[#ff8c00]/10 h-full px-6 border-r border-[#ff8c00]/20 whitespace-nowrap z-10 shadow-[5px_0_10px_rgba(0,0,0,0.5)]">
            <Terminal size={16} className="mr-3" />
            <span className="font-['Orbitron'] text-sm font-bold tracking-widest">ANNOUNCEMENT</span>
          </div>
          <div className="flex-1 overflow-hidden relative h-full flex items-center">
            <p className="text-[#ff8c00]/80 text-sm uppercase tracking-[0.3em] whitespace-nowrap animate-[marquee_20s_linear_infinite] ml-4">
              hahaha • WELCOME TO COMPUTER SHOP • NO VAPING INSIDE • PLAY RESPONSIBLY • hahaha
            </p>
          </div>
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes marquee {
              0% { transform: translateX(100%); }
              100% { transform: translateX(-100%); }
            }
          `}} />
        </footer>

      </div>
    </div>
  );
}
