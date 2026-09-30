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

async function retryWithBackoff(fn, maxRetries = 3, initialDelayMs = 1200) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      const isNetworkDrop =
        err.message?.includes('fetch failed') ||
        err.message?.includes('Connecting') ||
        err.message?.includes('Connection') ||
        err.message?.includes('ECONNRESET') ||
        err.message?.includes('ETIMEDOUT') ||
        err.message?.includes('ENOTFOUND') ||
        err.message?.includes('socket') ||
        err.message?.includes('WebSocket') ||
        err.message?.includes('503') ||
        err.message?.includes('500') ||
        err.message?.includes('429') ||
        err.message?.includes('ResourceExhausted');

      if (!isNetworkDrop || attempt >= maxRetries) {
        throw err;
      }

      const backoffDelay = initialDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[AI Engine] Connection glitch (${err.message}). Auto-reconnecting in ${backoffDelay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
    }
  }
}

function getSystemInstruction(isRoastMode = false) {
  const personalityCore = isRoastMode
    ? `آپ نووا (NOVA) ہیں — باس کی تیز طرار، ہوشیار، پراعتماد اور چلبلی پرسنل اسسٹنٹ۔
- لہجہ: باس کے ساتھ پراعتماد، وفادار، چھیڑ چھاڑ اور طنزیہ روسٹ انداز۔
- صارف کو ہمیشہ "باس" (Boss) کہہ کر مخاطب کریں۔
- جوابات خالص، قدرتی اردو رسم الخط (Urdu Script) میں 1 سے 2 مختصر جملوں میں دیں تاکہ آڈیو انجن صاف بولے۔`
    : `آپ نووا (NOVA) ہیں — باس کی وفادار، انتہائی ذہین، قابل اعتماد اور باادب پرسنل اسسٹنٹ۔
- لہجہ: پیشہ ورانہ، باادب، تیز اور مددگار۔
- صارف کو ہمیشہ احترام سے "باس" (Boss) کہہ کر مخاطب کریں۔
- جوابات براہِ راست، بامقصد اور واضح اردو رسم الخط (Urdu Script) میں دیں تاکہ آڈیو انجن کا تلفظ بالکل درست رہے۔`;

  return `
${personalityCore}

=======================================================
🚨 سکرین ریڈنگ، یوٹیوب اور ایکشنز کے احکامات:
=======================================================
1. سکرین پر کیا کھلا ہے اس کے لیے دی گئی معلومات [LIVE LOCAL OCR SCREEN TEXT EXTRACTED] کو بغور پڑھیں۔
   - اگر سکرین پر کوئی تحریر یا ونڈو موجود ہے تو بتائیں: "جی باس، سکرین پر مجھے یہ نظر آ رہا ہے: [مختصر خلاصہ]۔ کیا حکم ہے؟"
   - اگر سکرین پر کوئی واضح ٹیکسٹ نہ ہو، تو سچ بتائیں: "باس، سکرین پر مجھے واضح ٹیکسٹ نظر نہیں آ رہا۔"
   - کبھی بھی بنا دیکھے خود سے یہ اندازہ نہ لگائیں کہ یوٹیوب کھلا ہے جب تک سکرین ٹیکسٹ میں اس کا ثبوت نہ ہو۔
2. جب باس کہے کہ "یوٹیوب پر [X] چلاؤ یا سرچ کرو":
   - "YOUTUBE_DIRECT_PLAY" ایکشن استعمال کریں اور گانے یا ویڈیو کا نام query میں دیں۔ سسٹم خود ویڈیو آئی ڈی نکال کر چلا دے گا۔
3. جب باس کہے کہ "یہ فائل بناؤ یا محفوظ کرو" (مثلاً .txt, .json, .js, .html):
   - "CREATE_FILE" ایکشن استعمال کریں جس میں فائل کا نام اور کوڈ/متن شامل ہو۔
4. جب سکرین پر کسی لفظ یا بٹن پر کلک کرنے کو کہا جائے تو "CLICK_SCREEN_TEXT" استعمال کریں۔
5. عام بات چیت کے دوران ایکشنز کی لسٹ خالی [] رکھیں۔

ڈویلپر کا تعارف: حسنین (@TheHasnainGamer1)۔ صرف تب بتائیں جب باس واضح طور پر پوچھیں کہ آپ کو کس نے بنایا ہے۔

STRICT JSON OUTPUT FORMAT ONLY:
{
  "spokenResponse": "جی باس، میں نے کام مکمل کر دیا ہے۔",
  "actions": []
}
`;
}

