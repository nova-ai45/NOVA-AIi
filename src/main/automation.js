const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { exec } = require('child_process');

function getDesktopDirectory() {
  return app.getPath('desktop');
}

/**
 * Creates files safely on the host machine.
 */
async function createDesktopFile(fileName, fileContent, targetDirectory = null, logCallback = () => {}) {
  try {
    const baseDir = targetDirectory ? targetDirectory : getDesktopDirectory();
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    const fullPath = path.join(baseDir, fileName);
    fs.writeFileSync(fullPath, fileContent, 'utf-8');
    logCallback('automation', `File deployed to disk: ${fullPath}`);
    return { success: true, path: fullPath };
  } catch (err) {
    logCallback('error', `File generation failure: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Native cross-platform web navigation & query injection.
 */
async function openBrowserTarget(url, searchQuery = null, logCallback = () => {}) {
  try {
    let finalUrl = url;
    if (searchQuery) {
      if (url.includes('youtube.com')) {
        finalUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
      } else if (url.includes('google.com')) {
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
      } else {
        finalUrl = `${url.replace(/\/$/, '')}/search?q=${encodeURIComponent(searchQuery)}`;
      }
    }

    if (!/^https?:\/\//i.test(finalUrl)) {
      finalUrl = 'https://' + finalUrl;
    }

    logCallback('automation', `Initiating browser handshake: ${finalUrl}`);
    await shell.openExternal(finalUrl);

    // Optional Windows Keystroke automation via PowerShell
    if (process.platform === 'win32' && searchQuery && !url.includes('results?') && !url.includes('?q=')) {
      setTimeout(() => {
        const psScript = `
          Add-Type -AssemblyName System.Windows.Forms;
          Start-Sleep -Milliseconds 800;
          [System.Windows.Forms.SendKeys]::SendWait('${searchQuery.replace(/'/g, "''")}');
          [System.Windows.Forms.SendKeys]::SendWait('{ENTER}');
        `;
        exec(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`);
      }, 1500);
    }

    return { success: true, launchedUrl: finalUrl };
  } catch (err) {
    logCallback('error', `Browser automation exception: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Universal Action Dispatcher
 */
async function executeAction(actionObj, logCallback = () => {}) {
  const { type, payload } = actionObj;
  logCallback('system', `Executing Directive: [${type}]`);

  switch (type) {
    case 'CREATE_FILE':
      return await createDesktopFile(payload.filename, payload.content, payload.directory, logCallback);

    case 'OPEN_BROWSER':
      return await openBrowserTarget(payload.url, payload.query, logCallback);

    case 'RUN_COMMAND':
      return new Promise((resolve) => {
        logCallback('system', `Shell Command: ${payload.cmd}`);
        exec(payload.cmd, (err, stdout, stderr) => {
          if (err) {
            logCallback('error', `Shell Error: ${stderr || err.message}`);
            resolve({ success: false, error: stderr || err.message });
          } else {
            logCallback('automation', `Shell Output: ${stdout.trim()}`);
            resolve({ success: true, output: stdout });
          }
        });
      });

    default:
      logCallback('warning', `Unknown action type: ${type}`);
      return { success: false, error: 'Unrecognized action directive.' };
  }
}

module.exports = {
  createDesktopFile,
  openBrowserTarget,
  executeAction
};
