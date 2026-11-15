const { app, BrowserWindow, ipcMain, screen, clipboard, nativeImage, shell, session, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, execFile, spawn } = require('child_process');
const { createInterface } = require('readline');
const { createHash } = require('crypto');
const { getSpotifySession, controlSpotify, setSpotifyVolume, closeSpotify } = require('./spotify');

// =====================================================
// ULTRA-LOW RAM & V8 MEMORY OPTIMIZATION FLAGS
// Prevents Chromium from spawning multiple sub-frame processes or bloating V8 heaps
// =====================================================
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');
app.commandLine.appendSwitch('renderer-process-limit', '2');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,TranslateUI,BackForwardCache,MediaRouter');
app.commandLine.appendSwitch('disable-extensions');
app.commandLine.appendSwitch('disable-pdf-extension');
app.commandLine.appendSwitch('disable-speech-api');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-default-apps');

// Store all Chromium cookies, localStorage, and SoundCloud login session permanently in userData
const isPackagedApp = app.isPackaged;
const baseDataPath = isPackagedApp
  ? path.join(app.getPath('appData'), 'dexxyqisland')
  : __dirname;

const userDataDir = path.join(baseDataPath, 'user-data');
if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}
app.setPath('userData', userDataDir);

const isSetupMode = process.argv.includes('--setup');

if (!isSetupMode) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      }
    });
  }
}

let mainWindow = null;
let soundcloudWindow = null;
const mediaWindows = {
  soundcloud: null,
  yandex: null
};
let activeMediaService = 'soundcloud';
let alwaysOnTopEnabled = true;
let isDraggingOutFile = false;
let setupWindow = null;
let isGameMode = false;
const shortcutDefaults = Object.freeze({
  home: '', stats: '', shelf: '', clipboard: '', apps: '', telegram: '',
  aot: 'Alt+T', monitor: '', game: '', autostart: '', stealth: 'Alt+X', pin: ''
});
const shortcutPath = path.join(userDataDir, 'shortcuts.json');
let shortcuts = { ...shortcutDefaults };

function registerShortcut(action, accelerator) {
  return globalShortcut.register(accelerator, () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('global-action', action, accelerator);
  });
}
let gameModeOverride = null;
let gameModeRevision = 0;
let clipIntervalId = null;
let aotKeeperIntervalId = null;

// Generous stage size so nothing is ever clipped on any DPI scaling
const STAGE_W = 800;
const STAGE_H = 310;

const shelfDir = path.join(baseDataPath, 'shelf-storage');
if (!fs.existsSync(shelfDir)) {
  fs.mkdirSync(shelfDir, { recursive: true });
}
const shelfExportDir = path.join(shelfDir, 'export');
if (!fs.existsSync(shelfExportDir)) {
  fs.mkdirSync(shelfExportDir, { recursive: true });
}

const mediaPrefsPath = path.join(shelfDir, 'media-prefs.json');
const pinnedAppsPath = path.join(shelfDir, 'pinned-apps.json');
const pinnedAppExtensions = new Set(['.exe', '.lnk']);

function isPinnedAppPath(file) {
  return typeof file === 'string' && path.isAbsolute(file) &&
    pinnedAppExtensions.has(path.extname(file).toLowerCase());
}

function readPinnedApps() {
  try {
    const files = JSON.parse(fs.readFileSync(pinnedAppsPath, 'utf8'));
    return Array.isArray(files) ? files.filter(isPinnedAppPath) : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function savePinnedApps(files) {
  const temporary = pinnedAppsPath + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(files, null, 2), 'utf8');
  fs.renameSync(temporary, pinnedAppsPath);
}

function addPinnedApps(paths) {
  const files = readPinnedApps();
  const previousLength = files.length;
  const keys = new Set(files.map(file => file.toLowerCase()));
  for (const file of paths.filter(isPinnedAppPath).map(file => path.normalize(file))) {
    try {
      if (keys.has(file.toLowerCase()) || !fs.statSync(file).isFile()) continue;
    } catch {
      continue;
    }
    files.push(file);
    keys.add(file.toLowerCase());
  }
  if (files.length !== previousLength) savePinnedApps(files);
  return files;
}

async function describePinnedApps(files) {
  return Promise.all(files.map(async file => {
    let icon = '';
    try {
      const image = await app.getFileIcon(file, { size: 'normal' });
      if (!image.isEmpty()) icon = image.toDataURL();
    } catch {}
    return { file, name: path.basename(file, path.extname(file)), icon };
  }));
}
try {
  if (fs.existsSync(mediaPrefsPath)) {
    const prefs = JSON.parse(fs.readFileSync(mediaPrefsPath, 'utf-8'));
    if (prefs && ['soundcloud', 'spotify', 'yandex'].includes(prefs.service)) {
      activeMediaService = prefs.service;
    }
    if (prefs && typeof prefs.alwaysOnTop === 'boolean') {
      alwaysOnTopEnabled = prefs.alwaysOnTop;
    }
  }
} catch (e) {}

function saveMediaPrefs() {
  try {
    fs.writeFileSync(
      mediaPrefsPath,
      JSON.stringify({ service: activeMediaService, alwaysOnTop: alwaysOnTopEnabled }, null, 2),
      'utf-8'
    );
  } catch (e) {}
}

function applyAlwaysOnTopToWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    if (alwaysOnTopEnabled) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      mainWindow.moveTop();
    } else {
      mainWindow.setAlwaysOnTop(false);
    }
  } catch (e) {}
}

function startAlwaysOnTopKeeper() {
  if (aotKeeperIntervalId) clearInterval(aotKeeperIntervalId);
  // Periodically re-assert screen-saver topmost Z-order so fullscreen games (CS2, Dota, etc.) don't push the island behind them
  aotKeeperIntervalId = setInterval(() => {
    if (!alwaysOnTopEnabled || !mainWindow || mainWindow.isDestroyed()) return;
    try {
      mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
      mainWindow.moveTop();
    } catch (e) {}
  }, 1800);
}

// Persistent Clipboard History Storage
const clipMetaPath = path.join(shelfDir, 'clipboard-history.json');
let clipboardHistory = [];
let lastClipSignature = '';

function loadClipboardHistory() {
  try {
    if (fs.existsSync(clipMetaPath)) {
      const loaded = JSON.parse(fs.readFileSync(clipMetaPath, 'utf-8')) || [];
      // Strip any legacy multi-MB fullDataUrl from RAM (full PNG is stored on disk at imgFilePath)
      clipboardHistory = loaded.map(item => {
        if (item && item.fullDataUrl && item.imgFilePath) {
          const { fullDataUrl, ...rest } = item;
          return rest;
        }
        return item;
      });
    }
  } catch (e) {
    clipboardHistory = [];
  }
}

function saveClipboardHistory() {
  try {
    fs.writeFileSync(clipMetaPath, JSON.stringify(clipboardHistory, null, 2), 'utf-8');
  } catch (e) {}
}

function getShelfItems() {
  try {
    const metaPath = path.join(shelfDir, 'shelf-meta.json');
    if (fs.existsSync(metaPath)) {
      return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    }
  } catch (e) {}
  return [];
}

function saveShelfItems(items) {
  try {
    const metaPath = path.join(shelfDir, 'shelf-meta.json');
    fs.writeFileSync(metaPath, JSON.stringify(items, null, 2), 'utf-8');
  } catch (e) {}
}

function createSetupWizardWindow(iconPath) {
  setupWindow = new BrowserWindow({
    width: 680,
    height: 480,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  setupWindow.loadFile(path.join(__dirname, 'src', 'setup.html'));
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.bounds;

  const iconPath = path.join(__dirname, 'build', 'icon.ico');
  if (isSetupMode) {
    createSetupWizardWindow(iconPath);
    return;
  }
  mainWindow = new BrowserWindow({
    width: STAGE_W,
    height: STAGE_H,
    x: Math.round((screenWidth - STAGE_W) / 2),
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: alwaysOnTopEnabled,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: true,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
      enableWebSQL: false,
      v8CacheOptions: 'none'
    }
  });

  applyAlwaysOnTopToWindow();
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    checkClipboardNow(true);
    mainWindow.webContents.send('clipboard-updated', clipboardHistory);
  });
}

const MEDIA_SERVICES = {
  soundcloud: {
    id: 'soundcloud',
    name: 'SoundCloud',
    badge: 'SOUNDCLOUD',
    partition: 'persist:soundcloud',
    url: 'https://soundcloud.com/discover',
    title: 'dexxyq — SoundCloud Connect'
  },
  spotify: { id: 'spotify', name: 'Spotify', badge: 'SPOTIFY', partition: 'persist:spotify' },
  yandex: {
    id: 'yandex',
    name: 'Яндекс Музыка',
    badge: 'Я.МУЗЫКА',
    partition: 'persist:yandex',
    url: 'https://music.yandex.ru',
    title: 'dexxyq — Яндекс Музыка'
  }
};

// =====================================================
// Spotify for Windows media session
function formatBridgeSec(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' + s : s}`;
}

let spotifyStatus = '';