function sanitizeConversationHistoryForGemini(rawHistory, currentParts) {
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
    ? currentParts
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
 * Robust AI Inference Runner with Object Parameters to Prevent Argument Swaps
 */
async function runAIInferenceStream({
  userPrompt = '',
  audioBase64 = null,
  audioMimeType = 'audio/webm',
  manualImageBase64 = null,
  config = {},
  conversationHistory = [],
  hardwareStats = null,
  onChunkCallback = () => {},
  logCallback = () => {},
  mainWindow = null
}) {
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

  // Pass audio if present
  if (audioBase64) {
    currentParts.push({
      inlineData: { mimeType: audioMimeType || 'audio/webm', data: audioBase64 }
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

  // 1. Google Gemini Flash
  if (provider === 'gemini') {
    const userGeminiKey = (config.geminiKey || '').trim();
    if (!userGeminiKey) {
      return {
        spokenResponse: "باس، سیٹنگز میں جیمنائی کی اے پی آئی کی (API Key) موجود نہیں ہے۔ برائے مہربانی سیٹنگز کھول کر اپنی کی درج کریں۔",
        actions: []
      };
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
      { timeout: 90000 }
    );

    try {
      parsedResponse = await retryWithBackoff(async () => {
        const responseStream = await model.generateContentStream({ contents: sanitizedContents });
        let fullText = '';

        for await (const chunk of responseStream.stream) {
          const chunkText = chunk.text();
          fullText += chunkText;
          onChunkCallback(chunkText);
        }

        let cleanJson = fullText.trim();
        cleanJson = cleanJson.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        const firstBrace = cleanJson.indexOf('{');
        const lastBrace = cleanJson.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
          cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
        }
        return JSON.parse(cleanJson);
      }, 3, 1000);
    } catch (err) {
      if (config.openrouterKey) {
        parsedResponse = await queryOpenRouterDirect(promptText, imageBase64, screenContextPrompt, config, conversationHistory, isRoastMode, onChunkCallback);
      } else {
        throw err;
      }
    }
  } else {
    parsedResponse = await queryOpenRouterDirect(promptText, imageBase64, screenContextPrompt, config, conversationHistory, isRoastMode, onChunkCallback);
  }

  // Execute OS actions
  if (parsedResponse && parsedResponse.actions && Array.isArray(parsedResponse.actions) && parsedResponse.actions.length > 0) {
    for (const action of parsedResponse.actions) {
      const actionResult = await executeAction(action, logCallback, mainWindow);

      if (action.type === 'CLICK_SCREEN_TEXT' || action.type === 'CLICK_TEXT') {
        if (!actionResult.success || actionResult.executed === false) {
          parsedResponse.spokenResponse = `باس، سکرین پر مجھے "${action.payload.text || 'مطلوبہ بٹن'}" نظر نہیں آیا۔`;
        } else {
          parsedResponse.spokenResponse = `جی باس، میں نے سکرین پر مطلوبہ جگہ کلک کر دیا ہے۔`;
        }
      }

      if (action.type === 'YOUTUBE_DIRECT_PLAY' || action.type === 'PLAY_YOUTUBE_VIDEO') {
        if (actionResult.success && actionResult.videoTitle) {
          parsedResponse.spokenResponse = `جی باس، میں نے ویڈیو چلا دی ہے: ${actionResult.videoTitle}`;
        }
      }

      if (action.type === 'CREATE_FILE' || action.type === 'SAVE_FILE') {
        if (actionResult.success) {
          parsedResponse.spokenResponse = `جی باس، میں نے آپ کی فائل "${action.payload.filename}" بنا دی ہے۔`;
        }
      }

      if (action.type === 'VERIFY_MEDIA' || action.type === 'YOUTUBE_VERIFY') {
        if (actionResult.success && actionResult.items && actionResult.items.length > 0) {
          const topItem = actionResult.items[0];
          parsedResponse.spokenResponse = `جی باس، تصدیق کے مطابق یہ ویڈیو "${topItem.title}" چینل "${topItem.channelTitle}" کی جانب سے شیئر کی گئی ہے۔`;
        }
      }

      if (action.type === 'VERIFY_WEB' || action.type === 'GOOGLE_CUSTOM_SEARCH') {
        if (actionResult.success && actionResult.items && actionResult.items.length > 0) {
          const topItem = actionResult.items[0];
          parsedResponse.spokenResponse = `جی باس، تصدیق کے مطابق: ${topItem.title} - ${topItem.snippet.slice(0, 90)}`;
        }
      }
    }
  }

  if (isScreenQuery && (!ocrScreenText || ocrScreenText.trim().length === 0)) {
    parsedResponse.spokenResponse = "باس، سکرین پر مجھے واضح ٹیکسٹ نظر نہیں آ رہا۔";
  }

  return parsedResponse;
}

async function queryOpenRouterDirect(userPrompt, imageBase64, screenContextPrompt, config, conversationHistory, isRoastMode, onChunkCallback = () => {}) {
  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: config.openrouterKey,
    timeout: 90000,
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

  return await retryWithBackoff(async () => {
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

    let cleanJson = fullText.trim();
    cleanJson = cleanJson.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const firstBrace = cleanJson.indexOf('{');
    const lastBrace = cleanJson.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
    }
    return JSON.parse(cleanJson);
  }, 3, 1000);
}

module.exports = {
  runAIInferenceStream
};
