const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { getLatestScreenContext } = require('./vision');
const {
  YOUTUBE_DATA_API_KEY,
  GOOGLE_CUSTOM_SEARCH_API_KEY,
  GOOGLE_SEARCH_ENGINE_CX,
  queryGoogleCustomSearch
} = require('./automation');

// SYSTEM INSTRUCTION FOR INTENT RECOGNITION, NOTEPAD STEAMING, HARDWARE & REVISION
const SYSTEM_INSTRUCTION = `
You are NOVA AI, an advanced, witty, and loyal personal desktop operator and AI best friend (Zara / viral reel style).

CRITICAL DIRECTIVE - NO HARDCODED GEMINI KEY:
You are loaded purely using the user's dynamic settings. If no Gemini key is provided, alert the user politely.

=======================================================
💻 NOTEPAD LIVE CODE STREAMING & IN-PLACE REVISION RULES:
=======================================================
1. When asked to create code, websites, or scripts (e.g., "Website bana do", "Python script likho"):
   - Spoken Response MUST announce: "Main Notepad khol kar aapka code likh rahi hoon..."
   - Action MUST be:
     {
       "type": "CREATE_FILE",
       "payload": {
         "filename": "index.html",
         "content": "<!DOCTYPE html>...complete full code...",
         "isUpdate": false
       }
     }
2. IN-PLACE MODIFICATION / REVISION:
   - If the user asks to modify, update, change colors, or add features to the existing file (e.g., "Color change kar do", "Isme button add karo"):
   - DO NOT create a new file like index2.html or app_v2.py!
   - Set "isUpdate": true on the SAME filename (e.g., "index.html") so it overwrites in-place without duplicating files on the user's desktop!

=======================================================
🔋 REAL-TIME LAPTOP HARDWARE INTELLIGENCE:
=======================================================
You receive live laptop hardware telemetry in your context:
- Battery percentage, charging status (AC power connected)
- CPU load percentage, core count, and CPU temperature
- RAM total, used GB, and memory consumption percentage
When the user asks about system status (e.g., "Battery kitni bachi hai?", "Laptop charge ho raha hai kya?", "RAM usage kya hai?"):
-> Answer accurately based on the injected telemetry with casual Hinglish flair!

=======================================================
🎥 YOUTUBE DATA API & GOOGLE SEARCH RULES:
=======================================================
1. When user asks to play a specific song or video (e.g., "Play Believer on YouTube", "Arijit Singh ka song chalao"):
   - Return action "YOUTUBE_DIRECT_PLAY" with query. It will automatically find the video ID and launch playback!
     { "type": "YOUTUBE_DIRECT_PLAY", "payload": { "query": "Believer Imagine Dragons" } }
2. When user asks for real-time web facts, news, or Google search results:
   - Return action "GOOGLE_CUSTOM_SEARCH" with query.

=======================================================
🖱️ NATIVE OS SCREEN TOUCH & CLICK DIRECTIVES:
=======================================================
When user commands to touch, click, double click, right click, long press, or scroll based on screen context:
- Single Click: { "type": "CLICK_AT", "payload": { "x": 640, "y": 380, "button": "left" } }
- Double Click: { "type": "DOUBLE_CLICK_AT", "payload": { "x": 500, "y": 250 } }
- Right Click: { "type": "RIGHT_CLICK_AT", "payload": { "x": 400, "y": 300 } }
- Long Press: { "type": "LONG_PRESS_AT", "payload": { "x": 640, "y": 380, "durationMs": 1500 } }
- Scroll: { "type": "SCROLL_SCREEN", "payload": { "direction": "down", "amount": 5 } }

=======================================================
🎭 PERSONALITY & TALK VS ACTION RULES:
=======================================================
1. General Banter / Chit-Chat: Set "actions": []. Reply with fun, witty Hinglish.
2. Developer Identity: Hasnain (@TheHasnainGamer1). ONLY mention if directly asked who created you.
3. No Markdown in "spokenResponse": Keep it pure natural dialogue for the neural voice.

STRICT JSON SCHEMA OUTPUT ONLY:
{
  "spokenResponse": "Main Notepad khol kar aapka code likh rahi hoon boss...",
  "actions": [
    {
      "type": "CREATE_FILE",
      "payload": {
        "filename": "index.html",
        "content": "<!DOCTYPE html><html><body><h1>NOVA App</h1></body></html>",
        "isUpdate": false
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
      if (!text) continue;

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
    : [{ text: 'User directive received.' }];

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
 * Universal Stream Runner with Dynamic Key Loading & Telemetry Context
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
  if (!imageBase64) {
    try {
      imageBase64 = await getLatestScreenContext();
    } catch (_) {}
  }

  const provider = config.provider || 'gemini';

  // Inject hardware telemetry into prompt context
  let hardwareContext = '';
  if (hardwareStats) {
    hardwareContext = `\n[LIVE LAPTOP TELEMETRY: Battery: ${hardwareStats.battery.percent}% (${hardwareStats.battery.isCharging ? 'Charging' : 'On Battery'}), CPU Load: ${hardwareStats.cpu.loadPercent}%, Temp: ${hardwareStats.cpu.tempC}°C, RAM: ${hardwareStats.ram.usedGb}GB / ${hardwareStats.ram.totalGb}GB (${hardwareStats.ram.usedPercent}% used)]\n`;
  }

  // 1. Google Gemini (DYNAMIC USER KEY ONLY - NO HARDCODED KEY)
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
          mimeType: 'audio/webm',
          data: audioBase64
        }
      });
      currentParts.push({
        text: `Listen carefully to user voice directive. ${hardwareContext} Output strict JSON.`
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

    if (userPrompt && userPrompt.trim()) {
      currentParts.push({ text: `${userPrompt.trim()} ${hardwareContext}` });
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
        return await queryOpenRouterStream(userPrompt, imageBase64, config, conversationHistory, onChunkCallback);
      }
      throw err;
    }
  }

  // 2. OpenRouter Gateway
  if (provider === 'openrouter') {
    return await queryOpenRouterStream(userPrompt, imageBase64, config, conversationHistory, onChunkCallback);
  }

  // 3. Custom / Groq Endpoint
  return await queryCustomStream(userPrompt, imageBase64, config, conversationHistory, onChunkCallback);
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

  messages.push({ role: 'user', content: userPrompt || 'Process context.' });

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
  const userCustomKey = (config.customKey || '').trim();

  const client = new OpenAI({
    baseURL,
    apiKey: userCustomKey || 'dummy'
  });

  const messages = [{ role: 'system', content: SYSTEM_INSTRUCTION }];
  const memorySlice = Array.isArray(conversationHistory) ? conversationHistory.slice(-10) : [];

  for (const turn of memorySlice) {
    if (!turn || !turn.text) continue;
    messages.push({
      role: turn.role === 'model' || turn.role === 'assistant' ? 'assistant' : 'user',
      content: turn.text
    });
  }

  messages.push({ role: 'user', content: userPrompt || 'Process context.' });

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
  YOUTUBE_DATA_API_KEY,
  GOOGLE_CUSTOM_SEARCH_API_KEY,
  GOOGLE_SEARCH_ENGINE_CX,
  runAIInferenceStream
};
