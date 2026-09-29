const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('settingsApi', {
  load: () => ipcRenderer.invoke('settings:load'),
  save: data => ipcRenderer.invoke('settings:save', data),
  models: data => ipcRenderer.invoke('settings:models', data),
  close: () => ipcRenderer.invoke('settings:close'),
});
