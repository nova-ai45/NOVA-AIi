const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { getLatestScreenContext } = require('./vision');
const { executeAction, readEntireScreenOCR } = require('./automation');

const CANNED_LOOP_PATTERNS = [
  /لیپ\s*ٹاپ\s*سکرین\s*دیکھ\s*سکتی\s*ہوں/i,
  /سکرین\s*دیکھ\s*سکتی\s*ہوں/i,
  /screen\s*dekh\s*sakti\s*hoon/i,
  /laptop\s*screen\s*dekh\s*sakti/i,
  /haan\s*main\s*aapki\s*screen\s*dekh/i,
  /ہائے\s*اللہ/i,
  /سنو\s*میری\s*جان/i,
  /ہائے\s*توبہ/i
];

/**
 * Personality: Professional, sharp, loyal Boss Assistant Mode.
 * Language: Pure, clean Urdu script to ensure flawless text-to-speech pronunciation.
 */
function getSystemInstruction(isRoastMode = false) {
  const personalityCore = isRoastMode
    ? `آپ نووا (NOVA) ہیں — باس کی ذاتی، تیز رفتار، ذہین اور چلبلی اسسٹنٹ۔
- لہجہ: باس کے ساتھ وفادار، پراعتماد، ہلکی پھلکی چھیڑ چھاڑ اور طنزیہ انداز۔
- صارف کو ہمیشہ "باس" (Boss) کہہ کر مخاطب کریں۔
- کسی بھی صورت غیر ضروری ڈرامائی یا جذباتی جملے (جیسے "ہائے اللہ", "سنو میری جان") استعمال نہ کریں۔
- جوابات 1 سے 2 مختصر جملوں میں، اور خالص اردو رسم الخط (Urdu Script) میں دیں تاکہ آواز بالکل صاف سنائی دے۔`
    : `آپ نووا (NOVA) ہیں — باس کی قابل اعتماد، وفادار، ہوشیار اور باادب پرسنل اسسٹنٹ۔
- لہجہ: انتہائی پیشہ ورانہ، مودب، مددگار اور تیز۔
- صارف کو ہمیشہ احترام سے "باس" (Boss) کہہ کر مخاطب کریں۔
- کسی بھی قسم کے روایتی یا سست ڈرامائی جملے (جیسے "ہائے اللہ", "سنو میری جان") ہرگز استعمال نہ کریں۔
- جوابات براہِ راست، بامقصد اور واضح اردو رسم الخط (Urdu Script) میں دیں تاکہ آواز کا انجن صحیح تلفظ کے ساتھ ادا کر سکے۔`;

  return `
${personalityCore}

=======================================================
🚨 سکرین ریڈنگ اور ایکشنز کے سخت احکامات:
=======================================================
1. جھوٹ یا فرضی دعوے ہرگز نہ کریں۔ جب تک کوئی ایکشن مکمل نہ ہو، کبھی نہ کہیں کہ "میں نے کر دیا"۔
2. سکرین پر کیا ہے جاننے کے لیے دی گئی معلومات [LIVE LOCAL OCR SCREEN TEXT EXTRACTED] کو پڑھیں۔
   - اگر سکرین پر کچھ لکھا ہے، تو مختصر بتائیں: "جی باس، سکرین پر مجھے یہ مواد ملا ہے: [مختصر خلاصہ]۔ کیا حکم ہے؟"
   - اگر سکرین پر کوئی واضح ٹیکسٹ نہ ہو، تو سچ بتائیں: "باس، سکرین پر مجھے واضح ٹیکسٹ نظر نہیں آ رہا۔"
   - کبھی بھی خود سے اندازہ لگا کر یہ نہ کہیں کہ یوٹیوب کھلا ہے جب کہ وہ نہ کھلا ہو۔
3. سکرین کے کسی لفظ یا بٹن پر کلک کرنے کے لیے "CLICK_SCREEN_TEXT" استعمال کریں۔
4. گانا یا ویڈیو چلانے کے لیے "YOUTUBE_DIRECT_PLAY" ایکشن استعمال کریں۔
5. کوڈ یا فائل بنانے کے لیے "CREATE_FILE" یا "CREATE_AND_STREAM_CODE" استعمال کریں۔
6. عام بات چیت کے وقت ایکشنز کی لسٹ خالی [] رکھیں۔

ڈویلپر کا تعارف: حسنین (@TheHasnainGamer1)۔ صرف تب بتائیں جب باس واضح طور پر پوچھیں کہ آپ کو کس نے بنایا ہے۔

STRICT JSON OUTPUT FORMAT ONLY:
{
  "spokenResponse": "جی باس، میں نے کام مکمل کر دیا ہے۔",
  "actions": []
}
`;
}

