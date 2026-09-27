import React, { useState, useEffect } from 'react';
import { X, Save, Sliders, Mic, Sparkles, Key, AlertCircle, CheckCircle } from 'lucide-react';

export default function SettingsModal({ isOpen, isFirstRun = false, onClose, currentSettings, onSave }) {
  const [formData, setFormData] = useState(currentSettings);
  const [savedSuccess, setSavedSuccess] = useState(false);

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

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-2xl flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#060a1a] border border-purple-500/50 rounded-3xl shadow-[0_0_70px_rgba(147,51,234,0.35)] overflow-hidden flex flex-col animate-scaleUp">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#0a1028]">
          <div className="flex items-center space-x-2.5 text-purple-400">
            <Sliders className="w-5 h-5" />
            <h2 className="font-mono font-bold text-sm tracking-widest uppercase">
              {isFirstRun ? 'NOVA AI // INITIAL COGNITIVE SETUP' : 'SYSTEM CONFIGURATION & PERSISTENT KEYS'}
            </h2>
          </div>
          {!isFirstRun && (
            <button onClick={onClose} className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* First Run Callout */}
        {isFirstRun && (
          <div className="px-6 py-3 bg-purple-950/40 border-b border-purple-500/30 flex items-center space-x-3 text-purple-300 text-xs font-mono">
            <AlertCircle className="w-4 h-4 text-purple-400 shrink-0" />
            <span>Welcome Sir! Enter your API key below. Settings persist permanently across all reboots.</span>
          </div>
        )}

        {/* Modal Form */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">
          {/* Provider Selection Tabs */}
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
                  Gemini Model Variant
                </label>
                <input
                  list="gemini-models"
                  type="text"
                  value={formData.geminiModel || 'gemini-2.0-flash'}
                  onChange={(e) => handleChange('geminiModel', e.target.value)}
                  placeholder="gemini-2.0-flash, gemini-1.5-pro"
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-cyan-400 font-mono"
                />
                <datalist id="gemini-models">
                  <option value="gemini-2.0-flash" />
                  <option value="gemini-1.5-flash" />
                  <option value="gemini-1.5-pro" />
                </datalist>
              </div>

              <div className="pt-2 border-t border-slate-800/80">
                <label className="text-xs font-mono uppercase text-purple-300 block mb-1">
                  Fail-Safe OpenRouter Key (Automatic Backup on Rate Limit)
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
                  <option value="google/gemini-2.0-flash-exp:free" />
                  <option value="anthropic/claude-3.5-sonnet" />
                  <option value="openai/gpt-4o" />
                </datalist>
              </div>
            </div>
          )}

          {/* 3. Groq / Custom Endpoint */}
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
                  placeholder="gsk_... or custom key"
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
            <span>{savedSuccess ? 'Saved Permanently!' : 'Apply & Persist Changes'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
