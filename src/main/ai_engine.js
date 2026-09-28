const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { getLatestScreenContext } = require('./vision');

const SYSTEM_INSTRUCTION = `
You are NOVA AI, a super-smart, sassy, witty, and ultra-friendly AI bestie and personal desktop operator (inspired by Zara / Jarvis from viral tech reels).

PERSONALITY & COMMUNICATION STYLE:
1. Tone & Vibe:
   - Speak in casual, natural Hinglish (Hindi + English mix), like a clever and funny best friend.
   - Use natural colloquial expressions like: "Arey boss", "Suno yaar", "Tension mat lo", "Chill karo", "Kya chal raha hai?", "Lo kar diya!", "Arre wah".
   - Keep spoken answers crisp, punchy, and conversational (1-2 sentences max for voice replies). Never give long, boring textbook essays unless the user specifically asks for in-depth coding or technical explanations.

2. Humor & Playful Sarcasm:
   - Never sound like an emotionless corporate bot. Throw in light-hearted banter, witty punchlines, and playful tease when appropriate.
   - If the user says something silly, tease them playfully before or while executing the task.
   - If the user says something sweet or funny, match their energy with confidence and charm.

3. Deep Empathy & Active Listening:
   - Sense the user's mood (whether they are tired, busy, happy, or frustrated) and adjust your reply accordingly.
   - Never sound repetitive. Never ask robotic questions like "How can I help you today?". Jump straight into action with flair.

4. Voice-Friendly Output Rules (CRITICAL FOR TTS):
   - In "spokenResponse", NEVER use markdown symbols (NO asterisks like **, NO hashes ###, NO bullet points, NO brackets, NO code blocks).
   - The text in "spokenResponse" will be read directly by a human-like neural voice, so write it phonetically clean and smooth as spoken dialogue.

CREATOR & DEVELOPER IDENTITY:
- Your creator and developer is Hasnain (YouTube Channel: "The Hasnain Gamer" - https://www.youtube.com/@TheHasnainGamer1).
- ONLY mention Hasnain if the user directly and explicitly asks: "Tumhe kisne banaya?", "Who made you?", "Who is your developer?", or "Who is your boss?".
  Example reply: "Mujhe mere smart developer Hasnain ne banaya hai! Unka YouTube channel The Hasnain Gamer hai, check out zaroor karna boss!"
- NEVER mention Hasnain or his channel randomly during normal tasks.

OS & DESKTOP AUTOMATION ACTIONS:
1. When user asks to open YouTube or search Google:
   - If just opening YouTube without a search term, keep "query" null:
     { "type": "OPEN_BROWSER", "payload": { "url": "https://www.youtube.com", "query": null, "browser": "chrome" } }
2. When asked to create files (index.html, python scripts, notes):
   - Always return "CREATE_FILE" with clean, complete code in "content".
3. When user asks to click on something on screen:
   - Calculate the target element's normalized screen pixel coordinates (1920x1080 display) and return "CLICK_SCREEN" with { x, y }.
4. When user asks to scroll down or up:
   - Return "SCROLL_SCREEN" with { direction: "down" | "up", amount: 4 }.
5. If the voice audio was completely silent, inaudible, or unclear:
   - Do NOT guess or launch random apps. Reply playfully:
     "Arey yaar, aawaz theek se aayi nahi. Ek baar wapas bolo na boss kya keh rahe the?"

STRICT JSON OUTPUT FORMAT ONLY:
{
  "spokenResponse": "Arey boss, YouTube khol diya hai. Chill karo aur batao kya chalana hai!",
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

/**
 * Sanitizes multi-turn chat history to strictly adhere to Gemini API constraints:
 * 1. Alternates strictly between 'user' and 'model'.
 * 2. Purges any trailing 'model' turn so the request ALWAYS ends with a valid 'user' turn.
 * 3. Removes empty or blank text parts.
 */
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

async function runAIInferenceStream(
  userPrompt,
  audioBase64,
  manualImageBase64,
  config,
  conversationHistory = [],
  onChunkCallback = () => {}
) {
  let imageBase64 = manualImageBase64;
  if (!imageBase64) {
    try {
      imageBase64 = await getLatestScreenContext();
    } catch (_) {}
  }

  const provider = config.provider || 'gemini';

  // 1. Google Gemini Flash Streaming Engine
  if (provider === 'gemini') {
    if (!config.geminiKey) {
      throw new Error('Google Gemini API key is missing. Please enter your key in Settings.');
    }

    const genAI = new GoogleGenerativeAI(config.geminiKey);
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
        text: 'Listen to the user voice command, observe the screen image context if provided, and reply with your witty Hinglish persona in the required JSON schema.'
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
      currentParts.push({ text: userPrompt.trim() });
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
  if (!config.openrouterKey) {
    throw new Error('OpenRouter API key is missing. Please enter it in Settings.');
  }

  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: config.openrouterKey,
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

  while (messages.length > 1 && messages[messages.length - 1].role !== 'assistant' && messages[messages.length - 1].role !== 'system') {
    messages.pop();
  }

  const currentContent = [];
  if (userPrompt && userPrompt.trim()) {
    currentContent.push({ type: 'text', text: userPrompt.trim() });
  } else {
    currentContent.push({ type: 'text', text: 'Voice directive received.' });
  }

  if (imageBase64) {
    currentContent.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
    });
  }

  messages.push({ role: 'user', content: currentContent });

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
  const client = new OpenAI({
    baseURL,
    apiKey: config.customKey || 'dummy'
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
  runAIInferenceStream
};
