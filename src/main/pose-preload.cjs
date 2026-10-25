// The pose editor window's whole connection to the app (see registerPoseEditorIpc in main.js).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('poseEditorApi', {
  context: () => ipcRenderer.invoke('editor:context'),
  onContext: (cb) => ipcRenderer.on('editor:context', (_e, context) => cb(context)),
  sendToMain: (pose) => ipcRenderer.invoke('editor:send', pose),
  listPoses: () => ipcRenderer.invoke('poses:list'),
  savePoses: (list) => ipcRenderer.invoke('poses:save', list),
  onPosesChanged: (cb) => ipcRenderer.on('poses:changed', (_e, list) => cb(list)),
  exportPose: (pose) => ipcRenderer.invoke('pose:export', pose),
  importPose: () => ipcRenderer.invoke('pose:import'),
  openImage: () => ipcRenderer.invoke('pose-image:open'),
  openVrm: () => ipcRenderer.invoke('vrm:open'),
  readPoseModel: () => ipcRenderer.invoke('posemodel:read'),
  downloadPoseModel: () => ipcRenderer.invoke('posemodel:download'),
  choosePoseModel: () => ipcRenderer.invoke('posemodel:choose'),
  saveUnderdrawing: (name, png) => ipcRenderer.invoke('underdrawing:save', { name, png }),
  saveUnderdrawingLayers: (name, files) => ipcRenderer.invoke('underdrawing:save-layers', { name, files }),
  copyUnderdrawing: (png) => ipcRenderer.invoke('underdrawing:copy', png),
  onPoseModelProgress: (cb) => ipcRenderer.on('posemodel:progress', (_e, ratio) => cb(ratio)),
});
