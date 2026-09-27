/**
 * Lightweight native TTS engine bridge.
 * The broken MsEdgeTTS socket dependency is removed to prevent:
 * "TypeError: Cannot read properties of undefined (reading 'audio')"
 * All text-to-speech synthesis is handled with 0ms latency by the Web Speech API in the renderer.
 */

function cancelActiveTTS() {
  // Handled cleanly via window.speechSynthesis.cancel() in the renderer
}

async function synthesizeAudioStream(text, voice = 'default') {
  // Returns clean signal to let renderer run native Web Speech Synthesis
  return null;
}

module.exports = {
  synthesizeAudioStream,
  cancelActiveTTS
};
