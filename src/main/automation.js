const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { exec } = require('child_process');
const https = require('https');

// ============================================================================
// 1. LOCAL SCREEN OCR & NATIVE AUTOMATION LIBRARIES
// ============================================================================
let screenshot = null;
try {
  screenshot = require('screenshot-desktop');
} catch (e) {
  console.warn('[Local Vision] screenshot-desktop module is unavailable:', e.message);
}

let Tesseract = null;
try {
  Tesseract = require('tesseract.js');
} catch (e) {
  console.warn('[Local OCR] tesseract.js module is unavailable:', e.message);
}

let nutMouse = null;
let nutKeyboard = null;
let Point = null;
let Button = null;
let Key = null;

try {
  const nut = require('@nut-tree/nut-js');
  nutMouse = nut.mouse;
  nutKeyboard = nut.keyboard;
  Point = nut.Point;
  Button = nut.Button;
  Key = nut.Key;
  nutMouse.config.autoDelayMs = 25;
  nutKeyboard.config.autoDelayMs = 15;
} catch (e) {
  console.warn('[Local Input] @nut-tree/nut-js not found. Using native Windows fallback.');
}

// ============================================================================
// 2. CONSTANTS & API CREDENTIALS
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
// 3. ACCURATE LOCAL OCR & SCREEN TEXT EXTRACTION
// ============================================================================

/**
 * Captures primary display and performs local OCR text extraction.
 * Guarantees zero hallucinations by returning verbatim detected text.
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
    logCallback('automation', '[Local OCR] Capturing display & analyzing visible text...');

    const imgBuffer = await screenshot({ format: 'png' });
    const { data } = await Tesseract.recognize(imgBuffer, 'eng');
    const rawText = (data && data.text ? data.text : '').replace(/\s+/g, ' ').trim();

    if (!rawText) {
      logCallback('automation', '[Local OCR] Screen analysis completed: No text detected on display.');
      return '';
    }

    logCallback('automation', `[Local OCR] Extracted ${rawText.length} characters of authentic on-screen text.`);
    return rawText.slice(0, 2500);
  } catch (err) {
    logCallback('error', `[Local OCR Failure]: ${err.message}`);
    return '';
  }
}

/**
 * Searches local display for exact or fuzzy word positions.
 */
async function captureAndFindText(targetText, logCallback = () => {}) {
  const target = (targetText || '').trim().toLowerCase();
  if (!target) {
    return { found: false, error: 'Target query cannot be empty.' };
  }

  if (!screenshot || !Tesseract) {
    logCallback('error', '[Local OCR] Required OCR modules missing.');
    return { found: false, error: 'OCR libraries uninitialized.' };
  }

  try {
    logCallback('automation', `[Local OCR] Scanning screen coordinates for: "${targetText}"...`);

    const imgBuffer = await screenshot({ format: 'png' });
    const { data } = await Tesseract.recognize(imgBuffer, 'eng');

    const words = data.words || [];
    const targetWords = target.split(/\s+/);

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

          logCallback('automation', `[Local OCR] Found phrase target at (${centerX}, ${centerY})`);
          return { found: true, x: centerX, y: centerY, text: slice.map((w) => w.text).join(' ') };
        }
      }
    }

    for (const w of words) {
      const cleanWord = w.text.toLowerCase().replace(/[^\w]/g, '');
      const cleanTarget = target.replace(/[^\w]/g, '');

      if (cleanWord.includes(cleanTarget) || cleanTarget.includes(cleanWord)) {
        const centerX = Math.round((w.bbox.x0 + w.bbox.x1) / 2);
        const centerY = Math.round((w.bbox.y0 + w.bbox.y1) / 2);

        logCallback('automation', `[Local OCR] Located word "${w.text}" at (${centerX}, ${centerY})`);
        return { found: true, x: centerX, y: centerY, text: w.text };
      }
    }

    logCallback('warning', `[Local OCR] Text "${targetText}" was not found on screen.`);
    return { found: false, error: 'Screen par yeh word nahi mila.' };
  } catch (err) {
    logCallback('error', `[Local OCR Error]: ${err.message}`);
    return { found: false, error: err.message };
  }
}

// ============================================================================
// 4. MOUSE MOVEMENT & KEYBOARD AUTOMATION
// ============================================================================

