const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 1. Hardware acceleration safety
try {
  app.disableHardwareAcceleration();
} catch (_) {}

// 2. Emergency Crash Logger
function logEmergencyCrash(type, error) {
  const errString = error && error.stack ? error.stack : String(error);
  const logMessage = `[${new Date().toISOString()}] ${type}:\n${errString}\n\n`;
  try {
    const tempPath = path.join(os.tmpdir(), 'nova_startup_crash.log');
    fs.writeFileSync(tempPath, logMessage, { flag: 'a' });
  } catch (_) {}
}

process.on('uncaughtException', (error) => {
  logEmergencyCrash('Uncaught Exception', error);
  dialog.showErrorBox('NOVA AI Startup Exception', `${(error && error.stack) || error}`);
});

process.on('unhandledRejection', (reason) => {
  logEmergencyCrash('Unhandled Rejection', reason);
});

// 3. Single Instance Lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.exit(0);
}

let automation = null;
let vision = null;
let ttsEngine = null;
let aiEngine = null;

try { automation = require('./automation'); } catch (e) { logEmergencyCrash('Automation Load', e); }
try { vision = require('./vision'); } catch (e) { logEmergencyCrash('Vision Load', e); }
try { ttsEngine = require('./tts_engine'); } catch (e) { logEmergencyCrash('TTS Load', e); }
try { aiEngine = require('./ai_engine'); } catch (e) { logEmergencyCrash('AI Load', e); }

let mainWindow = null;

const DEFAULT_SETTINGS = {
  provider: 'gemini',
  geminiKey: '',
  geminiModel: 'gemini-2.5-flash',
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
  const userDir = app.getPath('userData');
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  return path.join(userDir, 'nova_persistent_config.json');
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

function resolvePreloadPath() {
  const candidates = [
    path.join(__dirname, '../preload.js'),
    path.join(__dirname, 'preload.js'),
    path.join(app.getAppPath(), 'src', 'preload.js'),
    path.join(app.getAppPath(), 'preload.js'),
    path.resolve(__dirname, '..', 'preload.js')
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch (_) {}
  }
  return path.join(__dirname, '../preload.js');
}

function resolveIndexPath() {
  const candidates = [
    path.join(__dirname, '../../dist/index.html'),
    path.join(__dirname, '../dist/index.html'),
    path.join(app.getAppPath(), 'dist', 'index.html'),
    path.join(process.cwd(), 'dist', 'index.html'),
    path.join(process.resourcesPath, 'app.asar', 'dist', 'index.html')
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch (_) {}
  }
  return null;
}

function createWindow() {
  const preloadResolved = resolvePreloadPath();

  // Native Windows frame enabled: OS-native minimize, maximize, and clean exit
  mainWindow = new BrowserWindow({
    title: 'NOVA AI',
    width: 1340,
    height: 880,
    minWidth: 1080,
    minHeight: 740,
    backgroundColor: '#030712',
    show: true,
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

  const isDev = !app.isPackaged && process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => loadProductionBuild(mainWindow));
  } else {
    loadProductionBuild(mainWindow);
  }

  // Absolute privacy shutdown: when window is closed, cleanly tear down the entire application
  mainWindow.on('close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('nova:systemShutdown');
    }
    if (ttsEngine && ttsEngine.cancelActiveTTS) {
      ttsEngine.cancelActiveTTS();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });
}

function loadProductionBuild(targetWindow) {
  const resolvedHtml = resolveIndexPath();
  if (resolvedHtml) {
    targetWindow.loadFile(resolvedHtml).catch((err) => {
      dialog.showErrorBox('NOVA AI Load Fault', `Error: ${err.message}`);
    });
  } else {
    const fallbackHTML = `
      <!DOCTYPE html><html><body style="background:#030712;color:#f87171;font-family:sans-serif;padding:40px;">
      <h2>NOVA AI - Assets Not Found</h2>
      <p>Ensure <code>npm run build:renderer</code> ran prior to packaging.</p></body></html>
    `;
    targetWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fallbackHTML)}`);
  }
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(true));
  session.defaultSession.setPermissionCheckHandler(() => true);

  createWindow();

  ipcMain.handle('nova:getSettings', () => readSettings());
  ipcMain.handle('nova:saveSettings', (_, data) => writeSettings(data));

  ipcMain.handle('nova:captureScreen', async () => {
    try {
      if (!vision || !vision.captureActiveDisplay) return { success: false, error: 'Vision unavailable' };
      const screenshotBase64 = await vision.captureActiveDisplay();
      return { success: true, imageBase64: screenshotBase64 };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('nova:speak', async (_, { text, voice }) => {
    try {
      if (!ttsEngine || !ttsEngine.synthesizeAudioStream) return { success: false };
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
    if (!automation || !automation.createDesktopFile) return { success: false };
    return await automation.createDesktopFile(filename, content, targetDir, broadcastLog);
  });

  ipcMain.handle('nova:openBrowser', async (_, { url, searchQuery }) => {
    if (!automation || !automation.openBrowserAndPlay) return { success: false };
    return await automation.openBrowserAndPlay(url, searchQuery, false, broadcastLog);
  });

  ipcMain.handle('nova:processCommand', async (_, { text, audioBase64, includeVision }) => {
    const config = readSettings();
    try {
      broadcastState('thinking');

      let visionData = null;
      if (includeVision && vision && vision.getLatestScreenContext) {
        visionData = await vision.getLatestScreenContext();
      }

      if (text) broadcastLog('command', `User Directive: "${text}"`);

      if (!aiEngine || !aiEngine.runAIInferenceStream) {
        throw new Error('AI Engine subsystem offline.');
      }

      // Ultra-low latency streaming inference
      const aiResponse = await aiEngine.runAIInferenceStream(
        text,
        audioBase64,
        visionData,
        config,
        (streamChunk) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('nova:aiStreamChunk', streamChunk);
          }
        },
        async (earlySentence) => {
          // Immediately synthesize speech on the very first completed sentence
          if (config.autoSpeak && ttsEngine && ttsEngine.synthesizeAudioStream) {
            broadcastState('speaking');
            const earlyAudio = await ttsEngine.synthesizeAudioStream(earlySentence, config.voice || 'en-US-AriaNeural');
            if (earlyAudio && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('nova:earlyAudioChunk', earlyAudio);
            }
          }
        }
      );

      // Execute OS automation commands
      if (aiResponse.actions && Array.isArray(aiResponse.actions) && automation && automation.executeAction) {
        for (const action of aiResponse.actions) {
          broadcastState('executing');
          await automation.executeAction(action, broadcastLog, mainWindow);
        }
      }

      let audioResult = null;
      if (config.autoSpeak && aiResponse.spokenResponse && ttsEngine && ttsEngine.synthesizeAudioStream) {
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
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized() || !mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();
  }
});

// Absolute privacy cleanup on app close
app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('window-all-closed', () => {
  app.quit();
});
