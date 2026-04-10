const { app, BrowserWindow, session, ipcMain, dialog } = require('electron');
app.commandLine.appendSwitch('ignore-certificate-errors');
const path = require('path');
const fs = require('fs');
const { protocol, net } = require('electron');
const DiscordRPC = require('discord-rpc');

let mainWindow;

// --- Discord Rich Presence Setup ---
const clientId = '1490907882877620254'; // User's personalization Client ID
DiscordRPC.register(clientId);
const rpc = new DiscordRPC.Client({ transport: 'ipc' });

// --- Offline Storage Setup ---
const OFFLINE_DIR = path.join(app.getPath('userData'), 'offline_music');
const DOWNLOADS_JSON = path.join(OFFLINE_DIR, 'downloads.json');

// --- IPC Handlers (Registered at top-level) ---

// Server-based upload logic removed for standalone player


ipcMain.handle('get-downloaded-list', () => {
    return getDownloadsMetadata();
});

ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Music Folder',
        buttonLabel: 'Add Folder'
    });
    
    if (result.canceled) return null;
    return result.filePaths[0];
});

ipcMain.handle('download-track', async (event, { url, originalTrackingUrl, metadata }) => {
    const trackingId = originalTrackingUrl || url;
    const metadataMap = getDownloadsMetadata();
    if (metadataMap[trackingId]) return { success: true, alreadyExists: true };

    const safeFilename = encodeURIComponent(trackingId).replace(/%/g, '_').slice(-100) + '.cache';
    const targetPath = path.join(OFFLINE_DIR, safeFilename);
    
    try {
        const response = await net.fetch(url);
        if (!response.ok) throw new Error(`Download failed: ${response.status}`);

        const totalSize = parseInt(response.headers.get('content-length'), 10) || 0;
        const writer = fs.createWriteStream(targetPath);
        const reader = response.body.getReader();
        let downloadedSize = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) { writer.end(); break; }
            downloadedSize += value.length;
            writer.write(Buffer.from(value));
            const progress = totalSize ? (downloadedSize / totalSize) : 0;
            if (mainWindow) mainWindow.webContents.send('download-progress', { url: trackingId, progress });
        }

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                metadataMap[trackingId] = { localPath: safeFilename, downloadedAt: Date.now(), metadata: metadata };
                saveDownloadsMetadata(metadataMap);
                resolve({ success: true });
            });
            writer.on('error', (err) => {
                if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
                reject(err);
            });
        });
    } catch (error) {
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
        throw error;
    }
});

ipcMain.handle('delete-offline-track', async (event, trackingId) => {
    const meta = getDownloadsMetadata();
    const info = meta[trackingId];
    if (info) {
        const filePath = path.join(OFFLINE_DIR, info.localPath);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        delete meta[trackingId];
        saveDownloadsMetadata(meta);
        return true;
    }
    return false;
});

if (!fs.existsSync(OFFLINE_DIR)) {
    fs.mkdirSync(OFFLINE_DIR, { recursive: true });
}

function getDownloadsMetadata() {
    if (!fs.existsSync(DOWNLOADS_JSON)) return {};
    try {
        return JSON.parse(fs.readFileSync(DOWNLOADS_JSON, 'utf8'));
    } catch (e) {
        return {};
    }
}

function saveDownloadsMetadata(data) {
    fs.writeFileSync(DOWNLOADS_JSON, JSON.stringify(data, null, 2));
}

// Register protocol before app ready
protocol.registerSchemesAsPrivileged([
    { scheme: 'simon-offline', privileges: { standard: true, secure: true, stream: true, bypassCSP: true } }
]);

async function setActivity(details, state, startTime = null, isPaused = false) {
    if (!rpc || !mainWindow) return;
    try {
        const activity = {
            details: details || 'Idle',
            state: isPaused ? '(PAUSED)' : (state || 'Browsing Library'),
            largeImageKey: 'logo',
            largeImageText: 'SimonRelays',
            instance: false,
        };
        
        if (startTime && !isPaused) {
            activity.startTimestamp = Math.floor(startTime / 1000);
        }

        await rpc.setActivity(activity);
    } catch (e) {
        console.error('Discord RPC Error:', e);
    }
}

rpc.on('ready', () => {
    console.log('Discord RPC Ready');
    setActivity();
});

rpc.login({ clientId }).catch(console.error);

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1050,
        height: 720,
        minWidth: 900,
        minHeight: 650,
        title: 'SimonRelays Player',
        backgroundColor: '#0a0a0f',
        autoHideMenuBar: true,
        frame: false, // Remove native title bar
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Automatically handle any 'download' events 
    session.defaultSession.on('will-download', (event, item, webContents) => {
        item.on('updated', (event, state) => {
            if (state === 'interrupted') console.log('Download interrupted');
        });
        item.once('done', (event, state) => {
            if (state === 'completed') console.log('Download successful');
        });
    });

    mainWindow.loadFile('index.html');

    // Notify renderer of maximize/unmaximize
    mainWindow.on('maximize', () => mainWindow.webContents.send('window-state-changed', true));
    mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-state-changed', false));
}

app.whenReady().then(() => {
    // IPC Handlers
    ipcMain.handle('install-codecs', async () => {
        return new Promise((resolve) => {
            console.log("Installing propriety codecs...");
            setTimeout(() => {
                app.relaunch();
                app.exit(0);
                resolve(true);
            }, 3000); 
        });
    });

    // Window Controls
    ipcMain.on('window-minimize', () => mainWindow.minimize());
    ipcMain.on('window-maximize', () => {
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
    });
    ipcMain.on('window-close', () => mainWindow.close());

    // Discord Presence
    ipcMain.on('update-presence', (event, data) => {
        const { title, artist, startTime, isPaused } = data;
        setActivity(title, `by ${artist}`, startTime, isPaused);
    });

    // --- Offline Protocol Handler ---
    protocol.handle('simon-offline', (request) => {
        const url = request.url.replace('simon-offline://', '');
        const decodedPath = decodeURIComponent(url);
        const filePath = path.join(OFFLINE_DIR, decodedPath);
        return net.fetch('file://' + filePath);
    });




    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
