let qqdlTargetUrl = 'https://wolf.qqdl.site';
let availableCloudApis = [];
let isQqdlInitialized = false;
let appInitialized = false; // Separate guard for the main app init

// Firebase Globals
let currentUser = null;
let deviceId = null;
let allPlaylists = [];
// Universal Sync Globals
let masterDeviceId = null;
let contextSyncInterval = null;
let isOfflineBreak = false;
let userQueue = []; // Hoisted: must be global so sync engine (initActiveContextListener) can read/write it
let isShuffleActive = false; // Hoisted: global so sync engine (broadcastActiveContext) can read it
let repeatMode = 0;          // Hoisted: global so sync engine (broadcastActiveContext) can read it
let slaveRafId = null; // requestAnimationFrame ID for slave scrub bar interpolation
let isDraggingScrubber = false; // Scrubber state hoisted to prevent TDZ error in requestAnimationFrame
let activeContextListenerRef = null; // Tracks the active Firebase ref so we can detach it before re-attaching
let deviceListCache = null;          // { data: {}, timestamp: number } — short-lived cache for the settings device list
const DEVICE_CACHE_TTL = 30000;      // 30 seconds

let serverTimeOffset = 0;
function getServerTime() {
    return Date.now() + serverTimeOffset;
}

// Global utility: must live here so global-scope sync functions can call it
function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// ── Firebase Modules (Global Scope for Hoisting) ──────────────────────────────

function initOfflineIndicator() {
    if (!window._fbDB) return;
    window._fbDB.ref('.info/serverTimeOffset').on('value', snap => {
        serverTimeOffset = snap.val() || 0;
    });
    window._fbDB.ref('.info/connected').on('value', snap => {
        const online = snap.val() === true;
        document.body.classList.toggle('firebase-offline', !online);
        const bar = document.getElementById('offline-bar');
        if (bar) {
            if (online) bar.classList.add('hidden');
            else bar.classList.remove('hidden');
        }
    });
}

async function initDevicePresence() {
    if (!currentUser) return;
    const uid = currentUser.uid;
    const deviceRef = window._fbDB.ref(`users/${uid}/devices/${deviceId}`);
    
    let deviceName = getDefaultDeviceName();
    try {
        const doc = await window._fbFS.collection('users').doc(uid).get();
        if (doc.exists && doc.data().devices && doc.data().devices[deviceId]) {
            deviceName = doc.data().devices[deviceId].name || deviceName;
        }
    } catch(e) { console.warn('Could not fetch custom device name', e); }

    await deviceRef.set({
        name: deviceName,
        type: window.electronAPI ? 'electron' : 'pwa',
        online: true,
        lastSeen: firebase.database.ServerValue.TIMESTAMP,
        state: { lastUpdate: firebase.database.ServerValue.TIMESTAMP }
    });

    deviceRef.onDisconnect().update({ online: false, lastSeen: firebase.database.ServerValue.TIMESTAMP });

    setInterval(() => {
        const audioPlayer = document.getElementById('audio-player');
        if (!audioPlayer || audioPlayer.paused || !window.globalPlayingTrack) return;
        deviceRef.child('state').update({
            trackUrl: window.globalPlayingTrack.url,
            trackMeta: window.globalPlayingTrack.metadata || { title: window.globalPlayingTrack.filename },
            currentTime: audioPlayer.currentTime,
            duration: audioPlayer.duration,
            paused: false,
            volume: audioPlayer.volume,
            lastUpdate: firebase.database.ServerValue.TIMESTAMP
        });
    }, 3000);
}



// ── Universal Sync Engine ────────────────────────────────────────────────────

function initActiveContextListener() {
    if (!currentUser || isOfflineBreak) return;
    const uid = currentUser.uid;

    // Detach any previous listener to prevent accumulation on reconnect
    if (activeContextListenerRef) {
        activeContextListenerRef.off('value');
        activeContextListenerRef = null;
    }

    // Store the ref so it can be detached on the next call
    activeContextListenerRef = window._fbDB.ref(`users/${uid}/activeContext`);
    activeContextListenerRef.on('value', async snap => {
        const context = snap.val();
        if (!context) {
            // AUTO-CLAIM MASTER: If no syncing context exists at all, claim it.
            if (!masterDeviceId && currentUser) {
                console.log('[Sync] No master detected (empty db). Claiming master control...');
                takeMasterControl();
            }
            return;
        }

        masterDeviceId = context.masterDeviceId;
        deviceListCache = null; // Invalidate device cache on any sync context change
        const audioPlayer = document.getElementById('audio-player');

        // AUTO-CLAIM MASTER: If context exists but master is missing, we take it
        if (!masterDeviceId && currentUser) {
            console.log('[Sync] No master detected in context. Claiming master control...');
            takeMasterControl();
            return;
        }

        // 1. Sync Track & Metadata (All devices)
        if (context.track && (!window.globalPlayingTrack || window.globalPlayingTrack.url !== context.track.url)) {
            console.log('[Sync] New track received from context:', context.track.metadata?.title);
            
            if (deviceId !== masterDeviceId) {
                // If we are slave, we just update UI (no audio load)
                if (typeof playTrack === 'function') {
                    playTrack(context.track, context.track.metadata?.title, context.track.metadata?.artist, null, true);
                }
            } else {
                // If we are master, we play it fully
                if (typeof playTrack === 'function') {
                    playTrack(context.track, context.track.metadata?.title, context.track.metadata?.artist, null, false);
                }
            }
        }

        // 2. Sync Queue
        userQueue = context.queue || [];
        const _queueViewSync = document.getElementById('queue-view');
        if (typeof renderQueueView === 'function' && _queueViewSync && _queueViewSync.classList.contains('active')) {
            renderQueueView();
        }

        // 3. Sync Play/Pause & Time (UI for all, Audio for Master)
        if (audioPlayer) {
            // Mirror Play/Pause Icon across all devices
            if (context.isPaused !== undefined) {
                const playIconSync = document.querySelector('#play-pause-btn svg path');
                if (playIconSync) {
                    if (context.isPaused) {
                        playIconSync.setAttribute('d', 'M8 5v14l11-7z'); // Play icon
                    } else {
                        playIconSync.setAttribute('d', 'M6 19h4V5H6v14zm8-14v14h4V5h-4z'); // Pause icon
                    }
                }
                
                // Only the MASTER actually controls audio output
                if (deviceId === masterDeviceId) {
                    if (context.isPaused !== audioPlayer.paused) {
                        context.isPaused ? audioPlayer.pause() : audioPlayer.play();
                    }
                }
            }
            
            // Sync Time / Progress Bar
            if (context.timestamp !== undefined) {
                const elapsedSinceUpdate = Math.max(0, (getServerTime() - context.lastUpdate) / 1000);
                const expectedTime = Math.max(0, context.timestamp + (context.isPaused ? 0 : elapsedSinceUpdate));
                
                if (deviceId === masterDeviceId) {
                    // Master syncs actual audio element
                    if (Math.abs(audioPlayer.currentTime - expectedTime) > 1.5) {
                        audioPlayer.currentTime = expectedTime;
                    }
                } else {
                    // Slaves: snap UI to current expected time, then start raf to interpolate forward
                    const duration = context.track?.metadata?.duration || 0;

                    // Helper that updates just the scrub bar UI
                    function updateSlaveProgress(time) {
                        const currentTimeEl = document.getElementById('current-time');
                        const progressFillEl = document.getElementById('progress-fill');
                        const totalTimeEl = document.getElementById('total-time');
                        if (currentTimeEl) currentTimeEl.textContent = formatTime(time);
                        if (totalTimeEl && duration > 0) totalTimeEl.textContent = formatTime(duration);
                        if (progressFillEl && duration > 0) {
                            const percent = (time / duration) * 100;
                            progressFillEl.style.width = `${Math.min(100, percent)}%`;
                            
                            // Update dynamic full-bar progress on mobile
                            const playerBar = document.querySelector('.player-bar');
                            if (playerBar && window.innerWidth <= 768) {
                                playerBar.style.setProperty('--player-progress', `${percent}%`);
                            }
                        }
                        // Sync lyric highlighting
                        if (typeof window.updateLyricsSync === 'function') window.updateLyricsSync(time);
                    }

                    // Snap immediately to the synced position
                    updateSlaveProgress(expectedTime);

                    if (slaveRafId) cancelAnimationFrame(slaveRafId);
                    if (!context.isPaused) {
                        const loopFrame = () => {
                            if (deviceId === masterDeviceId) {
                                slaveRafId = null;
                                return;
                            }
                            const elapsed = Math.max(0, (getServerTime() - context.lastUpdate) / 1000);
                            const interpolated = Math.min(context.timestamp + elapsed, duration || Infinity);
                            if (!isDraggingScrubber) {
                                updateSlaveProgress(interpolated);
                            }
                            slaveRafId = requestAnimationFrame(loopFrame);
                        };
                        slaveRafId = requestAnimationFrame(loopFrame);
                    } else {
                        slaveRafId = null;
                    }
                }
            }
        }

        if (deviceId !== masterDeviceId && audioPlayer && audioPlayer.src) {
             // If we were master but no longer are, stop audio
             audioPlayer.src = '';
             audioPlayer.load();
        }

        // UNIVERSAL SYNC: Sync Shuffle & Repeat State
        if (context.shuffle !== undefined && typeof window.setShuffleState === 'function') {
            window.setShuffleState(context.shuffle, false); // false = don't broadcast back
        }
        if (context.repeat !== undefined && typeof window.setRepeatMode === 'function') {
            window.setRepeatMode(context.repeat, false); // false = don't broadcast back
        }
        
        // Update device list UI to show who is Master
        const _settingsViewSync = document.getElementById('settings-view');
        if (_settingsViewSync && _settingsViewSync.classList.contains('active')) {
            if (typeof renderSettingsPanel === 'function') renderSettingsPanel();
        }
    });

    // Handle offline break
    window.addEventListener('offline', () => {
        console.log('[Sync] Offline detected. Breaking sync.');
        isOfflineBreak = true;
    });
    window.addEventListener('online', () => {
        console.log('[Sync] Online detected. Restoring sync.');
        isOfflineBreak = false;
        initActiveContextListener();
    });
}

function broadcastActiveContext(force = false) {
    if (!currentUser || deviceId !== masterDeviceId || isOfflineBreak) return;
    const uid = currentUser.uid;
    const audioPlayer = document.getElementById('audio-player');
    
    const contextData = {
        track: window.globalPlayingTrack || null,
        isPaused: audioPlayer ? audioPlayer.paused : true,
        timestamp: audioPlayer ? audioPlayer.currentTime : 0,
        shuffle: isShuffleActive,
        repeat: repeatMode,
        masterDeviceId: deviceId,
        lastUpdate: firebase.database.ServerValue.TIMESTAMP
    };

    window._fbDB.ref(`users/${uid}/activeContext`).update(contextData);
}

function startContextSyncInterval() {
    if (contextSyncInterval) clearInterval(contextSyncInterval);
    // 5-second heartbeat removed for Event-Sourcing model
}

async function takeMasterControl() {
    if (!currentUser) return;
    console.log('[Sync] Taking master control of playback...');
    
    // 1. Get current context to know where to start
    const uid = currentUser.uid;
    const snap = await window._fbDB.ref(`users/${uid}/activeContext`).once('value');
    const context = snap.val();
    
    masterDeviceId = deviceId;
    
    if (context && context.track) {
        const elapsedSinceUpdate = (Date.now() - context.lastUpdate) / 1000;
        const startTime = context.timestamp + elapsedSinceUpdate;
        
        // Change master first
        await window._fbDB.ref(`users/${uid}/activeContext/masterDeviceId`).set(deviceId);
        
        // Then start playing locally
        if (typeof playTrack === 'function') {
            await playTrack(context.track, context.track.metadata?.title, context.track.metadata?.artist);
            const audioPlayer = document.getElementById('audio-player');
            if (audioPlayer) audioPlayer.currentTime = startTime;
        }
    } else {
        // Just set master if nothing is playing
        await window._fbDB.ref(`users/${uid}/activeContext/masterDeviceId`).set(deviceId);
    }
    
    renderSettingsPanel();
}

// Defining as a class/object to survive hoisting vs const assignment
const FirebaseRemoteEngine = {
    controllingDeviceId: null,
    listenerRef: null,

    sendCommand(targetDeviceId, type, payload = {}) {
        const uid = currentUser?.uid;
        if (!uid || !targetDeviceId) return;
        window._fbDB.ref(`users/${uid}/commands/${targetDeviceId}`).push({
            id: crypto.randomUUID(),
            type, payload,
            from: deviceId,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
    },

    initCommandListener() {
        if (!currentUser) return;
        const uid = currentUser.uid;
        if (this.listenerRef) this.listenerRef.off();
        this.listenerRef = window._fbDB.ref(`users/${uid}/commands/${deviceId}`);
        this.listenerRef.on('child_added', snap => {
            const data = snap.val();
            if (data) this.handleRemoteCommand(data);
            snap.ref.remove();
        });
    },

    handleRemoteCommand(data) {
        const audioEl = document.getElementById('audio-player');
        switch (data.type) {
            case 'PLAY_PAUSE': if (audioEl) audioEl.paused ? audioEl.play() : audioEl.pause(); break;
            case 'SEEK': if (audioEl) audioEl.currentTime = data.payload.currentTime; break;
            case 'NEXT': if (typeof window.playNextTrack === 'function') window.playNextTrack(false); break;
            case 'PREV': if (typeof window.playPreviousTrack === 'function') window.playPreviousTrack(); break;
            case 'SET_VOLUME': if (audioEl && data.payload.volume !== undefined) audioEl.volume = data.payload.volume; break;
            case 'PLAY_TRACK': {
                const t = data.payload.track;
                const context = data.payload.context;
                const index = data.payload.index;

                if (context && typeof index === 'number' && typeof window.updateContextAndPlay === 'function') {
                    // Upgrade: Master adopts the slave's context (e.g. album/playlist)
                    window.updateContextAndPlay(context, index);
                } else if (t && typeof window.playTrack === 'function') {
                    window.playTrack(t, t.metadata?.title, t.metadata?.artist);
                }
                break;
            }
            case 'SET_SHUFFLE': {
                if (typeof window.setShuffleState === 'function') {
                    window.setShuffleState(data.payload.active);
                    // Master broadcasts immediately after update
                    if (typeof broadcastActiveContext === 'function') broadcastActiveContext(true);
                }
                break;
            }
            case 'SET_REPEAT': {
                if (typeof window.setRepeatMode === 'function') {
                    window.setRepeatMode(data.payload.mode);
                    // Master broadcasts immediately after update
                    if (typeof broadcastActiveContext === 'function') broadcastActiveContext(true);
                }
                break;
            }
        }
    },

    setControllingDevice(id) { this.controllingDeviceId = id; },
    getControllingDevice() { return this.controllingDeviceId; }
};

// Helper for racing multiple API requests
const firstSuccess = (promises) => {
    return new Promise((resolve) => {
        let finished = 0;
        let resolved = false;
        promises.forEach(p => {
            p.then(res => {
                if (resolved) return;
                if (res) {
                    resolved = true;
                    resolve(res);
                } else {
                    finished++;
                    if (finished === promises.length) resolve(null);
                }
            }).catch(() => {
                if (resolved) return;
                finished++;
                if (finished === promises.length) resolve(null);
            });
        });
    });
};

// Route all QQDL/Tidal API calls through Electron's main process when available.
// This bypasses Chromium CORS enforcement and Tidal CDN IP-based auth rejection.
// Falls back to browser fetch for PWA usage.
async function apiFetch(url, timeoutMs = 8000) {
    if (window.electronAPI && window.electronAPI.proxyFetch) {
        return window.electronAPI.proxyFetch(url); // Node.js net.fetch, no CORS
    }
    // PWA fallback
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        clearTimeout(id);
        return null;
    }
}

async function smartRaceFetch(path) {
    const tryAPIs = (availableCloudApis && availableCloudApis.length > 0) 
        ? [qqdlTargetUrl, ...availableCloudApis.filter(a => a !== qqdlTargetUrl).slice(0, 2)] 
        : [qqdlTargetUrl];
    
    // Ensure uniqueness
    const uniqueAPIs = [...new Set(tryAPIs)];

    const result = await firstSuccess(uniqueAPIs.map(async (api) => {
        try {
            const data = await apiFetch(`${api}${path}`);
            return data ? { api, data } : null;
        } catch (e) {
            return null;
        }
    }));

    if (result) {
        if (qqdlTargetUrl !== result.api) {
            console.log(`[Cloud] Mirror fallback: ${qqdlTargetUrl} -> ${result.api}`);
            qqdlTargetUrl = result.api;
        }
        return result.data;
    }
    return null;
}

async function initCloudTarget() {
    try {
        const res = await fetch('https://tidal-uptime.jiffy-puffs-1j.workers.dev/');
        if (res.ok) {
            const data = await res.json();
            if (data && data.api && data.api.length > 0) {
                availableCloudApis = data.api.map(a => a.url);
                
                // NEW: Race mirrors for the fastest/working one immediately
                console.log('Racing QQDL mirrors for initial target...', availableCloudApis);
                const winner = await firstSuccess(availableCloudApis.map(async (url) => {
                    try {
                        // Quick search ping to verify API health
                        const ping = await fetch(`${url}/search/?s=a`);
                        if (ping.ok) return url;
                    } catch(e) {}
                    return null;
                }));

                if (winner) {
                    qqdlTargetUrl = winner;
                    console.log('Primary QQDL Target resolved and verified:', qqdlTargetUrl);
                } else {
                    qqdlTargetUrl = availableCloudApis[0];
                    console.warn('No mirrors responded to ping, using default:', qqdlTargetUrl);
                }
            }
        }
    } catch(e) {
        console.warn('Failed to fetch uptime worker, using default target', e);
        availableCloudApis = [qqdlTargetUrl];
    }
    isQqdlInitialized = true;
}

function getTidalImage(hash, size = '320x320') {
    if (!hash || typeof hash !== 'string') return '';
    return `https://resources.tidal.com/images/${hash.replace(/-/g, '/')}/${size}.jpg`;
}

// Global Configuration

function showAuthOverlay() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.classList.remove('hidden');
}

function hideAuthOverlay() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.classList.add('hidden');
}

function getDefaultDeviceName() {
    if (window.electronAPI) return 'Desktop App';
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android Device';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Win/.test(ua)) return 'Windows PC';
    return 'Web Browser';
}

