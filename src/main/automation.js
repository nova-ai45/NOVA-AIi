const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { exec } = require('child_process');
const https = require('https');

// ============================================================================
// 🚨 EXISTING CREDENTIALS (INTACT - REUSED AS REQUESTED)
// ============================================================================
const YOUTUBE_DATA_API_KEY = "AIzaSyAKoG0eSXgMaIg4xWQSY7t9aof2dFW3zlw";
const GOOGLE_CUSTOM_SEARCH_API_KEY = "AIzaSyC63h7RvDVgpqDfiD_cKNteLp5QUlwzbEs";
const GOOGLE_SEARCH_ENGINE_CX = `<script async src="https://cse.google.com/cse.js?cx=e1b191a16183d4a47">
</script>
<div class="gcse-search"></div>`;

/**
 * Extracts clean search engine ID string from raw script/div tag
 */
function getCleanGoogleCx() {
  const match = GOOGLE_SEARCH_ENGINE_CX.match(/cx=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : "e1b191a16183d4a47";
}

function getDesktopDir() {
  return app.getPath('desktop');
}

let currentActiveProjectFile = null;

/**
 * Launches URL directly in Chrome (Windows) or system default browser
 */
function launchBrowserUrl(targetUrl, browserName = 'chrome') {
  if (process.platform === 'win32' && (browserName || 'chrome').toLowerCase().includes('chrome')) {
    exec(`start chrome "${targetUrl}"`, (err) => {
      if (err) shell.openExternal(targetUrl);
    });
  } else {
    shell.openExternal(targetUrl);
  }
}

/**
 * YouTube Data API v3 Direct Search & Instant Autoplay
 * - Uses existing YOUTUBE_DATA_API_KEY
 * - Searches YouTube Data API v3 for the top matching videoId
 * - Launches direct playback: https://www.youtube.com/watch?v=${videoId}
 * - Does NOT fallback to generic Google search unless the API call fails or yields zero items
 */
async function searchAndPlayYouTubeDirect(query, logCallback = () => {}, browserName = 'chrome') {
  return new Promise((resolve) => {
    // Strip conversational filler commands to isolate the exact song or video query
    const cleanQuery = (query || '')
      .replace(/^(play|chalao|sunao|laga do|chala do|bajao)\s+/i, '')
      .replace(/\s+(chalao|sunao|laga do|chala do|bajao|song|video)$/i, '')
      .trim();

    if (!cleanQuery) {
      const defaultUrl = 'https://www.youtube.com';
      logCallback('automation', `[YouTube] Empty query string. Launching YouTube homepage.`);
      launchBrowserUrl(defaultUrl, browserName);
      return resolve({ success: true, url: defaultUrl });
    }

    logCallback('automation', `[YouTube API v3] Searching top video for: "${cleanQuery}"`);

    const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(cleanQuery)}&type=video&maxResults=1&key=${YOUTUBE_DATA_API_KEY}`;

    const request = https.get(apiUrl, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const videoId = json.items && json.items[0]?.id?.videoId;

          if (videoId) {
            // Direct playback URL launched immediately
            const directPlayUrl = `https://www.youtube.com/watch?v=${videoId}`;
            const videoTitle = json.items[0]?.snippet?.title || cleanQuery;
            logCallback('automation', `[YouTube Direct Play] Video Found: "${videoTitle}" (${videoId}) -> Starting`);

            launchBrowserUrl(directPlayUrl, browserName);
            resolve({ success: true, videoId, videoTitle, url: directPlayUrl });
          } else {
            // API returned zero items -> Only then fallback to search results
            logCallback('automation', `[YouTube API] Zero videos returned for "${cleanQuery}". Opening search page.`);
            const fallbackUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`;
            launchBrowserUrl(fallbackUrl, browserName);
            resolve({ success: true, fallback: true, url: fallbackUrl });
          }
        } catch (err) {
          logCallback('error', `[YouTube API Parse Error]: ${err.message}. Falling back to search.`);
          const fallbackUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`;
          launchBrowserUrl(fallbackUrl, browserName);
          resolve({ success: true, fallback: true, url: fallbackUrl });
        }
      });
    });

    request.on('error', (err) => {
      logCallback('error', `[YouTube API Network Error]: ${err.message}. Opening search page.`);
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

/**
 * Live Notepad Code Streaming & In-Place File Updating
 */
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

    logCallback('automation', `[Notepad Typer] In-Place Target: "${fullPath}" (Update: ${isUpdate ? 'YES' : 'NEW'})`);

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

    logCallback('automation', `[Notepad] Successfully saved: "${fullPath}"`);
    return { success: true, path: fullPath, isUpdate };
  } catch (err) {
    logCallback('error', `[Notepad Typer Fault]: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Google Custom Search JSON API
 */
async function queryGoogleCustomSearch(query, logCallback = () => {}) {
  return new Promise((resolve) => {
    const cx = getCleanGoogleCx();
    logCallback('automation', `[Google Custom Search] Querying web facts for: "${query}"`);

    const apiUrl = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_CUSTOM_SEARCH_API_KEY}&cx=${cx}&q=${encodeURIComponent(query)}&num=3`;

    https.get(apiUrl, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const results = (json.items || []).map(item => ({
            title: item.title,
            snippet: item.snippet,
            link: item.link
          }));
          logCallback('automation', `[Google Search] Retrieved ${results.length} references.`);
          resolve({ success: true, results });
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    }).on('error', (err) => {
      logCallback('error', `[Google Search Fault]: ${err.message}`);
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Native Screen Touch, Click, Long-Press & Scroll
 */
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

async function doubleClickAt(x, y, logCallback = () => {}) {
  return new Promise((resolve) => {
    const posX = Math.round(Number(x));
    const posY = Math.round(Number(y));
    logCallback('automation', `[Native Mouse] Double-Click at (${posX}, ${posY})`);

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
      Start-Sleep -Milliseconds 75;
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
  return new Promise((resolve) => {
    const posX = Math.round(Number(x));
    const posY = Math.round(Number(y));
    const sleep = Math.max(300, Math.min(5000, Number(durationMs) || 1200));

    logCallback('automation', `[Native Mouse] Long-Press at (${posX}, ${posY}) for ${sleep}ms`);

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
      Start-Sleep -Milliseconds ${sleep};
      [NativeMouseLongDrv]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero);
    `;
    exec(`powershell -NoProfile -Command "${ps.replace(/\n/g, ' ')}"`, (err) => {
      resolve({ success: !err, x: posX, y: posY, durationMs: sleep });
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

/**
 * General Browser Navigation
 * Intercepts YouTube play queries and runs them through YouTube Data API v3 direct playback
 */
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

    logCallback('automation', `[Browser Launcher] Launching: "${finalUrl}" in ${browserName}`);
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
  liveNotepadCodeStream,
  searchAndPlayYouTubeDirect,
  queryGoogleCustomSearch,
  clickAt,
  doubleClickAt,
  rightClickAt,
  longPressAt,
  scrollScreen,
  openBrowserTarget,
  executeAction
};
