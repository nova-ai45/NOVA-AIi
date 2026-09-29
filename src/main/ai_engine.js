const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { getLatestScreenContext } = require('./vision');
const {
  YOUTUBE_DATA_API_KEY,
  GOOGLE_CUSTOM_SEARCH_API_KEY,
  GOOGLE_SEARCH_ENGINE_CX
} = require('./automation');

/**
 * Dynamically constructs the system instruction based on the Gamer / Roast Mode toggle.
 */
function getSystemInstruction(isRoastModeEnabled = false) {
  const personalityBlock = isRoastModeEnabled
    ? `You are NOVA AI, a funny, extremely sarcastic, witty, and savage roast-master PC Assistant. You speak in sharp, humorous Roman Urdu.

CRITICAL ROAST MODE RULES:
- Do NOT limit roasts to gaming, aim, or headshots unless the user specifically asks about gaming!
- Always match the roast DIRECTLY and CONTEXTUALLY to the USER'S CURRENT TOPIC:
  * If the user asks a stupid or simple question, roast their general knowledge, IQ, or laziness.
  * If they ask about coding or tech, roast their programming logic, syntax errors, or copy-pasting habits.
  * If they ask about life, relationships, or daily routine, roast them contextually with witty, sarcastic Roman Urdu.
  * If and ONLY if they specifically talk about games (PUBG, Valorant, GTA, etc.), roast their aim, lag, or call them a bot/noob.
- Keep all responses short (1-2 lines max), funny, and sharply relevant to the exact topic raised.`
    : `You are NOVA AI, an advanced, witty, and loyal PC assistant. Respond respectfully, smoothly, and concisely in Roman Urdu or English depending on user input.`;

  return `
${personalityBlock}

=======================================================
🎥 YOUTUBE DIRECT SEARCH & LANGUAGE REFINEMENT DIRECTIVE:
=======================================================
Whenever the user commands to play a song/video, or asks to change/switch the language (e.g., "play Hindi/Urdu version instead", "Hindi mein samjhao", "Urdu video chalao", "English version dikhao", "play [X]", "[X] chalao", "[X] sunao"):
1. You MUST ALWAYS emit the "YOUTUBE_DIRECT_PLAY" action in your JSON payload. NEVER merely give a verbal agreement without triggering the action!
2. If the user specifies or asks for a language preference (e.g. "Hindi mein", "Urdu mein", "Hindi/Urdu version"):
   - Extract the topic/song from the current prompt or prior conversation turn.
   - Append the language keyword directly to the query string (e.g., query: "<topic/song> in Hindi Urdu").
3. Clean the query string from generic verbal filler phrases like "chalao", "sunao", "play", "dikhao", but KEEP the actual subject and the language keyword!
4. Action format:
   {
     "type": "YOUTUBE_DIRECT_PLAY",
     "payload": {
       "query": "<exact topic/song> in Hindi Urdu",
       "browser": "chrome"
     }
   }
5. The system will search YouTube Data API v3 and immediately launch the direct playback URL (https://www.youtube.com/watch?v=videoId).

=======================================================
🚨 CONVERSATION VS EXPLICIT SYSTEM COMMANDS:
=======================================================
MODE A: GENERAL CONVERSATION & ROASTING
- If the user is chatting, asking casual questions, asking for advice, or engaging in banter (and NOT asking to play/watch anything):
  -> Return "actions": []
  -> Do NOT open YouTube or trigger any system searches.

MODE B: EXPLICIT OS COMMANDS ONLY
- "Open YouTube" (home page only) -> OPEN_BROWSER with url "https://www.youtube.com", query: null.
- "Play [song/topic]" or language refinement -> YOUTUBE_DIRECT_PLAY with clean query.
- "Google search [query]" -> GOOGLE_CUSTOM_SEARCH with query.
- "Create file / website" -> CREATE_FILE with filename and complete code content.
- "Click / Scroll" -> CLICK_AT / SCROLL_SCREEN with coordinates/direction.

CREATOR IDENTITY:
- Creator / Developer: Hasnain (@TheHasnainGamer1). Mention Hasnain ONLY if directly asked who created or developed you.

STRICT JSON OUTPUT FORMAT ONLY:
{
  "spokenResponse": "Short 1-2 line response here...",
  "actions": []
}
`;
}

/**
 * Programmatic safeguard: Enforces language refinement and ensures YouTube
 * playback actions are never dropped when a language switch or play request is detected.
 */
function enforceYouTubeLanguageAndActions(parsed, promptText, conversationHistory = []) {
  if (!parsed || typeof parsed !== 'object') return parsed;

  const isLanguageSwitchRequest = /\b(hindi|urdu|english)\b/i.test(promptText) &&
    /\b(mein|me|version|video|chalao|play|samjhao|dikhao|laga)\b/i.test(promptText);
  const isPlayRequest = /\b(play|chalao|sunao|laga do|chala do|bajao|video)\b/i.test(promptText);

  if (!parsed.actions || !Array.isArray(parsed.actions)) {
    parsed.actions = [];
  }

  // 1. Refine queries on any existing YouTube actions
  parsed.actions.forEach((act) => {
    if ((act.type === 'YOUTUBE_DIRECT_PLAY' || act.type === 'PLAY_YOUTUBE_VIDEO') && act.payload) {
      let q = (act.payload.query || act.payload.searchQuery || '').trim();
      if (isLanguageSwitchRequest && !/hindi|urdu/i.test(q)) {
        act.payload.query = `${q} in Hindi Urdu`.trim();
      }
    }
  });

  // 2. Fallback: If user asked for a video in Hindi/Urdu but the model omitted the action
  const hasYouTubeAction = parsed.actions.some(
    (a) => a.type === 'YOUTUBE_DIRECT_PLAY' || a.type === 'PLAY_YOUTUBE_VIDEO'
  );

  if ((isLanguageSwitchRequest || isPlayRequest) && !hasYouTubeAction) {
    let fallbackSubject = '';
    // Look at previous turn to find topic if this is a follow-up request
    if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      const lastTurn = conversationHistory[conversationHistory.length - 1];
      fallbackSubject = (lastTurn.text || '').replace(/[^\w\s]/gi, ' ').slice(0, 40).trim();
    }

    const cleanSubject = promptText
      .replace(/\b(play|chalao|sunao|laga do|chala do|dikhao|mein|me|version|video|karo|bhai|please)\b/gi, '')
      .trim();

    const targetQuery = cleanSubject || fallbackSubject || 'trending';
    const finalQuery = isLanguageSwitchRequest && !/hindi|urdu/i.test(targetQuery)
      ? `${targetQuery} in Hindi Urdu`.trim()
      : targetQuery;

    parsed.actions.push({
      type: 'YOUTUBE_DIRECT_PLAY',
      payload: {
        query: finalQuery,
        browser: 'chrome'
      }
    });
  }

  return parsed;
}

