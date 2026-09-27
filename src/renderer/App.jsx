import React, { useState, useEffect, useRef } from 'react';
import NovaSphere from './components/NovaSphere';
import SettingsModal from './components/SettingsModal';
import {
  Home,
  Activity,
  Settings,
  Send,
  Plus,
  Moon,
  Minus,
  Square,
  X,
  Volume2,
  Cpu,
  HardDrive,
  Eye,
  Radio,
  Terminal,
  Code2,
  CheckCircle2
} from 'lucide-react';

export default function App() {
  const [logs, setLogs] = useState([]);
  const [sphereState, setSphereState] = useState('idle');
  const [inputText, setInputText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isFirstRun, setIsFirstRun] = useState(false);
  const [settings, setSettings] = useState({});
  const [audioLevel, setAudioLevel] = useState(0.18);
  const [isVADActive, setIsVADActive] = useState(true);

  // Dynamic Header Greeting state
  const [greetingVisible, setGreetingVisible] = useState(true);
  const [statusMessage, setStatusMessage] = useState('Listening for voice directives...');

  // Live Visual Automation Streaming Console
  const [liveStreamActive, setLiveStreamActive] = useState(false);
  const [streamingFileName, setStreamingFileName] = useState('');
  const [streamedCode, setStreamedCode] = useState('');

  // Clock & Telemetry
  const [currentTime, setCurrentTime] = useState('');
  const [currentDate, setCurrentDate] = useState('');
  const [sysMetrics, setSysMetrics] = useState({ cpu: 12, ram: 44, disk: 31 });

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioStreamRef = useRef(null);
  const currentAudioRef = useRef(null);
  const audioContextRef = useRef(null);
  const animFrameRef = useRef(null);
  const isSpeakingRef = useRef(false);
  const silenceTimerRef = useRef(null);
  const canvasBgRef = useRef(null);

  // 1. Initial Launch Handshake, Persistence Check & Clocks
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

    // Load Persistent Settings (electron-store / IPC bridge fallback to localStorage)
    window.novaAPI.getSettings().then((cfg) => {
      const storedLocal = localStorage.getItem('nova_persistent_config');
      const mergedConfig = { ...(storedLocal ? JSON.parse(storedLocal) : {}), ...cfg };
      setSettings(mergedConfig);

      // First-run Onboarding Trigger if no API keys are present
      if (!mergedConfig.geminiKey && !mergedConfig.openrouterKey && !mergedConfig.customKey) {
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
      isSpeakingRef.current = st === 'speaking';
      if (st === 'processing') setStatusMessage('Processing neural intent...');
      else if (st === 'executing') setStatusMessage('Executing live system automation...');
      else if (st === 'speaking') setStatusMessage('NOVA is speaking...');
      else if (st === 'idle') setStatusMessage('Always-on listening active...');
    });

    // Code Stream IPC Listener for Live Typing Visualization
    const unsubCodeStream = window.novaAPI.onCodeStream ? window.novaAPI.onCodeStream((data) => {
      setLiveStreamActive(true);
      setStreamingFileName(data.filename || 'script.js');
      setStreamedCode((prev) => prev + (data.chunk || ''));
      if (data.done) {
        setTimeout(() => setLiveStreamActive(false), 4000);
      }
    }) : () => {};

    // Fade greeting header out after 5.5 seconds into the live status badge
    const greetingTimer = setTimeout(() => {
      setGreetingVisible(false);
    }, 5500);

    // Start background canvas shader animation & continuous VAD
    initBackgroundCanvasShader();
    initHandsFreeVAD();

    return () => {
      clearInterval(clockInterval);
      clearInterval(metricsInterval);
      clearTimeout(greetingTimer);
      unsubLog();
      unsubState();
      unsubCodeStream();
      stopVAD();
      cancelActiveSpeech();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // 2. High-End Cyberpunk Ambient Canvas Shader (Fluid glowing grid & neural particles)
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

    const nodes = Array.from({ length: 45 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.45,
      vy: (Math.random() - 0.5) * 0.45,
      radius: Math.random() * 2 + 1,
      color: Math.random() > 0.4 ? '#00f0ff' : '#9333ea'
    }));

    let shaderFrame;
    const draw = () => {
      ctx.fillStyle = '#030712';
      ctx.fillRect(0, 0, width, height);

      // Deep glowing central aura
      const radial = ctx.createRadialGradient(width / 2, height / 2, 40, width / 2, height / 2, width * 0.65);
      radial.addColorStop(0, 'rgba(15, 23, 42, 0.7)');
      radial.addColorStop(0.5, 'rgba(8, 14, 34, 0.85)');
      radial.addColorStop(1, '#030712');
      ctx.fillStyle = radial;
      ctx.fillRect(0, 0, width, height);

      // Neural particle connectors
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

  // 3. Hands-Free Background Voice Activity Detection (VAD) Engine
  const initHandsFreeVAD = async () => {
    try {
      if (audioStreamRef.current) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      audioStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 64;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const SILENCE_LIMIT_MS = 1400;
      const VOICE_ENERGY_THRESHOLD = 22;

      const vadLoop = () => {
        // Prevent recording when NOVA itself is speaking
        if (isSpeakingRef.current) {
          animFrameRef.current = requestAnimationFrame(vadLoop);
          return;
        }

        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        setAudioLevel(Math.min(1.0, Math.max(0.18, avg / 75)));

        // Spoken voice detected
        if (avg > VOICE_ENERGY_THRESHOLD) {
          if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
            startVADChunkRecorder(stream);
            setSphereState('listening');
            setStatusMessage('Hearing your voice...');
          }
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else {
          // Pause/Silence detected -> Auto dispatch
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording' && !silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              finishVADChunkRecorder();
              silenceTimerRef.current = null;
            }, SILENCE_LIMIT_MS);
          }
        }
        animFrameRef.current = requestAnimationFrame(vadLoop);
      };
      vadLoop();
    } catch (err) {
      console.warn('VAD Stream Initializer:', err.message);
    }
  };

  const startVADChunkRecorder = (stream) => {
    try {
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        if (audioChunksRef.current.length > 0) {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          if (blob.size > 7000) {
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => {
              const base64Audio = reader.result.split(',')[1];
              handleExecute(null, base64Audio);
            };
          } else {
            setSphereState('idle');
          }
        }
      };
      recorder.start(100);
      mediaRecorderRef.current = recorder;
    } catch (_) {}
  };

  const finishVADChunkRecorder = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const stopVAD = () => {
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    }
  };

  // 4. Audio Playback with Realtime Visualizer Sync
  const cancelActiveSpeech = () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    isSpeakingRef.current = false;
  };

  const playSynthesizedVoice = (base64Audio) => {
    cancelActiveSpeech();
    try {
      isSpeakingRef.current = true;
      setSphereState('speaking');

      const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
      currentAudioRef.current = audio;

      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      const source = ctx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(ctx.destination);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updatePulse = () => {
        if (!isSpeakingRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        setAudioLevel(Math.min(1.0, Math.max(0.18, (sum / dataArray.length) / 75)));
        requestAnimationFrame(updatePulse);
      };

      audio.onplay = () => updatePulse();
      audio.onended = () => {
        isSpeakingRef.current = false;
        setSphereState('idle');
        setAudioLevel(0.18);
        currentAudioRef.current = null;
      };
      audio.onerror = () => {
        isSpeakingRef.current = false;
        setSphereState('idle');
        currentAudioRef.current = null;
      };
      audio.play();
    } catch (_) {
      isSpeakingRef.current = false;
      setSphereState('idle');
    }
  };

  // 5. Command Execution Handler
  const handleExecute = async (overridePrompt = null, audioData = null) => {
    const prompt = overridePrompt || inputText;
    if (!prompt.trim() && !audioData) return;

    cancelActiveSpeech();
    setInputText('');
    setSphereState('processing');

    const result = await window.novaAPI.processCommand({
      text: prompt,
      audioBase64: audioData,
      includeVision: true
    });

    if (result && result.audioBase64) {
      playSynthesizedVoice(result.audioBase64);
    } else {
      setSphereState('idle');
    }
  };

  // 6. Frameless Window Native Controls
  const handleWindowControl = (action) => {
    if (window.novaAPI.controlWindow) {
      window.novaAPI.controlWindow(action);
    }
  };

  return (
    <div className="relative flex h-screen w-screen bg-[#030712] text-slate-100 font-sans overflow-hidden select-none">
      {/* Dynamic Animated Canvas Shader Canvas */}
      <canvas ref={canvasBgRef} className="absolute inset-0 pointer-events-none z-0" />

      {/* 1. LEFT SIDEBAR NAVIGATION */}
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
            onClick={() => setActiveTab('home')}
            className="p-3.5 rounded-2xl bg-purple-600/30 text-purple-300 border border-purple-500/60 shadow-[0_0_25px_rgba(168,85,247,0.45)] transition-all"
            title="Core Dashboard"
          >
            <Home className="w-5 h-5" />
          </button>

          <div
            className="p-3.5 rounded-2xl text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 relative"
            title="Hands-Free Continuous Voice Mode Active"
          >
            <Radio className="w-5 h-5 animate-pulse" />
          </div>

          <button
            onClick={() => setSettingsOpen(true)}
            className="p-3.5 rounded-2xl text-slate-400 hover:text-cyan-400 hover:bg-slate-800/40 border border-transparent hover:border-slate-800 transition-all"
            title="AI Config & Keys"
          >
            <Settings className="w-5 h-5" />
          </button>
        </nav>

        <div className="flex flex-col items-center space-y-1">
          <div className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-slate-900/90 border border-emerald-500/30">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-ping" />
            <span className="text-[9px] font-mono text-emerald-300 font-semibold">ONLINE</span>
          </div>
          <span className="text-[8px] text-slate-500 font-mono">VAD Active</span>
        </div>
      </aside>

      {/* 2. MAIN APPLICATION CONTENT AREA */}
      <div className="flex-1 flex flex-col relative overflow-hidden z-10">
        {/* Top Header with Frameless Controls & Dynamic Indicator */}
        <header className="flex items-center justify-between px-8 py-3.5 border-b border-slate-800/40 backdrop-blur-md">
          <div className="flex items-center space-x-4">
            <span className="text-xs font-mono font-bold tracking-[0.35em] text-slate-300 uppercase">N O V A</span>
            <span className="w-8 h-[1px] bg-slate-700" />
            <div className="flex items-center space-x-2 text-xs font-mono text-cyan-400">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
              <span>{statusMessage}</span>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="text-[11px] font-mono text-slate-400 bg-slate-900/60 px-3 py-1 rounded-full border border-slate-800">
              HOTKEY: <strong className="text-purple-400">CTRL + SPACE</strong>
            </div>

            {/* Custom Frameless Window Native Controls */}
            <div className="flex items-center space-x-1.5 pl-2 border-l border-slate-800">
              <button
                onClick={() => handleWindowControl('minimize')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleWindowControl('maximize')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <Square className="w-3 h-3" />
              </button>
              <button
                onClick={() => handleWindowControl('close')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/20 transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </header>

        {/* Core Interactive Arena */}
        <div className="flex-1 flex relative overflow-hidden">
          <div className="flex-1 flex flex-col items-center justify-between p-6 relative">
            {/* Dynamic Launch Greeting Banner with Fadeout Transition */}
            {greetingVisible ? (
              <div className="z-20 mt-1 flex items-center space-x-3.5 px-6 py-2.5 rounded-full bg-[#0a0f26]/90 border border-purple-500/40 shadow-[0_0_30px_rgba(168,85,247,0.3)] backdrop-blur-2xl transition-all duration-700 animate-fadeIn">
                <div className="w-8 h-8 rounded-full bg-purple-600/30 border border-purple-400/50 flex items-center justify-center">
                  <Volume2 className="w-4 h-4 text-purple-300 animate-pulse" />
                </div>
                <div className="flex flex-col">
                  <div className="text-sm font-bold tracking-wide">
                    Hello! I'm <span className="text-purple-400 font-extrabold">NOVA</span>
                  </div>
                  <div className="text-xs text-slate-400">Your Neural AI Assistant. Speak anytime or instruct me.</div>
                </div>
              </div>
            ) : (
              <div className="z-20 mt-1 flex items-center space-x-2 px-4 py-1.5 rounded-full bg-slate-950/70 border border-cyan-500/30 text-[11px] font-mono text-cyan-300 backdrop-blur-md animate-fadeIn">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>DIRECT NEURAL LINK: {statusMessage}</span>
              </div>
            )}

            {/* Central 3D Interactive Nova Sphere */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <NovaSphere state={sphereState} audioLevel={audioLevel} />
            </div>

            {/* Live Visual Code Typing & Script Execution Overlay HUD */}
            {liveStreamActive && (
              <div className="absolute inset-x-12 top-20 z-30 max-h-72 bg-[#060a1cf0] border border-cyan-500/50 rounded-2xl p-4 shadow-[0_0_40px_rgba(0,240,255,0.25)] backdrop-blur-2xl flex flex-col font-mono text-xs overflow-hidden">
                <div className="flex items-center justify-between pb-2 border-b border-cyan-500/30 mb-2">
                  <div className="flex items-center space-x-2 text-cyan-400 font-bold">
                    <Code2 className="w-4 h-4 animate-spin-slow" />
                    <span>LIVE DESKTOP CODE STREAM // {streamingFileName}</span>
                  </div>
                  <div className="flex items-center space-x-1 text-[10px] text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Writing directly to disk</span>
                  </div>
                </div>
                <pre className="flex-1 overflow-y-auto text-slate-300 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                  {streamedCode}
                  <span className="inline-block w-2 h-4 bg-cyan-400 ml-1 animate-pulse" />
                </pre>
              </div>
            )}

            {/* Bottom Command Bar */}
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
                  onClick={() => handleExecute('Create index.html with futuristic landing page on desktop and open it')}
                  className="w-10 h-10 rounded-full bg-slate-900 border border-slate-700/80 flex items-center justify-center text-slate-300 hover:text-cyan-400 hover:border-cyan-400 transition"
                  title="Generate Visual Code Project"
                >
                  <Plus className="w-5 h-5" />
                </button>

                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Speak hands-free anytime, or type directive (e.g. 'Build a python data parser and run it')..."
                  className="flex-1 bg-transparent px-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none font-sans"
                />

                <div className="flex items-center space-x-1 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono mr-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span>MIC LIVE</span>
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

          {/* Right Utility & Hardware Metrics */}
          <aside className="w-80 p-6 flex flex-col space-y-6 border-l border-slate-800/40 z-20 bg-[#040816]/60 backdrop-blur-xl">
            {/* Clock Widget */}
            <div className="p-5 rounded-3xl bg-gradient-to-br from-[#0c132c]/90 to-[#070b1c]/90 border border-purple-500/30 shadow-[0_0_30px_rgba(147,51,234,0.15)] flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-purple-400 to-pink-300 bg-clip-text text-transparent font-mono">
                  {currentTime || '10:42 PM'}
                </span>
                <span className="text-xs text-slate-400 font-mono mt-1 font-medium">{currentDate || 'Tue, 24 Sep 2026'}</span>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center shadow-[0_0_15px_rgba(168,85,247,0.3)]">
                <Moon className="w-6 h-6 text-purple-300" />
              </div>
            </div>

            {/* System Status Metrics */}
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
                <span>NOVA v2.5 &bull; Hands-Free Active</span>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Unified Settings & First-Run Wizard Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        isFirstRun={isFirstRun}
        onClose={() => setSettingsOpen(false)}
        currentSettings={settings}
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
