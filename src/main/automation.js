const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { exec } = require('child_process');
const https = require('https');

// ============================================================================
// 1. LOCAL SCREEN OCR (100% LOCAL - ZERO CLOUD VISION API)
// ============================================================================
let screenshot = null;
try {
  screenshot = require('screenshot-desktop');
} catch (e) {
  console.warn('[Local Vision] screenshot-desktop not loaded:', e.message);
}

let Tesseract = null;
try {
  Tesseract = require('tesseract.js');
} catch (e) {
  console.warn('[Local OCR] tesseract.js not loaded:', e.message);
}

// ============================================================================
// 2. EXISTING CREDENTIALS & CONSTANTS (KEPT INTACT)
// ============================================================================
const YOUTUBE_DATA_API_KEY = "AIzaSyAKoG0eSXgMaIg4xWQSY7t9aof2dFW3zlw";
const GOOGLE_CUSTOM_SEARCH_API_KEY = "AIzaSyC63h7RvDVgpqDfiD_cKNteLp5QUlwzbEs";
const GOOGLE_SEARCH_ENGINE_CX = `<script async src="https://cse.google.com/cse.js?cx=e1b191a16183d4a47">
</script>
<div class="gcse-search"></div>`;

function getCleanGoogleCx() {
  const match = GOOGLE_SEARCH_ENGINE_CX.match(/cx=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : "e1b191a16183d4a47";
}

function getDesktopDir() {
  return app.getPath('desktop');
}

let currentActiveProjectFile = null;

// ============================================================================
// 3. FULL DISPLAY OCR TEXT EXTRACTION (FOR DYNAMIC SCREEN READING)
// ============================================================================

/**
 * Captures the primary display and extracts all visible text via Tesseract OCR locally.
 * Returns clean plain text for AI context injection.
 */
async function readEntireScreenOCR(logCallback = () => {}) {
  if (!screenshot) {
    logCallback('error', '[Local OCR] screenshot-desktop module is missing.');
    return '';
  }
  if (!Tesseract) {
    logCallback('error', '[Local OCR] tesseract.js module is missing.');
    return '';
  }

  try {
    logCallback('automation', '[Local OCR] Capturing display & extracting on-screen text...');

    // 1. In-memory PNG screenshot of active primary display
    const imgBuffer = await screenshot({ format: 'png' });

    // 2. Local Tesseract recognition
    const { data } = await Tesseract.recognize(imgBuffer, 'eng');
    const rawText = (data && data.text ? data.text : '').replace(/\s+/g, ' ').trim();

    logCallback('automation', `[Local OCR] Extracted ${rawText.length} characters of visible screen text.`);
    // Return up to 2500 characters of clean context to keep prompt fast and relevant
    return rawText.slice(0, 2500);
  } catch (err) {
    logCallback('error', `[Local OCR Read Error]: ${err.message}`);
    return '';
  }
}

/**
 * Captures primary screen and finds coordinates of target text locally via Tesseract.
 */
async function captureAndFindText(targetText, logCallback = () => {}) {
  const target = (targetText || '').trim().toLowerCase();
  if (!target) {
    return { found: false, error: 'Empty search text provided.' };
  }

  if (!screenshot || !Tesseract) {
    logCallback('error', '[Local OCR] screenshot-desktop or tesseract.js missing.');
    return { found: false, error: 'OCR modules missing' };
  }

  try {
    logCallback('automation', `[Local OCR] Scanning screen locally for: "${targetText}"...`);

    const imgBuffer = await screenshot({ format: 'png' });
    const { data } = await Tesseract.recognize(imgBuffer, 'eng');

    const words = data.words || [];
    const targetWords = target.split(/\s+/);

    if (targetWords.length > 1) {
      for (let i = 0; i <= words.length - targetWords.length; i++) {
        let match = true;
        for (let j = 0; j < targetWords.length; j++) {
          const wordClean = words[i + j].text.toLowerCase().replace(/[^\w]/g, '');
          const targetClean = targetWords[j].replace(/[^\w]/g, '');
          if (!wordClean.includes(targetClean)) {
            match = false;
            break;
          }
        }

        if (match) {
          const matchedSlice = words.slice(i, i + targetWords.length);
          const x0 = Math.min(...matchedSlice.map((w) => w.bbox.x0));
          const y0 = Math.min(...matchedSlice.map((w) => w.bbox.y0));
          const x1 = Math.max(...matchedSlice.map((w) => w.bbox.x1));
          const y1 = Math.max(...matchedSlice.map((w) => w.bbox.y1));

          const centerX = Math.round((x0 + x1) / 2);
          const centerY = Math.round((y0 + y1) / 2);

          logCallback('automation', `[Local OCR] Found at (${centerX}, ${centerY})`);
          return {
            found: true,
            x: centerX,
            y: centerY,
            width: x1 - x0,
            height: y1 - y0,
            text: matchedSlice.map((w) => w.text).join(' ')
          };
        }
      }
    }

    for (const w of words) {
      const cleanWord = w.text.toLowerCase().replace(/[^\w]/g, '');
      const cleanTarget = target.replace(/[^\w]/g, '');

      if (cleanWord.includes(cleanTarget) || cleanTarget.includes(cleanWord)) {
        const centerX = Math.round((w.bbox.x0 + w.bbox.x1) / 2);
        const centerY = Math.round((w.bbox.y0 + w.bbox.y1) / 2);

        logCallback('automation', `[Local OCR] Word "${w.text}" located at (${centerX}, ${centerY})`);
        return {
          found: true,
          x: centerX,
          y: centerY,
          width: w.bbox.x1 - w.bbox.x0,
          height: w.bbox.y1 - w.bbox.y0,
          text: w.text
        };
      }
    }

    const lines = data.lines || [];
    for (const l of lines) {
      if (l.text.toLowerCase().includes(target)) {
        const centerX = Math.round((l.bbox.x0 + l.bbox.x1) / 2);
        const centerY = Math.round((l.bbox.y0 + l.bbox.y1) / 2);
        logCallback('automation', `[Local OCR] Located at (${centerX}, ${centerY})`);
        return {
          found: true,
          x: centerX,
          y: centerY,
          width: l.bbox.x1 - l.bbox.x0,
          height: l.bbox.y1 - l.bbox.y0,
          text: l.text
        };
      }
    }

    logCallback('warning', `[Local OCR] "${targetText}" not found on screen.`);
    return { found: false };
  } catch (err) {
    logCallback('error', `[Local OCR Error]: ${err.message}`);
    return { found: false, error: err.message };
  }
}

/**
 * 4. NATIVE MOUSE CLICK ON SCREEN TEXT (100% NATIVE WINDOWS USER32)
 */
async function clickOnScreenText(targetText, logCallback = () => {}) {
  const result = await captureAndFindText(targetText, logCallback);

  if (!result || !result.found) {
    logCallback('warning', `[Mouse Action] Cannot click: "${targetText}" was not detected.`);
    return { success: false, error: 'Text not found on screen' };
  }

  logCallback('automation', `[Mouse Action] Moving to (${result.x}, ${result.y}) and clicking...`);
  return await clickAt(result.x, result.y, 'left', logCallback);
}

/**
 * 5. NATIVE KEYBOARD TYPING & ENTER (100% NATIVE WINDOWS POWERSHELL)
 */
async function typeAndSubmitText(textToType, logCallback = () => {}) {
  if (!textToType) return { success: false };

  logCallback('automation', `[Keyboard Action] Typing: "${textToType}" & pressing Enter...`);

  return new Promise((resolve) => {
    const escapedText = textToType
      .replace(/([+^%~{}()[\]])/g, '{$1}')
      .replace(/'/g, "''");

    const ps = `
      Add-Type -AssemblyName System.Windows.Forms;
      Start-Sleep -Milliseconds 150;
      [System.Windows.Forms.SendKeys]::SendWait('${escapedText}');
      Start-Sleep -Milliseconds 100;
      [System.Windows.Forms.SendKeys]::SendWait('{ENTER}');
    `;

    exec(`powershell -NoProfile -Command "${ps.replace(/\n/g, ' ')}"`, (err) => {
      if (err) {
        logCallback('error', `[Keyboard Error]: ${err.message}`);
        resolve({ success: false, error: err.message });
      } else {
        logCallback('automation', `[Keyboard Action] Text typed and submitted.`);
        resolve({ success: true });
      }
    });
  });
}

// ============================================================================
// 6. NATIVE MOUSE & APP CONTROLS (USER32.DLL VIA POWERSHELL)
// ============================================================================

async function clickAt(x, y, button = 'left', logCallback = () => {}) {
  return new Promise((resolve) => {
    const posX = Math.round(Number(x));
    const posY = Math.round(Number(y));
    const downFlag = button === 'right' ? '0x0008' : '0x0002';
    const upFlag = button === 'right' ? '0x0010' : '0x0004';

    logCallback('automation', `[Native Mouse] ${button.toUpperCase()} Click at (${posX}, ${posY})`);

    const ps = `
      Add-Type -AssemblyName System.Windows.Forms;
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${posX}, ${posY});
      $code = @'
      using System;
      using System.Runtime.InteropServices;
      public class NativeMouseDrv {
          [DllImport("user32.dll")]
          public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
      }
'@
      Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue;
      [NativeMouseDrv]::mouse_event(${downFlag}, 0, 0, 0, [UIntPtr]::Zero);
      Start-Sleep -Milliseconds 45;
      [NativeMouseDrv]::mouse_event(${upFlag}, 0, 0, 0, [UIntPtr]::Zero);
    `;
    exec(`powershell -NoProfile -Command "${ps.replace(/\n/g, ' ')}"`, (err) => {
      resolve({ success: !err, x: posX, y: posY });
    });
  });
}

async function scrollScreen(direction = 'down', amount = 4, logCallback = () => {}) {
  return new Promise((resolve) => {
    const isDown = direction.toLowerCase() === 'down';
    const scrollDelta = isDown ? -120 * Math.max(1, amount) : 120 * Math.max(1, amount);

    logCallback('automation', `[Native Mouse] Scroll ${direction.toUpperCase()} (${amount})`);

    const ps = `
      $code = @'
      using System;
      using System.Runtime.InteropServices;
      public class NativeWheelDrv {
          [DllImport("user32.dll")]
          public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);
      }
'@
      Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue;
      [NativeWheelDrv]::mouse_event(0x0800, 0, 0, ${scrollDelta}, [UIntPtr]::Zero);
    `;
    exec(`powershell -NoProfile -Command "${ps.replace(/\n/g, ' ')}"`, (err) => {
      resolve({ success: !err });
    });
  });
}

function launchBrowserUrl(targetUrl, browserName = 'chrome') {
  if (process.platform === 'win32' && (browserName || 'chrome').toLowerCase().includes('chrome')) {
    exec(`start chrome "${targetUrl}"`, (err) => {
      if (err) shell.openExternal(targetUrl);
    });
  } else {
    shell.openExternal(targetUrl);
  }
}

async function searchAndPlayYouTubeDirect(query, logCallback = () => {}, browserName = 'chrome') {
  return new Promise((resolve) => {
    const cleanQuery = (query || '')
      .replace(/^(play|chalao|sunao|laga do|chala do|bajao)\s+/i, '')
      .replace(/\s+(chalao|sunao|laga do|chala do|bajao|song|video)$/i, '')
      .trim();

    if (!cleanQuery) {
      const defaultUrl = 'https://www.youtube.com';
      launchBrowserUrl(defaultUrl, browserName);
      return resolve({ success: true, url: defaultUrl });
    }

    logCallback('automation', `[YouTube API v3] Searching: "${cleanQuery}"`);
    const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(cleanQuery)}&type=video&maxResults=1&key=${YOUTUBE_DATA_API_KEY}`;

    const request = https.get(apiUrl, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const videoId = json.items && json.items[0]?.id?.videoId;

          if (videoId) {
            const directPlayUrl = `https://www.youtube.com/watch?v=${videoId}`;
            launchBrowserUrl(directPlayUrl, browserName);
            resolve({ success: true, videoId, url: directPlayUrl });
          } else {
            const fallbackUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`;
            launchBrowserUrl(fallbackUrl, browserName);
            resolve({ success: true, fallback: true, url: fallbackUrl });
          }
        } catch (err) {
          const fallbackUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`;
          launchBrowserUrl(fallbackUrl, browserName);
          resolve({ success: true, fallback: true, url: fallbackUrl });
        }
      });
    });

    request.on('error', () => {
      const fallbackUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`;
      launchBrowserUrl(fallbackUrl, browserName);
      resolve({ success: true, fallback: true, url: fallbackUrl });
    });

    request.setTimeout(15000, () => {
      request.destroy();
      const fallbackUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`;
      launchBrowserUrl(fallbackUrl, browserName);
      resolve({ success: true, fallback: true, url: fallbackUrl });
    });
  });
}