/**
 * Sanitizes multi-turn chat history to strictly adhere to Gemini API constraints.
 */
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
    : [{ text: 'Execute current user directive.' }];

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
 * Universal Stream Runner with 120-Second Request Timeout & Gemini 2.0 Flash
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
  const isRoastModeEnabled = Boolean(config.isRoastModeEnabled);
  const activeSystemInstruction = getSystemInstruction(isRoastModeEnabled);

  // 1. Google Gemini 2.0 Flash (Stable Endpoint with 120s Fetch Timeout)
  if (provider === 'gemini') {
    const userGeminiKey = (config.geminiKey || '').trim();
    if (!userGeminiKey) {
      throw new Error("Gemini API Key missing! Kripya Settings me jaa kar apni Gemini API Key enter karein.");
    }

    const genAI = new GoogleGenerativeAI(userGeminiKey);
    const modelName = config.geminiModel || 'gemini-2.0-flash';

    const currentParts = [];

    if (audioBase64) {
      currentParts.push({
        inlineData: {
          mimeType: 'audio/wav',
          data: audioBase64
        }
      });
      currentParts.push({
        text: `Listen to user speech recording. If asking for a video/song or language switch, emit YOUTUBE_DIRECT_PLAY with the refined query. Output strict JSON.`
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

    const model = genAI.getGenerativeModel(
      {
        model: modelName,
        systemInstruction: activeSystemInstruction,
        generationConfig: { responseMimeType: 'application/json' }
      },
      { timeout: 120000 }
    );

    try {
      const responseStream = await model.generateContentStream({ contents: sanitizedContents });
      let fullText = '';

      for await (const chunk of responseStream.stream) {
        const chunkText = chunk.text();
        fullText += chunkText;
        onChunkCallback(chunkText);
      }

      const parsed = JSON.parse(fullText);
      return enforceYouTubeLanguageAndActions(parsed, promptText, conversationHistory);
    } catch (err) {
      const isQuotaOrTimeout =
        err.message.includes('429') ||
        err.message.includes('quota') ||
        err.message.includes('ResourceExhausted') ||
        err.message.includes('503') ||
        err.message.includes('fetch failed');

      if (isQuotaOrTimeout && config.openrouterKey) {
        return await queryOpenRouterStream(promptText, imageBase64, config, conversationHistory, isRoastModeEnabled, onChunkCallback);
      }
      throw err;
    }
  }

  // 2. OpenRouter Gateway Fallback
  if (provider === 'openrouter') {
    return await queryOpenRouterStream(promptText, imageBase64, config, conversationHistory, isRoastModeEnabled, onChunkCallback);
  }

  // 3. Custom / Groq Endpoint
  return await queryCustomStream(promptText, imageBase64, config, conversationHistory, isRoastModeEnabled, onChunkCallback);
}

async function queryOpenRouterStream(userPrompt, imageBase64, config, conversationHistory = [], isRoastModeEnabled = false, onChunkCallback = () => {}) {
  const userOpenRouterKey = (config.openrouterKey || '').trim();
  if (!userOpenRouterKey) {
    throw new Error('OpenRouter API key missing. Please enter it in Settings.');
  }

  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: userOpenRouterKey,
    timeout: 120000,
    defaultHeaders: {
      'HTTP-Referer': 'https://nova-ai.desktop',
      'X-Title': 'NOVA AI Assistant'
    }
  });

  const selectedModel = config.openrouterModel || 'meta-llama/llama-3.3-70b-instruct:free';
  const messages = [{ role: 'system', content: getSystemInstruction(isRoastModeEnabled) }];

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

  const parsed = JSON.parse(fullText);
  return enforceYouTubeLanguageAndActions(parsed, userPrompt, conversationHistory);
}

async function queryCustomStream(userPrompt, imageBase64, config, conversationHistory = [], isRoastModeEnabled = false, onChunkCallback = () => {}) {
  const baseURL = config.customBaseURL || 'https://api.groq.com/openai/v1';
  const userCustomKey = (config.customKey || '').trim();

  const client = new OpenAI({
    baseURL,
    apiKey: userCustomKey || 'dummy',
    timeout: 120000
  });

  const messages = [{ role: 'system', content: getSystemInstruction(isRoastModeEnabled) }];
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

  const parsed = JSON.parse(fullText);
  return enforceYouTubeLanguageAndActions(parsed, userPrompt, conversationHistory);
}

module.exports = {
  YOUTUBE_DATA_API_KEY,
  GOOGLE_CUSTOM_SEARCH_API_KEY,
  GOOGLE_SEARCH_ENGINE_CX,
  runAIInferenceStream
};
