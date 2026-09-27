const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { getLatestScreenContext } = require('./vision');

const SYSTEM_INSTRUCTION = `
You are NOVA, an advanced Neural Operating Voice Assistant equipped with always-on background screen vision and full Windows OS automation.

CORE EXECUTION DIRECTIVE:
1. Return responses strictly in JSON schema.
2. Keep spoken responses concise, natural, polite, and executive.
3. Automatically observe the provided desktop screen context and fulfill user intentions end-to-end.

JSON Output Schema:
{
  "spokenResponse": "Sir, I have analyzed your screen and performed the requested actions.",
  "actions": [
    {
      "type": "OPEN_BROWSER_AND_PLAY",
      "payload": {
        "url": "https://www.youtube.com",
        "query": "The Hasnain Gaming",
        "autoplay": true
      }
    },
    {
      "type": "CREATE_AND_RUN_PROJECT",
      "payload": {
        "directoryName": "NovaAutomation",
        "filename": "script.py",
        "content": "print('Task Executed')",
        "executeImmediately": true
      }
    }
  ]
}

Available Action Types:
- OPEN_BROWSER_AND_PLAY: { url, query, autoplay }
- CREATE_AND_RUN_PROJECT: { directoryName, filename, content, executeImmediately }
- OPEN_APP: { name } (e.g. notepad, calc, chrome, code, explorer)
- RUN_COMMAND: { cmd }
`;

/**
 * Primary Engine 1: Google Gemini 2.0 Flash
 */
async function queryGemini(userPrompt, audioBase64, imageBase64, config) {
  if (!config.geminiKey) {
    throw new Error('Gemini API key is not configured.');
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
 * Fail-Safe Engine 2: OpenRouter Free Models
 */
async function queryOpenRouter(userPrompt, imageBase64, config) {
  const apiKey = config.openrouterKey;
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured.');
  }

  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: apiKey,
    defaultHeaders: {
      'HTTP-Referer': 'https://nova-ai.desktop',
      'X-Title': 'NOVA AI Desktop Assistant'
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
 * Fail-Safe Engine 3: Groq / Custom API Gateway
 */
async function queryGroqOrCustom(userPrompt, imageBase64, config) {
  const baseURL = config.customBaseURL || 'https://api.groq.com/openai/v1';
  const apiKey = config.customKey;

  if (!apiKey) {
    throw new Error('Groq or Custom API key is not configured.');
  }

  const client = new OpenAI({
    baseURL,
    apiKey
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
 * Multi-Provider AI Inference Router with Silent Fallback Chain:
 * Gemini 2.0 -> OpenRouter -> Groq / Custom
 */
async function runAIInference(userPrompt, audioBase64, manualImageBase64, config) {
  // Always attach latest continuous vision screen context automatically
  const imageBase64 = manualImageBase64 || (await getLatestScreenContext());
  const provider = config.provider || 'gemini';

  // 1. If user explicitly chooses OpenRouter
  if (provider === 'openrouter') {
    try {
      return await queryOpenRouter(userPrompt, imageBase64, config);
    } catch (err) {
      if (config.geminiKey) {
        return await queryGemini(userPrompt, audioBase64, imageBase64, config);
      }
      throw err;
    }
  }

  // 2. Default: Attempt Gemini 2.0 Flash first
  if (provider === 'gemini') {
    try {
      return await queryGemini(userPrompt, audioBase64, imageBase64, config);
    } catch (err) {
      const isQuotaOrLimit =
        err.message.includes('429') ||
        err.message.includes('quota') ||
        err.message.includes('ResourceExhausted') ||
        err.message.includes('503') ||
        err.message.includes('overloaded');

      // Fail-Safe Chain Step 2: Auto-switch to OpenRouter
      if (isQuotaOrLimit && config.openrouterKey) {
        try {
          return await queryOpenRouter(userPrompt, imageBase64, config);
        } catch (_) {}
      }

      // Fail-Safe Chain Step 3: Auto-switch to Groq / Custom
      if (isQuotaOrLimit && config.customKey) {
        try {
          return await queryGroqOrCustom(userPrompt, imageBase64, config);
        } catch (_) {}
      }

      throw err;
    }
  }

  // 3. Custom Gateway
  return await queryGroqOrCustom(userPrompt, imageBase64, config);
}

module.exports = {
  runAIInference
};
