const { desktopCapturer } = require('electron');

let cachedScreenBase64 = null;
let isCaptureInProgress = false;

/**
 * Captures primary display frame in 1920x1080 for pinpoint coordinate accuracy.
 */
async function captureActiveDisplay() {
  if (isCaptureInProgress) return cachedScreenBase64;
  isCaptureInProgress = true;

  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
      fetchWindowIcons: false
    });

    if (sources && sources.length > 0) {
      const primary = sources[0];
      const jpegBuffer = primary.thumbnail.toJPEG(80);
      cachedScreenBase64 = jpegBuffer.toString('base64');
    }
  } catch (error) {
    console.error('Vision capture error:', error.message);
  } finally {
    isCaptureInProgress = false;
  }

  return cachedScreenBase64;
}

async function getLatestScreenContext() {
  return await captureActiveDisplay();
}

module.exports = {
  captureActiveDisplay,
  getLatestScreenContext
};