async function getSpotifyMediaState() {
  const media = await getSpotifySession();
  const duration = Math.max(0, media?.duration || 0);
  const position = Math.max(0, Math.min(duration, media?.position || 0));
  return {
    service: 'spotify',
    source: 'SPOTIFY',
    title: media?.title || 'dexxyq Spotify',
    artist: spotifyStatus || media?.artist || 'Нажми Play или SP, чтобы открыть Spotify',
    isPlaying: !!media?.isPlaying,
    isShuffled: !!media?.isShuffled,
    isLiked: false,
    currentTime: formatBridgeSec(position),
    duration: formatBridgeSec(duration),
    progress: duration ? position / duration * 100 : 0
  };
}

async function openSpotify(query = '') {
  const encoded = encodeURIComponent(query);
  try {
    if (app.getApplicationNameForProtocol('spotify:')) {
      await shell.openExternal(query ? 'spotify:search:' + encoded : 'spotify:');
      return;
    }
  } catch {}
  await shell.openExternal(query ? 'https://open.spotify.com/search/' + encoded : 'https://open.spotify.com');
}

let spotifyWindowCommandPending = false;

async function spotifyAction(action, value) {
  if (action === 'setVolume') {
    setSpotifyVolume(value);
    return;
  }
  spotifyStatus = '';
  const query = typeof value === 'string' ? value.trim() : '';
  try {
    if (action === 'openWindow') {
      if (spotifyWindowCommandPending) return;
      spotifyWindowCommandPending = true;
      try {
        if (!(await closeSpotify())) await openSpotify();
      } finally {
        spotifyWindowCommandPending = false;
      }
    } else if (action === 'searchAndPlay' && query) {
      await openSpotify(query);
    } else if (['playPause', 'next', 'prev', 'shuffle', 'randomTrack'].includes(action)) {
      const result = await controlSpotify(action);
      if (result === null) {
        if (['playPause', 'shuffle', 'randomTrack'].includes(action)) await openSpotify();
        spotifyStatus = 'Выбери трек в Spotify';
      } else if (!result) {
        spotifyStatus = ['shuffle', 'randomTrack'].includes(action)
          ? 'Перемешивание недоступно для этой очереди Spotify'
          : 'Spotify не выполнил эту команду';
      }
    }
  } catch (error) {
    spotifyStatus = 'Не удалось подключиться к Spotify для Windows';
    console.warn('Spotify action failed:', action, error.code || error.name);
  }
}

// Destroy all inactive media windows immediately so at most ONE media player is ever loaded in RAM!
async function destroyOtherMediaWorkers(exceptService) {
  for (const [srv, win] of Object.entries(mediaWindows)) {
    if (srv !== exceptService && win && !win.isDestroyed()) {
      try {
        const cfg = MEDIA_SERVICES[srv];
        const pSess = session.fromPartition(cfg.partition);
        await pSess.cookies.flushStore().catch(() => {});
        pSess.flushStorageData();
      } catch (e) {}
      try {
        win.destroy();
      } catch (e) {}
      mediaWindows[srv] = null;
    }
  }
}

