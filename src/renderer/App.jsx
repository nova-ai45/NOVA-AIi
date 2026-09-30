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
    { timestamp: 'SYSTEM', message: "nova.core(status=\"ready\", audio=\"direct_stream\")" },
    { timestamp: 'ACTIVE', message: "System Initialized | Ready for Direct Commands" }
  ]);
  const [sphereState, setSphereState] = useState('idle'); // 'idle' | 'listening' | 'thinking' | 'speaking' | 'executing'
  const [inputText, setInputText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({});
  const [audioLevel, setAudioLevel] = useState(0);
  const [liveMicPercent, setLiveMicPercent] = useState(0);
  const [isSpeakingNow, setIsSpeakingNow] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [activeTab, setActiveTab] = useState('assistant');

  // Multi-Turn Memory Buffer
  const [chatHistory, setChatHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('nova_chat_history');
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item) =>
          item &&
          item.text &&
          !item.text.includes('[Voice Directive]') &&
          !item.text.includes('آپ کیا پوچھنا چاہتے ہیں')
      );
    } catch (_) {
      return [];
    }
  });

  const [cpuUsage, setCpuUsage] = useState(38);

  // Audio Context & VAD Refs
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const silenceTimerRef = useRef(null);
  const maxSafetyTimerRef = useRef(null);
  const isRecordingActiveRef = useRef(false);
  const isProcessingRef = useRef(false);
  const animFrameRef = useRef(null);
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
    });

    const unsubLog = window.novaAPI.onLog((log) => {
      setLogs((prev) => [...prev.slice(-40), log]);
      setTimeout(() => terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    });

    const unsubState = window.novaAPI.onStateChange((st) => {
      setSphereState(st);
    });

    // Start 100% Direct Hardware Sound-Card Stream
    startDirectHardwareMicrophone();

    return () => {
      clearInterval(cpuInterval);
      unsubLog();
      unsubState();
      stopDirectHardwareMicrophone();
      stopOngoingSpeechPlayback();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // براہِ راست ساؤنڈ کارڈ سے مائیکروفون سٹریمنگ
  const startDirectHardwareMicrophone = async () => {
    try {
      if (mediaStreamRef.current) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true
        }
      });
      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.2;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const bufferLength = analyser.fftSize;
      const timeData = new Uint8Array(bufferLength);

      const audioTrack = stream.getAudioTracks()[0];
      const micDeviceName = audioTrack ? audioTrack.label : 'Microphone';
      setLogs((prev) => [...prev, { timestamp: 'MIC', message: `Hardware Connected: "${micDeviceName}" [LIVE]` }]);

      const SILENCE_TIMEOUT_MS = 1200; // مکمل بات کر کے 1.2 سیکنڈ خاموش ہونے پر خودکار تھنکنگ
      const MAX_RECORD_LIMIT_MS = 8000; // 8 سیکنڈ کا فیل سیف

      const hardwareVADLoop = () => {
        if (isProcessingRef.current || sphereState === 'speaking' || micMuted) {
          setLiveMicPercent(0);
          setAudioLevel(0);
          setIsSpeakingNow(false);
          animFrameRef.current = requestAnimationFrame(hardwareVADLoop);
          return;
        }

        if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }

        // Time-Domain RMS صوتی انرجی کی پیمائش
        analyser.getByteTimeDomainData(timeData);
        let sumSquares = 0;
        for (let i = 0; i < bufferLength; i++) {
          const norm = (timeData[i] - 128) / 128;
          sumSquares += norm * norm;
        }
        const rms = Math.sqrt(sumSquares / bufferLength);

        // بیک گراؤنڈ شور اور پنکھے کو کاٹیں
        const cleanRms = Math.max(0, rms - 0.015);
        const volumePercent = Math.min(100, Math.round((cleanRms / 0.16) * 100));

        setLiveMicPercent(volumePercent);

        if (volumePercent > 0) {
          setAudioLevel(Math.min(1.0, 0.15 + (volumePercent / 100) * 0.85));
        } else {
          setAudioLevel(0);
        }

        const SPEECH_TRIGGER_THRESHOLD = 0.02;

        if (cleanRms > SPEECH_TRIGGER_THRESHOLD) {
          setIsSpeakingNow(true);

          if (!isRecordingActiveRef.current) {
            isRecordingActiveRef.current = true;
            setSphereState('listening');
            startRecordingAudioBuffer(stream);

            if (maxSafetyTimerRef.current) clearTimeout(maxSafetyTimerRef.current);
            maxSafetyTimerRef.current = setTimeout(() => {
              if (isRecordingActiveRef.current) {
                isRecordingActiveRef.current = false;
                finishRecordingAndSubmit();
              }
            }, MAX_RECORD_LIMIT_MS);
          }

          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else {
          setIsSpeakingNow(false);

          if (isRecordingActiveRef.current && !silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              isRecordingActiveRef.current = false;
              silenceTimerRef.current = null;
              if (maxSafetyTimerRef.current) {
                clearTimeout(maxSafetyTimerRef.current);
                maxSafetyTimerRef.current = null;
              }
              finishRecordingAndSubmit();
            }, SILENCE_TIMEOUT_MS);
          }
        }

        animFrameRef.current = requestAnimationFrame(hardwareVADLoop);
      };

      hardwareVADLoop();
    } catch (err) {
      console.error('Microphone setup error:', err);
      setLogs((prev) => [...prev, { timestamp: 'ERROR', message: `Mic Error: ${err.message}` }]);
    }
  };

  const startRecordingAudioBuffer = (stream) => {
    try {
      audioChunksRef.current = [];
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType: mime });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.start(80);
      mediaRecorderRef.current = recorder;
    } catch (_) {}
  };

  const finishRecordingAndSubmit = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (audioBlob.size > 600) {
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = () => {
            const base64Audio = reader.result.split(',')[1];
            handleExecute(null, base64Audio, 'audio/webm');
          };
        } else {
          setSphereState('idle');
          setAudioLevel(0);
        }
      };
      mediaRecorderRef.current.stop();
    } else {
      setSphereState('idle');
      setAudioLevel(0);
    }
  };

  const stopDirectHardwareMicrophone = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (maxSafetyTimerRef.current) clearTimeout(maxSafetyTimerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  };

  const toggleMicMute = () => {
    if (!micMuted) {
      setMicMuted(true);
      setLiveMicPercent(0);
      setAudioLevel(0);
      setIsSpeakingNow(false);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      setSphereState('idle');
    } else {
      setMicMuted(false);
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
    }
  };

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

  // نووا کی نیورل آواز بجانے کا صاف اور مستند پلیئر
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

      // پلے بیک کے دوران لہروں کو حرکت دیں
      const pulseInterval = setInterval(() => {
        if (activeAudioElementRef.current && !activeAudioElementRef.current.paused) {
          setAudioLevel(0.35 + Math.random() * 0.45);
        }
      }, 100);

      const onAudioFinished = () => {
        clearInterval(pulseInterval);
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
  };

  // AI کمانڈ پروسیسنگ (آواز اور ٹیکسٹ دونوں کے لیے یکساں)
  const handleExecute = async (overridePrompt = null, audioPayload = null, audioMime = 'audio/webm') => {
    const prompt = (overridePrompt || inputText || '').trim();
    if (!prompt && !audioPayload) {
      finishExecutionTurn();
      return;
    }

    stopOngoingSpeechPlayback();
    isProcessingRef.current = true;
    setInputText('');
    setSphereState('thinking');

    if (prompt) {
      setLogs((prev) => [...prev, { timestamp: 'USER', message: prompt }]);
    } else {
      setLogs((prev) => [...prev, { timestamp: 'VOICE', message: "Voice captured -> Neural processing..." }]);
    }

    const cleanHistorySnapshot = chatHistory.filter((item) => item && item.text && item.text.trim() !== '');

    const result = await window.novaAPI.processCommand({
      text: prompt,
      audioBase64: audioPayload,
      mimeType: audioMime,
      conversationHistory: cleanHistorySnapshot,
      includeVision: prompt.toLowerCase().includes('screen') || prompt.toLowerCase().includes('dekho')
    });

    if (result && result.success) {
      const spokenText = (result.spokenResponse || '').trim();

      if (spokenText) {
        setChatHistory((prev) => {
          const userTurn = { role: 'user', text: prompt || '[Voice Directive]' };
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
    <div
      onClick={() => {
        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
          audioContextRef.current.resume();
        }
      }}
      className="flex flex-col h-screen w-screen bg-[#07080c] text-slate-100 font-sans overflow-hidden select-none p-4 space-y-4"
    >
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
          <button
            onClick={openHasnainYouTubeInChrome}
            className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-gradient-to-r from-red-600 to-[#ff7700] hover:from-red-500 hover:to-[#ff9900] text-white text-xs font-mono font-bold transition shadow-[0_0_15px_rgba(255,119,0,0.4)] cursor-pointer"
            title="Open in Google Chrome: @TheHasnainGamer1"
          >
            <Youtube className="w-4 h-4" />
            <span className="tracking-tight">@TheHasnainGamer1</span>
            <ExternalLink className="w-3.5 h-3.5 opacity-80" />
          </button>

          <div className="flex items-center space-x-2 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-ping" />
            <span className="text-emerald-400 font-semibold tracking-wide">ONLINE</span>
          </div>

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
        {/* NAVIGATION & VU METER */}
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

          <div className="p-3.5 rounded-xl bg-[#121522] border border-slate-800 space-y-2">
            <div className="flex justify-between items-center text-[10px] font-mono">
              <span className="text-slate-400">VOICE INPUT</span>
              <span className={isSpeakingNow ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                {micMuted ? 'MUTED' : isSpeakingNow ? 'SPEAKING' : `${liveMicPercent}%`}
              </span>
            </div>
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-75 ${
                  isSpeakingNow
                    ? 'bg-emerald-400 shadow-[0_0_8px_#10b981]'
                    : 'bg-[#ff7700]'
                }`}
                style={{ width: `${micMuted ? 0 : liveMicPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* VOICE & RADAR INTERFACE */}
        <div className="col-span-12 md:col-span-7 flex flex-col items-center justify-between p-4 bg-[#0d0f17]/90 rounded-2xl border border-[#ff7700]/30 shadow-[0_0_30px_rgba(255,119,0,0.15)] backdrop-blur-xl relative overflow-hidden">
          <div className="w-full flex justify-between items-center text-[11px] font-mono tracking-widest text-[#ff8800] uppercase font-bold z-10">
            <span className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff8800]" />
              <span>VOICE INTERFACE (ACTIVE HARDWARE STREAM)</span>
            </span>
            <span className="opacity-50">• • •</span>
          </div>

          <div className="w-full flex-1 flex items-center justify-center relative">
            <NovaSphere state={sphereState} audioLevel={audioLevel} />
          </div>

          <div className="z-10 mb-2 flex items-center space-x-2 px-5 py-1.5 rounded-full bg-[#121522] border border-[#ff7700]/40 text-[#ffaa00] font-mono text-xs shadow-[0_0_15px_rgba(255,119,0,0.2)]">
            <span className={`w-1.5 h-1.5 rounded-full ${sphereState === 'thinking' ? 'bg-cyan-400 animate-ping' : isSpeakingNow ? 'bg-emerald-400 animate-ping' : 'bg-[#ff8800]'}`} />
            <span className="tracking-widest uppercase">
              ::: {sphereState === 'listening' ? (isSpeakingNow ? 'Recording Voice...' : 'Listening...') : sphereState === 'thinking' ? 'Analyzing...' : sphereState === 'speaking' ? 'Speaking Reply...' : 'Microphone Ready (Speak Anytime)'} :::
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
            v4.5.0 • DIRECT AUDIO DISPATCHER
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
            placeholder="Type command or speak naturally into mic..."
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
