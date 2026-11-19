const toolsDialog = document.getElementById('islandTools');
const toolsStatus = document.getElementById('islandToolsStatus');
const toolsButton = document.getElementById('islandToolsButton');
const toolsSearch = document.getElementById('islandSearch');
const toolsResults = document.getElementById('islandSearchResults');
const timerList = document.getElementById('islandTimers');
const historyList = document.getElementById('islandHistory');
const audioDevices = document.getElementById('islandAudioDevices');
let toolsState = { timers: [], history: [] };
let toolSection = 'search';
let timerTick;
let searchRevision = 0;
let searchSources = [];
let audioBusy = false;
let importSettings;
let transferBusy = false;
let historySeen = Number(localStorage.getItem('dexxyq.historySeen')) || 0;

function toolText(text, className = 'tools-hint') {
  const element = document.createElement('p');
  element.className = className;
  element.textContent = text;
  return element;
}

function toolAction(label, callback) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-small';
  button.textContent = tr(label);
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await callback(); }
    catch { toolsStatus.textContent = tr('Не удалось выполнить действие.'); }
    finally { button.disabled = false; }
  });
  return button;
}

function showToolSection(section) {
  toolSection = section;
  toolsStatus.textContent = '';
  for (const button of document.querySelectorAll('[data-tool]')) button.setAttribute('aria-pressed', String(button.dataset.tool === section));
  for (const panel of document.querySelectorAll('[data-tool-panel]')) panel.hidden = panel.dataset.toolPanel !== section;
  clearInterval(timerTick);
  if (section === 'timers') {
    renderToolsTimers();
    timerTick = setInterval(updateToolsCountdowns, 1000);
  }
  if (section === 'history') {
    historySeen = Date.now();
    try { localStorage.setItem('dexxyq.historySeen', String(historySeen)); } catch {}
    island.removeAttribute('data-tools-notice');
    renderToolsHistory();
  }
  if (section === 'audio') void loadToolsAudio();
  if (section === 'search') {
    toolsSearch.focus();
    void refreshToolsSearch();
  }
}

async function openIslandTools(section = 'search') {
  clearTimeout(collapseTimer);
  isGhostPassThrough = false;
  island.classList.remove('ghost-passthrough');
  if (isStealth) toggleStealthMode(false);
  expandIsland();
  window.dexxyq.setIgnoreMouse(false);
  window.dexxyq.setWindowFocusable(true);
  if (!toolsDialog.open) toolsDialog.showModal();
  showToolSection(section);
  try {
    const result = await window.dexxyq.tools('get');
    if (result.error) toolsStatus.textContent = tr(result.error);
    if (result.state) updateToolsState(result.state);
  } catch { toolsStatus.textContent = tr('Не удалось загрузить инструменты.'); }
}

toolsButton.addEventListener('click', () => openIslandTools());
document.getElementById('settingsTransferButton').addEventListener('click', () => openIslandTools('transfer'));
document.getElementById('islandToolsClose').addEventListener('click', () => toolsDialog.close());
toolsDialog.addEventListener('close', () => {
  if (toolsDialog.open) return;
  clearInterval(timerTick);
  searchRevision++;
});
for (const button of document.querySelectorAll('[data-tool]')) {
  button.addEventListener('click', () => showToolSection(button.dataset.tool));
}
window.dexxyq.onToolsOpen(section => openIslandTools(section));
document.addEventListener('keydown', event => {
  if (event.ctrlKey && event.key.toLowerCase() === 'k' && !island.querySelector('dialog[open]')) {
    event.preventDefault();
    void openIslandTools();
  }
});

function updateToolsState(state) {
  toolsState = state;
  const latest = state.history[0]?.time || 0;
  if (toolsDialog.open && toolSection === 'history') {
    historySeen = Date.now();
    try { localStorage.setItem('dexxyq.historySeen', String(historySeen)); } catch {}
  }
  island.toggleAttribute('data-tools-notice', latest > historySeen && !(toolsDialog.open && toolSection === 'history'));
  if (toolsDialog.open && toolSection === 'timers') renderToolsTimers();
  if (toolsDialog.open && toolSection === 'history') renderToolsHistory();
}
window.dexxyq.onToolsUpdate(update => {
  if (update.state) updateToolsState(update.state);
  if (update.notification?.type === 'timer') setMascotMood('wave', update.notification.title, 8000);
});
window.dexxyq.tools('get').then(result => { if (result.state) updateToolsState(result.state); }).catch(() => {});

