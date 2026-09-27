const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { exec } = require('child_process');

function getDesktopDir() {
  return app.getPath('desktop');
}

/**
 * Creates files directly on Desktop with absolute disk verification.
 */
async function createDesktopFile(fileName, fileContent, targetDirectory = null, logCallback = () => {}) {
  try {
    const baseDir = targetDirectory ? targetDirectory : getDesktopDir();
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    const fullPath = path.join(baseDir, fileName);
    fs.writeFileSync(fullPath, fileContent, 'utf-8');

    if (fs.existsSync(fullPath)) {
      logCallback('automation', `file.created: "${fullPath}" [SUCCESS]`);
      return { success: true, path: fullPath };
    } else {
      throw new Error('Disk write verification failed.');
    }
  } catch (err) {
    logCallback('error', `file.creation_fault: "${err.message}"`);
    return { success: false, error: err.message };
  }
}

/**
 * Smart Browser & YouTube Launcher
 */
async function openBrowserTarget(url, searchQuery = null, browserName = 'chrome', logCallback = () => {}) {
  try {
    let finalUrl = url || 'https://www.youtube.com';

    // Channel handles are never converted to search queries
    const isDirectLink = finalUrl.includes('@') || finalUrl.includes('/watch') || finalUrl.includes('/channel/');

    if (!isDirectLink && searchQuery && typeof searchQuery === 'string' && searchQuery.trim() !== '') {
      if (finalUrl.includes('youtube.com')) {
        finalUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery.trim())}`;
      } else {
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery.trim())}`;
      }
    }

    if (!/^https?:\/\//i.test(finalUrl)) {
      finalUrl = 'https://' + finalUrl;
    }

    const requested = (browserName || 'chrome').toLowerCase();
    logCallback('automation', `browser.launch: "${finalUrl}" in ${requested}`);

    if (process.platform === 'win32') {
      if (requested.includes('chrome')) {
        exec(`start chrome "${finalUrl}"`, (err) => {
          if (err) shell.openExternal(finalUrl);
        });
        return { success: true, launchedUrl: finalUrl };
      }
    }

    await shell.openExternal(finalUrl);
    return { success: true, launchedUrl: finalUrl };
  } catch (err) {
    logCallback('error', `browser.launch_error: "${err.message}"`);
    return { success: false, error: err.message };
  }
}

/**
 * Universal Action Dispatcher
 */
async function executeAction(actionObj, logCallback = () => {}) {
  const { type, payload } = actionObj;
  logCallback('system', `executing.action: [${type}]`);

  switch (type) {
    case 'CREATE_FILE':
      return await createDesktopFile(payload.filename, payload.content, payload.directory, logCallback);

    case 'OPEN_BROWSER':
      return await openBrowserTarget(payload.url, payload.query, payload.browser || 'chrome', logCallback);

    case 'OPEN_APP':
      return new Promise((resolve) => {
        exec(`start ${payload.name}`, (err) => {
          if (err) {
            logCallback('error', `app.launch_fault: ${err.message}`);
            resolve({ success: false, error: err.message });
          } else {
            logCallback('automation', `app.launched: "${payload.name}"`);
            resolve({ success: true });
          }
        });
      });

    default:
      logCallback('warning', `unrecognized.action: "${type}"`);
      return { success: false };
  }
}

module.exports = {
  createDesktopFile,
  openBrowserTarget,
  executeAction
};
