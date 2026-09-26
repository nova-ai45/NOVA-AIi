const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

/**
 * Synthesizes ultra high quality natural human voices via Microsoft Edge Neural TTS.
 * 100% Free, no API tokens or billing required.
 */
async function synthesizeAudioStream(text, voice = 'en-US-AriaNeural') {
  return new Promise(async (resolve, reject) => {
    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

      const readable = tts.toStream(text);
      const chunks = [];

      readable.on('data', (chunk) => {
        chunks.push(chunk);
      });

      readable.on('end', () => {
        const audioBuffer = Buffer.concat(chunks);
        resolve(audioBuffer.toString('base64'));
      });

      readable.on('error', (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  synthesizeAudioStream
};