function switchFromTools(tab) {
  toolsDialog.close();
  document.getElementById('islandSettings').close();
  document.querySelector('[data-tab="' + tab + '"]').click();
}

async function refreshToolsSearch() {
  const revision = ++searchRevision;
  searchSources = [];
  toolsResults.replaceChildren(toolText(tr('Загрузка…')));
  const tasks = [
    ['apps', window.dexxyq.pinnedApps('list')],
    ['shelf', window.dexxyq.getShelf()],
    ['clipboard', window.dexxyq.getClipboard()],
    ['telegram', window.dexxyq.telegram('chats', { key: 'all' })]
  ];
  await Promise.allSettled(tasks.map(async ([kind, promise]) => {
    const result = await promise;
    if (revision !== searchRevision || !toolsDialog.open) return;
    const entries = kind === 'apps' ? result.apps : kind === 'telegram' ? result.chats : result;
    if (Array.isArray(entries)) {
      searchSources.push(...entries.map(item => ({
        kind, item,
        title: kind === 'apps' || kind === 'shelf' ? item.name : kind === 'telegram' ? item.title : item.text
      })));
    }
    renderToolsSearch();
  }));
  if (revision === searchRevision && toolsDialog.open) renderToolsSearch();
}

function renderToolsSearch() {
  const query = toolsSearch.value.trim().toLocaleLowerCase();
  const found = searchSources.filter(entry => String(entry.title || '').toLocaleLowerCase().includes(query));
  found.sort((a, b) => Number(Boolean(b.item.pinned)) - Number(Boolean(a.item.pinned)));
  toolsResults.replaceChildren(...found.slice(0, 60).map(entry => {
    const labels = { apps: 'Приложения', shelf: 'Полка', clipboard: 'Буфер', telegram: 'Telegram' };
    const button = toolAction('', async () => {
      if (entry.kind === 'apps') {
        const result = await window.dexxyq.pinnedApps('launch', entry.item.file);
        if (result.error) { toolsStatus.textContent = tr(result.error); return; }
      } else if (entry.kind === 'shelf') {
        const result = await window.dexxyq.openShelfFile(entry.item.storedPath || entry.item.originalPath);
        if (result && result !== true) { toolsStatus.textContent = String(result); return; }
      } else if (entry.kind === 'clipboard') {
        await window.dexxyq.copyClipboard(entry.item);
        setMascotSpeech('Скопировал обратно! 📋');
      } else {
        switchFromTools('telegram');
        window.dispatchEvent(new CustomEvent('island-open-chat', { detail: entry.item }));
        return;
      }
      toolsDialog.close();
    });
    button.classList.add('tools-search-result');
    const title = document.createElement('span');
    title.textContent = entry.title;
    const kind = document.createElement('small');
    kind.textContent = tr(labels[entry.kind]);
    button.append(title, kind);
    return button;
  }));
  if (!found.length) toolsResults.append(toolText(tr('Ничего не найдено. Подключи Telegram, чтобы искать и в чатах.')));
}
toolsSearch.addEventListener('input', renderToolsSearch);
toolsSearch.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'Enter') {
    event.preventDefault();
    const button = toolsResults.querySelector('button');
    if (event.key === 'Enter') button?.click();
    else button?.focus();
  }
});
toolsResults.addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...toolsResults.querySelectorAll('button')];
  const index = buttons.indexOf(document.activeElement);
  const next = index + (event.key === 'ArrowDown' ? 1 : -1);
  if (next < 0) toolsSearch.focus();
  else buttons[Math.min(next, buttons.length - 1)]?.focus();
});

