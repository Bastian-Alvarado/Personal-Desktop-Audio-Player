let qqdlTargetUrl = 'https://wolf.qqdl.site';
let availableCloudApis = [];
let isQqdlInitialized = false;

async function initCloudTarget() {
    try {
        const res = await fetch('https://tidal-uptime.jiffy-puffs-1j.workers.dev/');
        if (res.ok) {
            const data = await res.json();
            if (data && data.api && data.api.length > 0) {
                availableCloudApis = data.api.map(a => a.url);
                qqdlTargetUrl = availableCloudApis[0];
                console.log('QQDL Targets resolved:', availableCloudApis);
            }
        }
    } catch(e) {
        console.warn('Failed to fetch uptime worker, using default target', e);
        availableCloudApis = [qqdlTargetUrl];
    }
    isQqdlInitialized = true;
}

function getTidalImage(hash, size = '320x320') {
    if (!hash) return '';
    return `https://resources.tidal.com/images/${hash.replace(/-/g, '/')}/${size}.jpg`;
}

document.addEventListener('DOMContentLoaded', async () => {
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
    const createPlaylistModal = document.getElementById('create-playlist-modal');
    const playlistNameInput = document.getElementById('playlist-name-input');
    const createPlaylistCancelBtn = document.getElementById('create-playlist-cancel-btn');
    const createPlaylistConfirmBtn = document.getElementById('create-playlist-confirm-btn');
    const addToPlaylistDropdown = document.getElementById('add-to-playlist-dropdown');

    // Settings Elements
    const settingsBtn = document.getElementById('settings-btn');
    const settingsView = document.getElementById('settings-view');
    const settingsCloseBtn = document.getElementById('settings-close-btn');

    // Mobile Bottom Nav Elements
    const mobileHomeBtn = document.getElementById('mobile-home-btn');
    const mobileSearchBtn = document.getElementById('mobile-search-btn');
    const mobileSettingsBtn = document.getElementById('mobile-settings-btn');
    const mobileNavItems = [mobileHomeBtn, mobileSearchBtn, mobileSettingsBtn];
    const mobileSearchInput = document.getElementById('mobile-search-input');
    
    // Metadata Edit Elements
    const editMetadataModal = document.getElementById('edit-metadata-modal');
    const metadataModalTitle = document.getElementById('metadata-modal-title');
    const metadataTitleInput = document.getElementById('metadata-title-input');
    const metadataArtistInput = document.getElementById('metadata-artist-input');
    const metadataAlbumInput = document.getElementById('metadata-album-input');
    const metadataYearInput = document.getElementById('metadata-year-input');
    const metadataArtPreview = document.getElementById('metadata-art-preview');
    const metadataArtInput = document.getElementById('metadata-art-input');
    const metadataArtDropzone = document.getElementById('metadata-art-dropzone');
    const metadataSaveBtn = document.getElementById('metadata-save-btn');
    const metadataCancelBtn = document.getElementById('metadata-cancel-btn');
    const metadataRestoreBtn = document.getElementById('metadata-restore-btn');
    const trackContextMenu = document.getElementById('track-context-menu');
    const menuEditBtn = document.getElementById('menu-edit-btn');
    const menuPlaylistBtn = document.getElementById('menu-playlist-btn');

    let currentEditingTrack = null;
    let currentEditingAlbum = null;
    let isAlbumMode = false;
    let newCoverArtBase64 = null;

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
    let isShuffleActive = false;
    let unplayedIndices = [];
    let currentViewInfo = {
        tracks: [],
        container: null,
        isPlaylistView: false,
        playlistId: null
    };
    let repeatMode = 0;
    let globalPlayingTrack = null;
    let allPlaylists = [];
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
            
            let manifestDataUrl;
            if (manifest.trim().startsWith('<?xml') || manifest.trim().startsWith('<MPD')) {
                // For XML strings, encode to data URL
                manifestDataUrl = `data:application/dash+xml;charset=utf-8,${encodeURIComponent(manifest)}`;
            } else {
                // For Base64 strings, strip whitespace and embed directly
                const cleanManifest = manifest.replace(/\s/g, '');
                manifestDataUrl = `data:application/dash+xml;base64,${cleanManifest}`;
            }

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
    let userQueue = [];
    let downloadedTracksMap = new Map(); // url -> localPath
    let pendingDownloads = new Map(); // url -> progress
    let pendingUploads = new Set();  // url

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

    async function saveTrackToDB(id, data, metadata, isDash = false) {
        const db = await openOfflineDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const record = { id, metadata, timestamp: Date.now(), isDash };
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

    async function downloadDashTrack(track, manifest) {
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
            
            await saveTrackToDB(track.url, offlineUri, track.metadata, true);
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
        queueView.classList.remove('hidden');
        queueView.classList.add('active');
        queueBtn.classList.add('active-icon');
        renderQueueView();
    }

    queueBtn.addEventListener('click', toggleQueueView);

    queueClearBtn.addEventListener('click', () => {
        userQueue = [];
        renderQueueView();
    });

    function renderQueueView() {
        if (!globalPlayingTrack) {
            queueNowPlaying.innerHTML = '<div class="search-empty-text" style="font-size:14px; opacity:0.5;">Nothing playing</div>';
            queueUserSection.style.display = 'none';
            queueContextList.innerHTML = '<div class="search-empty-text" style="font-size:14px; opacity:0.5;">No context</div>';
            return;
        }
        
        // Render Now Playing
        renderTrackList([globalPlayingTrack], queueNowPlaying);
        
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
        settingsView.classList.add('active');
        settingsBtn.classList.add('settings-btn-active');
    }

    function closeSettings() {
        settingsView.classList.remove('active');
        settingsBtn.classList.remove('settings-btn-active');
    }

    settingsBtn.addEventListener('click', () => {
        if (settingsView.classList.contains('active')) {
            closeSettings();
        } else {
            renderSettingsPanel();
            openSettings();
        }
    });

    settingsCloseBtn.addEventListener('click', closeSettings);

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

    menuEditBtn.addEventListener('click', () => {
        hideContextMenu();
        if (currentEditingTrack) openEditMetadataModal(currentEditingTrack);
    });

    menuPlaylistBtn.addEventListener('click', (e) => {
        hideContextMenu();
        if (currentEditingTrack) showAddToPlaylistDropdown(currentEditingTrack, e.target);
    });

    function openEditAlbumModal(albumInfo) {
        isAlbumMode = true;
        currentEditingAlbum = albumInfo;
        newCoverArtBase64 = null;
        
        metadataModalTitle.textContent = "Edit Album Information";
        
        // Hide song-specific fields
        metadataTitleInput.closest('.input-group').style.display = 'none';
        metadataYearInput.closest('.input-group').style.display = 'none';
        
        // Show cover editor for album level
        metadataArtDropzone.closest('.metadata-editor-left').style.display = 'flex';
        metadataRestoreBtn.style.display = 'none';
        
        metadataArtistInput.value = albumInfo.artist;
        metadataAlbumInput.value = albumInfo.name;

        // Show current album cover
        if (albumInfo.coverTrackPath) {
            metadataArtPreview.src = `${serverBaseUrl}/api/cover?path=${encodeURIComponent(albumInfo.coverTrackPath)}&t=${Date.now()}`;
            metadataArtPreview.style.display = 'block';
        } else {
            metadataArtPreview.src = '';
            metadataArtPreview.style.display = 'none';
        }
        
        editMetadataModal.classList.remove('hidden');
    }

    function openEditMetadataModal(track) {
        isAlbumMode = false;
        currentEditingTrack = track;
        newCoverArtBase64 = null;
        
        metadataModalTitle.textContent = "Edit Song Information";
        
        // Ensure all fields are visible
        metadataTitleInput.closest('.input-group').style.display = 'flex';
        metadataYearInput.closest('.input-group').style.display = 'flex';
        
        // Hide cover editor for individual songs
        metadataArtDropzone.closest('.metadata-editor-left').style.display = 'none';
        metadataRestoreBtn.style.display = 'block';
        
        metadataTitleInput.value = (track.metadata && track.metadata.title) ? track.metadata.title : track.filename;
        metadataArtistInput.value = (track.metadata && track.metadata.artist) ? track.metadata.artist : '';
        metadataAlbumInput.value = (track.metadata && track.metadata.album) ? track.metadata.album : '';
        metadataYearInput.value = (track.metadata && track.metadata.year) ? track.metadata.year : '';
        
        if (track.hasBackup) {
            metadataRestoreBtn.classList.remove('hidden');
        } else {
            metadataRestoreBtn.classList.add('hidden');
        }

        editMetadataModal.classList.remove('hidden');
    }

    metadataCancelBtn.addEventListener('click', () => {
        editMetadataModal.classList.add('hidden');
    });

    metadataArtDropzone.addEventListener('click', () => {
        metadataArtInput.click();
    });

    metadataArtInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            newCoverArtBase64 = event.target.result;
            metadataArtPreview.src = newCoverArtBase64;
            metadataArtPreview.style.display = 'block';
        };
        reader.readAsDataURL(file);
    });

    metadataSaveBtn.addEventListener('click', async () => {
        if (isAlbumMode) {
            if (!currentEditingAlbum) return;
            metadataSaveBtn.disabled = true;
            metadataSaveBtn.textContent = 'Saving...';
            
            try {
                const res = await fetch(`${serverBaseUrl}/api/update-album-metadata`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tracks: currentEditingAlbum.tracks.map(t => ({ relativePath: t.relativePath, isLocal: !!t.isLocal })),
                        metadata: {
                            artist: metadataArtistInput.value.trim(),
                            album: metadataAlbumInput.value.trim()
                        },
                        coverArt: newCoverArtBase64
                    })
                });

                if (res.ok) {
                    editMetadataModal.classList.add('hidden');
                    await initializeMusicLibrary();
                    alert('Album updated successfully!');
                } else {
                    const err = await res.json();
                    alert('Save failed: ' + err.error);
                }
            } catch (e) {
                alert('Error saving album metadata: ' + e.message);
            } finally {
                metadataSaveBtn.disabled = false;
                metadataSaveBtn.textContent = 'Save Changes';
            }
            return;
        }

        if (!currentEditingTrack) return;
        
        metadataSaveBtn.disabled = true;
        metadataSaveBtn.textContent = 'Saving...';
        
            const payload = {
                relativePath: currentEditingTrack.relativePath,
                isLocal: !!currentEditingTrack.isLocal,
                metadata: {
                    title: metadataTitleInput.value.trim(),
                    artist: metadataArtistInput.value.trim(),
                    album: metadataAlbumInput.value.trim(),
                    year: metadataYearInput.value
                },
                coverArt: null // coverArt editing disabled at song level
            };

        try {
            const res = await fetch(`${serverBaseUrl}/api/update-metadata`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                editMetadataModal.classList.add('hidden');
                // Force full refresh to show new metadata/art
                await initializeMusicLibrary();
            } else {
                const err = await res.json();
                alert('Save failed: ' + err.error);
            }
        } catch (e) {
            alert('Error saving metadata: ' + e.message);
        } finally {
            metadataSaveBtn.disabled = false;
            metadataSaveBtn.textContent = 'Save Changes';
        }
    });

    metadataRestoreBtn.addEventListener('click', async () => {
        if (!currentEditingTrack || !confirm('Are you sure you want to restore the original file from backup? This will undo all edits.')) return;
        
        metadataRestoreBtn.disabled = true;
        
        try {
            const res = await fetch(`${serverBaseUrl}/api/restore-backup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    relativePath: currentEditingTrack.relativePath,
                    isLocal: !!currentEditingTrack.isLocal
                })
            });

            if (res.ok) {
                editMetadataModal.classList.add('hidden');
                await initializeMusicLibrary();
            } else {
                const err = await res.json();
                alert('Restore failed: ' + err.error);
            }
        } catch (e) {
            alert('Error restoring backup: ' + e.message);
        } finally {
            metadataRestoreBtn.disabled = false;
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && settingsView.classList.contains('active')) {
            closeSettings();
        }
    });

    // ── Settings Panel Renderer ───────────────────────────────────────────────
    function renderSettingsPanel() {
        const body = settingsView.querySelector('.settings-body');
        if (!body) return;

        const currentCustomUrl = localStorage.getItem('serverUrl') || '';
        const localPaths = getLocalMusicPaths();

        body.innerHTML = `
            <div class="settings-section">
                <div class="settings-section-title">Network</div>
                <div class="settings-row">
                    <div class="settings-row-info">
                        <div class="settings-row-label">Backend Server Address</div>
                        <div class="settings-row-sub">Override the default address (${DEFAULT_SERVER_URL}). Useful for connecting via Tailscale or a remote machine.</div>
                    </div>
                    <div class="settings-input-group">
                        <input id="server-url-input" class="settings-text-input" type="text" placeholder="${DEFAULT_SERVER_URL}" value="${currentCustomUrl}" spellcheck="false" autocomplete="off">
                        <button id="server-url-save-btn" class="settings-save-btn">Save &amp; Restart</button>
                        ${currentCustomUrl ? `<button id="server-url-reset-btn" class="settings-reset-btn">Reset to Default</button>` : ''}
                    </div>
                    ${currentCustomUrl ? `<div class="settings-active-url">Currently using: <span>${currentCustomUrl}</span></div>` : `<div class="settings-active-url">Currently using: <span>${DEFAULT_SERVER_URL} (default)</span></div>`}
                </div>
            </div>

            <div class="settings-section">
                <div class="settings-section-title">Local Music Sources</div>
                <div class="settings-row">
                    <div class="settings-row-info">
                        <div class="settings-row-label">Add Music Folder</div>
                        <div class="settings-row-sub">Point to any local folder. Its audio files are merged with your library automatically.</div>
                    </div>
                    <div class="settings-input-group">
                        <button id="local-path-add-btn" class="settings-save-btn">Add Folder</button>
                        <button id="local-rescan-btn" class="settings-reset-btn" style="margin-left: 8px;">Force Rescan Library</button>
                    </div>
                    <div id="local-path-status" class="local-path-status"></div>
                    ${localPaths.length > 0 ? `
                        <div class="local-sources-list">
                            ${localPaths.map((p, i) => `
                                <div class="local-source-item">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:0.5;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                                    <span class="local-source-path" title="${p}">${p}</span>
                                    <button class="local-source-remove-btn" data-index="${i}" title="Remove">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                    </button>
                                </div>
                            `).join('')}
                        </div>
                    ` : '<div class="local-sources-empty">No local sources added yet.</div>'}
                </div>
            </div>
        `;

        // Network section handlers
        document.getElementById('server-url-save-btn').addEventListener('click', () => {
            const val = document.getElementById('server-url-input').value.trim().replace(/\/+$/, '');
            if (val && val !== DEFAULT_SERVER_URL) localStorage.setItem('serverUrl', val);
            else localStorage.removeItem('serverUrl');
            location.reload();
        });
        const resetBtn = document.getElementById('server-url-reset-btn');
        if (resetBtn) resetBtn.addEventListener('click', () => { localStorage.removeItem('serverUrl'); location.reload(); });

        // Local sources: Add folder (Native Picker)
        document.getElementById('local-path-add-btn').addEventListener('click', async () => {
            if (!window.electronAPI) {
                alert('Folder selection is only available in the desktop app.');
                return;
            }

            const pathVal = await window.electronAPI.selectDirectory();
            if (!pathVal) return;

            const statusEl = document.getElementById('local-path-status');
            const paths = getLocalMusicPaths();
            
            if (paths.includes(pathVal)) {
                statusEl.textContent = 'This folder is already added.';
                statusEl.className = 'local-path-status error';
                return;
            }

            statusEl.textContent = 'Scanning and adding folder...';
            statusEl.className = 'local-path-status scanning';
            document.getElementById('local-path-add-btn').disabled = true;

            try {
                const res = await fetch(`${serverBaseUrl}/api/scan-directory`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: pathVal })
                });
                
                if (!res.ok) throw new Error(res.statusText);
                
                paths.push(pathVal);
                saveLocalMusicPaths(paths);
                localStorage.setItem('lastScanTime', Date.now().toString());

                statusEl.textContent = `✓ Folder Added and Scanned successfully.`;
                statusEl.className = 'local-path-status success';
                
                await initializeMusicLibrary();
                renderSettingsPanel();
            } catch (e) {
                statusEl.textContent = `Error scanning: ${e.message}`;
                statusEl.className = 'local-path-status error';
            } finally {
                document.getElementById('local-path-add-btn').disabled = false;
            }
        });

        // Force Rescan Handler
        const rescanBtn = document.getElementById('local-rescan-btn');
        if (rescanBtn) {
            rescanBtn.addEventListener('click', async () => {
                const statusEl = document.getElementById('local-path-status');
                rescanBtn.disabled = true;
                statusEl.textContent = 'Refreshing all local sources...';
                statusEl.className = 'local-path-status scanning';
                
                try {
                    await rescanLocalSources();
                    statusEl.textContent = '✓ Library rescan complete.';
                    statusEl.className = 'local-path-status success';
                } catch (e) {
                    statusEl.textContent = 'Error during rescan.';
                    statusEl.className = 'local-path-status error';
                } finally {
                    rescanBtn.disabled = false;
                }
            });
        }

        // Local sources: Remove folder
        body.querySelectorAll('.local-source-remove-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const idx = parseInt(btn.dataset.index);
                const paths = getLocalMusicPaths();
                paths.splice(idx, 1);
                saveLocalMusicPaths(paths);
                await initializeMusicLibrary();
                renderSettingsPanel();
            });
        });
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
    repeatBtn.addEventListener('click', () => {
        repeatMode = (repeatMode + 1) % 3;
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
    });

    shuffleBtn.addEventListener('click', () => {
        isShuffleActive = !isShuffleActive;
        if (isShuffleActive) {
            shuffleBtn.classList.add('toggle-active');
            if (currentPlaylistContext.length > 0) {
                unplayedIndices = currentPlaylistContext.map((_, i) => i).filter(i => i !== currentTrackIndex);
            }
        } else {
            shuffleBtn.classList.remove('toggle-active');
        }
    });

    if (bottomOfflineBtn) {
        bottomOfflineBtn.addEventListener('click', () => {
            if (!globalPlayingTrack) return;
            if (globalPlayingTrack.isLocal) {
                console.log('Local tracks are already offline.');
                return;
            }
            
            const isOffline = downloadedTracksMap.has(globalPlayingTrack.url);
            const isDownloading = pendingDownloads.has(globalPlayingTrack.url);
            
            if (!isOffline && !isDownloading) {
                initiateDownload(globalPlayingTrack);
            } else if (isOffline) {
                // Future idea: maybe clicking a downloaded song shows info or allows deletion?
                // For now, do nothing.
                console.log('Track is already available offline');
            }
        });
    }

    playPauseBtn.addEventListener('click', () => {
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

        if (window.electronAPI && globalPlayingTrack) {
            const title = (globalPlayingTrack.metadata && globalPlayingTrack.metadata.title) ? globalPlayingTrack.metadata.title : globalPlayingTrack.filename;
            const artist = (globalPlayingTrack.metadata && globalPlayingTrack.metadata.artist) ? globalPlayingTrack.metadata.artist : 'Unknown Artist';
            window.electronAPI.updatePresence({ title, artist, startTime: Date.now(), isPaused: false });
        }
    });

    audioPlayer.addEventListener('pause', () => {
        playIcon.setAttribute('d', 'M8 5v14l11-7z'); 
        
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused';
        }

        if (window.electronAPI && globalPlayingTrack) {
            const title = (globalPlayingTrack.metadata && globalPlayingTrack.metadata.title) ? globalPlayingTrack.metadata.title : globalPlayingTrack.filename;
            const artist = (globalPlayingTrack.metadata && globalPlayingTrack.metadata.artist) ? globalPlayingTrack.metadata.artist : 'Unknown Artist';
            window.electronAPI.updatePresence({ title, artist, isPaused: true });
        }
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

    function playNextTrack(isAutoEnded) {
        if (userQueue.length > 0) {
            const nextTrack = userQueue.shift();
            // Do not update currentTrackIndex so playback resumes properly.
            const title = (nextTrack.metadata && nextTrack.metadata.title) ? nextTrack.metadata.title : nextTrack.filename;
            const artist = (nextTrack.metadata && nextTrack.metadata.artist) ? nextTrack.metadata.artist : 'Unknown Artist';
            playTrack(nextTrack, title, artist);
            if (queueView && queueView.classList.contains('active')) renderQueueView();
            return;
        }

        if (currentTrackIndex === -1) return;
        
        if (isShuffleActive) {
            if (unplayedIndices.length === 0) {
                if (repeatMode === 0 && isAutoEnded) {
                    audioPlayer.pause();
                    return;
                }
                unplayedIndices = currentPlaylistContext.map((_, i) => i)
                    .filter(i => i !== currentTrackIndex && !isTrackUnsupported(currentPlaylistContext[i]));
            }
            if (unplayedIndices.length > 0) {
                const randomIndex = Math.floor(Math.random() * unplayedIndices.length);
                commitTrackChange(unplayedIndices[randomIndex]);
            }
        } else {
            const nextIdx = getNextPlayableIndex(currentTrackIndex + 1, 1, isAutoEnded);
            if (nextIdx !== -1) {
                commitTrackChange(nextIdx);
            } else {
                audioPlayer.pause();
            }
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
        playNextTrack(false);
    });

    prevBtn.addEventListener('click', () => {
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
                if (deltaX < 0) {
                    // Swipe Left -> Next
                    playNextTrack(false);
                } else {
                    // Swipe Right -> Previous
                    playPreviousTrack();
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
            playNextTrack(true);
        }
    });

    // Timing and Scrubber Logic
    function formatTime(seconds) {
        if (isNaN(seconds)) return "0:00";
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    audioPlayer.addEventListener('loadedmetadata', () => {
        totalTimeEl.textContent = formatTime(audioPlayer.duration);
    });

    audioPlayer.addEventListener('timeupdate', () => {
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

    let isDraggingScrubber = false;

    function updateScrubberVisuals(e) {
        if (!audioPlayer.duration) return;
        const rect = progressBarContainer.getBoundingClientRect();
        let clickX = e.clientX - rect.left;
        
        // bound it
        if (clickX < 0) clickX = 0;
        if (clickX > rect.width) clickX = rect.width;
        
        const percent = clickX / rect.width;
        
        // update local visuals
        progressFill.style.width = `${percent * 100}%`;
        currentTimeEl.textContent = formatTime(percent * audioPlayer.duration);
        return percent;
    }

    function isSeekingDisabled() {
        if (!globalPlayingTrack) return false;
        const url = globalPlayingTrack.url.toLowerCase();
        return url.endsWith('.m4a') || url.endsWith('.aac');
    }

    progressBarContainer.addEventListener('mousedown', (e) => {
        if (!audioPlayer.src) return;
        if (isSeekingDisabled()) return;
        isDraggingScrubber = true;
        updateScrubberVisuals(e);
    });

    progressBarContainer.addEventListener('mousemove', (e) => {
        if (!audioPlayer.duration) return;
        
        const rect = progressBarContainer.getBoundingClientRect();
        let hoverX = e.clientX - rect.left;
        
        if (hoverX < 0) hoverX = 0;
        if (hoverX > rect.width) hoverX = rect.width;
        
        const percent = hoverX / rect.width;
        
        hoverTooltip.style.left = `${percent * 100}%`;
        
        if (isSeekingDisabled()) {
            hoverTooltip.textContent = "Seeking disabled for M4A/AAC files";
        } else {
            hoverTooltip.textContent = formatTime(percent * audioPlayer.duration);
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
        
        if (audioPlayer.duration) {
            hoverTooltip.style.opacity = '1';
            hoverTooltip.style.left = `${percent * 100}%`;
            hoverTooltip.textContent = formatTime(percent * audioPlayer.duration);
        }
        
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        return percent;
    };

    progressBarContainer.addEventListener('touchstart', (e) => {
        if (!audioPlayer.src || isSeekingDisabled()) return;
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
                
                if (audioPlayer.duration) {
                    audioPlayer.currentTime = percent * audioPlayer.duration;
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
            if (audioPlayer.duration) {
                audioPlayer.currentTime = percent * audioPlayer.duration;
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
        albumView.classList.remove('active'); albumView.classList.add('hidden');
        searchView.classList.remove('active'); searchView.classList.add('hidden');
        artistView.classList.remove('active'); artistView.classList.add('hidden');
        allAlbumsView.classList.remove('active'); allAlbumsView.classList.add('hidden');
        allArtistsView.classList.remove('active'); allArtistsView.classList.add('hidden');
        if (playlistView) { playlistView.classList.remove('active'); playlistView.classList.add('hidden'); }
        
        homeView.classList.remove('hidden'); homeView.classList.add('active');
        updateMobileNavActive(mobileHomeBtn);
    }

    function switchToAllAlbumsView(push = true) {
        if (push) navigateTo('allAlbums');
        hideOverlays();
        albumView.classList.remove('active'); albumView.classList.add('hidden');
        searchView.classList.remove('active'); searchView.classList.add('hidden');
        artistView.classList.remove('active'); artistView.classList.add('hidden');
        allArtistsView.classList.remove('active'); allArtistsView.classList.add('hidden');
        homeView.classList.remove('active'); homeView.classList.add('hidden');
        
        allAlbumsView.classList.remove('hidden'); allAlbumsView.classList.add('active');
    }

    function switchToAllArtistsView(push = true) {
        if (push) navigateTo('allArtists');
        hideOverlays();
        albumView.classList.remove('active'); albumView.classList.add('hidden');
        searchView.classList.remove('active'); searchView.classList.add('hidden');
        artistView.classList.remove('active'); artistView.classList.add('hidden');
        allAlbumsView.classList.remove('active'); allAlbumsView.classList.add('hidden');
        homeView.classList.remove('active'); homeView.classList.add('hidden');
        
        allArtistsView.classList.remove('hidden'); allArtistsView.classList.add('active');
    }

    function switchToSearchView(push = true) {
        if (push) navigateTo('search', { query: searchInput.value || (mobileSearchInput ? mobileSearchInput.value : '') });
        hideOverlays();
        albumView.classList.remove('active'); albumView.classList.add('hidden');
        homeView.classList.remove('active'); homeView.classList.add('hidden');
        artistView.classList.remove('active'); artistView.classList.add('hidden');
        allAlbumsView.classList.remove('active'); allAlbumsView.classList.add('hidden');
        allArtistsView.classList.remove('active'); allArtistsView.classList.add('hidden');
        
        searchView.classList.remove('hidden'); searchView.classList.add('active');
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
        if (homeView.classList.contains('active')) updateMobileNavActive(mobileHomeBtn);
        else if (searchView.classList.contains('active')) updateMobileNavActive(mobileSearchBtn);
        else if (settingsView.classList.contains('active')) updateMobileNavActive(mobileSettingsBtn);
        else updateMobileNavActive(null);
    });

    [homeView, searchView, settingsView].forEach(view => {
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
            const res = await fetch(`${qqdlTargetUrl}/search/?s=${encodeURIComponent(query)}`);
            if (!res.ok) throw new Error('Search failed');
            const data = await res.json();
            
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

    async function initializeMusicLibrary() {
        if (!isQqdlInitialized) {
            await initCloudTarget();
        }
        
        allTracks = [];
        albumsData = {};
        
        // Render cached home sections immediately on load
        renderRecentSongs();
        renderRecentArtists();
        
        // Fetch local playlists from localstorage
        await fetchPlaylists();
    }
    // ───────────────────────────────────────────────────────────

    function processAlbums(tracks) {
        albumsData = {};
        
        tracks.forEach(track => {
            const albumName = (track.metadata && track.metadata.album) ? track.metadata.album : "Unknown Album";
            const artistName = (track.metadata && track.metadata.artist) ? track.metadata.artist : "Unknown Artist";
            const addedAt = track.addedAt || 0;
            
            if (!albumsData[albumName]) {
                albumsData[albumName] = {
                    name: albumName,
                    artist: artistName,
                    coverTrackPath: (track.metadata && track.metadata.hasCover) ? track.relativePath : null,
                    tracks: [],
                    addedAt: addedAt
                };
            } else if (addedAt > albumsData[albumName].addedAt) {
                albumsData[albumName].addedAt = addedAt;
            }
            albumsData[albumName].tracks.push(track);
        });

        renderHomeGrid();
    }

    const CARD_PLAY_BTN_HTML = `<button class="card-play-btn" title="Play">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
    </button>`;

    function createAlbumCard(albumInfo) {
        const card = document.createElement('div');
        card.className = 'album-card';
        
        let artHtml = `<div class="album-card-art"></div>`; 
        if (albumInfo.coverTrackPath) {
            const pictureUrl = `${serverBaseUrl}/api/cover?path=${encodeURIComponent(albumInfo.coverTrackPath)}`;
            artHtml = `<img src="${pictureUrl}" class="album-card-art" alt="Album Cover">`;
        }

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
        if (push) navigateTo('album', { albumInfo });
        switchToAlbumView(false);
        activeViewAlbum = albumInfo;

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
                const res = await fetch(`${qqdlTargetUrl}/album/?id=${albumInfo.albumId}`);
                if (res.ok) {
                    const data = await res.json();
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
        } else if (albumInfo.coverTrackPath) {
            const pictureUrl = `${serverBaseUrl}/api/cover?path=${encodeURIComponent(albumInfo.coverTrackPath)}`;
            coverHtml = `<img src="${pictureUrl}" class="album-hero-cover" alt="Album Cover">`;
            if (albumView) albumView.style.setProperty('--view-bg-image', `url("${pictureUrl}")`);
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
            if (globalPlayingTrack && globalPlayingTrack.url === track.url) trackItem.classList.add('active');
            
            const title = (track.metadata && track.metadata.title) ? track.metadata.title : track.filename;
            const artist = (track.metadata && track.metadata.artist) ? track.metadata.artist : 'Unknown Artist';

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
            const isUploading = pendingUploads.has(track.url);

            // 4-state indicator logic
            let indicatorClass = '';
            let indicatorTitle = '';
            if (track.isBoth) {
                indicatorClass = 'is-both';
                indicatorTitle = 'Local & Server';
            } else if (isDownloading) {
                indicatorClass = 'downloading';
                indicatorTitle = `Downloading... ${Math.round(downloadProgress * 100)}%`;
            } else if (isUploading) {
                indicatorClass = 'is-uploading';
                indicatorTitle = 'Uploading to Server...';
            } else if (track.isLocal) {
                indicatorClass = 'is-local';
                indicatorTitle = 'Local File (Click to Push to Server)';
            } else if (isDownloaded) {
                indicatorClass = 'downloaded';
                indicatorTitle = 'Available Offline (Click to remove)';
            } else {
                indicatorTitle = 'Download for Offline';
            }

            const offlineIconHtml = `
                <button class="icon-button offline-status-circle track-offline-btn ${indicatorClass}" 
                        style="--progress: ${isDownloading ? Math.round(downloadProgress * 100) : (isDownloaded || track.isLocal || track.isBoth ? 100 : 0)}%"
                        title="${indicatorTitle}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path class="check-path" d="M8 12.5l3 3 5-6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
                    </svg>
                </button>`;

            trackItem.innerHTML = `
                ${dragHandleHtml}
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
                    
                    // Rely on visual state to determine action - ensures UI and logic are 100% in sync
                    const isVisualDownloaded = statusBtn.classList.contains('downloaded') || statusBtn.classList.contains('is-local') || statusBtn.classList.contains('is-both');
                    const isVisualDownloading = statusBtn.classList.contains('downloading');

                    if (statusBtn.classList.contains('is-both')) {
                        console.log('Track is already synced.');
                    } else if (isVisualDownloaded) {
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
                     userQueue = userQueue.slice(index + 1); // Remove the clicked track and everything before it
                     const title = (clickedTrack.metadata && clickedTrack.metadata.title) ? clickedTrack.metadata.title : clickedTrack.filename;
                     const artist = (clickedTrack.metadata && clickedTrack.metadata.artist) ? clickedTrack.metadata.artist : 'Unknown Artist';
                     playTrack(clickedTrack, title, artist);
                     renderQueueView();
                     return;
                }

                // If clicking a track in the "Next From Context" queue, it skips directly to that index in the main context
                if (container === queueContextList) {
                     const clickedTrackUrl = tracks[index].url;
                     const targetIndex = currentPlaylistContext.findIndex(t => t.url === clickedTrackUrl);
                     if (targetIndex !== -1) {
                         userQueue = []; // Clear user queue if skipping ahead in normal context
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
        if (push) navigateTo('artist', { artistName });
        switchToArtistView(false);
        
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
            const searchRes = await fetch(`${qqdlTargetUrl}/search/?s=${encodeURIComponent(artistName)}`);
            if (!searchRes.ok) throw new Error('Search failed');
            const searchData = await searchRes.json();
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

            const [discRes, topTracksFromSearch] = await Promise.all([
                fetch(`${qqdlTargetUrl}/artist/?f=${artistId}&skip_tracks=true`).catch(() => null),
                Promise.resolve(searchTracks)
            ]);

            const artistTopTracks = topTracksFromSearch
                .filter(t => t.artist && t.artist.name.toLowerCase() === artistName.toLowerCase())
                .map(t => ({
                    url: `qqdl://${t.id}`,
                    localPath: '',
                    isCloud: true,
                    cloudId: t.id,
                    filename: t.title,
                    metadata: {
                        title: t.title,
                        artist: t.artist.name,
                        album: t.album ? t.album.title : 'Unknown Album',
                        duration: t.duration,
                        coverUrl: t.album ? getTidalImage(t.album.cover, '320x320') : null
                    }
                }));

            const finalAlbums = [];
            const finalSingles = [];

            if (discRes && discRes.ok) {
                const discData = await discRes.json().catch(() => ({}));
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
            }

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
                            const r = await fetch(`${qqdlTargetUrl}/album/?id=${albumInfo.albumId}`);
                            if (r.ok) {
                                const d = await r.json();
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
        lyricsTrackUrl = globalPlayingTrack ? globalPlayingTrack.url : '';
        currentLyricsTitle = title;
        currentLyricsArtist = artist;
        currentLyricsAlbum = album || '';
        currentLyricsDuration = duration || 0;
        renderLyricsActionBar(false, false);

        // 1. Check localStorage for user-created lyrics first
        if (lyricsTrackUrl) {
            const saved = localStorage.getItem(`lrc_${lyricsTrackUrl}`);
            if (saved) {
                lyricsData = parseLrc(saved);
                renderLyrics();
                renderLyricsActionBar(true, true);
                return;
            }
        }

        // 2. Try lrclib.net
        let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;
        if (album) url += `&album_name=${encodeURIComponent(album)}`;
        if (duration) url += `&duration=${Math.round(duration)}`;
        
        try {
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                if (data.syncedLyrics) {
                    lyricsData = parseLrc(data.syncedLyrics);
                    renderLyrics();
                    renderLyricsActionBar(true, false);
                } else {
                    plainLyricsCache = data.plainLyrics || '';
                    showLyricsNoSyncState();
                }
            } else {
                showLyricsNoSyncState();
            }
        } catch (err) {
            console.error('Lyrics fetch error', err);
            lyricsContainer.innerHTML = '<div class="lyrics-placeholder">Error loading lyrics.</div>';
        }
    }

    function renderLyrics() {
        lyricsContainer.innerHTML = '';
        
        lyricsData.forEach((line, index) => {
            const imEl = document.createElement('div');
            imEl.className = 'lyric-line';
            imEl.textContent = line.text;
            
            imEl.addEventListener('click', () => { audioPlayer.currentTime = line.time; });
            
            line.immersiveElement = imEl;
            
            lyricsContainer.appendChild(imEl);
        });
    }

    function updateLyricsSync() {
        if (!lyricsData.length || !audioPlayer.src) return;
        
        const currentTime = audioPlayer.currentTime;
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

    async function fetchPlaylists() {
        try {
            const raw = localStorage.getItem('personalPlaylists');
            allPlaylists = raw ? JSON.parse(raw) : [];
        } catch(e) {
            console.error('Failed to parse local playlists', e);
            allPlaylists = [];
        } finally {
            renderPlaylistsStrip();
        }
    }

    function savePlaylistsLocal() {
        localStorage.setItem('personalPlaylists', JSON.stringify(allPlaylists));
    }

    async function createPlaylist(name) {
        try {
            const newPl = { id: Date.now().toString(), name, tracks: [] };
            allPlaylists.push(newPl);
            savePlaylistsLocal();
            renderPlaylistsStrip();
            return newPl;
        } catch(e) { console.error('Failed to create playlist', e); }
        return null;
    }

    async function deletePlaylist(id) {
        allPlaylists = allPlaylists.filter(p => p.id !== id);
        savePlaylistsLocal();
        renderPlaylistsStrip();
        switchToHomeView();
    }

    async function renamePlaylist(id, name) {
        const idx = allPlaylists.findIndex(p => p.id === id);
        if (idx !== -1) {
            allPlaylists[idx].name = name;
            savePlaylistsLocal();
            renderPlaylistsStrip();
        }
    }

    async function addTrackToPlaylist(playlistId, track) {
        const pl = allPlaylists.find(p => p.id === playlistId);
        if (!pl) return;
        if (pl.tracks.find(t => t.url === track.url)) return;
        
        // Strip down the track for safe saving
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
        const pl = allPlaylists.find(p => p.id === playlistId);
        if (!pl) return;
        const newTracks = pl.tracks.filter(t => t.url !== trackUrl);
        await updatePlaylistTracks(playlistId, newTracks);
        if (rowEl) rowEl.remove();
    }

    async function updatePlaylistTracks(playlistId, tracks) {
        const idx = allPlaylists.findIndex(p => p.id === playlistId);
        if (idx !== -1) {
            allPlaylists[idx].tracks = tracks;
            savePlaylistsLocal();
            renderPlaylistsStrip();
            if (playlistView && playlistView.classList.contains('active') && activePlaylistId === playlistId) {
                openPlaylistView(allPlaylists[idx]);
            }
        }
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
        switchToPlaylistView(false);
        
        // Find first cover for background
        const firstCoverTrack = playlist.tracks.find(t => t.metadata && t.metadata.hasCover);
        if (firstCoverTrack) {
            const url = `${serverBaseUrl}/api/cover?path=${encodeURIComponent(firstCoverTrack.relativePath)}`;
            if (playlistView) playlistView.style.setProperty('--view-bg-image', `url("${url}")`);
        } else {
            if (playlistView) playlistView.style.setProperty('--view-bg-image', 'none');
        }

        const collage = buildCollageHtml(playlist);
        const totalDuration = playlist.tracks.reduce((sum, t) => sum + (t.metadata && t.metadata.duration ? t.metadata.duration : 0), 0);
        const durationStr = totalDuration > 0 ? ` · ${formatHeroDuration(Math.round(totalDuration))}` : '';

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
        titleInput.addEventListener('blur', () => {
            const newName = titleInput.value.trim();
            if (newName && newName !== playlist.name) {
                playlist.name = newName;
                renamePlaylist(playlist.id, newName);
            }
        });
        titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') titleInput.blur(); });

        // Play all
        playlistHeroDiv.querySelector('.playlist-play-btn').addEventListener('click', () => {
            if (playlist.tracks.length === 0) return;
            currentPlaylistContext = playlist.tracks;
            if (isShuffleActive) unplayedIndices = playlist.tracks.map((_, i) => i);
            commitTrackChange(0);
        });

        // Delete
        playlistHeroDiv.querySelector('.delete-playlist-btn').addEventListener('click', () => {
            if (confirm(`Delete "${playlist.name}"?`)) deletePlaylist(playlist.id);
        });

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

        renderAllArtistsGrid();
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
            const res = await fetch(`${apiUrl}/track/?id=${trackId}`);
            if (!res.ok) return null;
            const data = await res.json();
            if (!data) return null;

            // 1. Direct URL check (Fast path)
            let directUrl = data.url || (data.data && data.data.url);
            if (directUrl) return { url: directUrl, isDash: false };

            // 2. Find the manifest field
            let rawManifest = data.manifest || (data.data && data.data.manifest);
            if (!rawManifest) return null;

            // 3. Decode if it's a string (Base64), or use directly if it's an object
            let manifest;
            let isDash = (data.data && data.data.manifestMimeType === 'application/dash+xml');

            if (typeof rawManifest === 'string') {
                try {
                    const decoded = atob(rawManifest);
                    if (decoded.trim().startsWith('<?xml') || decoded.trim().startsWith('<MPD')) {
                        isDash = true;
                        manifest = decoded; // Keep XML string
                    } else {
                        manifest = JSON.parse(decoded);
                    }
                } catch (e) {
                    // Not base64 or not JSON, maybe it's just a direct URL string?
                    if (rawManifest.startsWith('http')) return { url: rawManifest, isDash: false };
                    return null;
                }
            } else {
                manifest = rawManifest; // Already a JSON object
            }

            // 4. Extract URL from manifest with fallback keys
            if (!manifest) return null;

            if (isDash) {
                // Return the raw base64 or XML for dash-player to handle later
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

    async function playTrack(track, title, artist) {
        if (window.electronAPI) {
            window.electronAPI.updatePresence({ title, artist, startTime: Date.now(), isPaused: false });
        }
        globalPlayingTrack = track;

        let fullAudioUrl = track.url;
        let isWaitingForDash = false;
        
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
            // Local track or non-qqdl cloud - ensure DASH is off
            if (dashActive) {
                await destroyDashPlayer();
                dashActive = false;
            }
        }

        const localPath = downloadedTracksMap.get(track.url);

        if (localPath) {
            if (localPath.startsWith('offline:')) {
                // DASH Offline Stream
                isWaitingForDash = true;
                dashActive = true;
                await ensureDashPlayer();
                shakaPlayerInstance.load(localPath).catch(e => {
                    console.error("DASH Offline load failed", e);
                    alert("Failed to load offline DASH track.");
                });
            } else if (window.electronAPI && !localPath.startsWith('pwa-stored')) {
                fullAudioUrl = `simon-offline://${encodeURIComponent(localPath)}`;
            } else {
                // Special URL that Service Worker will intercept for Range-Request support (PWA standard)
                fullAudioUrl = `./pwa-offline/${encodeURIComponent(track.url)}`;
            }
        }

        // Update Bottom Offline Icon
        if (bottomOfflineBtn) {
            bottomOfflineBtn.classList.toggle('downloaded', !!localPath);
            bottomOfflineBtn.classList.toggle('is-local', false);
            bottomOfflineBtn.classList.toggle('is-both', false);
            
            if (localPath) {
                bottomOfflineBtn.title = 'Available Offline';
            } else {
                bottomOfflineBtn.title = 'Cloud Stream';
            }
        }
        
        bottomTitle.textContent = title;
        bottomArtist.textContent = artist;
        
        try {
            if (artist && artist !== 'Unknown Artist') {
                let recent = JSON.parse(localStorage.getItem('recentArtists') || '[]');
                // Migrate old string-only format gracefully
                recent = recent.map(a => typeof a === 'string' ? { name: a, picture: null } : a);
                recent = recent.filter(a => a.name !== artist);
                const pictureHash = (window.artistImageHashes && window.artistImageHashes[artist]) || null;
                recent.unshift({ name: artist, picture: pictureHash });
                localStorage.setItem('recentArtists', JSON.stringify(recent.slice(0, 50)));
                renderRecentArtists();
            }
        } catch(e){}
        
        if (track.metadata && track.metadata.coverUrl) {
            const pictureUrl = track.metadata.coverUrl || '';
            bottomArtWrapper.innerHTML = `<img src="${pictureUrl}" alt="Album Art" crossorigin="anonymous">`;
            if (immersiveBg) immersiveBg.src = pictureUrl;
            if (immersiveArt) {
                 immersiveArt.src = pictureUrl;
                 immersiveArt.style.display = 'block';
            }
            // Trigger dynamic color for mobile
            updatePlayerBarDynamicColor(pictureUrl);
        } else {
            bottomArtWrapper.innerHTML = '';
            if (immersiveBg) immersiveBg.src = '';
            if (immersiveArt) immersiveArt.style.display = 'none';
            
            const playerBar = document.querySelector('.player-bar');
            if (playerBar) {
                playerBar.style.removeProperty('--player-dynamic-bg');
                playerBar.style.removeProperty('--player-dynamic-rgb');
            }
        }
        
        if (immersiveTitle) immersiveTitle.textContent = title;
        if (immersiveArtist) immersiveArtist.textContent = artist;

        const album = track.metadata && track.metadata.album ? track.metadata.album : '';
        const duration = track.metadata && track.metadata.duration ? track.metadata.duration : 0;
        fetchLyrics(title, artist, album, duration);

        updateMediaSession(track);

        if (!isWaitingForDash) {
            audioPlayer.src = fullAudioUrl;
            audioPlayer.play().catch(e => console.error("Auto-play blocked/failed", e));
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
            if (isDashForDownload) {
                if (!dashManifestData) {
                    throw new Error("Resolved DASH manifest is empty.");
                }
                await downloadDashTrack(track, dashManifestData);
            } else if (window.electronAPI) {
                if (!targetUrl) {
                    throw new Error("Download URL is undefined.");
                }
                const result = await window.electronAPI.downloadTrack({
                    url: targetUrl,
                    originalTrackingUrl: track.url, 
                    metadata: track.metadata
                });
                if (result.success) await syncOfflineState();
            } else {
                // PWA Native Download
                const response = await fetch(targetUrl);
                if (!response.ok) throw new Error('Network fetch failed');
                const blob = await response.blob();
                await saveTrackToDB(track.url, blob, track.metadata);
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

    async function initiateUpload(track) {
        // Obsolete function in standalone. Keeping to prevent ReferenceErrors from any missed UI buttons.
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
        if (globalPlayingTrack && bottomOfflineBtn) {
            const isOffline = downloadedTracksMap.has(globalPlayingTrack.url);
            const downloadProgress = pendingDownloads.get(globalPlayingTrack.url);
            
            if (isOffline) {
                bottomOfflineBtn.classList.add('downloaded');
                bottomOfflineBtn.classList.remove('downloading');
                bottomOfflineBtn.title = 'Available Offline';
                bottomOfflineBtn.style.setProperty('--progress', '100%');
            } else if (downloadProgress !== undefined) {
                bottomOfflineBtn.classList.remove('downloaded');
                bottomOfflineBtn.classList.add('downloading');
                bottomOfflineBtn.title = `Downloading... ${Math.round(downloadProgress * 100)}%`;
                bottomOfflineBtn.style.setProperty('--progress', `${downloadProgress * 100}%`);
            } else {
                bottomOfflineBtn.classList.remove('downloaded', 'downloading');
                bottomOfflineBtn.title = 'Remote Source';
                bottomOfflineBtn.style.setProperty('--progress', '0%');
            }
        }

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
            // url in progress event is the full URL, we need the track path /api/audio/...
            const trackPath = url.replace(serverBaseUrl, '');
            pendingDownloads.set(trackPath, progress);
            // Throttle UI refreshes? For now just refresh
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

    function updateAlbumHeroOfflineStatus(album) {
        const downloadAlbumBtn = albumHeroDiv.querySelector('.download-album-btn');
        if (!downloadAlbumBtn) return;
        
        const isAlbumOffline = album.tracks.every(t => downloadedTracksMap.has(t.url));
        const isAlbumDownloading = album.tracks.some(t => pendingDownloads.has(t.url));

        if (isAlbumOffline) {
            downloadAlbumBtn.classList.add('active');
            downloadAlbumBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <span>Downloaded</span>
            `;
        } else if (isAlbumDownloading) {
            downloadAlbumBtn.innerHTML = `<span>Downloading...</span>`;
        } else {
            downloadAlbumBtn.classList.remove('active');
            downloadAlbumBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                <span>Download Album</span>
            `;
        }
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
        if (!globalPlayingTrack) return;
        const artistName = (globalPlayingTrack.metadata && globalPlayingTrack.metadata.artist) ? globalPlayingTrack.metadata.artist : "Unknown Artist";
        openArtistView(artistName);
    });

    bottomTitle.addEventListener('click', () => {
        if (!globalPlayingTrack) return;
        
        const albumName = (globalPlayingTrack.metadata && globalPlayingTrack.metadata.album) ? globalPlayingTrack.metadata.album : "Unknown Album";
        const albumInfo = albumsData[albumName];
        
        if (albumInfo) {
            openAlbumView(albumInfo);
            
            // Find index of the playing track inside the newly rendered album view
            const playingIndex = albumInfo.tracks.findIndex(t => t.url === globalPlayingTrack.url);
            
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

    // ── Initial State Restoration ───────────────────────────────────────────
    try {
        await Promise.all([
            fetchPlaylists(),
            initializeMusicLibrary(),
            ensureDashPlayer().catch(e => console.warn("Background Shaka preload failed", e))
        ]);

        // Auto-rescan check (24-hour interval)
        const lastScanTime = parseInt(localStorage.getItem('lastScanTime') || '0');
        const now = Date.now();
        if (lastScanTime > 0 && (now - lastScanTime > 24 * 60 * 60 * 1000)) {
            console.log('Last scan was over 24 hours ago. Triggering automatic rescan...');
            // We run it as a floating promise so it doesn't block startup
            rescanLocalSources().catch(e => console.error('Auto-rescan failed', e));
        }

        // Always start at landing page (Home)
        switchToHomeView(false);
    } catch (err) {
        console.error("Initialization failed:", err);
        switchToHomeView(false); // fallback
    }
});
