import React, { useState, useEffect, useRef } from 'react';
import NovaSphere from './components/NovaSphere';
import TerminalLogs from './components/TerminalLogs';
import SettingsModal from './components/SettingsModal';
import { Mic, Settings, Send, Eye, ShieldCheck, Activity, Volume2, Sparkles } from 'lucide-react';

export default function App() {
  const [logs, setLogs] = useState([]);
  const [sphereState, setSphereState] = useState('idle');
  const [includeVision, setIncludeVision] = useState(true); // Vision active by default
  const [inputText, setInputText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({});
  const [audioLevel, setAudioLevel] = useState(0.2);
  const [isRecording, setIsRecording] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const animFrameRef = useRef(null);
  const isSpeakingRef = useRef(false);

  useEffect(() => {
    window.novaAPI.getSettings().then(setSettings);

    const unsubscribeLog = window.novaAPI.onLog((log) => {
      setLogs((prev) => [...prev, log]);
    });

    const unsubscribeState = window.novaAPI.onStateChange((state) => {
      setSphereState(state);
      isSpeakingRef.current = state === 'speaking';
    });

    // Spacebar to talk shortcut
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && e.target.tagName !== 'INPUT' && !isRecording && !isSpeakingRef.current) {
        e.preventDefault();
        startPhysicalMicRecording();
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === 'Space' && e.target.tagName !== 'INPUT' && isRecording) {
        e.preventDefault();
        stopPhysicalMicRecording();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Boot Greeting Voice
    setTimeout(() => {
      window.novaAPI.synthesizeVoice('NOVA neural core online. Screen vision and PC controls initialized. How may I assist you, Sir?')
        .then((res) => {
          if (res && res.base64Audio) playAudioWithWaveAnimation(res.base64Audio);
        });
    }, 1200);

    return () => {
      unsubscribeLog();
      unsubscribeState();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isRecording]);

  // Physical Microphone Stream (Zero Google Dependency - 100% Reliable in Electron)
  const startPhysicalMicRecording = async () => {
    try {
      audioChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Live volume feedback while talking
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 64;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const monitorVoice = () => {
        if (!isRecording) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        setAudioLevel(Math.min(1.0, Math.max(0.2, avg / 70)));
        requestAnimationFrame(monitorVoice);
      };

      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Audio = reader.result.split(',')[1];
          executeCommand(null, base64Audio);
        };
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setSphereState('listening');
      monitorVoice();
    } catch (err) {
      setLogs((prev) => [...prev, {
        timestamp: new Date().toLocaleTimeString(),
        type: 'error',
        message: `Microphone access denied: ${err.message}. Please check Windows privacy settings.`
      }]);
    }
  };

  const stopPhysicalMicRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setAudioLevel(0.2);
    }
  };

  // Playback Edge-TTS Audio with reactive Waveforms
  const playAudioWithWaveAnimation = (base64Audio) => {
    try {
      isSpeakingRef.current = true;
      setSphereState('speaking');

      const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
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

      const updateWave = () => {
        if (!isSpeakingRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        setAudioLevel(Math.min(1.0, Math.max(0.2, avg / 80)));
        animFrameRef.current = requestAnimationFrame(updateWave);
      };

      audio.onplay = () => updateWave();
      audio.onended = () => {
        isSpeakingRef.current = false;
        setSphereState('idle');
        setAudioLevel(0.2);
      };

      audio.play();
    } catch (err) {
      isSpeakingRef.current = false;
      setSphereState('idle');
    }
  };

  const executeCommand = async (textPrompt = null, audioPayload = null) => {
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
      playAudioWithWaveAnimation(result.audioBase64);
    } else {
      setSphereState('idle');
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#040711] text-slate-100 select-none overflow-hidden font-sans">
      {/* Top Cyberpunk Navigation Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-cyan-500/20 bg-[#070c1d]/90 backdrop-blur-xl">
        <div className="flex items-center space-x-3.5">
          <div className="relative flex items-center justify-center">
            <span className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_12px_#00f0ff] animate-ping" />
            <span className="absolute w-2 h-2 rounded-full bg-cyan-300" />
          </div>
          <div>
            <h1 className="font-mono font-bold text-sm tracking-[0.25em] uppercase bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
              N.O.V.A. // DESKTOP OPERATING INTELLIGENCE
            </h1>
            <div className="text-[10px] font-mono text-slate-400 flex items-center space-x-3">
              <span>MODEL: <strong className="text-cyan-400">[{settings.geminiModel || 'gemini-3.8-flash'}]</strong></span>
              <span>HOLD <strong className="text-purple-400">[SPACEBAR]</strong> TO TALK</span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Real-time Screen Vision Toggle */}
          <button
            onClick={() => setIncludeVision(!includeVision)}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl border text-xs font-mono uppercase tracking-wider transition ${
              includeVision
                ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300 shadow-[0_0_15px_rgba(0,240,255,0.4)]'
                : 'border-slate-800 text-slate-400 hover:border-slate-700 bg-slate-900/60'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Screen Vision {includeVision ? '[ACTIVE]' : '[OFF]'}</span>
          </button>

          {/* Settings Modal Toggle */}
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-xl border border-slate-800 text-slate-400 hover:text-cyan-400 hover:border-cyan-400/50 bg-slate-900/60 transition"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Core HUD View */}
      <div className="flex-1 grid grid-cols-12 gap-6 p-6 overflow-hidden">
        {/* Left Column: Holographic Nova Sphere */}
        <div className="col-span-12 lg:col-span-7 flex flex-col items-center justify-center relative rounded-3xl border border-cyan-500/20 bg-gradient-to-b from-[#090f24]/50 to-[#040817]/80 backdrop-blur-xl p-6 shadow-2xl">
          <NovaSphere state={sphereState} audioLevel={audioLevel} />

          {/* Direct Physical Push-To-Talk Button */}
          <div className="mt-4 flex flex-col items-center space-y-2">
            <button
              onMouseDown={startPhysicalMicRecording}
              onMouseUp={stopPhysicalMicRecording}
              onTouchStart={startPhysicalMicRecording}
              onTouchEnd={stopPhysicalMicRecording}
              className={`flex items-center space-x-2 px-6 py-2.5 rounded-full font-mono text-xs font-bold uppercase transition tracking-wider ${
                isRecording
                  ? 'bg-rose-500 text-white shadow-[0_0_30px_#f43f5e] scale-105 animate-pulse'
                  : 'bg-cyan-500/20 text-cyan-300 border border-cyan-400 hover:bg-cyan-500/30'
              }`}
            >
              <Mic className="w-4 h-4" />
              <span>{isRecording ? 'Listening... Release to Execute' : 'Hold to Talk (Or Press Space)'}</span>
            </button>
          </div>
        </div>

        {/* Right Column: Live Terminal Telemetry */}
        <div className="col-span-12 lg:col-span-5 h-full">
          <TerminalLogs logs={logs} />
        </div>
      </div>

      {/* Bottom Command Input Bar */}
      <div className="px-6 pb-6 pt-1">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            executeCommand();
          }}
          className="flex items-center space-x-3 max-w-5xl mx-auto bg-[#080e22]/90 border border-cyan-500/30 rounded-2xl p-2 shadow-2xl focus-within:border-cyan-400 focus-within:shadow-[0_0_25px_rgba(0,240,255,0.25)] transition backdrop-blur-xl"
        >
          <div className="flex items-center pl-3 text-cyan-400">
            <Volume2 className="w-5 h-5" />
          </div>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type command (e.g. 'Open Chrome to YouTube The Hasnain Gaming' or 'Launch Notepad')..."
            className="flex-1 bg-transparent px-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none font-mono"
          />

          <button
            type="submit"
            className="flex items-center space-x-1.5 px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-xl transition shadow-[0_0_20px_rgba(0,240,255,0.4)] font-bold text-xs uppercase font-mono"
          >
            <span>Run</span>
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
