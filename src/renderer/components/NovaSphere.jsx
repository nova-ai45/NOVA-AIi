import React from 'react';

export default function NovaSphere({ state = 'idle', audioLevel = 0 }) {
  // State styles mapping: cyan (idle), blue (listening), purple (processing), emerald (speaking), rose (executing)
  const stateColor = {
    idle: 'border-cyan-500/40 shadow-hologram-cyan text-cyan-400',
    listening: 'border-blue-500/80 shadow-hologram-blue text-blue-300 scale-105',
    processing: 'border-purple-500/80 shadow-hologram-purple text-purple-300 animate-pulse',
    speaking: 'border-emerald-400/80 shadow-[0_0_30px_rgba(16,185,129,0.5)] text-emerald-300',
    executing: 'border-rose-500/80 shadow-[0_0_30px_rgba(244,63,94,0.5)] text-rose-300 animate-bounce'
  }[state] || 'border-cyan-500/40 shadow-hologram-cyan text-cyan-400';

  const glowBackground = {
    idle: 'bg-cyan-500/10',
    listening: 'bg-blue-500/20',
    processing: 'bg-purple-600/25',
    speaking: 'bg-emerald-500/20',
    executing: 'bg-rose-500/20'
  }[state];

  return (
    <div className="relative flex items-center justify-center w-72 h-72">
      {/* Outer Rotating Gyroscope Ring 1 */}
      <div 
        className={`absolute inset-0 rounded-full border border-dashed border-cyan-400/30 animate-spin-slow`}
        style={{ animationDuration: '24s' }}
      />

      {/* Outer Rotating Gyroscope Ring 2 */}
      <div 
        className={`absolute inset-2 rounded-full border border-dotted border-purple-400/40 animate-spin-reverse`}
        style={{ animationDuration: '18s' }}
      />

      {/* Pulsing Core Field */}
      <div 
        className={`absolute inset-8 rounded-full border-2 ${stateColor} ${glowBackground} transition-all duration-500 backdrop-blur-md flex items-center justify-center`}
      >
        {/* Holographic Wireframe Grid */}
        <div className="absolute inset-4 rounded-full border border-cyan-300/20 animate-ping" style={{ animationDuration: '4s' }} />

        {/* Dynamic Center Node */}
        <div className="flex flex-col items-center justify-center space-y-1 z-10">
          <div className="text-xs uppercase font-mono tracking-widest opacity-80">NOVA CORE</div>
          <div className="text-sm font-semibold tracking-wider uppercase">{state}</div>
          <div className="flex space-x-1 items-end h-6 mt-1">
            {[40, 70, 100, 60, 30, 80, 50].map((h, i) => (
              <span
                key={i}
                className="w-1 bg-current rounded-full transition-all duration-150"
                style={{
                  height: state === 'speaking' || state === 'listening' 
                    ? `${Math.max(15, (h * (audioLevel || 0.8)))}%` 
                    : '25%'
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
