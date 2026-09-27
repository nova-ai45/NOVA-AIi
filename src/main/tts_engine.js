const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

// Strict In-Memory TTS Audio Queue & Deduplication Manager
let activeTTSInstance = null;
let lastSpokenText = '';
let lastSpokenTimestamp = 0;

/**
 * Cancels and purges any currently active speech synthesis streaming.
 */
function cancelActiveTTS() {
  if (activeTTSInstance) {
    try {
      activeTTSInstance = null;
    } catch (_) {}
  }
}

/**
 * Synthesizes high-fidelity speech with queue control and strict deduplication.
 * Prevents identical errors or repetitive phrases from stacking.
 */
async function synthesizeAudioStream(text, voice = 'en-US-AriaNeural') {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const cleanText = text.trim();
  const now = Date.now();

  // Deduplicate identical error or status messages within a 4-second window
  if (cleanText === lastSpokenText && now - lastSpokenTimestamp < 4000) {
    return null;
  }

  // Cancel prior active synthesis to avoid overlapping responses
  cancelActiveTTS();

  lastSpokenText = cleanText;
  lastSpokenTimestamp = now;

  return new Promise(async (resolve, reject) => {
    try {
      const tts = new MsEdgeTTS();
      activeTTSInstance = tts;

      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

      const streamResult = tts.toStream(cleanText);
      const readable = streamResult.audioStream || streamResult;
      const chunks = [];

      readable.on('data', (chunk) => {
        if (activeTTSInstance !== tts) {
          readable.destroy();
          return resolve(null);
        }
        chunks.push(chunk);
      });

      const handleDone = () => {
        if (activeTTSInstance !== tts) {
          return resolve(null);
        }
        if (chunks.length > 0) {
          const audioBuffer = Buffer.concat(chunks);
          activeTTSInstance = null;
          resolve(audioBuffer.toString('base64'));
        } else {
          resolve(null);
        }
      };

      readable.on('close', handleDone);
      readable.on('end', handleDone);

      readable.on('error', (err) => {
        activeTTSInstance = null;
        reject(err);
      });
    } catch (err) {
      activeTTSInstance = null;
      reject(err);
    }
  });
}

module.exports = {
  synthesizeAudioStream,
  cancelActiveTTS
};