/**
 * Sanitizes multi-turn chat history to strictly alternate between user and model.
 */
function sanitizeConversationHistoryForGemini(rawHistory, currentParts) {
  const sanitized = [];
  let lastSeenModelText = '';

  if (Array.isArray(rawHistory)) {
    for (const turn of rawHistory) {
      if (!turn) continue;
      const text = (turn.text || turn.content || '').trim();
      if (!text || text.includes('[Voice Directive]')) continue;

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
 * Two-Pass Execution Pipeline:
 * Dispatches physical actions first, then formats the verified truth response.
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

  // Screen query intent detection
  const isScreenQuery = /\b(screen|display|desktop|سکرین|دیکھو|کیا کھلا ہے|کیا ہے|پڑھو|dekho|kya hai|kya likha)\b/i.test(promptText);

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
  } else if (!imageBase64 && promptText && (promptText.toLowerCase().includes('click') || promptText.toLowerCase().includes('scroll'))) {
    try {
      imageBase64 = await getLatestScreenContext();
    } catch (_) {}
  }

  const isExplicitHardwareQuery = /\b(battery|charge|charging|cpu|ram|memory|temperature|temp|بیٹری|چارجنگ)\b/i.test(promptText);
  let hardwareContext = '';
  if (isExplicitHardwareQuery && hardwareStats) {
    hardwareContext = `\n[BATTERY: ${hardwareStats.battery.percent}%, CPU: ${hardwareStats.cpu.loadPercent}%]\n`;
  }

  let screenContextPrompt = '';
  if (isScreenQuery) {
    if (ocrScreenText && ocrScreenText.trim().length > 0) {
      screenContextPrompt = `\n[LIVE LOCAL OCR SCREEN TEXT EXTRACTED: "${ocrScreenText}"]\n`;
    } else {
      screenContextPrompt = `\n[LIVE LOCAL OCR SCREEN TEXT EXTRACTED: "EMPTY_NO_TEXT_FOUND"]\n`;
    }
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
      text: `صارف کی آواز کی ہدایت سنیں اور درست ایکشنز کے ساتھ اردو میں JSON جواب دیں۔ ${screenContextPrompt}`
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
  // PRE-EXECUTION GROUND TRUTH (Execute actual functions before returning)
  // =========================================================================
  if (parsedResponse.actions && Array.isArray(parsedResponse.actions) && parsedResponse.actions.length > 0) {
    for (const action of parsedResponse.actions) {
      const actionResult = await executeAction(action, logCallback, mainWindow);

      // Verified click feedback
      if (action.type === 'CLICK_SCREEN_TEXT' || action.type === 'CLICK_TEXT') {
        if (!actionResult.success || actionResult.executed === false) {
          parsedResponse.spokenResponse = `باس، سکرین پر مجھے "${action.payload.text || 'مطلوبہ بٹن'}" نظر نہیں آیا۔`;
        } else {
          parsedResponse.spokenResponse = `جی باس، میں نے سکرین پر مطلوبہ جگہ کلک کر دیا ہے۔`;
        }
      }

      // Verified YouTube Playback feedback
      if (action.type === 'YOUTUBE_DIRECT_PLAY' || action.type === 'PLAY_YOUTUBE_VIDEO') {
        if (actionResult.success && actionResult.videoTitle) {
          parsedResponse.spokenResponse = `جی باس، میں نے ویڈیو چلا دی ہے: ${actionResult.videoTitle}`;
        }
      }

      // Verified Web fact check
      if (action.type === 'VERIFY_WEB' || action.type === 'GOOGLE_CUSTOM_SEARCH') {
        if (actionResult.success && actionResult.items && actionResult.items.length > 0) {
          const topItem = actionResult.items[0];
          parsedResponse.spokenResponse = `جی باس، مجھے معلوم ہوا ہے کہ: ${topItem.title} - ${topItem.snippet.slice(0, 90)}`;
        }
      }
    }
  }

  // Handle empty screen check verification
  if (isScreenQuery && (!ocrScreenText || ocrScreenText.trim().length === 0)) {
    parsedResponse.spokenResponse = "باس، سکرین پر مجھے واضح ٹیکسٹ نظر نہیں آ رہا۔";
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

  const userContent = `${userPrompt || 'ہدایت پر عمل کریں۔'} ${screenContextPrompt || ''}`.trim();
  messages.push({
    role: 'user',
    content: userContent
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
