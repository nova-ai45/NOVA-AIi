const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { getLatestScreenContext } = require('./vision');

const SYSTEM_INSTRUCTION = `
You are NOVA, an advanced Neural Operating Voice Assistant equipped with always-on background screen vision, direct desktop code typing streaming, and Windows OS automation.

CORE DIRECTIVE:
1. Return responses strictly in JSON schema.
2. Provide spoken responses that are polite, crisp, and executive.
3. Automatically observe the provided desktop screen context and fulfill user intentions end-to-end.
4. When writing code, scripts, or project files, prefer "CREATE_AND_STREAM_CODE" so the user visually sees the typing in real time.

JSON Output Schema:
{
  "spokenResponse": "Sir, I have started visual code streaming for index.html and launched the project.",
  "actions": [
    {
      "type": "CREATE_AND_STREAM_CODE",
      "payload": {
        "directoryName": "NovaProject",
        "filename": "index.html",
        "content": "<!DOCTYPE html><html><head><title>NOVA App</title></head><body><h1>NOVA Online</h1></body></html>",
        "executeImmediately": true,
        "openVisualNotepad": true
      }
    },
    {
      "type": "OPEN_BROWSER_AND_PLAY",
      "payload": {
        "url": "https://www.youtube.com",
        "query": "The Hasnain Gaming",
        "autoplay": true
      }
    }
  ]
}

Available Action Types:
- CREATE_AND_STREAM_CODE: { directoryName, filename, content, executeImmediately, openVisualNotepad }
- OPEN_BROWSER_AND_PLAY: { url, query, autoplay }
- OPEN_APP: { name } (e.g. notepad, calc, chrome, code, explorer)
- RUN_COMMAND: { cmd }
`;

/**
 * Primary Engine: Google Gemini (Supports 2.0 Flash / 1.5 Pro)
 */
async function queryGemini(userPrompt, audioBase64, imageBase64, config) {
  if (!config.geminiKey) {
    throw new Error('Google Gemini API key is missing. Please enter your key in Settings.');
  }

  const genAI = new GoogleGenerativeAI(config.geminiKey);
  const modelName = config.geminiModel || 'gemini-2.0-flash';

  const parts = [];
  if (audioBase64) {
    parts.push({
      inlineData: {
        mimeType: 'audio/webm',
        data: audioBase64
      }
    });
  }
  if (imageBase64) {
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: imageBase64
      }
    });
  }
  if (userPrompt) parts.push(userPrompt);

  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: { responseMimeType: 'application/json' }
  });

  const result = await model.generateContent(parts);
  return JSON.parse(result.response.text());
}

/**
 * Universal Multi-Model Engine: OpenRouter
 */
async function queryOpenRouter(userPrompt, imageBase64, config) {
  if (!config.openrouterKey) {
    throw new Error('OpenRouter API key is missing. Please enter it in Settings.');
  }

  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: config.openrouterKey,
    defaultHeaders: {
      'HTTP-Referer': 'https://nova-ai.desktop',
      'X-Title': 'NOVA AI Neural Assistant'
    }
  });

  const selectedModel = config.openrouterModel || 'meta-llama/llama-3.3-70b-instruct:free';
  const messages = [{ role: 'system', content: SYSTEM_INSTRUCTION }];
  const content = [];

  if (userPrompt) content.push({ type: 'text', text: userPrompt });
  if (imageBase64) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
    });
  }
  messages.push({ role: 'user', content });

  const completion = await client.chat.completions.create({
    model: selectedModel,
    messages,
    response_format: { type: 'json_object' }
  });

  return JSON.parse(completion.choices[0].message.content);
}

/**
 * Custom / Local Gateway (e.g. Groq, Ollama)
 */
async function queryCustom(userPrompt, imageBase64, config) {
  const baseURL = config.customBaseURL || 'https://api.groq.com/openai/v1';
  const client = new OpenAI({
    baseURL,
    apiKey: config.customKey || 'dummy'
  });

  const messages = [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    { role: 'user', content: userPrompt || 'Analyze context and execute instructions.' }
  ];

  const completion = await client.chat.completions.create({
    model: config.customModel || 'llama-3.3-70b-versatile',
    messages,
    response_format: { type: 'json_object' }
  });

  return JSON.parse(completion.choices[0].message.content);
}

/**
 * Multi-Model Failover Inference Router
 */
async function runAIInference(userPrompt, audioBase64, manualImageBase64, config) {
  const imageBase64 = manualImageBase64 || (await getLatestScreenContext());
  const provider = config.provider || 'gemini';

  if (provider === 'openrouter') {
    try {
      return await queryOpenRouter(userPrompt, imageBase64, config);
    } catch (err) {
      if (config.geminiKey) return await queryGemini(userPrompt, audioBase64, imageBase64, config);
      throw err;
    }
  }

  if (provider === 'gemini') {
    try {
      return await queryGemini(userPrompt, audioBase64, imageBase64, config);
    } catch (err) {
      const isQuotaError =
        err.message.includes('429') ||
        err.message.includes('quota') ||
        err.message.includes('ResourceExhausted') ||
        err.message.includes('503');

      // Fail-Safe Chain Step 2: Auto switch to OpenRouter
      if (isQuotaError && config.openrouterKey) {
        try {
          return await queryOpenRouter(userPrompt, imageBase64, config);
        } catch (_) {}
      }

      // Fail-Safe Chain Step 3: Auto switch to Groq / Custom
      if (isQuotaError && config.customKey) {
        try {
          return await queryCustom(userPrompt, imageBase64, config);
        } catch (_) {}
      }
      throw err;
    }
  }

  return await queryCustom(userPrompt, imageBase64, config);
}

module.exports = {
  runAIInference
};
