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
    { timestamp: 'SYSTEM', message: "nova.core(status=\"ready\", memory=\"sanitized\")" },
    { timestamp: 'ACTIVE', message: "Acoustic VAD Engine Online |" }
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

  // Persistent sanitized conversation memory
  const [chatHistory, setChatHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('nova_chat_history');
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      // Clean up any empty items or trailing model entries
      const cleaned = parsed.filter(item => item && item.text && item.text.trim() !== '');
      while (cleaned.length > 0 && cleaned[cleaned.length - 1].role === 'model') {
        cleaned.pop();
      }
      return cleaned;
    } catch (_) {
      return [];
    }
  });

  const [cpuUsage, setCpuUsage] = useState(38);

  // Audio Context & Hardware Stream Refs
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const silenceTimerRef = useRef(null);
  const speechStartTimeRef = useRef(0);
  const isRecordingActiveRef = useRef(false);
  const isProcessingRef = useRef(false);
  const consecutiveVoiceFramesRef = useRef(0);
  const animFrameRef = useRef(null);
  const terminalEndRef = useRef(null);

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

    startJarvisStyleVAD();

    return () => {
      clearInterval(cpuInterval);
      unsubLog();
      unsubState();
      stopJarvisStyleVAD();
      cancelNativeSpeech();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  const startJarvisStyleVAD = async () => {
    try {
      if (mediaStreamRef.current) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
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
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const bufferLength = analyser.fftSize;
      const timeData = new Uint8Array(bufferLength);

      const audioTrack = stream.getAudioTracks()[0];
      const micDeviceName = audioTrack ? audioTrack.label : 'Microphone';
      setLogs((prev) => [...prev, { timestamp: 'MIC', message: `Hardware Connected: "${micDeviceName}" [LIVE]` }]);

      const SILENCE_TIMEOUT_MS = 1500;
      const MIN_SPEECH_DURATION_MS = 600;

      const vadLoop = () => {
        if (isProcessingRef.current || sphereState === 'speaking' || micMuted) {
          setLiveMicPercent(0);
          setAudioLevel(0);
          setIsSpeakingNow(false);
          animFrameRef.current = requestAnimationFrame(vadLoop);
          return;
        }

        if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }

        analyser.getByteTimeDomainData(timeData);
        let sumSquares = 0;
        for (let i = 0; i < bufferLength; i++) {
          const norm = (timeData[i] - 128) / 128;
          sumSquares += norm * norm;
        }
        const rms = Math.sqrt(sumSquares / bufferLength);

        const cleanRms = Math.max(0, rms - 0.016);
        const volumePercent = Math.min(100, Math.round((cleanRms / 0.18) * 100));

        setLiveMicPercent(volumePercent);

        if (volumePercent > 0) {
          setAudioLevel(Math.min(1.0, 0.15 + (volumePercent / 100) * 0.85));
        } else {
          setAudioLevel(0);
        }

        const SPEECH_START_THRESHOLD = 0.022;

        if (cleanRms > SPEECH_START_THRESHOLD) {
          consecutiveVoiceFramesRef.current++;

          if (consecutiveVoiceFramesRef.current >= 3) {
            setIsSpeakingNow(true);

            if (!isRecordingActiveRef.current) {
              isRecordingActiveRef.current = true;
              speechStartTimeRef.current = Date.now();
              setSphereState('listening');
              startRecordingAudioChunks(stream);
            }

            if (silenceTimerRef.current) {
              clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = null;
            }
          }
        } else {
          consecutiveVoiceFramesRef.current = 0;
          setIsSpeakingNow(false);

          if (isRecordingActiveRef.current && !silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              const totalSpeechTime = Date.now() - speechStartTimeRef.current;
              silenceTimerRef.current = null;
              isRecordingActiveRef.current = false;

              if (totalSpeechTime >= MIN_SPEECH_DURATION_MS) {
                finishAndSubmitAudio();
              } else {
                if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                  mediaRecorderRef.current.stop();
                }
                setSphereState('idle');
                setAudioLevel(0);
              }
            }, SILENCE_TIMEOUT_MS);
          }
        }

        animFrameRef.current = requestAnimationFrame(vadLoop);
      };

      vadLoop();
    } catch (err) {
      console.error('Microphone setup error:', err);
      setLogs((prev) => [...prev, { timestamp: 'ERROR', message: `Mic Error: ${err.message}` }]);
    }
  };

  const startRecordingAudioChunks = (stream) => {
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

  const finishAndSubmitAudio = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (audioBlob.size > 800) {
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = () => {
            const base64Audio = reader.result.split(',')[1];
            handleExecute(null, base64Audio);
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

  const stopJarvisStyleVAD = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
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

  const cancelNativeSpeech = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const speakWithFemaleVoice = (text) => {
    cancelNativeSpeech();

    if (!('speechSynthesis' in window) || !text || !text.trim()) {
      isProcessingRef.current = false;
      setSphereState('idle');
      setAudioLevel(0);
      return;
    }

    setSphereState('speaking');
    window.speechSynthesis.resume();

    const utterance = new SpeechSynthesisUtterance(text);
    window._activeUtterance = utterance;

    utterance.rate = 1.0;
    utterance.pitch = 1.12;

    const voices = window.speechSynthesis.getVoices();
    if (voices && voices.length > 0) {
      const femaleVoice = voices.find(
        (v) =>
          v.name.toLowerCase().includes('zira') ||
          v.name.toLowerCase().includes('heera') ||
          v.name.toLowerCase().includes('swara') ||
          v.name.toLowerCase().includes('female') ||
          v.name.toLowerCase().includes('natural') ||
          v.lang.includes('hi') ||
          v.lang.includes('ur')
      );
      if (femaleVoice) utterance.voice = femaleVoice;
    }

    let pulseTimer = setInterval(() => {
      setAudioLevel(0.35 + Math.random() * 0.45);
    }, 120);

    const finishVoice = () => {
      clearInterval(pulseTimer);
      setAudioLevel(0);
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
      setLogs((prev) => [...prev, { timestamp: 'USER', message: prompt }]);
    } else {
      setLogs((prev) => [...prev, { timestamp: 'VOICE', message: "Voice processed -> Analyzing intent..." }]);
    }

    // Ensure snapshot does not end with an orphaned user or model turn
    const cleanHistorySnapshot = chatHistory.filter(item => item && item.text && item.text.trim() !== '');

    const result = await window.novaAPI.processCommand({
      text: prompt,
      audioBase64: audioPayload,
      conversationHistory: cleanHistorySnapshot,
      includeVision: true
    });

    if (result && result.success) {
      const spokenText = (result.spokenResponse || '').trim();

      // Only append complete, valid user-model pairs to memory
      if (spokenText) {
        setChatHistory((prev) => {
          const userTurn = { role: 'user', text: prompt || '[Voice Directive]' };
          const modelTurn = { role: 'model', text: spokenText };
          return [...prev, userTurn, modelTurn].slice(-20);
        });

        speakWithFemaleVoice(spokenText);
      } else {
        isProcessingRef.current = false;
        setSphereState('idle');
        setAudioLevel(0);
      }
    } else {
      isProcessingRef.current = false;
      setSphereState('idle');
      setAudioLevel(0);
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
                {micMuted ? 'MUTED' : isSpeakingNow ? 'SPEAKING' : 'SILENT'}
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
              <span>VOICE INTERFACE (ACOUSTIC RMS VAD)</span>
            </span>
            <span className="opacity-50">• • •</span>
          </div>

          <div className="w-full flex-1 flex items-center justify-center relative">
            <NovaSphere state={sphereState} audioLevel={audioLevel} />
          </div>

          <div className="z-10 mb-2 flex items-center space-x-2 px-5 py-1.5 rounded-full bg-[#121522] border border-[#ff7700]/40 text-[#ffaa00] font-mono text-xs shadow-[0_0_15px_rgba(255,119,0,0.2)]">
            <span className={`w-1.5 h-1.5 rounded-full ${sphereState === 'thinking' ? 'bg-cyan-400 animate-ping' : isSpeakingNow ? 'bg-emerald-400 animate-ping' : 'bg-[#ff8800]'}`} />
            <span className="tracking-widest uppercase">
              ::: {sphereState === 'listening' ? (isSpeakingNow ? 'Listening To Your Voice...' : 'Waiting for Speech...') : sphereState === 'thinking' ? 'NOVA is Thinking...' : sphereState === 'speaking' ? 'Speaking Reply...' : 'Microphone Ready (Speak Anytime)'} :::
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
            v3.9.5 • TRUE JARVIS ACOUSTIC
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