async function liveNotepadCodeStream(filename, content, targetDirectory = null, isUpdate = false, logCallback = () => {}, mainWindow = null) {
  try {
    const baseDir = targetDirectory ? targetDirectory : getDesktopDir();
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    let resolvedFilename = filename;
    if (isUpdate && currentActiveProjectFile && fs.existsSync(currentActiveProjectFile)) {
      resolvedFilename = path.basename(currentActiveProjectFile);
    } else if (!resolvedFilename) {
      resolvedFilename = currentActiveProjectFile ? path.basename(currentActiveProjectFile) : 'index.html';
    }

    const fullPath = path.join(baseDir, resolvedFilename);
    currentActiveProjectFile = fullPath;

    logCallback('automation', `[Notepad Typer] In-Place Target: "${fullPath}"`);

    if (mainWindow && !mainWindow.isDestroyed()) {
      const chunkSize = 35;
      for (let i = 0; i < content.length; i += chunkSize) {
        const chunk = content.slice(i, i + chunkSize);
        mainWindow.webContents.send('nova:codeStream', {
          filename: resolvedFilename,
          chunk,
          done: false
        });
        await new Promise((r) => setTimeout(r, 10));
      }
      mainWindow.webContents.send('nova:codeStream', {
        filename: resolvedFilename,
        chunk: '',
        done: true
      });
    }

    fs.writeFileSync(fullPath, content, 'utf-8');

    if (process.platform === 'win32') {
      exec(`notepad.exe "${fullPath}"`);
      setTimeout(() => {
        const psFocus = `
          $wshell = New-Object -ComObject wscript.shell;
          $wshell.AppActivate('Notepad');
        `;
        exec(`powershell -NoProfile -Command "${psFocus.replace(/\n/g, ' ')}"`);
      }, 400);
    }

    return { success: true, path: fullPath, isUpdate };
  } catch (err) {
    logCallback('error', `[Notepad Typer Fault]: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function queryGoogleCustomSearch(query, logCallback = () => {}) {
  return new Promise((resolve) => {
    const cx = getCleanGoogleCx();
    logCallback('automation', `[Google Search] Querying: "${query}"`);

    const apiUrl = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_CUSTOM_SEARCH_API_KEY}&cx=${cx}&q=${encodeURIComponent(query)}&num=3`;

    https.get(apiUrl, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const results = (json.items || []).map((item) => ({
            title: item.title,
            snippet: item.snippet,
            link: item.link
          }));
          resolve({ success: true, results });
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    }).on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

async function openBrowserTarget(url, searchQuery = null, browserName = 'chrome', logCallback = () => {}) {
  try {
    let finalUrl = url || 'https://www.google.com';
    const isChannelOrDirect = finalUrl.includes('@') || finalUrl.includes('/watch');

    if (!isChannelOrDirect && finalUrl.includes('youtube.com') && searchQuery && typeof searchQuery === 'string' && searchQuery.trim() !== '') {
      return await searchAndPlayYouTubeDirect(searchQuery.trim(), logCallback, browserName);
    }

    if (!isChannelOrDirect && searchQuery && typeof searchQuery === 'string' && searchQuery.trim() !== '') {
      finalUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery.trim())}`;
    }

    if (!/^https?:\/\//i.test(finalUrl)) {
      finalUrl = 'https://' + finalUrl;
    }

    logCallback('automation', `[Browser Launcher] Launching: "${finalUrl}"`);
    launchBrowserUrl(finalUrl, browserName);
    return { success: true, launchedUrl: finalUrl };
  } catch (err) {
    logCallback('error', `[Browser Launch Fault]: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Universal Action Dispatcher
 */
async function executeAction(actionObj, logCallback = () => {}, mainWindow = null) {
  const { type, payload } = actionObj;
  logCallback('system', `Dispatching Action: [${type}]`);

  switch (type) {
    case 'CLICK_TEXT':
    case 'CLICK_ON_TEXT':
    case 'CLICK_SCREEN_TEXT':
      return await clickOnScreenText(payload.text || payload.targetText || payload.label, logCallback);

    case 'FIND_TEXT':
    case 'FIND_SCREEN_TEXT':
      return await captureAndFindText(payload.text || payload.targetText || payload.label, logCallback);

    case 'TYPE_AND_SUBMIT':
    case 'TYPE_TEXT':
      return await typeAndSubmitText(payload.text || payload.textToType, logCallback);

    case 'CLICK_AT':
    case 'CLICK_SCREEN':
      return await clickAt(payload.x, payload.y, payload.button || 'left', logCallback);

    case 'SCROLL_SCREEN':
      return await scrollScreen(payload.direction || 'down', payload.amount || 4, logCallback);

    case 'YOUTUBE_DIRECT_PLAY':
    case 'PLAY_YOUTUBE_VIDEO':
      return await searchAndPlayYouTubeDirect(
        payload.query || payload.searchQuery || payload.song || payload.title,
        logCallback,
        payload.browser || 'chrome'
      );

    case 'GOOGLE_CUSTOM_SEARCH':
      return await queryGoogleCustomSearch(payload.query, logCallback);

    case 'CREATE_FILE':
    case 'CREATE_AND_STREAM_CODE':
    case 'UPDATE_FILE_IN_PLACE':
      return await liveNotepadCodeStream(
        payload.filename,
        payload.content,
        payload.directory,
        payload.isUpdate || type === 'UPDATE_FILE_IN_PLACE',
        logCallback,
        mainWindow
      );

    case 'OPEN_BROWSER':
      return await openBrowserTarget(payload.url, payload.query, payload.browser || 'chrome', logCallback);

    case 'OPEN_APP':
      return new Promise((resolve) => {
        exec(`start ${payload.name}`, (err) => {
          logCallback('automation', `[App Launcher] Started: "${payload.name}"`);
          resolve({ success: !err });
        });
      });

    case 'RUN_COMMAND':
      return new Promise((resolve) => {
        exec(payload.cmd, (err, stdout, stderr) => {
          if (err) {
            logCallback('error', `[Shell Error]: ${stderr || err.message}`);
            resolve({ success: false, error: stderr || err.message });
          } else {
            logCallback('automation', `[Shell Output]: ${stdout.trim()}`);
            resolve({ success: true, output: stdout });
          }
        });
      });

    default:
      logCallback('warning', `Unrecognized action directive: "${type}"`);
      return { success: false };
  }
}

module.exports = {
  YOUTUBE_DATA_API_KEY,
  GOOGLE_CUSTOM_SEARCH_API_KEY,
  GOOGLE_SEARCH_ENGINE_CX,
  readEntireScreenOCR,
  captureAndFindText,
  clickOnScreenText,
  typeAndSubmitText,
  liveNotepadCodeStream,
  searchAndPlayYouTubeDirect,
  queryGoogleCustomSearch,
  clickAt,
  scrollScreen,
  openBrowserTarget,
  executeAction
};
