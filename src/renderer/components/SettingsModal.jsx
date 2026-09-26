import React, { useState } from 'react';
import { X, Save, Sliders, Cpu, Mic, Key, Globe } from 'lucide-react';

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
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#070c1b] border border-cyan-500/40 rounded-2xl shadow-[0_0_40px_rgba(0,240,255,0.25)] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#0a1126]">
          <div className="flex items-center space-x-2.5 text-cyan-400">
            <Sliders className="w-5 h-5" />
            <h2 className="font-bold text-sm tracking-widest uppercase font-mono">NOVA System Configuration</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form Content */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">
          {/* Engine Selector */}
          <div>
            <label className="text-xs font-mono uppercase tracking-wider text-slate-400 block mb-2">
              Primary Intelligence Core
            </label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'gemini', label: 'Google Gemini' },
                { id: 'openai', label: 'OpenAI Gateway' },
                { id: 'custom', label: 'Local / Custom API' }
              ].map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleChange('provider', item.id)}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-mono uppercase tracking-wider transition ${
                    formData.provider === item.id
                      ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300 shadow-[0_0_20px_rgba(0,240,255,0.3)]'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Gemini Settings: Allows Free Custom Typing */}
          {formData.provider === 'gemini' && (
            <div className="p-4 rounded-xl bg-slate-950/60 border border-cyan-500/20 space-y-4">
              <div>
                <label className="text-xs font-mono uppercase text-slate-300 block mb-1">
                  Gemini API Key (Google AI Studio)
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
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-mono uppercase text-slate-300">
                    Gemini Model Identifier (Type any model)
                  </label>
                  <span className="text-[10px] text-cyan-400 font-mono">Editable / Custom String</span>
                </div>
                {/* Datalist combo-box so user can select presets OR type any model */}
                <input
                  list="gemini-model-suggestions"
                  type="text"
                  value={formData.geminiModel || 'gemini-2.5-flash'}
                  onChange={(e) => handleChange('geminiModel', e.target.value)}
                  placeholder="e.g. gemini-2.5-flash, gemini-2.5-pro, 3.5, 3.8"
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-cyan-400 font-mono"
                />
                <datalist id="gemini-model-suggestions">
                  <option value="gemini-2.5-flash" />
                  <option value="gemini-2.5-pro" />
                  <option value="gemini-2.0-flash" />
                  <option value="gemini-2.0-flash-lite" />
                  <option value="gemini-1.5-flash" />
                  <option value="gemini-1.5-pro" />
                  <option value="gemini-3.5" />
                  <option value="gemini-3.8" />
                </datalist>
                <p className="text-[11px] text-slate-500 mt-1 font-mono">
                  Enter any current or upcoming Google Gemini model tag. Default: gemini-2.5-flash
                </p>
              </div>
            </div>
          )}

          {/* OpenAI Settings */}
          {formData.provider === 'openai' && (
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-4">
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
                  placeholder="gpt-4o, gpt-4o-mini, o1"
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-cyan-400 font-mono"
                />
              </div>
            </div>
          )}

          {/* Custom Gateway Settings */}
          {formData.provider === 'custom' && (
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-4">
              <div>
                <label className="text-xs font-mono uppercase text-slate-300 block mb-1">Base URL</label>
                <input
                  type="text"
                  value={formData.customBaseURL || ''}
                  onChange={(e) => handleChange('customBaseURL', e.target.value)}
                  placeholder="http://localhost:11434/v1"
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-cyan-300 focus:outline-none focus:border-cyan-400 font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-slate-300 block mb-1">Model ID</label>
                <input
                  type="text"
                  value={formData.customModel || ''}
                  onChange={(e) => handleChange('customModel', e.target.value)}
                  placeholder="e.g. llama3.2, deepseek-r1"
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-cyan-400 font-mono"
                />
              </div>
            </div>
          )}

          {/* Neural Voice Persona Selector */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
            <div className="flex items-center space-x-2 text-cyan-400">
              <Mic className="w-4 h-4" />
              <label className="text-xs font-mono uppercase text-slate-300">Natural Voice Persona (Free Edge-TTS)</label>
            </div>
            <select
              value={formData.voice || 'en-US-AriaNeural'}
              onChange={(e) => handleChange('voice', e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-200 focus:outline-none focus:border-cyan-400 font-mono"
            >
              <option value="en-US-AriaNeural">Aria (Female - Crisp, Futuristic Assistant)</option>
              <option value="en-US-GuyNeural">Guy (Male - Deep Tactical Officer)</option>
              <option value="en-US-JennyNeural">Jenny (Female - Warm Natural)</option>
              <option value="en-US-ChristopherNeural">Christopher (Male - Authoritative)</option>
              <option value="en-GB-SoniaNeural">Sonia (British Female Accent)</option>
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end items-center px-6 py-4 bg-[#0a1126] border-t border-slate-800 space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-mono uppercase text-slate-400 hover:text-white transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs font-mono uppercase transition shadow-[0_0_20px_rgba(0,240,255,0.4)]"
          >
            <Save className="w-4 h-4" />
            <span>Save & Apply Matrix</span>
          </button>
        </div>
      </div>
    </div>
  );
}
