const { app, BrowserWindow, ipcMain, dialog, session, globalShortcut, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

try {
  app.disableHardwareAcceleration();
} catch (_) {}

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

// Single Instance Lock
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
let tray = null;

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

  mainWindow = new BrowserWindow({
    width: 1340,
    height: 880,
    minWidth: 1080,
    minHeight: 740,
    backgroundColor: '#030712',
    show: true,
    frame: false, // Frameless Glassmorphic Layout
    titleBarStyle: 'hidden',
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

  // Prevent app from quitting when window is closed (minimize to tray)
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
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
      <h2>NOVA AI - Production Assets Not Found</h2>
      <p>Please ensure <code>npm run build:renderer</code> ran before packaging.</p></body></html>
    `;
    targetWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fallbackHTML)}`);
  }
}

// System Tray Service for Background Voice Listening
function setupSystemTray() {
  try {
    const iconPath = path.join(__dirname, '../../public/favicon.ico');
    const trayIcon = fs.existsSync(iconPath) ? iconPath : null;
    tray = new Tray(trayIcon || path.join(app.getAppPath(), 'dist/favicon.ico'));
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Open NOVA AI', click: () => { mainWindow.show(); mainWindow.focus(); } },
      { type: 'separator' },
      { label: 'Quit NOVA', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setToolTip('NOVA AI - Neural Assistant (Listening in Background)');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
      mainWindow.show();
      mainWindow.focus();
    });
  } catch (_) {}
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(true));
  session.defaultSession.setPermissionCheckHandler(() => true);

  createWindow();
  setupSystemTray();

  // Register Global Hotkey (Ctrl + Space) to summon from background
  globalShortcut.register('CommandOrControl+Space', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized() || !mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
      broadcastState('listening');
    }
  });

  // Native Frameless Window IPC Controls
  ipcMain.on('nova:window:control', (_, action) => {
    if (!mainWindow) return;
    if (action === 'minimize') mainWindow.hide();
    else if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    else if (action === 'close') {
      mainWindow.hide();
    }
  });

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

  ipcMain.handle('nova:processCommand', async (_, { text, audioBase64, includeVision }) => {
    const config = readSettings();
    try {
      broadcastState('processing');

      let visionData = null;
      if (includeVision && vision && vision.getLatestScreenContext) {
        visionData = await vision.getLatestScreenContext();
      }

      if (text) broadcastLog('command', `Directive: "${text}"`);

      if (!aiEngine || !aiEngine.runAIInference) {
        throw new Error('AI Engine subsystem offline.');
      }

      const aiResponse = await aiEngine.runAIInference(text, audioBase64, visionData, config);

      if (aiResponse.actions && Array.isArray(aiResponse.actions) && automation && automation.executeAction) {
        for (const action of aiResponse.actions) {
          broadcastState('executing');
          await automation.executeAction(action, broadcastLog, mainWindow);
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
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
