import React, { useState, useEffect, useRef } from 'react';
import NovaSphere from './components/NovaSphere';
import TerminalLogs from './components/TerminalLogs';
import SettingsModal from './components/SettingsModal';
import { Mic, MicOff, Settings, Send, Eye, ShieldAlert, Sparkles } from 'lucide-react';

export default function App() {
  const [logs, setLogs] = useState([]);
  const [sphereState, setSphereState] = useState('idle');
  const [isListening, setIsListening] = useState(false);
  const [includeVision, setIncludeVision] = useState(false);
  const [inputText, setInputText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({});
  const [audioLevel, setAudioLevel] = useState(0.2);

  const recognitionRef = useRef(null);
  const audioContextRef = useRef(null);

  // Initialize IPC listeners and Settings
  useEffect(() => {
    window.novaAPI.getSettings().then(setSettings);

    const unsubscribeLog = window.novaAPI.onLog((log) => {
      setLogs((prev) => [...prev, log]);
    });

    const unsubscribeState = window.novaAPI.onStateChange((state) => {
      setSphereState(state);
    });

    // Initialize Web Speech Recognition API (Built into Chromium)
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognizer = new SpeechRecognition();
      recognizer.continuous = false;
      recognizer.interimResults = false;
      recognizer.lang = 'en-US';

      recognizer.onstart = () => {
        setIsListening(true);
        setSphereState('listening');
      };

      recognizer.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInputText(transcript);
        handleExecute(transcript);
      };

      recognizer.onerror = () => {
        setIsListening(false);
        setSphereState('idle');
      };

      recognizer.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognizer;
    }

    return () => {
      unsubscribeLog();
      unsubscribeState();
    };
  }, []);

  const playBase64Audio = (base64Audio) => {
    try {
      const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
      audio.onplay = () => {
        setSphereState('speaking');
        setAudioLevel(0.9);
      };
      audio.onended = () => {
        setSphereState('idle');
        setAudioLevel(0.2);
      };
      audio.play();
    } catch (e) {
      console.error('Audio playback fault:', e);
    }
  };

  const handleExecute = async (commandToRun = null) => {
    const query = commandToRun || inputText;
    if (!query.trim()) return;

    setInputText('');
    setSphereState('processing');

    const result = await window.novaAPI.processCommand({
      text: query,
      includeVision
    });

    if (result && result.audioBase64) {
      playBase64Audio(result.audioBase64);
    } else {
      setSphereState('idle');
    }
  };

  const toggleMic = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      setSphereState('idle');
    } else {
      recognitionRef.current.start();
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#050811] text-slate-100 select-none overflow-hidden">
      {/* Top Cyberpunk Navigation Bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-slate-900 bg-[#070d1d]/60 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_12px_#00f0ff] animate-ping" />
          <h1 className="font-extrabold text-sm tracking-widest uppercase bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 bg-clip-text text-transparent">
            N.O.V.A. // OS INTELLIGENCE
          </h1>
        </div>

        <div className="flex items-center space-x-4">
          <button
            onClick={() => setIncludeVision(!includeVision)}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg border text-xs font-mono uppercase transition ${
              includeVision
                ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300 shadow-hologram-cyan'
                : 'border-slate-800 text-slate-500 hover:border-slate-700'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Screen Perception {includeVision ? '[ACTIVE]' : '[OFF]'}</span>
          </button>

          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-lg border border-slate-800 text-slate-400 hover:text-cyan-400 hover:border-cyan-400/50 transition"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Core Layout */}
      <div className="flex-1 grid grid-cols-12 gap-6 p-6 overflow-hidden">
        {/* Left Column: Visual Hologram Sphere Core */}
        <div className="col-span-12 lg:col-span-7 flex flex-col items-center justify-center relative rounded-2xl border border-slate-900 bg-radial from-slate-900/40 via-transparent to-transparent">
          <NovaSphere state={sphereState} audioLevel={audioLevel} />

          <div className="absolute bottom-6 flex flex-col items-center space-y-2">
            <span className="text-xs font-mono tracking-widest text-slate-400 uppercase">
              Operational Status: <strong className="text-cyan-400">{sphereState}</strong>
            </span>
          </div>
        </div>

        {/* Right Column: Terminal Telemetry Stream */}
        <div className="col-span-12 lg:col-span-5 h-full">
          <TerminalLogs logs={logs} />
        </div>
      </div>

      {/* Bottom Floating Dynamic Input Console */}
      <div className="p-6 pt-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleExecute();
          }}
          className="flex items-center space-x-3 max-w-4xl mx-auto bg-[#0a1124] border border-cyan-500/30 rounded-2xl p-2 shadow-2xl focus-within:border-cyan-400 transition"
        >
          <button
            type="button"
            onClick={toggleMic}
            className={`p-3 rounded-xl transition ${
              isListening
                ? 'bg-rose-500 text-white animate-pulse shadow-[0_0_15px_#f43f5e]'
                : 'bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20'
            }`}
          >
            {isListening ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Instruct NOVA (e.g. 'Build an index.html and launch YouTube to The Hasnain Gaming')..."
            className="flex-1 bg-transparent px-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
          />

          <button
            type="submit"
            className="p-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-xl transition shadow-hologram-cyan font-bold"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentSettings={settings}
        onSave={(newSettings) => {
          setSettings(newSettings);
          window.novaAPI.saveSettings(newSettings);
        }}
      />
    </div>
  );
}
