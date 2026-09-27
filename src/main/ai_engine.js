const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');

const SYSTEM_INSTRUCTION = `
You are NOVA, an advanced Neural Operating Voice Assistant equipped with real-time desktop vision and direct OS automation.

CORE EXECUTION DIRECTIVE:
1. Return responses in STRICT JSON schema ONLY.
2. Formulate end-to-end multi-step actions to execute the user's intent.
3. Keep spoken responses polite, concise, and futuristic.

JSON Schema:
{
  "spokenResponse": "Sir, I have searched YouTube for the video and created the requested Python script.",
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
        "directoryName": "DataParser",
        "filename": "parser.py",
        "content": "import csv\\nprint('NOVA parser executed successfully')",
        "executeImmediately": true
      }
    }
  ]
}

Available Action Types:
- OPEN_BROWSER_AND_PLAY: { url, query, autoplay }
- CREATE_AND_RUN_PROJECT: { directoryName, filename, content, executeImmediately }
- OPEN_APP: { name } (e.g., notepad, calc, code, chrome)
- RUN_COMMAND: { cmd }
`;

/**
 * OpenRouter Universal Engine Handler
 */
async function queryOpenRouter(userPrompt, imageBase64, config) {
  if (!config.openrouterKey) {
    throw new Error('OpenRouter API key is not configured in Settings.');
  }

  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: config.openrouterKey,
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
 * Google Gemini Engine with Instant OpenRouter Fallback
 */
async function queryGemini(userPrompt, audioBase64, imageBase64, config) {
  if (!config.geminiKey) {
    throw new Error('Gemini API key is missing.');
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

  try {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: { responseMimeType: 'application/json' }
    });

    const result = await model.generateContent(parts);
    return JSON.parse(result.response.text());
  } catch (err) {
    const isRateLimit =
      err.message.includes('429') ||
      err.message.includes('quota') ||
      err.message.includes('ResourceExhausted') ||
      err.message.includes('503');

    // Automatic Failover to OpenRouter if enabled
    if (isRateLimit && config.autoFailover !== false && config.openrouterKey) {
      return await queryOpenRouter(
        userPrompt || 'Execute current voice/vision instruction',
        imageBase64,
        config
      );
    }
    throw err;
  }
}

/**
 * Universal Inference Gateway Router
 */
async function runAIInference(userPrompt, audioBase64, imageBase64, config) {
  const provider = config.provider || 'openrouter';

  if (provider === 'openrouter') {
    return await queryOpenRouter(userPrompt, imageBase64, config);
  }

  if (provider === 'gemini') {
    return await queryGemini(userPrompt, audioBase64, imageBase64, config);
  }

  // Custom / Local Endpoint (e.g. Ollama, Groq)
  const client = new OpenAI({
    baseURL: config.customBaseURL || 'http://localhost:11434/v1',
    apiKey: config.customKey || 'dummy'
  });

  const messages = [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    { role: 'user', content: userPrompt || 'Process system context' }
  ];

  const completion = await client.chat.completions.create({
    model: config.customModel || 'llama3.3',
    messages,
    response_format: { type: 'json_object' }
  });

  return JSON.parse(completion.choices[0].message.content);
}

module.exports = {
  runAIInference
};
