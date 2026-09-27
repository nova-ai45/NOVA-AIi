import React, { useState, useEffect } from 'react';
import { X, Save, Sliders, Mic, Sparkles, AlertCircle, CheckCircle, Trash2, Keyboard } from 'lucide-react';

export default function SettingsModal({
  isOpen,
  isFirstRun = false,
  onClose,
  currentSettings,
  onClearMemory,
  onSave
}) {
  const [formData, setFormData] = useState(currentSettings);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [memoryCleared, setMemoryCleared] = useState(false);
  const [recordingHotkey, setRecordingHotkey] = useState(false);

  useEffect(() => {
    setFormData(currentSettings);
  }, [currentSettings]);

  if (!isOpen) return null;

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave(formData);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 800);
  };

  const handleMemoryPurge = () => {
    if (onClearMemory) onClearMemory();
    setMemoryCleared(true);
    setTimeout(() => setMemoryCleared(false), 2000);
  };

  // Interactive Hotkey Capture Engine
  const handleHotkeyKeyDown = (e) => {
    if (!recordingHotkey) return;
    e.preventDefault();
    e.stopPropagation();

    // Ignore single modifier key presses
    if (['Alt', 'Control', 'Shift', 'Meta'].includes(e.key)) return;

    const parts = [];
    if (e.ctrlKey) parts.push('Control');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');

    let keyName = e.code.replace(/^(Key|Digit)/, '');
    if (keyName === 'Space') keyName = 'Space';

    parts.push(keyName);
    const hotkeyCombination = parts.join('+');

    handleChange('globalHotkey', hotkeyCombination);
    setRecordingHotkey(false);

    // Dynamic registrar update in main process
    if (window.novaAPI.updateHotkey) {
      window.novaAPI.updateHotkey(hotkeyCombination);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-2xl flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#060a1a] border border-purple-500/50 rounded-3xl shadow-[0_0_70px_rgba(147,51,234,0.35)] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#0a1028]">
          <div className="flex items-center space-x-2.5 text-purple-400">
            <Sliders className="w-5 h-5" />
            <h2 className="font-mono font-bold text-sm tracking-widest uppercase">
              {isFirstRun ? 'NOVA AI // INITIAL COGNITIVE SETUP' : 'SYSTEM CONFIGURATION & CONVERSATIONAL MEMORY'}
            </h2>
          </div>
          {!isFirstRun && (
            <button onClick={onClose} className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {isFirstRun && (
          <div className="px-6 py-3 bg-purple-950/40 border-b border-purple-500/30 flex items-center space-x-3 text-purple-300 text-xs font-mono">
            <AlertCircle className="w-4 h-4 text-purple-400 shrink-0" />
            <span>Welcome Sir! Enter your API key below. Settings and conversation context persist across app restarts.</span>
          </div>
        )}

        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">
          {/* Provider Selection */}
          <div>
            <label className="text-xs font-mono uppercase text-slate-400 block mb-2 font-semibold tracking-wider">
              Primary Cognitive Gateway
            </label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'gemini', label: 'Google Gemini' },
                { id: 'openrouter', label: 'OpenRouter (Multi-Model)' },
                { id: 'custom', label: 'Groq / Custom API' }
              ].map((prov) => (
                <button
                  key={prov.id}
                  type="button"
                  onClick={() => handleChange('provider', prov.id)}
                  className={`py-3 px-3 rounded-2xl border text-xs font-mono uppercase tracking-wider transition ${
                    formData.provider === prov.id
                      ? 'border-purple-400 bg-purple-600/25 text-purple-200 shadow-[0_0_20px_rgba(168,85,247,0.35)] font-bold'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {prov.label}
                </button>
              ))}
            </div>
          </div>

          {/* 1. Google Gemini Config */}
          {formData.provider === 'gemini' && (
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-cyan-500/30 space-y-4">
              <div>
                <label className="text-xs font-mono uppercase text-slate-300 block mb-1">
                  Google Gemini API Key
                </label>
                <input
                  type="password"
                  value={formData.geminiKey || ''}
                  onChange={(e) => handleChange('geminiKey', e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-cyan-300 focus:outline-none focus:border-cyan-400 font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-mono uppercase text-slate-300 block mb-1">
                  Gemini Model (Default: gemini-2.5-flash)
                </label>
                <input
                  list="gemini-models"
                  type="text"
                  value={formData.geminiModel || 'gemini-2.5-flash'}
                  onChange={(e) => handleChange('geminiModel', e.target.value)}
                  placeholder="gemini-2.5-flash, gemini-2.0-flash, gemini-1.5-pro"
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-cyan-400 font-mono"
                />
                <datalist id="gemini-models">
                  <option value="gemini-2.5-flash" />
                  <option value="gemini-2.0-flash" />
                  <option value="gemini-1.5-pro" />
                  <option value="gemini-1.5-flash" />
                </datalist>
              </div>

              <div className="pt-2 border-t border-slate-800/80">
                <label className="text-xs font-mono uppercase text-purple-300 block mb-1">
                  Backup OpenRouter Key (Failover on Rate-Limit)
                </label>
                <input
                  type="password"
                  value={formData.openrouterKey || ''}
                  onChange={(e) => handleChange('openrouterKey', e.target.value)}
                  placeholder="sk-or-v1-..."
                  className="w-full px-3.5 py-2 bg-slate-900/80 border border-slate-800 rounded-xl text-xs text-purple-300 focus:outline-none focus:border-purple-400 font-mono"
                />
              </div>
            </div>
          )}

          {/* 2. OpenRouter Config */}
          {formData.provider === 'openrouter' && (
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-purple-500/30 space-y-4 shadow-[0_0_20px_rgba(168,85,247,0.15)]">
              <div>
                <label className="text-xs font-mono uppercase text-slate-300 block mb-1">
                  OpenRouter API Key
                </label>
                <input
                  type="password"
                  value={formData.openrouterKey || ''}
                  onChange={(e) => handleChange('openrouterKey', e.target.value)}
                  placeholder="sk-or-v1-..."
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-purple-300 focus:outline-none focus:border-purple-400 font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-mono uppercase text-slate-300 block mb-1">
                  OpenRouter Model ID
                </label>
                <input
                  list="openrouter-models"
                  type="text"
                  value={formData.openrouterModel || 'meta-llama/llama-3.3-70b-instruct:free'}
                  onChange={(e) => handleChange('openrouterModel', e.target.value)}
                  placeholder="e.g. meta-llama/llama-3.3-70b-instruct:free"
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-purple-400 font-mono"
                />
                <datalist id="openrouter-models">
                  <option value="meta-llama/llama-3.3-70b-instruct:free" />
                  <option value="deepseek/deepseek-r1:free" />
                  <option value="qwen/qwen-2.5-72b-instruct:free" />
                  <option value="anthropic/claude-3.5-sonnet" />
                  <option value="openai/gpt-4o" />
                </datalist>
              </div>
            </div>
          )}

          {/* 3. Custom API Gateway */}
          {formData.provider === 'custom' && (
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-4">
              <div>
                <label className="text-xs font-mono uppercase text-slate-300 block mb-1">Base Endpoint URL</label>
                <input
                  type="text"
                  value={formData.customBaseURL || 'https://api.groq.com/openai/v1'}
                  onChange={(e) => handleChange('customBaseURL', e.target.value)}
                  placeholder="https://api.groq.com/openai/v1"
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-cyan-300 focus:outline-none focus:border-cyan-400 font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-slate-300 block mb-1">API Key / Token</label>
                <input
                  type="password"
                  value={formData.customKey || ''}
                  onChange={(e) => handleChange('customKey', e.target.value)}
                  placeholder="gsk_... or custom token"
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-cyan-400 font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-slate-300 block mb-1">Model Name</label>
                <input
                  type="text"
                  value={formData.customModel || 'llama-3.3-70b-versatile'}
                  onChange={(e) => handleChange('customModel', e.target.value)}
                  placeholder="llama-3.3-70b-versatile"
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-cyan-400 font-mono"
                />
              </div>
            </div>
          )}

          {/* User-Customizable OS Push-to-Talk Global Hotkey */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-purple-500/30 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-purple-400">
                <Keyboard className="w-4 h-4" />
                <label className="text-xs font-mono uppercase text-slate-300 font-bold">
                  Global Push-to-Talk Hotkey (Default: Alt+Space)
                </label>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">Works in background</span>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="text"
                readOnly
                value={recordingHotkey ? 'Press keys combination...' : formData.globalHotkey || 'Alt+Space'}
                onKeyDown={handleHotkeyKeyDown}
                className={`flex-1 px-3.5 py-2 rounded-xl text-sm font-mono focus:outline-none border ${
                  recordingHotkey
                    ? 'bg-purple-950/60 border-purple-400 text-purple-200 animate-pulse'
                    : 'bg-slate-900 border-slate-800 text-cyan-300'
                }`}
              />
              <button
                type="button"
                onClick={() => setRecordingHotkey(!recordingHotkey)}
                className={`px-4 py-2 rounded-xl text-xs font-mono uppercase font-bold transition ${
                  recordingHotkey
                    ? 'bg-rose-500 hover:bg-rose-600 text-white'
                    : 'bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_15px_rgba(147,51,234,0.4)]'
                }`}
              >
                {recordingHotkey ? 'Cancel' : 'Record Hotkey'}
              </button>
            </div>
            <p className="text-[10px] text-slate-500 font-mono">
              Click "Record Hotkey" and press your combination (e.g., Alt+Space, Control+Shift+Z). Press key to start speaking, press again to submit immediately.
            </p>
          </div>

          {/* Multi-Turn Context Memory Management */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
            <div className="flex flex-col space-y-0.5">
              <span className="text-xs font-mono font-bold text-slate-300 uppercase">Conversational Memory Context</span>
              <span className="text-[11px] text-slate-500 font-mono">
                NOVA retains the last 20 conversation turns. Reset to start a clean session.
              </span>
            </div>
            <button
              type="button"
              onClick={handleMemoryPurge}
              className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl border text-xs font-mono uppercase font-bold transition ${
                memoryCleared
                  ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{memoryCleared ? 'Purged!' : 'Clear Memory'}</span>
            </button>
          </div>

          {/* Voice Engine */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
            <div className="flex items-center space-x-2 text-cyan-400">
              <Mic className="w-4 h-4" />
              <label className="text-xs font-mono uppercase text-slate-300 font-bold">Natural Voice Persona</label>
            </div>
            <select
              value={formData.voice || 'en-US-AriaNeural'}
              onChange={(e) => handleChange('voice', e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-200 focus:outline-none focus:border-cyan-400 font-mono"
            >
              <option value="en-US-AriaNeural">Aria (English Female - Natural Executive)</option>
              <option value="en-US-GuyNeural">Guy (English Male - Deep Tactical)</option>
              <option value="ur-PK-UzmaNeural">Uzma (Urdu Female - Pakistan)</option>
              <option value="hi-IN-SwaraNeural">Swara (Hindi Female - India)</option>
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end items-center px-6 py-4 bg-[#0a1028] border-t border-slate-800 space-x-3">
          {!isFirstRun && (
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-mono uppercase text-slate-400 hover:text-white transition">
              Cancel
            </button>
          )}
          <button
            onClick={handleSave}
            className="flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-bold text-xs font-mono uppercase transition shadow-[0_0_20px_rgba(168,85,247,0.4)]"
          >
            {savedSuccess ? <CheckCircle className="w-4 h-4 text-emerald-300" /> : <Save className="w-4 h-4" />}
            <span>{savedSuccess ? 'Saved Permanently!' : 'Save & Persist Changes'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
