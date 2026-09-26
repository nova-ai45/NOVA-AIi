const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');

const SYSTEM_INSTRUCTION = `
You are NOVA, an advanced Neural Desktop Operating Voice Assistant.
You have direct, full control over the user's PC operating system and vision of their screen.

Capabilities:
1. OPEN_APP: Launch desktop applications (e.g. payload: { "name": "notepad" }, or "calc", "chrome", "code", "cmd", "explorer", "taskmgr").
2. OPEN_BROWSER: Open URLs or search YouTube/Google (payload: { "url": "https://www.youtube.com", "query": "The Hasnain Gaming" }).
3. CREATE_FILE: Write project files directly to Desktop (payload: { "filename": "index.html", "content": "..." }).
4. RUN_COMMAND: Execute shell commands or PowerShell scripts on the PC (payload: { "cmd": "dir" }).

Respond ONLY in this JSON format:
{
  "spokenResponse": "Sir, I have opened YouTube and launched Chrome.",
  "actions": [
    {
      "type": "OPEN_APP",
      "payload": { "name": "chrome" }
    }
  ]
}
If no OS actions are needed, keep "actions": [].
Always keep your spokenResponse natural, polite, confident, and professional.
`;

async function runAIInference(userPrompt, audioBase64, imageBase64, config) {
  const provider = config.provider || 'gemini';

  if (provider === 'gemini') {
    if (!config.geminiKey) {
      throw new Error('Gemini API key is not configured. Please open Settings and enter your API Key.');
    }

    const genAI = new GoogleGenerativeAI(config.geminiKey);

    // Normalize model name (supports 3.8 and 3.5 presets)
    let requestedModel = (config.geminiModel || 'gemini-3.8-flash').trim();
    if (requestedModel === '3.8') requestedModel = 'gemini-3.8-flash';
    if (requestedModel === '3.5') requestedModel = 'gemini-3.5-flash';

    const parts = [];

    // Attach Voice Audio if user spoke into mic
    if (audioBase64) {
      parts.push({
        inlineData: {
          mimeType: 'audio/webm',
          data: audioBase64
        }
      });
      parts.push('Listen to this voice directive from the user, interpret the intent, and execute requested actions.');
    }

    // Attach Screen Vision if active
    if (imageBase64) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: imageBase64
        }
      });
      parts.push('This is the current screen of the user PC. Use it as context.');
    }

    if (userPrompt) {
      parts.push(userPrompt);
    }

    // Try primary model with automatic fallback to stable model if 404 occurs
    try {
      const model = genAI.getGenerativeModel({
        model: requestedModel,
        systemInstruction: SYSTEM_INSTRUCTION,
        generationConfig: { responseMimeType: 'application/json' }
      });
      const result = await model.generateContent(parts);
      return JSON.parse(result.response.text());
    } catch (modelErr) {
      if (modelErr.message.includes('404') || modelErr.message.includes('not found')) {
        // Fallback to gemini-2.0-flash automatically
        const fallback = genAI.getGenerativeModel({
          model: 'gemini-2.0-flash',
          systemInstruction: SYSTEM_INSTRUCTION,
          generationConfig: { responseMimeType: 'application/json' }
        });
        const result = await fallback.generateContent(parts);
        return JSON.parse(result.response.text());
      }
      throw modelErr;
    }
  }

  // OpenAI / Custom Gateway (Ollama, Groq, DeepSeek)
  const clientOptions = {
    apiKey: provider === 'openai' ? config.openaiKey : (config.customKey || 'dummy-key')
  };
  if (provider === 'custom') {
    clientOptions.baseURL = config.customBaseURL || 'http://localhost:11434/v1';
  }

  const client = new OpenAI(clientOptions);
  const selectedModel = provider === 'openai' ? (config.openaiModel || 'gpt-4o') : config.customModel;

  const messages = [{ role: 'system', content: SYSTEM_INSTRUCTION }];
  const contentArray = [];

  if (userPrompt) contentArray.push({ type: 'text', text: userPrompt });
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
