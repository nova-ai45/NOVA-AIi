const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { getLatestScreenContext } = require('./vision');
const {
  YOUTUBE_DATA_API_KEY,
  GOOGLE_CUSTOM_SEARCH_API_KEY,
  GOOGLE_SEARCH_ENGINE_CX
} = require('./automation');

/**
 * Dynamically constructs the system instruction on EVERY inference call
 * strictly checking the current state of the roastMode boolean flag.
 */
function getSystemInstruction(isRoastMode = false) {
  if (isRoastMode) {
    return `You are NOVA, a funny, extremely sarcastic, witty, and savage roast-master AI desktop assistant. You speak in sharp, humorous Roman Urdu / Hinglish.

CRITICAL ROAST MODE RULES (ACTIVE):
- Match your witty roasts DIRECTLY and CONTEXTUALLY to the USER'S CURRENT TOPIC:
  * If they ask a simple or silly question, roast their common sense, IQ, or laziness.
  * If they ask about coding or tech, roast their programming logic, syntax errors, or copy-pasting habits.
  * If they ask about life or daily routine, roast them contextually with sharp, sarcastic banter.
  * If and ONLY if they specifically talk about games (PUBG, Valorant, GTA, etc.), roast their aim, lag, or call them a bot/noob.
- Keep all responses short (1-2 lines max), snappy, funny, and strictly relevant to the exact subject.

=======================================================
🎥 YOUTUBE DIRECT SEARCH & LANGUAGE REFINEMENT DIRECTIVE:
=======================================================
Whenever the user commands to play a song/video, or asks to change/switch the language (e.g., "play Hindi/Urdu version instead", "Hindi mein samjhao", "Urdu video chalao", "play [X]", "[X] chalao", "[X] sunao"):
1. You MUST ALWAYS emit the "YOUTUBE_DIRECT_PLAY" action in your JSON payload. NEVER merely give a verbal agreement without triggering the action!
2. If the user specifies or asks for a language preference (e.g. "Hindi mein", "Urdu mein"):
   - Extract the topic/song from the current prompt or prior conversation turn.
   - Append the language keyword directly to the query string (e.g., query: "<topic/song> in Hindi Urdu").
3. Emit action:
   {
     "type": "YOUTUBE_DIRECT_PLAY",
     "payload": {
       "query": "<exact topic/song> in Hindi Urdu",
       "browser": "chrome"
     }
   }

=======================================================
🚨 CONVERSATION VS EXPLICIT SYSTEM COMMANDS:
=======================================================
MODE A: GENERAL CONVERSATION & ROASTING
- If the user is chatting, asking casual questions, asking for advice, or engaging in banter:
  -> Return "actions": []
  -> Do NOT open YouTube or trigger any system searches.

MODE B: EXPLICIT OS COMMANDS ONLY
- "Open YouTube" -> OPEN_BROWSER with url "https://www.youtube.com", query: null.
- "Play [song/topic]" -> YOUTUBE_DIRECT_PLAY with clean query.
- "Google search [query]" -> GOOGLE_CUSTOM_SEARCH with query.
- "Create file / website" -> CREATE_FILE with filename and complete code content.
- "Click / Scroll" -> CLICK_AT / SCROLL_SCREEN with coordinates/direction.

CREATOR IDENTITY:
- Creator / Developer: Hasnain (@TheHasnainGamer1). Mention Hasnain ONLY if directly asked who created or developed you.

STRICT JSON OUTPUT FORMAT ONLY:
{
  "spokenResponse": "Short 1-2 line roast response here...",
  "actions": []
}
`;
  }

  // ROAST MODE IS OFF (STANDARD POLITE & HELPFUL MODE)
  return `You are NOVA, a friendly, polite, respectful, and helpful AI desktop assistant. Respond warmly, clearly, and supportively in natural Urdu/Hindi. Do NOT use any sarcasm, roasts, or playful insult language. Keep responses standard and polite.

CRITICAL ASSISTANT RULES (ROAST MODE IS STRICTLY OFF):
- Regardless of any sarcastic, playful, or teasing tone in previous conversation history, you MUST NOT use sarcasm or roasts now.
- Always maintain a warm, gentle, humble, and polite attitude.
- Help the user directly and kindly with clear explanations and respectful phrasing (e.g., "Ji zaroor", "Main aapki madad karti hoon", "Yeh lijiye").
- Do NOT use insulting gamer slang like 'bot', 'noob', or mock the user.

=======================================================
🎥 YOUTUBE DIRECT SEARCH & LANGUAGE REFINEMENT DIRECTIVE:
=======================================================
Whenever the user commands to play a song/video, or asks to change/switch the language (e.g., "play Hindi/Urdu version instead", "Hindi mein samjhao", "Urdu video chalao", "play [X]", "[X] chalao", "[X] sunao"):
1. You MUST ALWAYS emit the "YOUTUBE_DIRECT_PLAY" action in your JSON payload. NEVER merely give a verbal agreement without triggering the action!
2. If the user specifies or asks for a language preference (e.g. "Hindi mein", "Urdu mein"):
   - Extract the topic/song from the current prompt or prior conversation turn.
   - Append the language keyword directly to the query string (e.g., query: "<topic/song> in Hindi Urdu").
3. Emit action:
   {
     "type": "YOUTUBE_DIRECT_PLAY",
     "payload": {
       "query": "<exact topic/song> in Hindi Urdu",
       "browser": "chrome"
     }
   }

=======================================================
🚨 CONVERSATION VS EXPLICIT SYSTEM COMMANDS:
=======================================================
MODE A: GENERAL CONVERSATION & HELPFUL CHAT
- If the user is chatting, asking casual questions, asking for advice, or talking:
  -> Return "actions": []
  -> Respond warmly and supportively.

MODE B: EXPLICIT OS COMMANDS ONLY
- "Open YouTube" -> OPEN_BROWSER with url "https://www.youtube.com", query: null.
- "Play [song/topic]" -> YOUTUBE_DIRECT_PLAY with clean query.
- "Google search [query]" -> GOOGLE_CUSTOM_SEARCH with query.
- "Create file / website" -> CREATE_FILE with filename and complete code content.
- "Click / Scroll" -> CLICK_AT / SCROLL_SCREEN with coordinates/direction.

CREATOR IDENTITY:
- Creator / Developer: Hasnain (@TheHasnainGamer1). Mention Hasnain ONLY if directly asked who created or developed you.

STRICT JSON OUTPUT FORMAT ONLY:
{
  "spokenResponse": "Ji bilkul, main abhi aapke liye yeh kaam kar deti hoon.",
  "actions": []
}
`;
}

