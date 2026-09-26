const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { executeAction, openBrowserTarget, createDesktopFile } = require('./automation');
const { captureActiveDisplay } = require('./vision');
const { synthesizeAudioStream } = require('./tts_engine');
const { runAIInference } = require('./ai_engine');

let mainWindow = null;
const SETTINGS_FILE = path.join(app.getPath('userData'), 'nova_config.json');

const DEFAULT_SETTINGS = {
  provider: 'gemini',
  geminiKey: '',
  geminiModel: 'gemini-2.5-flash', // Updated to current Google Gemini model
  openaiKey: '',
  openaiModel: 'gpt-4o',
  customBaseURL: 'http://localhost:11434/v1',
  customKey: '',
  customModel: 'llama3.2',
  voice: 'en-US-AriaNeural',
  autoSpeak: true
};

function readSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
      return DEFAULT_SETTINGS;
    }
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    // Ensure geminiModel is not empty
    if (!data.geminiModel) data.geminiModel = 'gemini-2.5-flash';
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
    width: 1320,
    height: 870,
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
  createWindow();

  ipcMain.handle('nova:getSettings', () => readSettings());
  ipcMain.handle('nova:saveSettings', (_, data) => writeSettings(data));

  ipcMain.handle('nova:captureScreen', async () => {
    try {
      broadcastLog('vision', 'Capturing multi-monitor primary buffer...');
      const screenshotBase64 = await captureActiveDisplay();
      broadcastLog('vision', 'Visual surface buffer captured successfully.');
      return { success: true, imageBase64: screenshotBase64 };
    } catch (e) {
      broadcastLog('error', `Vision capture fault: ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('nova:speak', async (_, { text, voice }) => {
    try {
      broadcastState('speaking');
      const settings = readSettings();
      const selectedVoice = voice || settings.voice || 'en-US-AriaNeural';
      const base64Audio = await synthesizeAudioStream(text, selectedVoice);
      broadcastLog('tts', `Speech generated via Neural Voice [${selectedVoice}]`);
      return { success: true, base64Audio };
    } catch (err) {
      broadcastLog('error', `TTS synthesis error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('nova:createFile', async (_, { filename, content, targetDir }) => {
    return await createDesktopFile(filename, content, targetDir, broadcastLog);
  });

  ipcMain.handle('nova:openBrowser', async (_, { url, searchQuery }) => {
    return await openBrowserTarget(url, searchQuery, broadcastLog);
  });

  ipcMain.handle('nova:processCommand', async (_, { text, includeVision }) => {
    try {
      const config = readSettings();
      broadcastState('processing');
      broadcastLog('command', `User Directive: "${text}"`);

      let visionData = null;
      if (includeVision) {
        broadcastLog('vision', 'Perceiving desktop screen context...');
        visionData = await captureActiveDisplay();
      }

      broadcastLog('ai', `Routing to [${config.provider.toUpperCase()}] :: Model [${config.geminiModel || config.openaiModel || config.customModel}]`);
      const aiResponse = await runAIInference(text, visionData, config);

      if (aiResponse.actions && Array.isArray(aiResponse.actions)) {
        for (const action of aiResponse.actions) {
          broadcastState('executing');
          await executeAction(action, broadcastLog);
        }
      }

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
      broadcastLog('error', `Execution error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