async function toolsCommand(action, value) {
  const result = await window.dexxyq.tools(action, value);
  toolsStatus.textContent = result.error ? tr(result.error) : '';
  if (result.state) updateToolsState(result.state);
  return result;
}
document.getElementById('islandTimerForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  button.disabled = true;
  try {
    const result = await toolsCommand('timer-add', {
      minutes: document.getElementById('islandTimerMinutes').valueAsNumber,
      label: document.getElementById('islandTimerLabel').value
    });
    if (!result.error) document.getElementById('islandTimerLabel').value = '';
  } catch { toolsStatus.textContent = tr('Не удалось выполнить действие.'); }
  finally { button.disabled = false; }
});
function renderToolsTimers() {
  timerList.replaceChildren(...[...toolsState.timers].sort((a, b) => a.due - b.due).map(timer => {
    const row = document.createElement('div');
    row.className = 'tools-row';
    const name = toolText(timer.label, 'tools-row-title');
    const time = toolText('', 'tools-timer-time');
    time.dataset.timerDue = timer.due;
    row.append(name, time, toolAction('Отменить', () => toolsCommand('timer-delete', timer.id)));
    return row;
  }));
  if (!toolsState.timers.length) timerList.append(toolText(tr('Таймеров пока нет. Они сохраняются после перезапуска.')));
  updateToolsCountdowns();
}
function updateToolsCountdowns() {
  for (const time of timerList.querySelectorAll('[data-timer-due]')) {
    const seconds = Math.max(0, Math.ceil((Number(time.dataset.timerDue) - Date.now()) / 1000));
    const duration = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
    if (time.textContent !== duration) time.textContent = duration;
  }
}
function renderToolsHistory() {
  historyList.replaceChildren(...toolsState.history.map(entry => {
    const row = document.createElement('div');
    row.className = 'tools-row';
    const details = document.createElement('div');
    details.className = 'tools-history-details';
    details.append(toolText(entry.title, 'tools-row-title'), toolText(new Date(entry.time).toLocaleString(), 'tools-hint'));
    row.append(details);
    if (entry.type === 'telegram' && Number.isSafeInteger(entry.chatId)) {
      row.append(toolAction('Открыть', () => {
        switchFromTools('telegram');
        window.dispatchEvent(new CustomEvent('island-open-chat', { detail: { id: entry.chatId, title: entry.title } }));
      }));
    }
    row.append(toolAction('Убрать', () => toolsCommand('history-delete', entry.id)));
    return row;
  }));
  if (!toolsState.history.length) historyList.append(toolText(tr('Уведомлений пока нет.')));
}
document.getElementById('toolsClearHistory').addEventListener('click', () => toolsCommand('history-clear'));

async function loadToolsAudio(action = 'list', value) {
  if (audioBusy) return;
  audioBusy = true;
  const refresh = document.getElementById('audioRefresh');
  refresh.disabled = true;
  audioDevices.inert = true;
  toolsStatus.textContent = tr('Загрузка…');
  try {
    const result = await window.dexxyq.audio(action, value);
    if (result.error) { toolsStatus.textContent = tr(result.error); return; }
    toolsStatus.textContent = '';
    const devices = result.devices || [];
    audioDevices.replaceChildren();
    for (const [flow, label] of [[0, 'Вывод звука'], [1, 'Микрофоны']]) {
      audioDevices.append(toolText(tr(label), 'tools-device-heading'));
      const entries = devices.filter(device => device.flow === flow);
      if (!entries.length) audioDevices.append(toolText(tr('Устройства не найдены.')));
      for (const device of entries) {
        const row = document.createElement('div');
        row.className = 'tools-row';
        const choose = toolAction('', () => loadToolsAudio('default', { id: device.id }));
        choose.className = 'btn-small tools-device';
        choose.textContent = (device.isDefault ? '✓ ' : '') + device.name;
        choose.setAttribute('aria-pressed', String(device.isDefault));
        row.append(choose);
        if (flow === 1) row.append(toolAction(device.muted ? 'Включить микрофон' : 'Выключить микрофон',
          () => loadToolsAudio('mute', { id: device.id, muted: !device.muted })));
        audioDevices.append(row);
      }
    }
    if (action !== 'list') void window.dexxyq.tools('log', { title: tr('Настройки звука изменены') });
  } catch { toolsStatus.textContent = tr('Не удалось управлять звуком. Проверь подключение устройства и нажми «Обновить».'); }
  finally { audioBusy = false; refresh.disabled = false; audioDevices.inert = false; }
}
document.getElementById('audioRefresh').addEventListener('click', () => loadToolsAudio());

const transferKeys = ['dexxyq.language', 'dexxyq.hiddenToolbarButtons', 'dexxyq.mascot'];
function validateIslandSettings(payload) {
  if (payload?.format !== 'dexxyq-settings' || payload.version !== 1 || !payload.preferences || !payload.shortcuts) throw Error();
  const prefs = payload.preferences;
  if (!['ru', 'en'].includes(prefs['dexxyq.language'])) throw Error();
  const hidden = prefs['dexxyq.hiddenToolbarButtons'];
  if (!Array.isArray(hidden) || hidden.some(id => !toolbarButtons.some(([, buttonId]) => buttonId === id))) throw Error();
  const colorPattern = /^#[0-9a-f]{6}$/i;
  if (prefs['dexxyq.appearance']) throw Error();
  const mascot = prefs['dexxyq.mascot'];
  if (!mascot || !colorPattern.test(mascot.color) || !mascotAccessoryNames.includes(mascot.accessory) ||
      typeof mascot.phrase !== 'string' || mascot.phrase.length > 80 || mascot.model || mascot.assets) throw Error();
  const shortcuts = payload.shortcuts;
  if (Object.keys(shortcutActions).some(key => typeof shortcuts[key] !== 'string' || shortcuts[key].length > 80)) throw Error();
  return {
    format: 'dexxyq-settings', version: 1,
    preferences: {
      'dexxyq.language': prefs['dexxyq.language'],
      'dexxyq.hiddenToolbarButtons': [...hidden],
      'dexxyq.mascot': { color: mascot.color, accessory: mascot.accessory, phrase: mascot.phrase }
    },
    shortcuts: Object.fromEntries(Object.keys(shortcutActions).map(key => [key, shortcuts[key]]))
  };
}

