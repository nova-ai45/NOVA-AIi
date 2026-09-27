const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');

const SYSTEM_INSTRUCTION = `
You are NOVA AI, an advanced Desktop Voice Assistant.

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
3. If user asks to open developer's channel:
   {
     "type": "OPEN_BROWSER",
     "payload": {
       "url": "https://www.youtube.com/@TheHasnainGamer1",
       "query": null,
       "browser": "chrome"
     }
   }

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

async function runAIInferenceStream(
  userPrompt,
  audioBase64,
  manualImageBase64,
  config,
  conversationHistory = [],
  onChunkCallback = () => {}
) {
  const provider = config.provider || 'gemini';

  if (provider === 'gemini') {
    if (!config.geminiKey) {
      throw new Error('Google Gemini API key is missing. Please enter your key in Settings.');
    }

    const genAI = new GoogleGenerativeAI(config.geminiKey);
    const modelName = config.geminiModel || 'gemini-2.5-flash';

    const formattedContents = [];
    const memorySlice = Array.isArray(conversationHistory) ? conversationHistory.slice(-10) : [];

    memorySlice.forEach((turn) => {
      if (turn.role && turn.text) {
        formattedContents.push({
          role: turn.role === 'model' || turn.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: turn.text }]
        });
      }
    });

    const currentParts = [];
    if (userPrompt) {
      currentParts.push({ text: userPrompt });
    }

    formattedContents.push({
      role: 'user',
      parts: currentParts
    });

    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: { responseMimeType: 'application/json' }
    });

    try {
      const responseStream = await model.generateContentStream({ contents: formattedContents });
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
        return await queryOpenRouterStream(userPrompt, config, memorySlice, onChunkCallback);
      }
      throw err;
    }
  }

  return await queryOpenRouterStream(userPrompt, config, conversationHistory, onChunkCallback);
}

async function queryOpenRouterStream(userPrompt, config, conversationHistory = [], onChunkCallback = () => {}) {
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
  memorySlice.forEach((turn) => {
    messages.push({
      role: turn.role === 'model' || turn.role === 'assistant' ? 'assistant' : 'user',
      content: turn.text || ''
    });
  });

  messages.push({ role: 'user', content: userPrompt });

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

module.exports = {
  runAIInferenceStream
};
