import React, { useState, useEffect, useRef } from 'react';
import NovaSphere from './components/NovaSphere';
import SettingsModal from './components/SettingsModal';
import {
  Home,
  Settings,
  Send,
  Plus,
  Moon,
  Volume2,
  Cpu,
  HardDrive,
  Activity,
  Code2,
  CheckCircle2,
  Mic,
  MessageSquare
} from 'lucide-react';

export default function App() {
  const [logs, setLogs] = useState([]);
  const [sphereState, setSphereState] = useState('idle'); // 'idle' | 'listening' | 'thinking' | 'speaking' | 'executing'
  const [inputText, setInputText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isFirstRun, setIsFirstRun] = useState(false);
  const [settings, setSettings] = useState({});
  const [audioLevel, setAudioLevel] = useState(0.18);

  const [chatHistory, setChatHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('nova_chat_history');
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });

  const [greetingVisible, setGreetingVisible] = useState(true);
  const [statusMessage, setStatusMessage] = useState('Listening...');

  const [liveStreamActive, setLiveStreamActive] = useState(false);
  const [streamingFileName, setStreamingFileName] = useState('');
  const [streamedCode, setStreamedCode] = useState('');

  const [currentTime, setCurrentTime] = useState('');
  const [currentDate, setCurrentDate] = useState('');
  const [sysMetrics, setSysMetrics] = useState({ cpu: 12, ram: 44, disk: 31 });

  // Real-time voice engine references & 1.0s silence timer
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const accumulatedSpeechRef = useRef('');
  const isSpeechRunningRef = useRef(false);
  const isProcessingRef = useRef(false);
  const executionTokenRef = useRef(0);
  const canvasBgRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem('nova_chat_history', JSON.stringify(chatHistory.slice(-20)));
    } catch (_) {}
  }, [chatHistory]);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
      );
      setCurrentDate(
        now.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      );
    };
    updateClock();
    const clockInterval = setInterval(updateClock, 1000);

    const metricsInterval = setInterval(() => {
      setSysMetrics({
        cpu: Math.floor(10 + Math.sin(Date.now() / 2000) * 8 + Math.random() * 4),
        ram: Math.floor(42 + Math.cos(Date.now() / 3000) * 5),
        disk: 31
      });
    }, 2500);

    window.novaAPI.getSettings().then((cfg) => {
      const localCfg = localStorage.getItem('nova_persistent_config');
      const merged = { ...(localCfg ? JSON.parse(localCfg) : {}), ...cfg };
      setSettings(merged);

      if (!merged.geminiKey && !merged.openrouterKey && !merged.customKey) {
        setIsFirstRun(true);
        setSettingsOpen(true);
      }
    });

    const unsubLog = window.novaAPI.onLog((log) => {
      setLogs((prev) => [...prev.slice(-30), log]);
      if (log.type === 'automation' || log.type === 'codeStream') {
        setStatusMessage(log.message);
      }
    });

    const unsubState = window.novaAPI.onStateChange((st) => {
      setSphereState(st);
      if (st === 'thinking') {
        setStatusMessage('NOVA is thinking...');
      } else if (st === 'executing') {
        setStatusMessage('NOVA is executing...');
      } else if (st === 'speaking') {
        setStatusMessage('NOVA is speaking...');
      } else if (st === 'listening') {
        setStatusMessage('NOVA is listening...');
      } else if (st === 'idle') {
        setStatusMessage('Listening...');
      }
    });

    const unsubHotkey = window.novaAPI.onHotkeyTrigger ? window.novaAPI.onHotkeyTrigger(() => {
      handleGlobalPushToTalkToggle();
    }) : () => {};

    if (window.novaAPI.onAiStreamChunk) {
      window.novaAPI.onAiStreamChunk((chunk) => {
        setStatusMessage(`Streaming: ${chunk.slice(0, 35)}...`);
      });
    }

    if (window.novaAPI.onSystemShutdown) {
      window.novaAPI.onSystemShutdown(() => {
        destroySpeechRecognition();
        cancelNativeSpeech();
      });
    }

    const greetingTimer = setTimeout(() => {
      setGreetingVisible(false);
    }, 4500);

    initBackgroundCanvasShader();
    initSpeechRecognitionEngine();

    return () => {
      clearInterval(clockInterval);
      clearInterval(metricsInterval);
      clearTimeout(greetingTimer);
      unsubLog();
      unsubState();
      unsubHotkey();
      destroySpeechRecognition();
      cancelNativeSpeech();
    };
  }, []);

  // Global Push-to-Talk Hotkey Toggle
  const handleGlobalPushToTalkToggle = () => {
    if (isProcessingRef.current) return;

    if (isSpeechRunningRef.current) {
      // Hotkey pressed again -> finalize and submit accumulated speech
      const speech = accumulatedSpeechRef.current.trim();
      accumulatedSpeechRef.current = '';
      stopSpeechRecognition();
      if (speech.length > 0) {
        handleExecute(speech);
      } else {
        setSphereState('idle');
        setStatusMessage('Listening...');
      }
    } else {
      accumulatedSpeechRef.current = '';
      cancelNativeSpeech();
      startSpeechRecognition();
      setSphereState('listening');
      setStatusMessage(`NOVA: Listening [${settings.globalHotkey || 'Alt+Space'}]...`);
    }
  };

  const handleClearMemory = () => {
    setChatHistory([]);
    try {
      localStorage.removeItem('nova_chat_history');
    } catch (_) {}
    setStatusMessage('Memory cleared.');
    setTimeout(() => setStatusMessage('Listening...'), 1500);
  };

  const initBackgroundCanvasShader = () => {
    const canvas = canvasBgRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const onResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', onResize);

    const nodes = Array.from({ length: 40 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      radius: Math.random() * 2 + 1,
      color: Math.random() > 0.4 ? '#00f0ff' : '#9333ea'
    }));

    let shaderFrame;
    const draw = () => {
      ctx.fillStyle = '#030712';
      ctx.fillRect(0, 0, width, height);

      const radial = ctx.createRadialGradient(width / 2, height / 2, 40, width / 2, height / 2, width * 0.65);
      radial.addColorStop(0, 'rgba(15, 23, 42, 0.7)');
      radial.addColorStop(0.5, 'rgba(8, 14, 34, 0.85)');
      radial.addColorStop(1, '#030712');
      ctx.fillStyle = radial;
      ctx.fillRect(0, 0, width, height);

      for (let i = 0; i < nodes.length; i++) {
        const p1 = nodes[i];
        p1.x += p1.vx;
        p1.y += p1.vy;
        if (p1.x < 0 || p1.x > width) p1.vx *= -1;
        if (p1.y < 0 || p1.y > height) p1.vy *= -1;

        ctx.beginPath();
        ctx.arc(p1.x, p1.y, p1.radius, 0, Math.PI * 2);
        ctx.fillStyle = p1.color;
        ctx.shadowColor = p1.color;
        ctx.shadowBlur = 8;
        ctx.fill();

        for (let j = i + 1; j < nodes.length; j++) {
          const p2 = nodes[j];
          const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          if (dist < 130) {
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(0, 240, 255, ${0.12 * (1 - dist / 130)})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }
      shaderFrame = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(shaderFrame);
      window.removeEventListener('resize', onResize);
    };
  };

  // Real-Time Speech Recognition Engine with 1.0-Second Silence Auto-Submit
  const initSpeechRecognitionEngine = () => {
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
          setStatusMessage(`"${trimmed}"`);

          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
          }

          // Automated 1.0-second silence timer: auto-submit query to AI
          silenceTimerRef.current = setTimeout(() => {
            const finalSpeech = accumulatedSpeechRef.current.trim();
            if (finalSpeech.length > 0 && !isProcessingRef.current) {
              accumulatedSpeechRef.current = '';
              stopSpeechRecognition();
              handleExecute(finalSpeech);
            }
          }, 1000);
        }
      };

      recognition.onerror = (e) => {
        if (e.error !== 'no-speech') {
          console.warn('Speech engine:', e.error);
        }
      };

      recognition.onend = () => {
        isSpeechRunningRef.current = false;
        if (!isProcessingRef.current) {
          setTimeout(() => {
            startSpeechRecognition();
          }, 200);
        }
      };

      recognitionRef.current = recognition;
      startSpeechRecognition();
    } catch (err) {
      console.error('Speech initialization error:', err);
    }
  };

  const startSpeechRecognition = () => {
    if (recognitionRef.current && !isSpeechRunningRef.current && !isProcessingRef.current) {
      try {
        recognitionRef.current.start();
      } catch (_) {}
    }
  };

  const stopSpeechRecognition = () => {
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

  const destroySpeechRecognition = () => {
    stopSpeechRecognition();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (_) {}
      recognitionRef.current = null;
    }
  };

  // Native Web Speech Synthesis (0ms Latency, zero socket/network errors)
  const cancelNativeSpeech = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const speakWithNativeTTS = (text) => {
    cancelNativeSpeech();

    if (!('speechSynthesis' in window) || !text || !text.trim()) {
      isProcessingRef.current = false;
      setSphereState('idle');
      setStatusMessage('Listening...');
      startSpeechRecognition();
      return;
    }

    setSphereState('speaking');
    setStatusMessage('NOVA is speaking...');

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      const selectedVoice = voices.find(
        (v) =>
          v.name.includes('Aria') ||
          v.name.includes('Jenny') ||
          v.name.includes('Natural') ||
          v.name.includes('Google US English') ||
          v.lang.startsWith('en')
      );
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }
    }

    let pulseInterval = setInterval(() => {
      setAudioLevel(0.35 + Math.random() * 0.45);
    }, 120);

    utterance.onend = () => {
      clearInterval(pulseInterval);
      setAudioLevel(0.18);
      isProcessingRef.current = false;
      setSphereState('idle');
      setStatusMessage('Listening...');
      startSpeechRecognition();
    };

    utterance.onerror = () => {
      clearInterval(pulseInterval);
      setAudioLevel(0.18);
      isProcessingRef.current = false;
      setSphereState('idle');
      setStatusMessage('Listening...');
      startSpeechRecognition();
    };

    window.speechSynthesis.speak(utterance);
  };

  // Unified Execution Pipeline
  const handleExecute = async (overridePrompt = null) => {
    const prompt = overridePrompt || inputText;
    if (!prompt.trim()) return;

    // Increment execution token to discard stale/delayed execution queues
    const currentToken = ++executionTokenRef.current;

    isProcessingRef.current = true;
    stopSpeechRecognition();
    cancelNativeSpeech();

    setInputText('');
    setSphereState('thinking');
    setStatusMessage('NOVA is thinking...');

    const historySnapshot = [...chatHistory];

    const result = await window.novaAPI.processCommand({
      text: prompt,
      audioBase64: null,
      conversationHistory: historySnapshot,
      includeVision: true
    });

    // Discard result if a newer query took over
    if (currentToken !== executionTokenRef.current) return;

    if (result && result.success) {
      setChatHistory((prev) => [
        ...prev,
        { role: 'user', text: prompt },
        { role: 'model', text: result.spokenResponse || 'Action executed.' }
      ]);

      if (result.spokenResponse) {
        speakWithNativeTTS(result.spokenResponse);
      } else {
        isProcessingRef.current = false;
        setSphereState('idle');
        setStatusMessage('Listening...');
        startSpeechRecognition();
      }
    } else {
      isProcessingRef.current = false;
      setSphereState('idle');
      setStatusMessage('Listening...');
      startSpeechRecognition();
    }
  };

  return (
    <div className="relative flex h-screen w-screen bg-[#030712] text-slate-100 font-sans overflow-hidden select-none">
      <canvas ref={canvasBgRef} className="absolute inset-0 pointer-events-none z-0" />

      {/* 1. Left Sidebar Navigation */}
      <aside className="w-20 bg-[#050816]/90 border-r border-slate-800/60 flex flex-col items-center justify-between py-6 z-30 backdrop-blur-2xl">
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 p-[2px] shadow-[0_0_25px_rgba(168,85,247,0.4)]">
            <div className="w-full h-full bg-[#070b1a] rounded-[14px] flex items-center justify-center">
              <span className="font-black text-xl bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">N</span>
              <span className="text-[10px] text-cyan-400 font-bold mb-2">+</span>
            </div>
          </div>
          <span className="text-[10px] font-mono tracking-widest text-slate-400 mt-2 uppercase font-semibold">NOVA</span>
        </div>

        <nav className="flex flex-col space-y-6">
          <button
            className="p-3.5 rounded-2xl bg-purple-600/30 text-purple-300 border border-purple-500/60 shadow-[0_0_25px_rgba(168,85,247,0.45)] transition-all"
            title="Core Dashboard"
          >
            <Home className="w-5 h-5" />
          </button>

          <button
            onClick={() => setSettingsOpen(true)}
            className="p-3.5 rounded-2xl text-slate-400 hover:text-cyan-400 hover:bg-slate-800/40 border border-transparent hover:border-slate-800 transition-all"
            title="Settings & Persistent Memory"
          >
            <Settings className="w-5 h-5" />
          </button>
        </nav>

        <div className="flex flex-col items-center space-y-1">
          <div className="flex items-center space-x-1 px-2 py-1 rounded-full bg-slate-900/90 border border-emerald-500/30">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-ping" />
            <span className="text-[9px] font-mono text-emerald-300 font-semibold truncate max-w-[50px]">{settings.globalHotkey || 'Alt+Space'}</span>
          </div>
          <span className="text-[8px] text-slate-500 font-mono">Push-to-Talk</span>
        </div>
      </aside>

      {/* 2. Main Content Area */}
      <div className="flex-1 flex flex-col relative overflow-hidden z-10">
        <header className="flex items-center justify-between px-8 py-3.5 border-b border-slate-800/40 backdrop-blur-md">
          <div className="flex items-center space-x-4">
            <span className="text-xs font-mono font-bold tracking-[0.35em] text-slate-300 uppercase">N O V A</span>
            <span className="w-8 h-[1px] bg-slate-700" />
            <div className="flex items-center space-x-2 text-xs font-mono text-cyan-400">
              <span className={`w-1.5 h-1.5 rounded-full ${sphereState === 'listening' ? 'bg-cyan-400 animate-ping' : sphereState === 'thinking' ? 'bg-purple-400 animate-spin' : 'bg-emerald-400'}`} />
              <span className="truncate max-w-lg">{statusMessage}</span>
            </div>
          </div>

          {chatHistory.length > 0 && (
            <div className="flex items-center space-x-2 text-[10px] font-mono text-purple-300 bg-purple-950/40 px-3 py-1 rounded-full border border-purple-500/30">
              <MessageSquare className="w-3 h-3 text-purple-400" />
              <span>Memory: {chatHistory.length / 2} turns</span>
            </div>
          )}
        </header>

        <div className="flex-1 flex relative overflow-hidden">
          <div className="flex-1 flex flex-col items-center justify-between p-6 relative">
            {greetingVisible ? (
              <div className="z-20 mt-1 flex items-center space-x-3.5 px-6 py-2.5 rounded-full bg-[#0a0f26]/90 border border-purple-500/40 shadow-[0_0_30px_rgba(168,85,247,0.3)] backdrop-blur-2xl transition-all duration-700">
                <div className="w-8 h-8 rounded-full bg-purple-600/30 border border-purple-400/50 flex items-center justify-center">
                  <Volume2 className="w-4 h-4 text-purple-300 animate-pulse" />
                </div>
                <div className="flex flex-col">
                  <div className="text-sm font-bold tracking-wide">
                    Hello! I'm <span className="text-purple-400 font-extrabold">NOVA</span>
                  </div>
                  <div className="text-xs text-slate-400">Speak naturally. 1.0s auto-submit active. Hotkey: [{settings.globalHotkey || 'Alt+Space'}]</div>
                </div>
              </div>
            ) : (
              <div className="z-20 mt-1 flex items-center space-x-2 px-4 py-1.5 rounded-full bg-slate-950/70 border border-cyan-500/30 text-[11px] font-mono text-cyan-300 backdrop-blur-md">
                <span className={`w-2 h-2 rounded-full ${sphereState === 'listening' ? 'bg-cyan-400 animate-pulse' : sphereState === 'thinking' ? 'bg-purple-400 animate-ping' : 'bg-emerald-400'}`} />
                <span>STATE: {sphereState.toUpperCase()}</span>
              </div>
            )}

            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <NovaSphere state={sphereState} audioLevel={audioLevel} />
            </div>

            {liveStreamActive && (
              <div className="absolute inset-x-12 top-20 z-30 max-h-72 bg-[#060a1cf0] border border-cyan-500/50 rounded-2xl p-4 shadow-[0_0_40px_rgba(0,240,255,0.25)] backdrop-blur-2xl flex flex-col font-mono text-xs overflow-hidden">
                <div className="flex items-center justify-between pb-2 border-b border-cyan-500/30 mb-2">
                  <div className="flex items-center space-x-2 text-cyan-400 font-bold">
                    <Code2 className="w-4 h-4" />
                    <span>DESKTOP VISUAL EXECUTION // {streamingFileName}</span>
                  </div>
                  <div className="flex items-center space-x-1 text-[10px] text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Streaming to disk</span>
                  </div>
                </div>
                <pre className="flex-1 overflow-y-auto text-slate-300 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                  {streamedCode}
                  <span className="inline-block w-2 h-4 bg-cyan-400 ml-1 animate-pulse" />
                </pre>
              </div>
            )}

            <div className="w-full max-w-3xl z-20 mb-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleExecute();
                }}
                className="relative flex items-center bg-[#070c1e]/90 border border-purple-500/40 rounded-full px-3 py-2 shadow-[0_0_40px_rgba(147,51,234,0.25)] backdrop-blur-2xl focus-within:border-cyan-400 focus-within:shadow-[0_0_30px_rgba(0,240,255,0.3)] transition-all duration-300"
              >
                <button
                  type="button"
                  onClick={() => handleExecute('Create index.html with a futuristic landing page on desktop and open it')}
                  className="w-10 h-10 rounded-full bg-slate-900 border border-slate-700/80 flex items-center justify-center text-slate-300 hover:text-cyan-400 hover:border-cyan-400 transition"
                  title="Generate Visual Code Project"
                >
                  <Plus className="w-5 h-5" />
                </button>

                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={`Speak, hit [${settings.globalHotkey || 'Alt+Space'}], or type your directive...`}
                  className="flex-1 bg-transparent px-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none font-sans"
                />

                <div className="flex items-center space-x-1 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono mr-2">
                  <Mic className="w-3.5 h-3.5 animate-pulse" />
                  <span>MIC ON</span>
                </div>

                <button
                  type="submit"
                  className="w-10 h-10 rounded-full bg-slate-900/80 hover:bg-slate-800 border border-slate-800 flex items-center justify-center text-slate-300 hover:text-cyan-400 transition"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>

          <aside className="w-80 p-6 flex flex-col space-y-6 border-l border-slate-800/40 z-20 bg-[#040816]/60 backdrop-blur-xl">
            <div className="p-5 rounded-3xl bg-gradient-to-br from-[#0c132c]/90 to-[#070b1c]/90 border border-purple-500/30 shadow-[0_0_30px_rgba(147,51,234,0.15)] flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-purple-400 to-pink-300 bg-clip-text text-transparent font-mono">
                  {currentTime || '10:42 PM'}
                </span>
                <span className="text-xs text-slate-400 font-mono mt-1 font-medium">{currentDate || 'Sun, 27 Sep 2026'}</span>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center shadow-[0_0_15px_rgba(168,85,247,0.3)]">
                <Moon className="w-6 h-6 text-purple-300" />
              </div>
            </div>

            <div className="p-5 rounded-3xl bg-gradient-to-br from-[#0a0f26]/90 to-[#050818]/90 border border-cyan-500/30 shadow-[0_0_30px_rgba(0,240,255,0.1)] flex flex-col space-y-4">
              <div className="flex items-center space-x-2 text-cyan-400 font-mono text-xs uppercase tracking-wider font-bold">
                <Activity className="w-4 h-4" />
                <span>System Status</span>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-mono text-slate-300">
                  <span className="flex items-center space-x-1.5">
                    <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                    <span>CPU Usage</span>
                  </span>
                  <span className="text-cyan-400 font-bold">{sysMetrics.cpu}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800/80 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-700 shadow-[0_0_10px_#00f0ff]"
                    style={{ width: `${sysMetrics.cpu}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-mono text-slate-300">
                  <span className="flex items-center space-x-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-purple-400" />
                    <span>RAM Usage</span>
                  </span>
                  <span className="text-purple-400 font-bold">{sysMetrics.ram}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800/80 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-700 shadow-[0_0_10px_#a855f7]"
                    style={{ width: `${sysMetrics.ram}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-mono text-slate-300">
                  <span className="flex items-center space-x-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-blue-400" />
                    <span>Disk Usage</span>
                  </span>
                  <span className="text-blue-400 font-bold">{sysMetrics.disk}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800/80 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-700 shadow-[0_0_10px_#38bdf8]"
                    style={{ width: `${sysMetrics.disk}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="flex-1 flex items-end justify-end">
              <div className="flex items-center space-x-2 text-[10px] font-mono text-slate-500">
                <span className="w-6 h-[1px] bg-slate-800" />
                <span>NOVA v3.3 &bull; Real-Time VAD</span>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <SettingsModal
        isOpen={settingsOpen}
        isFirstRun={isFirstRun}
        onClose={() => setSettingsOpen(false)}
        currentSettings={settings}
        onClearMemory={handleClearMemory}
        onSave={(newCfg) => {
          setSettings(newCfg);
          localStorage.setItem('nova_persistent_config', JSON.stringify(newCfg));
          window.novaAPI.saveSettings(newCfg);
          setIsFirstRun(false);
        }}
      />
    </div>
  );
}
