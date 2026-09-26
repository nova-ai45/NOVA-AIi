import React, { useState } from 'react';
import { X, Save, Sliders, Key, Mic, MonitorCheck } from 'lucide-react';

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
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#090f21] border border-cyan-500/40 rounded-2xl shadow-hologram-cyan overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#0d162f]">
          <div className="flex items-center space-x-2 text-cyan-400">
            <Sliders className="w-5 h-5" />
            <h2 className="font-semibold text-lg tracking-wide uppercase">Neural Gateway Architecture</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[75vh]">
          {/* AI Provider Switch */}
          <div>
            <label className="text-xs font-mono uppercase text-slate-400 block mb-2">Active Cognitive Engine</label>
            <div className="grid grid-cols-3 gap-3">
              {['gemini', 'openai', 'custom'].map((prov) => (
                <button
                  key={prov}
                  type="button"
                  onClick={() => handleChange('provider', prov)}
                  className={`py-2 px-3 rounded-lg border text-sm font-medium uppercase transition ${
                    formData.provider === prov
                      ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300 shadow-hologram-cyan'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {prov}
                </button>
              ))}
            </div>
          </div>

          {/* Gemini Config */}
          {formData.provider === 'gemini' && (
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Google Gemini API Key (100% Free Tier)</label>
                <input
                  type="password"
                  value={formData.geminiKey || ''}
                  onChange={(e) => handleChange('geminiKey', e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-cyan-300 focus:outline-none focus:border-cyan-400"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Model Variant</label>
                <select
                  value={formData.geminiModel || 'gemini-1.5-flash'}
                  onChange={(e) => handleChange('geminiModel', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400"
                >
                  <option value="gemini-1.5-flash">Gemini 1.5 Flash (Ultra-Low Latency)</option>
                  <option value="gemini-1.5-pro">Gemini 1.5 Pro (Deep Reasoning)</option>
                </select>
              </div>
            </div>
          )}

          {/* OpenAI Config */}
          {formData.provider === 'openai' && (
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">OpenAI API Key</label>
                <input
                  type="password"
                  value={formData.openaiKey || ''}
                  onChange={(e) => handleChange('openaiKey', e.target.value)}
                  placeholder="sk-proj-..."
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-cyan-300 focus:outline-none focus:border-cyan-400"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Model Name</label>
                <select
                  value={formData.openaiModel || 'gpt-4o'}
                  onChange={(e) => handleChange('openaiModel', e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400"
                >
                  <option value="gpt-4o">GPT-4o (Vision Multimodal)</option>
                  <option value="gpt-4o-mini">GPT-4o-Mini (Fast Execution)</option>
                </select>
              </div>
            </div>
          )}

          {/* Custom Gateway (Ollama, Groq, DeepSeek, xkiro.com) */}
          {formData.provider === 'custom' && (
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Base Endpoint URL</label>
                <input
                  type="text"
                  value={formData.customBaseURL || ''}
                  onChange={(e) => handleChange('customBaseURL', e.target.value)}
                  placeholder="http://localhost:11434/v1 or https://api.groq.com/openai/v1"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-cyan-300 focus:outline-none focus:border-cyan-400"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Secret / Token (Leave blank for Ollama)</label>
                <input
                  type="password"
                  value={formData.customKey || ''}
                  onChange={(e) => handleChange('customKey', e.target.value)}
                  placeholder="Bearer token or custom key"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-cyan-300 focus:outline-none focus:border-cyan-400"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Target Model ID</label>
                <input
                  type="text"
                  value={formData.customModel || ''}
                  onChange={(e) => handleChange('customModel', e.target.value)}
                  placeholder="e.g. llama3.2, deepseek-coder, mistral"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400"
                />
              </div>
            </div>
          )}

          {/* TTS Neural Voice Config */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
            <div className="flex items-center space-x-2 text-cyan-400">
              <Mic className="w-4 h-4" />
              <label className="text-xs font-mono uppercase text-slate-300">Natural Neural Voice (Free Edge-TTS)</label>
            </div>
            <select
              value={formData.voice || 'en-US-AriaNeural'}
              onChange={(e) => handleChange('voice', e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-400"
            >
              <option value="en-US-AriaNeural">Aria (Female - Natural Conversational)</option>
              <option value="en-US-GuyNeural">Guy (Male - Confident Operator)</option>
              <option value="en-US-JennyNeural">Jenny (Female - Clear & Friendly)</option>
              <option value="en-US-ChristopherNeural">Christopher (Male - Deep Professional)</option>
              <option value="en-GB-SoniaNeural">Sonia (British Female)</option>
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end items-center px-6 py-4 bg-[#0d162f] border-t border-slate-800 space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center space-x-2 px-5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium text-sm transition shadow-hologram-cyan"
          >
            <Save className="w-4 h-4" />
            <span>Apply Changes</span>
          </button>
        </div>
      </div>
    </div>
  );
}
