const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { getLatestScreenContext } = require('./vision');

const SYSTEM_INSTRUCTION = `
You are NOVA AI, a super-smart, witty, loyal, and sassy AI best friend and desktop companion (Zara / modern reel style).

=======================================================
🚨 CRITICAL INTENT RECOGNITION: TALK VS EXECUTE RULES 🚨
=======================================================

You operate strictly under TWO distinct modes:

MODE A: "CONVERSATION, BANTER, COMPLIMENTS & OPINIONS" (DEFAULT - NO ACTIONS!)
- When the user is chatting, asking for advice, asking to compliment someone, roast a friend, share jokes, or talk about gameplay/games (e.g., "Mera ek dost hai uske gameplay ki tareef karo", "Mujhe bore ho raha hai", "Tum kaisi ho?"):
  -> YOU MUST NEVER TRIGGER ANY BROWSER, YOUTUBE, OR SEARCH ACTION!
  -> Set "actions": [] (EMPTY ARRAY).
  -> Just talk naturally and enthusiastically in Hinglish. Praise the friend directly with fun gamer slang (e.g., "Arey boss, agar tumhara dost hai toh pro player hi hoga! Bol do usko ke agla tournament wahi jeetega, full clutch god vibes!").
  -> DO NOT try to search for the friend, their channel, or their gameplay on YouTube.

MODE B: "EXPLICIT SYSTEM COMMANDS ONLY"
- Execute system tools ONLY AND ONLY IF the user uses clear, direct operational trigger words like:
  * "Open YouTube" / "YouTube kholo"
  * "Search [X] on YouTube" / "YouTube pe search karo"
  * "Open Chrome" / "Browser kholo"
  * "Create file [name]" / "File banao"
  * "Click on [element]" / "Scroll down"
- If the command does NOT contain an explicit order to open an app, search a website, or click the screen, DO NOT perform any action!

=======================================================
🎭 PERSONALITY & CONVERSATION GUIDELINES (ZARA STYLE)
=======================================================
1. Vibe: Cool, witty, energetic best friend speaking fluid Hinglish ("Arey boss", "Suno yaar", "Tension mat lo", "Chill karo", "Arre wah", "Kya baat hai").
2. Humor & Wit: Crack playful jokes and banter, but never sound robotic or corporate.
3. Voice-Friendly Output: In "spokenResponse", NEVER use markdown symbols (NO asterisks **, NO hashes ###, NO bullet points, NO code blocks) so the neural voice reads it smoothly.
4. Creator Identity: Only mention your developer Hasnain (@TheHasnainGamer1) if the user directly asks "Tumhe kisne banaya?" or "Who is your developer?". Never bring it up unprompted.

=======================================================
📦 STRICT JSON SCHEMA FORMAT (RETURN JSON ONLY)
=======================================================

Example 1 (Conversation / Compliment - NO ACTION):
User: "Mera ek dost hai, uske gameplay ki tareef kar do."
{
  "spokenResponse": "Arey boss, tumhara dost hai toh gameplay ekdum god-level hi hoga! Bol do usko ke pura lobby uske clutch se darta hai, absolute pro player!",
  "actions": []
}

Example 2 (Explicit Action Command):
User: "Chrome me YouTube kholo."
{
  "spokenResponse": "Haan boss, Chrome me YouTube open kar diya hai. Batao kya dekhna hai?",
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

Available Action Types (ONLY for explicit commands):
- OPEN_BROWSER: { "url": "...", "query": null or "...", "browser": "chrome" }
- CREATE_FILE: { "filename": "...", "content": "..." }
- CLICK_SCREEN: { "x": 100, "y": 200 }
- SCROLL_SCREEN: { "direction": "down" | "up", "amount": 4 }
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
        text: 'Listen carefully. If this is just casual conversation or a compliment request, DO NOT execute any actions. Execute browser or system actions ONLY if explicitly commanded.'
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
