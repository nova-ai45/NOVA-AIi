const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');

// 1. Prevent GPU crashes on varied Windows hardware configurations
app.disableHardwareAcceleration();

// 2. Emergency File & Dialog Crash Logger (Executes before any other imports)
function logEmergencyCrash(type, error) {
  const errString = (error && error.stack) ? error.stack : String(error);
  const logMessage = `[${new Date().toISOString()}] ${type}:\n${errString}\n\n`;

  try {
    const userData = app.getPath('userData');
    if (!fs.existsSync(userData)) {
      fs.mkdirSync(userData, { recursive: true });
    }
    fs.writeFileSync(path.join(userData, 'nova_startup_crash.log'), logMessage, { flag: 'a' });
  } catch (_) {
    try {
      const tempPath = path.join(app.getPath('temp'), 'nova_startup_crash.log');
      fs.writeFileSync(tempPath, logMessage, { flag: 'a' });
    } catch (__) {}
  }
}

process.on('uncaughtException', (error) => {
  logEmergencyCrash('Uncaught Exception', error);
  dialog.showErrorBox(
    'NOVA AI - Startup Exception',
    `A critical exception occurred in the main process:\n\n${(error && error.stack) || error}`
  );
});

process.on('unhandledRejection', (reason) => {
  logEmergencyCrash('Unhandled Rejection', reason);
  dialog.showErrorBox(
    'NOVA AI - Unhandled Rejection',
    `An unhandled asynchronous rejection occurred:\n\n${(reason && reason.stack) || reason}`
  );
});

// 3. Isolated Module Loaders (Prevents background errors from blocking UI boot)
let automation = null;
let vision = null;
let ttsEngine = null;
let aiEngine = null;

try {
  automation = require('./automation');
} catch (e) {
  logEmergencyCrash('Automation Module Warning', e);
}

try {
  vision = require('./vision');
} catch (e) {
  logEmergencyCrash('Vision Module Warning', e);
}

try {
  ttsEngine = require('./tts_engine');
} catch (e) {
  logEmergencyCrash('TTS Engine Warning', e);
}

try {
  aiEngine = require('./ai_engine');
} catch (e) {
  logEmergencyCrash('AI Engine Warning', e);
}

let mainWindow = null;

const DEFAULT_SETTINGS = {
  provider: 'gemini',
  geminiKey: '',
  geminiModel: 'gemini-2.0-flash',
  openrouterKey: '',
  openrouterModel: 'meta-llama/llama-3.3-70b-instruct:free',
  openaiKey: '',
  openaiModel: 'gpt-4o',
  customBaseURL: 'https://api.groq.com/openai/v1',
  customKey: '',
  customModel: 'llama-3.3-70b-versatile',
  voice: 'en-US-AriaNeural',
  autoSpeak: true,
  autoVision: true,
  autoFailover: true
};

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'nova_config.json');
}

function readSettings() {
  try {
    const configPath = getSettingsPath();
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8');
      return DEFAULT_SETTINGS;
    }
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return { ...DEFAULT_SETTINGS, ...data };
  } catch (err) {
    logEmergencyCrash('Settings Read Warning', err);
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(newConfig) {
  try {
    const configPath = getSettingsPath();
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    logEmergencyCrash('Settings Write Warning', err);
    return { success: false, error: err.message };
  }
}

function broadcastLog(type, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('nova:log', {
      timestamp: new Date().toLocaleTimeString(),
      type,
      message
    });
  }
}

function broadcastState(state) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('nova:state', state);
  }
}

// 4. Robust Path Resolvers for Production (.asar) & Development
function resolvePreloadPath() {
  const candidates = [
    path.join(__dirname, '../preload.js'),
    path.join(__dirname, 'preload.js'),
    path.join(app.getAppPath(), 'src', 'preload.js'),
    path.join(app.getAppPath(), 'preload.js'),
    path.resolve(__dirname, '..', 'preload.js')
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (_) {}
  }
  return path.join(__dirname, '../preload.js');
}

function resolveIndexPath() {
  const candidates = [
    path.join(__dirname, '../../dist/index.html'),
    path.join(__dirname, '../dist/index.html'),
    path.join(app.getAppPath(), 'dist', 'index.html'),
    path.join(process.cwd(), 'dist', 'index.html')
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (_) {}
  }
  return null;
}

function createWindow() {
  const preloadResolved = resolvePreloadPath();

  mainWindow = new BrowserWindow({
    width: 1340,
    height: 880,
    minWidth: 1080,
    minHeight: 740,
    backgroundColor: '#030712',
    show: false,
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadResolved,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      sandbox: false
    }
  });

  // Ensure window displays even if ready-to-show stalls
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 2000);

  const isDev = !app.isPackaged && (process.env.NODE_ENV === 'development' || process.argv.includes('--dev'));

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      loadProductionBuild(mainWindow);
    });
  } else {
    loadProductionBuild(mainWindow);
  }

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logEmergencyCrash('Renderer Crash', details.reason);
  });
}