function ensureMediaWorker(serviceId = activeMediaService) {
  const srv = MEDIA_SERVICES[serviceId] ? serviceId : 'soundcloud';
  const cfg = MEDIA_SERVICES[srv];

  // Immediately free RAM from any other music player before opening/using this one!
  destroyOtherMediaWorkers(srv);

  if (mediaWindows[srv] && !mediaWindows[srv].isDestroyed()) {
    soundcloudWindow = mediaWindows[srv];
    return mediaWindows[srv];
  }

  const pSession = session.fromPartition(cfg.partition, { cache: true });
  const iconPath = path.join(__dirname, 'build', 'icon.ico');

  const win = new BrowserWindow({
    width: 520,
    height: 680,
    show: false,
    frame: true,
    title: cfg.title,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'sc-preload.js'),
      nodeIntegration: false,
      contextIsolation: false,
      partition: cfg.partition,
      session: pSession,
      spellcheck: false,
      enableWebSQL: false,
      backgroundThrottling: false
    }
  });

  // Keep the user agent consistent for the embedded music players.
  const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  win.webContents.setUserAgent(chromeUA);

  // Keep hidden media windows at 15 FPS so player transitions continue.
  win.webContents.setFrameRate(15);

  win.on('show', () => {
    try { win.webContents.setFrameRate(30); } catch (e) {}
  });

  win.on('hide', () => {
    try {
      win.webContents.setFrameRate(15);
    } catch (e) {}
  });

  pSession.cookies.on('changed', () => {
    pSession.cookies.flushStore().catch(() => {});
  });

  win.webContents.on('did-navigate', () => {
    pSession.cookies.flushStore().catch(() => {});
    pSession.flushStorageData();
  });

  win.loadURL(cfg.url);

  win.on('close', (e) => {
    pSession.cookies.flushStore().catch(() => {});
    pSession.flushStorageData();
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  mediaWindows[srv] = win;
  soundcloudWindow = win;
  return win;
}

let cachedDesktopTrack = { yandex: null, lastCheck: 0 };
function refreshDesktopPlayersCache() {
  const now = Date.now();
  if (now - cachedDesktopTrack.lastCheck < 6000) return;
  cachedDesktopTrack.lastCheck = now;

  exec('tasklist /V /FO CSV /NH /FI "STATUS eq RUNNING"', { windowsHide: true, maxBuffer: 512 * 1024 }, (err, stdout) => {
    cachedDesktopTrack.yandex = null;
    if (err || !stdout) return;
    try {
      const lines = stdout.split(/\r?\n/);
      for (const line of lines) {
        const lower = line.toLowerCase();
        if (!lower.includes('яндекс') && !lower.includes('yandex')) continue;
        // Last column in tasklist /V CSV is Window Title
        const cols = line.split('","');
        if (cols.length < 9) continue;
        const wTitle = cols[cols.length - 1].replace(/^"|"$|/g, '').trim();
        if (!wTitle || wTitle === 'N/A' || wTitle === 'Н/Д') continue;

        if (!['яндекс музыка', 'yandex music'].includes(wTitle.toLowerCase())) {
          const parts = wTitle.split(/\s+[—\-]\s+/);
          cachedDesktopTrack.yandex = {
            title: parts[0].trim(),
            artist: parts[1] ? parts[1].trim() : 'Яндекс Музыка (ПК)',
            isPlaying: true
          };
        }
      }
    } catch (e) {}
  });
}

async function getMediaState(serviceId = activeMediaService) {
  const srv = MEDIA_SERVICES[serviceId] ? serviceId : 'soundcloud';
  const cfg = MEDIA_SERVICES[srv];
  const win = mediaWindows[srv];

  if (srv === 'spotify') return getSpotifyMediaState();
  if (srv === 'yandex') refreshDesktopPlayersCache();

  if (!win || win.isDestroyed()) {
    // Check if desktop app has a track playing even before web window is opened
    const desk = cachedDesktopTrack[srv];
    if (desk) {
      return {
        service: srv,
        source: cfg.badge,
        isPlaying: true,
        isShuffled: false,
        isLiked: false,
        title: desk.title,
        artist: desk.artist,
        artwork: '',
        currentTime: 'LIVE',
        duration: 'ПК',
        progress: 50
      };
    }
    return {
      service: srv,
      source: cfg.badge,
      isPlaying: false,
      isShuffled: false,
      isLiked: false,
      title: `dexxyq ${cfg.name}`,
      artist: `Введи трек в поиск или открой ${cfg.name}`,
      artwork: '',
      currentTime: '0:00',
      duration: '0:00',
      progress: 0
    };
  }

  try {
    let webState = null;

    if (srv === 'soundcloud') {
      webState = await win.webContents.executeJavaScript(`
        (() => {
          const uni = typeof window.__dexxyqGetUniversalMedia === 'function' ? window.__dexxyqGetUniversalMedia() : {};
          const playBtn = document.querySelector('.playControl');
          const isPlaying = playBtn ? playBtn.classList.contains('playing') : !!uni.isPlaying;
          const shuffleBtn = document.querySelector('.shuffleControl');
          const isShuffled = shuffleBtn ? shuffleBtn.classList.contains('m-shuffling') : false;
          const likeBtn = document.querySelector('.playbackSoundBadge__like');
          const isLiked = likeBtn ? likeBtn.classList.contains('sc-button-selected') : false;
          const titleEl = document.querySelector('.playbackSoundBadge__titleLink');
          const artistEl = document.querySelector('.playbackSoundBadge__lightLink');
          const artEl = document.querySelector('.playbackSoundBadge__avatar span.sc-artwork');
          const passedEl = document.querySelector('.playbackTimeline__timePassed span:last-child');
          const durationEl = document.querySelector('.playbackTimeline__duration span:last-child');
          const progressEl = document.querySelector('.playbackTimeline__progressBar');

          let artwork = '';
          if (artEl && artEl.style && artEl.style.backgroundImage) {
            artwork = artEl.style.backgroundImage
              .replace(/^url\\(["']?/, '')
              .replace(/["']?\\)$/, '')
              .replace('t50x50', 't500x500')
              .replace('t120x120', 't500x500');
          }
          if (!artwork && uni.artwork) artwork = uni.artwork;

          return {
            service: 'soundcloud',
            source: 'SOUNDCLOUD',
            isPlaying,
            isShuffled,
            isLiked,
            title: titleEl ? (titleEl.getAttribute('title') || titleEl.innerText.trim()) : (uni.title || 'dexxyq SoundCloud'),
            artist: artistEl ? (artistEl.getAttribute('title') || artistEl.innerText.trim()) : (uni.artist || 'Введи трек в поиск ниже и нажми Enter'),
            artwork,
            currentTime: passedEl ? passedEl.innerText.trim() : (uni.currentTime || '0:00'),
            duration: durationEl ? durationEl.innerText.trim() : (uni.duration || '0:00'),
            progress: (progressEl && progressEl.style && progressEl.style.width) ? (parseFloat(progressEl.style.width) || 0) : (uni.progress || 0)
          };
        })();
      `);
    } else if (srv === 'yandex') {
      webState = await win.webContents.executeJavaScript(`
        (() => {
          const uni = typeof window.__dexxyqGetUniversalMedia === 'function' ? window.__dexxyqGetUniversalMedia() : {};
          const titleEl = document.querySelector('.track__title, [class*="PlayerBar"] [class*="Meta_title"], [class*="PlayerBarDesktop"] [class*="Meta_title"]');
          const artistEl = document.querySelector('.track__artists, [class*="PlayerBar"] [class*="Meta_artistCaption"], [class*="PlayerBarDesktop"] [class*="Meta_artists"]');
          const artEl = document.querySelector('.entity-cover__image, [class*="PlayerBar"] img[src*="avatars.yandex"], [class*="PlayerBarDesktop"] img');
          const playBtnClassic = document.querySelector('.player-controls__btn_play');
          const pauseBtnNext = document.querySelector('[class*="SonataControls"] button[data-test-id*="PAUSE"], [class*="PlayerBar"] button[aria-label*="Пауза"], [class*="PlayerBar"] button[aria-label*="Pause"]');
          const shuffleBtn = document.querySelector('.player-controls__btn_shuffle, [class*="SonataControls"] button[data-test-id*="SHUFFLE"]');
          const likeBtn = document.querySelector('.player-controls .d-like_on, [class*="PlayerBar"] button[data-test-id*="LIKE"][aria-pressed="true"]');
          const passedEl = document.querySelector('.progress__left, [class*="ChangeTimecode_timecode"]:first-child');
          const durationEl = document.querySelector('.progress__right, [class*="ChangeTimecode_timecode"]:last-child');

          const isPlaying =
            Boolean(playBtnClassic && playBtnClassic.classList.contains('player-controls__btn_pause')) ||
            Boolean(pauseBtnNext) ||
            !!uni.isPlaying;

          const isShuffled = shuffleBtn
            ? (shuffleBtn.classList.contains('player-controls__btn_shuffle-on') || shuffleBtn.getAttribute('aria-pressed') === 'true')
            : false;

          let artwork = '';
          if (artEl) {
            if (artEl.src) artwork = artEl.src;
            else if (artEl.style && artEl.style.backgroundImage) {
              artwork = artEl.style.backgroundImage.replace(/^url\\(["']?/, '').replace(/["']?\\)$/, '');
            }
          }
          if (artwork && artwork.startsWith('//')) artwork = 'https:' + artwork;
          if (!artwork && uni.artwork) artwork = uni.artwork;

          const curText = passedEl ? passedEl.innerText.trim() : (uni.currentTime || '0:00');
          const durText = durationEl ? durationEl.innerText.trim() : (uni.duration || '0:00');

          function parseSec(str) {
            if (!str) return 0;
            const p = str.replace('-', '').split(':').map(Number);
            if (p.length === 2) return p[0] * 60 + p[1];
            return 0;
          }
          const cSec = parseSec(curText);
          const dSec = parseSec(durText);
          const progress = dSec > 0 ? Math.min(100, (cSec / dSec) * 100) : (uni.progress || 0);

          return {
            service: 'yandex',
            source: 'Я.МУЗЫКА',
            isPlaying,
            isShuffled,
            isLiked: !!likeBtn,
            title: (titleEl && titleEl.innerText.trim()) || uni.title || 'dexxyq Яндекс Музыка',
            artist: (artistEl && artistEl.innerText.trim()) || uni.artist || 'Введи трек в поиск или открой окно ЯМ',
            artwork,
            currentTime: curText,
            duration: durText,
            progress
          };
        })();
      `);
    }

    // If web player isn't playing a track yet, fall back to Desktop App state if running!
    const desk = cachedDesktopTrack[srv];
    if (webState && !webState.isPlaying && desk && desk.title) {
      return {
        ...webState,
        isPlaying: true,
        title: desk.title,
        artist: desk.artist,
        currentTime: 'LIVE',
        duration: 'ПК',
        progress: 50
      };
    }

    return webState;
  } catch (err) {
    return null;
  }
}

async function pauseOtherMediaWorkers(exceptService) {
  await destroyOtherMediaWorkers(exceptService);
}

async function mediaServiceAction(serviceId, action, value) {
  const srv = MEDIA_SERVICES[serviceId] ? serviceId : activeMediaService;

  if (srv === 'spotify') return spotifyAction(action, value);

  if (action === 'unloadWindow') {
    await destroyOtherMediaWorkers('__none__');
    return;
  }

  const desk = cachedDesktopTrack[srv];

  // Don't spawn a heavy hidden browser window just for volume slider changes if no player is open yet!
  if (action === 'setVolume' && (!mediaWindows[srv] || mediaWindows[srv].isDestroyed())) {
    return;
  }

  // If desktop Yandex is actively playing and no web window is open yet, handle play/pause/next/prev with 0 MB RAM via media keys!
  if (desk && (!mediaWindows[srv] || mediaWindows[srv].isDestroyed()) && ['playPause', 'next', 'prev'].includes(action)) {
    if (action === 'playPause') sendWindowsMediaKey(179);
    if (action === 'next') sendWindowsMediaKey(176);
    if (action === 'prev') sendWindowsMediaKey(177);
    return;
  }

  const win = ensureMediaWorker(srv);

  try {
    if (action === 'setVolume') {
      const vol = Math.max(0, Math.min(100, Number(value) || 0));
      win.webContents.setAudioMuted(vol === 0);
      await win.webContents.executeJavaScript(`
        (() => {
          const v = ${vol / 100};
          if (typeof window.__dexxyqApplyMediaVolume === 'function') {
            window.__dexxyqApplyMediaVolume(v);
          }
          try {
            localStorage.setItem('V2::local::volume', JSON.stringify({ volume: v, muted: v === 0 }));
          } catch (e) {}
        })();
      `);
      return;
    }

    if (action === 'openWindow') {
      if (win.isVisible()) {
        win.focus();
      } else {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: sw } = primaryDisplay.bounds;
        win.setPosition(Math.round((sw - 520) / 2), 280);
        win.show();
        win.focus();
      }
      return;
    }

    // Prevent rapid-click spam from overlapping simultaneous skip transitions inside the web player
    if (action === 'next' || action === 'prev') {
      const now = Date.now();
      if (win.__lastSkipAt && now - win.__lastSkipAt < 240) {
        return;
      }
      win.__lastSkipAt = now;
    }

    if (srv === 'soundcloud') {
      if (action === 'playPause') {
        await pauseOtherMediaWorkers('soundcloud');
        await win.webContents.executeJavaScript(`
          (() => {
            if (typeof window.__dexxyqResumeAllAudio === 'function') window.__dexxyqResumeAllAudio();
            const btn = document.querySelector('.playControl');
            if (btn) btn.click();
            else {
              const firstPlay = document.querySelector('.sc-button-play');
              if (firstPlay) firstPlay.click();
            }
          })();
        `);
      } else if (action === 'next') {
        await win.webContents.executeJavaScript(`
          (() => {
            if (typeof window.__dexxyqResumeAllAudio === 'function') window.__dexxyqResumeAllAudio();
            const titleEl = document.querySelector('.playbackSoundBadge__titleLink');
            const prevTitle = titleEl ? (titleEl.getAttribute('title') || titleEl.innerText.trim()) : '';
            const btn = document.querySelector('.skipControl__next');
            if (btn && !btn.disabled && !btn.classList.contains('disabled')) {
              btn.click();
            }
            // If SoundCloud queue reached the end or got stuck on the same track after 380ms, pick the next playable track on page!
            if (window.__scNextFallbackTimer) clearTimeout(window.__scNextFallbackTimer);
            window.__scNextFallbackTimer = setTimeout(() => {
              if (typeof window.__dexxyqResumeAllAudio === 'function') window.__dexxyqResumeAllAudio();
              const newTitleEl = document.querySelector('.playbackSoundBadge__titleLink');
              const newTitle = newTitleEl ? (newTitleEl.getAttribute('title') || newTitleEl.innerText.trim()) : '';
              const playBtn = document.querySelector('.playControl');
              const isPlaying = playBtn && playBtn.classList.contains('playing');

              if (newTitle === prevTitle) {
                // Queue ended or skip button didn't advance -> pick another playable track button on the page!
                const candidates = Array.from(document.querySelectorAll('.sc-button-play:not(.sc-button-pause)'));
                if (candidates.length > 0) {
                  const pick = candidates[Math.floor(Math.random() * candidates.length)];
                  pick.click();
                } else if (playBtn && !isPlaying) {
                  playBtn.click();
                }
              } else if (playBtn && !isPlaying) {
                playBtn.click();
              }
            }, 380);
          })();
        `);
      } else if (action === 'prev') {
        await win.webContents.executeJavaScript(`
          (() => {
            if (typeof window.__dexxyqResumeAllAudio === 'function') window.__dexxyqResumeAllAudio();
            const btn = document.querySelector('.skipControl__previous');
            if (btn) btn.click();
          })();
        `);
      } else if (action === 'like') {
        await win.webContents.executeJavaScript(`
          (() => {
            const btn = document.querySelector('.playbackSoundBadge__like');
            if (btn) btn.click();
          })();
        `);
      } else if (action === 'shuffle') {
        await win.webContents.executeJavaScript(`
          (() => {
            const shuffleBtn = document.querySelector('.shuffleControl');
            if (shuffleBtn) {
              shuffleBtn.click();
              const playBtn = document.querySelector('.playControl');
              const isPlaying = playBtn ? playBtn.classList.contains('playing') : false;
              if (!isPlaying) {
                const allPlayBtns = Array.from(document.querySelectorAll('.sc-button-play'));
                if (allPlayBtns.length > 0) {
                  const rand = allPlayBtns[Math.floor(Math.random() * allPlayBtns.length)];
                  rand.click();
                } else if (playBtn) {
                  playBtn.click();
                }
              }
            }
          })();
        `);
      } else if (action === 'randomTrack') {
        await win.webContents.executeJavaScript(`
          (() => {
            const shuffleBtn = document.querySelector('.shuffleControl');
            if (shuffleBtn && !shuffleBtn.classList.contains('m-shuffling')) {
              shuffleBtn.click();
            }
            const allPlayBtns = Array.from(document.querySelectorAll('.sc-button-play:not(.sc-button-pause)'));
            if (allPlayBtns.length > 1) {
              const rand = allPlayBtns[Math.floor(Math.random() * allPlayBtns.length)];
              rand.click();
            } else {
              const nextBtn = document.querySelector('.skipControl__next');
              if (nextBtn) nextBtn.click();
            }
          })();
        `);
      } else if (action === 'searchAndPlay' && value) {
        await pauseOtherMediaWorkers('soundcloud');
        const encoded = encodeURIComponent(value);
        await win.loadURL('https://soundcloud.com/search/sounds?q=' + encoded);
        setTimeout(async () => {
          try {
            await win.webContents.executeJavaScript(`
              setTimeout(() => {
                const firstPlay = document.querySelector('.searchItem .sc-button-play, .soundList__item .sc-button-play, .sc-button-play');
                if (firstPlay) firstPlay.click();
              }, 1500);
            `);
          } catch (e) {}
        }, 1200);
      }
    } else if (srv === 'yandex') {
      if (action === 'playPause') {
        await pauseOtherMediaWorkers('yandex');
        const clickedWeb = await win.webContents.executeJavaScript(`
          (() => {
            const btn = document.querySelector(
              '.player-controls__btn_play, [class*="SonataControls"] button[data-test-id*="PLAY"], [class*="SonataControls"] button[data-test-id*="PAUSE"], [class*="PlayerBar"] button[aria-label*="Пауза"], [class*="PlayerBar"] button[aria-label*="Воспроизведение"], .button-play'
            );
            if (btn) { btn.click(); return true; }
            return false;
          })();
        `);
        if (!clickedWeb || desk) sendWindowsMediaKey(179);
      } else if (action === 'next') {
        const clickedWeb = await win.webContents.executeJavaScript(`
          (() => {
            const btn = document.querySelector('.player-controls__btn_next, [class*="SonataControls"] button[data-test-id*="NEXT"], [class*="PlayerBar"] button[aria-label*="Следующий"]');
            if (btn) { btn.click(); return true; }
            return window.__dexxyqTriggerMediaAction && window.__dexxyqTriggerMediaAction('nexttrack');
          })();
        `);
        if (!clickedWeb || desk) sendWindowsMediaKey(176);
      } else if (action === 'prev') {
        const clickedWeb = await win.webContents.executeJavaScript(`
          (() => {
            const btn = document.querySelector('.player-controls__btn_prev, [class*="SonataControls"] button[data-test-id*="PREV"], [class*="PlayerBar"] button[aria-label*="Предыдущий"]');
            if (btn) { btn.click(); return true; }
            return window.__dexxyqTriggerMediaAction && window.__dexxyqTriggerMediaAction('previoustrack');
          })();
        `);
        if (!clickedWeb || desk) sendWindowsMediaKey(177);
      } else if (action === 'shuffle' || action === 'randomTrack') {
        await win.webContents.executeJavaScript(`
          (() => {
            const btn = document.querySelector('.player-controls__btn_shuffle, [class*="SonataControls"] button[data-test-id*="SHUFFLE"], [class*="PlayerBar"] button[aria-label*="случайном"]');
            if (btn) btn.click();
          })();
        `);
      } else if (action === 'like') {
        await win.webContents.executeJavaScript(`
          (() => {
            const btn = document.querySelector('.player-controls .d-like, [class*="PlayerBar"] button[data-test-id*="LIKE"], [class*="PlayerBar"] button[aria-label*="Нравится"]');
            if (btn) btn.click();
          })();
        `);
      } else if (action === 'searchAndPlay' && value) {
        await pauseOtherMediaWorkers('yandex');
        const encoded = encodeURIComponent(value);
        await win.loadURL('https://music.yandex.ru/search?text=' + encoded);
        setTimeout(async () => {
          try {
            await win.webContents.executeJavaScript(`
              setTimeout(() => {
                const firstPlay = document.querySelector('.d-track .button-play, [class*="Track"] button[aria-label*="Воспроизведение"], .button-play');
                if (firstPlay) firstPlay.click();
              }, 1800);
            `);
          } catch (e) {}
        }, 1400);
      }
    }
  } catch (e) {}
}