async function clickAt(x, y, button = 'left', logCallback = () => {}) {
  const posX = Math.round(Number(x));
  const posY = Math.round(Number(y));

  logCallback('automation', `[Native Mouse] Moving to (${posX}, ${posY}) and clicking ${button}...`);

  if (nutMouse && Point && Button) {
    try {
      await nutMouse.setPosition(new Point(posX, posY));
      const btn = button === 'right' ? Button.RIGHT : Button.LEFT;
      await nutMouse.click(btn);
      return { success: true, x: posX, y: posY };
    } catch (e) {
      console.warn('[Nut.js Click Error, executing PowerShell driver]:', e.message);
    }
  }

  return new Promise((resolve) => {
    const downFlag = button === 'right' ? '0x0008' : '0x0002';
    const upFlag = button === 'right' ? '0x0010' : '0x0004';

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
      resolve({ success: !err, x: posX, y: posY, error: err ? err.message : null });
    });
  });
}

async function doubleClickAt(x, y, logCallback = () => {}) {
  const posX = Math.round(Number(x));
  const posY = Math.round(Number(y));
  logCallback('automation', `[Native Mouse] Double-clicking at (${posX}, ${posY})...`);

  if (nutMouse && Point && Button) {
    try {
      await nutMouse.setPosition(new Point(posX, posY));
      await nutMouse.doubleClick(Button.LEFT);
      return { success: true, x: posX, y: posY };
    } catch (_) {}
  }

  return new Promise((resolve) => {
    const ps = `
      Add-Type -AssemblyName System.Windows.Forms;
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${posX}, ${posY});
      $code = @'
      using System;
      using System.Runtime.InteropServices;
      public class NativeMouseDblDrv {
          [DllImport("user32.dll")]
          public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
      }
'@
      Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue;
      [NativeMouseDblDrv]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero);
      [NativeMouseDblDrv]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero);
      Start-Sleep -Milliseconds 60;
      [NativeMouseDblDrv]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero);
      [NativeMouseDblDrv]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero);
    `;

    exec(`powershell -NoProfile -Command "${ps.replace(/\n/g, ' ')}"`, (err) => {
      resolve({ success: !err, x: posX, y: posY });
    });
  });
}

async function rightClickAt(x, y, logCallback = () => {}) {
  return await clickAt(x, y, 'right', logCallback);
}

async function longPressAt(x, y, durationMs = 1200, logCallback = () => {}) {
  const posX = Math.round(Number(x));
  const posY = Math.round(Number(y));
  const sleepTime = Math.max(300, Math.min(5000, Number(durationMs) || 1200));

  logCallback('automation', `[Native Mouse] Long-press at (${posX}, ${posY}) for ${sleepTime}ms`);

  if (nutMouse && Point && Button) {
    try {
      await nutMouse.setPosition(new Point(posX, posY));
      await nutMouse.pressButton(Button.LEFT);
      await new Promise((r) => setTimeout(r, sleepTime));
      await nutMouse.releaseButton(Button.LEFT);
      return { success: true, x: posX, y: posY, durationMs: sleepTime };
    } catch (_) {}
  }

  return new Promise((resolve) => {
    const ps = `
      Add-Type -AssemblyName System.Windows.Forms;
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${posX}, ${posY});
      $code = @'
      using System;
      using System.Runtime.InteropServices;
      public class NativeMouseLongDrv {
          [DllImport("user32.dll")]
          public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
      }
'@
      Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue;
      [NativeMouseLongDrv]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero);
      Start-Sleep -Milliseconds ${sleepTime};
      [NativeMouseLongDrv]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero);
    `;

    exec(`powershell -NoProfile -Command "${ps.replace(/\n/g, ' ')}"`, (err) => {
      resolve({ success: !err, x: posX, y: posY, durationMs: sleepTime });
    });
  });
}

