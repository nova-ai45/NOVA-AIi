import React, { useState, useEffect, useRef } from 'react';
import NovaSphere from './components/NovaSphere';
import SettingsModal from './components/SettingsModal';
import {
  MessageSquare,
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
  Youtube,
  ExternalLink
} from 'lucide-react';

export default function App() {
  const [logs, setLogs] = useState([
    { timestamp: 'SYSTEM', message: "nova.run(session=\"chat_8821\", mode=\"assistant\")" },
    { timestamp: 'ACTIVE', message: "Executing: optimize(prompt) |" }
  ]);
  const [sphereState, setSphereState] = useState('idle'); // 'idle' | 'listening' | 'thinking' | 'speaking' | 'executing'
  const [inputText, setInputText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({});
  const [audioLevel, setAudioLevel] = useState(0.18);
  const [activeTab, setActiveTab] = useState('assistant');

  // Multi-Turn Memory Buffer
  const [chatHistory, setChatHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('nova_chat_history');
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });

  // Real-time System Metrics
  const [cpuUsage, setCpuUsage] = useState(42);

  // VAD & Media Refs
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const silenceTimerRef = useRef(null);
  const isSpeakingDetectedRef = useRef(false);
  const isProcessingRef = useRef(false);
  const animFrameRef = useRef(null);
  const terminalEndRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem('nova_chat_history', JSON.stringify(chatHistory.slice(-20)));
    } catch (_) {}
  }, [chatHistory]);

  useEffect(() => {
    const cpuInterval = setInterval(() => {
      setCpuUsage(Math.floor(36 + Math.sin(Date.now() / 1500) * 8 + Math.random() * 4));
    }, 2000);

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

    initHandsFreeVAD();

    return () => {
      clearInterval(cpuInterval);
      unsubLog();
      unsubState();
      stopAudioVAD();
      cancelNativeSpeech();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // 100% Hands-Free Voice Detection: خاموش ہوتے ہی خودکار تھنکنگ
  const initHandsFreeVAD = async () => {
    try {
      if (mediaStreamRef.current) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const VOICE_THRESHOLD = 20;
      const SILENCE_TIMEOUT_MS = 1200; // 1.2 سیکنڈ کی خاموشی

      const vadCheckLoop = () => {
        if (isProcessingRef.current || sphereState === 'speaking') {
          animFrameRef.current = requestAnimationFrame(vadCheckLoop);
          return;
        }

        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        setAudioLevel(Math.min(1.0, Math.max(0.18, average / 65)));

        if (average > VOICE_THRESHOLD) {
          if (!isSpeakingDetectedRef.current) {
            isSpeakingDetectedRef.current = true;
            setSphereState('listening');
            startRecordingBuffer(stream);
          }

          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else {
          if (isSpeakingDetectedRef.current && !silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              isSpeakingDetectedRef.current = false;
              silenceTimerRef.current = null;
              finishRecordingAndSubmit();
            }, SILENCE_TIMEOUT_MS);
          }
        }

        animFrameRef.current = requestAnimationFrame(vadCheckLoop);
      };

      vadCheckLoop();
    } catch (err) {
      console.error('Microphone VAD initialization error:', err);
    }
  };

  const startRecordingBuffer = (stream) => {
    try {
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.start(100);
      mediaRecorderRef.current = recorder;
    } catch (_) {}
  };

  const finishRecordingAndSubmit = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (audioBlob.size > 8000) {
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
      mediaRecorderRef.current.stop();
    } else {
      setSphereState('idle');
    }
  };

  const stopAudioVAD = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  };

  const cancelNativeSpeech = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  // آواز سے بولنے کا سسٹم (ڈیفالٹ اردو اور ہندی ترجیح)
  const speakWithNativeTTS = (text) => {
    cancelNativeSpeech();

    if (!('speechSynthesis' in window) || !text || !text.trim()) {
      isProcessingRef.current = false;
      setSphereState('idle');
      return;
    }

    setSphereState('speaking');
    window.speechSynthesis.resume();

    const utterance = new SpeechSynthesisUtterance(text);
    window._activeUtterance = utterance;

    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    if (voices && voices.length > 0) {
      // سب سے پہلی ترجیح اردو، پھر ہندی، پھر انگلش نیچرل
      const selected = voices.find(
        (v) =>
          v.lang.toLowerCase().includes('ur') ||
          v.name.toLowerCase().includes('urdu') ||
          v.lang.toLowerCase().includes('hi') ||
          v.name.toLowerCase().includes('hindi') ||
          v.name.includes('Aria') ||
          v.name.includes('Natural')
      );
      if (selected) utterance.voice = selected;
    }

    let pulseTimer = setInterval(() => {
      setAudioLevel(0.35 + Math.random() * 0.45);
    }, 120);

    const finishVoice = () => {
      clearInterval(pulseTimer);
      setAudioLevel(0.18);
      window._activeUtterance = null;
      isProcessingRef.current = false;
      setSphereState('idle');
    };

    utterance.onend = finishVoice;
    utterance.onerror = finishVoice;

    window.speechSynthesis.speak(utterance);
  };

  const handleExecute = async (overridePrompt = null, audioPayload = null) => {
    const prompt = overridePrompt || inputText;
    if (!prompt.trim() && !audioPayload) return;

    isProcessingRef.current = true;
    cancelNativeSpeech();

    setInputText('');
    setSphereState('thinking');

    if (prompt) {
      setLogs((prev) => [...prev, { timestamp: 'CMD', message: `user.query("${prompt}")` }]);
    }

    const historySnapshot = [...chatHistory];

    const result = await window.novaAPI.processCommand({
      text: prompt,
      audioBase64: audioPayload,
      conversationHistory: historySnapshot,
      includeVision: true
    });

    if (result && result.success) {
      setChatHistory((prev) => [
        ...prev,
        { role: 'user', text: prompt || '[Voice Directive]' },
        { role: 'model', text: result.spokenResponse || 'Action executed.' }
      ]);

      if (result.spokenResponse) {
        speakWithNativeTTS(result.spokenResponse);
      } else {
        isProcessingRef.current = false;
        setSphereState('idle');
      }
    } else {
      isProcessingRef.current = false;
      setSphereState('idle');
    }
  };

  // حسنائین کا یوٹیوب چینل براہ راست گوگل کروم میں کھولنے کا فنکشن (بغیر کسی اسپیس کے)
  const openHasnainYouTubeInChrome = () => {
    const channelUrl = 'https://www.youtube.com/@TheHasnainGamer1';
    if (window.novaAPI.openBrowser) {
      window.novaAPI.openBrowser({ url: channelUrl, browser: 'chrome' });
    } else {
      window.open(channelUrl, '_blank');
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#07080c] text-slate-100 font-sans overflow-hidden select-none p-4 space-y-4">
      {/* 1. TOP BAR (فالتو آئیکنز ہٹا دیے گئے ہیں اور چینل کا نام بغیر اسپیس ہے) */}
      <header className="flex items-center justify-between px-6 py-3.5 bg-[#0d0f17]/90 rounded-2xl border border-[#ff7700]/30 shadow-[0_0_25px_rgba(255,119,0,0.15)] backdrop-blur-xl">
        {/* Hexagonal Gold Logo & NOVA AI Title */}
        <div className="flex items-center space-x-3.5">
          <div className="relative flex items-center justify-center w-10 h-10">
            <svg viewBox="0 0 100 100" className="w-10 h-10 text-[#ff8800] filter drop-shadow-[0_0_8px_#ff8800]">
              <polygon
                points="50 5, 90 25, 90 75, 50 95, 10 75, 10 25"
                fill="none"
                stroke="currentColor"
                strokeWidth="5"
              />
              <polygon
                points="50 20, 80 35, 80 65, 50 80, 20 65, 20 35"
                fill="none"
                stroke="rgba(255,170,0,0.6)"
                strokeWidth="3"
              />
            </svg>
          </div>
          <div className="flex items-center space-x-3">
            <h1 className="font-mono text-2xl font-bold tracking-wider text-white">
              NOVA AI
            </h1>
            <span className="px-2.5 py-0.5 text-[11px] font-mono tracking-widest font-semibold uppercase rounded-md bg-[#ff7700]/15 border border-[#ff7700]/50 text-[#ff9900]">
              ASSISTANT
            </span>
          </div>
        </div>

        {/* Right Status & Actions (No Bell, No User Icon) */}
        <div className="flex items-center space-x-5">
          {/* Hasnain Channel YouTube Subscribe Button (Direct Chrome Open - NO SPACES) */}
          <button
            onClick={openHasnainYouTubeInChrome}
            className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-gradient-to-r from-red-600 to-[#ff7700] hover:from-red-500 hover:to-[#ff9900] text-white text-xs font-mono font-bold transition shadow-[0_0_15px_rgba(255,119,0,0.4)]"
            title="Open in Google Chrome: @TheHasnainGamer1"
          >
            <Youtube className="w-4 h-4" />
            <span>@TheHasnainGamer1</span>
            <ExternalLink className="w-3.5 h-3.5 opacity-80" />
          </button>

          {/* Online Indicator */}
          <div className="flex items-center space-x-2 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-ping" />
            <span className="text-emerald-400 font-semibold tracking-wide">ONLINE</span>
          </div>

          <div className="flex items-center pl-3 border-l border-slate-800 text-slate-400">
            <div className="p-2 rounded-xl bg-[#141824] border border-slate-800 text-[#ff8800]">
              <Mic className="w-4 h-4 animate-pulse" />
            </div>
          </div>
        </div>
      </header>

      {/* 2. MAIN CENTER GRID (Navigation, Voice Interface, System Stats) */}
      <div className="flex-1 grid grid-cols-12 gap-4 overflow-hidden">
        {/* LEFT COLUMN: NAVIGATION */}
        <div className="col-span-12 md:col-span-2 flex flex-col p-4 bg-[#0d0f17]/90 rounded-2xl border border-[#ff7700]/30 shadow-[0_0_20px_rgba(255,119,0,0.1)] backdrop-blur-xl">
          <div className="text-[11px] font-mono tracking-widest text-[#ff8800] uppercase font-bold mb-4 flex items-center space-x-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff8800]" />
            <span>NAVIGATION</span>
          </div>

          <div className="space-y-2.5 flex-1">
            <button
              onClick={() => setActiveTab('assistant')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl font-mono text-sm font-semibold transition ${
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
              className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl font-mono text-sm font-semibold text-slate-400 hover:bg-slate-900 hover:text-[#ff8800] border border-transparent hover:border-[#ff7700]/30 transition"
            >
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>
          </div>
        </div>

        {/* CENTER COLUMN: VOICE INTERFACE (Radar + Waveform) */}
        <div className="col-span-12 md:col-span-7 flex flex-col items-center justify-between p-4 bg-[#0d0f17]/90 rounded-2xl border border-[#ff7700]/30 shadow-[0_0_30px_rgba(255,119,0,0.15)] backdrop-blur-xl relative overflow-hidden">
          <div className="w-full flex justify-between items-center text-[11px] font-mono tracking-widest text-[#ff8800] uppercase font-bold z-10">
            <span className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff8800]" />
              <span>VOICE INTERFACE</span>
            </span>
            <span className="opacity-50">• • •</span>
          </div>

          {/* Central Animated Radar Visualizer */}
          <div className="w-full flex-1 flex items-center justify-center relative">
            <NovaSphere state={sphereState} audioLevel={audioLevel} />
          </div>

          {/* Bottom Voice State Label */}
          <div className="z-10 mb-2 flex items-center space-x-2 px-5 py-1.5 rounded-full bg-[#121522] border border-[#ff7700]/40 text-[#ffaa00] font-mono text-xs shadow-[0_0_15px_rgba(255,119,0,0.2)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff8800] animate-pulse" />
            <span className="tracking-widest uppercase">
              ::: {sphereState === 'listening' ? 'Listening...' : sphereState === 'thinking' ? 'Thinking...' : sphereState === 'speaking' ? 'Speaking...' : 'Listening...'} :::
            </span>
          </div>
        </div>

        {/* RIGHT COLUMN: SYSTEM STATS (With Sparkline Graph) */}
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

            {/* Glowing Amber Sparkline Graph */}
            <div className="w-full h-24 my-2">
              <svg viewBox="0 0 200 80" className="w-full h-full overflow-visible">
                <defs>
                  <linearGradient id="amberGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ff7700" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#ff7700" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <polygon
                  points="0,60 25,50 50,65 75,45 100,55 125,35 150,40 175,25 200,15 200,80 0,80"
                  fill="url(#amberGrad)"
                />
                <polyline
                  points="0,60 25,50 50,65 75,45 100,55 125,35 150,40 175,25 200,15"
                  fill="none"
                  stroke="#ff8800"
                  strokeWidth="2.5"
                  className="filter drop-shadow-[0_0_6px_#ff8800]"
                />
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

      {/* 3. BOTTOM COMMAND CONSOLE */}
      <div className="h-44 flex flex-col p-4 bg-[#0d0f17]/95 rounded-2xl border border-[#ff7700]/30 shadow-[0_0_25px_rgba(255,119,0,0.15)] backdrop-blur-xl">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800/80 mb-2">
          <div className="flex items-center space-x-2 text-[11px] font-mono tracking-widest font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff8800]" />
            <span className="text-[#ff8800]">COMMAND CONSOLE</span>
            <span className="text-slate-500">•</span>
            <span className="text-emerald-400">ACTIVE</span>
          </div>
          <div className="text-[11px] font-mono text-slate-500">
            v3.5.1-pro • NODE: nova-001
          </div>
        </div>

        {/* Live Terminal Output */}
        <div className="flex-1 overflow-y-auto font-mono text-xs text-slate-300 space-y-1.5 pr-2">
          {logs.map((log, idx) => (
            <div key={idx} className="flex items-start space-x-2">
              <span className="text-[#ff8800]">&gt; '</span>
              <span className="text-slate-200">{log.message}</span>
            </div>
          ))}
          <div ref={terminalEndRef} />
        </div>

        {/* Bottom Fast Prompt Entry Form */}
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
            placeholder="Direct command or speak naturally (e.g. 'Open YouTube in Chrome')..."
            className="flex-1 bg-transparent px-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none font-mono"
          />
          <button
            type="submit"
            className="p-2 rounded-xl bg-[#ff7700]/20 hover:bg-[#ff7700]/30 text-[#ffaa00] border border-[#ff7700]/50 transition shadow-[0_0_10px_rgba(255,119,0,0.3)]"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* Settings Modal (New Amber / Orange Cyberpunk Theme) */}
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
