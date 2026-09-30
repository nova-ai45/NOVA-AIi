const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { getLatestScreenContext } = require('./vision');
const {
  YOUTUBE_DATA_API_KEY,
  GOOGLE_CUSTOM_SEARCH_API_KEY,
  GOOGLE_SEARCH_ENGINE_CX,
  readEntireScreenOCR
} = require('./automation');

/**
 * Canned repetition phrases that trap the LLM into loops.
 */
const CANNED_LOOP_PATTERNS = [
  /لیپ\s*ٹاپ\s*سکرین\s*دیکھ\s*سکتی\s*ہوں/i,
  /سکرین\s*دیکھ\s*سکتی\s*ہوں/i,
  /screen\s*dekh\s*sakti\s*hoon/i,
  /laptop\s*screen\s*dekh\s*sakti/i,
  /haan\s*main\s*aapki\s*screen\s*dekh/i
];

/**
 * Dynamically constructs the system instruction based on roast mode & active screen text.
 */
function getSystemInstruction(isRoastMode = false) {
  if (isRoastMode) {
    return `You are NOVA, a funny, extremely sarcastic, witty, and savage roast-master AI desktop assistant. You speak in sharp, humorous Roman Urdu / Hinglish.

=======================================================
🚨 CRITICAL LOOP-BREAKING & SCREEN READING RULES (ROAST ACTIVE):
=======================================================
1. NEVER repeat "Haan main aapki screen dekh sakti hoon" or any generic canned acknowledgement!
2. When the user asks about their screen (e.g. "Screen dekh sakti ho?", "Screen par kya hai?"):
   - Inspect [LIVE LOCAL OCR SCREEN TEXT EXTRACTED].
   - If text is present: Sarcastic roast! Roast whatever silly, messy, embarrassing, or random tabs/code/content is open on their screen in 1-2 sharp, hilarious lines!
   - If no text was found: Roast them for having an empty screen or hiding things from you.
   - Example: "Arey boss, screen par itne faltu tabs khol rakhe hain, aur pooch rahe ho dekh sakti hoon? Padhne ke bajaye timepass chal raha hai!"

CRITICAL GENERAL ROAST RULES:
- Match your roast directly to the user's current topic:
  * Simple/lazy questions -> roast their common sense.
  * Code/tech -> roast their bugs or copy-pasting.
  * Gaming -> roast their aim, lag, or call them a noob.
- Responses must be short, punchy (1-2 lines max), and strictly relevant.

=======================================================
🎥 YOUTUBE DIRECT SEARCH & LANGUAGE REFINEMENT DIRECTIVE:
=======================================================
When the user asks to play a video/song, or change language (e.g., "Hindi mein samjhao", "play [X]", "[X] chalao"):
- Emit action "YOUTUBE_DIRECT_PLAY" with query: "<topic/song> in Hindi Urdu".

STRICT JSON OUTPUT FORMAT ONLY:
{
  "spokenResponse": "Short 1-2 line sarcastic roast based on actual screen or query...",
  "actions": []
}
`;
  }

  // STANDARD POLITE & HELPFUL MODE
  return `You are NOVA, a friendly, polite, respectful, and helpful AI desktop assistant. Respond warmly, clearly, and supportively in natural Urdu/Hindi.

=======================================================
🚨 CRITICAL LOOP-BREAKING & SCREEN READING RULES (ROAST OFF):
=======================================================
1. NEVER repeat generic canned responses like "Haan main aapki screen dekh sakti hoon" without actual substance!
2. When the user asks "kya tum meri screen dekh sakti ho?", "screen par kya likha hai?", or asks about their display:
   - Check [LIVE LOCAL OCR SCREEN TEXT EXTRACTED].
   - If text is present, respond strictly in this format:
     "Haan, mujhe screen par yeh text mila hai: [Brief 1-sentence summary of the actual extracted text/open apps]. Ab batao kya karna hai?"
   - If the screen is clean or blank, state: "Haan, main screen dekh rahi hoon lekin abhi koi khaas text nazar nahi aa raha. Aapko kya madad chahiye?"
3. NEVER repeat yourself if you answered about the screen in a previous turn. Address the user's latest inquiry directly!

=======================================================
🎥 YOUTUBE DIRECT SEARCH & LANGUAGE REFINEMENT DIRECTIVE:
=======================================================
When user asks to play a song/video or switch language:
- Emit action "YOUTUBE_DIRECT_PLAY" with clean query.

=======================================================
🚨 CONVERSATION VS EXPLICIT SYSTEM COMMANDS:
=======================================================
MODE A: GENERAL CONVERSATION & CHAT -> Return "actions": [].
MODE B: EXPLICIT OS COMMANDS ONLY -> "OPEN_BROWSER", "CREATE_FILE", "CLICK_AT", "SCROLL_SCREEN".

CREATOR IDENTITY:
- Creator / Developer: Hasnain (@TheHasnainGamer1). Mention Hasnain ONLY if directly asked who created you.

STRICT JSON OUTPUT FORMAT ONLY:
{
  "spokenResponse": "Haan, mujhe screen par yeh text mila hai: [Summary]. Ab batao kya karna hai?",
  "actions": []
}
`;
}

/**
 * Sanitizes multi-turn chat history to strictly adhere to Gemini API constraints
 * AND strips out repetitive loop turns so the model never gets stuck in context loops.
 */
