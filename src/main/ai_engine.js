const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { getLatestScreenContext } = require('./vision');

const SYSTEM_INSTRUCTION = `
You are NOVA, an ultra-low latency JARVIS-like Neural Voice Assistant equipped with desktop screen perception and direct Windows OS automation.

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
 * Ultra-fast Streaming Inference Router with First-Sentence TTS dispatch
 */
async function runAIInferenceStream(
  userPrompt,
  audioBase64,
  manualImageBase64,
  config,
  onChunkCallback = () => {},
  onEarlySentenceCallback = () => {}
) {
  const imageBase64 = manualImageBase64 || (await getLatestScreenContext());
  const provider = config.provider || 'gemini';

  // 1. Google Gemini 2.5 / 2.0 Flash Streaming Engine
  if (provider === 'gemini') {
    if (!config.geminiKey) {
      throw new Error('Google Gemini API key is missing. Please enter your key in Settings.');
    }

    const genAI = new GoogleGenerativeAI(config.geminiKey);
    const modelName = config.geminiModel || 'gemini-2.5-flash';

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

    try {
      const responseStream = await model.generateContentStream(parts);
      let fullText = '';
      let earlySentenceFired = false;

      for await (const chunk of responseStream.stream) {
        const chunkText = chunk.text();
        fullText += chunkText;
        onChunkCallback(chunkText);

        // Extract first spoken sentence for immediate verbal reply
        if (!earlySentenceFired) {
          const match = fullText.match(/"spokenResponse"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)/);
          if (match && match[1]) {
            const currentSentence = match[1];
            if (/[.!?]/.test(currentSentence)) {
              earlySentenceFired = true;
              onEarlySentenceCallback(currentSentence.trim());
            }
          }
        }
      }

      return JSON.parse(fullText);
    } catch (err) {
      const isQuotaError =
        err.message.includes('429') ||
        err.message.includes('quota') ||
        err.message.includes('ResourceExhausted') ||
        err.message.includes('503');

      // Failover to OpenRouter on quota limit
      if (isQuotaError && config.openrouterKey) {
        return await queryOpenRouterStream(userPrompt, imageBase64, config, onChunkCallback);
      }
      throw err;
    }
  }

  // 2. OpenRouter Streaming Gateway
  if (provider === 'openrouter') {
    return await queryOpenRouterStream(userPrompt, imageBase64, config, onChunkCallback);
  }

  // 3. Custom / Groq Endpoint
  return await queryCustomStream(userPrompt, imageBase64, config, onChunkCallback);
}

async function queryOpenRouterStream(userPrompt, imageBase64, config, onChunkCallback = () => {}) {
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

  const stream = await client.chat.completions.create({
    model: selectedModel,
    messages,
    response_format: { type: 'json_object' },
    stream: true
  });

  let fullText = '';
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || '';
    fullText += text;
    onChunkCallback(text);
  }

  return JSON.parse(fullText);
}

async function queryCustomStream(userPrompt, imageBase64, config, onChunkCallback = () => {}) {
  const baseURL = config.customBaseURL || 'https://api.groq.com/openai/v1';
  const client = new OpenAI({
    baseURL,
    apiKey: config.customKey || 'dummy'
  });

  const messages = [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    { role: 'user', content: userPrompt || 'Analyze context and execute instructions.' }
  ];

  const stream = await client.chat.completions.create({
    model: config.customModel || 'llama-3.3-70b-versatile',
    messages,
    response_format: { type: 'json_object' },
    stream: true
  });

  let fullText = '';
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || '';
    fullText += text;
    onChunkCallback(text);
  }

  return JSON.parse(fullText);
}

module.exports = {
  runAIInferenceStream
};
