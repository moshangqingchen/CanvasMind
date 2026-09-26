const { contextBridge, ipcRenderer } = require('electron');
const listen = (channel, callback) => {
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
contextBridge.exposeInMainWorld('superCanvasDesktop', Object.freeze({
  getUpdate: () => ipcRenderer.invoke('desktop:update-status'),
  update: (action) => ipcRenderer.invoke('desktop:update-action', action),
  initialize: (mode) => ipcRenderer.invoke('desktop:initialize', mode),
  retry: () => ipcRenderer.invoke('desktop:retry'),
  openLogs: () => ipcRenderer.invoke('desktop:open-logs'),
  onPrepareExit: (callback) => listen('desktop:prepare-exit', callback),
  completePrepareExit: (id, error) => ipcRenderer.send('desktop:prepared', { id, error }),
  onState: (callback) => listen('desktop:state', callback),
  onOpenUpdate: (callback) => listen('desktop:open-update', callback),
  onUpdate: (callback) => listen('desktop:update-changed', callback),
  onDraining: (callback) => listen('desktop:draining', callback),
  cancelExit: () => ipcRenderer.invoke('desktop:cancel-exit'),
  getReferenceChannel: () => ipcRenderer.invoke('desktop:reference-status'),
  saveReferenceChannel: (settings) => ipcRenderer.invoke('desktop:reference-save', settings),
  onReferenceChannel: (callback) => listen('desktop:reference-channel', callback),
}));
