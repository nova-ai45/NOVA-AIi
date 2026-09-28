import React, { useState, useEffect, useRef } from 'react';
import NovaSphere from './components/NovaSphere';
import SettingsModal from './components/SettingsModal';
import {
  MessageSquare,
  Settings,
  Send,
  Plus,
  Cpu,
  Mic,
  MicOff,
  Youtube,
  ExternalLink,
  Languages
} from 'lucide-react';

export default function App() {
  const [logs, setLogs] = useState([
    { timestamp: 'SYSTEM', message: "nova.core(status=\"ready\", engine=\"speech_recognition\")" },
    { timestamp: 'ACTIVE', message: "Speech Engine Initialized | Language: ur-PK / en-US" }
  ]);
  const [sphereState, setSphereState] = useState('idle'); // 'idle' | 'listening' | 'thinking' | 'speaking' | 'executing'
  const [inputText, setInputText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({});
  const [audioLevel, setAudioLevel] = useState(0);
  const [liveMicPercent, setLiveMicPercent] = useState(0);
  const [isSpeakingNow, setIsSpeakingNow] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [speechLang, setSpeechLang] = useState('ur-PK'); // 'ur-PK' or 'en-US'
  const [activeTab, setActiveTab] = useState('assistant');

  const [chatHistory, setChatHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('nova_chat_history');
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      const cleaned = parsed.filter((item) => item && item.text && item.text.trim() !== '');
      while (cleaned.length > 0 && cleaned[cleaned.length - 1].role === 'model') {
        cleaned.pop();
      }
      return cleaned;
    } catch (_) {
      return [];
    }
  });

  const [cpuUsage, setCpuUsage] = useState(38);

  // Speech Recognition & State Refs
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const accumulatedTranscriptRef = useRef('');
  const isRecognitionActiveRef = useRef(false);
  const isProcessingRef = useRef(false);
  const terminalEndRef = useRef(null);
  const activeAudioElementRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem('nova_chat_history', JSON.stringify(chatHistory.slice(-20)));
    } catch (_) {}
  }, [chatHistory]);

  useEffect(() => {
    const cpuInterval = setInterval(() => {
      setCpuUsage(Math.floor(34 + Math.sin(Date.now() / 1500) * 8 + Math.random() * 4));
    }, 2000);

    window.novaAPI.getSettings().then((cfg) => {
      const localCfg = localStorage.getItem('nova_persistent_config');
      const merged = { ...(localCfg ? JSON.parse(localCfg) : {}), ...cfg };
      setSettings(merged);
      if (merged.recognitionLang) {
        setSpeechLang(merged.recognitionLang);
      }
    });

    const unsubLog = window.novaAPI.onLog((log) => {
      setLogs((prev) => [...prev.slice(-40), log]);
      setTimeout(() => terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    });

    const unsubState = window.novaAPI.onStateChange((st) => {
      setSphereState(st);
    });

    startSpeechRecognition();

    return () => {
      clearInterval(cpuInterval);
      unsubLog();
      unsubState();
      stopSpeechRecognition();
      stopOngoingSpeechPlayback();
    };
  }, [speechLang]);

  // 1. Web Speech API Engine with Strict Accuracy and Language Tuning
  const startSpeechRecognition = () => {
    const SpeechConstructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechConstructor) {
      console.error("[Voice Input]: Web Speech API is not supported in this environment.");
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (_) {}
    }

    try {
      const recognition = new SpeechConstructor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = speechLang; // Explicitly set to 'ur-PK' or 'en-US'
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        isRecognitionActiveRef.current = true;
        if (!isProcessingRef.current && !micMuted) {
          setSphereState('idle');
        }
      };

      recognition.onresult = (event) => {
        if (isProcessingRef.current || micMuted) return;

        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i][0];
          if (item && item.transcript) {
            if (event.results[i].isFinal) {
              finalTranscript += item.transcript + ' ';
            } else {
              interimTranscript += item.transcript;
            }
          }
        }

        const rawTranscript = (finalTranscript || interimTranscript);
        // Clean and trim string
        const cleanTranscript = rawTranscript.trim().replace(/\s+/g, ' ');

        if (cleanTranscript.length > 0) {
          accumulatedTranscriptRef.current = cleanTranscript;
          setIsSpeakingNow(true);
          setSphereState('listening');
          setAudioLevel(0.5);
          setLiveMicPercent(85);

          // Log live recognized text
          console.log("[Voice Input Transcript (Live)]:", cleanTranscript);

          // Reset silence timer on every spoken syllable
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
          }

          // 1.0 second silence debounce threshold
          silenceTimerRef.current = setTimeout(() => {
            const finalPrompt = accumulatedTranscriptRef.current.trim();
            accumulatedTranscriptRef.current = '';
            setIsSpeakingNow(false);
            setLiveMicPercent(0);
            setAudioLevel(0);

            if (finalPrompt.length > 0 && !isProcessingRef.current) {
              console.log("[Voice Input Transcript (Final Dispatched)]:", finalPrompt);
              try {
                recognition.stop();
              } catch (_) {}
              handleExecute(finalPrompt);
            }
          }, 1000);
        }
      };

      recognition.onerror = (event) => {
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          console.warn("[Voice Input Error]:", event.error);
        }
      };

      recognition.onend = () => {
        isRecognitionActiveRef.current = false;
        // Auto-restart if not muted and not currently executing/speaking
        if (!isProcessingRef.current && !micMuted) {
          setTimeout(() => {
            try {
              recognition.start();
            } catch (_) {}
          }, 200);
        }
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch (e) {
        console.warn("[Voice Input]: Recognition start warning:", e.message);
      }
    } catch (err) {
      console.error("[Voice Input]: Setup failure:", err);
    }
  };

  const stopSpeechRecognition = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (_) {}
      isRecognitionActiveRef.current = false;
    }
  };

  const toggleMicMute = () => {
    if (!micMuted) {
      setMicMuted(true);
      stopSpeechRecognition();
      setSphereState('idle');
      setAudioLevel(0);
      setLiveMicPercent(0);
      setIsSpeakingNow(false);
    } else {
      setMicMuted(false);
      startSpeechRecognition();
    }
  };

  const toggleLanguage = () => {
    const nextLang = speechLang === 'ur-PK' ? 'en-US' : 'ur-PK';
    setSpeechLang(nextLang);
    setLogs((prev) => [...prev, { timestamp: 'LANG', message: `Speech recognition language set to: ${nextLang}` }]);
  };

  // 2. Audio Playback Handler
  const stopOngoingSpeechPlayback = () => {
    if (activeAudioElementRef.current) {
      try {
        activeAudioElementRef.current.pause();
        activeAudioElementRef.current.currentTime = 0;
      } catch (_) {}
      activeAudioElementRef.current = null;
    }
    if (window.novaAPI.stopSpeech) {
      window.novaAPI.stopSpeech();
    }
  };

  const playNeuralVoice = (base64Audio) => {
    stopOngoingSpeechPlayback();

    if (!base64Audio) {
      finishExecutionTurn();
      return;
    }

    try {
      const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
      activeAudioElementRef.current = audio;

      setSphereState('speaking');

      audio.onplay = () => {
        setSphereState('speaking');
        setAudioLevel(0.65);
      };

      const onAudioFinished = () => {
        activeAudioElementRef.current = null;
        setAudioLevel(0);
        finishExecutionTurn();
      };

      audio.onended = onAudioFinished;
      audio.onerror = onAudioFinished;

      audio.play().catch(() => {
        onAudioFinished();
      });
    } catch (e) {
      console.error("[Voice Playback]: Error playing audio response:", e);
      finishExecutionTurn();
    }
  };

  const finishExecutionTurn = () => {
    isProcessingRef.current = false;
    setSphereState('idle');
    setAudioLevel(0);
    // Restart recognition safely
    if (!micMuted && recognitionRef.current && !isRecognitionActiveRef.current) {
      try {
        recognitionRef.current.start();
      } catch (_) {}
    }
  };

  // 3. User Query Pipeline (Text & Voice routing to AI)
  const handleExecute = async (overridePrompt = null) => {
    const prompt = (overridePrompt || inputText || '').trim();

    // If no speech or empty prompt, do NOT fallback to battery/CPU metrics!
    if (!prompt) {
      setLogs((prev) => [...prev, { timestamp: 'WARN', message: "No speech recognized. Please speak your query." }]);
      finishExecutionTurn();
      return;
    }

    stopOngoingSpeechPlayback();
    isProcessingRef.current = true;
    setInputText('');
    setSphereState('thinking');

    console.log("[Routing to AI Engine]:", prompt);
    setLogs((prev) => [...prev, { timestamp: 'USER', message: prompt }]);

    const cleanHistorySnapshot = chatHistory.filter((item) => item && item.text && item.text.trim() !== '');

    const result = await window.novaAPI.processCommand({
      text: prompt,
      conversationHistory: cleanHistorySnapshot,
      includeVision: prompt.toLowerCase().includes('screen') || prompt.toLowerCase().includes('dekho')
    });

    if (result && result.success) {
      const spokenText = (result.spokenResponse || '').trim();

      if (spokenText) {
        setChatHistory((prev) => {
          const userTurn = { role: 'user', text: prompt };
          const modelTurn = { role: 'model', text: spokenText };
          return [...prev, userTurn, modelTurn].slice(-20);
        });

        if (result.audioBase64) {
          playNeuralVoice(result.audioBase64);
        } else {
          finishExecutionTurn();
        }
      } else {
        finishExecutionTurn();
      }
    } else {
      finishExecutionTurn();
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

        <div className="flex items-center space-x-4">
          {/* Language Switcher Badge (ur-PK / en-US) */}
          <button
            onClick={toggleLanguage}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-[#141824] hover:bg-[#1c2234] border border-[#ff7700]/30 text-xs font-mono text-[#ffaa00] transition"
            title="Toggle Recognition Language"
          >
            <Languages className="w-3.5 h-3.5 text-[#ff8800]" />
            <span>{speechLang}</span>
          </button>

          {/* YouTube Creator Channel Link */}
          <button
            onClick={openHasnainYouTubeInChrome}
            className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-gradient-to-r from-red-600 to-[#ff7700] hover:from-red-500 hover:to-[#ff9900] text-white text-xs font-mono font-bold transition shadow-[0_0_15px_rgba(255,119,0,0.4)] cursor-pointer"
            title="Open in Google Chrome: @TheHasnainGamer1"
          >
            <Youtube className="w-4 h-4" />
            <span className="tracking-tight">@TheHasnainGamer1</span>
            <ExternalLink className="w-3.5 h-3.5 opacity-80" />
          </button>

          {/* Online Status */}
          <div className="flex items-center space-x-2 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-ping" />
            <span className="text-emerald-400 font-semibold tracking-wide">ONLINE</span>
          </div>

          {/* Microphone Mute Toggle */}
          <button
            onClick={toggleMicMute}
            className={`p-2 rounded-xl border transition cursor-pointer ${
              !micMuted && isSpeakingNow
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500 shadow-[0_0_15px_#10b981]'
                : !micMuted
                ? 'bg-[#141824] border-slate-800 text-[#ff8800]'
                : 'bg-red-500/20 border-red-500 text-red-400'
            }`}
            title={!micMuted ? 'Mic Active (Click to Mute)' : 'Mic Muted (Click to Unmute)'}
          >
            {!micMuted ? <Mic className="w-4 h-4 animate-pulse" /> : <MicOff className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* 2. MAIN GRID */}
      <div className="flex-1 grid grid-cols-12 gap-4 overflow-hidden">
        {/* LEFT COLUMN: NAVIGATION & MIC VU METER */}
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

          {/* Voice Input Activity Gauge */}
          <div className="p-3.5 rounded-xl bg-[#121522] border border-slate-800 space-y-2">
            <div className="flex justify-between items-center text-[10px] font-mono">
              <span className="text-slate-400">VOICE INPUT</span>
              <span className={isSpeakingNow ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                {micMuted ? 'MUTED' : isSpeakingNow ? 'CAPTURING' : 'READY'}
              </span>
            </div>
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-100 ${
                  isSpeakingNow
                    ? 'bg-gradient-to-r from-emerald-400 to-[#ffaa00] shadow-[0_0_8px_#10b981]'
                    : 'bg-[#ff7700]'
                }`}
                style={{ width: `${micMuted ? 0 : liveMicPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* CENTER COLUMN: VOICE INTERFACE */}
        <div className="col-span-12 md:col-span-7 flex flex-col items-center justify-between p-4 bg-[#0d0f17]/90 rounded-2xl border border-[#ff7700]/30 shadow-[0_0_30px_rgba(255,119,0,0.15)] backdrop-blur-xl relative overflow-hidden">
          <div className="w-full flex justify-between items-center text-[11px] font-mono tracking-widest text-[#ff8800] uppercase font-bold z-10">
            <span className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff8800]" />
              <span>VOICE INTERFACE (MS EDGE NEURAL &bull; SWARA)</span>
            </span>
            <span className="text-slate-500 font-mono text-[10px]">Lang: {speechLang}</span>
          </div>

          <div className="w-full flex-1 flex items-center justify-center relative">
            <NovaSphere state={sphereState} audioLevel={audioLevel} />
          </div>

          <div className="z-10 mb-2 flex items-center space-x-2 px-5 py-1.5 rounded-full bg-[#121522] border border-[#ff7700]/40 text-[#ffaa00] font-mono text-xs shadow-[0_0_15px_rgba(255,119,0,0.2)]">
            <span className={`w-1.5 h-1.5 rounded-full ${sphereState === 'thinking' ? 'bg-cyan-400 animate-ping' : isSpeakingNow ? 'bg-emerald-400 animate-ping' : 'bg-[#ff8800]'}`} />
            <span className="tracking-widest uppercase">
              ::: {sphereState === 'listening' ? 'Listening...' : sphereState === 'thinking' ? 'NOVA is Thinking...' : sphereState === 'speaking' ? 'Speaking...' : 'Microphone Ready'} :::
            </span>
          </div>
        </div>

        {/* RIGHT COLUMN: SYSTEM STATS */}
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

      {/* 3. COMMAND CONSOLE & TEXT INPUT */}
      <div className="h-44 flex flex-col p-4 bg-[#0d0f17]/95 rounded-2xl border border-[#ff7700]/30 shadow-[0_0_25px_rgba(255,119,0,0.15)] backdrop-blur-xl">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800/80 mb-2">
          <div className="flex items-center space-x-2 text-[11px] font-mono tracking-widest font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff8800]" />
            <span className="text-[#ff8800]">COMMAND CONSOLE</span>
            <span className="text-slate-500">•</span>
            <span className="text-emerald-400">ACTIVE</span>
          </div>
          <div className="text-[11px] font-mono text-slate-500">
            v4.1.0 &bull; VOICE & INTENT ROUTER READY
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
