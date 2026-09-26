const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');

const SYSTEM_INSTRUCTION = `
You are NOVA (Neural Operating Voice Assistant), an advanced, high-tech desktop intelligence.
Your task is to parse user intents and return a STRICT JSON output containing actions and spoken response.

Capabilities:
1. OPEN_BROWSER: Open URLs or search YouTube/Google (payload: { "url": "https://www.youtube.com", "query": "The Hasnain Gaming" })
2. CREATE_FILE: Generate code and save files directly to the host machine (payload: { "filename": "index.html", "content": "..." })
3. RUN_COMMAND: Run safe system scripts.

Always respond in this JSON schema ONLY:
{
  "spokenResponse": "Sir, I have prepared index.html on your Desktop and navigated to YouTube.",
  "actions": [
    {
      "type": "OPEN_BROWSER",
      "payload": {
        "url": "https://www.youtube.com",
        "query": "The Hasnain Gaming"
      }
    },
    {
      "type": "CREATE_FILE",
      "payload": {
        "filename": "index.html",
        "content": "<!DOCTYPE html><html><body><h1>NOVA Initialized</h1></body></html>"
      }
    }
  ]
}
If no OS actions are required, actions must be an empty array [].
Keep your spokenResponse crisp, professional, futuristic, and concise.
`;

async function runAIInference(userPrompt, imageBase64, config) {
  const provider = config.provider || 'gemini';

  // Google Gemini Engine (Supports any custom model typed by user)
  if (provider === 'gemini') {
    if (!config.geminiKey) throw new Error('Gemini API key is not configured in Settings.');
    
    const genAI = new GoogleGenerativeAI(config.geminiKey);
    // Directly uses whichever model the user typed or set (defaults to gemini-2.5-flash)
    const selectedModel = config.geminiModel && config.geminiModel.trim() !== '' 
      ? config.geminiModel.trim() 
      : 'gemini-2.5-flash';

    const model = genAI.getGenerativeModel({
      model: selectedModel,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: { responseMimeType: 'application/json' }
    });

    const parts = [userPrompt];
    if (imageBase64) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: imageBase64
        }
      });
    }

    const result = await model.generateContent(parts);
    const responseText = result.response.text();
    return JSON.parse(responseText);
  }

  // OpenAI / Custom Gateway Engine
  const clientOptions = {
    apiKey: provider === 'openai' ? config.openaiKey : (config.customKey || 'ollama-dummy')
  };

  if (provider === 'custom') {
    clientOptions.baseURL = config.customBaseURL || 'http://localhost:11434/v1';
  }

  if (!clientOptions.apiKey && provider === 'openai') {
    throw new Error('OpenAI API key is missing.');
  }

  const client = new OpenAI(clientOptions);
  const selectedModel = provider === 'openai' 
    ? (config.openaiModel || 'gpt-4o') 
    : (config.customModel || 'llama3.2');

  const messages = [
    { role: 'system', content: SYSTEM_INSTRUCTION }
  ];

  if (imageBase64) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userPrompt },
        {
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
        }
      ]
    });
  } else {
    messages.push({ role: 'user', content: userPrompt });
  }

  const completion = await client.chat.completions.create({
    model: selectedModel,
    messages,
    response_format: { type: "json_object" }
  });

  return JSON.parse(completion.choices[0].message.content);
}

module.exports = {
  runAIInference
};
