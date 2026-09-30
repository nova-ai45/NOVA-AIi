const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
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

// ============================================================================
// 🧠 SMRITI: PERSISTENT LOCAL MEMORY STORAGE (userData/nova_memory.json)
// ============================================================================
function getMemoryFilePath() {
  const userDir = app.getPath('userData');
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  return path.join(userDir, 'nova_memory.json');
}

function loadLocalPersistentMemory() {
  try {
    const memFile = getMemoryFilePath();
    if (!fs.existsSync(memFile)) {
      fs.writeFileSync(memFile, JSON.stringify([], null, 2), 'utf-8');
      return [];
    }
    const data = JSON.parse(fs.readFileSync(memFile, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('[Smriti Memory] Load error, resetting:', e.message);
    return [];
  }
}

function saveLocalPersistentMemory(history) {
  try {
    const memFile = getMemoryFilePath();
    const sanitized = Array.isArray(history) ? history.slice(-30) : [];
    fs.writeFileSync(memFile, JSON.stringify(sanitized, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[Smriti Memory] Save error:', e.message);
    return false;
  }
}

function clearLocalPersistentMemory() {
  try {
    const memFile = getMemoryFilePath();
    fs.writeFileSync(memFile, JSON.stringify([], null, 2), 'utf-8');
    return true;
  } catch (e) {
    return false;
  }
}

// In-Memory Persistent Context Cache
let globalSmritiContext = loadLocalPersistentMemory();

// ============================================================================
// CONFIG SETTINGS
// ============================================================================
const DEFAULT_SETTINGS = {
  provider: 'gemini',
  geminiKey: '',
  geminiModel: 'gemini-2.0-flash',
  openrouterKey: '',
  openrouterModel: 'meta-llama/llama-3.3-70b-instruct:free',
  voice: 'hi-IN-SwaraNeural',
  autoSpeak: true,
  autoVision: true,
  isRoastModeEnabled: false
};

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'nova_persistent_config.json');
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

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'NOVA AI',
    width: 1340,
    height: 880,
    minWidth: 1080,
    minHeight: 740,
    backgroundColor: '#07080c',
    show: true,
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      sandbox: false
    }
  });

  const isDev = !app.isPackaged && process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('close', () => {
    saveLocalPersistentMemory(globalSmritiContext);
    if (ttsEngine && ttsEngine.cancelActiveTTS) {
      ttsEngine.cancelActiveTTS();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(true));
  session.defaultSession.setPermissionCheckHandler(() => true);

  createWindow();

  // IPC Handlers for Settings & Smriti Memory
  ipcMain.handle('nova:getSettings', () => readSettings());
  ipcMain.handle('nova:saveSettings', (_, data) => writeSettings(data));

  ipcMain.handle('nova:loadMemory', () => {
    globalSmritiContext = loadLocalPersistentMemory();
    return globalSmritiContext;
  });

  ipcMain.handle('nova:clearMemory', () => {
    globalSmritiContext = [];
    return clearLocalPersistentMemory();
  });

  ipcMain.handle('nova:stopSpeech', () => {
    if (ttsEngine && ttsEngine.cancelActiveTTS) {
      ttsEngine.cancelActiveTTS();
    }
    return { success: true };
  });

  // Main Command Orchestration
  ipcMain.handle('nova:processCommand', async (_, { text, audioBase64, conversationHistory, includeVision }) => {
    const settings = readSettings();

    if (ttsEngine && ttsEngine.cancelActiveTTS) {
      ttsEngine.cancelActiveTTS();
    }

    try {
      broadcastState('thinking');

      let visionData = null;
      if (includeVision && vision && vision.getLatestScreenContext) {
        visionData = await vision.getLatestScreenContext();
      }

      // Merge persistent memory with active session history
      const historyContext = (conversationHistory && conversationHistory.length > 0)
        ? conversationHistory
        : globalSmritiContext;

      if (text) broadcastLog('command', `Directive: "${text}"`);

      // Grounded 2-Pass Execution: Action executes FIRST, real outcome determines response
      const aiResponse = await aiEngine.runAIInferenceStream(
        text,
        audioBase64,
        visionData,
        settings,
        historyContext,
        null,
        (streamChunk) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('nova:aiStreamChunk', streamChunk);
          }
        },
        broadcastLog,
        mainWindow
      );

      // Update and save persistent Smriti history
      if (aiResponse.spokenResponse) {
        globalSmritiContext.push({ role: 'user', text: text || '[Voice Directive]' });
        globalSmritiContext.push({ role: 'model', text: aiResponse.spokenResponse });
        saveLocalPersistentMemory(globalSmritiContext);
      }

      // Synthesize natural Edge Neural Voice
      let audioResult = null;
      const responseToSpeak = (aiResponse.spokenResponse || '').trim();

      if (settings.autoSpeak && responseToSpeak && ttsEngine && ttsEngine.synthesizeNeuralSpeech) {
        audioResult = await ttsEngine.synthesizeNeuralSpeech(
          responseToSpeak,
          settings.voice || 'hi-IN-SwaraNeural'
        );
      }

      broadcastState('idle');
      return {
        success: true,
        spokenResponse: responseToSpeak,
        actions: aiResponse.actions || [],
        audioBase64: audioResult,
        updatedMemory: globalSmritiContext
      };
    } catch (err) {
      broadcastState('idle');
      const spokenError = `Haye tauba! Ek masla aa gaya hai: ${err.message.replace(/https?:\/\/[^\s]+/g, '')}`;
      broadcastLog('error', err.message);

      return {
        success: false,
        error: err.message,
        spokenResponse: spokenError
      };
    }
  });
});

app.on('window-all-closed', () => {
  saveLocalPersistentMemory(globalSmritiContext);
  app.quit();
});
