import React, { useState } from 'react';
import './_group.css';

export function CenteredStack() {
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');

  return (
    <div className="min-h-screen w-full relative flex flex-col items-center justify-center p-4 sm:p-8 overflow-hidden bg-[#0a0a0a] text-[#e0e0e0] font-sans selection:bg-[#ff8c00]/30">
      {/* Background Image & Overlays */}
      <div className="absolute inset-0 z-0">
        <img 
          src="/__mockup/images/loginimage.jpg" 
          alt="Cyberpunk Background" 
          className="w-full h-full object-cover opacity-20 filter grayscale-[50%] sepia-[20%] hue-rotate-[-30deg]" 
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a]/80 via-[#0a0a0a]/90 to-[#0a0a0a]"></div>
        {/* Scanlines */}
        <div 
          className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-30"
          style={{
            backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,140,0,0.15) 2px, rgba(255,140,0,0.15) 4px)`
          }}
        ></div>
        {/* Grid */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,140,0,0.1) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,140,0,0.1) 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px'
          }}
        ></div>
      </div>

      {/* Main Content Column */}
      <div className="relative z-10 w-full max-w-md flex flex-col gap-6">
        
        {/* Header */}
        <div className="text-center flex flex-col items-center gap-2">
          <div className="inline-flex items-center justify-center p-2 border border-[#ff8c00]/30 rounded bg-[#ff8c00]/5 mb-2 shadow-[0_0_15px_rgba(255,140,0,0.15)]">
             <div className="w-2 h-2 rounded-full bg-[#ff8c00] shadow-[0_0_8px_#ff8c00] animate-pulse mr-2"></div>
             <span className="font-['Share_Tech_Mono'] text-xs text-[#ff8c00] tracking-widest uppercase">System Online</span>
          </div>
          <h1 className="font-['Orbitron'] text-4xl sm:text-5xl font-black text-[#ff8c00] tracking-[0.15em] uppercase drop-shadow-[0_0_10px_rgba(255,140,0,0.8)]">
            COMPUTER SHOP
          </h1>
          <div className="w-full h-px bg-gradient-to-r from-transparent via-[#ff8c00] to-transparent opacity-50 mt-1"></div>
        </div>

        {/* Tab Switcher */}
        <div className="flex w-full border-b border-[#ff8c00]/20 mt-4">
          <button 
            className={`flex-1 py-3 text-center font-['Orbitron'] tracking-wider text-sm uppercase transition-all duration-300 ${
              activeTab === 'login' 
                ? 'text-[#ff8c00] border-b-2 border-[#ff8c00] bg-[#ff8c00]/10' 
                : 'text-[#6a6a6a] hover:text-[#e0e0e0] hover:bg-white/5'
            }`}
            onClick={() => setActiveTab('login')}
          >
            Login
          </button>
          <button 
            className={`flex-1 py-3 text-center font-['Orbitron'] tracking-wider text-sm uppercase transition-all duration-300 ${
              activeTab === 'register' 
                ? 'text-[#ff8c00] border-b-2 border-[#ff8c00] bg-[#ff8c00]/10' 
                : 'text-[#6a6a6a] hover:text-[#e0e0e0] hover:bg-white/5'
            }`}
            onClick={() => setActiveTab('register')}
          >
            Register
          </button>
        </div>

        {/* Form Container */}
        <div className="bg-[#111111]/80 backdrop-blur-md border border-[#ff8c00]/20 p-6 rounded-sm shadow-[0_0_30px_rgba(0,0,0,0.8)] relative">
          
          {/* Corner Accents */}
          <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-[#ff8c00]"></div>
          <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-[#ff8c00]"></div>
          <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-[#ff8c00]"></div>
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-[#ff8c00]"></div>

          <div className="space-y-5">
            <div>
              <label className="block font-['Share_Tech_Mono'] text-xs text-[#ff8c00] uppercase tracking-widest mb-2">Username</label>
              <input 
                type="text" 
                className="w-full bg-[#0a0a0a] border border-[#ff8c00]/30 text-[#e0e0e0] font-['Share_Tech_Mono'] text-lg px-4 py-3 outline-none focus:border-[#ff8c00] focus:ring-1 focus:ring-[#ff8c00]/50 transition-all placeholder:text-[#6a6a6a]"
                placeholder="Enter ID"
              />
            </div>
            
            <div>
              <label className="block font-['Share_Tech_Mono'] text-xs text-[#ff8c00] uppercase tracking-widest mb-2">Password</label>
              <input 
                type="password" 
                className="w-full bg-[#0a0a0a] border border-[#ff8c00]/30 text-[#e0e0e0] font-['Share_Tech_Mono'] text-lg px-4 py-3 outline-none focus:border-[#ff8c00] focus:ring-1 focus:ring-[#ff8c00]/50 transition-all placeholder:text-[#6a6a6a]"
                placeholder="••••••••"
              />
            </div>

            <button className="w-full relative group overflow-hidden bg-gradient-to-r from-[#ff8c00]/20 to-[#ff4500]/20 hover:from-[#ff8c00]/40 hover:to-[#ff4500]/40 border border-[#ff8c00] text-[#ff8c00] hover:text-white font-['Orbitron'] font-bold text-sm tracking-[0.2em] py-4 uppercase transition-all duration-300 mt-2 shadow-[0_0_15px_rgba(255,140,0,0.3)] hover:shadow-[0_0_25px_rgba(255,140,0,0.6)]">
              <span className="relative z-10">{activeTab === 'login' ? 'AUTHENTICATE' : 'REGISTER & INSERT COIN'}</span>
              <div className="absolute inset-0 bg-[#ff8c00]/10 transform -translate-x-full group-hover:translate-x-0 transition-transform duration-500 ease-out"></div>
            </button>
          </div>
        </div>

        {/* Status Area */}
        <div className="space-y-4 mt-2">
          
          {/* Hotspot Status */}
          <div className="bg-[#111111]/90 border border-red-900/50 p-3 flex items-start gap-3 rounded-sm font-['Share_Tech_Mono'] text-xs text-red-500/80">
            <span className="shrink-0 text-red-500 font-bold mt-0.5">!</span>
            <p className="leading-relaxed break-all">
              [ hotspot offline: Cannot reach pisonet.app: fetch failed ]
            </p>
          </div>

          {/* Auto-shutdown Timer */}
          <div className="bg-[#111111]/90 border border-[#ff8c00]/20 p-4 rounded-sm">
            <div className="flex justify-between items-end mb-2">
              <span className="font-['Share_Tech_Mono'] text-xs text-[#ff8c00] uppercase tracking-wider">Auto-Shutdown Sequence</span>
              <span className="font-['Orbitron'] text-xl font-bold text-[#ff8c00] drop-shadow-[0_0_5px_#ff8c00]">03:00</span>
            </div>
            <div className="h-1.5 w-full bg-[#0a0a0a] rounded-full overflow-hidden border border-[#ff8c00]/20">
              <div className="h-full bg-gradient-to-r from-[#ff8c00] to-[#ff4500] w-[60%] shadow-[0_0_10px_#ff8c00]"></div>
            </div>
          </div>

        </div>

        {/* Announcements */}
        <div className="mt-4 text-center pb-8">
          <div className="inline-block relative">
            <div className="absolute -inset-1 bg-[#ff8c00]/10 blur-sm rounded-full"></div>
            <div className="relative font-['Share_Tech_Mono'] text-sm text-[#ff8c00] py-1 px-4 border-y border-[#ff8c00]/30 bg-[#0a0a0a]/50 backdrop-blur-sm">
              <span className="opacity-70 mr-2">»</span>
              hahaha
              <span className="opacity-70 ml-2">«</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
