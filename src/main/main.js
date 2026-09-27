const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');

// 1. Process-Level Exception Handlers (Intercept any early crash & show native alert)
function writeEmergencyLog(type, err) {
  const message = `[${new Date().toISOString()}] ${type}:\n${(err && err.stack) || err}\n\n`;
  try {
    const userDataPath = app.getPath('userData');
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    fs.writeFileSync(path.join(userDataPath, 'crash.log'), message, { flag: 'a' });
  } catch (_) {
    try {
      const tempPath = path.join(app.getPath('temp'), 'nova-crash.log');
      fs.writeFileSync(tempPath, message, { flag: 'a' });
    } catch (_) {}
  }
}

process.on('uncaughtException', (error) => {
  writeEmergencyLog('Uncaught Exception', error);
  dialog.showErrorBox(
    'NOVA AI Startup Error',
    `A critical exception occurred in the main process:\n\n${(error && error.stack) || error}`
  );
});

process.on('unhandledRejection', (reason) => {
  writeEmergencyLog('Unhandled Rejection', reason);
  dialog.showErrorBox(
    'NOVA AI Runtime Rejection',
    `An unhandled promise rejection occurred:\n\n${(reason && reason.stack) || reason}`
  );
});

// 2. Safe Helper Loader
let automation = null;
let vision = null;
let ttsEngine = null;
let aiEngine = null;

try {
  automation = require('./automation');
} catch (e) {
  writeEmergencyLog('Automation Module Load Warning', e);
}

try {
  vision = require('./vision');
} catch (e) {
  writeEmergencyLog('Vision Module Load Warning', e);
}

try {
  ttsEngine = require('./tts_engine');
} catch (e) {
  writeEmergencyLog('TTS Module Load Warning', e);
}

try {
  aiEngine = require('./ai_engine');
} catch (e) {
  writeEmergencyLog('AI Engine Module Load Warning', e);
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

function getSettingsFilePath() {
  return path.join(app.getPath('userData'), 'nova_config.json');
}

function readSettings() {
  try {
    const filePath = getSettingsFilePath();
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8');
      return DEFAULT_SETTINGS;
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return { ...DEFAULT_SETTINGS, ...data };
  } catch (err) {
    writeEmergencyLog('Settings Read Fault', err);
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(newConfig) {
  try {
    const filePath = getSettingsFilePath();
    fs.writeFileSync(filePath, JSON.stringify(newConfig, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    writeEmergencyLog('Settings Write Fault', err);
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

// 3. Dynamic Path Resolvers for Packaged & Unpackaged Deployments
function resolvePreloadPath() {
  const candidates = [
    path.join(__dirname, '../preload.js'),
    path.join(__dirname, 'preload.js'),
    path.join(app.getAppPath(), 'src', 'preload.js'),
    path.join(app.getAppPath(), 'preload.js')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback to default relative path
  return path.join(__dirname, '../preload.js');
}

function resolveHtmlPath() {
  const candidates = [
    path.join(__dirname, '../../dist/index.html'),
    path.join(__dirname, '../dist/index.html'),
    path.join(app.getAppPath(), 'dist', 'index.html'),
    path.join(process.cwd(), 'dist', 'index.html')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function createWindow() {
  const resolvedPreload = resolvePreloadPath();

  mainWindow = new BrowserWindow({
    width: 1340,
    height: 880,
    minWidth: 1080,
    minHeight: 740,
    backgroundColor: '#030712',
    show: false,
    frame: true,
    webPreferences: {
      preload: resolvedPreload,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  const isDev = !app.isPackaged && (process.env.NODE_ENV === 'development' || process.argv.includes('--dev'));

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      loadProductionIndex(mainWindow);
    });
  } else {
    loadProductionIndex(mainWindow);
  }

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    writeEmergencyLog('Renderer Gone', details.reason);
  });
}

function loadProductionIndex(targetWindow) {
  const resolvedHtml = resolveHtmlPath();

  if (resolvedHtml) {
    targetWindow.loadFile(resolvedHtml).catch((err) => {
      dialog.showErrorBox(
        'NOVA Load Error',
        `Failed to load bundle from:\n${resolvedHtml}\n\nError: ${err.message}`
      );
    });
  } else {
    const errorHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { background: #030712; color: #f87171; font-family: monospace; padding: 40px; }
            h2 { color: #38bdf8; }
            pre { background: #0b1120; padding: 15px; border-radius: 8px; color: #cbd5e1; }
          </style>
        </head>
        <body>
          <h2>NOVA AI - Production Asset Load Fault</h2>
          <p>Could not locate the compiled <strong>dist/index.html</strong> entry point.</p>
          <p>App Root: ${app.getAppPath()}</p>
          <p>Execution Directory: ${__dirname}</p>
        </body>
      </html>
    `;
    targetWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
  }
}

// 4. Single-Instance Lock Enforcement
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
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
      writeEmergencyLog('Session Permission Warning', e);
    }

    createWindow();

    // IPC Handlers
    ipcMain.handle('nova:getSettings', () => readSettings());
    ipcMain.handle('nova:saveSettings', (_, data) => writeSettings(data));

    ipcMain.handle('nova:captureScreen', async () => {
      try {
        if (!vision || !vision.captureActiveDisplay) {
          throw new Error('Vision module unavailable.');
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
          throw new Error('TTS module unavailable.');
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
        return { success: false, error: 'Automation subsystem offline.' };
      }
      return await automation.createDesktopFile(filename, content, targetDir, broadcastLog);
    });

    ipcMain.handle('nova:openBrowser', async (_, { url, searchQuery }) => {
      if (!automation || !automation.openBrowserAndPlay) {
        return { success: false, error: 'Automation subsystem offline.' };
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
          broadcastLog('command', `User Directive: "${text}"`);
        } else if (audioBase64) {
          broadcastLog('command', 'User: [Voice Directive Transmitted]');
        }

        if (!aiEngine || !aiEngine.runAIInference) {
          throw new Error('AI Router subsystem unavailable.');
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
          audioResult = await ttsEngine.synthesizeAudioStream(aiResponse.spokenResponse, config.voice || 'en-US-AriaNeural');
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
