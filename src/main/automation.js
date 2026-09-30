const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { exec } = require('child_process');
const https = require('https');

// ============================================================================
// 1. LOCAL SCREEN OCR & VISION MODULES
// ============================================================================
let screenshot = null;
try {
  screenshot = require('screenshot-desktop');
} catch (e) {
  console.warn('[Local Vision] screenshot-desktop not available:', e.message);
}

let Tesseract = null;
try {
  Tesseract = require('tesseract.js');
} catch (e) {
  console.warn('[Local OCR] tesseract.js not available:', e.message);
}

// ============================================================================
// 2. API CREDENTIALS (YOUTUBE DATA API v3 & GOOGLE CUSTOM SEARCH)
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
// 3. REAL LOCAL SCREEN OCR & COORDINATE FINDING
// ============================================================================

/**
 * Scans active screen locally to find coordinates of target text.
 * Returns { found: boolean, x: number, y: number, text: string }
 */
async function captureAndFindText(targetText, logCallback = () => {}) {
  const target = (targetText || '').trim().toLowerCase();
  if (!target) {
    return { found: false, error: 'Target text cannot be empty' };
  }

  if (!screenshot || !Tesseract) {
    logCallback('error', '[Local OCR] screenshot-desktop or tesseract.js is missing.');
    return { found: false, error: 'OCR libraries not installed' };
  }

  try {
    logCallback('automation', `[Local OCR] Scanning screen display for: "${targetText}"...`);

    const imgBuffer = await screenshot({ format: 'png' });
    const { data } = await Tesseract.recognize(imgBuffer, 'eng');

    const words = data.words || [];
    const targetWords = target.split(/\s+/);

    // Multi-word phrase search
    if (targetWords.length > 1) {
      for (let i = 0; i <= words.length - targetWords.length; i++) {
        let match = true;
        for (let j = 0; j < targetWords.length; j++) {
          const wClean = words[i + j].text.toLowerCase().replace(/[^\w]/g, '');
          const tClean = targetWords[j].replace(/[^\w]/g, '');
          if (!wClean.includes(tClean)) {
            match = false;
            break;
          }
        }

        if (match) {
          const slice = words.slice(i, i + targetWords.length);
          const x0 = Math.min(...slice.map((w) => w.bbox.x0));
          const y0 = Math.min(...slice.map((w) => w.bbox.y0));
          const x1 = Math.max(...slice.map((w) => w.bbox.x1));
          const y1 = Math.max(...slice.map((w) => w.bbox.y1));

          const centerX = Math.round((x0 + x1) / 2);
          const centerY = Math.round((y0 + y1) / 2);

          logCallback('automation', `[Local OCR] Found phrase at (${centerX}, ${centerY})`);
          return { found: true, x: centerX, y: centerY, text: slice.map((w) => w.text).join(' ') };
        }
      }
    }

    // Single-word search
    for (const w of words) {
      const cleanWord = w.text.toLowerCase().replace(/[^\w]/g, '');
      const cleanTarget = target.replace(/[^\w]/g, '');

      if (cleanWord.includes(cleanTarget) || cleanTarget.includes(cleanWord)) {
        const centerX = Math.round((w.bbox.x0 + w.bbox.x1) / 2);
        const centerY = Math.round((w.bbox.y0 + w.bbox.y1) / 2);
        logCallback('automation', `[Local OCR] Found word "${w.text}" at (${centerX}, ${centerY})`);
        return { found: true, x: centerX, y: centerY, text: w.text };
      }
    }

    logCallback('warning', `[Local OCR] Text "${targetText}" not found on screen.`);
    return { found: false, error: 'Screen par yeh word nahi mila.' };
  } catch (err) {
    logCallback('error', `[Local OCR Error]: ${err.message}`);
    return { found: false, error: err.message };
  }
}

/**
 * Physical Windows Mouse Click at Coordinates via User32
 */