let prevCpuTimes = null;
let currentCpuUsage = 8;
const rawCpuModel = (os.cpus()[0]?.model || 'CPU')
  .replace(/\(R\)|\(TM\)|Processor|\d+-Core|AMD |Intel /gi, '')
  .replace(/\s+/g, ' ')
  .trim();
const cachedCpuName = `${rawCpuModel} (${os.cpus().length} п.)`;

function sampleCpuTick() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (let i = 0; i < cpus.length; i++) {
    const t = cpus[i].times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.irq + t.idle;
  }
  if (!prevCpuTimes) {
    prevCpuTimes = { idle, total };
    return;
  }
  const idleDiff = idle - prevCpuTimes.idle;
  const totalDiff = total - prevCpuTimes.total;
  if (totalDiff < 200) return; // Never compute over tiny intervals
  prevCpuTimes = { idle, total };
  const basePct = 100 - (100 * idleDiff) / totalDiff;
  currentCpuUsage = Math.max(1, Math.min(100, Math.round(basePct)));
}

let cachedGpuName = 'GPU';
let cachedGpuUsage = 4;
let cachedGpuTemp = 0;
let cachedGpuVramUsed = '';
let cachedGpuVramTotal = '';
let nvStreamProc = null;
let gpuStreamUnavailable = false;
let statsView = 'cpu';
let lastCpuSampleAt = 0;
let hardwareTimer = null;
let lastDiskSampleAt = 0;
let lastNetSampleAt = 0;

let cachedNetDownKBs = 0;
let cachedNetUpKBs = 0;
let prevNetRx = 0;
let prevNetTx = 0;
let prevNetAt = 0;
let isSamplingNet = false;

let cachedDisk = { usage: 50, usedGB: 0, totalGB: 0, label: 'C:', drives: [] };
let cachedBattery = { hasBattery: false, percent: 100, isCharging: true, secondaryDiskLabel: '' };

function refreshNativeDiskStats() {
  try {
    const drives = [];
    for (const letter of ['C', 'D', 'E', 'F']) {
      try {
        const s = fs.statfsSync(`${letter}:\\`);
        const total = s.blocks * s.bsize;
        const free = s.bfree * s.bsize;
        if (total > 1024 * 1024 * 100) {
          const used = total - free;
          drives.push({
            letter,
            usage: Math.round((used / total) * 100),
            usedGB: Math.round(used / (1024 ** 3)),
            totalGB: Math.round(total / (1024 ** 3))
          });
        }
      } catch (e) {}
    }
    if (drives.length > 0) {
      const primary = drives[0];
      cachedDisk = {
        usage: primary.usage,
        usedGB: primary.usedGB,
        totalGB: primary.totalGB,
        label: `${primary.letter}:`,
        drives
      };
      if (drives.length > 1) {
        const sec = drives[1];
        cachedBattery.secondaryDiskLabel = `💾 ${sec.letter}: ${sec.usedGB}/${sec.totalGB} ГБ (${sec.usage}%)`;
      }
    }
  } catch (e) {}
}

