const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { exec } = require('child_process');

function getDesktopDir() {
  return app.getPath('desktop');
}

/**
 * Visual Code Generation: Streams code visibly to the user interface
 * and optionally opens Notepad/Terminal with typewriter effect, then saves to disk.
 */
async function createAndStreamCode(opts, logCallback = () => {}, mainWindow = null) {
  const { directoryName, filename, content, executeImmediately, openVisualNotepad } = opts;
  try {
    const baseDir = directoryName ? path.join(getDesktopDir(), directoryName) : getDesktopDir();
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    const filePath = path.join(baseDir, filename);
    logCallback('automation', `Live Visual Automation: Initializing ${filename}...`);

    // Stream character chunks live to the frontend HUD console
    if (mainWindow && !mainWindow.isDestroyed()) {
      const chunkSize = 25;
      for (let i = 0; i < content.length; i += chunkSize) {
        const chunk = content.slice(i, i + chunkSize);
        mainWindow.webContents.send('nova:codeStream', {
          filename,
          chunk,
          done: false
        });
        await new Promise((r) => setTimeout(r, 12));
      }
      mainWindow.webContents.send('nova:codeStream', {
        filename,
        chunk: '',
        done: true
      });
    }

    // Persist final code to disk
    fs.writeFileSync(filePath, content, 'utf-8');
    logCallback('automation', `Saved script directly to disk: ${filePath}`);

    // If requested, open Notepad visually with the generated file on Windows
    if (openVisualNotepad !== false && process.platform === 'win32') {
      exec(`notepad.exe "${filePath}"`);
    }

    // Immediate execution pipeline if script is executable
    if (executeImmediately) {
      logCallback('automation', `Executing runtime for ${filename}...`);
      const ext = path.extname(filename);
      let runCmd = '';
      if (ext === '.py') runCmd = `python "${filePath}"`;
      else if (ext === '.js') runCmd = `node "${filePath}"`;
      else if (ext === '.bat' || ext === '.cmd') runCmd = `"${filePath}"`;
      else runCmd = `start "" "${filePath}"`;

      exec(runCmd, { cwd: baseDir }, (err, stdout, stderr) => {
        if (err) {
          logCallback('error', `Script runtime fault: ${stderr || err.message}`);
        } else {
          logCallback('automation', `Execution Output: ${stdout.trim() || 'Process exited successfully (0)'}`);
        }
      });
    }

    return { success: true, path: filePath };
  } catch (err) {
    logCallback('error', `Visual Automation Exception: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Smart Browser Automation: Launches browser, handles profile picker if needed,
 * navigates and executes search queries with auto-play.
 */
async function openBrowserAndPlay(url, query, autoplay = true, logCallback = () => {}) {
  try {
    let finalUrl = url || 'https://www.youtube.com';
    if (query) {
      if (finalUrl.includes('youtube.com')) {
        finalUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      } else {
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      }
    }

    logCallback('automation', `Browser Handshake Initiated: ${finalUrl}`);
    await shell.openExternal(finalUrl);

    // Smart profile selection & search keystroke simulation on Windows
    if (process.platform === 'win32') {
      setTimeout(() => {
        logCallback('automation', 'Smart profile navigation: selecting search focus...');
        const psScript = `
          Add-Type -AssemblyName System.Windows.Forms;
          Start-Sleep -Milliseconds 1500;
          [System.Windows.Forms.SendKeys]::SendWait('{ENTER}');
          ${autoplay ? `
            Start-Sleep -Milliseconds 1200;
            [System.Windows.Forms.SendKeys]::SendWait('{TAB 4}');
            Start-Sleep -Milliseconds 300;
            [System.Windows.Forms.SendKeys]::SendWait('{ENTER}');
          ` : ''}
        `;
        exec(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`);
      }, 800);
    }

    return { success: true };
  } catch (err) {
    logCallback('error', `Browser automation error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Native Windows System App Launcher
 */
async function launchApp(appName, logCallback = () => {}) {
  return new Promise((resolve) => {
    logCallback('automation', `Launching system application: ${appName}`);
    exec(`start ${appName}`, (err) => {
      if (err) {
        logCallback('error', `Could not open ${appName}: ${err.message}`);
        resolve({ success: false, error: err.message });
      } else {
        logCallback('automation', `Launched ${appName}`);
        resolve({ success: true });
      }
    });
  });
}

/**
 * Universal Action Dispatcher
 */
async function executeAction(actionObj, logCallback = () => {}, mainWindow = null) {
  const { type, payload } = actionObj;
  logCallback('system', `Dispatching Action: [${type}]`);

  switch (type) {
    case 'CREATE_AND_STREAM_CODE':
    case 'CREATE_AND_RUN_PROJECT':
      return await createAndStreamCode(payload, logCallback, mainWindow);

    case 'OPEN_BROWSER_AND_PLAY':
      return await openBrowserAndPlay(payload.url, payload.query, payload.autoplay, logCallback);

    case 'OPEN_APP':
      return await launchApp(payload.name, logCallback);

    case 'RUN_COMMAND':
      return new Promise((resolve) => {
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
      logCallback('warning', `Unrecognized action type: ${type}`);
      return { success: false };
  }
}

module.exports = {
  executeAction,
  createAndStreamCode,
  openBrowserAndPlay,
  launchApp
};
