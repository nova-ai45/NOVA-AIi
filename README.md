# ⚡ NOVA AI (Neural Operating Voice Assistant)

An automated desktop voice intelligence engineered with **Electron.js**, **React 18**, **Tailwind CSS**, and **Multi-Provider LLM Engines** (Google Gemini, OpenAI, Custom Gateways like Ollama & DeepSeek).

---

## 🚀 Features

- **Holographic Dynamic Audio Sphere**: State-reactive visualizer core (Idle, Listening, Processing, Executing, Speaking).
- **Multimodal Visual Perception**: Captures active displays in real-time and analyzes UI context via Gemini 1.5 Flash/Pro and GPT-4o.
- **System Automation**:
  - Automatically spins up project files (`index.html`, `style.css`, scripts) on your machine.
  - Launches web browsers, inputs URLs, and searches targets automatically (e.g., YouTube searches for *"The Hasnain Gaming"*).
- **Zero-Cost Natural Neural TTS**: Integrated with Microsoft Edge Neural Voices (`en-US-AriaNeural`, `en-US-GuyNeural`).
- **Flexible AI Gateway**: Switch seamlessly between Google Gemini (Free Tier), OpenAI, and self-hosted models (Ollama, vLLM, Groq).
- **Automated CI/CD**: Complete Inno Setup pipeline produces an official `NOVA-AI-Setup.exe`.

---

## 🛠️ Local Development Setup

```bash
# 1. Clone repository & install dependencies
git clone https://github.com/your-username/nova-ai.git
cd nova-ai
npm install

# 2. Launch Vite + Electron in hot-reload mode
npm run dev
