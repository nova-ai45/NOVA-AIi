import React, { useState } from 'react';
import { X, Save, Sliders, Mic } from 'lucide-react';

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

        {/* Form Body */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[75vh]">
          {/* Provider Selection */}
          <div>
            <label className="text-xs font-mono uppercase text-slate-400 block mb-2">Cognitive Intelligence Provider</label>
            <div className="grid grid-cols-3 gap-3">
              {['gemini', 'openai', 'custom'].map((prov) => (
                <button
                  key={prov}
                  type="button"
                  onClick={() => handleChange('provider', prov)}
                  className={`py-2 px-3 rounded-xl border text-xs font-mono uppercase tracking-wider transition ${
                    formData.provider === prov
                      ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300 shadow-[0_0_20px_rgba(0,240,255,0.3)]'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400'
                  }`}
                >
                  {prov}
                </button>
              ))}
            </div>
          </div>

          {/* Gemini Configuration */}
          {formData.provider === 'gemini' && (
            <div className="p-4 rounded-xl bg-slate-950/60 border border-cyan-500/20 space-y-4">
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
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-mono uppercase text-slate-300">
                    Active Gemini Model
                  </label>
                  <span className="text-[10px] text-cyan-400 font-mono">Select or Type Custom</span>
                </div>
                <input
                  list="gemini-models"
                  type="text"
                  value={formData.geminiModel || 'gemini-3.8-flash'}
                  onChange={(e) => handleChange('geminiModel', e.target.value)}
                  placeholder="e.g. gemini-3.8-flash, gemini-3.5-flash"
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-cyan-400 font-mono"
                />
                <datalist id="gemini-models">
                  <option value="gemini-3.8-flash" />
                  <option value="gemini-3.5-flash" />
                  <option value="gemini-2.0-flash" />
                  <option value="gemini-1.5-flash" />
                  <option value="gemini-1.5-pro" />
                </datalist>
                <p className="text-[11px] text-slate-500 mt-1 font-mono">
                  Default: gemini-3.8-flash (Ultra-fast real-time reasoning)
                </p>
              </div>
            </div>
          )}

          {/* Voice Engine */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
            <div className="flex items-center space-x-2 text-cyan-400">
              <Mic className="w-4 h-4" />
              <label className="text-xs font-mono uppercase text-slate-300">Natural Voice Persona</label>
            </div>
            <select
              value={formData.voice || 'en-US-AriaNeural'}
              onChange={(e) => handleChange('voice', e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-200 focus:outline-none focus:border-cyan-400 font-mono"
            >
              <option value="en-US-AriaNeural">Aria (Female - Crisp, Natural)</option>
              <option value="en-US-GuyNeural">Guy (Male - Deep Officer)</option>
              <option value="en-US-JennyNeural">Jenny (Female - Warm Voice)</option>
              <option value="en-US-ChristopherNeural">Christopher (Male - Tactical Voice)</option>
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end items-center px-6 py-4 bg-[#0a1126] border-t border-slate-800 space-x-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-mono uppercase text-slate-400 hover:text-white">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs font-mono uppercase transition shadow-[0_0_20px_rgba(0,240,255,0.4)]"
          >
            <Save className="w-4 h-4" />
            <span>Save Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
}