function sampleNetworkSpeed() {
  if (isSamplingNet) return;
  isSamplingNet = true;
  execFile('netstat.exe', ['-e'], { windowsHide: true, timeout: 4000 }, (err, stdout) => {
    isSamplingNet = false;
    if (err || !stdout || statsView !== 'full') return;
    for (const line of stdout.split(/\r?\n/)) {
      const nums = line.trim().match(/(\d+)\s+(\d+)$/);
      if (nums) {
        const rx = Number(nums[1]);
        const tx = Number(nums[2]);
        const now = Date.now();
        if (prevNetAt > 0 && now > prevNetAt) {
          const dtSec = (now - prevNetAt) / 1000;
          cachedNetDownKBs = Math.max(0, Math.round((rx - prevNetRx) / dtSec / 1024));
          cachedNetUpKBs = Math.max(0, Math.round((tx - prevNetTx) / dtSec / 1024));
        }
        prevNetRx = rx;
        prevNetTx = tx;
        prevNetAt = now;
        break;
      }
    }
  });
}

function sampleVisibleHardware() {
  const now = Date.now();
  if (now - lastCpuSampleAt >= 1500) {
    sampleCpuTick();
    lastCpuSampleAt = now;
  }
  if (statsView !== 'full') return;
  if (now - lastDiskSampleAt >= 15000) {
    refreshNativeDiskStats();
    lastDiskSampleAt = now;
  }
  if (!isSamplingNet && now - lastNetSampleAt >= 2100) {
    lastNetSampleAt = now;
    sampleNetworkSpeed();
  }
}

function setStatsView(view) {
  if (view === statsView && hardwareTimer) return;
  const previousView = statsView;
  statsView = view;
  clearInterval(hardwareTimer);
  hardwareTimer = null;
  if (previousView === 'full' && view !== 'full') {
    prevNetAt = 0;
    lastNetSampleAt = 0;
  }
  if (view !== 'hidden') {
    sampleVisibleHardware();
    hardwareTimer = setInterval(sampleVisibleHardware, view === 'full' ? 750 : 2000);
  }
  updateGpuProbe();
}

