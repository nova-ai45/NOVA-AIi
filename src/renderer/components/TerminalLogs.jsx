import React, { useRef, useEffect } from 'react';
import { Terminal, ShieldCheck, AlertCircle, Eye, Cpu, Radio } from 'lucide-react';

export default function TerminalLogs({ logs }) {
  const terminalEndRef = useRef(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const getLogIcon = (type) => {
    switch (type) {
      case 'vision':
        return <Eye className="w-3.5 h-3.5 text-blue-400 mt-0.5" />;
      case 'automation':
        return <Cpu className="w-3.5 h-3.5 text-cyan-400 mt-0.5" />;
      case 'ai':
        return <Radio className="w-3.5 h-3.5 text-purple-400 mt-0.5" />;
      case 'error':
        return <AlertCircle className="w-3.5 h-3.5 text-rose-500 mt-0.5" />;
      default:
        return <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 mt-0.5" />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#070d1d]/80 border border-slate-800 rounded-xl overflow-hidden backdrop-blur-md shadow-2xl">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-[#0a1124]">
        <div className="flex items-center space-x-2">
          <Terminal className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-mono tracking-wider text-slate-300 uppercase">Live Neural Telemetry</span>
        </div>
        <div className="flex space-x-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
          <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-500/80 animate-pulse" />
        </div>
      </div>

      <div className="flex-1 p-3 overflow-y-auto font-mono text-xs space-y-2">
        {logs.length === 0 ? (
          <div className="text-slate-500 text-center py-8">NOVA systems online. Telemetry pipeline idle.</div>
        ) : (
          logs.map((log, index) => (
            <div key={index} className="flex items-start space-x-2.5 text-slate-300">
              {getLogIcon(log.type)}
              <span className="text-slate-500 shrink-0">[{log.timestamp}]</span>
              <span className="break-all">{log.message}</span>
            </div>
          ))
        )}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
}
