import React, { useState } from 'react';
import { X, Save, Sliders, Globe, Mic, Key, Server, Cpu } from 'lucide-react';

export default function SettingsModal({ isOpen, onClose, currentSettings, onSave }) {
  const [formData, setFormData] = useState(currentSettings);

  if (!isOpen) return null;

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#060a17] border border-cyan-500/50 rounded-3xl shadow-[0_0_50px_rgba(0,240,255,0.3)] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyan-500/20 bg-[#091024]">
          <div className="flex items-center space-x-3 text-cyan-400">
            <Sliders className="w-5 h-5 animate-spin-slow" />
            <h2 className="font-mono font-bold text-sm tracking-widest uppercase">
              NOVA SYSTEM CORE SETTINGS
            </h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">
          {/* Provider Selection Tabs */}
          <div>
            <label className="text-xs font-mono uppercase text-slate-400 block mb-2 font-bold tracking-wider">
              AI ENGINE PROVIDER
            </label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'gemini', label: 'Google Gemini' },
                { id: 'openai', label: 'OpenAI Standard' },
                { id: 'custom', label: 'Custom / Local AI' }
              ].map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleChange('provider', item.id)}
                  className={`py-3 px-3 rounded-xl border text-xs font-mono uppercase tracking-wider transition ${
                    formData.provider === item.id
                      ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300 shadow-[0_0_20px_rgba(0,240,255,0.4)] font-bold'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {item.label}
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
                  Gemini Model ID (Custom or Preset)
                </label>
                <input
                  list="gemini-presets"
                  type="text"
                  value={formData.geminiModel || 'gemini-2.0-flash'}
                  onChange={(e) => handleChange('geminiModel', e.target.value)}
                  placeholder="gemini-2.0-flash, gemini-1.5-flash"
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-cyan-400 font-mono"
                />
                <datalist id="gemini-presets">
                  <option value="gemini-2.0-flash" />
                  <option value="gemini-1.5-flash" />
                  <option value="gemini-1.5-pro" />
                </datalist>
              </div>
            </div>
          )}

          {/* 2. OpenAI Config */}
          {formData.provider === 'openai' && (
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-cyan-500/30 space-y-4">
              <div>
                <label className="text-xs font-mono uppercase text-slate-300 block mb-1">OpenAI API Key</label>
                <input
                  type="password"
                  value={formData.openaiKey || ''}
                  onChange={(e) => handleChange('openaiKey', e.target.value)}
                  placeholder="sk-proj-..."
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-cyan-300 focus:outline-none focus:border-cyan-400 font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-slate-300 block mb-1">Model Name</label>
                <input
                  type="text"
                  value={formData.openaiModel || 'gpt-4o'}
                  onChange={(e) => handleChange('openaiModel', e.target.value)}
                  placeholder="gpt-4o, gpt-4o-mini"
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-cyan-400 font-mono"
                />
              </div>
            </div>
          )}

          {/* 3. Custom AI Gateway (Groq, DeepSeek, Ollama, OpenRouter, xkiro, etc.) */}
          {formData.provider === 'custom' && (
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-purple-500/40 space-y-4 shadow-[0_0_20px_rgba(168,85,247,0.15)]">
              <div className="flex items-center space-x-2 text-purple-400">
                <Server className="w-4 h-4" />
                <span className="text-xs font-mono uppercase font-bold">Custom OpenAI-Compatible Endpoint</span>
              </div>

              <div>
                <label className="text-xs font-mono uppercase text-slate-300 block mb-1">
                  Base URL (Endpoint)
                </label>
                <input
                  type="text"
                  value={formData.customBaseURL || ''}
                  onChange={(e) => handleChange('customBaseURL', e.target.value)}
                  placeholder="e.g. https://api.groq.com/openai/v1 or http://localhost:11434/v1"
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-cyan-300 focus:outline-none focus:border-purple-400 font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-mono uppercase text-slate-300 block mb-1">
                  API Key / Token (Leave blank if local Ollama)
                </label>
                <input
                  type="password"
                  value={formData.customKey || ''}
                  onChange={(e) => handleChange('customKey', e.target.value)}
                  placeholder="gsk_... or sk-..."
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-purple-400 font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-mono uppercase text-slate-300 block mb-1">
                  Model ID (Unique Identifier)
                </label>
                <input
                  type="text"
                  value={formData.customModel || ''}
                  onChange={(e) => handleChange('customModel', e.target.value)}
                  placeholder="e.g. deepseek-chat, llama-3.3-70b-versatile, qwen2.5"
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-purple-400 font-mono"
                />
              </div>
            </div>
          )}

          {/* Voice & Language Settings */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-cyan-500/20 space-y-4">
            <div className="flex items-center space-x-2 text-cyan-400">
              <Mic className="w-4 h-4" />
              <label className="text-xs font-mono uppercase text-slate-300 font-bold">
                NOVA Voice Accent & Language (Urdu / Hindi / English)
              </label>
            </div>
            <select
              value={formData.voice || 'ur-PK-UzmaNeural'}
              onChange={(e) => handleChange('voice', e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-200 focus:outline-none focus:border-cyan-400 font-mono"
            >
              <option value="ur-PK-UzmaNeural">Uzma (Urdu - Pakistan Female) [اردو]</option>
              <option value="ur-PK-AsadNeural">Asad (Urdu - Pakistan Male) [اردو]</option>
              <option value="hi-IN-SwaraNeural">Swara (Hindi Female) [हिंदी / اردو]</option>
              <option value="hi-IN-MadhurNeural">Madhur (Hindi Male) [हिंदी / اردو]</option>
              <option value="en-US-AriaNeural">Aria (English Female - Natural)</option>
              <option value="en-US-GuyNeural">Guy (English Male - Deep)</option>
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end items-center px-6 py-4 bg-[#091024] border-t border-slate-800 space-x-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-mono uppercase text-slate-400 hover:text-white">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs font-mono uppercase transition shadow-[0_0_20px_rgba(0,240,255,0.4)]"
          >
            <Save className="w-4 h-4" />
            <span>Save & Apply Matrix</span>
          </button>
        </div>
      </div>
    </div>
  );
}