async function clickAt(x, y, button = 'left', logCallback = () => {}) {
  return new Promise((resolve) => {
    const posX = Math.round(Number(x));
    const posY = Math.round(Number(y));
    const downFlag = button === 'right' ? '0x0008' : '0x0002';
    const upFlag = button === 'right' ? '0x0010' : '0x0004';

    logCallback('automation', `[Native Mouse] Moving to (${posX}, ${posY}) and clicking...`);

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
      Start-Sleep -Milliseconds 50;
      [NativeMouseDrv]::mouse_event(${upFlag}, 0, 0, 0, [UIntPtr]::Zero);
    `;

    exec(`powershell -NoProfile -Command "${ps.replace(/\n/g, ' ')}"`, (err) => {
      resolve({ success: !err, x: posX, y: posY, error: err ? err.message : null });
    });
  });
}

/**
 * Searches the screen for text and performs an authentic physical left click.
 * Strictly verifies whether the word was present.
 */
async function clickOnScreenText(targetText, logCallback = () => {}) {
  const findResult = await captureAndFindText(targetText, logCallback);

  if (!findResult.found) {
    return {
      success: false,
      executed: false,
      reason: `Screen par "${targetText}" nahi mila.`
    };
  }

  const clickResult = await clickAt(findResult.x, findResult.y, 'left', logCallback);
  return {
    success: clickResult.success,
    executed: true,
    targetText,
    coordinates: { x: findResult.x, y: findResult.y }
  };
}

/**
 * Scroll screen natively
 */
async function scrollScreen(direction = 'down', amount = 4, logCallback = () => {}) {
  return new Promise((resolve) => {
    const isDown = direction.toLowerCase() === 'down';
    const scrollDelta = isDown ? -120 * Math.max(1, amount) : 120 * Math.max(1, amount);

    logCallback('automation', `[Native Mouse] Scrolling ${direction.toUpperCase()} by ${amount}`);

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
      resolve({ success: !err, direction, amount });
    });
  });
}

// ============================================================================
// 4. REAL YOUTUBE DATA API v3 EXECUTION & WEB VERIFICATION
// ============================================================================

/**
 * Searches YouTube API v3 and plays the actual video in Chrome.
 * Returns factual data (video title, channel title, video ID).
 */
async function searchAndPlayYouTubeDirect(query, logCallback = () => {}, browserName = 'chrome') {
  return new Promise((resolve) => {
    const cleanQuery = (query || '')
      .replace(/^(play|chalao|sunao|laga do|chala do|bajao)\s+/i, '')
      .replace(/\s+(chalao|sunao|laga do|chala do|bajao|song|video)$/i, '')
      .trim();

    if (!cleanQuery) {
      const defaultUrl = 'https://www.youtube.com';
      launchBrowserUrl(defaultUrl, browserName);
      return resolve({ success: true, url: defaultUrl, videoTitle: 'YouTube Home' });
    }

    logCallback('automation', `[YouTube API v3] Calling YouTube search endpoint for: "${cleanQuery}"`);
    const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(cleanQuery)}&type=video&maxResults=1&key=${YOUTUBE_DATA_API_KEY}`;

    const request = https.get(apiUrl, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const item = json.items && json.items[0];

          if (item && item.id && item.id.videoId) {
            const videoId = item.id.videoId;
            const videoTitle = item.snippet.title;
            const channelTitle = item.snippet.channelTitle;
            const directPlayUrl = `https://www.youtube.com/watch?v=${videoId}&autoplay=1`;

            logCallback('automation', `[YouTube API v3] Video Found: "${videoTitle}" by ${channelTitle} -> Launching`);
            launchBrowserUrl(directPlayUrl, browserName);

            resolve({
              success: true,
              executed: true,
              videoId,
              videoTitle,
              channelTitle,
              url: directPlayUrl
            });
          } else {
            const fallbackUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`;
            launchBrowserUrl(fallbackUrl, browserName);
            resolve({
              success: true,
              executed: true,
              fallback: true,
              videoTitle: cleanQuery,
              url: fallbackUrl
            });
          }
        } catch (err) {
          const fallbackUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`;
          launchBrowserUrl(fallbackUrl, browserName);
          resolve({ success: false, error: err.message, url: fallbackUrl });
        }
      });
    });

    request.on('error', (err) => {
      const fallbackUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`;
      launchBrowserUrl(fallbackUrl, browserName);
      resolve({ success: false, error: err.message, url: fallbackUrl });
    });

    request.setTimeout(12000, () => {
      request.destroy();
      const fallbackUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`;
      launchBrowserUrl(fallbackUrl, browserName);
      resolve({ success: false, timeout: true, url: fallbackUrl });
    });
  });
}

