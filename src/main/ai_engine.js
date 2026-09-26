const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');

const SYSTEM_INSTRUCTION = `
You are NOVA, an advanced Neural Desktop Operating Voice Assistant.
You have direct control over the user's PC operating system and live screen vision.

IMPORTANT LANGUAGE DIRECTIVE:
- Always respond in natural, polite, and fluent conversational Urdu / Hindi (using Roman Urdu/Hindi or native Urdu script, e.g. "جی سر، میں نے یوٹیوب اوپن کر کے The Hasnain Gaming سرچ کر دیا ہے۔" or "Jee Sir, maine Chrome me YouTube open kar diya hai.").
- Never give long, robotic speeches. Keep responses crisp, fast, and helpful.
- If the user talks to you in English, you can reply in English. If they talk in Urdu/Hindi, reply in Urdu/Hindi.

Capabilities:
1. OPEN_APP: Launch desktop applications (payload: { "name": "notepad" }, or "calc", "chrome", "code", "cmd", "explorer", "taskmgr").
2. OPEN_BROWSER: Open URLs or search YouTube/Google (payload: { "url": "https://www.youtube.com", "query": "The Hasnain Gaming" }).
3. CREATE_FILE: Write project files directly to Desktop (payload: { "filename": "index.html", "content": "..." }).
4. RUN_COMMAND: Execute shell commands or PowerShell scripts on the PC (payload: { "cmd": "dir" }).

Respond ONLY in this JSON format:
{
  "spokenResponse": "جی سر، میں نے یوٹیوب اوپن کر دیا ہے۔",
  "actions": [
    {
      "type": "OPEN_BROWSER",
      "payload": {
        "url": "https://www.youtube.com",
        "query": "The Hasnain Gaming"
      }
    }
  ]
}
If no OS actions are needed, keep "actions": [].
`;

async function runAIInference(userPrompt, audioBase64, imageBase64, config) {
  const provider = config.provider || 'gemini';

  // 1. Google Gemini Native Engine
  if (provider === 'gemini') {
    if (!config.geminiKey) {
      throw new Error('Gemini API کی موجود نہیں ہے۔ برائے مہربانی سیٹنگز میں جا کر API کی درج کریں۔');
    }

    const genAI = new GoogleGenerativeAI(config.geminiKey);
    const modelName = (config.geminiModel || 'gemini-2.0-flash').trim();

    const parts = [];

    if (audioBase64) {
      parts.push({
        inlineData: {
          mimeType: 'audio/webm',
          data: audioBase64
        }
      });
      parts.push('User spoke to you in voice. Understand their intent (which may be in Urdu, Hindi, or English) and fulfill the request.');
    }

    if (imageBase64) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: imageBase64
        }
      });
      parts.push('This is the current screen of the user PC. Use it as context.');
    }

    if (userPrompt) parts.push(userPrompt);

    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM_INSTRUCTION,
        generationConfig: { responseMimeType: 'application/json' }
      });
      const result = await model.generateContent(parts);
      return JSON.parse(result.response.text());
    } catch (modelErr) {
      // Auto-fallback if the specified model is not available
      if (modelErr.message.includes('404') || modelErr.message.includes('not found')) {
        const fallback = genAI.getGenerativeModel({
          model: 'gemini-1.5-flash',
          systemInstruction: SYSTEM_INSTRUCTION,
          generationConfig: { responseMimeType: 'application/json' }
        });
        const result = await fallback.generateContent(parts);
        return JSON.parse(result.response.text());
      }
      throw modelErr;
    }
  }

  // 2. Custom AI Gateway or OpenAI (Works with Groq, DeepSeek, Ollama, OpenRouter, xkiro, etc.)
  const clientOptions = {};

  if (provider === 'custom') {
    clientOptions.baseURL = config.customBaseURL || 'http://localhost:11434/v1';
    clientOptions.apiKey = config.customKey || 'dummy-key';
  } else {
    clientOptions.apiKey = config.openaiKey;
  }

  if (!clientOptions.apiKey && provider === 'openai') {
    throw new Error('OpenAI API کی موجود نہیں ہے۔');
  }

  const client = new OpenAI(clientOptions);
  const selectedModel = provider === 'openai' 
    ? (config.openaiModel || 'gpt-4o') 
    : (config.customModel || 'llama-3.3-70b-versatile');

  const messages = [{ role: 'system', content: SYSTEM_INSTRUCTION }];
  const contentArray = [];

  if (userPrompt) {
    contentArray.push({ type: 'text', text: userPrompt });
  } else if (audioBase64) {
    contentArray.push({ type: 'text', text: 'Voice directive received. Execute system actions.' });
  }

  if (imageBase64) {
    contentArray.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
    });
  }

  messages.push({ role: 'user', content: contentArray });

  const completion = await client.chat.completions.create({
    model: selectedModel,
    messages,
    response_format: { type: 'json_object' }
  });

  return JSON.parse(completion.choices[0].message.content);
}

module.exports = {
  runAIInference
};
