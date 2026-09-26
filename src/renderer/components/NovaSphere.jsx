import React from 'react';

export default function NovaSphere({ state = 'idle', audioLevel = 0 }) {
  const getTheme = () => {
    switch (state) {
      case 'listening':
        return {
          core: 'border-cyan-400 bg-cyan-500/20 shadow-[0_0_50px_rgba(0,240,255,0.7)] text-cyan-200',
          ring1: 'border-cyan-400/80',
          status: 'LISTENING TO YOUR VOICE'
        };
      case 'processing':
        return {
          core: 'border-purple-500 bg-purple-600/30 shadow-[0_0_60px_rgba(168,85,247,0.8)] text-purple-200 animate-pulse',
          ring1: 'border-purple-400/80',
          status: 'NEURAL COMPUTING'
        };
      case 'speaking':
        return {
          core: 'border-emerald-400 bg-emerald-500/25 shadow-[0_0_70px_rgba(16,185,129,0.8)] text-emerald-200',
          ring1: 'border-emerald-300/90',
          status: 'NOVA SPEAKING'
        };
      case 'executing':
        return {
          core: 'border-rose-500 bg-rose-600/30 shadow-[0_0_60px_rgba(244,63,94,0.8)] text-rose-200',
          ring1: 'border-rose-400/90',
          status: 'EXECUTING PC COMMAND'
        };
      default:
        return {
          core: 'border-cyan-500/30 bg-cyan-950/20 shadow-[0_0_30px_rgba(0,240,255,0.2)] text-cyan-400',
          ring1: 'border-cyan-500/30',
          status: 'STANDBY // READY'
        };
    }
  };

  const theme = getTheme();
  const dynamicScale = state === 'speaking' || state === 'listening' ? 1 + Math.min(audioLevel * 0.4, 0.45) : 1;

  return (
    <div className="relative flex flex-col items-center justify-center w-full h-full min-h-[360px]">
      <div
        className="relative flex items-center justify-center transition-transform duration-100 ease-out"
        style={{ transform: `scale(${dynamicScale})` }}
      >
        {/* Outer Orbit Rings */}
        <div className={`absolute w-80 h-80 rounded-full border-2 border-dashed ${theme.ring1} animate-spin-slow opacity-60`} style={{ animationDuration: '30s' }} />
        <div className="absolute w-72 h-72 rounded-full border border-dotted border-cyan-400/40 animate-spin-reverse opacity-50" style={{ animationDuration: '20s' }} />

        {/* Central Core */}
        <div className={`relative w-48 h-48 rounded-full border-2 ${theme.core} backdrop-blur-2xl flex flex-col items-center justify-center transition-all duration-200 z-10`}>
          <span className="text-[10px] font-mono tracking-[0.3em] uppercase opacity-75 mb-1 font-bold">
            N.O.V.A. CORE
          </span>

          {/* Dynamic Frequency Bars */}
          <div className="flex items-center space-x-1.5 h-10 px-4 my-1">
            {[40, 75, 100, 60, 35, 95, 50, 80, 45].map((base, i) => {
              const h = (state === 'speaking' || state === 'listening')
                ? Math.max(15, base * (audioLevel * 1.5))
                : 15;
              return (
                <div
                  key={i}
                  className="w-1 rounded-full bg-current transition-all duration-75 ease-out shadow-sm"
                  style={{ height: `${Math.min(100, h)}%` }}
                />
              );
            })}
          </div>

          <span className="text-[9px] font-mono tracking-widest uppercase opacity-60">
            SYNC: {Math.round(audioLevel * 100)}%
          </span>
        </div>
      </div>

      <div className="mt-8 flex flex-col items-center space-y-1.5 z-20">
        <div className="flex items-center space-x-2 px-4 py-1.5 rounded-full bg-slate-900/90 border border-slate-800 backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
          <span className="text-xs font-mono tracking-wider font-bold uppercase text-slate-200">
            {theme.status}
          </span>
        </div>
      </div>
    </div>
  );
}
