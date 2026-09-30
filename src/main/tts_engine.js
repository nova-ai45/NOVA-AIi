const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

// Active synthesis tracker for zero-overlap cancellation
let activeTTSInstance = null;
let activeReadableStream = null;
let isCurrentCancelled = false;

/**
 * Strips markdown symbols, asterisks, brackets, and emojis so neural voices
 * read dialogues smoothly with clean pronunciation.
 */
function cleanTextForSpeech(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  return rawText
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/#+\s+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/[\u{1F600}-\u{1F6FF}\u{1F300}-\u{1F5FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
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
 * Generates an MP3 audio buffer using Microsoft Edge Neural Voices.
 * Default: "hi-IN-SwaraNeural" (Warm, natural Hindi/Urdu voice).
 * Fallback: "ur-PK-UzmaNeural" or "en-IN-NeerjaNeural".
 */
async function synthesizeNeuralSpeech(rawText, preferredVoice = 'hi-IN-SwaraNeural') {
  const text = cleanTextForSpeech(rawText);
  if (!text) return null;

  cancelActiveTTS();
  isCurrentCancelled = false;

  const voicesToTry = [
    preferredVoice || 'hi-IN-SwaraNeural',
    'hi-IN-SwaraNeural',
    'ur-PK-UzmaNeural',
    'en-IN-NeerjaNeural'
  ];

  const uniqueVoices = [...new Set(voicesToTry)];

  for (const voiceName of uniqueVoices) {
    if (isCurrentCancelled) return null;

    try {
      const audioBase64 = await new Promise((resolve, reject) => {
        const tts = new MsEdgeTTS();
        activeTTSInstance = tts;

        tts
          .setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
          .then(() => {
            if (isCurrentCancelled) {
              return resolve(null);
            }

            const streamResult = tts.toStream(text, {
              pitch: '+0Hz',
              rate: '+0%',
              volume: '+0%'
            });

            const stream = streamResult.audioStream || streamResult;
            activeReadableStream = stream;
            const chunks = [];

            stream.on('data', (chunk) => {
              if (isCurrentCancelled) {
                try {
                  stream.destroy();
                } catch (_) {}
                return resolve(null);
              }
              chunks.push(chunk);
            });

            const handleFinish = () => {
              activeReadableStream = null;
              activeTTSInstance = null;
              if (isCurrentCancelled) return resolve(null);
              if (chunks.length > 0) {
                resolve(Buffer.concat(chunks).toString('base64'));
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
      console.warn(`[EdgeTTS] Voice "${voiceName}" failed, trying next fallback:`, err.message);
    }
  }

  return null;
}

module.exports = {
  synthesizeNeuralSpeech,
  cancelActiveTTS
};
