import React, { useState } from 'react';
import { X, Save, Sliders, Globe, Mic, Key, Server, Cpu, Sparkles, ShieldCheck } from 'lucide-react';

export default function SettingsModal({ isOpen, onClose, currentSettings, onSave }) {
  const [formData, setFormData] = useState(currentSettings);

  if (!isOpen) return null;

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-2xl flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#060a1a] border border-purple-500/40 rounded-3xl shadow-[0_0_60px_rgba(147,51,234,0.3)] overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#0a1028]">
          <div className="flex items-center space-x-2.5 text-purple-400">
            <Sliders className="w-5 h-5" />
            <h2 className="font-mono font-bold text-sm tracking-widest uppercase">
              NOVA AI // UNIFIED BRAIN CONFIGURATION
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">
          {/* Provider Selection Tabs */}
          <div>
            <label className="text-xs font-mono uppercase text-slate-400 block mb-2 font-semibold tracking-wider">
              Primary Cognitive Gateway
            </label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'gemini', label: 'Google Gemini 2.0' },
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

          {/* 1. Google Gemini 2.0 Engine Configuration */}
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
                  Fail-Safe OpenRouter Backup Key (Zero Rate-Limit)
                </label>
                <input
                  type="password"
                  value={formData.openrouterKey || ''}
                  onChange={(e) => handleChange('openrouterKey', e.target.value)}
                  placeholder="sk-or-v1-... (Used if Gemini quota exhausts)"
                  className="w-full px-3.5 py-2 bg-slate-900/80 border border-slate-800 rounded-xl text-xs text-purple-300 focus:outline-none focus:border-purple-400 font-mono"
                />
              </div>
            </div>
          )}

          {/* 2. OpenRouter Universal Engine Configuration */}
          {formData.provider === 'openrouter' && (
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-purple-500/30 space-y-4 shadow-[0_0_20px_rgba(168,85,247,0.15)]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase text-purple-300 font-bold flex items-center space-x-1.5">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <span>OpenRouter Universal Gateway</span>
                </span>
                <span className="text-[10px] font-mono text-emerald-400">Zero Rate-Limit Failover</span>
              </div>

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
                  Model Identifier (Select Free or Type Custom)
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

          {/* 3. Groq or Custom Endpoint */}
          {formData.provider === 'custom' && (
            <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-4">
              <div>
                <label className="text-xs font-mono uppercase text-slate-300 block mb-1">Base URL</label>
                <input
                  type="text"
                  value={formData.customBaseURL || 'https://api.groq.com/openai/v1'}
                  onChange={(e) => handleChange('customBaseURL', e.target.value)}
                  placeholder="https://api.groq.com/openai/v1"
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-cyan-300 focus:outline-none focus:border-cyan-400 font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-slate-300 block mb-1">API Key</label>
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

          {/* Natural Voice Persona */}
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
            <div className="flex items-center space-x-2 text-cyan-400">
              <Mic className="w-4 h-4" />
              <label className="text-xs font-mono uppercase text-slate-300 font-bold">
                Speech Voice Persona
              </label>
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
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-mono uppercase text-slate-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-bold text-xs font-mono uppercase transition shadow-[0_0_20px_rgba(168,85,247,0.4)]"
          >
            <Save className="w-4 h-4" />
            <span>Apply Changes</span>
          </button>
        </div>
      </div>
    </div>
  );
}
