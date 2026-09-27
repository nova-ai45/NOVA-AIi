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
 * Native Windows Mouse Clicker via PowerShell User32 DLL
 * Moves the real mouse cursor to (x, y) and performs a physical left click.
 */
async function clickScreenCoordinates(x, y, logCallback = () => {}) {
  return new Promise((resolve) => {
    const posX = Math.round(Number(x));
    const posY = Math.round(Number(y));

    if (isNaN(posX) || isNaN(posY)) {
      logCallback('error', `mouse.click: invalid coordinates (${x}, ${y})`);
      return resolve({ success: false, error: 'Invalid coordinates' });
    }

    logCallback('automation', `mouse.click: moving to (${posX}, ${posY}) [CLICKING]`);

    if (process.platform === 'win32') {
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms;
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${posX}, ${posY});
        $code = @'
        using System;
        using System.Runtime.InteropServices;
        public class MouseSimulator {
            [DllImport("user32.dll")]
            public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
        }
'@
        Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue;
        [MouseSimulator]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero);
        Start-Sleep -Milliseconds 60;
        [MouseSimulator]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero);
      `;

      exec(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, (err) => {
        if (err) {
          logCallback('error', `mouse.click_error: ${err.message}`);
          resolve({ success: false, error: err.message });
        } else {
          resolve({ success: true, x: posX, y: posY });
        }
      });
    } else {
      resolve({ success: true });
    }
  });
}

/**
 * Native Windows Mouse Wheel Scroll (Scroll Down / Scroll Up)
 */
async function scrollScreen(direction = 'down', amount = 4, logCallback = () => {}) {
  return new Promise((resolve) => {
    const isDown = direction.toLowerCase() === 'down';
    // Windows mouse_event wheel: negative for down, positive for up
    const scrollDelta = isDown ? -120 * Math.max(1, amount) : 120 * Math.max(1, amount);

    logCallback('automation', `mouse.scroll: ${direction.toUpperCase()} by ${amount} notches`);

    if (process.platform === 'win32') {
      const psScript = `
        $code = @'
        using System;
        using System.Runtime.InteropServices;
        public class WheelSimulator {
            [DllImport("user32.dll")]
            public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);
        }
'@
        Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue;
        [WheelSimulator]::mouse_event(0x0800, 0, 0, ${scrollDelta}, [UIntPtr]::Zero);
      `;

      exec(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, (err) => {
        if (err) {
          logCallback('error', `mouse.scroll_error: ${err.message}`);
          resolve({ success: false, error: err.message });
        } else {
          resolve({ success: true, direction, amount });
        }
      });
    } else {
      resolve({ success: true });
    }
  });
}

/**
 * Browser Target Launcher
 */
async function openBrowserTarget(url, searchQuery = null, browserName = 'chrome', logCallback = () => {}) {
  try {
    let finalUrl = url || 'https://www.youtube.com';
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
      } else if (requested.includes('edge')) {
        exec(`start msedge "${finalUrl}"`, (err) => {
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
    case 'CLICK_SCREEN':
      return await clickScreenCoordinates(payload.x, payload.y, logCallback);

    case 'SCROLL_SCREEN':
      return await scrollScreen(payload.direction || 'down', payload.amount || 4, logCallback);

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
  clickScreenCoordinates,
  scrollScreen,
  createDesktopFile,
  openBrowserTarget,
  executeAction
};