function loadProductionBuild(targetWindow) {
  const resolvedHtml = resolveIndexPath();

  if (resolvedHtml) {
    targetWindow.loadFile(resolvedHtml).catch((err) => {
      dialog.showErrorBox(
        'NOVA AI Load Error',
        `Failed to load compiled HTML from:\n${resolvedHtml}\n\nError: ${err.message}`
      );
    });
  } else {
    // Diagnostic Fallback Screen
    const appDir = app.getAppPath();
    const fallbackHTML = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { background: #030712; color: #f87171; font-family: sans-serif; padding: 40px; }
            h2 { color: #38bdf8; }
            code { background: #0b1120; padding: 4px 8px; border-radius: 4px; color: #e2e8f0; }
          </style>
        </head>
        <body>
          <h2>NOVA AI - Production Assets Not Found</h2>
          <p>Could not locate the compiled <code>dist/index.html</code>.</p>
          <p>Make sure <code>npm run build:renderer</code> was executed prior to packaging.</p>
          <p>Searched root: <code>${appDir}</code></p>
        </body>
      </html>
    `;
    targetWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fallbackHTML)}`);
  }
}

// 5. Single Instance Lock
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    try {
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(true);
      });
      session.defaultSession.setPermissionCheckHandler(() => true);
    } catch (e) {
      logEmergencyCrash('Session Permissions Warning', e);
    }

    createWindow();

    // 6. Registered IPC Handlers
    ipcMain.handle('nova:getSettings', () => readSettings());
    ipcMain.handle('nova:saveSettings', (_, data) => writeSettings(data));

    ipcMain.handle('nova:captureScreen', async () => {
      try {
        if (!vision || !vision.captureActiveDisplay) {
          throw new Error('Vision subsystem unavailable.');
        }
        const screenshotBase64 = await vision.captureActiveDisplay();
        return { success: true, imageBase64: screenshotBase64 };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });

    ipcMain.handle('nova:speak', async (_, { text, voice }) => {
      try {
        if (!ttsEngine || !ttsEngine.synthesizeAudioStream) {
          throw new Error('TTS subsystem unavailable.');
        }
        broadcastState('speaking');
        const settings = readSettings();
        const selectedVoice = voice || settings.voice || 'en-US-AriaNeural';
        const base64Audio = await ttsEngine.synthesizeAudioStream(text, selectedVoice);
        return { success: true, base64Audio };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('nova:createFile', async (_, { filename, content, targetDir }) => {
      if (!automation || !automation.createDesktopFile) {
        return { success: false, error: 'Automation subsystem unavailable.' };
      }
      return await automation.createDesktopFile(filename, content, targetDir, broadcastLog);
    });

    ipcMain.handle('nova:openBrowser', async (_, { url, searchQuery }) => {
      if (!automation || !automation.openBrowserAndPlay) {
        return { success: false, error: 'Automation subsystem unavailable.' };
      }
      return await automation.openBrowserAndPlay(url, searchQuery, false, broadcastLog);
    });

    ipcMain.handle('nova:processCommand', async (_, { text, audioBase64, includeVision }) => {
      const config = readSettings();
      try {
        broadcastState('processing');

        let visionData = null;
        if (includeVision && vision && vision.getLatestScreenContext) {
          visionData = await vision.getLatestScreenContext();
        }

        if (text) {
          broadcastLog('command', `Directive: "${text}"`);
        } else if (audioBase64) {
          broadcastLog('command', 'Directive: [Voice Audio Received]');
        }

        if (!aiEngine || !aiEngine.runAIInference) {
          throw new Error('AI Engine subsystem unavailable.');
        }

        const aiResponse = await aiEngine.runAIInference(text, audioBase64, visionData, config);

        if (aiResponse.actions && Array.isArray(aiResponse.actions) && automation && automation.executeAction) {
          for (const action of aiResponse.actions) {
            broadcastState('executing');
            await automation.executeAction(action, broadcastLog);
          }
        }

        let audioResult = null;
        if (config.autoSpeak && aiResponse.spokenResponse && ttsEngine && ttsEngine.synthesizeAudioStream) {
          broadcastState('speaking');
          audioResult = await ttsEngine.synthesizeAudioStream(
            aiResponse.spokenResponse,
            config.voice || 'en-US-AriaNeural'
          );
        }

        broadcastState('idle');
        return {
          success: true,
          spokenResponse: aiResponse.spokenResponse,
          actions: aiResponse.actions,
          audioBase64: audioResult
        };
      } catch (err) {
        broadcastState('idle');
        const spokenError = `Notice: ${err.message.replace(/https?:\/\/[^\s]+/g, '')}`;
        broadcastLog('error', err.message);

        let errorAudio = null;
        if (ttsEngine && ttsEngine.synthesizeAudioStream) {
          try {
            errorAudio = await ttsEngine.synthesizeAudioStream(spokenError, config.voice || 'en-US-AriaNeural');
          } catch (_) {}
        }

        return {
          success: false,
          error: err.message,
          spokenResponse: spokenError,
          audioBase64: errorAudio
        };
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