function updateGpuProbe() {
  if (statsView !== 'full' && statsView !== 'compact') {
    if (nvStreamProc && !nvStreamProc.killed) nvStreamProc.kill();
    return;
  }
  if (nvStreamProc || gpuStreamUnavailable) return;

  const sysNvPath = 'C:\\Windows\\System32\\nvidia-smi.exe';
  const nvBin = fs.existsSync(sysNvPath) ? sysNvPath : 'nvidia-smi';
  const probe = spawn(nvBin, [
    '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu',
    '--format=csv,noheader,nounits',
    '-l', '2'
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  nvStreamProc = probe;

  createInterface({ input: probe.stdout, crlfDelay: Infinity }).on('line', (line) => {
    if (!line) return;
    const parts = line.split(',').map(s => s.trim());
    if (parts.length >= 2) {
      const shortGpu = parts[0]
        .replace(/NVIDIA |GeForce |AMD |Radeon /gi, '')
        .trim();
      const util = Number(parts[1]);
      const memUsedMB = Number(parts[2]) || 0;
      const memTotalMB = Number(parts[3]) || 0;
      const tempC = Math.round(Number(parts[4]) || 0);

      if (!Number.isNaN(util)) {
        cachedGpuUsage = Math.max(0, Math.min(100, Math.round(util)));
      }
      cachedGpuTemp = tempC;
      if (memTotalMB > 0) {
        cachedGpuVramUsed = (memUsedMB / 1024).toFixed(1);
        cachedGpuVramTotal = Math.round(memTotalMB / 1024);
        cachedGpuName = `${shortGpu} • ${tempC}°C (${cachedGpuVramUsed}/${cachedGpuVramTotal} ГБ)`;
      } else {
        cachedGpuName = tempC > 0 ? `${shortGpu} • ${tempC}°C` : shortGpu;
      }
    }
  });

  probe.on('error', () => {});
  probe.on('close', () => {
    if (nvStreamProc !== probe) return;
    nvStreamProc = null;
    if (app.isQuitting) return;
    if (!probe.killed) {
      gpuStreamUnavailable = true;
      startFallbackGpuProbe();
    } else {
      updateGpuProbe();
    }
  });
}

function startFallbackGpuProbe() {
  // Fallback for AMD / Intel GPUs without nvidia-smi
  exec('powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController | Select-Object -First 1).Name"', { windowsHide: true }, (err, stdout) => {
    if (!err && stdout && stdout.trim()) {
      cachedGpuName = stdout.trim().replace(/NVIDIA |GeForce |AMD |Radeon |Intel\(R\) /gi, '').trim();
    }
  });
}

function installationFileHash(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    // Read app.asar itself as a regular file, without Electron's archive mapping.
    const stream = require('original-fs').createReadStream(file);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function copyInstallation(source, target) {
  const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const stopPrevious = `
    $ErrorActionPreference = 'Stop'
    $target = $env:DEXXYQ_UPDATE_TARGET
    $running = Get-Process -Name dexxyqisland -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -eq $target }
    foreach ($process in $running) {
      try {
        if (!$process.HasExited) { $process.Kill() }
      } catch {
        if (!$process.HasExited) { throw }
      }
      if (!$process.WaitForExit(5000)) { throw 'Previous instance is still running.' }
    }
  `;
  await new Promise((resolve, reject) => {
    const powershell = path.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const encoded = Buffer.from(stopPrevious, 'utf16le').toString('base64');
    const env = { ...process.env, DEXXYQ_UPDATE_TARGET: path.resolve(target, 'dexxyqisland.exe') };
    execFile(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { env, windowsHide: true, timeout: 15000 }, (error) => {
        if (error) reject(new Error('Не удалось закрыть запущенный DexxyqIsland. Закрой его и повтори установку.'));
        else resolve();
      });
  });

  await new Promise((resolve, reject) => {
    const args = [source, target, '/E', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS'];
    execFile(path.join(system32, 'robocopy.exe'), args, { windowsHide: true }, (error) => {
      if (!error || (Number.isInteger(error.code) && error.code > 0 && error.code < 8)) resolve();
      else reject(new Error(`Не удалось скопировать файлы приложения. Код Robocopy: ${error.code || '—'}.`));
    });
  });

  for (const file of ['dexxyqisland.exe', path.join('resources', 'app.asar')]) {
    const [expected, actual] = await Promise.all([
      installationFileHash(path.join(source, file)),
      installationFileHash(path.join(target, file))
    ]);
    if (actual !== expected) throw new Error(`Файл ${file} не обновился. Повтори установку.`);
  }
}

function sendWindowsMediaKey(keyCode) {
  const cmd = `powershell -NoProfile -Command "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys([char]${keyCode})"`;
  exec(cmd);
}

// Zero-Allocation Universal Clipboard Scanner:
// Checks raw bitmap signature in 0.05ms BEFORE encoding PNG/DataURL so idle RAM/CPU is 0!
async function checkClipboardNow(forceBroadcast = false) {
  try {
    // 1. Fast check for Image / Screenshot
    if (typeof clipboard.readImage === 'function') {
      const maybeImg = await Promise.resolve(clipboard.readImage());
      if (maybeImg && typeof maybeImg.isEmpty === 'function' && !maybeImg.isEmpty()) {
        const sz = maybeImg.getSize();
        const bmp = maybeImg.getBitmap();
        if (bmp && bmp.length > 0 && sz.width > 0 && sz.height > 0) {
          const q1 = Math.floor(bmp.length * 0.25);
          const mid = Math.floor(bmp.length * 0.5);
          const q3 = Math.floor(bmp.length * 0.75);
          const fastSig = `img:${sz.width}x${sz.height}:${bmp.length}:${bmp[0]}-${bmp[q1]}-${bmp[mid]}-${bmp[q3]}-${bmp[bmp.length - 1]}`;

          if (fastSig !== lastClipSignature) {
            lastClipSignature = fastSig;
            const imgBuf = maybeImg.toPNG();
            const previewUrl = maybeImg.resize({ width: Math.min(200, sz.width || 180) }).toDataURL();
            const clipId = Date.now().toString() + Math.random().toString(36).slice(2, 5);
            const imgFilePath = path.join(shelfDir, `clip_${clipId}.png`);
            try {
              fs.writeFileSync(imgFilePath, imgBuf);
            } catch (e) {}

            const label = `🖼 Скриншот (${sz.width}×${sz.height})`;
            clipboardHistory.unshift({
              id: clipId,
              type: 'image',
              mimeType: 'image/png',
              imgFilePath,
              sig: fastSig,
              text: label,
              previewUrl,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
            if (clipboardHistory.length > 25) {
              clipboardHistory = clipboardHistory.slice(0, 25);
            }
            saveClipboardHistory();
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('clipboard-updated', clipboardHistory);
            }
          } else if (forceBroadcast && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('clipboard-updated', clipboardHistory);
          }
          return;
        }
      }
    }

    // 2. Check for Text (Ctrl+C)
    if (typeof clipboard.readText === 'function') {
      const rawText = (await Promise.resolve(clipboard.readText())) || '';
      const trimmed = typeof rawText === 'string' ? rawText.trim() : '';

      if (trimmed.length > 0) {
        const sig = 'txt:' + trimmed;
        if (sig !== lastClipSignature) {
          lastClipSignature = sig;
          clipboardHistory = clipboardHistory.filter(i => i.text !== trimmed);
          clipboardHistory.unshift({
            id: Date.now().toString() + Math.random().toString(36).slice(2, 5),
            type: 'text',
            text: trimmed,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          });
          if (clipboardHistory.length > 35) {
            clipboardHistory = clipboardHistory.slice(0, 35);
          }
          saveClipboardHistory();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('clipboard-updated', clipboardHistory);
          }
          return;
        }
      }
    }

    if (forceBroadcast && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('clipboard-updated', clipboardHistory);
    }
  } catch (e) {}
}

let cachedDragIcon = null;
function getFallbackDragIcon() {
  if (cachedDragIcon && !cachedDragIcon.isEmpty()) return cachedDragIcon;
  try {
    const pngPath = path.join(__dirname, 'build', 'icon.png');
    const icoPath = path.join(__dirname, 'build', 'icon.ico');
    if (fs.existsSync(pngPath)) {
      cachedDragIcon = nativeImage.createFromPath(pngPath).resize({ width: 32, height: 32 });
    } else if (fs.existsSync(icoPath)) {
      cachedDragIcon = nativeImage.createFromPath(icoPath).resize({ width: 32, height: 32 });
    }
  } catch (e) {}
  if (!cachedDragIcon || cachedDragIcon.isEmpty()) {
    // 16x16 valid purple neon PNG data URL fallback so startDrag NEVER receives an empty icon on Windows!
    const fallbackDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAySURBVDhPY/z//z8DJYCRkZGRgYGBgWEYDowaMGgA0wzAxcXFwMDAwEAtA4g2gIEBAJ5bB9H2mX8rAAAAAElFTkSuQmCC';
    cachedDragIcon = nativeImage.createFromDataURL(fallbackDataUrl).resize({ width: 32, height: 32 });
  }
  return cachedDragIcon;
}

let lastIgnoreState = true;
function setupIPC() {
  ipcMain.handle('shortcuts-get', () => shortcuts);
  ipcMain.handle('shortcuts-save', (event, values) => {
    if (event.sender !== mainWindow?.webContents || !values || typeof values !== 'object') return { error: 'invalid' };
    const next = {};
    const used = new Set();
    for (const action of Object.keys(shortcutDefaults)) {
      const value = values[action];
      if (typeof value !== 'string' || (value && !/^(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?(?:Super\+)?(?:[A-Z0-9]|F(?:[1-9]|1[0-2]))$/.test(value)) ||
          (value && !value.includes('+') && !/^F\d+$/.test(value))) return { error: 'invalid', action };
      if (value && used.has(value)) return { error: 'duplicate', action };
      if (value) used.add(value);
      next[action] = value;
    }
    const changed = Object.keys(next).filter(action => next[action] !== shortcuts[action]);
    if (!changed.length) return { shortcuts };
    for (const action of changed) {
      if (shortcuts[action]) globalShortcut.unregister(shortcuts[action]);
    }
    const registered = [];
    let problem = {};
    try {
      for (const action of changed) {
        if (!next[action]) continue;
        problem = { error: 'unavailable', action };
        if (!registerShortcut(action, next[action])) throw new Error('Shortcut unavailable');
        registered.push(next[action]);
      }
      problem = { error: 'save' };
      fs.writeFileSync(shortcutPath + '.tmp', JSON.stringify(next), 'utf8');
      fs.renameSync(shortcutPath + '.tmp', shortcutPath);
      shortcuts = next;
      return { shortcuts };
    } catch {
      for (const key of registered) globalShortcut.unregister(key);
      for (const action of changed) {
        try { if (shortcuts[action]) registerShortcut(action, shortcuts[action]); } catch {}
      }
      return problem;
    }
  });
  require('./telegram').registerTelegram(ipcMain, () => mainWindow);
  ipcMain.on('telegram-layout', (event, expanded) => {
    if (mainWindow?.webContents !== event.sender || typeof expanded !== 'boolean') return;
    const bounds = mainWindow.getBounds();
    const height = expanded ? 446 : STAGE_H;
    if (bounds.height !== height) mainWindow.setBounds({ ...bounds, height });
  });
  ipcMain.on('set-ignore-mouse', (event, ignore) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // Never disable mouse events while the user is actively dragging a file out of the shelf!
    if (isDraggingOutFile && ignore) return;
    if (lastIgnoreState === ignore) return;
    lastIgnoreState = ignore;
    if (ignore) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      mainWindow.setIgnoreMouseEvents(false);
    }
  });

  ipcMain.on('set-window-focusable', (event, focusable) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      mainWindow.setFocusable(!!focusable);
      if (focusable) mainWindow.focus();
      applyAlwaysOnTopToWindow();
    } catch (e) {}
  });

  ipcMain.handle('aot-get', () => ({ enabled: alwaysOnTopEnabled }));

  ipcMain.handle('aot-toggle', () => {
    alwaysOnTopEnabled = !alwaysOnTopEnabled;
    saveMediaPrefs();
    applyAlwaysOnTopToWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('aot-changed', { enabled: alwaysOnTopEnabled });
    }
    return { enabled: alwaysOnTopEnabled };
  });

  ipcMain.handle('media-get-state', async () => {
    return await getMediaState(activeMediaService);
  });

  ipcMain.handle('media-set-service', async (event, serviceId) => {
    if (MEDIA_SERVICES[serviceId]) {
      activeMediaService = serviceId;
      saveMediaPrefs();
      // Immediately destroy any previous service's BrowserWindow so RAM is freed right away!
      await destroyOtherMediaWorkers(activeMediaService);
    }
    return await getMediaState(activeMediaService);
  });

  ipcMain.handle('media-action', async (event, { action, value, mode }) => {
    if (mode === 'system') {
      if (action === 'playPause') sendWindowsMediaKey(179);
      if (action === 'next') sendWindowsMediaKey(176);
      if (action === 'prev') sendWindowsMediaKey(177);
      return { ok: true };
    }
    const targetSrv = (mode && MEDIA_SERVICES[mode]) ? mode : activeMediaService;
    await mediaServiceAction(targetSrv, action, value);
    return { ok: true };
  });

  ipcMain.handle('stats-get', async () => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsage = Math.floor((usedMem / totalMem) * 100);

    return {
      cpu: {
        usage: currentCpuUsage,
        name: cachedCpuName
      },
      memory: {
        usage: memUsage,
        usedGB: (usedMem / (1024 ** 3)).toFixed(1),
        totalGB: (totalMem / (1024 ** 3)).toFixed(1)
      },
      gpu: {
        name: cachedGpuName,
        usage: cachedGpuUsage,
        temp: cachedGpuTemp
      },
      network: {
        downKBs: cachedNetDownKBs,
        upKBs: cachedNetUpKBs
      },
      disk: cachedDisk,
      battery: cachedBattery
    };
  });

  ipcMain.on('stats-view', (event, view) => {
    if (mainWindow?.webContents === event.sender && ['hidden', 'cpu', 'compact', 'full'].includes(view)) {
      setStatsView(view);
    }
  });

  // Clipboard IPC
  ipcMain.handle('clipboard-get', async () => {
    await checkClipboardNow(false);
    return clipboardHistory;
  });

  ipcMain.handle('clipboard-copy', async (event, item) => {
    try {
      if (typeof item === 'object' && item !== null) {
        if (item.type === 'image') {
          let filePath = item.imgFilePath;
          if ((!filePath || !fs.existsSync(filePath)) && item.fullDataUrl) {
            const base64Data = item.fullDataUrl.replace(/^data:.*;base64,/, '');
            const buf = Buffer.from(base64Data, 'base64');
            filePath = path.join(shelfDir, `clip_restore_${item.id || Date.now()}.png`);
            fs.writeFileSync(filePath, buf);
          }

          if (filePath && fs.existsSync(filePath)) {
            lastClipSignature = item.sig || lastClipSignature;
            await new Promise((resolve) => {
              const psCmd = `powershell -Sta -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $img = [System.Drawing.Image]::FromFile('${filePath.replace(/'/g, "''")}'); [System.Windows.Forms.Clipboard]::SetImage($img); $img.Dispose()"`;
              exec(psCmd, () => resolve());
            });
          }
        } else if (item.text) {
          lastClipSignature = 'txt:' + item.text.trim();
          await clipboard.writeText(item.text);
        }
      } else if (typeof item === 'string') {
        lastClipSignature = 'txt:' + item.trim();
        await clipboard.writeText(item);
      }
    } catch (e) {}
    return true;
  });

  ipcMain.handle('clipboard-add-manual', async (event, text) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return clipboardHistory;
    await clipboard.writeText(trimmed);
    lastClipSignature = 'txt:' + trimmed;
    clipboardHistory = clipboardHistory.filter(i => i.text !== trimmed);
    clipboardHistory.unshift({
      id: Date.now().toString() + Math.random().toString(36).slice(2, 5),
      type: 'text',
      text: trimmed,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    saveClipboardHistory();
    return clipboardHistory;
  });

  ipcMain.handle('clipboard-clear', () => {
    clipboardHistory = [];
    saveClipboardHistory();
    return [];
  });

  ipcMain.handle('clipboard-delete', (event, id) => {
    clipboardHistory = clipboardHistory.filter(item => item.id !== id);
    saveClipboardHistory();
    return clipboardHistory;
  });

  // File Shelf IPC
  ipcMain.handle('shelf-get', () => getShelfItems());

  ipcMain.handle('pinned-apps', async (event, action, value) => {
    if (mainWindow?.webContents !== event.sender || event.senderFrame?.parent !== null) {
      return { error: 'Команда недоступна.' };
    }
    try {
      let files = readPinnedApps();
      if (action === 'pick') {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
          title: 'Закрепить приложение',
          defaultPath: app.getPath('desktop'),
          filters: [{ name: 'Приложения и ярлыки', extensions: ['exe', 'lnk'] }],
          properties: ['openFile', 'multiSelections', 'noResolveAliases']
        });
        if (canceled) return {};
        files = addPinnedApps(filePaths);
      } else if (action === 'drop' && Array.isArray(value)) {
        if (!value.some(isPinnedAppPath)) return { error: 'Перетащи файл .exe или ярлык .lnk.' };
        files = addPinnedApps(value);
      } else if (action === 'remove' && files.includes(value)) {
        files = files.filter(file => file !== value);
        savePinnedApps(files);
      } else if (action === 'launch') {
        if (!files.includes(value) || !fs.statSync(value, { throwIfNoEntry: false })?.isFile()) {
          return { error: 'Файл не найден. Закрепи приложение заново.' };
        }
        const error = await shell.openPath(value);
        return error ? { error: 'Не удалось открыть приложение. Проверь путь и ярлык.' } : {};
      }
      return { apps: await describePinnedApps(files) };
    } catch (error) {
      console.warn('Pinned apps:', error.message);
      return { error: 'Не удалось выполнить действие с закреплёнными приложениями.' };
    }
  });

  ipcMain.handle('shelf-add-files', (event, files) => {
    const items = getShelfItems();
    const previousCount = items.length;
    for (const f of files) {
      try {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const safeName = path.basename(f.path || f.name || 'file.dat');
        const destPath = path.join(shelfDir, `${id}_${safeName}`);
        const cleanExportPath = path.join(shelfExportDir, safeName);

        if (f.path && fs.existsSync(f.path)) {
          fs.copyFileSync(f.path, destPath);
          try { fs.copyFileSync(f.path, cleanExportPath); } catch (e) {}
        } else if (f.base64) {
          const buf = Buffer.from(f.base64, 'base64');
          fs.writeFileSync(destPath, buf);
          try { fs.writeFileSync(cleanExportPath, buf); } catch (e) {}
        } else {
          continue;
        }

        const stats = fs.statSync(destPath);
        items.unshift({
          id,
          name: safeName,
          originalPath: f.path || destPath,
          storedPath: destPath,
          exportPath: cleanExportPath,
          size: stats.size,
          ext: path.extname(safeName).toLowerCase(),
          addedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
      } catch (err) {}
    }
    saveShelfItems(items);
    return { items, added: items.length - previousCount };
  });

  ipcMain.handle('shelf-remove', (event, id) => {
    let items = getShelfItems();
    const target = items.find(i => i.id === id);
    if (target && target.storedPath && fs.existsSync(target.storedPath)) {
      try { fs.unlinkSync(target.storedPath); } catch (e) {}
    }
    items = items.filter(i => i.id !== id);
    saveShelfItems(items);
    return items;
  });

  ipcMain.handle('shelf-clear', () => {
    const items = getShelfItems();
    for (const item of items) {
      if (item.storedPath && fs.existsSync(item.storedPath)) {
        try { fs.unlinkSync(item.storedPath); } catch (e) {}
      }
    }
    saveShelfItems([]);
    return [];
  });

  ipcMain.handle('shelf-open-file', (event, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
      shell.openPath(filePath);
    }
  });

  ipcMain.handle('shelf-copy-file', async (event, filePath) => {
    if (!filePath || !fs.existsSync(filePath)) return false;
    await new Promise((resolve) => {
      const escaped = filePath.replace(/'/g, "''");
      exec(`powershell -Sta -NoProfile -Command "Set-Clipboard -LiteralPath '${escaped}'"`, { windowsHide: true }, () => resolve());
    });
    return true;
  });

  ipcMain.on('shelf-start-drag', async (event, payload) => {
    try {
      const storedPath = typeof payload === 'object' && payload !== null ? payload.storedPath : payload;
      const originalPath = typeof payload === 'object' && payload !== null ? payload.originalPath : '';
      const cleanName = typeof payload === 'object' && payload !== null && payload.name
        ? payload.name
        : path.basename(storedPath || originalPath || '').replace(/^[a-z0-9]+_/, '');

      let sourceFile = '';
      if (storedPath && fs.existsSync(storedPath)) sourceFile = storedPath;
      else if (originalPath && fs.existsSync(originalPath)) sourceFile = originalPath;
      if (!sourceFile) return;

      // Prepare clean filename in export folder so dragging to Desktop/Discord/Telegram drops with clean original filename!
      let dragTargetFile = sourceFile;
      if (cleanName) {
        const cleanCandidate = path.join(shelfExportDir, cleanName);
        try {
          if (!fs.existsSync(cleanCandidate)) {
            fs.copyFileSync(sourceFile, cleanCandidate);
          }
          dragTargetFile = cleanCandidate;
        } catch (e) {}
      }

      // Prevent island from disabling mouse events while Windows OLE DoDragDrop is active!
      isDraggingOutFile = true;
      setTimeout(() => {
        isDraggingOutFile = false;
      }, 2500);

      let icon = null;
      try {
        icon = await app.getFileIcon(dragTargetFile, { size: 'normal' });
      } catch (e) {}
      if (!icon || icon.isEmpty()) {
        icon = getFallbackDragIcon();
      }

      event.sender.startDrag({
        file: dragTargetFile,
        icon
      });
    } catch (e) {
      isDraggingOutFile = false;
    }
  });

  // Drag / Move Island across ALL connected monitors!
  ipcMain.on('move-island-x', (event, deltaX) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    const nextX = Math.round(bounds.x + deltaX);
    // Find which display the center of the island is now on so we align to that monitor's top edge (y)
    const centerPoint = { x: nextX + Math.round(STAGE_W / 2), y: bounds.y + 20 };
    const targetDisplay = screen.getDisplayNearestPoint(centerPoint);
    const topY = targetDisplay ? targetDisplay.bounds.y : 0;
    mainWindow.setPosition(nextX, topY);
  });

  ipcMain.on('switch-monitor', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const displays = screen.getAllDisplays();
    if (!displays || displays.length <= 1) return;
    const bounds = mainWindow.getBounds();
    const currentCenter = { x: bounds.x + Math.round(STAGE_W / 2), y: bounds.y + 20 };
    const currentDisplay = screen.getDisplayNearestPoint(currentCenter);
    const currentIndex = displays.findIndex(d => d.id === currentDisplay.id);
    const nextDisplay = displays[(currentIndex + 1) % displays.length];
    const targetX = Math.round(nextDisplay.bounds.x + (nextDisplay.bounds.width - STAGE_W) / 2);
    const targetY = nextDisplay.bounds.y;
    mainWindow.setPosition(targetX, targetY);
  });

  ipcMain.on('reset-island-x', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    const currentCenter = { x: bounds.x + Math.round(STAGE_W / 2), y: bounds.y + 20 };
    const currentDisplay = screen.getDisplayNearestPoint(currentCenter) || screen.getPrimaryDisplay();
    const targetX = Math.round(currentDisplay.bounds.x + (currentDisplay.bounds.width - STAGE_W) / 2);
    mainWindow.setPosition(targetX, currentDisplay.bounds.y);
  });

  // Auto-start on Windows boot toggle
  ipcMain.handle('autostart-get', () => {
    try {
      const settings = app.getLoginItemSettings();
      return !!settings.openAtLogin;
    } catch (e) {
      return false;
    }
  });

  ipcMain.handle('autostart-set', (event, enable) => {
    try {
      app.setLoginItemSettings({
        openAtLogin: !!enable,
        path: process.execPath
      });
      return !!enable;
    } catch (e) {
      return false;
    }
  });

  // Game Mode / FPS Boost IPC
  ipcMain.handle('gamemode-get', () => ({ active: isGameMode, manual: gameModeOverride === true }));

  ipcMain.handle('gamemode-toggle', () => {
    gameModeOverride = !isGameMode;
    gameModeRevision++;
    applyGameModeState(gameModeOverride, gameModeOverride ? 'FPS Boost' : '');
    return { active: isGameMode, manual: gameModeOverride === true };
  });

  // Custom Neon GUI Installer IPC
  const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local');
  const defaultInstallDir = path.join(localAppData, 'Programs', 'dexxyqisland');
  ipcMain.handle('setup-get-default-dir', () => defaultInstallDir);
  ipcMain.handle('setup-get-version', () => app.getVersion());

  ipcMain.handle('setup-browse-dir', async () => {
    if (!setupWindow) return null;
    const res = await dialog.showOpenDialog(setupWindow, {
      title: 'Выберите папку для установки dexxyqisland',
      properties: ['openDirectory', 'createDirectory']
    });
    if (!res.canceled && res.filePaths && res.filePaths.length > 0) {
      const picked = res.filePaths[0];
      return picked.toLowerCase().endsWith('dexxyqisland')
        ? picked
        : path.join(picked, 'dexxyqisland');
    }
    return null;
  });

  let completedInstallExe = null;
  ipcMain.handle('setup-perform-install', async (event, options) => {
    if (setupWindow?.webContents !== event.sender) return { ok: false };
    completedInstallExe = null;
    const targetDir = path.resolve(options?.installDir?.trim() || defaultInstallDir);
    const createShortcut = options ? !!options.desktopShortcut : true;
    const enableAutoStart = options ? !!options.autoStart : true;

    const sendProgress = (percent, status) => {
      if (setupWindow && !setupWindow.isDestroyed()) {
        setupWindow.webContents.send('setup-progress', { percent, status });
      }
    };

    try {
      sendProgress(10, 'Проверка компонентов Windows и подготовка папки...');
      await new Promise(r => setTimeout(r, 350));

      // Determine source directory of the running app
      const srcAppDir = path.dirname(process.execPath);

      sendProgress(25, 'Подготовка папки установки...');
      try {
        await fs.promises.mkdir(targetDir, { recursive: true });
        await fs.promises.access(targetDir, fs.constants.W_OK);
      } catch (error) {
        if (!['EACCES', 'EPERM'].includes(error.code)) throw error;
        return {
          ok: false,
          error: targetDir.toLowerCase() === defaultInstallDir.toLowerCase()
            ? 'Нет доступа к папке установки. Выбери другую папку через «Обзор».'
            : 'Нет доступа к выбранной папке. Подставил папку пользователя — нажми «Установить» ещё раз.',
          suggestedDir: defaultInstallDir
        };
      }

      sendProgress(50, `Копирование файлов в ${targetDir}...`);
      if (path.resolve(srcAppDir).toLowerCase() !== path.resolve(targetDir).toLowerCase()) {
        await copyInstallation(srcAppDir, targetDir);
      }

      const finalExe = path.join(targetDir, 'dexxyqisland.exe');
      await fs.promises.access(finalExe);
      const icoFile = path.join(targetDir, 'resources', 'app.asar.unpacked', 'build', 'icon.ico');
      const fallbackIco = fs.existsSync(icoFile) ? icoFile : finalExe;

      sendProgress(75, 'Создание ярлыка dexxyqisland на Рабочем столе...');
      if (createShortcut) {
        const desktopPath = app.getPath('desktop');
        const shortcutPath = path.join(desktopPath, 'dexxyqisland.lnk');
        const shortcutCreated = shell.writeShortcutLink(shortcutPath, 'create', {
          target: finalExe,
          cwd: targetDir,
          description: 'dexxyqisland — Dynamic Island for Windows',
          icon: fallbackIco,
          iconIndex: 0
        });
        if (!shortcutCreated) throw new Error('Не удалось создать ярлык на рабочем столе.');

        // Also create Start Menu shortcut
        const startMenuDir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
        const startShortcut = path.join(startMenuDir, 'dexxyqisland.lnk');
        try {
          shell.writeShortcutLink(startShortcut, 'create', {
            target: finalExe,
            cwd: targetDir,
            description: 'dexxyqisland — Dynamic Island for Windows',
            icon: fallbackIco,
            iconIndex: 0
          });
        } catch (e) {}
      }

      sendProgress(90, 'Настройка автозапуска и игрового профиля...');
      try {
        app.setLoginItemSettings({
          openAtLogin: enableAutoStart,
          path: finalExe
        });
      } catch (e) {}

      await new Promise(r => setTimeout(r, 350));
      completedInstallExe = finalExe;
      sendProgress(100, 'Установка успешно завершена! Хе-хе 👾');
      return { ok: true, exePath: finalExe, targetDir };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.on('setup-finish-and-launch', async (event, { launch }) => {
    if (setupWindow?.webContents !== event.sender) return;
    if (launch && completedInstallExe) {
      const error = await shell.openPath(completedInstallExe);
      if (error) {
        dialog.showErrorBox('Не удалось запустить DexxyqIsland', error);
        return;
      }
    }
    app.quit();
  });

  ipcMain.on('app-quit', async () => {
    app.isQuitting = true;
    try {
      if (nvStreamProc) {
        nvStreamProc.kill();
        nvStreamProc = null;
      }
      for (const cfg of Object.values(MEDIA_SERVICES)) {
        const pSess = session.fromPartition(cfg.partition);
        await pSess.cookies.flushStore();
        pSess.flushStorageData();
      }
    } catch (e) {}
    app.quit();
  });
}

// =====================================================
// GAME MODE / FPS SAVER ENGINE (Zero FPS impact in games)
// =====================================================
const KNOWN_GAMES = new Set([
  'cs2.exe', 'csgo.exe', 'dota2.exe', 'valorant-win64-shipping.exe', 'valorant.exe',
  'rustclient.exe', 'eurotrucks2.exe', 'amtrucks.exe', 'gta5.exe', 'gtav.exe',
  'r5apex.exe', 'fortniteclient-win64-shipping.exe', 'robloxplayerbeta.exe',
  'javaw.exe', 'minecraft.windows.exe', 'cyberpunk2077.exe', 'witcher3.exe',
  'eldenring.exe', 'bg3.exe', 'bg3_dx11.exe', 'overwatch.exe', 'rainbowsix.exe',
  'tslgame.exe', 'deadbydaylight-win64-shipping.exe', 'hl2.exe', 'left4dead2.exe',
  'league of legends.exe', 'genshinimpact.exe', 'honkaistarrail.exe', 'warframe.x64.exe',
  'pathofexile.exe', 'escapefromtarkov.exe', 'dayz_x64.exe', 'beamng.drive.x64.exe',
  'rocketleague.exe', 'helldivers2.exe', 'palworld-win64-shipping.exe', 'stalker2-win64-shipping.exe'
]);

function applyGameModeState(active, gameName = '') {
  if (isGameMode === active) return;
  isGameMode = active;

  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setFrameRate(isGameMode ? 10 : 60);
      mainWindow.webContents.send('gamemode-changed', { active: isGameMode, gameName });
    }
    for (const win of Object.values(mediaWindows)) {
      if (win && !win.isDestroyed() && !win.isVisible()) {
        win.webContents.setFrameRate(isGameMode ? 15 : 24);
      }
    }
  } catch (e) {}

  if (clipIntervalId) clearInterval(clipIntervalId);
  clipIntervalId = setInterval(() => {
    checkClipboardNow(false);
  }, isGameMode ? 4500 : 600);
}