document.addEventListener('DOMContentLoaded', async () => {
    // Initial Auth and Firebase Setup
    const googleBtn = document.getElementById('google-signin-btn');
    if (googleBtn) {
        googleBtn.addEventListener('click', async () => {
            try {
                console.log('[Auth] Button clicked. _fbAuth:', window._fbAuth);
                if (!window._fbAuth) { alert('Firebase Auth not initialized. Check console.'); return; }
                const provider = new firebase.auth.GoogleAuthProvider();
                console.log('[Auth] Calling signInWithPopup...');
                const result = await window._fbAuth.signInWithPopup(provider);
                console.log('[Auth] Sign-in success:', result.user.email);
            } catch(err) {
                console.error('[Auth] Error:', err);
                alert('Sign in failed: ' + (err.message || err.code || JSON.stringify(err)));
            }
        });
    }

    const cancelBtn = document.getElementById('auth-cancel-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            hideAuthOverlay();
        });
    }

    // ── Pre-auth initialization ──────────────────────────────────────────────
    // We resolve device-id regardless of auth state for local presence
    deviceId = localStorage.getItem('deviceId');
    if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem('deviceId', deviceId);
    }

    // Initialize the main app logic and WAIT for it to finish before
    // registering the auth listener. This guarantees that all functions
    // defined inside appInit() (renderSettingsPanel, renderQueueView, etc.)
    // exist before any cloud service tries to call them.
    await appInit();

    window._fbAuth.onAuthStateChanged(async (user) => {
        currentUser = user;
        
        if (user) {
            console.log('[Auth] User signed in:', user.email);
            hideAuthOverlay();
            // Start cloud services dynamically
            initializeCloudServices(user);
        } else {
            console.log('[Auth] No user session found. Operating in Guest mode.');
            // Stop any active listeners
            if (playlistUnsubscribe) {
                playlistUnsubscribe();
                playlistUnsubscribe = null;
            }
            allPlaylists = [];
            renderPlaylistsStrip();
            // Note: we no longer call showAuthOverlay() automatically here
        }

        // Re-render settings if open to update account state
        const _settingsViewAuth = document.getElementById('settings-view');
        if (_settingsViewAuth && _settingsViewAuth.classList.contains('active')) {
            renderSettingsPanel(); // safe: appInit() is guaranteed complete before this runs
        }
    });

    async function initializeCloudServices(user) {
        if (!user || !window._fbDB) return;

        // 1. Clear legacy localStorage playlists (clean break)
        localStorage.removeItem('personalPlaylists');

        // 2. Initialize Firebase components
        initOfflineIndicator();
        initDevicePresence();
        initActiveContextListener();
        startContextSyncInterval();
        FirebaseRemoteEngine.initCommandListener();
        if (typeof window.fetchPlaylists === 'function') {
            window.fetchPlaylists();
        }

        console.log('[Cloud] Firebase services initialized.');
    }

    // We wrap the original initialization code in appInit()
    async function appInit() {
        if (appInitialized) return; // Prevent double init
        appInitialized = true;

    // Views
    const homeView = document.getElementById('home-view');
    const allAlbumsView = document.getElementById('all-albums-view');
    const allArtistsView = document.getElementById('all-artists-view');
    const albumView = document.getElementById('album-view');
    const searchView = document.getElementById('search-view');
    const artistView = document.getElementById('artist-view');
    
    // Elements
    const albumGrid = document.getElementById('album-grid');
    const allArtistsGrid = document.getElementById('all-artists-grid');
    const backBtn = document.getElementById('back-btn');
    const albumHeroDiv = document.getElementById('album-hero');
    
    // Artist Hero Elements
    const artistBackBtn = document.getElementById('artist-back-btn');
    const artistHeroName = document.getElementById('artist-hero-name');
    const artistHeroMeta = document.getElementById('artist-hero-meta');
    const artistPlayAllBtn = document.getElementById('artist-play-all-btn');
    const artistTrackList = document.getElementById('artist-track-list');
    const artistAlbumGrid = document.getElementById('artist-album-grid');
    
    // Header Inputs
    const navHomeBtn = document.getElementById('nav-home-btn');
    const searchInput = document.getElementById('search-input');
    const searchTrackList = document.getElementById('search-track-list');

    // Search section refs
    const searchArtistsSection = document.getElementById('search-artists-section');
    const searchArtistList = document.getElementById('search-artist-list');
    const searchPlaylistsSection = document.getElementById('search-playlists-section');
    const searchPlaylistList = document.getElementById('search-playlist-list');
    const searchTracksSection = document.getElementById('search-tracks-section');
    const searchEmptyState = document.getElementById('search-empty-state');

    // Global Player Bar Nodes
    const trackListElement = document.getElementById('track-list');
    const audioPlayer = document.getElementById('audio-player');
    const bottomTitle = document.getElementById('bottom-title');
    const bottomArtist = document.getElementById('bottom-artist');
    const bottomArtWrapper = document.getElementById('bottom-art');
    const bottomOfflineBtn = document.getElementById('bottom-offline-btn');
    
    // Playback Controls
    const prevBtn = document.getElementById('prev-btn');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const nextBtn = document.getElementById('next-btn');
    const playIcon = document.getElementById('play-icon');
    const shuffleBtn = document.getElementById('shuffle-btn');
    const repeatBtn = document.getElementById('repeat-btn');
    const repeatIcon = document.getElementById('repeat-icon');
    
    // Scrubber Bar
    const currentTimeEl = document.getElementById('current-time');
    const totalTimeEl = document.getElementById('total-time');
    const progressBarContainer = document.getElementById('progress-bar-container');
    const progressFill = document.getElementById('progress-fill');
    const hoverTooltip = document.getElementById('hover-tooltip');
    
    // Volume Control Elements
    const muteBtn = document.getElementById('mute-btn');
    const muteIcon = document.getElementById('mute-icon');
    const volumeBarContainer = document.getElementById('volume-bar-container');
    const volumeFill = document.getElementById('volume-fill');

    // Dependency Modal Elements
    const dependencyModal = document.getElementById('dependency-modal');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalInstallBtn = document.getElementById('modal-install-btn');

    // Playlist Elements
    const playlistView = document.getElementById('playlist-view');
    const playlistHeroDiv = document.getElementById('playlist-hero');
    const playlistTrackList = document.getElementById('playlist-track-list');
    const playlistBackBtn = document.getElementById('playlist-back-btn');
    const playlistStrip = document.getElementById('playlist-strip');
    const downloadsListContainer = document.getElementById('downloads-list-container');
    const createPlaylistModal = document.getElementById('create-playlist-modal');
    const playlistNameInput = document.getElementById('playlist-name-input');
    const createPlaylistCancelBtn = document.getElementById('create-playlist-cancel-btn');
    const createPlaylistConfirmBtn = document.getElementById('create-playlist-confirm-btn');
    const addToPlaylistDropdown = document.getElementById('add-to-playlist-dropdown');

    // Settings Elements
    const settingsBtn = document.getElementById('settings-btn');
    const deviceBtn = document.getElementById('device-selector-btn');
    const settingsView = document.getElementById('settings-view');
    const settingsCloseBtn = document.getElementById('settings-close-btn');

    // Mobile Bottom Nav Elements
    const mobileHomeBtn = document.getElementById('mobile-home-btn');
    const mobileSearchBtn = document.getElementById('mobile-search-btn');
    const mobileQueueBtn = document.getElementById('mobile-queue-btn');
    const mobileSettingsBtn = document.getElementById('mobile-settings-btn');
    const mobileNavItems = [mobileHomeBtn, mobileSearchBtn, mobileQueueBtn, mobileSettingsBtn];
    const mobileSearchInput = document.getElementById('mobile-search-input');
    
    const trackContextMenu = document.getElementById('track-context-menu');
    const menuPlaylistBtn = document.getElementById('menu-playlist-btn');

    let currentEditingTrack = null;

    function updateMobileNavActive(activeBtn) {
        mobileNavItems.forEach(btn => {
            if (btn) btn.classList.remove('active');
        });
        if (activeBtn) activeBtn.classList.add('active');
    }

    // Window Controls
    const minBtn = document.getElementById('min-btn');
    const maxBtn = document.getElementById('max-btn');
    const closeBtn = document.getElementById('close-btn');
    const maxIcon = document.getElementById('max-icon');

    if (window.electronAPI) {
        minBtn.addEventListener('click', () => window.electronAPI.minimizeWindow());
        maxBtn.addEventListener('click', () => window.electronAPI.maximizeWindow());
        closeBtn.addEventListener('click', () => window.electronAPI.closeWindow());

        window.electronAPI.onWindowStateChanged((isMaximized) => {
            if (isMaximized) {
                // Restore icon (two overlapping squares)
                maxIcon.innerHTML = '<rect x="8" y="4" width="12" height="12" rx="2" ry="2"></rect><path d="M4 8v12h12"></path>';
            } else {
                // Maximize icon (single square)
                maxIcon.innerHTML = '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>';
            }
        });
    }

    // ── Dynamic Color Logic ──────────────────────────────────────────────────
    async function updatePlayerBarDynamicColor(imgUrl) {
        if (!imgUrl || window.innerWidth > 768) return;
        
        const playerBar = document.querySelector('.player-bar');
        if (!playerBar) return;
        
        // Absolute URL image processing
        const absoluteImageUrl = imgUrl;

        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = absoluteImageUrl;

        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 1; canvas.height = 1;

            ctx.drawImage(img, 0, 0, 1, 1);
            const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
            
            // Apply subtle tint (slightly darken and desaturate for UI overlay look)
            const dimR = Math.floor(r * 0.7);
            const dimG = Math.floor(g * 0.7);
            const dimB = Math.floor(b * 0.7);
            
            playerBar.style.setProperty('--player-dynamic-rgb', `${dimR}, ${dimG}, ${dimB}`);
            playerBar.style.setProperty('--player-dynamic-bg', `rgba(${dimR}, ${dimG}, ${dimB}, 0.75)`);
            // More solid version for the progress fill
            playerBar.style.setProperty('--player-dynamic-fill', `rgba(${r}, ${g}, ${b}, 0.85)`);
        };
    }

    const artistImageCache = {};

    async function fetchAndApplyArtistImage(artistName, elementNode, useXL = false) {
        if (!artistName || artistName === 'Unknown Artist') return;
        
        let targetEl = null;
        if (elementNode.classList && elementNode.classList.contains('artist-card-art')) {
            targetEl = elementNode;
        } else if (elementNode.classList && elementNode.classList.contains('artist-hero-avatar')) {
            targetEl = elementNode;
        } else {
            targetEl = elementNode.querySelector('.artist-card-art');
        }
        
        if (!targetEl) return;

        function applyImgToNode(url, target, node) {
            if (!url || target.innerHTML.includes('<img')) return;
            target.innerHTML = `<img src="${url}" crossorigin="anonymous" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; animation: fadeIn 0.5s;">`;
            if (node.classList && node.classList.contains('artist-hero-avatar')) {
                const artistView = document.getElementById('artist-view');
                if (artistView) artistView.style.setProperty('--view-bg-image', `url("${url}")`);
            }
        }

        if (!artistImageCache[artistName]) {
            artistImageCache[artistName] = { resolved: false, pending: false, waiters: [] };
        }

        const state = artistImageCache[artistName];

        if (state.resolved) {
            applyImgToNode(useXL ? state.xl : state.medium, targetEl, elementNode);
            return;
        }

        state.waiters.push({ targetEl, elementNode, useXL });
        if (state.pending) return;

        state.pending = true;
        
        // Use the global metadata map to instantly resolve if we know the artist hash
        let hashKey = null;
        if (window.artistImageHashes) {
            hashKey = Object.keys(window.artistImageHashes).find(k => k.toLowerCase() === artistName.toLowerCase());
        }

        if (hashKey) {
             state.resolved = true;
             state.medium = getTidalImage(window.artistImageHashes[hashKey], '320x320');
             state.xl = getTidalImage(window.artistImageHashes[hashKey], '750x750');
        } else {
             // Wait for potential background QQDL population
             state.resolved = false;
        }

        state.pending = false;
        
        if (state.resolved) {
            const finalWaiters = state.waiters;
            state.waiters = []; 
            
            finalWaiters.forEach(w => {
                if (state.medium) {
                    applyImgToNode(w.useXL ? state.xl : state.medium, w.targetEl, w.elementNode);
                }
            });

            document.dispatchEvent(new CustomEvent('artist-image-resolved', { detail: artistName }));
        }
    }

    let allTracks = [];
    let albumsData = {};
    let currentPlaylistContext = [];
    let currentTrackIndex = -1;
    let unplayedIndices = [];
    let currentViewInfo = {
        tracks: [],
        container: null,
        isPlaylistView: false,
        playlistId: null
    };
    // globalPlayingTrack removed: use window.globalPlayingTrack (declared at global scope via window assignment in playTrack)

    let activePlaylistId = null;
    let pendingAddTrack = null;
    let createPlaylistCallback = null;
    let lastSearchController = null;
    let artistSearchController = null;
    let dashActive = false;
    let activeViewAlbum = null;
    
    // --- View Caching (Persistent) ---
    const VIEW_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
    function getPersistedCache(key) {
        try {
            const data = JSON.parse(localStorage.getItem(key) || '{}');
            const now = Date.now();
            let changed = false;
            Object.keys(data).forEach(id => {
                if (!data[id].timestamp || (now - data[id].timestamp > VIEW_CACHE_TTL)) {
                    delete data[id];
                    changed = true;
                }
            });
            if (changed) localStorage.setItem(key, JSON.stringify(data));
            return data;
        } catch(e) { return {}; }
    }
    function updatePersistedCache(key, id, value) {
        try {
            const cache = JSON.parse(localStorage.getItem(key) || '{}');
            cache[id] = { data: value, timestamp: Date.now() };
            // Simple pruning if cache gets too big (> 50 items)
            const keys = Object.keys(cache);
            if (keys.length > 50) {
                delete cache[keys[0]];
            }
            localStorage.setItem(key, JSON.stringify(cache));
            
            // Sync local refs
            if (key === 'artistViewCache') artistViewCache = cache;
            if (key === 'albumViewCache') albumViewCache = cache;
            
            return cache;
        } catch(e) { return {}; }
    }

    let artistViewCache = getPersistedCache('artistViewCache');
    let albumViewCache = getPersistedCache('albumViewCache');

    // --- DASH Player State ---
    let shakaLibLoaded = false;
    let shakaPlayerInstance = null;
    let shakaStorageInstance = null;

    async function ensureDashPlayer() {
        if (window.shaka && shakaPlayerInstance && shakaStorageInstance) return true;
        
        if (window.shaka) {
            shakaLibLoaded = true;
            shaka.polyfill.installAll();
            if (shaka.Player.isBrowserSupported()) {
                if (!shakaPlayerInstance) shakaPlayerInstance = new shaka.Player(audioPlayer);
                if (!shakaStorageInstance) shakaStorageInstance = new shaka.offline.Storage(shakaPlayerInstance);
                return true;
            }
        }

        console.log("Loading Shaka Player for DASH & Offline support...");
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.3.5/shaka-player.compiled.js';
            script.onload = async () => {
                shakaLibLoaded = true;
                shaka.polyfill.installAll();
                if (shaka.Player.isBrowserSupported()) {
                    shakaPlayerInstance = new shaka.Player(audioPlayer);
                    shakaStorageInstance = new shaka.offline.Storage(shakaPlayerInstance);
                    
                    shakaPlayerInstance.addEventListener('error', (event) => {
                        console.error('Shaka Player error', event.detail);
                    });
                    
                    resolve(true);
                } else {
                    reject(new Error('Browser not supported for DASH.'));
                }
            };
            script.onerror = () => reject(new Error('Failed to load Shaka Player script. Check your internet connection.'));
            document.head.appendChild(script);
        });
    }

    async function playDashStream(manifest) {
        try {
            await ensureDashPlayer();
            
            // Critical: Always unload previous stream to reset MediaSource state
            await shakaPlayerInstance.unload();
            
            let manifestDataUrl;
            if (manifest.startsWith('offline:')) {
                // For downloaded DASH, the manifest is a Shaka Offline URI
                manifestDataUrl = manifest;
            } else if (manifest.trim().startsWith('<?xml') || manifest.trim().startsWith('<MPD')) {
                // For XML strings, encode to data URL
                manifestDataUrl = `data:application/dash+xml;charset=utf-8,${encodeURIComponent(manifest)}`;
            } else {
                // For Base64 strings, strip whitespace and embed directly
                const cleanManifest = manifest.replace(/\s/g, '');
                manifestDataUrl = `data:application/dash+xml;base64,${cleanManifest}`;
            }

            console.log("Loading DASH stream:", manifestDataUrl.startsWith('data:') ? 'Data URI' : manifestDataUrl);
            await shakaPlayerInstance.load(manifestDataUrl);
            audioPlayer.play().catch(e => console.error("Initial DASH play failed", e));
        } catch (e) {
            console.error('Error in playDashStream:', e);
            const errorMsg = e.toString ? e.toString() : (e.message || e);
            alert("Failed to play DASH stream: " + errorMsg);
        }
    }

    async function destroyDashPlayer() {
        if (shakaPlayerInstance) {
            await shakaPlayerInstance.detach();
            await shakaPlayerInstance.destroy();
            shakaPlayerInstance = null;
            // shakaLibLoaded = false; // KEEP LOADED to avoid redundant script injection
        }
    }
    // userQueue hoisted to global scope (line 13) so the sync engine can access it
    let downloadedTracksMap = new Map(); // url -> localPath
    let pendingDownloads = new Map(); // url -> progress


    // --- PWA Offline IndexedDB Helper ---
    const DB_NAME = 'SimonOffline';
    const STORE_NAME = 'tracks';

    function openOfflineDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async function saveTrackToDB(id, data, metadata, isDash = false, coverBlob = null, lyrics = null) {
        const db = await openOfflineDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const record = { id, metadata, timestamp: Date.now(), isDash, coverBlob, lyrics };
            if (isDash) record.offlineUri = data;
            else record.blob = data;
            
            const request = store.put(record);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async function getTrackRecordFromDB(id) {
        const db = await openOfflineDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async function deleteTrackFromDB(id) {
        const db = await openOfflineDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async function getAllOfflineTrackRecords() {
        if (typeof indexedDB === 'undefined') return [];
        const db = await openOfflineDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async function downloadDashTrack(track, manifest, coverBlob = null, lyrics = null) {
        try {
            if (!window.isSecureContext) {
                throw new Error("DASH offline storage requires a secure context (HTTPS or localhost).");
            }

            await ensureDashPlayer();
            
            let manifestDataUrl;
            if (manifest.trim().startsWith('<?xml') || manifest.trim().startsWith('<MPD')) {
                manifestDataUrl = `data:application/dash+xml;charset=utf-8,${encodeURIComponent(manifest)}`;
            } else {
                const cleanManifest = manifest.replace(/\s/g, '');
                manifestDataUrl = `data:application/dash+xml;base64,${cleanManifest}`;
            }

            const metadata = {
                title: (track.metadata && track.metadata.title) ? track.metadata.title : "Unknown Title",
                artist: (track.metadata && track.metadata.artist) ? track.metadata.artist : "Unknown Artist",
                album: (track.metadata && track.metadata.album) ? track.metadata.album : "Unknown Album",
                duration: (track.metadata && track.metadata.duration) ? track.metadata.duration : 0
            };

            const content = await shakaStorageInstance.store(manifestDataUrl, metadata);
            const offlineUri = content.offlineUri;
            
            await saveTrackToDB(track.url, offlineUri, track.metadata, true, coverBlob, lyrics);
            await syncOfflineState();
        } catch (e) {
            console.error('DASH Download failed:', e);
            throw e;
        }
    }

    // Lyrics Logic State
    const lyricsContainer = document.getElementById('immersive-lyrics-container');
    let lyricsData = [];
    let currentLyricIndex = -1;

    // Queue View Logic State
    const queueBtn = document.getElementById('queue-btn');
    const queueView = document.getElementById('queue-view');
    const queueNowPlaying = document.getElementById('queue-now-playing');
    const queueUserSection = document.getElementById('queue-user-section');
    const queueUserList = document.getElementById('queue-user-list');
    const queueContextList = document.getElementById('queue-context-list');
    const queueClearBtn = document.getElementById('queue-clear-btn');

    // Immersive View State
    const immersiveView = document.getElementById('immersive-view');
    const expandImmersiveBtn = document.getElementById('expand-immersive-btn');
    const immersiveBg = document.getElementById('immersive-bg');
    const immersiveArt = document.getElementById('immersive-art');
    const immersiveTitle = document.getElementById('immersive-title');
    const immersiveArtist = document.getElementById('immersive-artist');
    const immersiveLyricsContainer = lyricsContainer; // Keep reference for backward compatibility

    // Lyrics creation state
    let plainLyricsCache = '';
    let lyricsTrackUrl = '';
    let currentLyricsTitle = '';
    let currentLyricsArtist = '';
    let currentLyricsAlbum = '';
    let currentLyricsDuration = 0;
    let syncLines = [];
    let syncTimestamps = [];
    let syncCurrentLineIdx = 0;
    let syncKeyHandler = null;

    // ── Immersive UI logic ───────────────────────────────────────────────────
    // ── Immersive UI logic ───────────────────────────────────────────────────
    function toggleImmersiveView() {
        if (immersiveView.classList.contains('active')) {
            history.back();
        } else {
            navigateTo('immersive');
        }
    }
    if (expandImmersiveBtn) {
        expandImmersiveBtn.addEventListener('click', toggleImmersiveView);
    }
    const closeImmersiveBtn = document.getElementById('close-immersive-btn');
    if (closeImmersiveBtn) {
        closeImmersiveBtn.addEventListener('click', toggleImmersiveView);
    }
    const toggleArtBtn = document.getElementById('toggle-art-btn');
    if (toggleArtBtn) {
        toggleArtBtn.addEventListener('click', () => {
            immersiveView.classList.toggle('hide-art');
        });
    }

    function showImmersiveOverlay() {
        // Can choose to hide queue overlay if it's open
        hideQueueOverlay();
        openViewAnimated(immersiveView);
        if(expandImmersiveBtn) expandImmersiveBtn.classList.add('active-icon');
        
        // Global state initialization
        document.body.classList.add('immersive-active');
        const playerBar = document.querySelector('.player-bar');
        if (playerBar) playerBar.classList.add('fullscreen-active');
        
        // instantly scroll to active lyric if any
        if (currentLyricIndex !== -1 && lyricsData[currentLyricIndex]) {
             updateLyricsSync();
        }
    }

    function hideImmersiveOverlay() {
        if (immersiveView && immersiveView.classList.contains('active')) {
            closeViewAnimated(immersiveView, 500);
            if(expandImmersiveBtn) expandImmersiveBtn.classList.remove('active-icon');
            
            // Global state cleanup
            document.body.classList.remove('immersive-active');
            const playerBar = document.querySelector('.player-bar');
            if (playerBar) playerBar.classList.remove('fullscreen-active');
        }
    }


    // ── Queue UI logic ────────────────────────────────────────────────────────
    function toggleQueueView() {
        if (queueView.classList.contains('active')) {
            history.back();
        } else {
            navigateTo('queue');
        }
    }

    function showQueueOverlay() {
        hideOverlays();
        queueView.classList.remove('hidden');
        queueView.classList.add('active');
        queueBtn.classList.add('active-icon');
        renderQueueView();
    }

    queueBtn.addEventListener('click', toggleQueueView);

    queueClearBtn.addEventListener('click', () => {
        userQueue = [];
        renderQueueView();
        
        if (currentUser) {
            window._fbDB.ref(`users/${currentUser.uid}/activeContext/queue`).set([]);
        }
    });

    function renderQueueView() {
        if (!window.globalPlayingTrack) {
            queueNowPlaying.innerHTML = '<div class="search-empty-text" style="font-size:14px; opacity:0.5;">Nothing playing</div>';
            queueUserSection.style.display = 'none';
            queueContextList.innerHTML = '<div class="search-empty-text" style="font-size:14px; opacity:0.5;">No context</div>';
            return;
        }
        
        // Render Now Playing
        renderTrackList([window.globalPlayingTrack], queueNowPlaying);
        
        // Render User Queue
        if (userQueue.length > 0) {
            queueUserSection.style.display = 'flex';
            renderTrackList(userQueue, queueUserList);
        } else {
            queueUserSection.style.display = 'none';
        }

        // Render Context Coming Up
        const contextRemaining = [];
        if (isShuffleActive) {
            unplayedIndices.forEach(idx => {
                if (currentPlaylistContext[idx] && !isTrackUnsupported(currentPlaylistContext[idx])) {
                    contextRemaining.push(currentPlaylistContext[idx]);
                }
            });
        } else {
            for (let i = currentTrackIndex + 1; i < currentPlaylistContext.length; i++) {
                if (!isTrackUnsupported(currentPlaylistContext[i])) {
                    contextRemaining.push(currentPlaylistContext[i]);
                }
            }
        }
        
        if (contextRemaining.length > 0) {
            renderTrackList(contextRemaining.slice(0, 50), queueContextList); // limit to 50 to prevent freezing
        } else {
            queueContextList.innerHTML = '<div class="search-empty-text" style="font-size:14px; opacity:0.5;">End of list</div>';
        }
    }

    function addToQueue(track) {
        userQueue.push(track);
        if (queueView.classList.contains('active')) {
            renderQueueView();
        }
        
        if (currentUser) {
            window._fbDB.ref(`users/${currentUser.uid}/activeContext/queue`).transaction((currentQueue) => {
                const q = currentQueue || [];
                q.push(track);
                return q;
            });
        }
    }

    // Modal Logic
    function showDependencyModal() {
        dependencyModal.classList.remove('hidden');
    }

    function hideDependencyModal() {
        dependencyModal.classList.add('hidden');
    }

    // Settings Panel Logic
    function openSettings(push = true) {
        if (push) navigateTo('settings');
        hideOverlays();
        
        settingsView.classList.remove('hidden');
        settingsView.classList.add('active');
        settingsBtn.classList.add('settings-btn-active');
    }

    function closeSettings() {
        settingsView.classList.remove('active');
        settingsBtn.classList.remove('settings-btn-active');
    }

    if (deviceBtn) {
        deviceBtn.addEventListener('click', () => {
            renderSettingsPanel();
            openSettings();
        });
    }

    settingsBtn.addEventListener('click', () => {
        if (settingsView.classList.contains('active')) {
            history.back();
        } else {
            renderSettingsPanel();
            openSettings();
        }
    });

    settingsCloseBtn.addEventListener('click', () => {
        history.back();
    });

    // ── Metadata Editor Logic ────────────────────────────────────────────────
    
    function showContextMenu(e, track, sourceBtn) {
        e.stopPropagation();
        currentEditingTrack = track;
        
        const rect = sourceBtn.getBoundingClientRect();
        trackContextMenu.style.top = `${rect.bottom + 5}px`;
        trackContextMenu.style.left = `${rect.right - 180}px`;
        trackContextMenu.classList.remove('hidden');
        
        // Hide playlist btn if already in a playlist view? No, keep it.
    }

    function hideContextMenu() {
        trackContextMenu.classList.add('hidden');
    }

    document.addEventListener('click', (e) => {
        // Close context menu if clicking outside
        if (trackContextMenu && !trackContextMenu.contains(e.target) && !e.target.closest('.track-item-more-btn')) {
            hideContextMenu();
        }
    });

    menuPlaylistBtn.addEventListener('click', (e) => {
        hideContextMenu();
        if (currentEditingTrack) showAddToPlaylistDropdown(currentEditingTrack, e.target);
    });



    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && settingsView.classList.contains('active')) {
            closeSettings();
        }
    });

    // ── Settings Panel Renderer ───────────────────────────────────────────────
    // ── Settings Panel Renderer ───────────────────────────────────────────────
    function renderSettingsPanel() {
        const body = settingsView.querySelector('.settings-body');
        if (!body) return;

        body.innerHTML = `
            <div class="settings-section">
                <div class="settings-section-title">Account</div>
                <div class="settings-row">
                    ${currentUser ? `
                        <div class="settings-row-info">
                            <div class="settings-row-label">Signed in as</div>
                            <div class="settings-row-sub">${currentUser.email}</div>
                        </div>
                        <button id="sign-out-btn" class="settings-reset-btn">Sign Out</button>
                    ` : `
                        <div class="settings-row-info">
                            <div class="settings-row-label">Not signed in</div>
                            <div class="settings-row-sub">Sign in to sync devices and play together</div>
                        </div>
                        <button id="settings-signin-btn" class="modal-btn primary-btn" style="padding: 10px 16px; font-size: 13px;">Sign In</button>
                    `}
                </div>
            </div>

            <div class="settings-section">
                <div class="settings-section-title">Devices &amp; Handoff</div>
                <div id="settings-device-list" class="settings-device-list">
                    <div class="loading-state">Loading devices...</div>
                </div>
            </div>
            
            <div id="remote-control-panel" class="settings-section hidden" style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 20px;">
                <div class="settings-section-title">Remote Control</div>
                <div id="remote-control-status" class="remote-control-status"></div>
                <div class="remote-control-actions" style="display: flex; gap: 10px; margin-top: 15px;">
                     <button id="remote-prev-btn" class="icon-button"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 19 2 12 11 5 11 19"></polygon><polygon points="22 19 13 12 22 5 22 19"></polygon></svg></button>
                     <button id="remote-play-pause-btn" class="icon-button"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button>
                     <button id="remote-next-btn" class="icon-button"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 19 22 12 13 5 13 19"></polygon><polygon points="2 19 11 12 2 5 2 19"></polygon></svg></button>
                </div>
                <div style="margin-top: 15px; display: flex; align-items: center; gap: 10px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                    <input id="remote-volume-slider" type="range" min="0" max="1" step="0.01" style="flex: 1;">
                </div>
            </div>
        `;

        const signOutBtn = document.getElementById('sign-out-btn');
        if (signOutBtn) {
            signOutBtn.addEventListener('click', () => {
                window._fbAuth.signOut();
            });
        }

        const signInBtn = document.getElementById('settings-signin-btn');
        if (signInBtn) {
            signInBtn.addEventListener('click', () => {
                showAuthOverlay(); // Show the login modal we already have
            });
        }

        // Trigger immediate device list render — cache-first to avoid a network round-trip on every open
        const uid = currentUser?.uid;
        if (uid) {
            const now = Date.now();
            if (deviceListCache && (now - deviceListCache.timestamp < DEVICE_CACHE_TTL)) {
                // Serve from cache immediately
                renderDeviceList(deviceListCache.data);
            } else {
                // Cache miss or stale — fetch fresh data and cache it
                window._fbDB.ref(`users/${uid}/devices`).once('value', snap => {
                    deviceListCache = { data: snap.val(), timestamp: Date.now() };
                    renderDeviceList(deviceListCache.data);
                });
            }
        } else {
            renderDeviceList(null); // Show guest placeholder
        }
    }

    function renderDeviceList(devices) {
        const listContainer = document.getElementById('settings-device-list');
        if (!listContainer) return;
        
        if (!currentUser) {
            listContainer.innerHTML = `
                <div style="text-align: center; padding: 20px; background: rgba(255,255,255,0.03); border-radius: 8px; border: 1px dashed rgba(255,255,255,0.1);">
                    <div style="font-size: 12px; color: #a0a0a0; margin-bottom: 12px;">Sign in to sync your playback across devices</div>
                    <button id="device-list-signin-btn" class="modal-btn secondary-btn" style="padding: 6px 12px; font-size: 11px;">Sign In</button>
                </div>
            `;
            const btn = document.getElementById('device-list-signin-btn');
            if (btn) btn.addEventListener('click', () => showAuthOverlay());
            return;
        }

        if (!devices) {
            listContainer.innerHTML = '<div class="empty-state">No other devices found</div>';
            return;
        }

        listContainer.innerHTML = '';
        Object.keys(devices).forEach(id => {
            const dev = devices[id];
            const isMe = id === deviceId;
            const isMaster = dev.online && masterDeviceId === id;
            
            const card = document.createElement('div');
            card.className = `device-card ${dev.online ? 'online' : 'offline'} ${isMe ? 'is-me' : ''}`;
            card.style = `background: ${isMaster ? 'rgba(255,107,129,0.1)' : 'rgba(255,255,255,0.05)'}; border-radius: 8px; padding: 12px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; border: 1px solid ${isMaster ? 'var(--primary)' : 'transparent'}`;
            
            const icon = dev.type === 'electron' ? '🖥️' : '📱';
            const statusColor = dev.online ? '#4ade80' : '#a0a0a0';
            
            card.innerHTML = `
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="font-size: 24px;">${icon}</div>
                    <div>
                        <div style="font-weight: 600;">
                            ${dev.name} ${isMe ? '(This device)' : ''}
                            ${isMaster ? '<span style="color:var(--primary); font-size: 10px; margin-left: 8px; vertical-align: middle;">🔊 MASTER</span>' : ''}
                        </div>
                        <div style="font-size: 12px; color: ${statusColor}; margin-top: 2px;">
                            ${dev.online ? 'Online' : 'Last seen ' + new Date(dev.lastSeen).toLocaleDateString()}
                        </div>
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    ${isMe && !isMaster && dev.online ? `<button class="modal-btn primary-btn take-control-btn" style="padding: 6px 12px; font-size: 11px;">Play on this device</button>` : ''}
                </div>
            `;
            
            listContainer.appendChild(card);
        });

        // Add take-control listeners (for all "Play on this device" buttons)
        listContainer.querySelectorAll('.take-control-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const b = e.currentTarget;
                b.textContent = 'Linking...';
                b.disabled = true;
                takeMasterControl();
            });
        });
    }

    function setupRemoteControlUI(targetId, deviceData) {
        const panel = document.getElementById('remote-control-panel');
        const status = document.getElementById('remote-control-status');
        if (!panel || !status) return;

        FirebaseRemoteEngine.setControllingDevice(targetId);
        panel.classList.remove('hidden');
        status.innerHTML = `Controlling <strong>${deviceData.name}</strong>`;

        // Update UI based on target state if available
        if (deviceData.state) {
            const vol = document.getElementById('remote-volume-slider');
            if (vol) vol.value = deviceData.state.volume || 0.7;
        }

        // Attach listeners for buttons (one-time or refreshed)
        const playBtn = document.getElementById('remote-play-pause-btn');
        const prevBtn = document.getElementById('remote-prev-btn');
        const nextBtn = document.getElementById('remote-next-btn');
        const volSlider = document.getElementById('remote-volume-slider');

        // Clear existing listeners by cloning
        const newPlayBtn = playBtn.cloneNode(true);
        playBtn.parentNode.replaceChild(newPlayBtn, playBtn);
        
        newPlayBtn.addEventListener('click', () => FirebaseRemoteEngine.sendCommand(targetId, 'PLAY_PAUSE'));
        prevBtn.onclick = () => FirebaseRemoteEngine.sendCommand(targetId, 'PREV');
        nextBtn.onclick = () => FirebaseRemoteEngine.sendCommand(targetId, 'NEXT');
        volSlider.oninput = (e) => FirebaseRemoteEngine.sendCommand(targetId, 'SET_VOLUME', { volume: parseFloat(e.target.value) });
    }

    // ─────────────────────────────────────────────────────────────────────────

    modalCancelBtn.addEventListener('click', hideDependencyModal);
    dependencyModal.addEventListener('click', (e) => {
        if (e.target === dependencyModal) hideDependencyModal();
    });

    modalInstallBtn.addEventListener('click', async () => {
        modalInstallBtn.textContent = 'Installing...';
        modalInstallBtn.disabled = true;
        modalCancelBtn.style.display = 'none';
        
        if (window.electronAPI) {
            await window.electronAPI.installCodecs();
        } else {
            console.warn('Install codecs only available in desktop app');
            // On mobile, we can just close the modal as the browser handles codecs
            hideDependencyModal();
        }
        
        hideDependencyModal();
    });

    // Playback Controls Logic
    function setRepeatMode(mode, broadcast = true) {
        // UNIVERSAL SYNC: Slave redirection
        if (broadcast && masterDeviceId && deviceId !== masterDeviceId && currentUser) {
            FirebaseRemoteEngine.sendCommand(masterDeviceId, 'SET_REPEAT', { mode });
            return;
        }

        repeatMode = mode;
        if (repeatMode === 0) {
            repeatBtn.classList.remove('toggle-active');
            repeatIcon.innerHTML = `
                <polyline points="17 1 21 5 17 9"></polyline>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                <polyline points="7 23 3 19 7 15"></polyline>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
            `;
        } else if (repeatMode === 1) {
            repeatBtn.classList.add('toggle-active');
            repeatIcon.innerHTML = `
                <polyline points="17 1 21 5 17 9"></polyline>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                <polyline points="7 23 3 19 7 15"></polyline>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
            `;
        } else if (repeatMode === 2) {
            repeatBtn.classList.add('toggle-active');
            repeatIcon.innerHTML = `
                <polyline points="17 1 21 5 17 9"></polyline>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                <polyline points="7 23 3 19 7 15"></polyline>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
                <text x="12" y="16.5" font-size="9" font-family="sans-serif" font-weight="bold" stroke="none" fill="currentColor" text-anchor="middle">1</text>
            `;
        }

        if (broadcast && deviceId === masterDeviceId) {
            if (typeof broadcastActiveContext === 'function') broadcastActiveContext(true);
        }
    }

    repeatBtn.addEventListener('click', () => {
        const nextMode = (repeatMode + 1) % 3;
        setRepeatMode(nextMode);
    });

    function setShuffleState(active, broadcast = true) {
        // UNIVERSAL SYNC: Slave redirection
        if (broadcast && masterDeviceId && deviceId !== masterDeviceId && currentUser) {
            FirebaseRemoteEngine.sendCommand(masterDeviceId, 'SET_SHUFFLE', { active });
            return;
        }

        isShuffleActive = active;
        if (isShuffleActive) {
            shuffleBtn.classList.add('toggle-active');
            if (currentPlaylistContext.length > 0) {
                unplayedIndices = currentPlaylistContext.map((_, i) => i).filter(i => i !== currentTrackIndex);
            }
        } else {
            shuffleBtn.classList.remove('toggle-active');
        }

        if (broadcast && deviceId === masterDeviceId) {
            if (typeof broadcastActiveContext === 'function') broadcastActiveContext(true);
        }
    }

    shuffleBtn.addEventListener('click', () => {
        setShuffleState(!isShuffleActive);
    });

    if (bottomOfflineBtn) {
        bottomOfflineBtn.addEventListener('click', async () => {
            if (!window.globalPlayingTrack) return;
            const isOffline = downloadedTracksMap.has(window.globalPlayingTrack.url);
            const isDownloading = pendingDownloads.has(window.globalPlayingTrack.url);
            
            if (isOffline) {
                if (confirm(`Remove "${window.globalPlayingTrack.metadata.title}" from offline storage?`)) {
                    await removeOfflineTrack(window.globalPlayingTrack.url);
                    await syncOfflineState();
                }
            } else if (!isDownloading) {
                initiateDownload(window.globalPlayingTrack);
            } else {
                console.log('Already downloading...');
            }
        });
    }

    playPauseBtn.addEventListener('click', () => {
        // UNIVERSAL SYNC: Slave remote control
        if (masterDeviceId && deviceId !== masterDeviceId && currentUser) {
            FirebaseRemoteEngine.sendCommand(masterDeviceId, 'PLAY_PAUSE');
            return;
        }

        const targetId = FirebaseRemoteEngine.getControllingDevice();
        if (targetId) {
            FirebaseRemoteEngine.sendCommand(targetId, 'PLAY_PAUSE');
            return;
        }
        if (!audioPlayer.src) return;
        if (audioPlayer.paused) {
            audioPlayer.play();
        } else {
            audioPlayer.pause();
        }
    });

    audioPlayer.addEventListener('play', () => {
        playIcon.setAttribute('d', 'M6 19h4V5H6v14zm8-14v14h4V5h-4z'); 
        
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
        }

        if (window.electronAPI && window.globalPlayingTrack) {
            const title = (window.globalPlayingTrack.metadata && window.globalPlayingTrack.metadata.title) ? window.globalPlayingTrack.metadata.title : window.globalPlayingTrack.filename;
            const artist = (window.globalPlayingTrack.metadata && window.globalPlayingTrack.metadata.artist) ? window.globalPlayingTrack.metadata.artist : 'Unknown Artist';
            window.electronAPI.updatePresence({ title, artist, startTime: Date.now(), isPaused: false });
        }

        // UNIVERSAL SYNC: Master broadcasts immediately
        if (typeof deviceId !== 'undefined' && deviceId === masterDeviceId) {
            if (typeof broadcastActiveContext === 'function') broadcastActiveContext(true);
        }
    });

    audioPlayer.addEventListener('pause', () => {
        playIcon.setAttribute('d', 'M8 5v14l11-7z'); 
        
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused';
        }

        if (window.electronAPI && window.globalPlayingTrack) {
            const title = (window.globalPlayingTrack.metadata && window.globalPlayingTrack.metadata.title) ? window.globalPlayingTrack.metadata.title : window.globalPlayingTrack.filename;
            const artist = (window.globalPlayingTrack.metadata && window.globalPlayingTrack.metadata.artist) ? window.globalPlayingTrack.metadata.artist : 'Unknown Artist';
            window.electronAPI.updatePresence({ title, artist, isPaused: true });
        }

        // UNIVERSAL SYNC: Master broadcasts immediately
        if (typeof deviceId !== 'undefined' && deviceId === masterDeviceId) {
            if (typeof broadcastActiveContext === 'function') broadcastActiveContext(true);
        }
    });

    audioPlayer.addEventListener('seeked', () => {
        // UNIVERSAL SYNC: Master broadcasts immediately
        if (typeof deviceId !== 'undefined' && deviceId === masterDeviceId) {
            if (typeof broadcastActiveContext === 'function') broadcastActiveContext(true);
        }
    });

    audioPlayer.addEventListener('volumechange', () => {
        // Volume is independent per user choice
    });

    function isTrackUnsupported(track) {
        if (!track || !track.filename) return false;
        const lower = track.filename.toLowerCase();
        return lower.endsWith('.m4a') || lower.endsWith('.aac');
    }

    function getNextPlayableIndex(startIndex, direction = 1, isAutoEnded = false) {
        let i = startIndex;
        const total = currentPlaylistContext.length;
        if (total === 0) return -1;
        let checked = 0;

        while (checked < total) {
            if (!isTrackUnsupported(currentPlaylistContext[i])) return i;
            i += direction;
            checked++;
            if (i >= total) {
                if (repeatMode === 1 || !isAutoEnded) {
                    i = 0;
                } else {
                    return -1;
                }
            } else if (i < 0) {
                if (repeatMode === 1) {
                    i = total - 1;
                } else {
                    return -1;
                }
            }
        }
        return -1;
    }

    function commitTrackChange(index) {
        if (index < 0 || index >= currentPlaylistContext.length) return;
        if (isTrackUnsupported(currentPlaylistContext[index])) return;
        if (index < 0 || index >= currentPlaylistContext.length) return;
        
        currentTrackIndex = index;
        if (isShuffleActive) {
            unplayedIndices = unplayedIndices.filter(i => i !== index);
        }
        
        const track = currentPlaylistContext[index];
        const title = (track.metadata && track.metadata.title) ? track.metadata.title : track.filename;
        const artist = (track.metadata && track.metadata.artist) ? track.metadata.artist : 'Unknown Artist';
        
        document.querySelectorAll('.track-item').forEach(el => el.classList.remove('active'));
        
        const activeView = document.querySelector('.view.active');
        if (activeView) {
            const trackItems = activeView.querySelectorAll('.track-item');
            if (trackItems[index]) {
                trackItems[index].classList.add('active');
            }
        }
        
        playTrack(track, title, artist);
    }

    let prefetchedNextTrackData = null;

    function peekNextTrack(isAutoEnded) {
        if (userQueue.length > 0) return { track: userQueue[0], index: -1, isFromQueue: true };
        if (currentTrackIndex === -1) return null;
        
        let nextIdx = -1;
        if (isShuffleActive) {
            if (unplayedIndices.length === 0) {
                if (repeatMode === 0 && isAutoEnded) return null;
                const playable = currentPlaylistContext.map((_, i) => i).filter(i => i !== currentTrackIndex && !isTrackUnsupported(currentPlaylistContext[i]));
                if (playable.length > 0) nextIdx = playable[Math.floor(Math.random() * playable.length)];
            } else if (unplayedIndices.length > 0) {
                nextIdx = unplayedIndices[Math.floor(Math.random() * unplayedIndices.length)];
            }
        } else {
            nextIdx = getNextPlayableIndex(currentTrackIndex + 1, 1, isAutoEnded);
        }

        if (nextIdx !== -1) return { track: currentPlaylistContext[nextIdx], index: nextIdx, isFromQueue: false };
        return null;
    }

    async function triggerBackgroundPrefetch() {
        if (prefetchedNextTrackData && (prefetchedNextTrackData.status === 'fetching' || prefetchedNextTrackData.status === 'ready' || prefetchedNextTrackData.status === 'failed')) return; 
        const upcoming = peekNextTrack(true);
        if (!upcoming) return;
        
        prefetchedNextTrackData = { status: 'fetching', track: upcoming.track, index: upcoming.index, isFromQueue: upcoming.isFromQueue };
        
        let fullAudioUrl = upcoming.track.url;
        let isWaitingForDash = false;
        
        try {
            if (upcoming.track.isCloud && upcoming.track.url.startsWith('qqdl://')) {
                const resolved = await resolveCloudTrackUrl(upcoming.track);
                if (resolved && typeof resolved === 'object') {
                    fullAudioUrl = resolved.url || upcoming.track.url;
                    isWaitingForDash = resolved.isDash;
                } else if (resolved) {
                    fullAudioUrl = resolved;
                }
            }
            
            const localPath = downloadedTracksMap.get(upcoming.track.url);
            if (localPath) {
                if (localPath.startsWith('offline:')) {
                    isWaitingForDash = true;
                } else if (window.electronAPI && !localPath.startsWith('pwa-stored')) {
                    fullAudioUrl = `simon-offline://${encodeURIComponent(localPath)}`;
                } else {
                    fullAudioUrl = `./pwa-offline/${encodeURIComponent(upcoming.track.url)}`;
                }
            }
            
            prefetchedNextTrackData = {
                status: 'ready', url: fullAudioUrl, isDash: isWaitingForDash,
                track: upcoming.track, index: upcoming.index, isFromQueue: upcoming.isFromQueue
            };
        } catch(e) { prefetchedNextTrackData = { status: 'failed' }; }
    }

    function playNextTrack(isAutoEnded, skipAudioInjection = false) {
        let selectedTrack = null;
        let selectedIndex = -1;
        let isFromQueue = false;

        if (prefetchedNextTrackData && prefetchedNextTrackData.status === 'ready') {
            selectedTrack = prefetchedNextTrackData.track;
            selectedIndex = prefetchedNextTrackData.index;
            isFromQueue = prefetchedNextTrackData.isFromQueue;
            if (skipAudioInjection) prefetchedNextTrackData.skipAudioInjection = true;
        } else {
            const peeked = peekNextTrack(isAutoEnded);
            if (peeked) {
                selectedTrack = peeked.track;
                selectedIndex = peeked.index;
                isFromQueue = peeked.isFromQueue;
            }
        }

        if (!selectedTrack) {
            if (isAutoEnded) audioPlayer.pause();
            prefetchedNextTrackData = null;
            return;
        }

        if (isFromQueue) {
            userQueue.shift();
            if (currentUser) {
                window._fbDB.ref(`users/${currentUser.uid}/activeContext/queue`).transaction((currentQueue) => {
                    const q = currentQueue || [];
                    q.shift();
                    return q;
                });
            }
            const title = (selectedTrack.metadata && selectedTrack.metadata.title) ? selectedTrack.metadata.title : selectedTrack.filename;
            const artist = (selectedTrack.metadata && selectedTrack.metadata.artist) ? selectedTrack.metadata.artist : 'Unknown Artist';
            playTrack(selectedTrack, title, artist, skipAudioInjection ? prefetchedNextTrackData : null);
            if (queueView && queueView.classList.contains('active')) renderQueueView();
        } else if (selectedIndex !== -1) {
            if (isShuffleActive) {
                if (unplayedIndices.length === 0) {
                    unplayedIndices = currentPlaylistContext.map((_, i) => i).filter(i => i !== currentTrackIndex && !isTrackUnsupported(currentPlaylistContext[i]));
                }
                unplayedIndices = unplayedIndices.filter(i => i !== selectedIndex);
            }
            
            currentTrackIndex = selectedIndex;
            const title = (selectedTrack.metadata && selectedTrack.metadata.title) ? selectedTrack.metadata.title : selectedTrack.filename;
            const artist = (selectedTrack.metadata && selectedTrack.metadata.artist) ? selectedTrack.metadata.artist : 'Unknown Artist';
            
            document.querySelectorAll('.track-item').forEach(el => el.classList.remove('active'));
            const activeView = document.querySelector('.view.active');
            if (activeView) {
                const trackItems = activeView.querySelectorAll('.track-item');
                if (trackItems[selectedIndex]) trackItems[selectedIndex].classList.add('active');
            }
            playTrack(selectedTrack, title, artist, skipAudioInjection ? prefetchedNextTrackData : null);
        }
    }

    function playPreviousTrack() {
        if (!audioPlayer.src) return;
        
        if (audioPlayer.currentTime > 3) {
            audioPlayer.currentTime = 0;
            audioPlayer.play();
            return;
        }

        const prevIdx = getNextPlayableIndex(currentTrackIndex - 1, -1, false);
        if (prevIdx !== -1) {
            commitTrackChange(prevIdx);
        } else {
            audioPlayer.currentTime = 0;
            audioPlayer.play();
        }
    }

    nextBtn.addEventListener('click', () => {
        // UNIVERSAL SYNC: Slave remote control
        if (masterDeviceId && deviceId !== masterDeviceId && currentUser) {
            FirebaseRemoteEngine.sendCommand(masterDeviceId, 'NEXT');
            return;
        }
        const targetId = FirebaseRemoteEngine.getControllingDevice();
        if (targetId) {
            FirebaseRemoteEngine.sendCommand(targetId, 'NEXT');
            return;
        }
        playNextTrack(false);
    });

    prevBtn.addEventListener('click', () => {
        // UNIVERSAL SYNC: Slave remote control
        if (masterDeviceId && deviceId !== masterDeviceId && currentUser) {
            FirebaseRemoteEngine.sendCommand(masterDeviceId, 'PREV');
            return;
        }
        const targetId = FirebaseRemoteEngine.getControllingDevice();
        if (targetId) {
            FirebaseRemoteEngine.sendCommand(targetId, 'PREV');
            return;
        }
        playPreviousTrack();
    });

    // Mobile Swipe Gestures
    let touchStartX = 0;
    let touchMoveX = 0;

    function initMobileGestures() {
        const playerBar = document.querySelector('.player-bar');
        if (!playerBar) return;

        playerBar.addEventListener('touchstart', (e) => {
            if (window.innerWidth > 768) return;
            
            // If we're interacting with a button, ignore the swipe logic
            if (e.target.closest('button') || e.target.closest('.volume-container')) return;

            touchStartX = e.touches[0].clientX;
            touchMoveX = touchStartX; // Reset move tracker to start position
            playerBar.style.transition = 'none'; // Disable transition for raw tracking
        }, { passive: true });

        playerBar.addEventListener('touchmove', (e) => {
            if (window.innerWidth > 768) return;
            touchMoveX = e.touches[0].clientX;
            const deltaX = touchMoveX - touchStartX;
            
            // Limit the slide to ±40px for subtle feedback
            const boundedX = Math.max(-40, Math.min(40, deltaX));
            playerBar.style.transform = `translateX(${boundedX}px)`;
        }, { passive: true });

        playerBar.addEventListener('touchend', (e) => {
            if (window.innerWidth > 768) return;
            const deltaX = touchMoveX - touchStartX;
            
            playerBar.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            playerBar.style.transform = 'translateX(0)';

            if (Math.abs(deltaX) > 60) {
                // UNIVERSAL SYNC: Slave remote control (mirrors nextBtn/prevBtn logic)
                if (typeof deviceId !== 'undefined' && typeof masterDeviceId !== 'undefined' && deviceId !== masterDeviceId && currentUser) {
                    FirebaseRemoteEngine.sendCommand(masterDeviceId, deltaX < 0 ? 'NEXT' : 'PREV');
                } else {
                    if (deltaX < 0) {
                        // Swipe Left -> Next
                        playNextTrack(false);
                    } else {
                        // Swipe Right -> Previous
                        playPreviousTrack();
                    }
                }
            } else if (Math.abs(deltaX) < 10) {
                // It was a tap, not a swipe
                const isButtonAction = e.target.closest('button') || e.target.closest('.volume-container');
                if (!isButtonAction && typeof toggleImmersiveView === 'function') {
                    toggleImmersiveView();
                }
            }
            
            // Reset trackers
            touchStartX = 0;
            touchMoveX = 0;
        });
    }

    initMobileGestures();

    audioPlayer.addEventListener('ended', () => {
        if (repeatMode === 2) {
            audioPlayer.currentTime = 0;
            audioPlayer.play();
        } else {
            // Unbroken Synchronous UI Gapless Injection
            if (prefetchedNextTrackData && prefetchedNextTrackData.status === 'ready' && !prefetchedNextTrackData.isDash) {
                audioPlayer.src = prefetchedNextTrackData.url;
                audioPlayer.play().catch(e => console.warn('Prefetch auto-play interrupted', e));
                playNextTrack(true, true); // skip audio override in playTrack
            } else {
                playNextTrack(true, false);
            }
        }
    });

    // Timing and Scrubber Logic
    // formatTime() is defined at global scope (line 19) — available here via scope chain

    audioPlayer.addEventListener('loadedmetadata', () => {
        totalTimeEl.textContent = formatTime(audioPlayer.duration);
    });

    audioPlayer.addEventListener('timeupdate', () => {
        if (audioPlayer.duration && audioPlayer.currentTime > audioPlayer.duration - 15) {
            triggerBackgroundPrefetch();
        }

        if (!isDraggingScrubber) {
            currentTimeEl.textContent = formatTime(audioPlayer.currentTime);
            if (audioPlayer.duration) {
                const percent = (audioPlayer.currentTime / audioPlayer.duration) * 100;
                progressFill.style.width = `${percent}%`;
                
                // Update dynamic full-bar progress on mobile
                const playerBar = document.querySelector('.player-bar');
                if (playerBar && window.innerWidth <= 768) {
                    playerBar.style.setProperty('--player-progress', `${percent}%`);
                }
            }
        }
        
        if (typeof updateLyricsSync === 'function') {
            updateLyricsSync();
        }
    });

    function updateScrubberVisuals(e) {
        const duration = audioPlayer.duration || window.globalPlayingTrack?.metadata?.duration;
        if (!duration) return 0;
        const rect = progressBarContainer.getBoundingClientRect();
        let clickX = e.clientX - rect.left;
        
        // bound it
        if (clickX < 0) clickX = 0;
        if (clickX > rect.width) clickX = rect.width;
        
        const percent = clickX / rect.width;
        
        // update local visuals
        progressFill.style.width = `${percent * 100}%`;
        currentTimeEl.textContent = formatTime(percent * duration);
        return percent;
    }

    function isSeekingDisabled() {
        if (!window.globalPlayingTrack) return false;
        const url = window.globalPlayingTrack.url.toLowerCase();
        return url.endsWith('.m4a') || url.endsWith('.aac');
    }

    progressBarContainer.addEventListener('mousedown', (e) => {
        if (!audioPlayer.src && deviceId === masterDeviceId && !FirebaseRemoteEngine.getControllingDevice()) return;
        if (isSeekingDisabled()) return;
        isDraggingScrubber = true;
        updateScrubberVisuals(e);
    });

    progressBarContainer.addEventListener('mousemove', (e) => {
        const duration = audioPlayer.duration || window.globalPlayingTrack?.metadata?.duration;
        if (!duration) return;
        
        const rect = progressBarContainer.getBoundingClientRect();
        let hoverX = e.clientX - rect.left;
        
        if (hoverX < 0) hoverX = 0;
        if (hoverX > rect.width) hoverX = rect.width;
        
        const percent = hoverX / rect.width;
        
        hoverTooltip.style.left = `${percent * 100}%`;
        
        if (isSeekingDisabled()) {
            hoverTooltip.textContent = "Seeking disabled for M4A/AAC files";
        } else {
            hoverTooltip.textContent = formatTime(percent * duration);
        }
    });

    // Touch support for mobile rail
    const handleTouchScrub = (e) => {
        if (!audioPlayer.src || isSeekingDisabled()) return;
        const touch = e.touches[0];
        if (!touch) return;
        const rect = progressBarContainer.getBoundingClientRect();
        let clickX = touch.clientX - rect.left;
        
        if (clickX < 0) clickX = 0;
        if (clickX > rect.width) clickX = rect.width;
        
        const percent = clickX / rect.width;
        progressFill.style.width = `${percent * 100}%`;
        
        const duration = audioPlayer.duration || window.globalPlayingTrack?.metadata?.duration;
        if (duration) {
            hoverTooltip.style.opacity = '1';
            hoverTooltip.style.left = `${percent * 100}%`;
            hoverTooltip.textContent = formatTime(percent * duration);
        }
        
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        return percent;
    };

    progressBarContainer.addEventListener('touchstart', (e) => {
        if (!audioPlayer.src && deviceId === masterDeviceId && !FirebaseRemoteEngine.getControllingDevice()) return;
        if (isSeekingDisabled()) return;
        isDraggingScrubber = true;
        handleTouchScrub(e);
    }, { passive: false });

    progressBarContainer.addEventListener('touchmove', (e) => {
        if (isDraggingScrubber) {
            handleTouchScrub(e);
        }
    }, { passive: false });

    progressBarContainer.addEventListener('touchend', (e) => {
        if (isDraggingScrubber) {
            isDraggingScrubber = false;
            const touch = e.changedTouches[0];
            if (touch) {
                const rect = progressBarContainer.getBoundingClientRect();
                let clickX = touch.clientX - rect.left;
                const percent = Math.max(0, Math.min(1, clickX / rect.width));
                
                const targetId = FirebaseRemoteEngine.getControllingDevice() || (deviceId !== masterDeviceId ? masterDeviceId : null);
                const duration = audioPlayer.duration || window.globalPlayingTrack?.metadata?.duration;
                if (targetId && duration) {
                    FirebaseRemoteEngine.sendCommand(targetId, 'SEEK', { currentTime: percent * duration });
                } else if (duration) {
                    audioPlayer.currentTime = percent * duration;
                }
            }
            hoverTooltip.style.opacity = '0';
        }
        e.stopPropagation();
    });

    // Volume Drag and Toggle Logic
    let lastVolume = 0.7;
    audioPlayer.volume = lastVolume;
    volumeFill.style.width = '70%';
    let isDraggingVolume = false;

    function setMuteIcon(isMuted) {
        if (isMuted) {
            muteIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>`;
        } else {
            muteIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>`;
        }
    }

    muteBtn.addEventListener('click', () => {
        if (audioPlayer.volume > 0) {
            lastVolume = audioPlayer.volume;
            audioPlayer.volume = 0;
            volumeFill.style.width = '0%';
            setMuteIcon(true);
        } else {
            audioPlayer.volume = lastVolume || 0.7;
            volumeFill.style.width = `${audioPlayer.volume * 100}%`;
            setMuteIcon(false);
        }
    });

    function updateVolumeVisuals(e) {
        const rect = volumeBarContainer.getBoundingClientRect();
        let clickX = e.clientX - rect.left;
        
        if (clickX < 0) clickX = 0;
        if (clickX > rect.width) clickX = rect.width;
        
        const percent = clickX / rect.width;
        volumeFill.style.width = `${percent * 100}%`;
        audioPlayer.volume = percent;
        
        if (percent === 0) setMuteIcon(true);
        else setMuteIcon(false);
    }

    volumeBarContainer.addEventListener('mousedown', (e) => {
        isDraggingVolume = true;
        updateVolumeVisuals(e);
    });

    // Global Drag Bindings
    document.addEventListener('mousemove', (e) => {
        if (isDraggingScrubber) {
            updateScrubberVisuals(e);
        }
        if (isDraggingVolume) {
            updateVolumeVisuals(e);
        }
    });

    document.addEventListener('mouseup', (e) => {
        if (isDraggingScrubber) {
            isDraggingScrubber = false;
            const percent = updateScrubberVisuals(e);
            
            const targetId = FirebaseRemoteEngine.getControllingDevice() || (deviceId !== masterDeviceId ? masterDeviceId : null);
            const duration = audioPlayer.duration || window.globalPlayingTrack?.metadata?.duration;
            if (targetId && duration) {
                FirebaseRemoteEngine.sendCommand(targetId, 'SEEK', { currentTime: percent * duration });
            } else if (duration) {
                audioPlayer.currentTime = percent * duration;
            }
        }
        if (isDraggingVolume) {
            isDraggingVolume = false;
        }
    });

    // Navigation View Switches
    function hideQueueOverlay() {
        if (queueView.classList.contains('active')) {
            queueView.classList.remove('active');
            queueView.classList.add('hidden');
            queueBtn.classList.remove('active-icon');
        }
    }

    // Helper for animated view transitions
    function openViewAnimated(viewNode) {
        if (!viewNode) return;
        viewNode.classList.remove('hidden');
        // Force a reflow or use setTimeout to ensure transition triggers after display change
        setTimeout(() => viewNode.classList.add('active'), 10);
    }

    function closeViewAnimated(viewNode, duration = 500) {
        if (!viewNode || !viewNode.classList.contains('active')) return;
        viewNode.classList.remove('active');
        setTimeout(() => {
            // Check if it's still supposed to be inactive before hiding
            if (!viewNode.classList.contains('active')) {
                viewNode.classList.add('hidden');
            }
        }, duration);
    }

    function hideOverlays() {
        hideQueueOverlay();
        hideImmersiveOverlay();
        if (typeof hideContextMenu === 'function') hideContextMenu();
        if (typeof closeSettings === 'function') closeSettings();
    }

    // ── Navigation & Persistence Logic ────────────────────────────────────────
    function navigateTo(viewId, stateData = {}, push = true) {
        if (push) {
            history.pushState({ viewId, stateData }, '', '#' + viewId);
        }
        renderState(viewId, stateData);
    }

    function renderState(viewId, stateData) {
        switch(viewId) {
            case 'home': switchToHomeView(false); break;
            case 'allAlbums': switchToAllAlbumsView(false); break;
            case 'allArtists': switchToAllArtistsView(false); break;
            case 'search': 
                if (stateData.query !== undefined) {
                    if (searchInput) searchInput.value = stateData.query;
                    if (mobileSearchInput) mobileSearchInput.value = stateData.query;
                    renderSearchResults(stateData.query);
                }
                switchToSearchView(false); 
                break;
            case 'album':
                if (stateData.albumInfo) openAlbumView(stateData.albumInfo, false);
                break;
            case 'artist':
                if (stateData.artistName) openArtistView(stateData.artistName, false);
                break;
            case 'playlist':
                if (stateData.playlist) openPlaylistView(stateData.playlist, false);
                break;
            case 'settings': openSettings(false); break;
            case 'downloads': switchToDownloadsView(false); break;
            case 'queue': showQueueOverlay(); break;
            case 'immersive': showImmersiveOverlay(); break;
        }
    }

    window.addEventListener('popstate', (e) => {
        if (e.state && e.state.viewId) {
            renderState(e.state.viewId, e.state.stateData);
        } else {
            // Default to home if no state (e.g. first load)
            switchToHomeView(false);
        }
    });

    function switchToHomeView(push = true) {
        if (push) navigateTo('home');
        hideOverlays();
        
        // Hide all views to prevent overlap
        document.querySelectorAll('.view').forEach(v => {
            v.classList.remove('active');
            v.classList.add('hidden');
        });
        
        homeView.classList.remove('hidden');
        homeView.classList.add('active');
        updateMobileNavActive(mobileHomeBtn);
        renderDownloadedSection();
    }

    function switchToDownloadsView(push = true) {
        if (push) navigateTo('downloads');
        hideOverlays();
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        document.getElementById('downloads-view').classList.remove('hidden');
        document.getElementById('downloads-view').classList.add('active');
        renderAllDownloadsView();
    }

    function switchToAllAlbumsView(push = true) {
        if (push) navigateTo('allAlbums');
        hideOverlays();
        
        document.querySelectorAll('.view').forEach(v => {
            v.classList.remove('active');
            v.classList.add('hidden');
        });
        
        allAlbumsView.classList.remove('hidden');
        allAlbumsView.classList.add('active');
    }

    function switchToAllArtistsView(push = true) {
        if (push) navigateTo('allArtists');
        hideOverlays();
        
        document.querySelectorAll('.view').forEach(v => {
            v.classList.remove('active');
            v.classList.add('hidden');
        });
        
        allArtistsView.classList.remove('hidden');
        allArtistsView.classList.add('active');
    }

    function switchToSearchView(push = true) {
        if (push) navigateTo('search', { query: searchInput.value || (mobileSearchInput ? mobileSearchInput.value : '') });
        hideOverlays();
        
        document.querySelectorAll('.view').forEach(v => {
            v.classList.remove('active');
            v.classList.add('hidden');
        });
        
        searchView.classList.remove('hidden');
        searchView.classList.add('active');
        updateMobileNavActive(mobileSearchBtn);
    }

    function switchToAlbumView(push = true) {
        // Note: stateData for album is usually handled by openAlbumView
        if (push) navigateTo('album'); 
        hideOverlays();
        searchView.classList.remove('active'); searchView.classList.add('hidden');
        homeView.classList.remove('active'); homeView.classList.add('hidden');
        artistView.classList.remove('active'); artistView.classList.add('hidden');
        allAlbumsView.classList.remove('active'); allAlbumsView.classList.add('hidden');
        allArtistsView.classList.remove('active'); allArtistsView.classList.add('hidden');
        
        albumView.classList.remove('hidden'); albumView.classList.add('active');
    }

    function switchToArtistView(push = true) {
        if (push) navigateTo('artist');
        hideOverlays();
        searchView.classList.remove('active'); searchView.classList.add('hidden');
        homeView.classList.remove('active'); homeView.classList.add('hidden');
        albumView.classList.remove('active'); albumView.classList.add('hidden');
        allAlbumsView.classList.remove('active'); allAlbumsView.classList.add('hidden');
        allArtistsView.classList.remove('active'); allArtistsView.classList.add('hidden');
        if(playlistView) { playlistView.classList.remove('active'); playlistView.classList.add('hidden'); }
        
        artistView.classList.remove('hidden'); artistView.classList.add('active');
    }

    function switchToPlaylistView(push = true) {
        if (push) navigateTo('playlist');
        hideOverlays();
        searchView.classList.remove('active'); searchView.classList.add('hidden');
        homeView.classList.remove('active'); homeView.classList.add('hidden');
        albumView.classList.remove('active'); albumView.classList.add('hidden');
        artistView.classList.remove('active'); artistView.classList.add('hidden');
        allAlbumsView.classList.remove('active'); allAlbumsView.classList.add('hidden');
        allArtistsView.classList.remove('active'); allArtistsView.classList.add('hidden');
        playlistView.classList.remove('hidden'); playlistView.classList.add('active');
    }

    if (playlistBackBtn) {
        playlistBackBtn.addEventListener('click', () => history.back());
    }

    const viewAllDownloadsBtn = document.getElementById('view-all-downloads-btn');
    const downloadsBackBtn = document.getElementById('downloads-back-btn');

    if (viewAllDownloadsBtn) {
        viewAllDownloadsBtn.addEventListener('click', () => switchToDownloadsView());
    }
    if (downloadsBackBtn) {
        downloadsBackBtn.addEventListener('click', () => switchToHomeView());
    }

    // Top Navigation
    navHomeBtn.addEventListener('click', () => {
        searchInput.value = ''; 
        switchToHomeView();
    });

    backBtn.addEventListener('click', () => {
        history.back();
    });
    
    artistBackBtn.addEventListener('click', () => {
        history.back();
    });

    artistPlayAllBtn.addEventListener('click', () => {
        const firstTrack = artistTrackList.querySelector('.track-item:not(.unsupported-track)');
        if (firstTrack) {
            firstTrack.click();
        }
    });

    // Mobile Bottom Nav Listeners
    if (mobileHomeBtn) {
        mobileHomeBtn.addEventListener('click', () => {
            searchInput.value = '';
            switchToHomeView();
        });
    }

    if (mobileSearchBtn) {
        mobileSearchBtn.addEventListener('click', () => {
            switchToSearchView();
        });
    }

    if (mobileQueueBtn) {
        mobileQueueBtn.addEventListener('click', () => {
            if (!queueView.classList.contains('active')) {
                navigateTo('queue');
            }
        });
    }

    if (mobileSettingsBtn) {
        mobileSettingsBtn.addEventListener('click', () => {
            if (settingsView.classList.contains('active')) {
                closeSettings();
            } else {
                renderSettingsPanel();
                openSettings();
            }
        });
    }

    // Update active states on view switches
    const mobileNavObserver = new MutationObserver(() => {
        if (settingsView.classList.contains('active')) updateMobileNavActive(mobileSettingsBtn);
        else if (queueView.classList.contains('active')) updateMobileNavActive(mobileQueueBtn);
        else if (searchView.classList.contains('active')) updateMobileNavActive(mobileSearchBtn);
        else if (homeView.classList.contains('active')) updateMobileNavActive(mobileHomeBtn);
        else updateMobileNavActive(null);
    });

    [homeView, searchView, queueView, settingsView].forEach(view => {
        if (view) mobileNavObserver.observe(view, { attributes: true, attributeFilter: ['class'] });
    });

    let searchTimeout = null;
    window.artistImageHashes = {}; // Global cache for artist images to help rendering

    function handleSearchInput(e) {
        const query = e.target.value.toLowerCase().trim();
        if (searchInput) searchInput.value = e.target.value;
        if (mobileSearchInput) mobileSearchInput.value = e.target.value;

        if (!query) { 
            searchArtistsSection?.classList.add('hidden');
            searchPlaylistsSection?.classList.add('hidden');
            searchTracksSection?.classList.add('hidden');
            searchEmptyState?.classList.remove('hidden');
            return; 
        }

        // Instant Switch (No History Push) to provide immediate feedback
        if (searchView && !searchView.classList.contains('active')) {
            switchToSearchView(false);
        }
        
        clearTimeout(searchTimeout);
        if (searchTracksSection) {
            searchTracksSection.innerHTML = '<div class="loading">Searching Cloud...</div>';
            searchTracksSection.classList.remove('hidden');
        }
        searchEmptyState?.classList.add('hidden');

        searchTimeout = setTimeout(() => {
            renderSearchResults(query);
        }, 400);
    }

    if (searchInput) searchInput.addEventListener('input', handleSearchInput);
    if (mobileSearchInput) mobileSearchInput.addEventListener('input', handleSearchInput);

    async function renderSearchResults(query) {
        try {
            const data = await smartRaceFetch(`/search/?s=${encodeURIComponent(query)}`);
            if (!data) throw new Error('Search failed on all mirrors');
            
            const rawTracks = (data && data.data && data.data.items) ? data.data.items : [];
            const cloudTracks = rawTracks.map(t => {
                if (t.artist && t.artist.name && t.artist.picture) {
                    window.artistImageHashes[t.artist.name] = t.artist.picture;
                }
                return {
                    url: `qqdl://${t.id}`, // Placeholder until manifest is decoded
                    localPath: '',
                    isCloud: true,
                    cloudId: t.id,
                    filename: t.title,
                    metadata: {
                        title: t.title,
                        artist: t.artist ? t.artist.name : 'Unknown Artist',
                        album: t.album ? t.album.title : 'Unknown Album',
                        duration: t.duration,
                        coverUrl: t.album ? getTidalImage(t.album.cover, '320x320') : null
                    }
                };
            });

            // Extract unique artists
            const uniqueArtists = [...new Set(cloudTracks.map(t => t.metadata.artist))];
            
            // Local playlists
            const matchingPlaylists = allPlaylists.filter(p => p.name.toLowerCase().includes(query));

            renderSearchArtists(uniqueArtists.slice(0, 5));
            renderSearchPlaylists(matchingPlaylists);
            renderSearchTracks(cloudTracks);

            // Persist searched tracks to localStorage for home page cache
            if (cloudTracks.length > 0) {
                try {
                    let recentSongs = JSON.parse(localStorage.getItem('recentSearchedSongs') || '[]');
                    cloudTracks.slice(0, 25).forEach(t => {
                        const entry = {
                            cloudId: t.cloudId,
                            title: t.metadata.title,
                            artist: t.metadata.artist,
                            album: t.metadata.album,
                            duration: t.metadata.duration,
                            coverUrl: t.metadata.coverUrl
                        };
                        // Keep unique by cloudId, most recent first
                        recentSongs = recentSongs.filter(s => s.cloudId !== entry.cloudId);
                        recentSongs.unshift(entry);
                    });
                    localStorage.setItem('recentSearchedSongs', JSON.stringify(recentSongs.slice(0, 50)));
                    renderRecentSongs();
                } catch(e) {}
            }

            const hasResults = uniqueArtists.length > 0 || matchingPlaylists.length > 0 || cloudTracks.length > 0;
            if (searchEmptyState) searchEmptyState.classList.toggle('hidden', hasResults);
        } catch (e) {
            console.error('Cloud search error:', e);
            if (searchTracksSection) searchTracksSection.innerHTML = '<div class="error">Cloud Search Failed</div>';
        }
    }

    function renderSearchArtists(artists) {
        if (!searchArtistsSection || !searchArtistList) return;
        if (artists.length === 0) { searchArtistsSection.classList.add('hidden'); return; }
        searchArtistsSection.classList.remove('hidden');
        searchArtistList.innerHTML = '';

        artists.forEach(artistName => {
            const row = document.createElement('div');
            row.className = 'search-result-row';
            row.innerHTML = `
                <div class="artist-card-art search-row-avatar"></div>
                <div class="search-row-info">
                    <div class="search-row-name">${artistName}</div>
                    <div class="search-row-type">Artist</div>
                </div>
                <svg class="search-row-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
            `;
            fetchAndApplyArtistImage(artistName, row.querySelector('.search-row-avatar'), false);
            row.addEventListener('click', () => { searchInput.value = ''; switchToHomeView(); openArtistView(artistName); });
            searchArtistList.appendChild(row);
        });
    }

    function renderSearchPlaylists(playlists) {
        if (!searchPlaylistsSection || !searchPlaylistList) return;
        if (playlists.length === 0) { searchPlaylistsSection.classList.add('hidden'); return; }
        searchPlaylistsSection.classList.remove('hidden');
        searchPlaylistList.innerHTML = '';

        playlists.forEach(pl => {
            const row = document.createElement('div');
            row.className = 'search-result-row';
            const coverTrack = pl.tracks.find(t => t.metadata && t.metadata.coverUrl);
            const miniCover = coverTrack
                ? `<img src="${coverTrack.metadata.coverUrl}" class="search-row-cover-img" alt="" crossorigin="anonymous">`
                : `<div class="search-row-cover-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3z"/></svg></div>`;
            row.innerHTML = `
                <div class="search-row-cover">${miniCover}</div>
                <div class="search-row-info">
                    <div class="search-row-name">${pl.name}</div>
                    <div class="search-row-type">Playlist &middot; ${pl.tracks.length} track${pl.tracks.length !== 1 ? 's' : ''}</div>
                </div>
                <svg class="search-row-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
            `;
            row.addEventListener('click', () => { searchInput.value = ''; switchToHomeView(); openPlaylistView(pl); });
            searchPlaylistList.appendChild(row);
        });
    }

    function renderSearchTracks(tracks) {
        if (!searchTracksSection || !searchTrackList) return;
        if (tracks.length === 0) { searchTracksSection.classList.add('hidden'); return; }
        searchTracksSection.classList.remove('hidden');
        if (searchTracksSection.querySelector('.loading')) searchTracksSection.innerHTML = '<div id="search-track-list"></div>';
        renderTrackList(tracks, document.getElementById('search-track-list') || searchTrackList);
    }

    // ── Music Library Initialization ──────────────────

    function updatePlayerBarOfflineUI() {
        if (!window.globalPlayingTrack || !bottomOfflineBtn) return;
        
        const isOffline = downloadedTracksMap.has(window.globalPlayingTrack.url);
        const downloadProgress = pendingDownloads.get(window.globalPlayingTrack.url);
        
        if (isOffline) {
            bottomOfflineBtn.classList.add('downloaded');
            bottomOfflineBtn.classList.remove('downloading');
            bottomOfflineBtn.title = 'Available Offline (Click to remove)';
            bottomOfflineBtn.style.setProperty('--progress', '100%');
        } else if (downloadProgress !== undefined) {
            bottomOfflineBtn.classList.remove('downloaded');
            bottomOfflineBtn.classList.add('downloading');
            bottomOfflineBtn.title = `Downloading... ${Math.round(downloadProgress * 100)}%`;
            bottomOfflineBtn.style.setProperty('--progress', `${downloadProgress * 100}%`);
        } else {
            bottomOfflineBtn.classList.remove('downloaded', 'downloading');
            bottomOfflineBtn.title = 'Remote Source (Click to download)';
            bottomOfflineBtn.style.setProperty('--progress', '0%');
        }
    }

    async function initializeMusicLibrary() {
        if (!isQqdlInitialized) {
            await initCloudTarget();
        }
        
        allTracks = [];
        albumsData = {};
        
        // Render cached home sections immediately on load
        renderRecentSongs();
        renderRecentArtists();
        renderAllArtistsGrid(); // Render once at startup — not on every track play
        
        // Fetching playlists is handled globally during appInit start sequence
    }
    // ───────────────────────────────────────────────────────────


    const CARD_PLAY_BTN_HTML = `<button class="card-play-btn" title="Play">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
    </button>`;

    function createAlbumCard(albumInfo) {
        const card = document.createElement('div');
        card.className = 'album-card';
        
        const artHtml = albumInfo.coverUrl
            ? `<img src="${albumInfo.coverUrl}" class="album-card-art" alt="Album Cover" crossorigin="anonymous">`
            : `<div class="album-card-art"></div>`;

        card.innerHTML = `
            <div class="card-art-wrapper">
                ${artHtml}
                ${CARD_PLAY_BTN_HTML}
            </div>
            <div class="album-card-title">${albumInfo.name}</div>
            <div class="album-card-artist artist-link">${albumInfo.artist}</div>
        `;

        card.querySelector('.card-play-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const firstIdx = albumInfo.tracks.findIndex(t => !isTrackUnsupported(t));
            if (firstIdx === -1) return;
            currentPlaylistContext = albumInfo.tracks;
            if (isShuffleActive) unplayedIndices = albumInfo.tracks.map((_, i) => i);
            commitTrackChange(firstIdx);
        });

        card.addEventListener('click', (e) => {
            if (e.target.classList.contains('artist-link') || e.target.classList.contains('album-card-artist')) {
                e.stopPropagation();
                openArtistView(albumInfo.artist);
                return;
            }
            openAlbumView(albumInfo);
        });
        
        return card;
    }

    function renderHomeGrid() {
        renderRecentSongs();
        if (typeof renderRecentArtists === 'function') {
            renderRecentArtists();
        }
    }

    function renderRecentSongs() {
        const recentSongList = document.getElementById('recent-song-list');
        if (!recentSongList) return;

        let recentTracks = [];
        try {
            recentTracks = JSON.parse(localStorage.getItem('recentSearchedSongs') || '[]');
        } catch(e) {}

        recentSongList.innerHTML = '';

        if (recentTracks.length === 0) {
            recentSongList.innerHTML = '<div style="color:var(--text-secondary); padding: 20px;">Search for music to see it here.</div>';
            return;
        }

        recentTracks.slice(0, 12).forEach(trackData => {
            const card = document.createElement('div');
            card.className = 'album-card';
            const coverUrl = trackData.coverUrl || '';
            const artHtml = coverUrl
                ? `<img src="${coverUrl}" class="album-card-art" alt="" crossorigin="anonymous">`
                : `<div class="album-card-art"></div>`;
            card.innerHTML = `
                <div class="card-art-wrapper">
                    ${artHtml}
                    ${CARD_PLAY_BTN_HTML}
                </div>
                <div class="album-card-title" title="${trackData.title}">${trackData.title}</div>
                <div class="album-card-artist">${trackData.artist}</div>
            `;
            const trackObj = {
                url: `qqdl://${trackData.cloudId}`,
                localPath: '',
                isCloud: true,
                cloudId: trackData.cloudId,
                filename: trackData.title,
                metadata: {
                    title: trackData.title,
                    artist: trackData.artist,
                    album: trackData.album,
                    duration: trackData.duration,
                    coverUrl: trackData.coverUrl
                }
            };
            currentViewInfo = { tracks: recentTracks.map(t => ({
                url: `qqdl://${t.cloudId}`,
                localPath: '',
                isCloud: true,
                cloudId: t.cloudId,
                filename: t.title,
                metadata: {
                    title: t.title,
                    artist: t.artist,
                    album: t.album,
                    duration: t.duration,
                    coverUrl: t.coverUrl
                }
            })), container: recentSongList, isPlaylistView: false, playlistId: null };

            card.querySelector('.card-play-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                currentPlaylistContext = [trackObj];
                commitTrackChange(0);
            });

            const artistLinkNode = card.querySelector('.album-card-artist');
            if (artistLinkNode) {
                artistLinkNode.style.cursor = 'pointer';
                artistLinkNode.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (trackData.artist) openArtistView(trackData.artist);
                });
            }
            card.addEventListener('click', () => {
                currentPlaylistContext = [trackObj];
                commitTrackChange(0);
            });
            recentSongList.appendChild(card);
        });
    }



    function formatHeroDuration(totalSeconds) {
        totalSeconds = Math.round(totalSeconds);
        const hrs = Math.floor(totalSeconds / 3600);
        const mins = Math.floor((totalSeconds % 3600) / 60);
        const secs = totalSeconds % 60;
        
        if (hrs > 0) return `${hrs} hr ${mins} min`;
        if (mins > 0) return `${mins} min ${secs} sec`;
        return `${secs} sec`;
    }

    async function openAlbumView(albumInfo, push = true) {
        if (!albumInfo) return;
        if (push) navigateTo('album', { albumInfo });
        
        hideOverlays();
        document.querySelectorAll('.view').forEach(v => {
            v.classList.remove('active');
            v.classList.add('hidden');
        });
        
        activeViewAlbum = albumInfo; 
        albumView.classList.remove('hidden');
        albumView.classList.add('active');

        // Use cached version if available
        if (albumInfo.isCloudGenerated && !albumInfo.isFullyPopulated && albumInfo.albumId) {
            const cachedAlbum = albumViewCache[albumInfo.albumId];
            const now = Date.now();
            if (cachedAlbum && (now - cachedAlbum.timestamp < VIEW_CACHE_TTL)) {
                albumInfo.tracks = cachedAlbum.data.tracks;
                albumInfo.isFullyPopulated = true;
                console.log(`Album ${albumInfo.name} loaded from persistent cache`);
            }
        }

        // Use precise /album/?id= endpoint for cloud albums with a known Tidal album ID
        if (albumInfo.isCloudGenerated && !albumInfo.isFullyPopulated && albumInfo.albumId) {
            document.getElementById('track-list').innerHTML = '<div class="loading" style="padding: 24px; color: var(--text-secondary);">Loading full tracklist...</div>';
            
            try {
                const data = await smartRaceFetch(`/album/?id=${albumInfo.albumId}`);
                if (data) {
                    const rawItems = (data && data.data && data.data.items) ? data.data.items : [];
                    
                    albumInfo.tracks = rawItems.map(entry => {
                        const t = entry.item || entry;
                        return {
                            url: `qqdl://${t.id}`,
                            localPath: '',
                            isCloud: true,
                            cloudId: t.id,
                            filename: t.title,
                            metadata: {
                                title: t.title,
                                artist: t.artist ? t.artist.name : albumInfo.artist,
                                album: albumInfo.name,
                                duration: t.duration,
                                trackNumber: t.trackNumber,
                                coverUrl: albumInfo.coverUrl
                            }
                        };
                    }).filter(t => t.cloudId);
                    
                    albumInfo.isFullyPopulated = true;
                    updatePersistedCache('albumViewCache', albumInfo.albumId, albumInfo);
                }
            } catch (e) {
                console.error('Failed to load album tracks via /album/ endpoint:', e);
            }
        }
        
        let coverHtml = `<div class="album-hero-cover" style="background: linear-gradient(135deg, var(--gradient-1), var(--gradient-2));"></div>`;
        if (albumInfo.coverUrl) {
            coverHtml = `<img src="${albumInfo.coverUrl}" class="album-hero-cover" alt="Album Cover" crossorigin="anonymous">`;
            if (albumView) albumView.style.setProperty('--view-bg-image', `url("${albumInfo.coverUrl}")`);
        } else {
            if (albumView) albumView.style.setProperty('--view-bg-image', 'none');
        }


        let earliestYear = 9999;
        let totalDuration = 0;
        
        albumInfo.tracks.forEach(t => {
            if (t.metadata) {
                if (t.metadata.year && t.metadata.year < earliestYear) earliestYear = t.metadata.year;
                if (t.metadata.duration) totalDuration += t.metadata.duration;
            }
        });

        const yearStr = earliestYear === 9999 ? 'Unknown Year' : earliestYear;
        const durationStr = totalDuration > 0 ? `, ${formatHeroDuration(totalDuration)}` : '';
        const songCountStr = `${albumInfo.tracks.length} song${albumInfo.tracks.length !== 1 ? 's' : ''}`;
        
        const isAlbumOffline = albumInfo.tracks.every(t => downloadedTracksMap.has(t.url));
        const isAlbumDownloading = albumInfo.tracks.some(t => pendingDownloads.has(t.url));

        albumHeroDiv.innerHTML = `
            ${coverHtml}
            <div class="album-hero-info">
                <div class="album-hero-label">Album</div>
                <div class="album-hero-title" title="${albumInfo.name}">${albumInfo.name}</div>
                <div class="album-hero-meta">
                    <img class="artist-avatar" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTIwIDIxdi0yYTRgMCAwIDAtNC00SDhhNCg0IDAgMCAwLTQgNHYyIi8+PGNpcmNsZSBjeD0iMTIiIGN5PSI3IiByPSI0Ii8+PC9zdmc+" alt="">
                    <strong class="artist-link" style="cursor: pointer;">${albumInfo.artist}</strong> • ${yearStr} • ${songCountStr}${durationStr}
                </div>
                <div class="album-hero-actions">
                    <button class="icon-button play-btn album-play-btn" title="Play All" style="width: 56px; height: 56px; box-shadow: 0 8px 16px rgba(0,0,0,0.4);">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>
                    </button>
                    <button class="secondary-action-btn download-album-btn ${isAlbumOffline ? 'active' : ''}">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            ${isAlbumOffline ? '<polyline points="20 6 9 17 4 12"></polyline>' : '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>'}
                        </svg>
                        <span>${isAlbumOffline ? 'Downloaded' : (isAlbumDownloading ? 'Downloading...' : 'Download Album')}</span>
                    </button>
                </div>
            </div>
        `;

        const albumPlayBtn = albumHeroDiv.querySelector('.album-play-btn');

        if (albumPlayBtn) {
            albumPlayBtn.addEventListener('click', () => {
                const firstIdx = albumInfo.tracks.findIndex(t => !isTrackUnsupported(t));
                if (firstIdx === -1) return;
                currentPlaylistContext = albumInfo.tracks;
                if (isShuffleActive) unplayedIndices = albumInfo.tracks.map((_, i) => i);
                commitTrackChange(firstIdx);
            });
        }

        const downloadAlbumBtn = albumHeroDiv.querySelector('.download-album-btn');
        
        if (downloadAlbumBtn) {
            downloadAlbumBtn.addEventListener('click', () => {
                const isOfflineNow = albumInfo.tracks.every(t => downloadedTracksMap.has(t.url));
                const isDownloadingNow = albumInfo.tracks.some(t => pendingDownloads.has(t.url));
                
                if (isOfflineNow) {
                    removeAlbumOffline(albumInfo);
                } else if (!isDownloadingNow) {
                    downloadAlbum(albumInfo);
                }
            });
        }
        
        const heroArtistLink = albumHeroDiv.querySelector('.artist-link');
        if (heroArtistLink) {
            heroArtistLink.addEventListener('click', () => openArtistView(albumInfo.artist));
        }

        renderTrackList(albumInfo.tracks);
    }

    // ── Track List Rendering ──────────────────────────────────────────────────
    function renderTrackList(tracks, container = trackListElement, isPlaylistView = false, playlistId = null) {
        container.innerHTML = '';
        currentViewInfo = { tracks, container, isPlaylistView, playlistId };
        
        tracks.forEach((track, index) => {
            const trackItem = document.createElement('div');
            trackItem.className = 'track-item';
            trackItem.dataset.url = track.url;
            const isUnsupported = isTrackUnsupported(track);
            
            if (isUnsupported) trackItem.classList.add('unsupported-track');
            if (window.globalPlayingTrack && window.globalPlayingTrack.url === track.url) trackItem.classList.add('active');
            
            const title = (track.metadata && track.metadata.title) ? track.metadata.title : track.filename;
            const artist = (track.metadata && track.metadata.artist) ? track.metadata.artist : 'Unknown Artist';

            let coverHtml = '';
            if (track.metadata && track.metadata.coverUrl) {
                coverHtml = `<div class="track-item-cover"><img src="${track.metadata.coverUrl}" crossorigin="anonymous" alt="cover"></div>`;
            } else {
                coverHtml = `<div class="track-item-cover"><svg class="fallback-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3z"/></svg></div>`;
            }

            // Drag handle (playlist view only)
            const dragHandleHtml = isPlaylistView ? `
                <div class="drag-handle" draggable="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 4h2v2H9zm4 0h2v2h-2zm-4 7h2v2H9zm4 0h2v2h-2zm-4 7h2v2H9zm4 0h2v2h-2z"/></svg>
                </div>` : '';

            // Remove button (playlist view) vs Add-to-playlist button (other views)
            const actionBtnHtml = isPlaylistView ? `
                <button class="remove-from-playlist-btn" title="Remove from playlist">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>` : `
                <button class="add-to-playlist-btn" title="Add to playlist">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>`;

            const isDownloaded = downloadedTracksMap.has(track.url);
            const downloadProgress = pendingDownloads.get(track.url);
            const isDownloading = downloadProgress !== undefined;

            // Offline indicator logic
            let indicatorClass = '';
            let indicatorTitle = '';
            if (isDownloading) {
                indicatorClass = 'downloading';
                indicatorTitle = `Downloading... ${Math.round(downloadProgress * 100)}%`;
            } else if (isDownloaded) {
                indicatorClass = 'downloaded';
                indicatorTitle = 'Available Offline (Click to remove)';
            } else {
                indicatorTitle = 'Download for Offline';
            }

            const offlineIconHtml = `
                <button class="icon-button offline-status-circle track-offline-btn ${indicatorClass}" 
                        style="--progress: ${isDownloading ? Math.round(downloadProgress * 100) : (isDownloaded ? 100 : 0)}%"
                        title="${indicatorTitle}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path class="check-path" d="M8 12.5l3 3 5-6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
                    </svg>
                </button>`;

            trackItem.innerHTML = `
                ${dragHandleHtml}
                ${coverHtml}
                <div class="track-item-info">
                    <div class="track-item-title">${title}</div>
                    <div class="track-item-artist"><span class="artist-link" style="cursor: pointer;">${artist}</span></div>
                </div>
                <div class="track-item-actions">
                    ${isUnsupported ? `
                    <div class="unsupported-alert" title="the file format is not supported">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                            <line x1="12" y1="9" x2="12" y2="13"></line>
                            <line x1="12" y1="17" x2="12.01" y2="17"></line>
                        </svg>
                    </div>` : ''}
                    ${isUnsupported ? '' : offlineIconHtml}
                    ${actionBtnHtml}
                    <button class="icon-button track-item-more-btn" title="More">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1.5"></circle><circle cx="12" cy="5" r="1.5"></circle><circle cx="12" cy="19" r="1.5"></circle></svg>
                    </button>
                </div>
            `;

            // Context Menu Handler
            const moreBtn = trackItem.querySelector('.track-item-more-btn');
            if (moreBtn) {
                moreBtn.addEventListener('click', (e) => showContextMenu(e, track, moreBtn));
            }

            // Contextual Button Handler
            const statusBtn = trackItem.querySelector('.track-offline-btn');
            if (statusBtn) {
                statusBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    
                    // Rely on visual state to determine action
                    const isVisualDownloaded = statusBtn.classList.contains('downloaded');
                    const isVisualDownloading = statusBtn.classList.contains('downloading');

                    if (isVisualDownloaded) {
                        if (confirm('Remove this track from offline storage?')) {
                            removeOfflineTrack(track.url);
                        }
                    } else if (isVisualDownloading) {
                        console.log('Download already in progress.');
                    } else {
                        // Not downloaded or downloading - start download
                        initiateDownload(track);
                    }
                });
            }

            // Add-to-playlist button handler
            const addBtn = trackItem.querySelector('.add-to-playlist-btn');
            if (addBtn) {
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showAddToPlaylistDropdown(track, addBtn);
                });
            }

            // Remove from playlist handler
            const removeBtn = trackItem.querySelector('.remove-from-playlist-btn');
            if (removeBtn && playlistId) {
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    removeTrackFromPlaylist(playlistId, track.url, trackItem);
                });
            }

            // Drag-to-reorder handlers (playlist view only)
            if (isPlaylistView) {
                trackItem.setAttribute('draggable', 'true');
                trackItem.dataset.index = index;
                trackItem.addEventListener('dragstart', (e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', index);
                    setTimeout(() => trackItem.classList.add('dragging'), 0);
                });
                trackItem.addEventListener('dragend', () => trackItem.classList.remove('dragging'));
                trackItem.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    container.querySelectorAll('.track-item').forEach(el => el.classList.remove('drag-over'));
                    trackItem.classList.add('drag-over');
                });
                trackItem.addEventListener('dragleave', () => trackItem.classList.remove('drag-over'));
                trackItem.addEventListener('drop', (e) => {
                    e.preventDefault();
                    trackItem.classList.remove('drag-over');
                    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
                    const toIndex = index;
                    if (fromIndex === toIndex) return;
                    const pl = allPlaylists.find(p => p.id === activePlaylistId);
                    if (!pl) return;
                    const reordered = [...pl.tracks];
                    const [moved] = reordered.splice(fromIndex, 1);
                    reordered.splice(toIndex, 0, moved);
                    updatePlaylistTracks(activePlaylistId, reordered);
                });
            }

            trackItem.addEventListener('click', (e) => {
                if (e.target.closest('.artist-link')) {
                    e.stopPropagation();
                    openArtistView(artist);
                    return;
                }
                if (e.target.closest('.add-to-playlist-btn') || e.target.closest('.remove-from-playlist-btn') || e.target.closest('.drag-handle')) return;
                
                if (isUnsupported) {
                    showDependencyModal();
                    return;
                }

                // If clicking a track inside the user queue, it should play that track but clear the user queue up to that point.
                if (container === queueUserList) {
                     const clickedTrack = tracks[index];
                     
                     userQueue = userQueue.slice(index + 1); // Optimistic UI update
                     renderQueueView();

                     if (currentUser) {
                         window._fbDB.ref(`users/${currentUser.uid}/activeContext/queue`).transaction((currentQueue) => {
                             const q = currentQueue || [];
                             return q.slice(index + 1);
                         });
                     }
                     const title = (clickedTrack.metadata && clickedTrack.metadata.title) ? clickedTrack.metadata.title : clickedTrack.filename;
                     const artist = (clickedTrack.metadata && clickedTrack.metadata.artist) ? clickedTrack.metadata.artist : 'Unknown Artist';
                     playTrack(clickedTrack, title, artist);
                     return;
                }

                // If clicking a track in the "Next From Context" queue, it skips directly to that index in the main context
                if (container === queueContextList) {
                     const clickedTrackUrl = tracks[index].url;
                     const targetIndex = currentPlaylistContext.findIndex(t => t.url === clickedTrackUrl);
                     if (targetIndex !== -1) {
                         userQueue = []; // Optimistically clear user queue if skipping ahead in normal context
                         if (currentUser) {
                             window._fbDB.ref(`users/${currentUser.uid}/activeContext/queue`).set([]);
                         }
                         commitTrackChange(targetIndex);
                         renderQueueView();
                     }
                     return;
                }

                if (currentPlaylistContext !== tracks && container !== queueNowPlaying) {
                    currentPlaylistContext = tracks;
                    if (isShuffleActive) unplayedIndices = tracks.map((_, i) => i);
                }
                
                if (container !== queueNowPlaying) {
                    commitTrackChange(index);
                }
            });

            container.appendChild(trackItem);
        });
    }

    async function openArtistView(artistName, push = true) {
        if (!artistName) return;
        if (push) navigateTo('artist', { artistName });

        hideOverlays();
        document.querySelectorAll('.view').forEach(v => {
            v.classList.remove('active');
            v.classList.add('hidden');
        });
        
        artistView.classList.remove('hidden');
        artistView.classList.add('active');
        
        artistHeroName.textContent = artistName;
        artistHeroMeta.textContent = 'Loading artist...';

        const heroAvatarNode = document.querySelector('.artist-hero-avatar');
        if (heroAvatarNode) {
            heroAvatarNode.innerHTML = '';
            if (typeof fetchAndApplyArtistImage === 'function') {
                fetchAndApplyArtistImage(artistName, heroAvatarNode, true);
            }
        }

        const artistSingleGrid = document.getElementById('artist-single-grid');
        const singleHeading = document.getElementById('artist-single-heading');
        const albumHeading = document.getElementById('artist-album-heading');

        // Check Cache
        const cached = artistViewCache[artistName];
        const now = Date.now();
        if (cached && (now - cached.timestamp < VIEW_CACHE_TTL)) {
            console.log(`Rendering ${artistName} from persistent cache`);
            renderArtistProfile(artistName, cached.data);
            return;
        }

        artistAlbumGrid.innerHTML = '<div class="loading" style="padding: 24px; color: var(--text-secondary);">Fetching discography...</div>';
        artistTrackList.innerHTML = '<div class="loading" style="padding: 24px; color: var(--text-secondary);">Fetching top tracks...</div>';
        if (artistSingleGrid) artistSingleGrid.innerHTML = '';

        try {
            const searchData = await smartRaceFetch(`/search/?s=${encodeURIComponent(artistName)}`);
            if (!searchData) throw new Error('Search failed on all mirrors');
            const searchTracks = (searchData && searchData.data && searchData.data.items) ? searchData.data.items : [];
            const matchTrack = searchTracks.find(t => t.artist && t.artist.name.toLowerCase() === artistName.toLowerCase());
            if (!matchTrack) throw new Error('Artist not found in search results');

            const artistId = matchTrack.artist.id;
            if (matchTrack.artist.picture) {
                window.artistImageHashes[matchTrack.artist.name] = matchTrack.artist.picture;
                if (typeof fetchAndApplyArtistImage === 'function' && heroAvatarNode) {
                    delete artistImageCache[artistName];
                    fetchAndApplyArtistImage(artistName, heroAvatarNode, true);
                }
            }

            const [discData, topTracksFromSearch] = await Promise.all([
                smartRaceFetch(`/artist/?f=${artistId}`).catch(() => null),
                Promise.resolve(searchTracks)
            ]);

            const finalAlbums = [];
            const finalSingles = [];
            let profileTopTracks = [];

            if (discData) {
                
                // 1. Extract Discography
                const allReleases = (discData && discData.albums && discData.albums.items) ? discData.albums.items : [];
                allReleases.forEach(album => {
                    const albumObj = {
                        name: album.title,
                        artist: artistName,
                        albumId: album.id,
                        coverUrl: album.cover ? getTidalImage(album.cover, '320x320') : null,
                        tracks: [],
                        isCloudGenerated: true,
                        isFullyPopulated: false
                    };
                    const type = (album.type || '').toUpperCase();
                    if (type === 'SINGLE' || type === 'EP') finalSingles.push(albumObj);
                    else finalAlbums.push(albumObj);
                });

                // 2. Extract Top Tracks from Profile (if available)
                profileTopTracks = (discData && discData.topTracks) ? discData.topTracks : 
                                   ((discData && discData.tracks) ? discData.tracks : []);
            }

            // 3. Merge profile tracks with search tracks (preferring profile tracks)
            const mergedMap = new Map();
            
            // Helper to map raw bridge track to app track
            const mapTrack = (t) => ({
                url: `qqdl://${t.id}`,
                localPath: '',
                isCloud: true,
                cloudId: t.id,
                filename: t.title,
                metadata: {
                    title: t.title,
                    artist: (t.artist && t.artist.name) ? t.artist.name : artistName,
                    album: t.album ? t.album.title : 'Unknown Album',
                    duration: t.duration,
                    coverUrl: t.album ? getTidalImage(t.album.cover, '320x320') : null
                }
            });

            // Process profile tracks first
            profileTopTracks.forEach(t => {
                if (t.id && !mergedMap.has(t.id)) {
                    mergedMap.set(t.id, mapTrack(t));
                }
            });

            // Fallback to search results for missing tracks
            topTracksFromSearch.forEach(t => {
                if (t.id && !mergedMap.has(t.id) && t.artist && t.artist.name.toLowerCase() === artistName.toLowerCase()) {
                    mergedMap.set(t.id, mapTrack(t));
                }
            });

            const artistTopTracks = Array.from(mergedMap.values()).slice(0, 15);

            const artistData = { artistTopTracks, finalAlbums, finalSingles };
            updatePersistedCache('artistViewCache', artistName, artistData);
            renderArtistProfile(artistName, artistData);

        } catch (e) {
            console.error('Failed to fetch artist profile:', e);
            artistTrackList.innerHTML = '<div style="color:red; padding: 24px;">Failed to load artist data.</div>';
            artistHeroMeta.textContent = 'Error loading artist';
        }
    }

    function renderArtistProfile(artistName, data) {
        const { artistTopTracks, finalAlbums, finalSingles } = data;
        const artistSingleGrid = document.getElementById('artist-single-grid');
        const singleHeading = document.getElementById('artist-single-heading');
        const albumHeading = document.getElementById('artist-album-heading');

        artistHeroMeta.textContent = `${artistTopTracks.length} top tracks · ${finalAlbums.length} album${finalAlbums.length !== 1 ? 's' : ''} · ${finalSingles.length} single${finalSingles.length !== 1 ? 's' : ''}`;

        if (artistTopTracks.length > 0) {
            artistTrackList.innerHTML = '';
            renderTrackList(artistTopTracks, artistTrackList);
        } else {
            artistTrackList.innerHTML = '<div style="color:var(--text-secondary); padding: 24px;">No top tracks found.</div>';
        }

        function populateGrid(container, items) {
            container.innerHTML = '';
            items.forEach(albumInfo => {
                const card = document.createElement('div');
                card.className = 'album-card';
                let coverHtml = `<div class="album-card-art"></div>`;
                if (albumInfo.coverUrl) {
                    coverHtml = `<img src="${albumInfo.coverUrl}" class="album-card-art" alt="Album Cover" crossorigin="anonymous">`;
                }
                card.innerHTML = `
                    <div class="card-art-wrapper">
                        ${coverHtml}
                        ${CARD_PLAY_BTN_HTML}
                    </div>
                    <div class="album-card-title">${albumInfo.name}</div>
                    <div class="album-card-artist">${albumInfo.artist}</div>
                `;
                card.querySelector('.card-play-btn').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (albumInfo.tracks.length === 0 && albumInfo.albumId) {
                        try {
                            const d = await smartRaceFetch(`/album/?id=${albumInfo.albumId}`);
                            if (d) {
                                const items = (d && d.data && d.data.items) ? d.data.items : [];
                                albumInfo.tracks = items.map(entry => {
                                    const t = entry.item || entry;
                                    return { url: `qqdl://${t.id}`, localPath: '', isCloud: true, cloudId: t.id, filename: t.title, metadata: { title: t.title, artist: t.artist ? t.artist.name : albumInfo.artist, album: albumInfo.name, duration: t.duration, coverUrl: albumInfo.coverUrl } };
                                }).filter(t => t.cloudId);
                                albumInfo.isFullyPopulated = true;
                                // Update album cache if available
                                updatePersistedCache('albumViewCache', albumInfo.albumId, albumInfo);
                            }
                        } catch(err) { console.error(err); }
                    }
                    if (albumInfo.tracks.length === 0) return;
                    currentPlaylistContext = albumInfo.tracks;
                    if (isShuffleActive) unplayedIndices = albumInfo.tracks.map((_, i) => i);
                    commitTrackChange(0);
                });
                card.addEventListener('click', () => openAlbumView(albumInfo));
                container.appendChild(card);
            });
        }

        populateGrid(artistAlbumGrid, finalAlbums);
        if (artistSingleGrid) populateGrid(artistSingleGrid, finalSingles);

        if (albumHeading) albumHeading.style.display = finalAlbums.length > 0 ? 'block' : 'none';
        artistAlbumGrid.style.display = finalAlbums.length > 0 ? 'grid' : 'none';
        if (singleHeading) singleHeading.style.display = finalSingles.length > 0 ? 'block' : 'none';
        if (artistSingleGrid) artistSingleGrid.style.display = finalSingles.length > 0 ? 'grid' : 'none';
    }

    function parseLrc(lrcString) {
        const lines = lrcString.split('\n');
        const parsed = [];
        const timeRegEx = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
        
        lines.forEach(line => {
            const match = timeRegEx.exec(line);
            if (match) {
                const min = parseInt(match[1]);
                const sec = parseInt(match[2]);
                const ms = parseInt(match[3]);
                const timeInSeconds = min * 60 + sec + (ms / (match[3].length === 3 ? 1000 : 100));
                const text = line.replace(timeRegEx, '').trim();
                
                if (text) {
                    parsed.push({ time: timeInSeconds, text: text, element: null });
                } else {
                    parsed.push({ time: timeInSeconds, text: '♪', element: null });
                }
            }
        });
        
        return parsed;
    }

    async function fetchLyricsRaw(title, artist, album, duration) {
        // Core fetch logic without UI updates
        let resData = { synced: null, plain: null };
        
        // Try lrclib.net
        let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;
        if (album) url += `&album_name=${encodeURIComponent(album)}`;
        if (duration) url += `&duration=${Math.round(duration)}`;

        try {
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                resData.synced = data.syncedLyrics || null;
                resData.plain = data.plainLyrics || null;
            }
        } catch (e) { console.warn("Raw lyrics fetch failed", e); }
        
        return resData;
    }

    async function fetchLyrics(title, artist, album, duration) {
        lyricsContainer.classList.remove('editor-mode');
        lyricsContainer.innerHTML = '<div class="lyrics-placeholder">Loading lyrics...</div>';
        if (immersiveLyricsContainer) {
            immersiveLyricsContainer.classList.remove('editor-mode');
            immersiveLyricsContainer.innerHTML = '<div class="lyrics-placeholder" style="color:rgba(255,255,255,0.7);">Loading lyrics...</div>';
        }
        lyricsData = [];
        currentLyricIndex = -1;
        plainLyricsCache = '';
        lyricsTrackUrl = window.globalPlayingTrack ? window.globalPlayingTrack.url : '';
        currentLyricsTitle = title;
        currentLyricsArtist = artist;
        currentLyricsAlbum = album || '';
        currentLyricsDuration = duration || 0;
        renderLyricsActionBar(false, false);

        // 1. Check offline DB or localStorage
        if (lyricsTrackUrl) {
            // Check manual save first
            const saved = localStorage.getItem(`lrc_${lyricsTrackUrl}`);
            if (saved) {
                lyricsData = parseLrc(saved);
                renderLyrics();
                renderLyricsActionBar(true, true);
                return;
            }

            // Check if it's an offline track with cached lyrics
            const record = await getTrackRecordFromDB(lyricsTrackUrl);
            if (record && record.lyrics) {
                const lrcText = record.lyrics.synced || record.lyrics.plain;
                if (lrcText) {
                    if (record.lyrics.synced) {
                        lyricsData = parseLrc(record.lyrics.synced);
                        renderLyrics();
                        renderLyricsActionBar(true, false);
                    } else {
                        plainLyricsCache = record.lyrics.plain;
                        showLyricsNoSyncState();
                    }
                    return;
                }
            }
        }

        const data = await fetchLyricsRaw(title, artist, album, duration);
        if (data.synced) {
            lyricsData = parseLrc(data.synced);
            renderLyrics();
            renderLyricsActionBar(true, false);
        } else if (data.plain) {
            plainLyricsCache = data.plain;
            showLyricsNoSyncState();
        } else {
            showLyricsNoSyncState();
        }
    }

    function renderLyrics() {
        lyricsContainer.innerHTML = '';
        
        lyricsData.forEach((line, index) => {
            const imEl = document.createElement('div');
            imEl.className = 'lyric-line';
            imEl.textContent = line.text;
            
            imEl.addEventListener('click', () => { 
                const targetId = FirebaseRemoteEngine.getControllingDevice() || (deviceId !== masterDeviceId ? masterDeviceId : null);
                if (targetId) {
                    FirebaseRemoteEngine.sendCommand(targetId, 'SEEK', { currentTime: line.time });
                } else {
                    audioPlayer.currentTime = line.time;
                }
            });
            
            line.immersiveElement = imEl;
            
            lyricsContainer.appendChild(imEl);
        });
    }

    function updateLyricsSync(forceTime) {
        if (!lyricsData.length) return;
        if (!audioPlayer.src && forceTime === undefined) return;
        
        const currentTime = forceTime !== undefined ? forceTime : audioPlayer.currentTime;
        let newIndex = -1;
        
        for (let i = 0; i < lyricsData.length; i++) {
            if (currentTime >= lyricsData[i].time) {
                newIndex = i;
            } else {
                break;
            }
        }
        
        if (newIndex !== currentLyricIndex && newIndex !== -1) {
            currentLyricIndex = newIndex;
            
            lyricsData.forEach((line, idx) => {
                if (idx < currentLyricIndex) {
                    if (line.immersiveElement) line.immersiveElement.className = 'lyric-line past';
                } else if (idx === currentLyricIndex) {
                    if (line.immersiveElement) line.immersiveElement.className = 'lyric-line active';
                    
                    if (immersiveView && immersiveView.classList.contains('active') && line.immersiveElement) {
                        const containerHalfHeight = lyricsContainer.clientHeight / 2;
                        const offsetTop = line.immersiveElement.offsetTop;
                        const itemHalfHeight = line.immersiveElement.clientHeight / 2;
                        lyricsContainer.scrollTo({
                            top: Math.max(0, offsetTop - containerHalfHeight + itemHalfHeight),
                            behavior: 'smooth'
                        });
                    }
                } else {
                    if (line.immersiveElement) line.immersiveElement.className = 'lyric-line';
                }
            });
        }
    }

    // ── Lyrics Creation / Sync System ─────────────────────────────────────────

    function showLyricsNoSyncState() {
        lyricsContainer.classList.add('editor-mode');
        lyricsContainer.innerHTML = `
            <div class="lyrics-no-sync">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3;">
                    <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                </svg>
                <div class="lyrics-no-sync-title">No synced lyrics found</div>
                <div class="lyrics-no-sync-sub">${plainLyricsCache ? 'Plain lyrics were found online — sync them to the music.' : 'No lyrics found. Paste them below and tap to sync.'}</div>
                <button id="create-lyrics-btn" class="lyrics-create-btn">${plainLyricsCache ? '♩ Sync lyrics' : '♩ Create synced lyrics'}</button>
            </div>
        `;
        document.getElementById('create-lyrics-btn').addEventListener('click', () => showLyricsEditor(plainLyricsCache));
        renderLyricsActionBar(false, false);
    }

    function renderLyricsActionBar(hasLyrics = false, isCustom = false) {
        const bar = document.getElementById('lyrics-action-bar');
        if (!bar) return;
        bar.innerHTML = '';
        if (!lyricsTrackUrl) return;
        if (!hasLyrics) {
            if (lyricsData.length === 0) {
                // subtle create link in bar
            }
            return;
        }
        const editBtn = document.createElement('button');
        editBtn.className = 'lyrics-action-btn';
        editBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Re-sync`;
        editBtn.addEventListener('click', () => {
            const plainText = lyricsData.map(l => l.text).join('\n');
            showLyricsEditor(plainText);
        });
        bar.appendChild(editBtn);
        if (isCustom) {
            const sep = document.createElement('span');
            sep.className = 'lyrics-action-sep';
            bar.appendChild(sep);
            const delBtn = document.createElement('button');
            delBtn.className = 'lyrics-action-btn lyrics-action-danger';
            delBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg> Delete custom`;
            delBtn.addEventListener('click', () => {
                if (confirm('Delete your custom synced lyrics for this track?')) {
                    localStorage.removeItem(`lrc_${lyricsTrackUrl}`);
                    fetchLyrics(currentLyricsTitle, currentLyricsArtist, currentLyricsAlbum, currentLyricsDuration);
                }
            });
            bar.appendChild(delBtn);
        }
    }

    function showLyricsEditor(initialText = '') {
        lyricsContainer.classList.add('editor-mode');
        lyricsContainer.innerHTML = `
            <div class="lyrics-editor">
                <div class="lyrics-editor-title">Lyrics Editor</div>
                <div class="lyrics-editor-sub">One lyric line per text line. Blank lines are ignored. Click <strong>Start Syncing</strong> — the song restarts and you tap when each line begins.</div>
                <textarea id="lyrics-textarea" class="lyrics-textarea" placeholder="Paste lyrics here, one line per lyric line...">${initialText}</textarea>
                <div class="lyrics-editor-actions">
                    <button id="lyrics-start-sync-btn" class="lyrics-create-btn">▶&nbsp; Start Syncing</button>
                    <button id="lyrics-editor-cancel-btn" class="lyrics-ghost-btn">Cancel</button>
                </div>
            </div>
        `;
        document.getElementById('lyrics-editor-cancel-btn').addEventListener('click', () => {
            if (lyricsData.length > 0) { lyricsContainer.classList.remove('editor-mode'); renderLyrics(); }
            else showLyricsNoSyncState();
        });
        document.getElementById('lyrics-start-sync-btn').addEventListener('click', () => {
            const raw = document.getElementById('lyrics-textarea').value.trim();
            if (!raw) return;
            const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length === 0) return;
            startSyncSession(lines);
        });
    }

    function startSyncSession(lines) {
        syncLines = lines;
        syncTimestamps = [];
        syncCurrentLineIdx = 0;
        audioPlayer.currentTime = 0;
        audioPlayer.play().catch(() => {});
        lyricsContainer.classList.add('editor-mode');
        renderSyncSessionUI();
        if (syncKeyHandler) document.removeEventListener('keydown', syncKeyHandler);
        syncKeyHandler = (e) => {
            if (!immersiveView.classList.contains('active')) return;
            if (e.code === 'Space' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
                e.preventDefault();
                tapSync();
            }
        };
        document.addEventListener('keydown', syncKeyHandler);
    }

    function renderSyncSessionUI() {
        const done = syncCurrentLineIdx;
        const total = syncLines.length;
        const current = syncLines[done] || null;
        const next = syncLines[done + 1] || null;
        const progressPct = total > 0 ? (done / total) * 100 : 0;

        lyricsContainer.innerHTML = `
            <div class="sync-session">
                <div class="sync-progress-wrap">
                    <div class="sync-progress-fill" style="width:${progressPct}%"></div>
                </div>
                <div class="sync-progress-text">Line <strong>${Math.min(done + 1, total)}</strong> of <strong>${total}</strong></div>
                <div class="sync-stage">
                    ${current
                        ? `<div class="sync-current-line">${current}</div>
                           <div class="sync-next-line">${next ? 'Next: ' + next : '— last line —'}</div>`
                        : `<div class="sync-current-line" style="color:var(--accent);">All lines synced!</div>`
                    }
                </div>
                <button id="sync-tap-btn" class="sync-tap-btn" ${!current ? 'disabled' : ''}>
                    <span>TAP</span>
                    <kbd>Space</kbd>
                </button>
                <div class="sync-controls">
                    <button id="sync-undo-btn" class="lyrics-ghost-btn" ${done === 0 ? 'disabled' : ''}>↩ Undo</button>
                    <button id="sync-done-btn" class="lyrics-ghost-btn">✓ Save${done > 0 && done < total ? ' partial' : ''}</button>
                    <button id="sync-cancel-btn" class="lyrics-ghost-btn">✕ Cancel</button>
                </div>
                <div class="sync-hint">Tap the button or press <em>Space</em> the moment each line begins</div>
            </div>
        `;

        document.getElementById('sync-tap-btn').addEventListener('click', tapSync);
        document.getElementById('sync-undo-btn').addEventListener('click', () => {
            if (syncCurrentLineIdx === 0) return;
            syncCurrentLineIdx--;
            syncTimestamps.pop();
            const prevTime = syncTimestamps.length > 0 ? Math.max(0, syncTimestamps[syncTimestamps.length - 1] - 0.5) : 0;
            audioPlayer.currentTime = prevTime;
            renderSyncSessionUI();
        });
        document.getElementById('sync-done-btn').addEventListener('click', finishSyncSession);
        document.getElementById('sync-cancel-btn').addEventListener('click', () => {
            exitSyncSession();
            if (lyricsData.length > 0) { lyricsContainer.classList.remove('editor-mode'); renderLyrics(); }
            else showLyricsNoSyncState();
        });

        if (syncCurrentLineIdx >= syncLines.length) {
            setTimeout(finishSyncSession, 900);
        }
    }

    function tapSync() {
        if (syncCurrentLineIdx >= syncLines.length) return;
        syncTimestamps.push(audioPlayer.currentTime);
        syncCurrentLineIdx++;
        renderSyncSessionUI();
    }

    function exitSyncSession() {
        if (syncKeyHandler) {
            document.removeEventListener('keydown', syncKeyHandler);
            syncKeyHandler = null;
        }
        lyricsContainer.classList.remove('editor-mode');
    }

    function finishSyncSession() {
        exitSyncSession();
        if (syncTimestamps.length === 0) { showLyricsNoSyncState(); return; }
        const synced = syncTimestamps.map((time, i) => ({ time, text: syncLines[i] }));
        const lrcString = generateLrc(synced);
        if (lyricsTrackUrl) localStorage.setItem(`lrc_${lyricsTrackUrl}`, lrcString);
        lyricsData = synced;
        renderLyrics();
        renderLyricsActionBar(true, true);
    }

    function generateLrc(arr) {
        return arr.map(({ time, text }) => {
            const mins = Math.floor(time / 60);
            const secs = Math.floor(time % 60);
            const cs = Math.round((time % 1) * 100);
            return `[${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}.${String(cs).padStart(2,'0')}]${text}`;
        }).join('\n');
    }

    // ── Playlist System ───────────────────────────────────────────────────────

    let playlistUnsubscribe = null;

    async function fetchPlaylists() {
        if (!currentUser) return;
        const uid = currentUser.uid;
        
        // Remove any existing listener
        if (playlistUnsubscribe) playlistUnsubscribe();

        // Real-time listener from Firestore
        playlistUnsubscribe = window._fbFS.collection('users').doc(uid).collection('playlists')
            .orderBy('createdAt', 'desc')
            .onSnapshot(snap => {
                allPlaylists = snap.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                renderPlaylistsStrip();
                
                // If we are currently viewing a playlist, refresh its view to catch updates from other devices
                if (playlistView && playlistView.classList.contains('active') && activePlaylistId) {
                    const current = allPlaylists.find(p => p.id === activePlaylistId);
                    if (current) openPlaylistView(current, false); // false = prevent history spam on sync
                    else switchToHomeView(); // playlist was deleted
                }
            }, err => {
                console.error('Playlist sync error', err);
            });
    }

    async function createPlaylist(name) {
        if (!currentUser) return;
        try {
            const uid = currentUser.uid;
            const docRef = await window._fbFS.collection('users').doc(uid).collection('playlists').add({
                name,
                tracks: [],
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            return { id: docRef.id, name, tracks: [] };
        } catch(e) { console.error('Failed to create playlist', e); }
        return null;
    }

    async function deletePlaylist(id) {
        if (!currentUser) return;
        try {
            const uid = currentUser.uid;
            await window._fbFS.collection('users').doc(uid).collection('playlists').doc(id).delete();
            switchToHomeView();
        } catch(e) { console.error('Failed to delete playlist', e); }
    }

    async function renamePlaylist(id, name) {
        if (!currentUser) return;
        try {
            const uid = currentUser.uid;
            await window._fbFS.collection('users').doc(uid).collection('playlists').doc(id).update({ name });
        } catch(e) { console.error('Failed to rename playlist', e); }
    }

    async function addTrackToPlaylist(playlistId, track) {
        if (!currentUser) return;
        const pl = allPlaylists.find(p => p.id === playlistId);
        if (!pl) return;
        if (pl.tracks.find(t => t.url === track.url)) return;
        
        const trackData = {
            url: track.url,
            isCloud: track.isCloud,
            cloudId: track.cloudId,
            filename: track.filename,
            metadata: track.metadata ? { ...track.metadata } : null
        };
        const newTracks = [...pl.tracks, trackData];
        await updatePlaylistTracks(playlistId, newTracks);
    }

    async function removeTrackFromPlaylist(playlistId, trackUrl, rowEl) {
        if (!currentUser) return;
        const pl = allPlaylists.find(p => p.id === playlistId);
        if (!pl) return;
        const newTracks = pl.tracks.filter(t => t.url !== trackUrl);
        await updatePlaylistTracks(playlistId, newTracks);
    }

    async function updatePlaylistTracks(playlistId, tracks) {
        if (!currentUser) return;
        try {
            const uid = currentUser.uid;
            await window._fbFS.collection('users').doc(uid).collection('playlists').doc(playlistId).update({ tracks });
        } catch(e) { console.error('Failed to update playlist tracks', e); }
    }


    // Build a 2x2 collage from first 4 cover-bearing tracks in the playlist
    function buildCollageHtml(playlist) {
        const coverTracks = playlist.tracks.filter(t => t.metadata && t.metadata.coverUrl).slice(0, 4);
        let cells = '';
        for (let i = 0; i < 4; i++) {
            if (coverTracks[i]) {
                cells += `<img src="${coverTracks[i].metadata.coverUrl}" alt="" crossorigin="anonymous">`;
            } else {
                cells += `<div class="playlist-collage-cell"><svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3z"/></svg></div>`;
            }
        }
        return `<div class="playlist-collage">${cells}</div>`;
    }

    function renderPlaylistsStrip() {
        if (!playlistStrip) return;
        playlistStrip.innerHTML = '';

        // New playlist button
        const newCard = document.createElement('div');
        newCard.className = 'new-playlist-card';
        newCard.innerHTML = `
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span>New Playlist</span>
        `;
        newCard.addEventListener('click', () => openCreatePlaylistModal(null));
        playlistStrip.appendChild(newCard);

        if (allPlaylists.length === 0) {
            // Empty state — shown inline after the New Playlist card
            const emptyState = document.createElement('div');
            emptyState.className = 'playlists-empty-state';
            emptyState.innerHTML = `
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.35;">
                    <path d="M9 18V5l12-2v13"/>
                    <circle cx="6" cy="18" r="3"/>
                    <circle cx="18" cy="16" r="3"/>
                </svg>
                <div class="playlists-empty-title">No playlists yet</div>
                <div class="playlists-empty-sub">Click the card to create your first one</div>
            `;
            playlistStrip.appendChild(emptyState);
            return;
        }

        allPlaylists.forEach(pl => {
            const card = document.createElement('div');
            card.className = 'playlist-card';
            card.innerHTML = `
                <div class="card-art-wrapper">
                    ${buildCollageHtml(pl)}
                    ${CARD_PLAY_BTN_HTML}
                </div>
                <div class="playlist-card-title" title="${pl.name}">${pl.name}</div>
                <div class="playlist-card-label">${pl.tracks.length} track${pl.tracks.length !== 1 ? 's' : ''}</div>
            `;
            card.querySelector('.card-play-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                if (pl.tracks.length === 0) return;
                const firstIdx = pl.tracks.findIndex(t => !isTrackUnsupported(t));
                if (firstIdx === -1) return;
                currentPlaylistContext = pl.tracks;
                if (isShuffleActive) unplayedIndices = pl.tracks.map((_, i) => i);
                commitTrackChange(firstIdx);
            });
            card.addEventListener('click', () => openPlaylistView(pl));
            playlistStrip.appendChild(card);
        });
    }

    function openPlaylistView(playlist, push = true) {
        if (push) navigateTo('playlist', { playlist });
        activePlaylistId = playlist.id;

        hideOverlays();
        document.querySelectorAll('.view').forEach(v => {
            v.classList.remove('active');
            v.classList.add('hidden');
        });
        
        playlistView.classList.remove('hidden');
        playlistView.classList.add('active');
        
        // Set background from cloud cover art if available
        const firstCoverTrack = playlist.tracks.find(t => t.metadata && t.metadata.coverUrl);
        if (firstCoverTrack) {
            if (playlistView) playlistView.style.setProperty('--view-bg-image', `url("${firstCoverTrack.metadata.coverUrl}")`);
        } else {
            if (playlistView) playlistView.style.setProperty('--view-bg-image', 'none');
        }

        const collage = buildCollageHtml(playlist);
        const totalDuration = playlist.tracks.reduce((sum, t) => sum + (t.metadata && t.metadata.duration ? t.metadata.duration : 0), 0);
        const durationStr = totalDuration > 0 ? ` · ${formatHeroDuration(Math.round(totalDuration))}` : '';

        // Focus protection: if the user is currently renaming the playlist,
        // we should NOT re-render the hero section as it would hijack focus.
        const titleInputActive = document.activeElement && document.activeElement.classList.contains('playlist-title-editable');
        
        if (!titleInputActive) {
            playlistHeroDiv.innerHTML = `
                ${collage}
                <div class="album-hero-info">
                    <div class="album-hero-label">Playlist</div>
                    <input class="playlist-title-editable album-hero-title" value="${playlist.name}" spellcheck="false">
                    <div class="album-hero-meta">${playlist.tracks.length} track${playlist.tracks.length !== 1 ? 's' : ''}${durationStr}</div>
                    <div style="display:flex; gap: 12px; align-items: center; margin-top: 24px;">
                        <button class="icon-button play-btn playlist-play-btn" title="Play All" style="width:56px;height:56px;box-shadow:0 8px 16px rgba(0,0,0,0.4);">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>
                        </button>
                        <button class="delete-playlist-btn">Delete Playlist</button>
                    </div>
                </div>
            `;

            // Inline rename
            const titleInput = playlistHeroDiv.querySelector('.playlist-title-editable');
            if (titleInput) {
                titleInput.addEventListener('blur', () => {
                    const newName = titleInput.value.trim();
                    if (newName && newName !== playlist.name) {
                        playlist.name = newName;
                        renamePlaylist(playlist.id, newName);
                    }
                });
                titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') titleInput.blur(); });
            }

            // Play all
            const playBtn = playlistHeroDiv.querySelector('.playlist-play-btn');
            if (playBtn) {
                playBtn.addEventListener('click', () => {
                    if (playlist.tracks.length === 0) return;
                    currentPlaylistContext = playlist.tracks;
                    if (isShuffleActive) unplayedIndices = playlist.tracks.map((_, i) => i);
                    commitTrackChange(0);
                });
            }

            // Delete
            const deleteBtn = playlistHeroDiv.querySelector('.delete-playlist-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => {
                    if (confirm(`Delete "${playlist.name}"?`)) deletePlaylist(playlist.id);
                });
            }
        } else {
            // If title is active, we only update the meta info (track count/duration) 
            // without touching the input itself.
            const metaEl = playlistHeroDiv.querySelector('.album-hero-meta');
            if (metaEl) metaEl.textContent = `${playlist.tracks.length} track${playlist.tracks.length !== 1 ? 's' : ''}${durationStr}`;
        }

        renderTrackList(playlist.tracks, playlistTrackList, true, playlist.id);
    }

    // ── Add-to-playlist dropdown ──────────────────────────────────────────────
    function showAddToPlaylistDropdown(track, anchorEl) {
        addToPlaylistDropdown.innerHTML = '';

        // Add to Queue Option
        const queueItem = document.createElement('div');
        queueItem.className = 'dropdown-item';
        queueItem.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg> Add to Queue`;
        queueItem.addEventListener('click', () => {
            addToQueue(track);
            addToPlaylistDropdown.classList.add('hidden');
        });
        addToPlaylistDropdown.appendChild(queueItem);

        const queueDiv = document.createElement('div');
        queueDiv.className = 'dropdown-divider';
        addToPlaylistDropdown.appendChild(queueDiv);

        allPlaylists.forEach(pl => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            item.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3z"/></svg> ${pl.name}`;
            item.addEventListener('click', () => {
                addTrackToPlaylist(pl.id, track);
                addToPlaylistDropdown.classList.add('hidden');
            });
            addToPlaylistDropdown.appendChild(item);
        });

        if (allPlaylists.length > 0) {
            const divider = document.createElement('div');
            divider.className = 'dropdown-divider';
            addToPlaylistDropdown.appendChild(divider);
        }

        const newItem = document.createElement('div');
        newItem.className = 'dropdown-item new-pl';
        newItem.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> New Playlist`;
        newItem.addEventListener('click', () => {
            addToPlaylistDropdown.classList.add('hidden');
            openCreatePlaylistModal(track);
        });
        addToPlaylistDropdown.appendChild(newItem);

        // Position near button
        const rect = anchorEl.getBoundingClientRect();
        addToPlaylistDropdown.style.top = `${rect.bottom + 6}px`;
        addToPlaylistDropdown.style.left = `${Math.min(rect.left, window.innerWidth - 270)}px`;
        addToPlaylistDropdown.classList.remove('hidden');
    }

    document.addEventListener('click', (e) => {
        if (!addToPlaylistDropdown.contains(e.target) && !e.target.closest('.add-to-playlist-btn')) {
            addToPlaylistDropdown.classList.add('hidden');
        }
    });

    // ── Create Playlist Modal ─────────────────────────────────────────────────
    function openCreatePlaylistModal(trackToAddAfter) {
        pendingAddTrack = trackToAddAfter;
        playlistNameInput.value = '';
        createPlaylistModal.classList.remove('hidden');
        setTimeout(() => playlistNameInput.focus(), 50);
    }

    function closeCreatePlaylistModal() {
        createPlaylistModal.classList.add('hidden');
        pendingAddTrack = null;
    }

    createPlaylistCancelBtn.addEventListener('click', closeCreatePlaylistModal);

    createPlaylistConfirmBtn.addEventListener('click', async () => {
        const name = playlistNameInput.value.trim();
        if (!name) return;
        const trackToAdd = pendingAddTrack; // capture before modal close nulls it
        closeCreatePlaylistModal();
        const newPl = await createPlaylist(name);
        if (newPl && trackToAdd) {
            await addTrackToPlaylist(newPl.id, trackToAdd);
        }
    });

    playlistNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') createPlaylistConfirmBtn.click();
        if (e.key === 'Escape') closeCreatePlaylistModal();
    });

    createPlaylistModal.addEventListener('click', (e) => {
        if (e.target === createPlaylistModal) closeCreatePlaylistModal();
    });

    // ─────────────────────────────────────────────────────────────────────────

    function renderRecentArtists() {

        const recentArtistList = document.getElementById('recent-artist-list');
        const downloadedMusicList = document.getElementById('downloaded-music-list');
        if (!recentArtistList) return;
        
        let recentEntries = [];
        try {
            const raw = JSON.parse(localStorage.getItem('recentArtists') || '[]');
            // Support both legacy string format and new {name, picture} object format
            recentEntries = raw.map(a => typeof a === 'string' ? { name: a, picture: null } : a);
        } catch(e) {}

        // Restore any saved picture hashes into the in-memory cache before rendering
        recentEntries.forEach(entry => {
            if (entry.picture && window.artistImageHashes && !window.artistImageHashes[entry.name]) {
                window.artistImageHashes[entry.name] = entry.picture;
            }
        });

        recentArtistList.innerHTML = '';

        if (recentEntries.length === 0) {
            recentArtistList.innerHTML = '<div style="color:var(--text-secondary); padding: 20px;">Play a track to see history...</div>';
            return;
        }

        const top8 = recentEntries.slice(0, 8);
        top8.forEach(entry => {
            const artistName = entry.name;
            const card = document.createElement('div');
            card.className = 'artist-card';
            card.innerHTML = `
                <div class="artist-card-art"></div>
                <div class="artist-card-title" title="${artistName}">${artistName}</div>
                <div class="artist-card-label">Artist</div>
            `;
            card.addEventListener('click', () => openArtistView(artistName));
            recentArtistList.appendChild(card);

            if (typeof fetchAndApplyArtistImage === 'function') {
                fetchAndApplyArtistImage(artistName, card, false);
            }
        });

        const allBtnContainer = document.createElement('div');
        allBtnContainer.className = 'artist-card';
        allBtnContainer.style.display = 'flex';
        allBtnContainer.style.justifyContent = 'center';
        allBtnContainer.style.background = 'rgba(255,255,255,0.05)';
        allBtnContainer.style.opacity = '0.7';
        allBtnContainer.style.transition = 'all 0.2s ease';
        allBtnContainer.innerHTML = `
            <div style="font-size: 18px; font-weight: 800; color: white;">All Artists</div>
        `;
        allBtnContainer.addEventListener('mouseover', () => allBtnContainer.style.opacity = '1');
        allBtnContainer.addEventListener('mouseout', () => allBtnContainer.style.opacity = '0.7');
        allBtnContainer.addEventListener('click', () => {
            switchToAllArtistsView();
        });
        recentArtistList.appendChild(allBtnContainer);
        // renderAllArtistsGrid() moved to initializeMusicLibrary — runs once at startup, not on every track play
    }

    async function getAllDownloadedTracks() {
        let allDownloads = [];
        
        // 1. Electron downloads
        if (window.electronAPI) {
            const meta = await window.electronAPI.getDownloadedList();
            for (const [url, info] of Object.entries(meta)) {
                allDownloads.push({
                    url: url,
                    title: info.metadata.title,
                    artist: info.metadata.artist,
                    album: info.metadata.album,
                    coverUrl: info.metadata.coverUrl,
                    downloadedAt: info.downloadedAt || 0,
                    isDash: false,
                    isCloud: true,
                    cloudId: url.replace('qqdl://', ''),
                    metadata: info.metadata
                });
            }
        }
        
        // 2. IndexedDB downloads (PWA and DASH)
        const records = await getAllOfflineTrackRecords();
        records.forEach(record => {
            allDownloads.push({
                url: record.id,
                title: record.metadata.title,
                artist: record.metadata.artist,
                album: record.metadata.album,
                coverUrl: record.metadata.coverUrl,
                downloadedAt: record.downloadedAt || 0,
                isDash: record.isDash,
                isCloud: true,
                cloudId: record.id.replace('qqdl://', ''),
                metadata: record.metadata
            });
        });

        // Deduplicate by URL (prefer IndexedDB if both exist for some reason)
        const uniqueMap = new Map();
        allDownloads.forEach(d => uniqueMap.set(d.url, d));
        return Array.from(uniqueMap.values()).sort((a,b) => b.downloadedAt - a.downloadedAt);
    }

    async function renderDownloadedSection() {
        const list = document.getElementById('downloaded-music-list');
        if (!list) return;

        const all = await getAllDownloadedTracks();
        const latest = all.slice(0, 8);

        if (latest.length === 0) {
            list.innerHTML = '<div style="color:var(--text-secondary); padding: 20px;">No downloads yet.</div>';
            return;
        }

        list.innerHTML = '';
        latest.forEach(track => {
            const card = document.createElement('div');
            card.className = 'album-card';
            const coverUrl = track.coverUrl || '';
            const artHtml = coverUrl
                ? `<img src="${coverUrl}" class="album-card-art" alt="" crossorigin="anonymous">`
                : `<div class="album-card-art"></div>`;

            card.innerHTML = `
                <div class="card-art-wrapper">
                    ${artHtml}
                    <button class="card-play-btn">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>
                    </button>
                </div>
                <div class="album-card-title" title="${track.title}">${track.title}</div>
                <div class="album-card-artist">${track.artist}</div>
            `;
            
            card.querySelector('.card-play-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                playTrack(track, track.title, track.artist);
            });
            
            const artistLink = card.querySelector('.album-card-artist');
            if (artistLink) {
                artistLink.style.cursor = 'pointer';
                artistLink.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (track.artist) openArtistView(track.artist);
                });
            }

            card.addEventListener('click', () => {
                if (track.metadata && track.metadata.album) {
                    if (searchInput) searchInput.value = track.metadata.album;
                    switchToSearchView();
                    renderSearchResults(track.metadata.album);
                } else {
                    playTrack(track, track.title, track.artist);
                }
            });
            
            list.appendChild(card);
        });
    }

    async function renderAllDownloadsView() {
        if (!downloadsListContainer) return;

        const all = await getAllDownloadedTracks();
        if (all.length === 0) {
            downloadsListContainer.innerHTML = '<div style="color:var(--text-secondary); padding: 20px;">No offline downloads found.</div>';
            return;
        }

        renderTrackList(all, downloadsListContainer);
    }

    function renderAllArtistsGrid() {
        if (!allArtistsGrid || !albumsData) return;

        allArtistsGrid.innerHTML = '';
        const uniqueArtists = new Set();
        Object.values(albumsData).forEach(album => {
            if (album.artist && album.artist !== 'Unknown Artist') {
                uniqueArtists.add(album.artist);
            }
        });

        const sortedArtists = Array.from(uniqueArtists).sort();
        
        sortedArtists.forEach(artistName => {
            const card = document.createElement('div');
            card.className = 'artist-card';
            card.innerHTML = `
                <div class="artist-card-art"></div>
                <div class="artist-card-title" title="${artistName}">${artistName}</div>
                <div class="artist-card-label">Artist</div>
            `;
            card.addEventListener('click', () => openArtistView(artistName));
            allArtistsGrid.appendChild(card);
            
            if (typeof fetchAndApplyArtistImage === 'function') {
                fetchAndApplyArtistImage(artistName, card, false);
            }
        });
    }

    async function attemptResolve(apiUrl, trackId) {
        try {
            const data = await apiFetch(`${apiUrl}/track/?id=${trackId}`);
            if (!data) return null;

            // If QQDL returns a preview presentation, bail — Stage 2 will retry with quality params
            // NOTE: FULL DASH manifests are also blocked by Tidal CDN (CORS + IP-auth).
            // data.url (preview pre-signed URL) is the only thing playable from the browser
            // until we implement the main-process proxy (Bug 2).
            const assetPresentation = data.data && data.data.assetPresentation;
            if (assetPresentation === 'PREVIEW') {
                // Last resort: return the preview URL so we play something rather than nothing
                const previewUrl = data.url || (data.data && data.data.url);
                return previewUrl ? { url: previewUrl, isDash: false } : null;
            }

            // Skip data.url — it's the 30s preview clip. Always go through the manifest.
            // apiFetch() routes through the Electron main process (net.fetch), bypassing
            // Chromium CORS and Tidal CDN's IP-auth rejection on full track segments.
            let rawManifest = data.manifest || (data.data && data.data.manifest);
            if (!rawManifest) return null;

            let manifest;
            let isDash = (data.data && data.data.manifestMimeType === 'application/dash+xml');

            if (typeof rawManifest === 'string') {
                try {
                    const decoded = atob(rawManifest);
                    if (decoded.trim().startsWith('<?xml') || decoded.trim().startsWith('<MPD')) {
                        isDash = true;
                        manifest = decoded;
                    } else {
                        manifest = JSON.parse(decoded);
                    }
                } catch (e) {
                    if (rawManifest.startsWith('http')) return { url: rawManifest, isDash: false };
                    return null;
                }
            } else {
                manifest = rawManifest;
            }

            if (!manifest) return null;

            if (isDash) {
                return { url: rawManifest, isDash: true };
            }

            const manifestUrl = manifest.url || (manifest.urls && manifest.urls[0]) || manifest.trackUrl || null;
            return manifestUrl ? { url: manifestUrl, isDash: false } : null;

        } catch(e) {
            console.warn(`Error resolving on ${apiUrl}:`, e);
            return null;
        }
    }

    async function resolveCloudTrackUrl(track) {
        if (!track.isCloud) return track.url;
        
        const tryAPIs = [qqdlTargetUrl, ...availableCloudApis.filter(a => a !== qqdlTargetUrl)];
        
        // Stage 1: Parallel Hi-Res check across all APIs
        const result = await firstSuccess(tryAPIs.map(api => 
            attemptResolve(api, track.cloudId).then(res => res ? { api, ...res } : null)
        ));

        if (result) {
            qqdlTargetUrl = result.api;
            return { url: result.url, isDash: result.isDash };
        }

        // Stage 2: Parallel Quality fallbacks if HI_RES failed on all APIs
        console.log("HI_RES failed on all APIs. Trying LOSSLESS/HIGH in parallel...");
        const fallbackPromises = [];
        for (const api of tryAPIs) {
            fallbackPromises.push(attemptResolve(api, `${track.cloudId}&q=LOSSLESS`).then(res => res ? { api, ...res } : null));
            fallbackPromises.push(attemptResolve(api, `${track.cloudId}&q=HIGH`).then(res => res ? { api, ...res } : null));
        }

        const fallbackResult = await firstSuccess(fallbackPromises);
        if (fallbackResult) {
            qqdlTargetUrl = fallbackResult.api;
            return { url: fallbackResult.url, isDash: fallbackResult.isDash };
        }

        return null;
    }

    async function playTrack(track, title, artist, prefetchOverride = null, skipAudio = false) {
        if (window.electronAPI) {
            window.electronAPI.updatePresence({ title, artist, startTime: Date.now(), isPaused: false });
        }
        window.globalPlayingTrack = track;


        // UNIVERSAL SYNC: Slave-to-Master redirection
        if (masterDeviceId && deviceId !== masterDeviceId && currentUser && !skipAudio) {
            console.log('[Sync] Slave Mode: Redirecting "Play" command to Master...');
            FirebaseRemoteEngine.sendCommand(masterDeviceId, 'PLAY_TRACK', {
                track,
                context: typeof window.getCurrentContext === 'function' ? window.getCurrentContext() : [],
                index: typeof window.getCurrentIndex === 'function' ? window.getCurrentIndex() : -1
            });
            return;
        }

        // UNIVERSAL SYNC: Update context if we are master
        if (deviceId === masterDeviceId) {
            broadcastActiveContext(true);
        }
        prefetchedNextTrackData = null; // Clear prefetch once track starts

        let fullAudioUrl = track.url;
        let isWaitingForDash = false;
        
        // DASHBOARD MODE: Update UI only, do not load or play audio
        if (skipAudio) {
            console.log('[Sync] Slave Mode: Updating metadata UI only for:', title);
        } else {
            if (prefetchOverride && prefetchOverride.status === 'ready' && prefetchOverride.track.url === track.url) {
                fullAudioUrl = prefetchOverride.url;
                isWaitingForDash = prefetchOverride.isDash;
                if (isWaitingForDash) {
                    dashActive = true;
                    if (!prefetchOverride.skipAudioInjection) {
                        if (fullAudioUrl.startsWith('offline:')) {
                            await ensureDashPlayer();
                            shakaPlayerInstance.load(fullAudioUrl).catch(e => console.error("DASH Offline load failed", e));
                        } else {
                            await playDashStream(fullAudioUrl);
                        }
                    }
                } else if (dashActive) {
                    await destroyDashPlayer();
                    dashActive = false;
                }
            } else {
                if (track.isCloud && track.url.startsWith('qqdl://')) {
                    const resolved = await resolveCloudTrackUrl(track);
                    if (resolved && typeof resolved === 'object') {
                        if (resolved.isDash) {
                            isWaitingForDash = true;
                            dashActive = true;
                            await playDashStream(resolved.url);
                        } else {
                            if (dashActive) {
                                await destroyDashPlayer();
                                dashActive = false;
                            }
                            fullAudioUrl = resolved.url || track.url;
                        }
                    } else if (resolved) {
                        fullAudioUrl = resolved; 
                    } else {
                        alert("Failed to resolve cloud stream.");
                        return;
                    }
                } else {
                    if (dashActive) {
                        await destroyDashPlayer();
                        dashActive = false;
                    }
                }

                const localPathRaw = downloadedTracksMap.get(track.url);
                if (localPathRaw) {
                    if (localPathRaw.startsWith('offline:')) {
                        isWaitingForDash = true;
                        dashActive = true;
                        await ensureDashPlayer();
                        shakaPlayerInstance.load(localPathRaw).catch(e => {
                            console.error("DASH Offline load failed", e);
                            alert("Failed to load offline DASH track.");
                        });
                    } else if (window.electronAPI && !localPathRaw.startsWith('pwa-stored')) {
                        fullAudioUrl = `simon-offline://${encodeURIComponent(localPathRaw)}`;
                    } else {
                        fullAudioUrl = `./pwa-offline/${encodeURIComponent(track.url)}`;
                    }
                }
            }
        }

        const localPath = downloadedTracksMap.get(track.url);

        if (localPath) {
            // Load offline assets (Covers / Lyrics)
            const record = await getTrackRecordFromDB(track.url);
            if (record) {
                if (record.coverBlob) {
                    const localCoverUrl = URL.createObjectURL(record.coverBlob);
                    bottomArtWrapper.innerHTML = `<img src="${localCoverUrl}" alt="Album Art">`;
                    if (immersiveBg) immersiveBg.src = localCoverUrl;
                    if (immersiveArt) {
                        immersiveArt.src = localCoverUrl;
                        immersiveArt.style.display = 'block';
                    }
                    updatePlayerBarDynamicColor(localCoverUrl);
                } else if (window.electronAPI && !localPath.startsWith('pwa-stored')) {
                    // Electron cover fallback
                    const pictureUrl = `simon-offline://${encodeURIComponent(localPath)}.cover.jpg`;
                    bottomArtWrapper.innerHTML = `<img src="${pictureUrl}" alt="Album Art" onerror="this.style.display='none'">`;
                    if (immersiveBg) immersiveBg.src = pictureUrl;
                    if (immersiveArt) {
                        immersiveArt.src = pictureUrl;
                        immersiveArt.style.display = 'block';
                    }
                    updatePlayerBarDynamicColor(pictureUrl);
                }
            }
        } else if (track.metadata && track.metadata.coverUrl) {
            const pictureUrl = track.metadata.coverUrl || '';
            bottomArtWrapper.innerHTML = `<img src="${pictureUrl}" alt="Album Art" crossorigin="anonymous">`;
            if (immersiveBg) immersiveBg.src = pictureUrl;
            if (immersiveArt) {
                 immersiveArt.src = pictureUrl;
                 immersiveArt.style.display = 'block';
            }
            updatePlayerBarDynamicColor(pictureUrl);
        }

        // Update Bottom Offline Icon
        updatePlayerBarOfflineUI();
        
        bottomTitle.textContent = title;
        bottomArtist.textContent = artist;
        
        try {
            if (artist && artist !== 'Unknown Artist') {
                let recent = JSON.parse(localStorage.getItem('recentArtists') || '[]');
                recent = recent.map(a => typeof a === 'string' ? { name: a, picture: null } : a);
                recent = recent.filter(a => a.name !== artist);
                const pictureHash = (window.artistImageHashes && window.artistImageHashes[artist]) || null;
                recent.unshift({ name: artist, picture: pictureHash });
                localStorage.setItem('recentArtists', JSON.stringify(recent.slice(0, 50)));
                renderRecentArtists();
            }
        } catch(e){}

        if (immersiveTitle) immersiveTitle.textContent = title;
        if (immersiveArtist) immersiveArtist.textContent = artist;

        const album = track.metadata && track.metadata.album ? track.metadata.album : '';
        const duration = track.metadata && track.metadata.duration ? track.metadata.duration : 0;
        fetchLyrics(title, artist, album, duration);

        updateMediaSession(track);

        if (!isWaitingForDash) {
            if (prefetchOverride && prefetchOverride.skipAudioInjection) {
                // Audio was successfully natively injected in the 'ended' event handler!
                // Skip re-assigning .src as it would break seamless media continuity
            } else {
                audioPlayer.src = fullAudioUrl;
                audioPlayer.play().catch(e => console.error("Auto-play blocked/failed", e));
            }
        }
    }

    function updateMediaSession(track) {
        if (!('mediaSession' in navigator)) return;

        const title = (track.metadata && track.metadata.title) ? track.metadata.title : track.filename;
        const artist = (track.metadata && track.metadata.artist) ? track.metadata.artist : 'Unknown Artist';
        const album = (track.metadata && track.metadata.album) ? track.metadata.album : '';
        const artwork = (track.metadata && track.metadata.coverUrl) 
            ? [{ src: track.metadata.coverUrl, sizes: '512x512', type: 'image/jpeg' }]
            : [{ src: 'icon.svg', sizes: '512x512', type: 'image/svg+xml' }];

        navigator.mediaSession.metadata = new MediaMetadata({
            title: title,
            artist: artist,
            album: album,
            artwork: artwork
        });

        navigator.mediaSession.setActionHandler('play', () => audioPlayer.play());
        navigator.mediaSession.setActionHandler('pause', () => audioPlayer.pause());
        navigator.mediaSession.setActionHandler('previoustrack', () => playPreviousTrack());
        navigator.mediaSession.setActionHandler('nexttrack', () => playNextTrack(false));
    }

    // ── Offline Helper Logic ────────────────────────────────────────────────
    async function initiateDownload(track) {
        if (!window.electronAPI && typeof indexedDB === 'undefined') {
            alert("Offline storage is not supported in this browser.");
            return;
        }
        
        let targetUrl = track.url;
        let isDashForDownload = false;
        let dashManifestData = null;

        if (track.isCloud && track.url.startsWith('qqdl://')) {
            const resolved = await resolveCloudTrackUrl(track);
            if (!resolved) {
                alert("Failed to resolve cloud stream for download.");
                return;
            }
            if (typeof resolved === 'object') {
                if (resolved.isDash) {
                    isDashForDownload = true;
                    dashManifestData = resolved.url;
                } else {
                    targetUrl = resolved.url || track.url;
                }
            } else {
                targetUrl = resolved; 
            }
        }

        pendingDownloads.set(track.url, 0); 
        refreshCurrentView();

        try {
            // Gather extra assets for offline
            let coverBlob = null;
            let lyrics = null;

            if (track.metadata) {
                const { title, artist, album, duration, coverUrl } = track.metadata;
                
                // 1. Fetch Lyrics
                lyrics = await fetchLyricsRaw(title, artist, album, duration);

                // 2. Fetch Cover Blob
                if (coverUrl) {
                    try {
                        const cRes = await fetch(coverUrl);
                        if (cRes.ok) coverBlob = await cRes.blob();
                    } catch (e) { console.warn("Failed to fetch cover blob", e); }
                }
            }

            if (isDashForDownload) {
                if (!dashManifestData) {
                    throw new Error("Resolved DASH manifest is empty.");
                }
                await downloadDashTrack(track, dashManifestData, coverBlob, lyrics);
            } else if (window.electronAPI) {
                if (!targetUrl) {
                    throw new Error("Download URL is undefined.");
                }
                const result = await window.electronAPI.downloadTrack({
                    url: targetUrl,
                    originalTrackingUrl: track.url, 
                    metadata: track.metadata,
                    coverUrl: (track.metadata && track.metadata.coverUrl) ? track.metadata.coverUrl : null,
                    lyrics: lyrics
                });
                if (result.success) await syncOfflineState();
            } else {
                // PWA Native Download
                const response = await fetch(targetUrl);
                if (!response.ok) throw new Error('Network fetch failed');
                const blob = await response.blob();
                await saveTrackToDB(track.url, blob, track.metadata, false, coverBlob, lyrics);
                await syncOfflineState();
            }
        } catch (e) {
            console.error('Download failed', e);
            const errorMsg = e.message || e.toString();
            alert(`Failed to download track: ${errorMsg}`);
        } finally {
            pendingDownloads.delete(track.url);
            refreshCurrentView();
        }
    }



    async function removeOfflineTrack(trackUrl) {
        const localPath = downloadedTracksMap.get(trackUrl);
        
        // 1. Cleanup Shaka Storage if it's a DASH track
        if (localPath && localPath.startsWith('offline:')) {
            try {
                await ensureDashPlayer();
                await shakaStorageInstance.remove(localPath);
            } catch (e) { console.warn("Failed to remove DASH from shaka storage", e); }
        }

        // 2. Cleanup Database
        await deleteTrackFromDB(trackUrl);

        // 3. Cleanup Electron File System if needed
        if (window.electronAPI) {
            await window.electronAPI.deleteOfflineTrack(trackUrl);
        }

        downloadedTracksMap.delete(trackUrl);
        refreshCurrentView();
    }

    function refreshCurrentView() {
        // Re-render whatever view is active to update download icons
        const activeView = document.querySelector('.view.active');
        if (!activeView) return;

        if (activeView.id === 'album-view') {
            if (activeViewAlbum) {
                renderTrackList(activeViewAlbum.tracks);
                updateAlbumHeroOfflineStatus(activeViewAlbum);
            }
        } else if (activeView.id === 'artist-view') {
            // Difficult to refresh artist view perfectly without data stored globally
            // But usually we just refresh the track list if it's there
            if (artistTrackList) {
                // We'd need to re-collect the tracks. For now, let's just trigger a re-render
                // if we have a way to track the current artist.
            }
        } else if (activeView.id === 'playlist-view') {
            const pl = allPlaylists.find(p => p.id === activePlaylistId);
            if (pl) renderTrackList(pl.tracks, playlistTrackList, true, pl.id);
        } else if (activeView.id === 'search-view') {
            const query = searchInput.value || (mobileSearchInput ? mobileSearchInput.value : '');
            if (query) renderSearchResults(query);
        }

        // Update Global Player Bar offline status if something is playing
        updatePlayerBarOfflineUI();

        // Update track list offline icons in currently active containers
        const containers = [trackListElement, playlistTrackList, searchTrackList, artistTrackList];
        containers.forEach(container => {
            if (!container) return;
            container.querySelectorAll('.track-item').forEach(trackItem => {
                const url = trackItem.dataset.url;
                if (!url) return;

                const offlineBtn = trackItem.querySelector('.track-offline-btn');
                if (!offlineBtn) return;

                const isOffline = downloadedTracksMap.has(url);
                const progress = pendingDownloads.get(url);

                if (isOffline) {
                    offlineBtn.classList.add('downloaded');
                    offlineBtn.classList.remove('downloading');
                    offlineBtn.style.setProperty('--progress', '100%');
                    offlineBtn.title = 'Available Offline (Click to remove)';
                } else if (progress !== undefined) {
                    offlineBtn.classList.remove('downloaded');
                    offlineBtn.classList.add('downloading');
                    offlineBtn.style.setProperty('--progress', `${Math.round(progress * 100)}%`);
                    offlineBtn.title = `Downloading... ${Math.round(progress * 100)}%`;
                } else {
                    offlineBtn.classList.remove('downloaded', 'downloading');
                    offlineBtn.style.setProperty('--progress', '0%');
                    offlineBtn.title = 'Download for Offline';
                }
            });
        });
    }

    if (window.electronAPI) {
        window.electronAPI.onDownloadProgress(({ url, progress }) => {
            pendingDownloads.set(url, progress);
            refreshCurrentView();
        });
    }

    // Initialize offline list on start
    async function syncOfflineState() {
        downloadedTracksMap.clear();

        // 1. Load from Electron if available
        if (window.electronAPI) {
            const meta = await window.electronAPI.getDownloadedList();
            for (const [fullUrl, info] of Object.entries(meta)) {
                downloadedTracksMap.set(fullUrl, info.localPath);
            }
        }

        // 2. Load from IndexedDB (DASH for both, Standard for PWA)
        try {
            const records = await getAllOfflineTrackRecords();
            records.forEach(record => {
                if (record.isDash) {
                    downloadedTracksMap.set(record.id, record.offlineUri);
                } else if (!window.electronAPI) {
                    downloadedTracksMap.set(record.id, 'pwa-stored');
                }
            });
        } catch (e) { console.warn("IDB sync failed", e); }

        refreshCurrentView();
    }


    async function removeAlbumOffline(album) {
        if (!confirm(`Are you sure you want to remove all ${album.tracks.length} tracks of "${album.name}" from offline storage?`)) return;
        
        for (const track of album.tracks) {
            if (downloadedTracksMap.has(track.url)) {
                await removeOfflineTrack(track.url);
            }
        }
        await syncOfflineState();
    }

    function updateAlbumHeroOfflineStatus(album) {
        if (!albumHeroDiv) return;
        const btn = albumHeroDiv.querySelector('.download-album-btn');
        if (!btn) return;

        const isAlbumOffline = album.tracks.every(t => downloadedTracksMap.has(t.url));
        const isAlbumDownloading = album.tracks.some(t => pendingDownloads.has(t.url));

        btn.classList.toggle('active', isAlbumOffline);
        btn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                ${isAlbumOffline ? '<polyline points="20 6 9 17 4 12"></polyline>' : '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>'}
            </svg>
            <span>${isAlbumOffline ? 'Downloaded' : (isAlbumDownloading ? 'Downloading...' : 'Download Album')}</span>
        `;
    }

    async function downloadAlbum(album) {
        if (!album || !album.tracks) return;

        // Download all tracks sequentially
        for (const track of album.tracks) {
            if (isTrackUnsupported(track)) continue;
            if (downloadedTracksMap.has(track.url)) continue;
            await initiateDownload(track);
        }
    }

    syncOfflineState();

    // Bottom Bar Click Navigation
    bottomArtist.addEventListener('click', () => {
        if (!window.globalPlayingTrack) return;
        const artistName = (window.globalPlayingTrack.metadata && window.globalPlayingTrack.metadata.artist) ? window.globalPlayingTrack.metadata.artist : "Unknown Artist";
        openArtistView(artistName);
    });

    bottomTitle.addEventListener('click', () => {
        if (!window.globalPlayingTrack) return;
        
        const albumName = (window.globalPlayingTrack.metadata && window.globalPlayingTrack.metadata.album) ? window.globalPlayingTrack.metadata.album : "Unknown Album";
        const albumInfo = albumsData[albumName];
        
        if (albumInfo) {
            openAlbumView(albumInfo);
            
            // Find index of the playing track inside the newly rendered album view
            const playingIndex = albumInfo.tracks.findIndex(t => t.url === window.globalPlayingTrack.url);
            
            if (playingIndex !== -1) {
                const container = document.getElementById('track-list');
                const trackItems = container.querySelectorAll('.track-item');
                if (trackItems[playingIndex]) {
                    const item = trackItems[playingIndex];
                    
                    // Calculate relative scroll position to avoid bubbling up to body
                    const relativeTop = item.getBoundingClientRect().top - container.getBoundingClientRect().top;
                    const scrollPosition = container.scrollTop + relativeTop - (container.clientHeight / 2) + (item.clientHeight / 2);
                    
                    container.scrollTo({
                        top: Math.max(0, scrollPosition),
                        behavior: 'smooth'
                    });
                }
            }
        }
    });
    // ── Mobile Landscape Fullscreen Auto-Manager ──────────────────────────
    function manageLandscapeFullscreen() {
        const isMobile = window.innerWidth <= 1024 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
        const isLandscape = window.innerWidth > window.innerHeight;

        if (isMobile && isLandscape) {
            // Enter fullscreen if in landscape and not already
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {
                    // Browsers commonly block this if not triggered by direct user interaction
                    // The fallback click listener below will catch it on their next tap
                });
            }
        } else if (isMobile && !isLandscape) {
            // Exit fullscreen if rotating back to portrait
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }
        }
    }

    // Check on rotation and screen resize
    window.addEventListener('resize', manageLandscapeFullscreen);
    window.addEventListener('orientationchange', () => setTimeout(manageLandscapeFullscreen, 100));

    // Fallback: If the browser blocked the automatic request fullscreen on rotation, 
    // the next tap anywhere on the screen will trigger it seamlessly.
    document.addEventListener('click', () => {
        const isMobile = window.innerWidth <= 1024 || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
        const isLandscape = window.innerWidth > window.innerHeight;
        
        if (isMobile && isLandscape && !document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    });

    // ── Initial State Restoration ───────────────────────────────────────────
    try {
        await Promise.all([
            fetchPlaylists(),
            initializeMusicLibrary(),
            ensureDashPlayer().catch(e => console.warn("Background Shaka preload failed", e))
        ]);

        // Always start at landing page (Home)
        switchToHomeView(false);
    } catch (err) {
        console.error("Initialization failed:", err);
        switchToHomeView(false); // fallback
    }

    // Update UI when now playing metadata changes
    window.updateNowPlayingUI = (metadata) => {
        if (!metadata) return;
        bottomTitle.textContent = metadata.title || 'Unknown Track';
        bottomArtist.textContent = metadata.artist || 'Unknown Artist';
        if (metadata.coverUrl) {
            const artImg = bottomArtWrapper.querySelector('img');
            if (artImg) artImg.src = metadata.coverUrl;
            updatePlayerBarDynamicColor(metadata.coverUrl);
        }
    };

    // Expose settings helpers globally so external engines can reach them
    window._openSettings = () => { renderSettingsPanel(); openSettings(); };

    // Expose core playback functions globally for Firebase Remote Engine
    window.playTrack = playTrack;
    window.playNextTrack = playNextTrack;
    window.playPreviousTrack = playPreviousTrack;
    window.addToQueue = addToQueue;
    window.updateLyricsSync = updateLyricsSync;
    window.renderQueueView = renderQueueView;
    window.renderSettingsPanel = renderSettingsPanel;
    window.fetchPlaylists = fetchPlaylists;

    // State Accessors for Sync Engine
    window.getCurrentContext = () => currentPlaylistContext;
    window.getCurrentIndex = () => currentTrackIndex;
    window.updateContextAndPlay = (context, index) => {
        currentPlaylistContext = context;
        commitTrackChange(index);
    };

    window.setShuffleState = setShuffleState;
    window.setRepeatMode = setRepeatMode;

    // END of appInit()
    }

}); // END of DOMContentLoaded

