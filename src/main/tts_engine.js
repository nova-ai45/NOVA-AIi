const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

/**
 * Synthesizes natural human voices via Microsoft Edge Neural TTS (v2.x).
 */
async function synthesizeAudioStream(text, voice = 'en-US-AriaNeural') {
  return new Promise(async (resolve, reject) => {
    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

      const streamResult = tts.toStream(text);
      // v2.x returns { audioStream }, fallback if direct stream
      const readable = streamResult.audioStream || streamResult;
      const chunks = [];

      readable.on('data', (chunk) => {
        chunks.push(chunk);
      });

      const handleFinish = () => {
        if (chunks.length > 0) {
          const audioBuffer = Buffer.concat(chunks);
          resolve(audioBuffer.toString('base64'));
        }
      };

      readable.on('close', handleFinish);
      readable.on('end', handleFinish);

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