/**
 * Real Web & Fact Verification via Google Custom Search API
 */
async function verifyWebFacts(query, logCallback = () => {}) {
  return new Promise((resolve) => {
    const cx = getCleanGoogleCx();
    logCallback('automation', `[Google Verification] Querying facts for: "${query}"`);

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

          logCallback('automation', `[Google Verification] Retrieved ${results.length} authentic references.`);
          resolve({ success: true, verified: results.length > 0, items: results });
        } catch (e) {
          resolve({ success: false, error: e.message, items: [] });
        }
      });
    }).on('error', (err) => {
      resolve({ success: false, error: err.message, items: [] });
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

// ============================================================================
// 5. LIVE NOTEPAD CODE STREAMING & IN-PLACE FILE REVISION
// ============================================================================

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

    logCallback('automation', `[Notepad] Writing to file: "${fullPath}" (Update: ${isUpdate ? 'IN-PLACE' : 'NEW'})`);

    // Stream typewriter chunks to UI
    if (mainWindow && !mainWindow.isDestroyed()) {
      const chunkSize = 40;
      for (let i = 0; i < content.length; i += chunkSize) {
        const chunk = content.slice(i, i + chunkSize);
        mainWindow.webContents.send('nova:codeStream', {
          filename: resolvedFilename,
          chunk,
          done: false
        });
        await new Promise((r) => setTimeout(r, 8));
      }
      mainWindow.webContents.send('nova:codeStream', {
        filename: resolvedFilename,
        chunk: '',
        done: true
      });
    }

    // Save in-place to physical disk
    fs.writeFileSync(fullPath, content, 'utf-8');

    // Launch Notepad visibly
    if (process.platform === 'win32') {
      exec(`notepad.exe "${fullPath}"`);
      setTimeout(() => {
        const psFocus = `
          $wshell = New-Object -ComObject wscript.shell;
          $wshell.AppActivate('Notepad');
        `;
        exec(`powershell -NoProfile -Command "${psFocus.replace(/\n/g, ' ')}"`);
      }, 350);
    }

    logCallback('automation', `[Notepad] File saved and displayed: "${fullPath}"`);
    return { success: true, path: fullPath, filename: resolvedFilename };
  } catch (err) {
    logCallback('error', `[Notepad Typer Error]: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Master Action Dispatcher
 */
async function executeAction(actionObj, logCallback = () => {}, mainWindow = null) {
  const { type, payload = {} } = actionObj;
  logCallback('system', `Dispatching Action: [${type}]`);

  switch (type) {
    case 'CLICK_SCREEN_TEXT':
    case 'CLICK_TEXT':
      return await clickOnScreenText(payload.text || payload.targetText || payload.label, logCallback);

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
    case 'VERIFY_WEB':
      return await verifyWebFacts(payload.query, logCallback);

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
      launchBrowserUrl(payload.url || 'https://www.google.com', payload.browser || 'chrome');
      return { success: true, url: payload.url };

    case 'OPEN_APP':
      return new Promise((resolve) => {
        exec(`start ${payload.name}`, (err) => {
          logCallback('automation', `[App Launcher] Started: "${payload.name}"`);
          resolve({ success: !err });
        });
      });

    default:
      logCallback('warning', `Unrecognized action: "${type}"`);
      return { success: false, error: 'Unknown action type' };
  }
}

module.exports = {
  YOUTUBE_DATA_API_KEY,
  GOOGLE_CUSTOM_SEARCH_API_KEY,
  GOOGLE_SEARCH_ENGINE_CX,
  captureAndFindText,
  clickOnScreenText,
  clickAt,
  scrollScreen,
  searchAndPlayYouTubeDirect,
  verifyWebFacts,
  liveNotepadCodeStream,
  executeAction
};
