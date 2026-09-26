const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('novaAPI', {
  // Voice & AI Interaction
  processCommand: (payload) => ipcRenderer.invoke('nova:processCommand', payload),
  synthesizeVoice: (text, voice) => ipcRenderer.invoke('nova:speak', { text, voice }),
  
  // Vision & Screen
  captureScreen: () => ipcRenderer.invoke('nova:captureScreen'),
  
  // Settings Management
  getSettings: () => ipcRenderer.invoke('nova:getSettings'),
  saveSettings: (settings) => ipcRenderer.invoke('nova:saveSettings', settings),

  // Automation Direct
  createProjectFile: (opts) => ipcRenderer.invoke('nova:createFile', opts),
  openBrowser: (opts) => ipcRenderer.invoke('nova:openBrowser', opts),

  // Event Listeners from Main (logs, status updates)
  onLog: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('nova:log', subscription);
    return () => ipcRenderer.removeListener('nova:log', subscription);
  },
  onStateChange: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('nova:state', subscription);
    return () => ipcRenderer.removeListener('nova:state', subscription);
  }
});
