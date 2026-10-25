const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paintHikaku', {
  args: () => ipcRenderer.invoke('app:args'),
  openImage: () => ipcRenderer.invoke('image:open'),
  openVrm: () => ipcRenderer.invoke('vrm:open'),
  readInitialImage: () => ipcRenderer.invoke('image:initial'),
  readSample: () => ipcRenderer.invoke('sample:read'),
  saveRecord: (record) => ipcRenderer.invoke('history:save', record),
  loadHistory: () => ipcRenderer.invoke('history:load'),
  smokeDone: (result) => ipcRenderer.send('smoke:done', result),
  // Pose editor (separate window): open it with the current model and pose, receive poses back.
  openPoseEditor: (context) => ipcRenderer.invoke('editor:open', context),
  onPoseFromEditor: (cb) => ipcRenderer.on('pose:from-editor', (_e, pose) => cb(pose)),
  listUserPoses: () => ipcRenderer.invoke('poses:list'),
  onUserPosesChanged: (cb) => ipcRenderer.on('poses:changed', (_e, list) => cb(list)),
});
