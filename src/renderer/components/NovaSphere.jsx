import React from 'react';

export default function NovaSphere({ state = 'idle', audioLevel = 0, isConversationActive = false }) {
  // State color matrix
  const getTheme = () => {
    switch (state) {
      case 'listening':
        return {
          core: 'border-blue-400 bg-blue-500/20 shadow-[0_0_50px_rgba(59,130,246,0.6)] text-blue-300',
          ring1: 'border-blue-400/60',
          ring2: 'border-cyan-400/40',
          glow: 'rgba(59,130,246,0.4)',
          status: isConversationActive ? 'LISTENING (SESSION ACTIVE)' : 'STANDBY (WAITING FOR "NOVA")'
        };
      case 'processing':
        return {
          core: 'border-purple-500 bg-purple-600/30 shadow-[0_0_60px_rgba(168,85,247,0.7)] text-purple-200 animate-pulse',
          ring1: 'border-purple-400/70',
          ring2: 'border-pink-500/40',
          glow: 'rgba(168,85,247,0.5)',
          status: 'NEURAL PROCESSING'
        };
      case 'speaking':
        return {
          core: 'border-emerald-400 bg-emerald-500/25 shadow-[0_0_70px_rgba(16,185,129,0.8)] text-emerald-200',
          ring1: 'border-emerald-300/80',
          ring2: 'border-cyan-400/60',
          glow: 'rgba(16,185,129,0.6)',
          status: 'VOCALIZING RESPONSE'
        };
      case 'executing':
        return {
          core: 'border-rose-500 bg-rose-600/30 shadow-[0_0_60px_rgba(244,63,94,0.7)] text-rose-200',
          ring1: 'border-rose-400/80',
          ring2: 'border-amber-400/50',
          glow: 'rgba(244,63,94,0.5)',
          status: 'EXECUTING DIRECTIVE'
        };
      default:
        return {
          core: 'border-cyan-500/40 bg-cyan-950/20 shadow-[0_0_35px_rgba(0,240,255,0.3)] text-cyan-400',
          ring1: 'border-cyan-500/30',
          ring2: 'border-blue-500/20',
          glow: 'rgba(0,240,255,0.2)',
          status: 'STANDBY (SAY "NOVA")'
        };
    }
  };

  const theme = getTheme();
  // Dynamic scale calculation based on real speech audio frequency
  const dynamicScale = state === 'speaking' ? 1 + Math.min(audioLevel * 0.45, 0.5) : 1;

  return (
    <div className="relative flex flex-col items-center justify-center w-full h-full min-h-[380px]">
      {/* Background Ambient Aura */}
      <div
        className="absolute w-96 h-96 rounded-full blur-3xl pointer-events-none transition-all duration-700 opacity-40"
        style={{ backgroundColor: theme.glow }}
      />

      {/* Main Holographic Reactor Container */}
      <div 
        className="relative flex items-center justify-center transition-transform duration-100 ease-out"
        style={{ transform: `scale(${dynamicScale})` }}
      >
        {/* Outermost Orbit Gyro Ring */}
        <div
          className={`absolute w-80 h-80 rounded-full border-2 border-dashed ${theme.ring1} animate-spin-slow opacity-60`}
          style={{ animationDuration: '30s' }}
        />

        {/* Counter Orbit HUD Ring */}
        <div
          className={`absolute w-72 h-72 rounded-full border border-dotted ${theme.ring2} animate-spin-reverse opacity-50`}
          style={{ animationDuration: '22s' }}
        />

        {/* Outer Circular Audio Waveform Grid */}
        <div className="absolute w-64 h-64 rounded-full border border-slate-700/60 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border border-cyan-400/20 animate-ping" style={{ animationDuration: state === 'speaking' ? '1.5s' : '4s' }} />
        </div>

        {/* Central Neural Sphere Core */}
        <div
          className={`relative w-48 h-48 rounded-full border-2 ${theme.core} backdrop-blur-xl flex flex-col items-center justify-center transition-all duration-300 z-10`}
        >
          {/* Holographic Target Crosshairs */}
          <div className="absolute w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" />
          <div className="absolute h-full w-[1px] bg-gradient-to-b from-transparent via-cyan-400/40 to-transparent" />

          {/* System Name / Core Branding */}
          <span className="text-[10px] font-mono tracking-[0.3em] uppercase opacity-75 mb-1">
            N.O.V.A. CORE
          </span>

          {/* Live Frequency Reactive Audio Bars */}
          <div className="flex items-center space-x-1.5 h-10 px-4 my-1">
            {[45, 80, 100, 65, 35, 90, 55, 75, 40].map((baseHeight, i) => {
              const dynamicBar = state === 'speaking'
                ? Math.max(15, baseHeight * (audioLevel * 1.5))
                : state === 'listening'
                ? 25 + Math.sin(Date.now() / 200 + i) * 15
                : 15;

              return (
                <div
                  key={i}
                  className="w-1 rounded-full bg-current transition-all duration-75 ease-out shadow-sm"
                  style={{ height: `${Math.min(100, dynamicBar)}%` }}
                />
              );
            })}
          </div>

          <span className="text-[9px] font-mono tracking-widest uppercase opacity-60">
            AUDIO SYNC: {Math.round(audioLevel * 100)}%
          </span>
        </div>
      </div>

      {/* Futuristic HUD Subtext Badge */}
      <div className="mt-8 flex flex-col items-center space-y-1.5 z-20">
        <div className="flex items-center space-x-2 px-4 py-1 rounded-full bg-slate-900/80 border border-slate-800 backdrop-blur-md">
          <span className={`w-2 h-2 rounded-full ${isConversationActive ? 'bg-emerald-400 animate-ping' : 'bg-cyan-400 animate-pulse'}`} />
          <span className="text-xs font-mono tracking-wider font-semibold uppercase text-slate-200">
            {theme.status}
          </span>
        </div>
      </div>
    </div>
  );
}
