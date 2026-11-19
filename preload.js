const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('dexxyq', {
  tools: (action, value) => ipcRenderer.invoke('island-tools', action, value),
  audio: (action, value) => ipcRenderer.invoke('audio-control', action, value),
  pinClipboard: id => ipcRenderer.invoke('clipboard-pin', id),
  onToolsUpdate: callback => ipcRenderer.on('island-tools-update', (_, update) => callback(update)),
  onToolsOpen: callback => ipcRenderer.on('island-tools-open', (_, section) => callback(section)),
  getShortcuts: () => ipcRenderer.invoke('shortcuts-get'),
  saveShortcuts: values => ipcRenderer.invoke('shortcuts-save', values),
  onGlobalAction: callback => {
    ipcRenderer.on('global-action', (_, action, accelerator) => callback(action, accelerator));
  },
  telegram: (action, value) => ipcRenderer.invoke('telegram', action, value),
  setTelegramLayout: (expanded) => ipcRenderer.send('telegram-layout', expanded),
  onTelegramUpdate: (callback) => {
    ipcRenderer.on('telegram-update', (_, update) => callback(update));
  },
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  setWindowFocusable: (focusable) => ipcRenderer.send('set-window-focusable', focusable),
  moveIslandX: (deltaX) => ipcRenderer.send('move-island-x', deltaX),
  switchMonitor: () => ipcRenderer.send('switch-monitor'),
  resetIslandX: () => ipcRenderer.send('reset-island-x'),
  onToggleStealth: (callback) => {
    ipcRenderer.removeAllListeners('toggle-stealth');
    ipcRenderer.on('toggle-stealth', () => callback());
  },

  // Media (SoundCloud / Spotify / Yandex Music)
  getMediaState: () => ipcRenderer.invoke('media-get-state'),
  mediaAction: (payload) => ipcRenderer.invoke('media-action', payload),
  setMediaService: (service) => ipcRenderer.invoke('media-set-service', service),

  // System Stats
  getStats: () => ipcRenderer.invoke('stats-get'),
  setStatsView: (view) => ipcRenderer.send('stats-view', view),

  // Clipboard
  getClipboard: () => ipcRenderer.invoke('clipboard-get'),
  copyClipboard: (item) => ipcRenderer.invoke('clipboard-copy', item),
  addManualClipboard: (text) => ipcRenderer.invoke('clipboard-add-manual', text),
  clearClipboard: () => ipcRenderer.invoke('clipboard-clear'),
  deleteClipboard: (id) => ipcRenderer.invoke('clipboard-delete', id),
  onClipboardUpdated: (callback) => {
    ipcRenderer.removeAllListeners('clipboard-updated');
    ipcRenderer.on('clipboard-updated', (_, data) => callback(data));
  },

  // File Shelf (Drag IN & Drag OUT + File Path Resolver for Electron 41)
  getFilePath: (file) => {
    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') {
        const p = webUtils.getPathForFile(file);
        if (p) return p;
      }
    } catch (e) {}
    return (file && file.path) || '';
  },
  getShelf: () => ipcRenderer.invoke('shelf-get'),
  pinnedApps: (action, value) => ipcRenderer.invoke('pinned-apps', action, value),
  addShelfFiles: (files) => ipcRenderer.invoke('shelf-add-files', files),
  addClipboardToShelf: (id) => ipcRenderer.invoke('shelf-add-clipboard', id),
  removeShelfItem: (id) => ipcRenderer.invoke('shelf-remove', id),
  clearShelf: () => ipcRenderer.invoke('shelf-clear'),
  openShelfFile: (filePath) => ipcRenderer.invoke('shelf-open-file', filePath),
  copyShelfFileToClipboard: (filePath) => ipcRenderer.invoke('shelf-copy-file', filePath),
  startDrag: (item) => ipcRenderer.send('shelf-start-drag', item),

  // Custom Neon GUI Installer
  setupGetDefaultDir: () => ipcRenderer.invoke('setup-get-default-dir'),
  setupGetVersion: () => ipcRenderer.invoke('setup-get-version'),
  setupBrowseDir: () => ipcRenderer.invoke('setup-browse-dir'),
  setupPerformInstall: (opts) => ipcRenderer.invoke('setup-perform-install', opts),
  onSetupProgress: (callback) => {
    ipcRenderer.removeAllListeners('setup-progress');
    ipcRenderer.on('setup-progress', (_, data) => callback(data));
  },
  setupFinishAndLaunch: (payload) => ipcRenderer.send('setup-finish-and-launch', payload),

  // App, AlwaysOnTop Overlay, AutoStart & GameMode
  getAlwaysOnTop: () => ipcRenderer.invoke('aot-get'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('aot-toggle'),
  onAlwaysOnTopChanged: (callback) => {
    ipcRenderer.removeAllListeners('aot-changed');
    ipcRenderer.on('aot-changed', (_, data) => callback(data));
  },
  getAutoStart: () => ipcRenderer.invoke('autostart-get'),
  setAutoStart: (enable) => ipcRenderer.invoke('autostart-set', enable),
  getGameMode: () => ipcRenderer.invoke('gamemode-get'),
  toggleGameMode: () => ipcRenderer.invoke('gamemode-toggle'),
  onGameModeChanged: (callback) => {
    ipcRenderer.removeAllListeners('gamemode-changed');
    ipcRenderer.on('gamemode-changed', (_, data) => callback(data));
  },
  quitApp: () => ipcRenderer.send('app-quit')
});
