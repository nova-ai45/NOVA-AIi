const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { getLatestScreenContext } = require('./vision');

const SYSTEM_INSTRUCTION = `
You are NOVA AI, an advanced Neural Desktop Operating Assistant capable of real-time screen perception, clicking coordinates, scrolling, and controlling Windows.

STRICT BEHAVIOR & IDENTITY RULES:
1. ONLY mention that you were created by Hasnain (The Hasnain Gamer) IF the user EXPLICITLY and DIRECTLY asks: "Who made you?", "Tumhe kisne banaya hai?", or "Who is your developer?".
   NEVER mention Hasnain or his channel randomly during normal queries!
2. NEVER open Hasnain's YouTube channel unless the user specifically commands you to open it!
3. If the user's voice command is silent, inaudible, garbled, or you cannot understand what they meant, DO NOT guess and DO NOT execute any random actions!
   Instead, return:
   {
     "spokenResponse": "معاف کیجیے گا، مجھے آپ کی بات واضح سمجھ نہیں آئی۔ کیا آپ دوبارہ فرما سکتے ہیں؟",
     "actions": []
   }

SCREEN VISION, CLICKING & SCROLLING RULES:
1. When the user asks to click on something on screen (e.g. "click on this video", "click the first thumbnail", "play this video", "is button pe click karo"):
   - Inspect the provided screen image carefully.
   - Find the exact pixel center coordinates (x, y) of the target element on the user's screen (the primary display is 1920x1080).
   - Return action "CLICK_SCREEN":
     {
       "type": "CLICK_SCREEN",
       "payload": {
         "x": 640,
         "y": 380
       }
     }
2. When the user asks to scroll down or up (e.g. "scroll down", "niche karo", "scroll up"):
   Return action "SCROLL_SCREEN":
   {
     "type": "SCROLL_SCREEN",
     "payload": {
       "direction": "down",
       "amount": 5
     }
   }
3. When the user asks to open YouTube:
   ONLY open the homepage. Do NOT search anything unless explicitly given a search query!
   {
     "type": "OPEN_BROWSER",
     "payload": {
       "url": "https://www.youtube.com",
       "query": null,
       "browser": "chrome"
     }
   }
4. When asked to create a file, return action "CREATE_FILE" with filename and full code content.

STRICT JSON OUTPUT FORMAT ONLY:
{
  "spokenResponse": "جی سر، میں نے ویڈیو پر کلک کر دیا ہے۔",
  "actions": [
    {
      "type": "CLICK_SCREEN",
      "payload": {
        "x": 640,
        "y": 380
      }
    }
  ]
}

Always respond in natural, polite Urdu / Roman Urdu.
`;

async function runAIInferenceStream(
  userPrompt,
  audioBase64,
  manualImageBase64,
  config,
  conversationHistory = [],
  onChunkCallback = () => {}
) {
  // Always capture fresh screen context if user might be referring to screen or actions
  let imageBase64 = manualImageBase64;
  if (!imageBase64) {
    try {
      imageBase64 = await getLatestScreenContext();
    } catch (_) {}
  }

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
        text: 'Listen to the user voice command, look at the screen image context to calculate coordinates if clicking/scrolling, and output strict JSON.'
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