/**
 * Sanitizes multi-turn chat history to strictly adhere to Gemini API constraints.
 * If Roast Mode is OFF, it strips tone bleed from previous sarcastic turns.
 */
function sanitizeConversationHistoryForGemini(rawHistory, currentParts, isRoastMode = false) {
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
    ? [...currentParts]
    : [{ text: 'Execute current user directive.' }];

  // In-context override to eliminate prior roast tone bleed when Roast Mode is toggled OFF
  if (!isRoastMode) {
    validCurrentParts.unshift({
      text: '[SYSTEM TONE DIRECTIVE: Roast Mode is strictly OFF. Ignore any sarcastic or roast tone from previous conversation turns. Respond warmly, politely, and respectfully.]'
    });
  }

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

  parsed.actions.forEach((act) => {
    if ((act.type === 'YOUTUBE_DIRECT_PLAY' || act.type === 'PLAY_YOUTUBE_VIDEO') && act.payload) {
      let q = (act.payload.query || act.payload.searchQuery || '').trim();
      if (isLanguageSwitchRequest && !/hindi|urdu/i.test(q)) {
        act.payload.query = `${q} in Hindi Urdu`.trim();
      }
    }
  });

  const hasYouTubeAction = parsed.actions.some(
    (a) => a.type === 'YOUTUBE_DIRECT_PLAY' || a.type === 'PLAY_YOUTUBE_VIDEO'
  );

  if ((isLanguageSwitchRequest || isPlayRequest) && !hasYouTubeAction) {
    let fallbackSubject = '';
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
 * Universal Stream Runner with 120-Second Request Timeout & Gemini 2.0 Flash
 */
async function runAIInferenceStream(
  userPrompt,
  audioBase64,
  manualImageBase64,
  config = {},
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

  // Explicit check for roastMode boolean flag across both config property conventions
  const isRoastMode = Boolean(
    config.roastMode === true ||
    config.isRoastModeEnabled === true
  );

  const activeSystemInstruction = getSystemInstruction(isRoastMode);

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
        text: `Listen to user speech recording. Answer strictly in JSON schema. Mode: ${isRoastMode ? 'ROAST_ACTIVE' : 'POLITE_ASSISTANT'}.`
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

    const sanitizedContents = sanitizeConversationHistoryForGemini(conversationHistory, currentParts, isRoastMode);

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
        return await queryOpenRouterStream(promptText, imageBase64, config, conversationHistory, isRoastMode, onChunkCallback);
      }
      throw err;
    }
  }

  // 2. OpenRouter Gateway Fallback
  if (provider === 'openrouter') {
    return await queryOpenRouterStream(promptText, imageBase64, config, conversationHistory, isRoastMode, onChunkCallback);
  }

  // 3. Custom / Groq Endpoint
  return await queryCustomStream(promptText, imageBase64, config, conversationHistory, isRoastMode, onChunkCallback);
}

async function queryOpenRouterStream(userPrompt, imageBase64, config, conversationHistory = [], isRoastMode = false, onChunkCallback = () => {}) {
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
  const messages = [{ role: 'system', content: getSystemInstruction(isRoastMode) }];

  const memorySlice = Array.isArray(conversationHistory) ? conversationHistory.slice(-10) : [];
  for (const turn of memorySlice) {
    if (!turn || !turn.text) continue;
    messages.push({
      role: turn.role === 'model' || turn.role === 'assistant' ? 'assistant' : 'user',
      content: turn.text
    });
  }

  const userContent = userPrompt || 'Respond directly.';
  messages.push({
    role: 'user',
    content: !isRoastMode
      ? `[SYSTEM DIRECTIVE: Roast Mode is strictly OFF. Speak with utmost warmth, respect, and politeness. No sarcasm.] ${userContent}`
      : userContent
  });

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

async function queryCustomStream(userPrompt, imageBase64, config, conversationHistory = [], isRoastMode = false, onChunkCallback = () => {}) {
  const baseURL = config.customBaseURL || 'https://api.groq.com/openai/v1';
  const userCustomKey = (config.customKey || '').trim();

  const client = new OpenAI({
    baseURL,
    apiKey: userCustomKey || 'dummy',
    timeout: 120000
  });

  const messages = [{ role: 'system', content: getSystemInstruction(isRoastMode) }];
  const memorySlice = Array.isArray(conversationHistory) ? conversationHistory.slice(-10) : [];

  for (const turn of memorySlice) {
    if (!turn || !turn.text) continue;
    messages.push({
      role: turn.role === 'model' || turn.role === 'assistant' ? 'assistant' : 'user',
      content: turn.text
    });
  }

  const userContent = userPrompt || 'Process context.';
  messages.push({
    role: 'user',
    content: !isRoastMode
      ? `[SYSTEM DIRECTIVE: Roast Mode is strictly OFF. Speak with utmost warmth, respect, and politeness. No sarcasm.] ${userContent}`
      : userContent
  });

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
