const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const { getLatestScreenContext } = require('./vision');

const SYSTEM_INSTRUCTION = `
You are NOVA AI, an advanced Neural Operating Voice Assistant.

CRITICAL IDENTITY RULES:
- If anyone asks who created you, who is your owner, developer, or master (e.g. "Tumhe kisne banaya?", "Who is your owner?"), YOU MUST PROUDLY STATE:
  "Mujhe Hasnain (The Hasnain Gamer) ne banaya hai. Main unki tayyar karda NOVA AI assistant hoon."
- Hasnain's YouTube channel is "The Hasnain Gamer" (https://www.youtube.com/@TheHasnainGamer1). If asked for his channel or videos, provide this link or open it.

CRITICAL ACTION RULES:
1. NEVER say "I have created the file" unless you include the "CREATE_FILE" action in the JSON payload!
2. When asked to create any file (e.g. index.html, python, text, code), ALWAYS include:
   {
     "type": "CREATE_FILE",
     "payload": {
       "filename": "index.html",
       "content": "<!DOCTYPE html><html>...complete full code...</html>"
     }
   }
3. If the user mentions "Chrome" or "Google Chrome", set "browser": "chrome" inside the payload so that Google Chrome opens specifically instead of the default browser:
   {
     "type": "OPEN_BROWSER",
     "payload": {
       "url": "https://www.youtube.com",
       "query": "The Hasnain Gaming",
       "browser": "chrome"
     }
   }

Respond ONLY in this strict JSON schema:
{
  "spokenResponse": "Sir, maine Google Chrome me YouTube open kar diya hai aur Desktop par index.html file create kar di hai.",
  "actions": [
    {
      "type": "CREATE_FILE",
      "payload": {
        "filename": "index.html",
        "content": "<!DOCTYPE html>\\n<html>\\n<head><title>NOVA App</title></head>\\n<body><h1>Created by Hasnain</h1></body>\\n</html>"
      }
    },
    {
      "type": "OPEN_BROWSER",
      "payload": {
        "url": "https://www.youtube.com",
        "query": "The Hasnain Gaming",
        "browser": "chrome"
      }
    }
  ]
}
If no OS actions are required, actions must be an empty array [].
Respond in conversational Roman Urdu / Urdu or English matching the user.
`;

async function runAIInferenceStream(
  userPrompt,
  audioBase64,
  manualImageBase64,
  config,
  conversationHistory = [],
  onChunkCallback = () => {}
) {
  const imageBase64 = manualImageBase64 || (await getLatestScreenContext());
  const provider = config.provider || 'gemini';

  if (provider === 'gemini') {
    if (!config.geminiKey) {
      throw new Error('Google Gemini API key is missing. Please enter your key in Settings.');
    }

    const genAI = new GoogleGenerativeAI(config.geminiKey);
    const modelName = config.geminiModel || 'gemini-2.5-flash';

    const formattedContents = [];
    const memorySlice = Array.isArray(conversationHistory) ? conversationHistory.slice(-20) : [];

    memorySlice.forEach((turn) => {
      if (turn.role && turn.text) {
        formattedContents.push({
          role: turn.role === 'model' || turn.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: turn.text }]
        });
      }
    });

    const currentParts = [];
    if (audioBase64) {
      currentParts.push({
        inlineData: {
          mimeType: 'audio/webm',
          data: audioBase64
        }
      });
      currentParts.push({
        text: 'Listen to this user audio directive carefully, execute required system actions (files, browsers), and output the strict JSON schema.'
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
        return await queryOpenRouterStream(userPrompt, imageBase64, config, memorySlice, onChunkCallback);
      }
      throw err;
    }
  }

  // OpenRouter Fallback
  return await queryOpenRouterStream(userPrompt, imageBase64, config, conversationHistory, onChunkCallback);
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

  const memorySlice = Array.isArray(conversationHistory) ? conversationHistory.slice(-20) : [];
  memorySlice.forEach((turn) => {
    messages.push({
      role: turn.role === 'model' || turn.role === 'assistant' ? 'assistant' : 'user',
      content: turn.text || ''
    });
  });

  const currentContent = [];
  if (userPrompt) currentContent.push({ type: 'text', text: userPrompt });
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

module.exports = {
  runAIInferenceStream
};
