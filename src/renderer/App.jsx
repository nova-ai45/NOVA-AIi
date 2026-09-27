import React, { useState, useEffect, useRef } from 'react';
import NovaSphere from './components/NovaSphere';
import SettingsModal from './components/SettingsModal';
import {
  MessageSquare,
  Settings,
  Send,
  Plus,
  Cpu,
  Activity,
  Mic,
  MicOff,
  Youtube,
  ExternalLink
} from 'lucide-react';

export default function App() {
  const [logs, setLogs] = useState([
    { timestamp: 'SYSTEM', message: "nova.core(status=\"ready\", engine=\"stable\")" },
    { timestamp: 'ACTIVE', message: "NOVA Voice Assistant Online |" }
  ]);
  const [sphereState, setSphereState] = useState('idle'); // 'idle' | 'listening' | 'thinking' | 'speaking' | 'executing'
  const [inputText, setInputText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({});
  const [audioLevel, setAudioLevel] = useState(0.18);
  const [micActive, setMicActive] = useState(true);
  const [activeTab, setActiveTab] = useState('assistant');

  const [chatHistory, setChatHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('nova_chat_history');
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });

  const [cpuUsage, setCpuUsage] = useState(38);

  // Speech Recognition & State Refs
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const accumulatedSpeechRef = useRef('');
  const isSpeechRunningRef = useRef(false);
  const isProcessingRef = useRef(false);
  const terminalEndRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem('nova_chat_history', JSON.stringify(chatHistory.slice(-20)));
    } catch (_) {}
  }, [chatHistory]);

  useEffect(() => {
    // Live CPU simulation
    const cpuInterval = setInterval(() => {
      setCpuUsage(Math.floor(34 + Math.sin(Date.now() / 1500) * 8 + Math.random() * 4));
    }, 2000);

    // Load persistent settings
    window.novaAPI.getSettings().then((cfg) => {
      const localCfg = localStorage.getItem('nova_persistent_config');
      const merged = { ...(localCfg ? JSON.parse(localCfg) : {}), ...cfg };
      setSettings(merged);
    });

    const unsubLog = window.novaAPI.onLog((log) => {
      setLogs((prev) => [...prev.slice(-40), log]);
      setTimeout(() => terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    });

    const unsubState = window.novaAPI.onStateChange((st) => {
      setSphereState(st);
    });

    // Ensure speech synthesis voices are loaded by the browser
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
      window.speechSynthesis.getVoices();
    }

    // Initialize clean Speech Recognition
    initSpeechEngine();

    return () => {
      clearInterval(cpuInterval);
      unsubLog();
      unsubState();
      destroySpeechEngine();
      cancelNativeSpeech();
    };
  }, []);

  // 1. Stable Speech Recognition Engine
  const initSpeechEngine = () => {
    const SpeechConstructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechConstructor) return;

    try {
      const recognition = new SpeechConstructor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        isSpeechRunningRef.current = true;
        if (!isProcessingRef.current) {
          setSphereState('listening');
        }
      };

      recognition.onresult = (event) => {
        if (isProcessingRef.current) return;

        let liveText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i];
          if (item[0] && item[0].transcript) {
            liveText += item[0].transcript;
          }
        }

        const trimmed = liveText.trim();
        if (trimmed.length > 0) {
          accumulatedSpeechRef.current = trimmed;
          setSphereState('listening');
          setAudioLevel(0.45);

          // Reset silence timer on every new word
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
          }

          // Auto-submit after 1.0s of clean silence
          silenceTimerRef.current = setTimeout(() => {
            const finalSpeech = accumulatedSpeechRef.current.trim();
            if (finalSpeech.length > 0 && !isProcessingRef.current) {
              accumulatedSpeechRef.current = '';
              clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = null;
              stopSpeechEngine();
              handleExecute(finalSpeech);
            }
          }, 1000);
        }
      };

      recognition.onerror = (e) => {
        if (e.error !== 'no-speech') {
          console.warn('Speech engine status:', e.error);
        }
      };

      recognition.onend = () => {
        isSpeechRunningRef.current = false;
        // Only restart if the user hasn't muted and AI isn't processing/speaking
        if (!isProcessingRef.current && micActive) {
          setTimeout(() => {
            startSpeechEngine();
          }, 250);
        }
      };

      recognitionRef.current = recognition;
      startSpeechEngine();
    } catch (err) {
      console.error('Speech initialization error:', err);
    }
  };

  const startSpeechEngine = () => {
    if (recognitionRef.current && !isSpeechRunningRef.current && !isProcessingRef.current) {
      try {
        recognitionRef.current.start();
      } catch (_) {}
    }
  };

  const stopSpeechEngine = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current && isSpeechRunningRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (_) {}
    }
  };

  const destroySpeechEngine = () => {
    stopSpeechEngine();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (_) {}
      recognitionRef.current = null;
    }
  };

  const toggleMic = () => {
    if (micActive) {
      setMicActive(false);
      destroySpeechEngine();
      setSphereState('idle');
      setAudioLevel(0.18);
    } else {
      setMicActive(true);
      initSpeechEngine();
    }
  };

  // 2. Stable Native Text-To-Speech (Zero Socket Hangs)
  const cancelNativeSpeech = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const speakWithNativeTTS = (text) => {
    cancelNativeSpeech();

    if (!('speechSynthesis' in window) || !text || !text.trim()) {
      finishSpeechTurn();
      return;
    }

    setSphereState('speaking');
    window.speechSynthesis.resume();

    const utterance = new SpeechSynthesisUtterance(text);
    // Store on window to avoid Chromium V8 garbage collection bug mid-sentence
    window._activeUtterance = utterance;

    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    if (voices && voices.length > 0) {
      const preferred = voices.find(
        (v) =>
          v.name.includes('Zira') ||
          v.name.includes('Aria') ||
          v.name.includes('Jenny') ||
          v.name.includes('Natural') ||
          v.lang.includes('en-US') ||
          v.lang.startsWith('en')
      );
      if (preferred) utterance.voice = preferred;
    }

    let pulseTimer = setInterval(() => {
      setAudioLevel(0.35 + Math.random() * 0.4);
    }, 120);

    const cleanup = () => {
      clearInterval(pulseTimer);
      setAudioLevel(0.18);
      window._activeUtterance = null;
      finishSpeechTurn();
    };

    utterance.onend = cleanup;
    utterance.onerror = cleanup;

    window.speechSynthesis.speak(utterance);
  };

  const finishSpeechTurn = () => {
    isProcessingRef.current = false;
    setSphereState('idle');
    if (micActive) {
      setTimeout(() => {
        startSpeechEngine();
      }, 300);
    }
  };

  // 3. Execution Pipeline
  const handleExecute = async (overridePrompt = null) => {
    const prompt = overridePrompt || inputText;
    if (!prompt.trim()) return;

    isProcessingRef.current = true;
    stopSpeechEngine();
    cancelNativeSpeech();

    setInputText('');
    setSphereState('thinking');

    setLogs((prev) => [...prev, { timestamp: 'CMD', message: `user.query("${prompt}")` }]);

    const historySnapshot = [...chatHistory];

    const result = await window.novaAPI.processCommand({
      text: prompt,
      audioBase64: null,
      conversationHistory: historySnapshot,
      includeVision: true
    });

    if (result && result.success) {
      setChatHistory((prev) => [
        ...prev,
        { role: 'user', text: prompt },
        { role: 'model', text: result.spokenResponse || 'Action executed.' }
      ]);

      if (result.spokenResponse) {
        speakWithNativeTTS(result.spokenResponse);
      } else {
        finishSpeechTurn();
      }
    } else {
      finishSpeechTurn();
    }
  };

  const openHasnainYouTubeInChrome = () => {
    const channelUrl = 'https://www.youtube.com/@TheHasnainGamer1';
    if (window.novaAPI.openBrowser) {
      window.novaAPI.openBrowser({ url: channelUrl, searchQuery: null, browser: 'chrome' });
    } else {
      window.open(channelUrl, '_blank');
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#07080c] text-slate-100 font-sans overflow-hidden select-none p-4 space-y-4">
      {/* 1. TOP BAR */}
      <header className="flex items-center justify-between px-6 py-3.5 bg-[#0d0f17]/90 rounded-2xl border border-[#ff7700]/30 shadow-[0_0_25px_rgba(255,119,0,0.15)] backdrop-blur-xl">
        <div className="flex items-center space-x-3.5">
          <div className="relative flex items-center justify-center w-10 h-10">
            <svg viewBox="0 0 100 100" className="w-10 h-10 text-[#ff8800] filter drop-shadow-[0_0_8px_#ff8800]">
              <polygon points="50 5, 90 25, 90 75, 50 95, 10 75, 10 25" fill="none" stroke="currentColor" strokeWidth="5" />
              <polygon points="50 20, 80 35, 80 65, 50 80, 20 65, 20 35" fill="none" stroke="rgba(255,170,0,0.6)" strokeWidth="3" />
            </svg>
          </div>
          <div className="flex items-center space-x-3">
            <h1 className="font-mono text-2xl font-bold tracking-wider text-white">NOVA AI</h1>
            <span className="px-2.5 py-0.5 text-[11px] font-mono tracking-widest font-semibold uppercase rounded-md bg-[#ff7700]/15 border border-[#ff7700]/50 text-[#ff9900]">
              ASSISTANT
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-5">
          {/* Creator YouTube Channel Button */}
          <button
            onClick={openHasnainYouTubeInChrome}
            className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-gradient-to-r from-red-600 to-[#ff7700] hover:from-red-500 hover:to-[#ff9900] text-white text-xs font-mono font-bold transition shadow-[0_0_15px_rgba(255,119,0,0.4)] cursor-pointer"
            title="Open in Google Chrome: @TheHasnainGamer1"
          >
            <Youtube className="w-4 h-4" />
            <span className="tracking-tight">@TheHasnainGamer1</span>
            <ExternalLink className="w-3.5 h-3.5 opacity-80" />
          </button>

          {/* Online Indicator */}
          <div className="flex items-center space-x-2 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-ping" />
            <span className="text-emerald-400 font-semibold tracking-wide">ONLINE</span>
          </div>

          {/* Mic Toggle Button */}
          <button
            onClick={toggleMic}
            className={`p-2 rounded-xl border transition cursor-pointer ${
              micActive
                ? 'bg-[#141824] border-[#ff7700]/60 text-[#ff8800] shadow-[0_0_10px_rgba(255,119,0,0.3)]'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
            title={micActive ? 'Mic Active (Click to mute)' : 'Mic Muted (Click to unmute)'}
          >
            {micActive ? <Mic className="w-4 h-4 animate-pulse" /> : <MicOff className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* 2. MAIN GRID */}
      <div className="flex-1 grid grid-cols-12 gap-4 overflow-hidden">
        {/* NAVIGATION */}
        <div className="col-span-12 md:col-span-2 flex flex-col p-4 bg-[#0d0f17]/90 rounded-2xl border border-[#ff7700]/30 shadow-[0_0_20px_rgba(255,119,0,0.1)] backdrop-blur-xl justify-between">
          <div>
            <div className="text-[11px] font-mono tracking-widest text-[#ff8800] uppercase font-bold mb-4 flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff8800]" />
              <span>NAVIGATION</span>
            </div>

            <div className="space-y-2.5">
              <button
                onClick={() => setActiveTab('assistant')}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl font-mono text-sm font-semibold transition cursor-pointer ${
                  activeTab === 'assistant'
                    ? 'bg-gradient-to-r from-[#ff7700]/25 to-[#ff7700]/10 border border-[#ff7700] text-[#ffaa00] shadow-[0_0_15px_rgba(255,119,0,0.3)]'
                    : 'text-slate-400 hover:bg-slate-900 border border-transparent'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                <span>Assistant</span>
              </button>

              <button
                onClick={() => setSettingsOpen(true)}
                className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl font-mono text-sm font-semibold text-slate-400 hover:bg-slate-900 hover:text-[#ff8800] border border-transparent hover:border-[#ff7700]/30 transition cursor-pointer"
              >
                <Settings className="w-4 h-4" />
                <span>Settings</span>
              </button>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#121522] border border-slate-800 space-y-1.5">
            <div className="flex justify-between items-center text-[10px] font-mono text-slate-400">
              <span>MIC STATUS</span>
              <span className={micActive ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                {micActive ? 'ACTIVE' : 'MUTED'}
              </span>
            </div>
          </div>
        </div>

        {/* VOICE & RADAR INTERFACE */}
        <div className="col-span-12 md:col-span-7 flex flex-col items-center justify-between p-4 bg-[#0d0f17]/90 rounded-2xl border border-[#ff7700]/30 shadow-[0_0_30px_rgba(255,119,0,0.15)] backdrop-blur-xl relative overflow-hidden">
          <div className="w-full flex justify-between items-center text-[11px] font-mono tracking-widest text-[#ff8800] uppercase font-bold z-10">
            <span className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff8800]" />
              <span>VOICE INTERFACE</span>
            </span>
            <span className="opacity-50">• • •</span>
          </div>

          <div className="w-full flex-1 flex items-center justify-center relative">
            <NovaSphere state={sphereState} audioLevel={audioLevel} />
          </div>

          <div className="z-10 mb-2 flex items-center space-x-2 px-5 py-1.5 rounded-full bg-[#121522] border border-[#ff7700]/40 text-[#ffaa00] font-mono text-xs shadow-[0_0_15px_rgba(255,119,0,0.2)]">
            <span className={`w-1.5 h-1.5 rounded-full ${sphereState === 'thinking' ? 'bg-cyan-400 animate-ping' : 'bg-[#ff8800] animate-pulse'}`} />
            <span className="tracking-widest uppercase">
              ::: {sphereState === 'listening' ? 'Listening...' : sphereState === 'thinking' ? 'NOVA is thinking...' : sphereState === 'speaking' ? 'NOVA is speaking...' : 'Ready'} :::
            </span>
          </div>
        </div>

        {/* SYSTEM STATS */}
        <div className="col-span-12 md:col-span-3 flex flex-col p-4 bg-[#0d0f17]/90 rounded-2xl border border-[#ff7700]/30 shadow-[0_0_20px_rgba(255,119,0,0.1)] backdrop-blur-xl">
          <div className="text-[11px] font-mono tracking-widest text-[#ff8800] uppercase font-bold mb-4 flex items-center space-x-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff8800]" />
            <span>SYSTEM STATS</span>
          </div>

          <div className="p-4 rounded-xl bg-[#121522] border border-slate-800 space-y-3 flex-1 flex flex-col justify-between">
            <div>
              <span className="text-xs font-mono text-slate-400 block mb-1">CPU USAGE</span>
              <span className="text-4xl font-mono font-extrabold text-[#ff9900] tracking-tight">
                {cpuUsage}%
              </span>
            </div>

            <div className="w-full h-24 my-2">
              <svg viewBox="0 0 200 80" className="w-full h-full overflow-visible">
                <defs>
                  <linearGradient id="amberGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ff7700" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#ff7700" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <polygon points="0,60 25,50 50,65 75,45 100,55 125,35 150,40 175,25 200,15 200,80 0,80" fill="url(#amberGrad)" />
                <polyline points="0,60 25,50 50,65 75,45 100,55 125,35 150,40 175,25 200,15" fill="none" stroke="#ff8800" strokeWidth="2.5" />
                <circle cx="200" cy="15" r="4" fill="#ffffff" stroke="#ff8800" strokeWidth="2" />
              </svg>
            </div>

            <div className="text-xs font-mono text-slate-400 pt-2 border-t border-slate-800/80 flex justify-between">
              <span>Avg 38%</span>
              <span>•</span>
              <span>2.4GHz</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. COMMAND CONSOLE */}
      <div className="h-44 flex flex-col p-4 bg-[#0d0f17]/95 rounded-2xl border border-[#ff7700]/30 shadow-[0_0_25px_rgba(255,119,0,0.15)] backdrop-blur-xl">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800/80 mb-2">
          <div className="flex items-center space-x-2 text-[11px] font-mono tracking-widest font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff8800]" />
            <span className="text-[#ff8800]">COMMAND CONSOLE</span>
            <span className="text-slate-500">•</span>
            <span className="text-emerald-400">ACTIVE</span>
          </div>
          <div className="text-[11px] font-mono text-slate-500">
            v3.8.0 • STABLE
          </div>
        </div>

        <div className="flex-1 overflow-y-auto font-mono text-xs text-slate-300 space-y-1.5 pr-2">
          {logs.map((log, idx) => (
            <div key={idx} className="flex items-start space-x-2">
              <span className="text-[#ff8800]">&gt; '</span>
              <span className="text-slate-200">{log.message}</span>
            </div>
          ))}
          <div ref={terminalEndRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleExecute();
          }}
          className="flex items-center space-x-2 pt-2 border-t border-slate-800/80"
        >
          <span className="text-[#ff8800] font-mono text-sm">&gt;</span>
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type directive or speak naturally into mic..."
            className="flex-1 bg-transparent px-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none font-mono"
          />
          <button
            type="submit"
            className="p-2 rounded-xl bg-[#ff7700]/20 hover:bg-[#ff7700]/30 text-[#ffaa00] border border-[#ff7700]/50 transition shadow-[0_0_10px_rgba(255,119,0,0.3)] cursor-pointer"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentSettings={settings}
        onSave={(newCfg) => {
          setSettings(newCfg);
          localStorage.setItem('nova_persistent_config', JSON.stringify(newCfg));
          window.novaAPI.saveSettings(newCfg);
        }}
      />
    </div>
  );
}
