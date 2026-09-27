const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { getLatestScreenContext } = require('./vision');

const SYSTEM_INSTRUCTION = `
You are NOVA AI, an advanced Neural Operating Voice Assistant.

CRITICAL IDENTITY & DEVELOPER RULES:
- Creator / Developer: Hasnain (The Hasnain Gamer).
- Hasnain's YouTube Channel Link: "https://www.youtube.com/@TheHasnainGamer1" (STRICT: NO spaces in "@TheHasnainGamer1").
- If user says: "developer ka channel kholo", "hasnain ka channel kholo", "open your developer channel":
  YOU MUST RETURN THIS EXACT ACTION:
  {
    "type": "OPEN_BROWSER",
    "payload": {
      "url": "https://www.youtube.com/@TheHasnainGamer1",
      "query": null,
      "browser": "chrome"
    }
  }
  NEVER add spaces, NEVER add search queries to this channel URL!

CRITICAL BROWSER & YOUTUBE RULES:
1. When user says "Open YouTube" or "Chrome me YouTube kholo":
   DO NOT search anything! The "query" MUST BE null!
   {
     "type": "OPEN_BROWSER",
     "payload": {
       "url": "https://www.youtube.com",
       "query": null,
       "browser": "chrome"
     }
   }
2. When user says "first video play karo", "play first video", "play short":
   DO NOT search this sentence! Trigger action:
   {
     "type": "PLAY_FIRST_VIDEO",
     "payload": {
       "target": "first_video"
     }
   }
3. When asked to create a file (e.g. index.html, app.py), you MUST return the CREATE_FILE action!

Strict JSON Output format:
{
  "spokenResponse": "Sir, maine Chrome me YouTube open kar diya hai.",
  "actions": [
    {
      "type": "OPEN_BROWSER",
      "payload": {
        "url": "https://www.youtube.com",
        "query": null,
        "browser": "chrome"
      }
    }
  ]
}

Always respond in concise, natural, polite Urdu / Roman Urdu.
`;

async function runAIInferenceStream(
  userPrompt,
  audioBase64,
  manualImageBase64,
  config,
  conversationHistory = [],
  onChunkCallback = () => {}
) {
  // اگر اسکرین شاٹ واضح طور پر طلب نہیں کیا گیا تو اسے خالی رکھیں تاکہ پروسیسنگ میں تاخیر نہ ہو
  const imageBase64 = manualImageBase64 || null;
  const provider = config.provider || 'gemini';

  if (provider === 'gemini') {
    if (!config.geminiKey) {
      throw new Error('Google Gemini API key is missing. Please enter your key in Settings.');
    }

    const genAI = new GoogleGenerativeAI(config.geminiKey);
    const modelName = config.geminiModel || 'gemini-2.5-flash';

    const formattedContents = [];
    const memorySlice = Array.isArray(conversationHistory) ? conversationHistory.slice(-10) : [];

    memorySlice.forEach((turn) => {
      if (turn.role && turn.text) {
        formattedContents.push({
          role: turn.role === 'model' || turn.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: turn.text }]
        });
      }
    });

    const currentParts = [];
    if (audioBase64) {
      currentParts.push({
        inlineData: {
          mimeType: 'audio/webm',
          data: audioBase64
        }
      });
      currentParts.push({
        text: 'Listen to this directive carefully, execute required system actions, and output strict JSON.'
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

      for await (const chunk of responseStream.stream) {
        const chunkText = chunk.text();
        fullText += chunkText;
        onChunkCallback(chunkText);
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

  return await queryOpenRouterStream(userPrompt, imageBase64, config, conversationHistory, onChunkCallback);
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
      'X-Title': 'NOVA AI Assistant'
    }
  });

  const selectedModel = config.openrouterModel || 'meta-llama/llama-3.3-70b-instruct:free';
  const messages = [{ role: 'system', content: SYSTEM_INSTRUCTION }];

  const memorySlice = Array.isArray(conversationHistory) ? conversationHistory.slice(-10) : [];
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

module.exports = {
  runAIInferenceStream
};
