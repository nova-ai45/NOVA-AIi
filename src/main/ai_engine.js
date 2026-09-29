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
🎥 YOUTUBE SEARCH & PLAYBACK RULES (DATA API v3):
=======================================================
When the user asks to play a song, video, or says "play [song/video name]" or "[song] chala do / play karo":
1. Extract the clean song/video title.
2. Return the action "YOUTUBE_DIRECT_PLAY":
   {
     "type": "YOUTUBE_DIRECT_PLAY",
     "payload": {
       "query": "Believer Imagine Dragons",
       "browser": "chrome"
     }
   }
3. The system will automatically use the YouTube Data API v3 key to retrieve the exact video ID and launch "https://www.youtube.com/watch?v={videoId}&autoplay=1" directly in Chrome!

=======================================================
🚨 CRITICAL INTENT RECOGNITION (TALK VS EXECUTE):
=======================================================
MODE A: CONVERSATION & CASUAL CHAT (NO ACTIONS):
- If the user is chatting, complimenting, asking opinions, or joking (e.g., "Mera ek dost hai uske gameplay ki tareef karo"):
  -> Return "actions": []
  -> Do NOT open YouTube or trigger any searches!

MODE B: EXPLICIT COMMANDS ONLY:
- "Open YouTube" -> OPEN_BROWSER with url "https://www.youtube.com" (query: null).
- "Play [song]" -> YOUTUBE_DIRECT_PLAY with clean query.
- "Google search [X]" -> GOOGLE_CUSTOM_SEARCH with query.
- "Website / File bana do" -> CREATE_FILE with full content and filename.

STRICT JSON OUTPUT FORMAT ONLY:
{
  "spokenResponse": "Haan boss, direct play kar rahi hoon. Enjoy karo!",
  "actions": [
    {
      "type": "YOUTUBE_DIRECT_PLAY",
      "payload": {
        "query": "Believer Imagine Dragons",
        "browser": "chrome"
      }
    }
  ]
}

Always respond in natural, polite Roman Urdu or English matching the user.
`;

function sanitizeConversationHistoryForGemini(rawHistory, currentParts) {
  const sanitized = [];

  if (Array.isArray(rawHistory)) {
    for (const turn of rawHistory) {
      if (!turn) continue;
      const text = (turn.text || turn.content || '').trim();
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
    : [{ text: 'Listen to the directive and execute.' }];

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
 * Universal Stream Runner with Direct Dynamic Key Loading
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

  // 1. Google Gemini Flash Streaming Engine
  if (provider === 'gemini') {
    const userGeminiKey = (config.geminiKey || '').trim();
    if (!userGeminiKey) {
      throw new Error("Gemini API Key missing! Kripya Settings me jaa kar apni Gemini API Key enter karein.");
    }

    const genAI = new GoogleGenerativeAI(userGeminiKey);
    const modelName = config.geminiModel || 'gemini-2.5-flash';

    const currentParts = [];

    if (audioBase64) {
      currentParts.push({
        inlineData: {
          mimeType: 'audio/wav',
          data: audioBase64
        }
      });
      currentParts.push({
        text: `Listen to this clear 16kHz WAV user recording. Transcribe user speech into "transcribedUserSpeech", formulate direct YouTube/OS actions, and output strict JSON.`
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

  messages.push({ role: 'user', content: userPrompt });

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
