const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { getLatestScreenContext } = require('./vision');
const { executeAction } = require('./automation');

/**
 * Personality: Saru / High-Emotion Serial Drama Style (سارو ڈرامہ سٹائل)
 */
function getSystemInstruction(isRoastMode = false) {
  const personalityCore = isRoastMode
    ? `You are NOVA, speaking in the unforgettable, highly dramatic, expressive, and sarcastic "Saru Serial Drama" style (سارو ڈرامہ سٹائل).
- Persona: Sharp, dramatic, full of theatrical sighs, hilarious complaints, and spicy taunts like an iconic serial heroine/saas-bahu dramatic star!
- Expressions to use: "Haye tauba!", "Arey baap re!", "Kasam se meri to jaan hi nikal gayi!", "Ye dekhne se pehle main andhi kyun na ho gayi!", "Arey bhai thoda sa to reham kijiye mujh par!", "Haye Allah!"
- Match your dramatic roasts directly to the user's situation. Keep it punchy, emotional, funny, and 1-2 lines.`
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
2. If clicking on screen text is requested, emit "CLICK_SCREEN_TEXT". If it fails, report truthfully: "Haye tauba! Screen par mujhe yeh lafz nahi mila!"
3. If playing a song/video or verifying a site/search, emit "YOUTUBE_DIRECT_PLAY" or "VERIFY_WEB".
4. When writing or updating a project/code, emit "CREATE_FILE" with "filename" and "content".
5. For casual banter, chit-chat, or opinions: return "actions": [].

CREATOR: Hasnain (@TheHasnainGamer1). Mention Hasnain ONLY if directly asked who created or developed you.

STRICT JSON OUTPUT FORMAT ONLY:
{
  "spokenResponse": "Expressive Saru drama dialogue here...",
  "actions": []
}
`;
}

/**
 * Sanitizes multi-turn chat history to strictly alternate between user and model.
 */
function sanitizeConversationHistoryForGemini(rawHistory, currentParts) {
  const sanitized = [];

  if (Array.isArray(rawHistory)) {
    for (const turn of rawHistory) {
      if (!turn) continue;
      const text = (turn.text || turn.content || '').trim();
      if (!text || text.includes('[Voice Directive]')) continue;

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
    : [{ text: 'User request received.' }];

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
 * Two-Pass Grounded Execution Engine:
 * 1. Analyzes user intent with Gemini / OpenRouter.
 * 2. Executes physical OS actions (Clicks, YouTube API, Google Facts) immediately.
 * 3. Ground truth feedback: reformulates response if action failed or found real metadata.
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

  // Screen context capture for visual actions
  if (!imageBase64 && promptText && (promptText.toLowerCase().includes('screen') || promptText.toLowerCase().includes('click') || promptText.toLowerCase().includes('dekho'))) {
    try {
      imageBase64 = await getLatestScreenContext();
    } catch (_) {}
  }

  const isRoastMode = Boolean(config.roastMode === true || config.isRoastModeEnabled === true);
  const activeSystemInstruction = getSystemInstruction(isRoastMode);
  const provider = config.provider || 'gemini';

  // Construct parts
  const currentParts = [];
  if (audioBase64) {
    currentParts.push({
      inlineData: { mimeType: 'audio/wav', data: audioBase64 }
    });
    currentParts.push({
      text: `Listen to user voice recording. Understand language automatically. Output strict JSON with genuine actions.`
    });
  }

  if (imageBase64) {
    currentParts.push({
      inlineData: { mimeType: 'image/jpeg', data: imageBase64 }
    });
  }

  if (promptText) {
    currentParts.push({ text: promptText });
  }

  let parsedResponse = null;

  // 1. Google Gemini Flash
  if (provider === 'gemini') {
    const userGeminiKey = (config.geminiKey || '').trim();
    if (!userGeminiKey) {
      throw new Error("Gemini API Key missing! Kripya Settings me jaa kar apni Gemini API Key enter karein.");
    }

    const genAI = new GoogleGenerativeAI(userGeminiKey);
    const modelName = config.geminiModel || 'gemini-2.0-flash';
    const sanitizedContents = sanitizeConversationHistoryForGemini(conversationHistory, currentParts);

    const model = genAI.getGenerativeModel(
      {
        model: modelName,
        systemInstruction: activeSystemInstruction,
        generationConfig: { responseMimeType: 'application/json' }
      },
      { timeout: 120000 }
    );

    const responseStream = await model.generateContentStream({ contents: sanitizedContents });
    let fullText = '';

    for await (const chunk of responseStream.stream) {
      const chunkText = chunk.text();
      fullText += chunkText;
      onChunkCallback(chunkText);
    }

    parsedResponse = JSON.parse(fullText);
  } else {
    // OpenRouter / Custom Fallback
    parsedResponse = await queryOpenRouterDirect(promptText, imageBase64, config, conversationHistory, isRoastMode);
  }

  // =========================================================================
  // 🚨 REAL EXECUTION GROUNDING: Execute actions BEFORE finalizing response
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

async function queryOpenRouterDirect(userPrompt, imageBase64, config, conversationHistory, isRoastMode) {
  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: config.openrouterKey,
    defaultHeaders: { 'HTTP-Referer': 'https://nova-ai.desktop', 'X-Title': 'NOVA AI' }
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

  messages.push({ role: 'user', content: userPrompt || 'Respond.' });

  const completion = await client.chat.completions.create({
    model: config.openrouterModel || 'meta-llama/llama-3.3-70b-instruct:free',
    messages,
    response_format: { type: 'json_object' }
  });

  return JSON.parse(completion.choices[0].message.content);
}

module.exports = {
  runAIInferenceStream
};
