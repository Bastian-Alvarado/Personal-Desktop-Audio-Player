const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    openExternalPath: (url) => ipcRenderer.send('open-external', url),
    onAuthDeepLink: (callback) => ipcRenderer.on('auth-deep-link', (event, url) => callback(url)),

    installCodecs: () => ipcRenderer.invoke('install-codecs'),
    
    // Window Controls
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close'),
    onWindowStateChanged: (callback) => ipcRenderer.on('window-state-changed', (event, isMaximized) => callback(isMaximized)),

    // Discord Rich Presence
    updatePresence: (data) => ipcRenderer.send('update-presence', data),
    
    // Offline Storage
    getDownloadedList: () => ipcRenderer.invoke('get-downloaded-list'),
    downloadTrack: (data) => ipcRenderer.invoke('download-track', data),
    deleteOfflineTrack: (url) => ipcRenderer.invoke('delete-offline-track', url),
    onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),




});
