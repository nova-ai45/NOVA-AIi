const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { executeAction, openBrowserTarget, createDesktopFile, launchApplication, runSystemCommand } = require('./automation');
const { captureActiveDisplay } = require('./vision');
const { synthesizeAudioStream } = require('./tts_engine');
const { runAIInference } = require('./ai_engine');

let mainWindow = null;
const SETTINGS_FILE = path.join(app.getPath('userData'), 'nova_config.json');

const DEFAULT_SETTINGS = {
  provider: 'gemini',
  geminiKey: '',
  geminiModel: 'gemini-3.8-flash', // Default set to 3.8
  openaiKey: '',
  openaiModel: 'gpt-4o',
  customBaseURL: 'http://localhost:11434/v1',
  customKey: '',
  customModel: 'llama3.2',
  voice: 'en-US-AriaNeural',
  autoSpeak: true,
  autoVision: true
};

function readSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
      return DEFAULT_SETTINGS;
    }
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    if (!data.geminiModel) data.geminiModel = 'gemini-3.8-flash';
    return data;
  } catch (err) {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(newConfig) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(newConfig, null, 2));
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
    width: 1340,
    height: 880,
    minWidth: 1080,
    minHeight: 740,
    backgroundColor: '#040711',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      sandbox: false
    }
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(() => {
  // Grant microphone & display capture permissions explicitly
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler(() => true);

  createWindow();

  ipcMain.handle('nova:getSettings', () => readSettings());
  ipcMain.handle('nova:saveSettings', (_, data) => writeSettings(data));

  ipcMain.handle('nova:captureScreen', async () => {
    try {
      const screenshotBase64 = await captureActiveDisplay();
      return { success: true, imageBase64: screenshotBase64 };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('nova:speak', async (_, { text, voice }) => {
    try {
      broadcastState('speaking');
      const settings = readSettings();
      const selectedVoice = voice || settings.voice || 'en-US-AriaNeural';
      const base64Audio = await synthesizeAudioStream(text, selectedVoice);
      return { success: true, base64Audio };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Master Orchestration Engine
  ipcMain.handle('nova:processCommand', async (_, { text, audioBase64, includeVision }) => {
    const config = readSettings();
    try {
      broadcastState('processing');

      // Auto Screen Capture if enabled
      let visionData = null;
      if (includeVision) {
        broadcastLog('vision', 'Screen context captured for analysis.');
        visionData = await captureActiveDisplay();
      }

      if (text) {
        broadcastLog('command', `User: "${text}"`);
      } else if (audioBase64) {
        broadcastLog('command', 'User: [Voice Audio Input Transmitted]');
      }

      broadcastLog('ai', `Analyzing via [${config.provider.toUpperCase()}] Model: ${config.geminiModel}`);
      const aiResponse = await runAIInference(text, audioBase64, visionData, config);

      // Execute PC System Actions
      if (aiResponse.actions && Array.isArray(aiResponse.actions)) {
        for (const action of aiResponse.actions) {
          broadcastState('executing');
          await executeAction(action, broadcastLog);
        }
      }

      // Generate Speech Response
      let audioResult = null;
      if (config.autoSpeak && aiResponse.spokenResponse) {
        broadcastState('speaking');
        audioResult = await synthesizeAudioStream(aiResponse.spokenResponse, config.voice);
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
      const spokenError = `Sir, an error occurred. ${err.message.replace(/https?:\/\/[^\s]+/g, '')}`;
      broadcastLog('error', `NOVA Execution Fault: ${err.message}`);

      // Speak the exact error aloud so the user knows what happened
      let errorAudio = null;
      try {
        errorAudio = await synthesizeAudioStream(spokenError, config.voice || 'en-US-AriaNeural');
      } catch (_) {}

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
  if (process.platform !== 'darwin') app.quit();
});
