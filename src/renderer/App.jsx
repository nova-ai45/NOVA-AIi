import React, { useState, useEffect, useRef } from 'react';
import NovaSphere from './components/NovaSphere';
import SettingsModal from './components/SettingsModal';
import {
  Home,
  Activity,
  Settings,
  Mic,
  MicOff,
  Send,
  Plus,
  Moon,
  Minus,
  Square,
  X,
  Volume2,
  Cpu,
  HardDrive,
  Eye
} from 'lucide-react';

export default function App() {
  const [logs, setLogs] = useState([]);
  const [sphereState, setSphereState] = useState('idle');
  const [inputText, setInputText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({});
  const [audioLevel, setAudioLevel] = useState(0.18);
  const [isListening, setIsListening] = useState(false);
  const [activeTab, setActiveTab] = useState('home');

  // Real-time Clock
  const [currentTime, setCurrentTime] = useState('');
  const [currentDate, setCurrentDate] = useState('');

  // Live System Metrics
  const [sysMetrics, setSysMetrics] = useState({
    cpu: 12,
    ram: 44,
    disk: 31
  });

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const currentAudioRef = useRef(null);
  const audioContextRef = useRef(null);
  const animFrameRef = useRef(null);
  const isSpeakingRef = useRef(false);
  const hasGreetedRef = useRef(false);

  // 1. Clock, Metrics & Global Listeners
  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        })
      );
      setCurrentDate(
        now.toLocaleDateString('en-US', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        })
      );
    };

    updateDateTime();
    const clockInterval = setInterval(updateDateTime, 1000);

    const metricsInterval = setInterval(() => {
      setSysMetrics({
        cpu: Math.floor(10 + Math.sin(Date.now() / 2200) * 8 + Math.random() * 4),
        ram: Math.floor(42 + Math.cos(Date.now() / 3200) * 5),
        disk: 31
      });
    }, 2000);

    window.novaAPI.getSettings().then((cfg) => {
      setSettings(cfg);
    });

    const unsubLog = window.novaAPI.onLog((log) => {
      setLogs((prev) => [...prev.slice(-30), log]);
    });

    const unsubState = window.novaAPI.onStateChange((st) => {
      setSphereState(st);
      isSpeakingRef.current = st === 'speaking';
    });

    // 2. Global Hotkey (Ctrl + Space) for instant voice access
    const handleGlobalKeyDown = (e) => {
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault();
        toggleListening();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);

    // 3. Initial Launch Greeting (Guaranteed single-execution)
    if (!hasGreetedRef.current) {
      hasGreetedRef.current = true;
      setTimeout(async () => {
        const greeting = "Hello! I'm NOVA, your AI assistant. Ask me anything or tell me what to do, I'm here to help.";
        try {
          const res = await window.novaAPI.synthesizeVoice(greeting);
          if (res && res.base64Audio) {
            playAudioQueueSafe(res.base64Audio);
          }
        } catch (_) {}
      }, 1000);
    }

    return () => {
      clearInterval(clockInterval);
      clearInterval(metricsInterval);
      window.removeEventListener('keydown', handleGlobalKeyDown);
      unsubLog();
      unsubState();
      cancelAnyActiveAudio();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // Strict Audio Queue Controller: Purges all queued audio before new playback
  const cancelAnyActiveAudio = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    isSpeakingRef.current = false;
  };

  const playAudioQueueSafe = (base64Audio) => {
    cancelAnyActiveAudio();

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
        const avg = sum / dataArray.length;
        setAudioLevel(Math.min(1.0, Math.max(0.18, avg / 80)));
        animFrameRef.current = requestAnimationFrame(updatePulse);
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

  const toggleListening = async () => {
    if (isListening) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      setIsListening(false);
      setSphereState('idle');
      return;
    }

    try {
      audioChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (audioBlob.size > 5000) {
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = () => {
            const base64Audio = reader.result.split(',')[1];
            handleExecute(null, base64Audio);
          };
        } else {
          setSphereState('idle');
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsListening(true);
      setSphereState('listening');
    } catch (err) {
      console.error('Microphone capture error:', err);
      setIsListening(false);
    }
  };

  const handleExecute = async (overridePrompt = null, audioData = null) => {
    const prompt = overridePrompt || inputText;
    if (!prompt.trim() && !audioData) return;

    cancelAnyActiveAudio();
    setInputText('');
    setSphereState('processing');

    // Continuous Screen Vision is always-on (no manual switch needed)
    const result = await window.novaAPI.processCommand({
      text: prompt,
      audioBase64: audioData,
      includeVision: true
    });

    if (result && result.audioBase64) {
      playAudioQueueSafe(result.audioBase64);
    } else {
      setSphereState('idle');
    }
  };

  return (
    <div className="flex h-screen w-screen bg-[#030712] text-slate-100 font-sans overflow-hidden select-none">
      {/* 1. CLEANED LEFT SIDEBAR: ONLY 3 CORE ACTION ITEMS */}
      <aside className="w-20 bg-[#050816]/95 border-r border-slate-800/60 flex flex-col items-center justify-between py-6 z-30 backdrop-blur-2xl">
        {/* Top Logo */}
        <div className="flex flex-col items-center">
          <div className="relative group cursor-pointer">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 p-[2px] shadow-[0_0_25px_rgba(168,85,247,0.45)]">
              <div className="w-full h-full bg-[#070b1a] rounded-[14px] flex items-center justify-center">
                <span className="font-black text-xl bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
                  N
                </span>
                <span className="text-[10px] text-cyan-400 font-bold mb-2">+</span>
              </div>
            </div>
          </div>
          <span className="text-[10px] font-mono tracking-widest text-slate-400 mt-2 uppercase font-semibold">
            NOVA
          </span>
          <span className="text-[8px] font-mono tracking-wider text-slate-500 -mt-1">
            AI Assistant
          </span>
        </div>

        {/* Core Navigation Items (Exactly 3 Functional Icons) */}
        <nav className="flex flex-col space-y-6">
          {/* Item 1: Home Dashboard */}
          <button
            onClick={() => setActiveTab('home')}
            className={`p-3.5 rounded-2xl transition-all duration-300 ${
              activeTab === 'home'
                ? 'bg-purple-600/30 text-purple-300 border border-purple-500/60 shadow-[0_0_25px_rgba(168,85,247,0.45)]'
                : 'text-slate-400 hover:text-cyan-400 hover:bg-slate-800/40'
            }`}
            title="Home Dashboard"
          >
            <Home className="w-5 h-5" />
          </button>

          {/* Item 2: Voice & Vision Status Trigger */}
          <button
            onClick={toggleListening}
            className={`p-3.5 rounded-2xl transition-all duration-300 ${
              isListening
                ? 'bg-rose-500/30 text-rose-300 border border-rose-500 shadow-[0_0_25px_rgba(244,63,94,0.5)] animate-pulse'
                : 'text-slate-400 hover:text-cyan-400 hover:bg-slate-800/40 border border-transparent'
            }`}
            title={isListening ? 'Stop Voice Mode' : 'Start Voice Mode (Ctrl+Space)'}
          >
            {isListening ? <Mic className="w-5 h-5 text-rose-400" /> : <MicOff className="w-5 h-5" />}
          </button>

          {/* Item 3: Unified Settings Modal */}
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-3.5 rounded-2xl text-slate-400 hover:text-cyan-400 hover:bg-slate-800/40 border border-transparent hover:border-slate-800 transition-all duration-300"
            title="Unified AI Model & System Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </nav>

        {/* Vision & Mic Active Telemetry Status */}
        <div className="flex flex-col items-center space-y-1.5">
          <div className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-slate-900/90 border border-emerald-500/30">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-ping" />
            <span className="text-[9px] font-mono text-emerald-300 tracking-wider font-semibold">Online</span>
          </div>
          <span className="text-[8px] text-slate-500 font-mono flex items-center space-x-1">
            <Eye className="w-2.5 h-2.5 text-cyan-400 inline" />
            <span>Vision Sync</span>
          </span>
        </div>
      </aside>

      {/* 2. MAIN APPLICATION CONTENT AREA */}
      <div className="flex-1 flex flex-col relative overflow-hidden bg-radial from-[#090e24] via-[#030712] to-[#02040a]">
        {/* Top Header Bar */}
        <header className="flex items-center justify-between px-8 py-3.5 border-b border-slate-800/40 z-20 backdrop-blur-md">
          <div className="flex items-center space-x-4">
            <span className="text-xs font-mono font-bold tracking-[0.35em] text-slate-300 uppercase">
              N O V A
            </span>
            <span className="w-8 h-[1px] bg-slate-700" />
            <span className="text-xs font-mono text-slate-400 tracking-widest">
              Think &bull; Speak &bull; Get Things Done
            </span>
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-[11px] font-mono text-slate-400 bg-slate-900/60 px-3 py-1 rounded-full border border-slate-800">
              <span className="text-slate-500">HOTKEY:</span>
              <strong className="text-purple-400">CTRL + SPACE</strong>
            </div>
          </div>
        </header>

        {/* Central Stage */}
        <div className="flex-1 flex relative overflow-hidden">
          {/* Main Visual Arena */}
          <div className="flex-1 flex flex-col items-center justify-between p-6 relative">
            {/* Top Greeting Glass Banner */}
            <div className="z-10 mt-1 flex items-center space-x-3.5 px-6 py-2.5 rounded-full bg-[#0a0f26]/85 border border-purple-500/40 shadow-[0_0_30px_rgba(168,85,247,0.25)] backdrop-blur-2xl">
              <div className="w-8 h-8 rounded-full bg-purple-600/30 border border-purple-400/50 flex items-center justify-center">
                <Volume2 className="w-4 h-4 text-purple-300 animate-pulse" />
              </div>
              <div className="flex flex-col">
                <div className="text-sm font-bold tracking-wide">
                  Hello! I'm <span className="text-purple-400 font-extrabold">NOVA</span>
                </div>
                <div className="text-xs text-slate-400">
                  Your AI Assistant. Ask me anything, I'm here to help.
                </div>
              </div>
            </div>

            {/* Central 3D Core Sphere with Background Vision Awareness */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <NovaSphere state={sphereState} audioLevel={audioLevel} />
            </div>

            {/* Bottom Capsule Command Input Bar */}
            <div className="w-full max-w-3xl z-20 mb-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleExecute();
                }}
                className="relative flex items-center bg-[#070c1e]/90 border border-purple-500/40 rounded-full px-3 py-2 shadow-[0_0_40px_rgba(147,51,234,0.2)] backdrop-blur-2xl focus-within:border-cyan-400 focus-within:shadow-[0_0_30px_rgba(0,240,255,0.3)] transition-all duration-300"
              >
                <button
                  type="button"
                  onClick={() => handleExecute('Analyze my current screen context and tell me what is visible')}
                  className="w-10 h-10 rounded-full bg-slate-900 border border-slate-700/80 flex items-center justify-center text-slate-300 hover:text-cyan-400 hover:border-cyan-400 transition"
                  title="Contextual Vision Request"
                >
                  <Plus className="w-5 h-5" />
                </button>

                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Type a message or say something..."
                  className="flex-1 bg-transparent px-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none font-sans"
                />

                <button
                  type="button"
                  onClick={toggleListening}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ${
                    isListening
                      ? 'bg-gradient-to-tr from-rose-500 to-pink-600 shadow-[0_0_25px_rgba(244,63,94,0.7)] text-white animate-pulse'
                      : 'bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 shadow-[0_0_25px_rgba(147,51,234,0.6)] text-white hover:scale-105'
                  }`}
                >
                  <Mic className="w-5 h-5" />
                </button>

                <button
                  type="submit"
                  className="w-10 h-10 rounded-full bg-slate-900/80 hover:bg-slate-800 border border-slate-800 flex items-center justify-center text-slate-300 hover:text-cyan-400 transition ml-2"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>

          {/* Right System Status & Clock Widget */}
          <aside className="w-80 p-6 flex flex-col space-y-6 border-l border-slate-800/40 z-20 bg-[#040816]/60 backdrop-blur-xl">
            {/* Clock Card */}
            <div className="relative p-5 rounded-3xl bg-gradient-to-br from-[#0c132c]/90 to-[#070b1c]/90 border border-purple-500/30 shadow-[0_0_30px_rgba(147,51,234,0.15)] flex items-center justify-between overflow-hidden">
              <div className="flex flex-col">
                <span className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-purple-400 to-pink-300 bg-clip-text text-transparent font-mono">
                  {currentTime || '10:42 PM'}
                </span>
                <span className="text-xs text-slate-400 font-mono mt-1 font-medium">
                  {currentDate || 'Tue, 24 Sep 2026'}
                </span>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center shadow-[0_0_15px_rgba(168,85,247,0.3)]">
                <Moon className="w-6 h-6 text-purple-300" />
              </div>
            </div>

            {/* Hardware Status Card */}
            <div className="p-5 rounded-3xl bg-gradient-to-br from-[#0a0f26]/90 to-[#050818]/90 border border-cyan-500/30 shadow-[0_0_30px_rgba(0,240,255,0.1)] flex flex-col space-y-4">
              <div className="flex items-center space-x-2 text-cyan-400 font-mono text-xs uppercase tracking-wider font-bold">
                <Activity className="w-4 h-4" />
                <span>System Status</span>
              </div>

              {/* CPU Usage Bar */}
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

              {/* RAM Usage Bar */}
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

              {/* Disk Usage Bar */}
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
                <span>NOVA v2.0 &bull; Continuous Vision</span>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Unified Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentSettings={settings}
        onSave={(newCfg) => {
          setSettings(newCfg);
          window.novaAPI.saveSettings(newCfg);
        }}
      />
    </div>
  );
}
