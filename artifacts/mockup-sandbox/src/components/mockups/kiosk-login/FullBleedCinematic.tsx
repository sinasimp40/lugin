import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { WifiOff, Clock, Megaphone, Terminal } from "lucide-react";

export function FullBleedCinematic() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-black text-white font-sans selection:bg-orange-500/30">
      {/* Cinematic Full-Bleed Background */}
      <div 
        className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat transition-transform duration-10000 hover:scale-105"
        style={{ backgroundImage: 'url("/__mockup/images/cyberpunk-anime-bg.png")' }}
      >
        {/* Gradients for depth and readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/20 to-transparent" />
        {/* Grain overlay */}
        <div className="absolute inset-0 opacity-[0.03] mix-blend-overlay pointer-events-none" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")' }} />
      </div>

      {/* Top Bar - Status & Atmosphere */}
      <header className="absolute top-0 inset-x-0 z-10 flex justify-between items-start p-8 pointer-events-none">
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold tracking-tighter text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">
            COMPUTEI GWPP
          </h1>
          <div className="flex items-center gap-2 text-sm font-mono text-orange-400/80 drop-shadow-[0_0_8px_rgba(249,115,22,0.5)]">
            <Terminal className="w-4 h-4" />
            <span>SYSTEM_LOCKED // AWAITING_AUTH</span>
          </div>
        </div>

        {/* Shutdown Timer & Status */}
        <div className="flex flex-col items-end gap-4">
          <div className="flex items-center gap-3 bg-red-950/40 border border-red-500/20 backdrop-blur-md px-6 py-3 rounded-full text-red-400 shadow-[0_0_30px_rgba(220,38,38,0.15)]">
            <Clock className="w-5 h-5 animate-pulse" />
            <div className="flex flex-col items-end">
              <span className="text-xs font-semibold tracking-widest uppercase opacity-80">Auto Shutdown</span>
              <span className="text-2xl font-mono font-bold leading-none">02:47</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2 bg-black/40 backdrop-blur-sm border border-white/10 px-4 py-2 rounded-full text-sm text-gray-400">
            <WifiOff className="w-4 h-4 text-gray-500" />
            <span className="font-mono">hotspot offline</span>
          </div>
        </div>
      </header>

      {/* Floating Login Panel (Lower Left) */}
      <main className="absolute bottom-16 left-12 z-20 w-[420px]">
        <div className="bg-black/40 backdrop-blur-2xl border border-white/10 rounded-3xl p-8 shadow-2xl relative overflow-hidden group">
          {/* Subtle glow effect behind panel */}
          <div className="absolute -inset-1 bg-gradient-to-r from-orange-500/20 to-purple-500/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          
          <div className="relative z-10">
            <Tabs defaultValue="login" className="w-full">
              <TabsList className="w-full grid grid-cols-2 mb-8 bg-white/5 border border-white/10 rounded-xl p-1">
                <TabsTrigger value="login" className="rounded-lg data-[state=active]:bg-white/10 data-[state=active]:text-white text-gray-400 transition-all">Authenticate</TabsTrigger>
                <TabsTrigger value="register" className="rounded-lg data-[state=active]:bg-white/10 data-[state=active]:text-white text-gray-400 transition-all">New User</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Access ID</Label>
                    <Input 
                      placeholder="Enter username..." 
                      className="bg-white/5 border-white/10 focus-visible:ring-orange-500/50 text-white placeholder:text-gray-600 h-12 px-4 rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Passcode</Label>
                      <button className="text-xs text-orange-400 hover:text-orange-300 transition-colors">Recover</button>
                    </div>
                    <Input 
                      type="password" 
                      placeholder="••••••••" 
                      className="bg-white/5 border-white/10 focus-visible:ring-orange-500/50 text-white placeholder:text-gray-600 h-12 px-4 rounded-xl font-mono"
                    />
                  </div>
                </div>
                <Button className="w-full h-12 bg-orange-600 hover:bg-orange-500 text-white rounded-xl shadow-[0_0_20px_rgba(234,88,12,0.3)] hover:shadow-[0_0_30px_rgba(234,88,12,0.5)] transition-all font-semibold tracking-wide text-lg">
                  INITIALIZE SESSION
                </Button>
              </TabsContent>

              <TabsContent value="register" className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Choose Access ID</Label>
                    <Input 
                      placeholder="New username..." 
                      className="bg-white/5 border-white/10 focus-visible:ring-orange-500/50 text-white placeholder:text-gray-600 h-12 px-4 rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Set Passcode</Label>
                    <Input 
                      type="password" 
                      placeholder="••••••••" 
                      className="bg-white/5 border-white/10 focus-visible:ring-orange-500/50 text-white placeholder:text-gray-600 h-12 px-4 rounded-xl font-mono"
                    />
                  </div>
                </div>
                <Button variant="outline" className="w-full h-12 bg-white/5 border-white/10 hover:bg-white/10 hover:text-white text-gray-300 rounded-xl transition-all font-medium tracking-wide">
                  REGISTER TERMINAL
                </Button>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>

      {/* Marquee Footer */}
      <footer className="absolute bottom-0 inset-x-0 h-12 bg-black/80 backdrop-blur-md border-t border-white/10 z-10 overflow-hidden flex items-center">
        <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-black to-transparent z-20 flex items-center px-4 border-r border-white/10">
          <div className="flex items-center gap-2 text-orange-400">
            <Megaphone className="w-4 h-4" />
            <span className="text-xs font-bold tracking-widest uppercase">Alert</span>
          </div>
        </div>
        <div className="whitespace-nowrap animate-[marquee_20s_linear_infinite] pl-[100%] text-sm text-gray-400 font-mono flex items-center gap-12">
          <span>SERVER MAINTENANCE SCHEDULED FOR 03:00 AM. ALL SESSIONS WILL BE TERMINATED.</span>
          <span className="text-orange-500/50">•</span>
          <span>PROMO: RECHARGE 5 HOURS, GET 1 HOUR FREE. SEE ADMIN COUNTER.</span>
          <span className="text-orange-500/50">•</span>
          <span>NO FOOD OR DRINKS NEAR THE TERMINALS. VIOLATORS WILL BE BANNED.</span>
        </div>
      </footer>
    </div>
  );
}
