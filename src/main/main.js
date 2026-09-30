const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

let si = null;
try {
  si = require('systeminformation');
} catch (e) {
  console.warn('[Hardware] systeminformation module not found, using OS fallback.');
}

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
// 🧠 LOCAL PERSISTENT MEMORY: memory.json in userData directory
// ============================================================================
function getMemoryFilePath() {
  const userDir = app.getPath('userData');
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  return path.join(userDir, 'memory.json');
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
    console.warn('[Persistent Memory] Failed to load, resetting:', e.message);
    return [];
  }
}

function saveLocalPersistentMemory(history) {
  try {
    const memFile = getMemoryFilePath();
    const sanitized = Array.isArray(history) ? history.slice(-40) : [];
    fs.writeFileSync(memFile, JSON.stringify(sanitized, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[Persistent Memory] Save failure:', e.message);
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

let globalMemoryContext = loadLocalPersistentMemory();

// ============================================================================
// APPLICATION SETTINGS
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

async function fetchFullHardwareStats() {
  try {
    if (si) {
      const [battery, load, mem, temp] = await Promise.all([
        si.battery().catch(() => ({ hasBattery: false })),
        si.currentLoad().catch(() => ({ currentLoad: 0 })),
        si.mem().catch(() => ({ total: 0, available: 0, used: 0 })),
        si.cpuTemperature().catch(() => ({ main: 0 }))
      ]);

      const totalMemGb = (mem.total / (1024 ** 3)).toFixed(1);
      const usedMemGb = ((mem.total - mem.available) / (1024 ** 3)).toFixed(1);
      const ramPercent = mem.total ? Math.round(((mem.total - mem.available) / mem.total) * 100) : 0;

      return {
        battery: {
          hasBattery: battery.hasBattery,
          percent: battery.percent || 0,
          isCharging: battery.isCharging || false,
          acConnected: battery.acConnected || false
        },
        cpu: {
          loadPercent: Math.round(load.currentLoad || 0),
          tempC: temp.main || 0,
          cores: os.cpus().length,
          model: os.cpus()[0]?.model || 'Generic CPU'
        },
        ram: {
          totalGb: totalMemGb,
          usedGb: usedMemGb,
          usedPercent: ramPercent
        }
      };
    }
  } catch (e) {
    console.warn('[Hardware] Telemetry error:', e.message);
  }

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  return {
    battery: { hasBattery: false, percent: 100, isCharging: true, acConnected: true },
    cpu: { loadPercent: 25, tempC: 45, cores: os.cpus().length, model: os.cpus()[0]?.model || 'Generic' },
    ram: {
      totalGb: (totalMem / (1024 ** 3)).toFixed(1),
      usedGb: (usedMem / (1024 ** 3)).toFixed(1),
      usedPercent: Math.round((usedMem / totalMem) * 100)
    }
  };
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
      preload: preloadResolved,
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
    const resolvedHtml = resolveIndexPath();
    if (resolvedHtml) {
      mainWindow.loadFile(resolvedHtml);
    } else {
      loadProductionBuild(mainWindow);
    }
  }

  mainWindow.on('close', () => {
    saveLocalPersistentMemory(globalMemoryContext);
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
  const fallbackHTML = `
    <!DOCTYPE html><html><body style="background:#07080c;color:#ff7700;font-family:sans-serif;padding:40px;">
    <h2>NOVA AI - Production Assets Not Found</h2>
    <p>Please ensure <code>npm run build:renderer</code> ran prior to packaging.</p></body></html>
  `;
  targetWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fallbackHTML)}`);
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(true));
  session.defaultSession.setPermissionCheckHandler(() => true);

  createWindow();

  ipcMain.handle('nova:ping', () => {
    return { status: 'alive', timestamp: Date.now() };
  });

  ipcMain.handle('nova:getSettings', () => readSettings());
  ipcMain.handle('nova:saveSettings', (_, data) => writeSettings(data));

  ipcMain.handle('nova:getHardwareStats', async () => {
    return await fetchFullHardwareStats();
  });

  ipcMain.handle('nova:loadMemory', () => {
    globalMemoryContext = loadLocalPersistentMemory();
    return globalMemoryContext;
  });

  ipcMain.handle('nova:clearMemory', () => {
    globalMemoryContext = [];
    return clearLocalPersistentMemory();
  });

  ipcMain.handle('nova:clickAt', async (_, { x, y, button }) => {
    if (!automation || !automation.clickAt) return { success: false };
    return await automation.clickAt(x, y, button || 'left', broadcastLog);
  });

  ipcMain.handle('nova:doubleClickAt', async (_, { x, y }) => {
    if (!automation || !automation.doubleClickAt) return { success: false };
    return await automation.doubleClickAt(x, y, broadcastLog);
  });

  ipcMain.handle('nova:longPressAt', async (_, { x, y, durationMs }) => {
    if (!automation || !automation.longPressAt) return { success: false };
    return await automation.longPressAt(x, y, durationMs || 1200, broadcastLog);
  });

  ipcMain.handle('nova:stopSpeech', () => {
    if (ttsEngine && ttsEngine.cancelActiveTTS) {
      ttsEngine.cancelActiveTTS();
    }
    return { success: true };
  });

  ipcMain.handle('nova:speak', async (_, { text, voice }) => {
    try {
      if (!ttsEngine || !ttsEngine.synthesizeNeuralSpeech) return { success: false };
      const settings = readSettings();
      const selectedVoice = voice || settings.voice || 'hi-IN-SwaraNeural';
      const base64Audio = await ttsEngine.synthesizeNeuralSpeech(text, selectedVoice);
      return { success: true, base64Audio };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('nova:captureScreen', async () => {
    try {
      if (!vision || !vision.captureActiveDisplay) return { success: false, error: 'Vision unavailable' };
      const screenshotBase64 = await vision.captureActiveDisplay();
      return { success: true, imageBase64: screenshotBase64 };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('nova:createFile', async (_, { filename, content, targetDir, isUpdate }) => {
    if (!automation || !automation.liveNotepadCodeStream) return { success: false };
    return await automation.liveNotepadCodeStream(filename, content, targetDir, isUpdate, broadcastLog, mainWindow);
  });

  ipcMain.handle('nova:openBrowser', async (_, { url, searchQuery, browser }) => {
    if (!automation || !automation.openBrowserTarget) return { success: false };
    return await automation.openBrowserTarget(url, searchQuery, browser || 'chrome', broadcastLog);
  });

  // Master AI Command Execution Pipeline
  ipcMain.handle('nova:processCommand', async (_, payload) => {
    const settings = readSettings();

    // Dynamically synchronize the roastMode flag from incoming payload into settings
    if (payload?.isRoastModeEnabled !== undefined) {
      settings.isRoastModeEnabled = payload.isRoastModeEnabled;
    }
    if (payload?.roastMode !== undefined) {
      settings.isRoastModeEnabled = payload.roastMode;
    }

    const text = payload?.text || '';
    const audioBase64 = payload?.audioBase64 || null;
    const mimeType = payload?.mimeType || 'audio/webm';
    const conversationHistory = payload?.conversationHistory || [];
    const includeVision = Boolean(payload?.includeVision);

    if (ttsEngine && ttsEngine.cancelActiveTTS) {
      ttsEngine.cancelActiveTTS();
    }

    broadcastState('thinking');

    try {
      let visionData = null;
      if (includeVision && vision && vision.getLatestScreenContext) {
        visionData = await vision.getLatestScreenContext();
      }

      const isExplicitHardwareQuery = /\b(battery|charge|charging|cpu|ram|memory|temperature|temp)\b/i.test(text);
      const hardwareStats = isExplicitHardwareQuery ? await fetchFullHardwareStats() : null;

      const historyContext = (conversationHistory && conversationHistory.length > 0)
        ? conversationHistory
        : globalMemoryContext;

      if (text) {
        broadcastLog('command', `User Directive: "${text}"`);
      } else if (audioBase64) {
        broadcastLog('command', 'Analyzing...');
      }

      if (!aiEngine || !aiEngine.runAIInferenceStream) {
        throw new Error('AI Engine subsystem is unavailable.');
      }

      const aiResponse = await Promise.race([
        aiEngine.runAIInferenceStream({
          userPrompt: text,
          audioBase64,
          audioMimeType: mimeType,
          manualImageBase64: visionData,
          config: settings,
          conversationHistory: historyContext,
          hardwareStats,
          onChunkCallback: (streamChunk) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('nova:aiStreamChunk', streamChunk);
            }
          },
          logCallback: broadcastLog,
          mainWindow
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Inference timeout after 65 seconds')), 65000)
        )
      ]);

      if (aiResponse && aiResponse.spokenResponse) {
        globalMemoryContext.push({ role: 'user', text: text || '[Voice Directive]' });
        globalMemoryContext.push({ role: 'model', text: aiResponse.spokenResponse });
        saveLocalPersistentMemory(globalMemoryContext);
      }

      // Generate Neural Voice using Swara/Uzma profile
      let audioResult = null;
      const responseToSpeak = (aiResponse?.spokenResponse || '').trim();

      if (settings.autoSpeak && responseToSpeak && ttsEngine && ttsEngine.synthesizeNeuralSpeech) {
        try {
          audioResult = await ttsEngine.synthesizeNeuralSpeech(
            responseToSpeak,
            settings.voice || 'hi-IN-SwaraNeural'
          );
        } catch (ttsErr) {
          console.warn('[Main TTS Error]:', ttsErr.message);
        }
      }

      broadcastState('idle');

      return {
        success: true,
        spokenResponse: responseToSpeak,
        actions: aiResponse?.actions || [],
        audioBase64: audioResult,
        updatedMemory: globalMemoryContext
      };
    } catch (err) {
      broadcastState('idle');
      const spokenError = `باس، ایک مسئلہ پیش آ گیا ہے: ${err.message.replace(/https?:\/\/[^\s]+/g, '')}`;
      broadcastLog('error', err.message);

      return {
        success: false,
        error: err.message,
        spokenResponse: spokenError,
        audioBase64: null
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

app.on('window-all-closed', () => {
  saveLocalPersistentMemory(globalMemoryContext);
  app.quit();
});
