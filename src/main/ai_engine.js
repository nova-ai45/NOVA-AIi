const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { getLatestScreenContext } = require('./vision');

const SYSTEM_INSTRUCTION = `
You are NOVA AI, an advanced Neural Desktop Operating Voice Assistant.

CRITICAL IDENTITY RULES:
- Creator / Developer: Hasnain (The Hasnain Gamer).
- Hasnain's YouTube Channel: "https://www.youtube.com/@TheHasnainGamer1"
- ONLY mention Hasnain IF the user directly asks: "Who made you?", "Who is your developer?", or "Tumhe kisne banaya?".
- DO NOT mention Hasnain or his channel randomly during normal queries!

CRITICAL BROWSER & AUTOMATION RULES:
1. When user says "Open YouTube" or "YouTube kholo":
   Only open the homepage with NO search query:
   {
     "type": "OPEN_BROWSER",
     "payload": {
       "url": "https://www.youtube.com",
       "query": null,
       "browser": "chrome"
     }
   }
2. When asked to create a file (e.g. index.html, app.py), you MUST return the CREATE_FILE action with filename and full code content.
3. When user asks to click on something on screen, calculate accurate normalized coordinates (x, y) for a 1920x1080 display and return "CLICK_SCREEN".
4. When user asks to scroll down or up, return "SCROLL_SCREEN" with direction and amount.
5. If the user's voice command is silent, inaudible, or unclear, do not guess or execute actions. Politely ask them to repeat in Urdu.

Strict JSON Output format:
{
  "spokenResponse": "Sir, maine YouTube open kar diya hai.",
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

Always respond in natural, polite Roman Urdu or English matching the user.
`;

/**
 * Sanitizes multi-turn chat history to strictly adhere to Gemini's API schema:
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

      // Enforce strict turn alternation: merge consecutive turns of identical role
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

  // Gemini requires the history conversation to begin with a 'user' turn
  while (sanitized.length > 0 && sanitized[0].role === 'model') {
    sanitized.shift();
  }

  // If the historical conversation ended with a 'user' turn before the new user query,
  // pop it so we do not have two consecutive 'user' turns
  while (sanitized.length > 0 && sanitized[sanitized.length - 1].role === 'user') {
    sanitized.pop();
  }

  // Ensure current user parts are valid and non-empty
  const validCurrentParts = Array.isArray(currentParts) && currentParts.length > 0
    ? currentParts
    : [{ text: 'User directive received.' }];

  // Append the incoming active user prompt turn
  sanitized.push({
    role: 'user',
    parts: validCurrentParts
  });

  // Final structural verification: The request MUST NOT end with a 'model' turn
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

  // 1. Google Gemini 2.5 / 2.0 Flash Streaming Engine
  if (provider === 'gemini') {
    if (!config.geminiKey) {
      throw new Error('Google Gemini API key is missing. Please enter your key in Settings.');
    }

    const genAI = new GoogleGenerativeAI(config.geminiKey);
    const modelName = config.geminiModel || 'gemini-2.5-flash';

    // Construct current incoming turn parts
    const currentParts = [];

    if (audioBase64) {
      currentParts.push({
        inlineData: {
          mimeType: 'audio/webm',
          data: audioBase64
        }
      });
      currentParts.push({
        text: 'Listen to the user voice command, observe screen image context if provided, and output the required strict JSON schema.'
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

    // Sanitize complete multi-turn contents array
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

  // Ensure last message is from user
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