async function transferAction(callback) {
  if (transferBusy) return;
  transferBusy = true;
  const buttons = [...document.querySelectorAll('[data-tool-panel="transfer"] button')];
  buttons.forEach(button => { button.disabled = true; });
  toolsStatus.textContent = '';
  try { await callback(); }
  catch { toolsStatus.textContent = tr('Некорректный файл настроек.'); }
  finally { transferBusy = false; buttons.forEach(button => { button.disabled = false; }); }
}
document.getElementById('toolsExport').addEventListener('click', () => transferAction(async () => {
  const preferences = {
    'dexxyq.language': document.documentElement.lang,
    'dexxyq.hiddenToolbarButtons': [...hiddenToolbarButtons],
    'dexxyq.mascot': mascotAppearance
  };
  const payload = validateIslandSettings({ format: 'dexxyq-settings', version: 1, preferences, shortcuts: await window.dexxyq.getShortcuts() });
  const result = await window.dexxyq.tools('settings-export', payload);
  toolsStatus.textContent = result.error ? tr(result.error) : result.saved ? tr('Настройки экспортированы.') : '';
}));
document.getElementById('toolsImport').addEventListener('click', () => transferAction(async () => {
  importSettings = undefined;
  document.getElementById('toolsImportPreview').hidden = true;
  const result = await window.dexxyq.tools('settings-import');
  if (result.error) { toolsStatus.textContent = tr(result.error); return; }
  if (!result.settings) return;
  importSettings = validateIslandSettings(result.settings);
  document.getElementById('toolsImportPreview').hidden = false;
}));
document.getElementById('toolsImportApply').addEventListener('click', () => transferAction(async () => {
  if (!importSettings) return;
  const previous = transferKeys.map(key => [key, localStorage.getItem(key)]);
  const shortcuts = await window.dexxyq.getShortcuts();
  const result = await window.dexxyq.saveShortcuts(importSettings.shortcuts);
  if (result.error) { toolsStatus.textContent = tr('Не удалось применить горячие клавиши. Настройки сохранены без изменений.'); return; }
  try {
    for (const key of transferKeys) localStorage.setItem(key, key === 'dexxyq.language' ?
      importSettings.preferences[key] : JSON.stringify(importSettings.preferences[key]));
  } catch (error) {
    for (const [key, value] of previous) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    await window.dexxyq.saveShortcuts(shortcuts);
    throw error;
  }
  await window.dexxyq.tools('log', { title: tr('Настройки импортированы') });
  location.reload();
}));

document.getElementById('clipFavorites').addEventListener('click', event => {
  const button = event.currentTarget;
  button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
  renderClips();
});
window.addEventListener('island-language-change', () => {
  if (!toolsDialog.open) return;
  if (toolSection === 'search') renderToolsSearch();
  if (toolSection === 'timers') renderToolsTimers();
  if (toolSection === 'history') renderToolsHistory();
});
document.getElementById('addPinnedFolder').addEventListener('click', () => updatePinnedApps('pick-folder'));
const pinnedLinkForm = document.getElementById('pinnedLinkForm');
document.getElementById('showPinnedLink').addEventListener('click', () => {
  pinnedLinkForm.hidden = false;
  document.getElementById('pinnedLinkUrl').focus();
});
document.getElementById('cancelPinnedLink').addEventListener('click', () => { pinnedLinkForm.hidden = true; });
pinnedLinkForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (appsActionPending) return;
  const value = document.getElementById('pinnedLinkUrl').value.trim();
  await updatePinnedApps('link', value);
  if ((await window.dexxyq.pinnedApps('list')).apps?.some(item => item.file === value)) {
    pinnedLinkForm.hidden = true;
    document.getElementById('pinnedLinkUrl').value = '';
  }
});
