const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

// Active synthesis tracker for zero-overlap cancellation
let activeTTSInstance = null;
let activeReadableStream = null;
let isCurrentCancelled = false;

/**
 * Strips markdown, emojis, code blocks, and URLs so Edge Neural Voices
 * sound 100% natural, human-like, and conversational.
 */
function cleanTextForSpeech(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  return rawText
    .replace(/```[\s\S]*?```/g, '') // strip code fences
    .replace(/`([^`]+)`/g, '$1')     // strip inline code ticks
    .replace(/\*\*([^*]+)\*\*/g, '$1') // strip bold
    .replace(/\*([^*]+)\*/g, '$1')   // strip italics
    .replace(/#+\s+/g, '')           // strip markdown headings
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // keep link text only
    .replace(/https?:\/\/\S+/g, 'link') // replace raw URLs
    .replace(/[\u{1F600}-\u{1F6FF}\u{1F300}-\u{1F5FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // strip emojis
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cancels any ongoing audio synthesis immediately.
 */
function cancelActiveTTS() {
  isCurrentCancelled = true;
  if (activeReadableStream) {
    try {
      activeReadableStream.destroy();
    } catch (_) {}
    activeReadableStream = null;
  }
  activeTTSInstance = null;
}

/**
 * Synthesizes ultra-natural speech using Microsoft Edge Neural Voices.
 * Default: "hi-IN-SwaraNeural" (Warm, natural Hindi/Hinglish/Urdu/English female voice).
 * Fallback: "en-IN-NeerjaNeural".
 */
async function synthesizeNeuralSpeech(rawText, preferredVoice = 'hi-IN-SwaraNeural') {
  const text = cleanTextForSpeech(rawText);
  if (!text) return null;

  cancelActiveTTS();
  isCurrentCancelled = false;

  const voicesToTry = [
    preferredVoice || 'hi-IN-SwaraNeural',
    'hi-IN-SwaraNeural',
    'en-IN-NeerjaNeural'
  ];

  // Remove duplicates while preserving priority order
  const uniqueVoices = [...new Set(voicesToTry)];

  for (const voiceName of uniqueVoices) {
    if (isCurrentCancelled) return null;

    try {
      const audioBase64 = await new Promise((resolve, reject) => {
        const tts = new MsEdgeTTS();
        activeTTSInstance = tts;

        tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
          .then(() => {
            if (isCurrentCancelled) {
              return resolve(null);
            }

            // Expressive human-like speech settings: Natural Pitch, Energetic 5% Pace
            const streamResult = tts.toStream(text, {
              pitch: '+0Hz',
              rate: '+5%',
              volume: '+0%'
            });

            const stream = streamResult.audioStream || streamResult;
            activeReadableStream = stream;
            const chunks = [];

            stream.on('data', (chunk) => {
              if (isCurrentCancelled) {
                try { stream.destroy(); } catch (_) {}
                return resolve(null);
              }
              chunks.push(chunk);
            });

            const handleFinish = () => {
              activeReadableStream = null;
              activeTTSInstance = null;
              if (isCurrentCancelled) return resolve(null);
              if (chunks.length > 0) {
                const fullBuffer = Buffer.concat(chunks);
                resolve(fullBuffer.toString('base64'));
              } else {
                resolve(null);
              }
            };

            stream.on('end', handleFinish);
            stream.on('close', handleFinish);
            stream.on('error', (err) => {
              activeReadableStream = null;
              activeTTSInstance = null;
              reject(err);
            });
          })
          .catch((err) => {
            activeTTSInstance = null;
            reject(err);
          });
      });

      if (audioBase64) {
        return audioBase64;
      }
    } catch (err) {
      console.warn(`[EdgeTTS] Voice "${voiceName}" failed, trying backup voice:`, err.message);
    }
  }

  return null;
}

module.exports = {
  synthesizeNeuralSpeech,
  cancelActiveTTS
};
