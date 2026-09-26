import React, { useState, useEffect, useRef } from 'react';
import NovaSphere from './components/NovaSphere';
import TerminalLogs from './components/TerminalLogs';
import SettingsModal from './components/SettingsModal';
import { Mic, MicOff, Settings, Send, Eye, ShieldCheck, Activity, Radio, Volume2 } from 'lucide-react';

export default function App() {
  const [logs, setLogs] = useState([]);
  const [sphereState, setSphereState] = useState('idle');
  const [includeVision, setIncludeVision] = useState(false);
  const [inputText, setInputText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({});
  const [audioLevel, setAudioLevel] = useState(0.15);

  // Always-On Listening & Continuous Conversation State
  const [alwaysOnMic, setAlwaysOnMic] = useState(true);
  const [isConversationActive, setIsConversationActive] = useState(false);
  const [sessionCountdown, setSessionCountdown] = useState(0);

  const recognitionRef = useRef(null);
  const isSpeakingRef = useRef(false);
  const conversationTimerRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);

  // Initialize System & Always-On Speech Recognition
  useEffect(() => {
    window.novaAPI.getSettings().then(setSettings);

    const unsubscribeLog = window.novaAPI.onLog((log) => {
      setLogs((prev) => [...prev, log]);
    });

    const unsubscribeState = window.novaAPI.onStateChange((state) => {
      setSphereState(state);
      isSpeakingRef.current = state === 'speaking';
    });

    initAlwaysOnSpeech();

    return () => {
      unsubscribeLog();
      unsubscribeState();
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  // Conversation Session Countdown
  useEffect(() => {
    if (sessionCountdown > 0) {
      const interval = setInterval(() => {
        setSessionCountdown((prev) => {
          if (prev <= 1) {
            setIsConversationActive(false);
            setSphereState('idle');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [sessionCountdown]);

  const activateConversationSession = (seconds = 35) => {
    setIsConversationActive(true);
    setSessionCountdown(seconds);
  };

  // Continuous Always-on Microphone with Wake-Word & Active Session
  const initAlwaysOnSpeech = () => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      console.warn('Speech Recognition not supported in this Chromium context.');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognizer = new SpeechRecognition();

    recognizer.continuous = true;
    recognizer.interimResults = false;
    recognizer.lang = 'en-US';

    recognizer.onstart = () => {
      if (!isSpeakingRef.current) {
        setSphereState(isConversationActive ? 'listening' : 'idle');
      }
    };

    recognizer.onresult = (event) => {
      // Don't process input if Nova is actively speaking back
      if (isSpeakingRef.current) return;

      const latestIndex = event.results.length - 1;
      const transcript = event.results[latestIndex][0].transcript.trim();
      if (!transcript) return;

      const lower = transcript.toLowerCase();
      const containsWakeWord = lower.includes('nova');

      if (containsWakeWord) {
        // Strip wake-word and capture immediate trailing command if present
        const commandText = transcript.replace(/^(?:hey|hi|hello)?\s*nova[,.]?\s*/i, '').trim();
        activateConversationSession(35);

        if (commandText.length > 2) {
          executeCommand(commandText);
        } else {
          // User just said "Nova" -> greet and await subsequent command
          window.novaAPI.synthesizeVoice('Yes sir, I am online and listening.').then((res) => {
            if (res && res.base64Audio) playAudioWithFrequencyVisualization(res.base64Audio);
          });
        }
      } else if (isConversationActive) {
        // Conversation mode is actively open! Execute directly without requiring "Nova"
        activateConversationSession(35); // refresh timer
        executeCommand(transcript);
      }
    };

    recognizer.onerror = (e) => {
      // Ignore silence errors and auto-recover
    };

    recognizer.onend = () => {
      // Auto-restart to maintain perpetual always-on state
      if (alwaysOnMic) {
        setTimeout(() => {
          try {
            recognizer.start();
          } catch (err) {}
        }, 300);
      }
    };

    try {
      recognizer.start();
      recognitionRef.current = recognizer;
    } catch (err) {
      console.error('Mic initialization failure:', err);
    }
  };

  // Real-time Audio Frequency Analyzer for Speaking Animation
  const playAudioWithFrequencyVisualization = (base64Audio) => {
    try {
      isSpeakingRef.current = true;
      setSphereState('speaking');

      const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);

      if (!audioContextRef.current) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContextRef.current = new AudioCtx();
      }

      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;

      const source = ctx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(ctx.destination);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateFrequency = () => {
        if (!isSpeakingRef.current) return;
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        // Normalize between 0.15 and 1.0
        const normalized = Math.min(1.0, Math.max(0.15, average / 110));
        setAudioLevel(normalized);

        animFrameRef.current = requestAnimationFrame(updateFrequency);
      };

      audio.onplay = () => {
        updateFrequency();
      };

      audio.onended = () => {
        isSpeakingRef.current = false;
        setSphereState(isConversationActive ? 'listening' : 'idle');
        setAudioLevel(0.15);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      };

      audio.play();
    } catch (e) {
      console.error('Audio synthesizer playback error:', e);
      isSpeakingRef.current = false;
      setSphereState('idle');
    }
  };

  const executeCommand = async (textToRun = null) => {
    const query = textToRun || inputText;
    if (!query.trim()) return;

    setInputText('');
    setSphereState('processing');

    const result = await window.novaAPI.processCommand({
      text: query,
      includeVision
    });

    if (result && result.audioBase64) {
      playAudioWithFrequencyVisualization(result.audioBase64);
    } else {
      setSphereState(isConversationActive ? 'listening' : 'idle');
    }
  };

  const toggleAlwaysOnMic = () => {
    if (alwaysOnMic) {
      setAlwaysOnMic(false);
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsConversationActive(false);
      setSphereState('idle');
    } else {
      setAlwaysOnMic(true);
      initAlwaysOnSpeech();
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#040711] text-slate-100 select-none overflow-hidden font-sans">
      {/* Top Futuristic Cyberpunk Bar */}
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-cyan-500/20 bg-[#070c1d]/80 backdrop-blur-xl">
        <div className="flex items-center space-x-3.5">
          <div className="relative flex items-center justify-center">
            <span className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_12px_#00f0ff] animate-ping" />
            <span className="absolute w-2 h-2 rounded-full bg-cyan-300" />
          </div>
          <div>
            <h1 className="font-mono font-bold text-sm tracking-[0.25em] uppercase bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
              N.O.V.A. // NEURAL VOICE OPERATING SYSTEM
            </h1>
            <div className="text-[10px] font-mono text-slate-400 flex items-center space-x-3">
              <span>ENGINE: <strong className="text-cyan-400">[{settings.geminiModel || settings.provider || 'GEMINI'}]</strong></span>
              <span>WAKE: <strong className="text-purple-400">"NOVA"</strong></span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Active Conversation Pill */}
          {isConversationActive && (
            <div className="flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-xs font-mono animate-pulse">
              <Radio className="w-3.5 h-3.5 text-emerald-400" />
              <span>ACTIVE SESSION: {sessionCountdown}s</span>
            </div>
          )}

          {/* Multimodal Screen Vision Toggle */}
          <button
            onClick={() => setIncludeVision(!includeVision)}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl border text-xs font-mono uppercase tracking-wider transition ${
              includeVision
                ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300 shadow-[0_0_15px_rgba(0,240,255,0.4)]'
                : 'border-slate-800 text-slate-400 hover:border-slate-700 bg-slate-900/60'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Vision {includeVision ? '[ON]' : '[OFF]'}</span>
          </button>

          {/* Always-on Mic State */}
          <button
            onClick={toggleAlwaysOnMic}
            className={`p-2 rounded-xl border transition ${
              alwaysOnMic
                ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-400'
            }`}
            title={alwaysOnMic ? 'Always-on Mic Active' : 'Mic Muted'}
          >
            {alwaysOnMic ? <Mic className="w-4 h-4 text-cyan-400" /> : <MicOff className="w-4 h-4 text-rose-400" />}
          </button>

          {/* Settings Trigger */}
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-xl border border-slate-800 text-slate-400 hover:text-cyan-400 hover:border-cyan-400/50 bg-slate-900/60 transition"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Grid: Holographic Core + Terminal HUD */}
      <div className="flex-1 grid grid-cols-12 gap-6 p-6 overflow-hidden">
        {/* Left 7 Columns: Central Interactive Hologram Sphere */}
        <div className="col-span-12 lg:col-span-7 flex flex-col items-center justify-center relative rounded-3xl border border-cyan-500/20 bg-gradient-to-b from-[#090f24]/50 to-[#040817]/80 backdrop-blur-xl p-6 shadow-2xl">
          <NovaSphere
            state={sphereState}
            audioLevel={audioLevel}
            isConversationActive={isConversationActive}
          />
        </div>

        {/* Right 5 Columns: Futuristic Neural Telemetry Terminal */}
        <div className="col-span-12 lg:col-span-5 h-full">
          <TerminalLogs logs={logs} />
        </div>
      </div>

      {/* Bottom Console: Always Ready For Voice or Direct Typing */}
      <div className="px-6 pb-6 pt-1">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            executeCommand();
          }}
          className="flex items-center space-x-3 max-w-5xl mx-auto bg-[#080e22]/90 border border-cyan-500/30 rounded-2xl p-2 shadow-[0_0_30px_rgba(0,0,0,0.8)] focus-within:border-cyan-400 focus-within:shadow-[0_0_25px_rgba(0,240,255,0.25)] transition backdrop-blur-xl"
        >
          <div className="flex items-center pl-3 text-cyan-400">
            <Volume2 className="w-5 h-5 animate-pulse" />
          </div>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder='Say "Nova..." or type command (e.g. "Create index.html and launch YouTube to The Hasnain Gaming")...'
            className="flex-1 bg-transparent px-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none font-mono"
          />

          <button
            type="submit"
            className="flex items-center space-x-1.5 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 rounded-xl transition shadow-[0_0_20px_rgba(0,240,255,0.4)] font-bold text-xs uppercase font-mono"
          >
            <span>Execute</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>

      {/* Model & Config Modal */}
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
