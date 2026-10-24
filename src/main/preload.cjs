const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paintHikaku', {
  args: () => ipcRenderer.invoke('app:args'),
  openImage: () => ipcRenderer.invoke('image:open'),
  readInitialImage: () => ipcRenderer.invoke('image:initial'),
  readSample: () => ipcRenderer.invoke('sample:read'),
  saveRecord: (record) => ipcRenderer.invoke('history:save', record),
  loadHistory: () => ipcRenderer.invoke('history:load'),
  smokeDone: (result) => ipcRenderer.send('smoke:done', result),
});