function startGameDetector() {
  let checking = false;
  setInterval(() => {
    if (gameModeOverride === true || checking) return;
    checking = true;
    const revision = gameModeRevision;
    execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 6000 }, (err, stdout) => {
      checking = false;
      if (err || !stdout || revision !== gameModeRevision) return;
      const lower = stdout.toLowerCase();
      let foundGame = '';
      for (const gameExe of KNOWN_GAMES) {
        if (lower.includes(`"${gameExe}"`)) {
          foundGame = gameExe.replace('.exe', '').toUpperCase();
          break;
        }
      }
      if (gameModeOverride === false) {
        if (!foundGame) gameModeOverride = null;
        return;
      }
      applyGameModeState(!!foundGame, foundGame);
    });
  }, 8000);
}

function startClipboardWatcher() {
  loadClipboardHistory();
  checkClipboardNow(false);
  clipIntervalId = setInterval(() => {
    checkClipboardNow(false);
  }, 1200);
}

app.whenReady().then(() => {
  setupIPC();
  if (isSetupMode) {
    createWindow();
    return;
  }
  setStatsView('cpu');
  startClipboardWatcher();
  startGameDetector();
  startAlwaysOnTopKeeper();
  createWindow();

  // Global hotkeys:
  // Alt+X -> Toggle Stealth Strip mode
  // Alt+T -> Toggle Always-On-Top Overlay mode (on top of games / windows)
  let saved;
  try { saved = JSON.parse(fs.readFileSync(shortcutPath, 'utf8')); } catch {}
  for (const [action, defaultKey] of Object.entries(shortcutDefaults)) {
    const key = typeof saved?.[action] === 'string' ? saved[action] : defaultKey;
    shortcuts[action] = '';
    try { if (key && registerShortcut(action, key)) shortcuts[action] = key; } catch {}
  }
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  app.isQuitting = true;
  clearInterval(hardwareTimer);
  try {
    if (nvStreamProc) {
      nvStreamProc.kill();
      nvStreamProc = null;
    }
  } catch (e) {}
});

app.on('window-all-closed', () => {
  app.quit();
});
