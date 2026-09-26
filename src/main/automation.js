const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { exec } = require('child_process');

function getDesktopDirectory() {
  return app.getPath('desktop');
}

/**
 * Creates files directly on PC Desktop
 */
async function createDesktopFile(fileName, fileContent, targetDirectory = null, logCallback = () => {}) {
  try {
    const baseDir = targetDirectory || getDesktopDirectory();
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    const fullPath = path.join(baseDir, fileName);
    fs.writeFileSync(fullPath, fileContent, 'utf-8');
    logCallback('automation', `Created file on Desktop: ${fileName}`);
    return { success: true, path: fullPath };
  } catch (err) {
    logCallback('error', `Failed to create file: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Launch Any Windows App (Notepad, Chrome, VS Code, Calc, Explorer, etc.)
 */
async function launchApplication(appName, logCallback = () => {}) {
  return new Promise((resolve) => {
    logCallback('automation', `Launching PC App: ${appName}`);
    exec(`start ${appName}`, (err) => {
      if (err) {
        logCallback('error', `Could not open ${appName}: ${err.message}`);
        resolve({ success: false, error: err.message });
      } else {
        logCallback('automation', `Successfully launched ${appName}`);
        resolve({ success: true });
      }
    });
  });
}

/**
 * Native Browser Launch & Auto Search
 */
async function openBrowserTarget(url, searchQuery = null, logCallback = () => {}) {
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

    logCallback('automation', `Navigating to: ${finalUrl}`);
    await shell.openExternal(finalUrl);
    return { success: true, launchedUrl: finalUrl };
  } catch (err) {
    logCallback('error', `Browser error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Universal OS Action Router
 */
async function executeAction(actionObj, logCallback = () => {}) {
  const { type, payload } = actionObj;
  logCallback('system', `Executing Directive: [${type}]`);

  switch (type) {
    case 'OPEN_APP':
      return await launchApplication(payload.name, logCallback);

    case 'OPEN_BROWSER':
      return await openBrowserTarget(payload.url, payload.query, logCallback);

    case 'CREATE_FILE':
      return await createDesktopFile(payload.filename, payload.content, payload.directory, logCallback);

    case 'RUN_COMMAND':
      return new Promise((resolve) => {
        exec(payload.cmd, (err, stdout) => {
          if (err) {
            logCallback('error', `Shell: ${err.message}`);
            resolve({ success: false, error: err.message });
          } else {
            logCallback('automation', `Output: ${stdout.trim()}`);
            resolve({ success: true, output: stdout });
          }
        });
      });

    default:
      logCallback('warning', `Unknown action: ${type}`);
      return { success: false };
  }
}

module.exports = {
  createDesktopFile,
  launchApplication,
  openBrowserTarget,
  executeAction
};
