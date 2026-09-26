import React, { useState, useEffect, useRef } from 'react';
import NovaSphere from './components/NovaSphere';
import TerminalLogs from './components/TerminalLogs';
import SettingsModal from './components/SettingsModal';
import { Mic, MicOff, Settings, Send, Eye, Volume2, Radio, Activity } from 'lucide-react';

export default function App() {
  const [logs, setLogs] = useState([]);
  const [sphereState, setSphereState] = useState('idle');
  const [includeVision, setIncludeVision] = useState(true);
  const [inputText, setInputText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({});
  const [audioLevel, setAudioLevel] = useState(0.15);

  // Mute / Unmute & Automatic Voice Activity Detection (VAD)
  const [isMuted, setIsMuted] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const isSpeakingRef = useRef(false);
  const silenceTimerRef = useRef(null);
  const animFrameRef = useRef(null);

  useEffect(() => {
    window.novaAPI.getSettings().then((cfg) => {
      setSettings(cfg);
    });

    const unsubscribeLog = window.novaAPI.onLog((log) => {
      setLogs((prev) => [...prev, log]);
    });

    const unsubscribeState = window.novaAPI.onStateChange((state) => {
      setSphereState(state);
      isSpeakingRef.current = state === 'speaking';
    });

    // Start Auto Voice Listener
    startContinuousVoiceDetection();

    return () => {
      unsubscribeLog();
      unsubscribeState();
      stopContinuousVoiceDetection();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // Hands-free Voice Activity Detection (VAD) Engine
  const startContinuousVoiceDetection = async () => {
    try {
      if (audioStreamRef.current) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      audioStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 64;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const SILENCE_LIMIT_MS = 1400; // 1.4 seconds of silence triggers auto-send
      const VOICE_THRESHOLD = 20;   // Audio energy threshold

      const loop = () => {
        // IF Nova is speaking herself, or user clicked Mute -> DO NOT RECORD (Stops looping!)
        if (isSpeakingRef.current || isMuted) {
          animFrameRef.current = requestAnimationFrame(loop);
          return;
        }

        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        setAudioLevel(Math.min(1.0, Math.max(0.15, avg / 70)));

        // User started speaking
        if (avg > VOICE_THRESHOLD) {
          if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
            beginAudioRecording(stream);
            setIsUserSpeaking(true);
            setSphereState('listening');
          }
          // Reset silence timer on every new sound wave
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else {
          // User went quiet -> start silence countdown
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording' && !silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              finishAudioRecording();
              silenceTimerRef.current = null;
            }, SILENCE_LIMIT_MS);
          }
        }

        animFrameRef.current = requestAnimationFrame(loop);
      };

      loop();
    } catch (err) {
      setLogs((prev) => [
        ...prev,
        {
          timestamp: new Date().toLocaleTimeString(),
          type: 'error',
          message: `Microphone access failure: ${err.message}`
        }
      ]);
    }
  };

  const stopContinuousVoiceDetection = () => {
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    }
  };

  const beginAudioRecording = (stream) => {
    try {
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        setIsUserSpeaking(false);
        // Only submit if user actually spoke more than noise
        if (audioChunksRef.current.length > 0) {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          if (audioBlob.size > 8000) {
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = () => {
              const base64Audio = reader.result.split(',')[1];
              dispatchCommand(null, base64Audio);
            };
          } else {
            setSphereState('idle');
          }
        } else {
          setSphereState('idle');
        }
      };

      recorder.start(100);
      mediaRecorderRef.current = recorder;
    } catch (e) {
      console.error('Audio recorder error:', e);
    }
  };

  const finishAudioRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  // Play Output Speech with Wave Sync
  const playAudioFeedback = (base64Audio) => {
    try {
      isSpeakingRef.current = true;
      setSphereState('speaking');

      const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);

      audio.onplay = () => {
        setSphereState('speaking');
        setAudioLevel(0.85);
      };

      audio.onended = () => {
        isSpeakingRef.current = false;
        setSphereState('idle');
        setAudioLevel(0.15);
      };

      audio.onerror = () => {
        isSpeakingRef.current = false;
        setSphereState('idle');
      };

      audio.play();
    } catch (e) {
      isSpeakingRef.current = false;
      setSphereState('idle');
    }
  };

  const dispatchCommand = async (textPrompt = null, audioPayload = null) => {
    const query = textPrompt || inputText;
    if (!query.trim() && !audioPayload) return;

    setInputText('');
    setSphereState('processing');

    const result = await window.novaAPI.processCommand({
      text: query,
      audioBase64: audioPayload,
      includeVision
    });

    if (result && result.audioBase64) {
      playAudioFeedback(result.audioBase64);
    } else {
      setSphereState('idle');
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (!isMuted && mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#030712] text-slate-100 select-none overflow-hidden font-sans">
      {/* Top Cyberpunk Bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-cyan-500/20 bg-[#060b1c]/90 backdrop-blur-xl">
        <div className="flex items-center space-x-3.5">
          <div className="relative flex items-center justify-center">
            <span className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_12px_#00f0ff] animate-ping" />
            <span className="absolute w-2 h-2 rounded-full bg-cyan-300" />
          </div>
          <div>
            <h1 className="font-mono font-bold text-sm tracking-[0.25em] uppercase bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
              N.O.V.A. // NEURAL DESKTOP INTELLIGENCE
            </h1>
            <div className="text-[10px] font-mono text-slate-400 flex items-center space-x-3">
              <span>CORE: <strong className="text-cyan-400">[{settings.provider?.toUpperCase()}]</strong></span>
              <span>LANGUAGE: <strong className="text-emerald-400">URDU / HINDI / ENG</strong></span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Mute / Unmute Button */}
          <button
            onClick={toggleMute}
            className={`flex items-center space-x-2 px-4 py-1.5 rounded-xl border text-xs font-mono uppercase tracking-wider transition font-bold ${
              isMuted
                ? 'border-rose-500 bg-rose-500/20 text-rose-300 shadow-[0_0_15px_rgba(244,63,94,0.4)]'
                : 'border-emerald-500 bg-emerald-500/20 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.3)] animate-pulse'
            }`}
          >
            {isMuted ? <MicOff className="w-4 h-4 text-rose-400" /> : <Mic className="w-4 h-4 text-emerald-400" />}
            <span>{isMuted ? 'MIC MUTED' : 'AUTO LISTENING'}</span>
          </button>

          {/* Screen Vision Switch */}
          <button
            onClick={() => setIncludeVision(!includeVision)}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl border text-xs font-mono uppercase tracking-wider transition ${
              includeVision
                ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300 shadow-[0_0_15px_rgba(0,240,255,0.3)]'
                : 'border-slate-800 text-slate-500 bg-slate-900/60'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Vision {includeVision ? '[ON]' : '[OFF]'}</span>
          </button>

          {/* Settings Button */}
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-xl border border-slate-800 text-slate-400 hover:text-cyan-400 hover:border-cyan-400/50 bg-slate-900/60 transition"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Screen Layout */}
      <div className="flex-1 grid grid-cols-12 gap-6 p-6 overflow-hidden">
        {/* Left Column: NOVA Core Sphere & Live Voice Waves */}
        <div className="col-span-12 lg:col-span-7 flex flex-col items-center justify-center relative rounded-3xl border border-cyan-500/20 bg-gradient-to-b from-[#080d21]/60 to-[#030614]/90 backdrop-blur-xl p-6 shadow-2xl">
          <NovaSphere state={sphereState} audioLevel={audioLevel} />

          {/* Hands-free Voice Activity Live Badge */}
          <div className="mt-4 flex items-center space-x-2 px-5 py-1.5 rounded-full bg-slate-900/80 border border-slate-800 font-mono text-xs text-slate-300">
            <span className={`w-2 h-2 rounded-full ${isUserSpeaking ? 'bg-cyan-400 animate-ping' : isMuted ? 'bg-rose-500' : 'bg-emerald-400'}`} />
            <span>{isMuted ? 'Microphone is Muted' : isUserSpeaking ? 'Hearing Your Voice...' : 'Speak freely anytime, NOVA is listening'}</span>
          </div>
        </div>

        {/* Right Column: Terminal Logs */}
        <div className="col-span-12 lg:col-span-5 h-full">
          <TerminalLogs logs={logs} />
        </div>
      </div>

      {/* Bottom Command Bar */}
      <div className="px-6 pb-6 pt-1">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            dispatchCommand();
          }}
          className="flex items-center space-x-3 max-w-5xl mx-auto bg-[#070c1d]/90 border border-cyan-500/30 rounded-2xl p-2 shadow-2xl focus-within:border-cyan-400 focus-within:shadow-[0_0_25px_rgba(0,240,255,0.25)] transition backdrop-blur-xl"
        >
          <div className="flex items-center pl-3 text-cyan-400">
            <Volume2 className="w-5 h-5 animate-pulse" />
          </div>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type or just speak freely in Urdu/Hindi/English (e.g. 'یوٹیوب کھول کر The Hasnain Gaming سرچ کرو')..."
            className="flex-1 bg-transparent px-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none font-mono"
          />

          <button
            type="submit"
            className="flex items-center space-x-1.5 px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-xl transition shadow-[0_0_20px_rgba(0,240,255,0.4)] font-bold text-xs uppercase font-mono"
          >
            <span>Send</span>
            <Send className="w-3.5 h-3.5" />
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
