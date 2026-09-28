const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { getLatestScreenContext } = require('./vision');
const {
  YOUTUBE_DATA_API_KEY,
  GOOGLE_CUSTOM_SEARCH_API_KEY,
  GOOGLE_SEARCH_ENGINE_CX
} = require('./automation');

const SYSTEM_INSTRUCTION = `
You are NOVA AI, an advanced, witty, and loyal personal desktop companion (Zara / modern reel style).

=======================================================
🚨 CRITICAL AUDIO LISTENING & TRANSCRIPTION DIRECTIVE 🚨
=======================================================
When an audio recording (WAV) is provided:
1. CAREFULLY LISTEN to the user's spoken voice. The user will typically speak in Urdu, Roman Urdu, Hindi, or English.
2. Transcribe exactly what words they said into "transcribedUserSpeech".
3. NEVER repeat generic canned phrases like "جی میں سمجھ رہا ہوں، آپ کیا پوچھنا چاہتے ہیں؟".
4. Directly execute their requested command!
   - If they ask to open YouTube: execute OPEN_BROWSER with url "https://www.youtube.com".
   - If they ask to open Chrome: execute OPEN_BROWSER with url "https://www.google.com".
   - If they ask to create or write a file: execute CREATE_FILE with full content.
   - If they ask a general question or chit-chat: answer their question directly in your witty Hinglish tone!
5. ONLY if the audio is completely 100% dead silent (zero human sound), reply:
   "Arey boss, aawaz nahi aayi. Ek baar wapas bolna kya keh rahe the?"

=======================================================
💻 ACTIONS RULES:
=======================================================
- If user says "Open YouTube": url: "https://www.youtube.com", query: null, browser: "chrome".
- If user asks about their creator/developer: Hasnain (@TheHasnainGamer1).
- DO NOT inject hardware battery/CPU stats unless the user explicitly used words like "battery", "charge", "cpu", "ram".

STRICT JSON OUTPUT FORMAT ONLY:
{
  "transcribedUserSpeech": "YouTube open karo",
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
`;

function sanitizeConversationHistoryForGemini(rawHistory, currentParts) {
  const sanitized = [];

  if (Array.isArray(rawHistory)) {
    for (const turn of rawHistory) {
      if (!turn) continue;
      const text = (turn.text || turn.content || '').trim();
      // Remove any previously stuck loop phrases from context
      if (!text || text.includes('[Voice Directive]') || text.includes('آپ کیا پوچھنا چاہتے ہیں')) continue;

      const role = turn.role === 'model' || turn.role === 'assistant' ? 'model' : 'user';

      if (sanitized.length > 0 && sanitized[sanitized.length - 1].role === role) {
        sanitized[sanitized.length - 1].parts[0].text += `\n${text}`;
      } else {
        sanitized.push({
          role,
          parts: [{ text }]
        });
      }
    }
  }

  while (sanitized.length > 0 && sanitized[0].role === 'model') {
    sanitized.shift();
  }

  while (sanitized.length > 0 && sanitized[sanitized.length - 1].role === 'user') {
    sanitized.pop();
  }

  const validCurrentParts = Array.isArray(currentParts) && currentParts.length > 0
    ? currentParts
    : [{ text: 'Listen to the audio directive and execute.' }];

  sanitized.push({
    role: 'user',
    parts: validCurrentParts
  });

  while (sanitized.length > 0 && sanitized[sanitized.length - 1].role === 'model') {
    sanitized.pop();
  }

  return sanitized;
}

/**
 * Universal Stream Runner with 16kHz PCM WAV Audio Decoding
 */
async function runAIInferenceStream(
  userPrompt,
  audioBase64,
  manualImageBase64,
  config,
  conversationHistory = [],
  hardwareStats = null,
  onChunkCallback = () => {}
) {
  let imageBase64 = manualImageBase64;
  if (!imageBase64 && userPrompt && (userPrompt.toLowerCase().includes('screen') || userPrompt.toLowerCase().includes('dekho'))) {
    try {
      imageBase64 = await getLatestScreenContext();
    } catch (_) {}
  }

  const promptText = (userPrompt || '').trim();
  const isExplicitHardwareQuery = /\b(battery|charge|charging|cpu|ram|memory|temperature|temp|laptop status|system stats|hardware|processor)\b/i.test(promptText);

  let hardwareContext = '';
  if (isExplicitHardwareQuery && hardwareStats) {
    hardwareContext = `\n[BATTERY: ${hardwareStats.battery.percent}%, CPU: ${hardwareStats.cpu.loadPercent}%]\n`;
  }

  const provider = config.provider || 'gemini';

  // Google Gemini Audio & Text Engine
  if (provider === 'gemini') {
    const userGeminiKey = (config.geminiKey || '').trim();
    if (!userGeminiKey) {
      throw new Error("Gemini API Key missing! Kripya Settings me jaa kar apni Gemini API Key enter karein.");
    }

    const genAI = new GoogleGenerativeAI(userGeminiKey);
    const modelName = config.geminiModel || 'gemini-2.5-flash';

    const currentParts = [];

    // کرسٹل کلیئر 16kHz WAV آڈیو ان پٹ
    if (audioBase64) {
      currentParts.push({
        inlineData: {
          mimeType: 'audio/wav',
          data: audioBase64
        }
      });
      currentParts.push({
        text: `Listen to this clear 16kHz WAV recording of user voice. Transcribe user speech accurately into "transcribedUserSpeech", execute the action, and respond in required JSON schema.`
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

    if (promptText) {
      currentParts.push({ text: `${promptText} ${hardwareContext}`.trim() });
    }

    const sanitizedContents = sanitizeConversationHistoryForGemini(conversationHistory, currentParts);

    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: { responseMimeType: 'application/json' }
    });

    try {
      const responseStream = await model.generateContentStream({ contents: sanitizedContents });
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
        return await queryOpenRouterStream(promptText, imageBase64, config, conversationHistory, onChunkCallback);
      }
      throw err;
    }
  }

  return await queryOpenRouterStream(promptText, imageBase64, config, conversationHistory, onChunkCallback);
}

async function queryOpenRouterStream(userPrompt, imageBase64, config, conversationHistory = [], onChunkCallback = () => {}) {
  const userOpenRouterKey = (config.openrouterKey || '').trim();
  if (!userOpenRouterKey) {
    throw new Error('OpenRouter API key missing. Please enter it in Settings.');
  }

  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: userOpenRouterKey,
    defaultHeaders: {
      'HTTP-Referer': 'https://nova-ai.desktop',
      'X-Title': 'NOVA AI Assistant'
    }
  });

  const selectedModel = config.openrouterModel || 'meta-llama/llama-3.3-70b-instruct:free';
  const messages = [{ role: 'system', content: SYSTEM_INSTRUCTION }];

  const memorySlice = Array.isArray(conversationHistory) ? conversationHistory.slice(-10) : [];
  for (const turn of memorySlice) {
    if (!turn || !turn.text) continue;
    messages.push({
      role: turn.role === 'model' || turn.role === 'assistant' ? 'assistant' : 'user',
      content: turn.text
    });
  }

  messages.push({ role: 'user', content: userPrompt || 'Respond directly.' });

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
  YOUTUBE_DATA_API_KEY,
  GOOGLE_CUSTOM_SEARCH_API_KEY,
  GOOGLE_SEARCH_ENGINE_CX,
  runAIInferenceStream
};
