const { desktopCapturer } = require('electron');

// Always-on silent background screenshot stream cache
let cachedScreenBase64 = null;
let isCaptureInProgress = false;
let streamInterval = null;

/**
 * Captures primary display frame safely without prompting user permission modals.
 */
async function capturePrimaryDisplay() {
  if (isCaptureInProgress) return cachedScreenBase64;
  isCaptureInProgress = true;

  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 },
      fetchWindowIcons: false
    });

    if (sources && sources.length > 0) {
      const primary = sources[0];
      const jpegBuffer = primary.thumbnail.toJPEG(75);
      cachedScreenBase64 = jpegBuffer.toString('base64');
    }
  } catch (error) {
    console.error('Vision streaming frame capture warning:', error.message);
  } finally {
    isCaptureInProgress = false;
  }

  return cachedScreenBase64;
}

/**
 * Starts continuous background screen perception loop.
 * Automatically samples the display every 2 seconds into a live memory buffer.
 */
function initAlwaysOnVisionStream(intervalMs = 2000) {
  if (streamInterval) clearInterval(streamInterval);
  capturePrimaryDisplay();
  streamInterval = setInterval(() => {
    capturePrimaryDisplay();
  }, intervalMs);
}

/**
 * Instantaneous access to latest screen buffer for multi-modal AI router.
 */
async function getLatestScreenContext() {
  if (cachedScreenBase64) {
    return cachedScreenBase64;
  }
  return await capturePrimaryDisplay();
}

/**
 * Direct explicit capture export for backwards compatibility.
 */
async function captureActiveDisplay() {
  return await capturePrimaryDisplay();
}

// Automatically initiate continuous vision sampling upon main process boot
initAlwaysOnVisionStream();

module.exports = {
  captureActiveDisplay,
  getLatestScreenContext,
  initAlwaysOnVisionStream
};
