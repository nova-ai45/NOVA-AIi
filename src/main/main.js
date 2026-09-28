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

// 1. Prevent hardware acceleration GPU crashes
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

// Persistent Settings (NO hardcoded Gemini key - user supplies their own in Settings)
const DEFAULT_SETTINGS = {
  provider: 'gemini',
  geminiKey: '',
  geminiModel: 'gemini-2.5-flash',
  openrouterKey: '',
  openrouterModel: 'meta-llama/llama-3.3-70b-instruct:free',
  customBaseURL: 'https://api.groq.com/openai/v1',
  customKey: '',
  customModel: 'llama-3.3-70b-versatile',
  voice: 'hi-IN-SwaraNeural',
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

// 4. Laptop Real-Time Hardware Management (Battery, CPU, RAM, Temperature)
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
    console.warn('[Hardware] Error reading stats:', e.message);
  }

  // Pure Node.js OS fallback
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

// 5. Native Windows Touch, Click, Double-Click, Right-Click & Long-Press
function nativeClickAt(x, y, button = 'left') {
  return new Promise((resolve) => {
    const posX = Math.round(Number(x));
    const posY = Math.round(Number(y));
    const downFlag = button === 'right' ? '0x0008' : '0x0002';
    const upFlag = button === 'right' ? '0x0010' : '0x0004';

    const ps = `
      Add-Type -AssemblyName System.Windows.Forms;
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${posX}, ${posY});
      $code = @'
      using System;
      using System.Runtime.InteropServices;
      public class NativeMouse {
          [DllImport("user32.dll")]
          public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
      }
'@
      Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue;
      [NativeMouse]::mouse_event(${downFlag}, 0, 0, 0, [UIntPtr]::Zero);
      Start-Sleep -Milliseconds 50;
      [NativeMouse]::mouse_event(${upFlag}, 0, 0, 0, [UIntPtr]::Zero);
    `;
    exec(`powershell -NoProfile -Command "${ps.replace(/\n/g, ' ')}"`, (err) => {
      resolve({ success: !err, x: posX, y: posY });
    });
  });
}

function nativeDoubleClickAt(x, y) {
  return new Promise((resolve) => {
    const posX = Math.round(Number(x));
    const posY = Math.round(Number(y));
    const ps = `
      Add-Type -AssemblyName System.Windows.Forms;
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${posX}, ${posY});
      $code = @'
      using System;
      using System.Runtime.InteropServices;
      public class NativeMouseDbl {
          [DllImport("user32.dll")]
          public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
      }
'@
      Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue;
      [NativeMouseDbl]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero);
      [NativeMouseDbl]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero);
      Start-Sleep -Milliseconds 80;
      [NativeMouseDbl]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero);
      [NativeMouseDbl]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero);
    `;
    exec(`powershell -NoProfile -Command "${ps.replace(/\n/g, ' ')}"`, (err) => {
      resolve({ success: !err, x: posX, y: posY });
    });
  });
}

function nativeLongPressAt(x, y, durationMs = 1200) {
  return new Promise((resolve) => {
    const posX = Math.round(Number(x));
    const posY = Math.round(Number(y));
    const sleep = Math.max(200, Math.min(5000, Number(durationMs) || 1200));
    const ps = `
      Add-Type -AssemblyName System.Windows.Forms;
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${posX}, ${posY});
      $code = @'
      using System;
      using System.Runtime.InteropServices;
      public class NativeMouseLong {
          [DllImport("user32.dll")]
          public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
      }
'@
      Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue;
      [NativeMouseLong]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero);
      Start-Sleep -Milliseconds ${sleep};
      [NativeMouseLong]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero);
    `;
    exec(`powershell -NoProfile -Command "${ps.replace(/\n/g, ' ')}"`, (err) => {
      resolve({ success: !err, x: posX, y: posY, duration: sleep });
    });
  });
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
    mainWindow.loadURL('http://localhost:5173').catch(() => loadProductionBuild(mainWindow));
  } else {
    loadProductionBuild(mainWindow);
  }

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
      <!DOCTYPE html><html><body style="background:#07080c;color:#ff7700;font-family:sans-serif;padding:40px;">
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

  // IPC Handlers
  ipcMain.handle('nova:getSettings', () => readSettings());
  ipcMain.handle('nova:saveSettings', (_, data) => writeSettings(data));

  // Live Hardware Telemetry IPC
  ipcMain.handle('nova:getHardwareStats', async () => {
    return await fetchFullHardwareStats();
  });

  // Native Mouse Control IPCs
  ipcMain.handle('nova:clickAt', async (_, { x, y, button }) => {
    return await nativeClickAt(x, y, button || 'left');
  });

  ipcMain.handle('nova:doubleClickAt', async (_, { x, y }) => {
    return await nativeDoubleClickAt(x, y);
  });

  ipcMain.handle('nova:longPressAt', async (_, { x, y, durationMs }) => {
    return await nativeLongPressAt(x, y, durationMs || 1200);
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

  // Master AI Pipeline Dispatcher
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

      // Fetch live hardware stats to give AI situational awareness
      const hardwareStats = await fetchFullHardwareStats();

      if (text) broadcastLog('command', `User Directive: "${text}"`);
      else if (audioBase64) broadcastLog('command', 'User: [Voice Signal Streamed]');

      if (!aiEngine || !aiEngine.runAIInferenceStream) {
        throw new Error('AI Engine subsystem offline.');
      }

      const aiResponse = await aiEngine.runAIInferenceStream(
        text,
        audioBase64,
        visionData,
        settings,
        conversationHistory || [],
        hardwareStats,
        (streamChunk) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('nova:aiStreamChunk', streamChunk);
          }
        }
      );

      // Execute physical OS automations (files, Notepad typer, mouse clicks, scrolls, web search)
      if (aiResponse.actions && Array.isArray(aiResponse.actions) && automation && automation.executeAction) {
        for (const action of aiResponse.actions) {
          broadcastState('executing');
          await automation.executeAction(action, broadcastLog, mainWindow);
        }
      }

      // Speak back using Microsoft Edge Neural Voice
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
        audioBase64: audioResult
      };
    } catch (err) {
      broadcastState('idle');
      const spokenError = `Notice: ${err.message.replace(/https?:\/\/[^\s]+/g, '')}`;
      broadcastLog('error', err.message);

      let errorAudio = null;
      if (ttsEngine && ttsEngine.synthesizeNeuralSpeech) {
        try {
          errorAudio = await ttsEngine.synthesizeNeuralSpeech(spokenError, settings.voice || 'hi-IN-SwaraNeural');
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

app.on('window-all-closed', () => {
  app.quit();
});
