import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WifiOff, ChevronRight, Lock, User, Radio, AlertTriangle } from "lucide-react";

export function AmbientStatusFirst() {
  const [loginVisible, setLoginVisible] = useState(false);
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div 
      className="min-h-screen w-full bg-zinc-950 text-zinc-100 overflow-hidden font-mono flex flex-col relative select-none"
      style={{
        backgroundImage: `url('/__mockup/images/industrial-bg.png')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundBlendMode: 'overlay',
        backgroundColor: 'rgba(9, 9, 11, 0.85)'
      }}
    >
      {/* Ticker Tape Top */}
      <div className="bg-red-950/80 border-b border-red-900/50 text-red-500 py-2 overflow-hidden whitespace-nowrap flex items-center relative z-10 font-bold uppercase tracking-widest text-sm">
        <div className="animate-marquee inline-block">
          <span className="mx-8"><AlertTriangle className="inline w-4 h-4 mr-2 mb-1" /> SYSTEM MAINTENANCE SCHEDULED FOR 03:00 AM</span>
          <span className="mx-8">NO EATING OR DRINKING AT THE TERMINALS</span>
          <span className="mx-8">PROMO: 5 HOURS FOR ₱100 UNTIL MIDNIGHT</span>
          <span className="mx-8"><AlertTriangle className="inline w-4 h-4 mr-2 mb-1" /> PLEASE LOG OUT PROPERLY BEFORE LEAVING</span>
          <span className="mx-8"><AlertTriangle className="inline w-4 h-4 mr-2 mb-1" /> SYSTEM MAINTENANCE SCHEDULED FOR 03:00 AM</span>
          <span className="mx-8">NO EATING OR DRINKING AT THE TERMINALS</span>
          <span className="mx-8">PROMO: 5 HOURS FOR ₱100 UNTIL MIDNIGHT</span>
          <span className="mx-8"><AlertTriangle className="inline w-4 h-4 mr-2 mb-1" /> PLEASE LOG OUT PROPERLY BEFORE LEAVING</span>
        </div>
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes marquee {
            0% { transform: translateX(0%); }
            100% { transform: translateX(-50%); }
          }
          .animate-marquee {
            animation: marquee 30s linear infinite;
          }
        `}} />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 relative z-0" onClick={() => setLoginVisible(false)}>
        
        {/* Header Info */}
        <div className="absolute top-12 left-12 flex items-center gap-6 opacity-70">
          <div className="flex flex-col">
            <span className="text-zinc-500 text-xs font-bold tracking-[0.2em] mb-1">TERMINAL</span>
            <span className="text-2xl font-black text-zinc-300 tracking-wider">PC-04</span>
          </div>
          <div className="w-px h-8 bg-zinc-800"></div>
          <div className="flex flex-col">
            <span className="text-zinc-500 text-xs font-bold tracking-[0.2em] mb-1">LOCATION</span>
            <span className="text-xl font-bold text-zinc-400 tracking-widest">COMPUTEI GWPP</span>
          </div>
        </div>

        {/* Hotspot Status Badge */}
        <div className="absolute top-12 right-12 flex flex-col items-end opacity-80">
          <span className="text-zinc-500 text-xs font-bold tracking-[0.2em] mb-2">NETWORK STATUS</span>
          <div className="flex items-center gap-3 bg-zinc-900/80 border border-zinc-800 px-4 py-2 rounded">
            <div className="flex items-center justify-center w-3 h-3 rounded-full bg-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.8)]"></div>
            <span className="text-red-500 font-bold tracking-widest">HOTSPOT: OFFLINE</span>
            <WifiOff className="w-5 h-5 text-red-500 ml-2" />
          </div>
        </div>

        {/* Massive Countdown */}
        <div className="flex flex-col items-center justify-center w-full max-w-6xl mt-12">
          <div className="text-zinc-600 text-xl font-bold tracking-[0.5em] mb-6 uppercase text-center w-full relative">
            <span className="bg-zinc-950 px-4 relative z-10">AUTO-SHUTDOWN IN</span>
            <div className="absolute top-1/2 left-0 w-full h-px bg-zinc-800/50 z-0"></div>
          </div>
          
          {/* Departures Board Style Clock */}
          <div className="flex gap-4 mb-8">
            <div className="flex gap-2">
              {/* Minutes */}
              <div className="bg-zinc-900 border-2 border-zinc-800 rounded-lg p-6 relative overflow-hidden shadow-2xl">
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-zinc-950/50 pointer-events-none"></div>
                <div className="absolute top-1/2 left-0 w-full h-1 bg-zinc-950 z-10 opacity-80 shadow-inner"></div>
                <span className="text-[12rem] leading-none font-black text-zinc-100 tabular-nums">0</span>
              </div>
              <div className="bg-zinc-900 border-2 border-zinc-800 rounded-lg p-6 relative overflow-hidden shadow-2xl">
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-zinc-950/50 pointer-events-none"></div>
                <div className="absolute top-1/2 left-0 w-full h-1 bg-zinc-950 z-10 opacity-80 shadow-inner"></div>
                <span className="text-[12rem] leading-none font-black text-zinc-100 tabular-nums">2</span>
              </div>
            </div>
            
            <div className="flex flex-col justify-center gap-8 py-8">
              <div className="w-6 h-6 rounded-sm bg-zinc-700 animate-pulse"></div>
              <div className="w-6 h-6 rounded-sm bg-zinc-700 animate-pulse"></div>
            </div>
            
            <div className="flex gap-2">
              {/* Seconds */}
              <div className="bg-zinc-900 border-2 border-zinc-800 rounded-lg p-6 relative overflow-hidden shadow-2xl">
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-zinc-950/50 pointer-events-none"></div>
                <div className="absolute top-1/2 left-0 w-full h-1 bg-zinc-950 z-10 opacity-80 shadow-inner"></div>
                <span className="text-[12rem] leading-none font-black text-zinc-100 tabular-nums">4</span>
              </div>
              <div className="bg-zinc-900 border-2 border-zinc-800 rounded-lg p-6 relative overflow-hidden shadow-2xl">
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-zinc-950/50 pointer-events-none"></div>
                <div className="absolute top-1/2 left-0 w-full h-1 bg-zinc-950 z-10 opacity-80 shadow-inner"></div>
                <span className="text-[12rem] leading-none font-black text-zinc-100 tabular-nums">7</span>
              </div>
            </div>
          </div>
          
          <div className="text-zinc-600 text-sm font-bold tracking-[0.2em] uppercase flex items-center gap-4">
            <Radio className="w-4 h-4 text-zinc-500" />
            BROADCASTING MACHINE STATE
            <Radio className="w-4 h-4 text-zinc-500" />
          </div>
        </div>
      </div>

      {/* Slide-in Login Panel */}
      <div 
        className={`absolute top-0 right-0 h-full w-[450px] bg-zinc-950 border-l border-zinc-800 shadow-2xl transition-transform duration-500 ease-in-out transform ${loginVisible ? 'translate-x-0' : 'translate-x-full'} flex flex-col z-50`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-8 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-black tracking-widest text-white uppercase">Authentication</h2>
            <p className="text-zinc-500 font-bold tracking-widest text-xs mt-2 uppercase">Provide Credentials</p>
          </div>
          <button onClick={() => setLoginVisible(false)} className="text-zinc-500 hover:text-white transition-colors p-2">
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>
        
        <div className="flex-1 p-8 flex flex-col justify-center">
          <form className="space-y-8" onSubmit={(e) => e.preventDefault()}>
            <div className="space-y-2">
              <Label className="text-zinc-400 font-bold tracking-widest text-xs uppercase">Username / ID</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-600" />
                <Input 
                  type="text" 
                  placeholder="Enter User ID" 
                  className="pl-12 bg-zinc-900 border-zinc-800 text-white h-14 font-mono text-lg focus-visible:ring-zinc-700 focus-visible:border-zinc-500 rounded-none uppercase"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label className="text-zinc-400 font-bold tracking-widest text-xs uppercase">Password / PIN</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-600" />
                <Input 
                  type="password" 
                  placeholder="••••••••" 
                  className="pl-12 bg-zinc-900 border-zinc-800 text-white h-14 font-mono text-lg focus-visible:ring-zinc-700 focus-visible:border-zinc-500 rounded-none tracking-[0.5em]"
                />
              </div>
            </div>
            
            <Button type="submit" className="w-full h-16 bg-white hover:bg-zinc-200 text-black font-black tracking-[0.2em] text-lg rounded-none uppercase">
              Authenticate
            </Button>
          </form>
          
          <div className="mt-16 pt-8 border-t border-zinc-900 text-center">
            <p className="text-zinc-500 font-bold tracking-widest text-xs uppercase mb-4">No Access Credentials?</p>
            <Button variant="outline" className="w-full h-12 bg-transparent border-zinc-800 text-zinc-400 hover:bg-zinc-900 hover:text-white font-bold tracking-widest uppercase rounded-none">
              Register New Account
            </Button>
          </div>
        </div>
        
        <div className="p-6 border-t border-zinc-900 flex justify-between items-center text-zinc-600 text-xs font-bold tracking-widest uppercase">
          <span>SYS v2.4.9</span>
          <span>SECURE CONN</span>
        </div>
      </div>

      {/* Persistent Login Trigger (when hidden) */}
      {!loginVisible && (
        <button 
          onClick={(e) => { e.stopPropagation(); setLoginVisible(true); }}
          className="absolute bottom-12 right-12 flex items-center gap-4 group cursor-pointer"
        >
          <div className="flex flex-col items-end">
            <span className="text-zinc-500 font-bold tracking-widest text-xs mb-1">SYSTEM ACCESS</span>
            <span className="text-zinc-300 font-bold tracking-wider group-hover:text-white transition-colors uppercase">PRESS TO LOGIN</span>
          </div>
          <div className="w-16 h-16 bg-zinc-800 border border-zinc-700 rounded flex items-center justify-center group-hover:bg-zinc-700 transition-colors">
            <Lock className="w-6 h-6 text-zinc-400 group-hover:text-white" />
          </div>
        </button>
      )}

    </div>
  );
}