function sanitizeConversationHistoryForGemini(rawHistory, currentParts, isRoastMode = false) {
  const sanitized = [];
  let lastSeenModelText = '';

  if (Array.isArray(rawHistory)) {
    for (const turn of rawHistory) {
      if (!turn) continue;
      const text = (turn.text || turn.content || '').trim();
      if (!text || text.includes('[Voice Directive]') || text.includes('آپ کیا پوچھنا چاہتے ہیں')) continue;

      const role = turn.role === 'model' || turn.role === 'assistant' ? 'model' : 'user';

      // 🚨 CRITICAL LOOP BREAKER: Filter out repetitive model turns or canned screen repetition
      if (role === 'model') {
        const isCannedLoop = CANNED_LOOP_PATTERNS.some((p) => p.test(text));
        if (isCannedLoop && text.length < 130) {
          continue; // Prune out the canned loop message from memory
        }
        if (text === lastSeenModelText) {
          continue; // Deduplicate identical back-to-back responses
        }
        lastSeenModelText = text;
      }

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

  if (!isRoastMode) {
    validCurrentParts.unshift({
      text: '[SYSTEM TONE DIRECTIVE: Roast Mode is strictly OFF. Ignore any previous sarcastic tone. Respond warmly, politely, and never repeat canned phrases.]'
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
 * Programmatic safeguard: Enforces language refinement on YouTube playback queries.
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
 * Universal Stream Runner with Local OCR Screen Reading & Loop Prevention
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
  const promptText = (userPrompt || '').trim();

  // 1. Detect Screen Intent (user asking about screen, reading screen, or wanting context)
  const isScreenQuery = /\b(screen|display|desktop|dekh sakti|dekh sakte|kya likha|kya chal raha|padho|read screen|kya dikh raha|kya hai screen|nazar aa raha|samne kya hai)\b/i.test(promptText);

  let ocrScreenText = '';
  let imageBase64 = manualImageBase64;

  if (isScreenQuery) {
    // a. Execute local Tesseract OCR immediately
    try {
      ocrScreenText = await readEntireScreenOCR();
    } catch (e) {
      console.warn('[Screen OCR Failed]:', e.message);
    }
    // b. Acquire fresh display frame
    try {
      imageBase64 = await getLatestScreenContext();
    } catch (_) {}
  } else if (!imageBase64 && promptText && (promptText.toLowerCase().includes('click') || promptText.toLowerCase().includes('scroll'))) {
    try {
      imageBase64 = await getLatestScreenContext();
    } catch (_) {}
  }

  // 2. Hardware telemetry gating
  const isExplicitHardwareQuery = /\b(battery|charge|charging|cpu|ram|memory|temperature|temp|laptop status|system stats|hardware|processor)\b/i.test(promptText);

  let hardwareContext = '';
  if (isExplicitHardwareQuery && hardwareStats) {
    hardwareContext = `\n[BATTERY: ${hardwareStats.battery.percent}%, CPU: ${hardwareStats.cpu.loadPercent}%]\n`;
  }

  let screenContextPrompt = '';
  if (ocrScreenText) {
    screenContextPrompt = `\n[LIVE LOCAL OCR SCREEN TEXT EXTRACTED: "${ocrScreenText}"]\n`;
  }

  const provider = config.provider || 'gemini';
  const isRoastMode = Boolean(
    config.roastMode === true ||
    config.isRoastModeEnabled === true
  );

  const activeSystemInstruction = getSystemInstruction(isRoastMode);

  // 3. Google Gemini 2.0 Flash Streaming Engine
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
        text: `Listen to user speech recording. ${screenContextPrompt} Mode: ${isRoastMode ? 'ROAST_ACTIVE' : 'POLITE_ASSISTANT'}. Output strict JSON.`
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
      currentParts.push({ text: `${promptText} ${hardwareContext} ${screenContextPrompt}`.trim() });
    }

    // Sanitize conversation history and prune loop triggers
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
        return await queryOpenRouterStream(promptText, imageBase64, screenContextPrompt, config, conversationHistory, isRoastMode, onChunkCallback);
      }
      throw err;
    }
  }

  // 4. OpenRouter Gateway Fallback
  if (provider === 'openrouter') {
    return await queryOpenRouterStream(promptText, imageBase64, screenContextPrompt, config, conversationHistory, isRoastMode, onChunkCallback);
  }

  // 5. Custom / Groq Endpoint
  return await queryCustomStream(promptText, imageBase64, screenContextPrompt, config, conversationHistory, isRoastMode, onChunkCallback);
}

async function queryOpenRouterStream(userPrompt, imageBase64, screenContextPrompt, config, conversationHistory = [], isRoastMode = false, onChunkCallback = () => {}) {
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
    const isCanned = CANNED_LOOP_PATTERNS.some((p) => p.test(turn.text));
    if (isCanned) continue;

    messages.push({
      role: turn.role === 'model' || turn.role === 'assistant' ? 'assistant' : 'user',
      content: turn.text
    });
  }

  const userContent = `${userPrompt || 'Respond directly.'} ${screenContextPrompt || ''}`.trim();
  messages.push({
    role: 'user',
    content: !isRoastMode
      ? `[SYSTEM DIRECTIVE: Roast Mode is strictly OFF. Speak with warmth and politeness.] ${userContent}`
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

async function queryCustomStream(userPrompt, imageBase64, screenContextPrompt, config, conversationHistory = [], isRoastMode = false, onChunkCallback = () => {}) {
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
    const isCanned = CANNED_LOOP_PATTERNS.some((p) => p.test(turn.text));
    if (isCanned) continue;

    messages.push({
      role: turn.role === 'model' || turn.role === 'assistant' ? 'assistant' : 'user',
      content: turn.text
    });
  }

  const userContent = `${userPrompt || 'Process context.'} ${screenContextPrompt || ''}`.trim();
  messages.push({
    role: 'user',
    content: !isRoastMode
      ? `[SYSTEM DIRECTIVE: Roast Mode is strictly OFF. Speak with warmth and politeness.] ${userContent}`
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
