const { contextBridge, ipcRenderer } = require('electron');

// ── Firebase Auth + Electron compatibility fix ──────────────────────────────
// Firebase Auth's signInWithPopup() throws auth/operation-not-supported-in-
// this-environment when window.location.protocol is 'file:' (Electron default).
// Patching Location.prototype.protocol so Firebase sees 'https:' passes the
// check while leaving all other behaviour unchanged.
try {
    const desc = Object.getOwnPropertyDescriptor(Location.prototype, 'protocol');
    if (desc && desc.get) {
        Object.defineProperty(Location.prototype, 'protocol', {
            get() {
                const p = desc.get.call(this);
                return p === 'file:' ? 'https:' : p;
            },
            configurable: true,
            enumerable: true
        });
    }
} catch(e) {
    console.warn('[Preload] Location.prototype.protocol patch failed:', e);
}

contextBridge.exposeInMainWorld('electronAPI', {
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
