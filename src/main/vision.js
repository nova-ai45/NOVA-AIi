const { desktopCapturer } = require('electron');

/**
 * Zero-dependency Full-Screen Frame Capture via Electron Core API.
 * Captures the primary display and converts it to Base64 JPEG data.
 */
async function captureActiveDisplay() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    });

    if (!sources || sources.length === 0) {
      throw new Error('No monitor display surfaces detected on host machine.');
    }

    // Capture primary screen (index 0)
    const primarySource = sources[0];
    const image = primarySource.thumbnail;
    const jpegBuffer = image.toJPEG(85);
    return jpegBuffer.toString('base64');
  } catch (error) {
    throw new Error(`Screen perceptual failure: ${error.message}`);
  }
}

module.exports = {
  captureActiveDisplay
};