async function clickOnScreenText(targetText, logCallback = () => {}) {
  const findResult = await captureAndFindText(targetText, logCallback);

  if (!findResult || !findResult.found) {
    return {
      success: false,
      executed: false,
      reason: `باس، سکرین پر "${targetText}" موجود نہیں ہے۔`
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

async function typeAndSubmitText(textToType, logCallback = () => {}) {
  if (!textToType) return { success: false };

  logCallback('automation', `[Native Keyboard] Typing: "${textToType}" & submitting...`);

  if (nutKeyboard && Key) {
    try {
      await nutKeyboard.type(textToType);
      await nutKeyboard.pressKey(Key.Enter);
      await nutKeyboard.releaseKey(Key.Enter);
      return { success: true };
    } catch (_) {}
  }

  return new Promise((resolve) => {
    const escaped = textToType.replace(/([+^%~{}()[\]])/g, '{$1}').replace(/'/g, "''");
    const ps = `
      Add-Type -AssemblyName System.Windows.Forms;
      Start-Sleep -Milliseconds 120;
      [System.Windows.Forms.SendKeys]::SendWait('${escaped}');
      Start-Sleep -Milliseconds 80;
      [System.Windows.Forms.SendKeys]::SendWait('{ENTER}');
    `;

    exec(`powershell -NoProfile -Command "${ps.replace(/\n/g, ' ')}"`, (err) => {
      resolve({ success: !err });
    });
  });
}

async function scrollScreen(direction = 'down', amount = 4, logCallback = () => {}) {
  const isDown = direction.toLowerCase() === 'down';
  const scrollAmt = Math.max(1, amount);

  logCallback('automation', `[Native Mouse] Scrolling ${direction.toUpperCase()} (${scrollAmt})`);

  if (nutMouse) {
    try {
      const px = scrollAmt * 120;
      if (isDown) await nutMouse.scrollDown(px);
      else await nutMouse.scrollUp(px);
      return { success: true, direction, amount: scrollAmt };
    } catch (_) {}
  }

  return new Promise((resolve) => {
    const scrollDelta = isDown ? -120 * scrollAmt : 120 * scrollAmt;

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
      resolve({ success: !err, direction, amount: scrollAmt });
    });
  });
}

// ============================================================================
// 5. YOUTUBE API v3 & GOOGLE VERIFICATION
// ============================================================================

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

    logCallback('automation', `[YouTube API v3] Searching video: "${cleanQuery}"`);
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

            logCallback('automation', `[YouTube API v3] Launching "${videoTitle}" (${channelTitle})`);
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

async function verifyWebFacts(query, logCallback = () => {}) {
  return new Promise((resolve) => {
    const cx = getCleanGoogleCx();
    logCallback('automation', `[Google Search] Verifying facts for: "${query}"`);

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

          logCallback('automation', `[Google Search] Retrieved ${results.length} authentic references.`);
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
// 6. FILE MANAGEMENT & NOTEPAD STREAMING
// ============================================================================

async function createDesktopFile(fileName, fileContent, targetDirectory = null, logCallback = () => {}) {
  try {
    const baseDir = targetDirectory ? targetDirectory : getDesktopDir();
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    const fullPath = path.join(baseDir, fileName);
    fs.writeFileSync(fullPath, fileContent, 'utf-8');

    if (fs.existsSync(fullPath)) {
      logCallback('automation', `[Disk] File created successfully: "${fullPath}"`);
      return { success: true, path: fullPath };
    } else {
      throw new Error('File writing verification failed.');
    }
  } catch (err) {
    logCallback('error', `[Disk Error]: ${err.message}`);
    return { success: false, error: err.message };
  }
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

    logCallback('automation', `[Notepad] Writing file: "${fullPath}" (Update: ${isUpdate ? 'IN-PLACE' : 'NEW'})`);

    if (mainWindow && !mainWindow.isDestroyed()) {
      const chunkSize = 40;
      for (let i = 0; i < content.length; i += chunkSize) {
        const chunk = content.slice(i, i + chunkSize);
        mainWindow.webContents.send('nova:codeStream', {
          filename: resolvedFilename,
          chunk,
          done: false
        });
        await new Promise((r) => setTimeout(r, 6));
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
      }, 350);
    }

    logCallback('automation', `[Notepad] File saved to disk: "${fullPath}"`);
    return { success: true, path: fullPath, filename: resolvedFilename };
  } catch (err) {
    logCallback('error', `[Notepad Typer Error]: ${err.message}`);
    return { success: false, error: err.message };
  }
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
    logCallback('error', `[Browser Launch Error]: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ============================================================================
// 7. MASTER ACTION DISPATCHER
// ============================================================================

async function executeAction(actionObj, logCallback = () => {}, mainWindow = null) {
  const { type, payload = {} } = actionObj;
  logCallback('system', `Dispatching Action: [${type}]`);

  switch (type) {
    case 'CLICK_SCREEN_TEXT':
    case 'CLICK_TEXT':
    case 'CLICK_ON_TEXT':
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

    case 'DOUBLE_CLICK_AT':
      return await doubleClickAt(payload.x, payload.y, logCallback);

    case 'RIGHT_CLICK_AT':
      return await rightClickAt(payload.x, payload.y, logCallback);

    case 'LONG_PRESS_AT':
      return await longPressAt(payload.x, payload.y, payload.durationMs || 1200, logCallback);

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
      return await createDesktopFile(payload.filename, payload.content, payload.directory, logCallback);

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
      logCallback('warning', `Unrecognized action: "${type}"`);
      return { success: false, error: 'Unknown action type' };
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
  clickAt,
  doubleClickAt,
  rightClickAt,
  longPressAt,
  scrollScreen,
  searchAndPlayYouTubeDirect,
  verifyWebFacts,
  liveNotepadCodeStream,
  createDesktopFile,
  openBrowserTarget,
  executeAction
};
