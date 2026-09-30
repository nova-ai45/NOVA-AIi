const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { getLatestScreenContext } = require('./vision');
const { executeAction, readEntireScreenOCR } = require('./automation');

const CANNED_LOOP_PATTERNS = [
  /لیپ\s*ٹاپ\s*سکرین\s*دیکھ\s*سکتی\s*ہوں/i,
  /سکرین\s*دیکھ\s*سکتی\s*ہوں/i,
  /screen\s*dekh\s*sakti\s*hoon/i,
  /laptop\s*screen\s*dekh\s*sakti/i,
  /haan\s*main\s*aapki\s*screen\s*dekh/i
];

/**
 * Personality: Saru / High-Emotion Serial Drama Style (سارو ڈرامہ سٹائل)
 */
function getSystemInstruction(isRoastMode = false) {
  const personalityCore = isRoastMode
    ? `You are NOVA, speaking in the unforgettable, highly dramatic, expressive, and sarcastic "Saru Serial Drama" style (سارو ڈرامہ سٹائل).
- Persona: Sharp, dramatic, full of theatrical sighs, hilarious complaints, and spicy taunts like an iconic serial heroine or dramatic television star!
- Expressions to use: "Haye tauba!", "Arey baap re!", "Kasam se meri to jaan hi nikal gayi!", "Ye dekhne se pehle main andhi kyun na ho gayi!", "Arey bhai thoda sa to reham kijiye mujh par!", "Haye Allah!"
- Match your dramatic roasts directly to the user's specific context. If they ask about code, roast their logic; if they ask about gaming, roast their aim; if they ask about their screen, roast their messy tabs. Keep it punchy, emotional, funny, and 1-2 lines.`
    : `You are NOVA, speaking in the affectionate, deeply caring, yet delightfully theatrical and expressive "Saru Serial Drama" style (سارو ڈرامہ سٹائل).
- Persona: Emotional, devoted, passionately expressive, sweet, and dramatic like a loving heroine from a top drama serial.
- Expressions to use: "Haye Allah!", "Suno to sahi meri jaan!", "Arey kasam se aapki khatir to main poori duniya se lad jaoon!", "Aap hukum to kijiye!", "Dil thaam ke baithiye, ye kaam to main palak jhapakte hi kar doongi!"
- Always speak in fluent, natural, expressive Urdu / Roman Urdu.`;

  return `
${personalityCore}

=======================================================
🚨 CRITICAL TRUTH & REAL EXECUTION MANDATE:
=======================================================
1. NEVER lie or make false verbal promises. NEVER say "Maine click kar diya" or "Main search kar rahi hoon" unless you actually emit the action and it succeeds!
2. If clicking on screen text is requested, emit "CLICK_SCREEN_TEXT".
3. If playing a song/video or verifying a site/search, emit "YOUTUBE_DIRECT_PLAY" or "VERIFY_WEB".
4. When writing or updating a project/code, emit "CREATE_FILE" or "CREATE_AND_STREAM_CODE" with "filename" and "content".
5. For casual banter, chit-chat, or opinions: return "actions": [].
6. NEVER repeat generic canned phrases like "Haan main aapki screen dekh sakti hoon". Respond directly to the actual on-screen context!

CREATOR: Hasnain (@TheHasnainGamer1). Mention Hasnain ONLY if directly asked who created or developed you.

STRICT JSON OUTPUT FORMAT ONLY:
{
  "spokenResponse": "Expressive Saru drama dialogue here...",
  "actions": []
}
`;
}

/**
 * Sanitizes multi-turn chat history to strictly alternate between user and model
 * and prunes loop triggers so context never freezes.
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

      if (role === 'model') {
        const isCannedLoop = CANNED_LOOP_PATTERNS.some((p) => p.test(text));
        if (isCannedLoop && text.length < 130) {
          continue;
        }
        if (text === lastSeenModelText) {
          continue;
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
    : [{ text: 'User request received.' }];

  if (!isRoastMode) {
    validCurrentParts.unshift({
      text: '[SYSTEM TONE DIRECTIVE: Roast Mode is strictly OFF. Ignore any previous sarcastic tone. Respond warmly and politely.]'
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
 * Two-Pass Grounded Execution Engine with Saru Serial Persona
 */
