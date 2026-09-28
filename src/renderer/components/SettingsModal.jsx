import React, { useState, useEffect } from 'react';
import { X, Save, Sliders, AlertCircle, CheckCircle, Server, Key, Cpu, BatteryCharging, ExternalLink } from 'lucide-react';

export default function SettingsModal({
  isOpen,
  onClose,
  currentSettings,
  onSave
}) {
  const [formData, setFormData] = useState(currentSettings);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [liveHardware, setLiveHardware] = useState(null);

  useEffect(() => {
    setFormData(currentSettings);
  }, [currentSettings]);

  useEffect(() => {
    if (isOpen && window.novaAPI && window.novaAPI.getHardwareStats) {
      window.novaAPI.getHardwareStats().then((stats) => {
        if (stats) setLiveHardware(stats);
      });
    }
  }, [isOpen]);

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
    }, 700);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xl flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#0d0f17] border border-[#ff7700]/50 rounded-3xl shadow-[0_0_60px_rgba(255,119,0,0.25)] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#ff7700]/20 bg-[#121622]">
          <div className="flex items-center space-x-2.5 text-[#ff9900]">
            <Sliders className="w-5 h-5 text-[#ff8800]" />
            <h2 className="font-mono font-bold text-sm tracking-widest uppercase text-white">
              NOVA AI // CORE CONFIGURATION
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-xl text-slate-400 hover:text-[#ff9900] hover:bg-[#1a1f30] transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">
          {/* Provider Selection Tabs */}
          <div>
            <label className="text-xs font-mono uppercase text-[#ffaa00] block mb-2 font-semibold tracking-wider">
              Primary Cognitive Gateway
            </label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'gemini', label: 'Google Gemini' },
                { id: 'openrouter', label: 'OpenRouter' },
                { id: 'custom', label: 'Custom / Groq' }
              ].map((prov) => (
                <button
                  key={prov.id}
                  type="button"
                  onClick={() => handleChange('provider', prov.id)}
                  className={`py-3 px-3 rounded-2xl border text-xs font-mono uppercase tracking-wider transition cursor-pointer ${
                    formData.provider === prov.id
                      ? 'border-[#ff7700] bg-[#ff7700]/20 text-[#ffaa00] shadow-[0_0_20px_rgba(255,119,0,0.3)] font-bold'
                      : 'border-slate-800 bg-[#121522] text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {prov.label}
                </button>
              ))}
            </div>
          </div>

          {/* 1. Google Gemini Config (User supplies their own key) */}
          {formData.provider === 'gemini' && (
            <div className="p-4 rounded-2xl bg-[#121622] border border-[#ff7700]/30 space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-mono uppercase text-slate-300 block">
                  Your Google Gemini API Key <span className="text-[#ff7700]">*Required</span>
                </label>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] font-mono text-[#ffaa00] hover:underline flex items-center space-x-1"
                >
                  <span>Get Free Key</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <input
                type="password"
                value={formData.geminiKey || ''}
                onChange={(e) => handleChange('geminiKey', e.target.value)}
                placeholder="AIzaSy... (Enter your personal Gemini API Key)"
                className="w-full px-3.5 py-2.5 bg-[#090b10] border border-slate-800 rounded-xl text-sm text-[#ffaa00] focus:outline-none focus:border-[#ff7700] font-mono"
              />

              <div>
                <label className="text-xs font-mono uppercase text-slate-300 block mb-1">
                  Gemini Model Variant
                </label>
                <input
                  list="gemini-models"
                  type="text"
                  value={formData.geminiModel || 'gemini-2.5-flash'}
                  onChange={(e) => handleChange('geminiModel', e.target.value)}
                  placeholder="gemini-2.5-flash, gemini-2.0-flash"
                  className="w-full px-3.5 py-2.5 bg-[#090b10] border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-[#ff7700] font-mono"
                />
                <datalist id="gemini-models">
                  <option value="gemini-2.5-flash" />
                  <option value="gemini-2.0-flash" />
                  <option value="gemini-1.5-pro" />
                  <option value="gemini-1.5-flash" />
                </datalist>
              </div>
            </div>
          )}

          {/* 2. OpenRouter Config */}
          {formData.provider === 'openrouter' && (
            <div className="p-4 rounded-2xl bg-[#121622] border border-[#ff7700]/30 space-y-4 shadow-[0_0_20px_rgba(255,119,0,0.15)]">
              <div>
                <label className="text-xs font-mono uppercase text-slate-300 block mb-1">
                  OpenRouter API Key
                </label>
                <input
                  type="password"
                  value={formData.openrouterKey || ''}
                  onChange={(e) => handleChange('openrouterKey', e.target.value)}
                  placeholder="sk-or-v1-..."
                  className="w-full px-3.5 py-2.5 bg-[#090b10] border border-slate-800 rounded-xl text-sm text-[#ffaa00] focus:outline-none focus:border-[#ff7700] font-mono"
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
                  className="w-full px-3.5 py-2.5 bg-[#090b10] border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-[#ff7700] font-mono"
                />
                <datalist id="openrouter-models">
                  <option value="meta-llama/llama-3.3-70b-instruct:free" />
                  <option value="deepseek/deepseek-r1:free" />
                  <option value="qwen/qwen-2.5-72b-instruct:free" />
                </datalist>
              </div>
            </div>
          )}

          {/* 3. Custom / Local API Config */}
          {formData.provider === 'custom' && (
            <div className="p-4 rounded-2xl bg-[#121622] border border-[#ff7700]/30 space-y-4 shadow-[0_0_20px_rgba(255,119,0,0.15)]">
              <div>
                <div className="flex items-center space-x-1.5 text-xs font-mono uppercase text-slate-300 mb-1">
                  <Server className="w-3.5 h-3.5 text-[#ff8800]" />
                  <span>Base Endpoint URL</span>
                </div>
                <input
                  type="text"
                  value={formData.customBaseURL || ''}
                  onChange={(e) => handleChange('customBaseURL', e.target.value)}
                  placeholder="e.g. https://api.groq.com/openai/v1 or http://localhost:11434/v1"
                  className="w-full px-3.5 py-2.5 bg-[#090b10] border border-slate-800 rounded-xl text-sm text-[#ffaa00] focus:outline-none focus:border-[#ff7700] font-mono"
                />
              </div>

              <div>
                <div className="flex items-center space-x-1.5 text-xs font-mono uppercase text-slate-300 mb-1">
                  <Key className="w-3.5 h-3.5 text-[#ff8800]" />
                  <span>API Key / Secret Token</span>
                </div>
                <input
                  type="password"
                  value={formData.customKey || ''}
                  onChange={(e) => handleChange('customKey', e.target.value)}
                  placeholder="gsk_... or custom secret key"
                  className="w-full px-3.5 py-2.5 bg-[#090b10] border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-[#ff7700] font-mono"
                />
              </div>

              <div>
                <div className="flex items-center space-x-1.5 text-xs font-mono uppercase text-[#ffaa00] mb-1 font-bold">
                  <Cpu className="w-3.5 h-3.5 text-[#ff8800]" />
                  <span>Model ID / Name</span>
                </div>
                <input
                  type="text"
                  value={formData.customModel || ''}
                  onChange={(e) => handleChange('customModel', e.target.value)}
                  placeholder="e.g. llama-3.3-70b-versatile, deepseek-chat"
                  className="w-full px-3.5 py-2.5 bg-[#090b10] border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-[#ff7700] font-mono"
                />
              </div>
            </div>
          )}

          {/* Live Hardware Telemetry Panel */}
          {liveHardware && (
            <div className="p-4 rounded-2xl bg-[#090b10] border border-slate-800 space-y-2">
              <div className="flex items-center space-x-2 text-xs font-mono text-[#ffaa00] font-bold">
                <BatteryCharging className="w-4 h-4 text-[#ff8800]" />
                <span>Laptop Hardware Status (Full OS Access Granted)</span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs font-mono text-slate-300 pt-1">
                <div>
                  <span className="text-slate-500 block">Battery:</span>
                  <span className="text-[#ffaa00] font-bold">
                    {liveHardware.battery.percent}% {liveHardware.battery.isCharging ? '(Charging)' : '(On Battery)'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">CPU Load / Temp:</span>
                  <span className="text-white font-bold">{liveHardware.cpu.loadPercent}% / {liveHardware.cpu.tempC}°C</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Memory (RAM):</span>
                  <span className="text-white font-bold">{liveHardware.ram.usedGb}GB / {liveHardware.ram.totalGb}GB</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end items-center px-6 py-4 bg-[#121622] border-t border-[#ff7700]/20 space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-mono uppercase text-slate-400 hover:text-white transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#ff7700] to-[#ff9900] hover:brightness-110 text-black font-bold text-xs font-mono uppercase transition shadow-[0_0_20px_rgba(255,119,0,0.4)] cursor-pointer"
          >
            {savedSuccess ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            <span>{savedSuccess ? 'Saved!' : 'Save & Persist'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
