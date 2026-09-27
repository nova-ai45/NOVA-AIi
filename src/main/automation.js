const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { exec, spawn } = require('child_process');

function getDesktopDir() {
  return app.getPath('desktop');
}

/**
 * Multi-Step Web & Browser Automation (e.g. YouTube Search + Auto-Play Top Video)
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

    logCallback('automation', `Launching Browser to: ${finalUrl}`);
    await shell.openExternal(finalUrl);

    // If Autoplay is requested on Windows, automate keystroke navigation after browser loads
    if (autoplay && process.platform === 'win32' && query) {
      setTimeout(() => {
        logCallback('automation', 'Simulating focus and selecting top media result...');
        const psScript = `
          Add-Type -AssemblyName System.Windows.Forms;
          Start-Sleep -Milliseconds 2200;
          [System.Windows.Forms.SendKeys]::SendWait('{TAB 4}');
          Start-Sleep -Milliseconds 400;
          [System.Windows.Forms.SendKeys]::SendWait('{ENTER}');
        `;
        exec(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`);
      }, 1000);
    }

    return { success: true };
  } catch (err) {
    logCallback('error', `Browser automation error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Multi-Step Project & Code Generation with Immediate Execution
 */
async function createAndRunProject(opts, logCallback = () => {}) {
  const { directoryName, filename, content, executeImmediately } = opts;
  try {
    const baseDir = directoryName
      ? path.join(getDesktopDir(), directoryName)
      : getDesktopDir();

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    const filePath = path.join(baseDir, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    logCallback('automation', `Created script at: ${filePath}`);

    // Immediate Execution Pipeline
    if (executeImmediately) {
      logCallback('automation', `Spawning execution runtime for ${filename}...`);
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
          logCallback('automation', `Execution Output: ${stdout.trim() || 'Process exited 0'}`);
        }
      });
    }

    return { success: true, path: filePath };
  } catch (err) {
    logCallback('error', `Project creation failure: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Launch Any Installed Windows Program
 */
async function launchApp(appName, logCallback = () => {}) {
  return new Promise((resolve) => {
    logCallback('automation', `Launching system binary: ${appName}`);
    exec(`start ${appName}`, (err) => {
      if (err) {
        logCallback('error', `Failed to open ${appName}: ${err.message}`);
        resolve({ success: false, error: err.message });
      } else {
        logCallback('automation', `Process ${appName} successfully running.`);
        resolve({ success: true });
      }
    });
  });
}

/**
 * Universal Action Dispatcher
 */
async function executeAction(actionObj, logCallback = () => {}) {
  const { type, payload } = actionObj;
  logCallback('system', `Dispatching directive: [${type}]`);

  switch (type) {
    case 'OPEN_BROWSER_AND_PLAY':
      return await openBrowserAndPlay(payload.url, payload.query, payload.autoplay, logCallback);

    case 'CREATE_AND_RUN_PROJECT':
      return await createAndRunProject(payload, logCallback);

    case 'OPEN_APP':
      return await launchApp(payload.name, logCallback);

    case 'RUN_COMMAND':
      return new Promise((resolve) => {
        exec(payload.cmd, (err, stdout, stderr) => {
          if (err) {
            logCallback('error', `Shell error: ${stderr || err.message}`);
            resolve({ success: false, error: stderr || err.message });
          } else {
            logCallback('automation', `Shell: ${stdout.trim()}`);
            resolve({ success: true, output: stdout });
          }
        });
      });

    default:
      logCallback('warning', `Unrecognized directive: ${type}`);
      return { success: false };
  }
}

module.exports = {
  executeAction,
  openBrowserAndPlay,
  createAndRunProject,
  launchApp
};