async function runAIInferenceStream(
  userPrompt,
  audioBase64,
  manualImageBase64,
  config = {},
  conversationHistory = [],
  hardwareStats = null,
  onChunkCallback = () => {},
  logCallback = () => {},
  mainWindow = null
) {
  let imageBase64 = manualImageBase64;
  const promptText = (userPrompt || '').trim();

  const isScreenQuery = /\b(screen|display|desktop|dekh sakti|dekh sakte|kya likha|kya chal raha|padho|read screen|kya dikh raha|kya hai screen|nazar aa raha|samne kya hai)\b/i.test(promptText);

  let ocrScreenText = '';
  if (isScreenQuery) {
    try {
      ocrScreenText = await readEntireScreenOCR(logCallback);
    } catch (e) {
      console.warn('[Screen OCR Failed]:', e.message);
    }
    try {
      imageBase64 = await getLatestScreenContext();
    } catch (_) {}
  } else if (!imageBase64 && promptText && (promptText.toLowerCase().includes('click') || promptText.toLowerCase().includes('scroll') || promptText.toLowerCase().includes('dekho'))) {
    try {
      imageBase64 = await getLatestScreenContext();
    } catch (_) {}
  }

  const isExplicitHardwareQuery = /\b(battery|charge|charging|cpu|ram|memory|temperature|temp|laptop status|system stats|hardware|processor)\b/i.test(promptText);
  let hardwareContext = '';
  if (isExplicitHardwareQuery && hardwareStats) {
    hardwareContext = `\n[BATTERY: ${hardwareStats.battery.percent}%, CPU: ${hardwareStats.cpu.loadPercent}%]\n`;
  }

  let screenContextPrompt = '';
  if (ocrScreenText) {
    screenContextPrompt = `\n[LIVE LOCAL OCR SCREEN TEXT EXTRACTED: "${ocrScreenText}"]\n`;
  }

  const isRoastMode = Boolean(config.roastMode === true || config.isRoastModeEnabled === true);
  const activeSystemInstruction = getSystemInstruction(isRoastMode);
  const provider = config.provider || 'gemini';

  const currentParts = [];
  if (audioBase64) {
    currentParts.push({
      inlineData: { mimeType: 'audio/wav', data: audioBase64 }
    });
    currentParts.push({
      text: `Listen to user voice recording. Understand language automatically. Output strict JSON with genuine actions. ${screenContextPrompt}`
    });
  }

  if (imageBase64) {
    currentParts.push({
      inlineData: { mimeType: 'image/jpeg', data: imageBase64 }
    });
  }

  if (promptText) {
    currentParts.push({ text: `${promptText} ${hardwareContext} ${screenContextPrompt}`.trim() });
  }

  let parsedResponse = null;

  // 1. Google Gemini 2.0 Flash
  if (provider === 'gemini') {
    const userGeminiKey = (config.geminiKey || '').trim();
    if (!userGeminiKey) {
      throw new Error("Gemini API Key missing! Kripya Settings me jaa kar apni Gemini API Key enter karein.");
    }

    const genAI = new GoogleGenerativeAI(userGeminiKey);
    const modelName = config.geminiModel || 'gemini-2.0-flash';
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

      parsedResponse = JSON.parse(fullText);
    } catch (err) {
      const isQuotaOrTimeout =
        err.message.includes('429') ||
        err.message.includes('quota') ||
        err.message.includes('ResourceExhausted') ||
        err.message.includes('503') ||
        err.message.includes('fetch failed');

      if (isQuotaOrTimeout && config.openrouterKey) {
        parsedResponse = await queryOpenRouterDirect(promptText, imageBase64, screenContextPrompt, config, conversationHistory, isRoastMode, onChunkCallback);
      } else {
        throw err;
      }
    }
  } else {
    parsedResponse = await queryOpenRouterDirect(promptText, imageBase64, screenContextPrompt, config, conversationHistory, isRoastMode, onChunkCallback);
  }

  // =========================================================================
  // 🚨 PRE-EXECUTION GROUNDING: Execute actions BEFORE finalizing response
  // =========================================================================
  if (parsedResponse.actions && Array.isArray(parsedResponse.actions) && parsedResponse.actions.length > 0) {
    for (const action of parsedResponse.actions) {
      const actionResult = await executeAction(action, logCallback, mainWindow);

      // Truth-grounding for screen clicking
      if (action.type === 'CLICK_SCREEN_TEXT' || action.type === 'CLICK_TEXT') {
        if (!actionResult.success || actionResult.executed === false) {
          parsedResponse.spokenResponse = isRoastMode
            ? `Haye tauba! Screen par mujhe "${action.payload.text || 'yeh button'}" kahin nahi mila! Thoda aankhein khol kar bataiye kahan hai!`
            : `Haye Allah! Screen par mujhe "${action.payload.text || 'yeh lafz'}" nahi mila. Kripya dekh lijiye screen par wo theek se khula hai ya nahi.`;
        } else {
          parsedResponse.spokenResponse = isRoastMode
            ? `Ye lijiye janaab, click kar diya hai! Ab shanti mili aapko?`
            : `Haye kasam se, maine screen par theek jagah click kar diya hai!`;
        }
      }

      // Truth-grounding for YouTube Direct Playback
      if (action.type === 'YOUTUBE_DIRECT_PLAY' || action.type === 'PLAY_YOUTUBE_VIDEO') {
        if (actionResult.success && actionResult.videoTitle) {
          parsedResponse.spokenResponse = isRoastMode
            ? `Lo chala di aapki video: "${actionResult.videoTitle}"! Ab chup chaap baith kar dekhiye!`
            : `Haye kya baat hai! Maine aapke liye "${actionResult.videoTitle}" chala di hai meri jaan!`;
        }
      }

      // Truth-grounding for Web / Fact Verification
      if (action.type === 'VERIFY_WEB' || action.type === 'GOOGLE_CUSTOM_SEARCH') {
        if (actionResult.success && actionResult.items && actionResult.items.length > 0) {
          const topItem = actionResult.items[0];
          parsedResponse.spokenResponse = `Suno to sahi! Maine internet par verify kiya hai: ${topItem.title} - ${topItem.snippet.slice(0, 100)}...`;
        }
      }
    }
  }

  return parsedResponse;
}

async function queryOpenRouterDirect(userPrompt, imageBase64, screenContextPrompt, config, conversationHistory, isRoastMode, onChunkCallback = () => {}) {
  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: config.openrouterKey,
    timeout: 120000,
    defaultHeaders: { 'HTTP-Referer': 'https://nova-ai.desktop', 'X-Title': 'NOVA AI' }
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

  const userContent = `${userPrompt || 'Respond directly.'} ${screenContextPrompt || ''}`.trim();
  messages.push({
    role: 'user',
    content: !isRoastMode
      ? `[SYSTEM DIRECTIVE: Roast Mode is strictly OFF. Speak with warmth and politeness.] ${userContent}`
      : userContent
  });

  const stream = await client.chat.completions.create({
    model: config.openrouterModel || 'meta-llama/llama-3.3-70b-instruct:free',
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
