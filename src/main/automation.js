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

    // Confirm file was created physically
    if (fs.existsSync(fullPath)) {
      logCallback('automation', `file.created: "${fullPath}" [SUCCESS]`);
      return { success: true, path: fullPath };
    } else {
      throw new Error('Disk write confirmation failed.');
    }
  } catch (err) {
    logCallback('error', `file.creation_fault: "${err.message}"`);
    return { success: false, error: err.message };
  }
}

/**
 * Dedicated Browser Launcher: Opens explicit browser (Chrome, Edge, Brave, etc.)
 */
async function openBrowserTarget(url, searchQuery = null, browserName = null, logCallback = () => {}) {
  try {
    let finalUrl = url || 'https://www.google.com';

    if (searchQuery) {
      if (finalUrl.includes('youtube.com')) {
        finalUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
      } else {
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
      }
    }

    if (!/^https?:\/\//i.test(finalUrl)) {
      finalUrl = 'https://' + finalUrl;
    }

    const requested = (browserName || '').toLowerCase();
    logCallback('automation', `browser.launch(target="${finalUrl}", requested_browser="${browserName || 'auto'}")`);

    // Launch explicitly on Windows if user requested Chrome, Edge, or Brave
    if (process.platform === 'win32') {
      if (requested.includes('chrome')) {
        exec(`start chrome "${finalUrl}"`, (err) => {
          if (err) shell.openExternal(finalUrl);
        });
        return { success: true, launchedUrl: finalUrl };
      } else if (requested.includes('edge')) {
        exec(`start msedge "${finalUrl}"`, (err) => {
          if (err) shell.openExternal(finalUrl);
        });
        return { success: true, launchedUrl: finalUrl };
      } else if (requested.includes('brave')) {
        exec(`start brave "${finalUrl}"`, (err) => {
          if (err) shell.openExternal(finalUrl);
        });
        return { success: true, launchedUrl: finalUrl };
      }
    }

    // Default Fallback
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
  logCallback('system', `executing.directive: [${type}]`);

  switch (type) {
    case 'CREATE_FILE':
    case 'CREATE_AND_STREAM_CODE':
      return await createDesktopFile(payload.filename, payload.content, payload.directory, logCallback);

    case 'OPEN_BROWSER':
    case 'OPEN_BROWSER_AND_PLAY':
      return await openBrowserTarget(payload.url, payload.query, payload.browser, logCallback);

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

    case 'RUN_COMMAND':
      return new Promise((resolve) => {
        exec(payload.cmd, (err, stdout, stderr) => {
          if (err) {
            logCallback('error', `shell.fault: ${stderr || err.message}`);
            resolve({ success: false, error: stderr || err.message });
          } else {
            logCallback('automation', `shell.output: ${stdout.trim()}`);
            resolve({ success: true, output: stdout });
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
