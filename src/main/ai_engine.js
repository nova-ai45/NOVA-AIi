const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { getLatestScreenContext } = require('./vision');

const SYSTEM_INSTRUCTION = `
You are NOVA, an advanced Neural Operating Voice Assistant equipped with continuous conversational memory context, real-time desktop vision, and direct Windows OS automation.

CORE DIRECTIVE:
1. Maintain memory and conversational awareness across previous chat turns.
2. Return responses strictly in JSON schema.
3. Keep spoken responses polite, crisp, and executive.
4. When writing code or project files, prefer "CREATE_AND_STREAM_CODE" so the user visually sees the typing in real time.

JSON Output Schema:
{
  "spokenResponse": "Sir, I remember your request and have proceeded with the task.",
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
 * Ultra-fast Streaming Inference Router with Multi-Turn Memory Management
 */
async function runAIInferenceStream(
  userPrompt,
  audioBase64,
  manualImageBase64,
  config,
  conversationHistory = [],
  onChunkCallback = () => {},
  onEarlySentenceCallback = () => {}
) {
  const imageBase64 = manualImageBase64 || (await getLatestScreenContext());
  const provider = config.provider || 'gemini';

  // 1. Google Gemini 2.5 / 2.0 / 3.7 Flash Multi-Turn Engine
  if (provider === 'gemini') {
    if (!config.geminiKey) {
      throw new Error('Google Gemini API key is missing. Please enter your key in Settings.');
    }

    const genAI = new GoogleGenerativeAI(config.geminiKey);
    const modelName = config.geminiModel || 'gemini-2.5-flash';

    // Format conversation history for Gemini (maintaining last 20 turns)
    const formattedContents = [];
    const memorySlice = Array.isArray(conversationHistory) ? conversationHistory.slice(-20) : [];

    memorySlice.forEach((turn) => {
      if (turn.role && turn.text) {
        formattedContents.push({
          role: turn.role === 'model' || turn.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: turn.text }]
        });
      }
    });

    // Construct current prompt parts
    const currentParts = [];
    if (audioBase64) {
      currentParts.push({
        inlineData: {
          mimeType: 'audio/webm',
          data: audioBase64
        }
      });
    }
    if (imageBase64) {
      currentParts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: imageBase64
        }
      });
    }
    if (userPrompt) {
      currentParts.push({ text: userPrompt });
    }

    formattedContents.push({
      role: 'user',
      parts: currentParts
    });

    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: { responseMimeType: 'application/json' }
    });

    try {
      const responseStream = await model.generateContentStream({ contents: formattedContents });
      let fullText = '';
      let earlySentenceFired = false;

      for await (const chunk of responseStream.stream) {
        const chunkText = chunk.text();
        fullText += chunkText;
        onChunkCallback(chunkText);

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

      if (isQuotaError && config.openrouterKey) {
        return await queryOpenRouterStream(userPrompt, imageBase64, config, memorySlice, onChunkCallback);
      }
      throw err;
    }
  }

  // 2. OpenRouter Multi-Turn Streaming Gateway
  if (provider === 'openrouter') {
    return await queryOpenRouterStream(userPrompt, imageBase64, config, conversationHistory, onChunkCallback);
  }

  // 3. Custom / Groq Endpoint
  return await queryCustomStream(userPrompt, imageBase64, config, conversationHistory, onChunkCallback);
}

async function queryOpenRouterStream(userPrompt, imageBase64, config, conversationHistory = [], onChunkCallback = () => {}) {
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

  const memorySlice = Array.isArray(conversationHistory) ? conversationHistory.slice(-20) : [];
  memorySlice.forEach((turn) => {
    messages.push({
      role: turn.role === 'model' || turn.role === 'assistant' ? 'assistant' : 'user',
      content: turn.text || ''
    });
  });

  const currentContent = [];
  if (userPrompt) currentContent.push({ type: 'text', text: userPrompt });
  if (imageBase64) {
    currentContent.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
    });
  }
  messages.push({ role: 'user', content: currentContent });

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

async function queryCustomStream(userPrompt, imageBase64, config, conversationHistory = [], onChunkCallback = () => {}) {
  const baseURL = config.customBaseURL || 'https://api.groq.com/openai/v1';
  const client = new OpenAI({
    baseURL,
    apiKey: config.customKey || 'dummy'
  });

  const messages = [{ role: 'system', content: SYSTEM_INSTRUCTION }];
  const memorySlice = Array.isArray(conversationHistory) ? conversationHistory.slice(-20) : [];
  memorySlice.forEach((turn) => {
    messages.push({
      role: turn.role === 'model' || turn.role === 'assistant' ? 'assistant' : 'user',
      content: turn.text || ''
    });
  });

  messages.push({ role: 'user', content: userPrompt || 'Analyze context and execute instructions.' });

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
