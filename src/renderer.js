const island = document.getElementById('island');
const aotToggleBtn = document.getElementById('aotToggleBtn');
const monitorSwitchBtn = document.getElementById('monitorSwitchBtn');
const gameModeBtn = document.getElementById('gameModeBtn');
const autoStartBtn = document.getElementById('autoStartBtn');
const stealthBtn = document.getElementById('stealthBtn');
const pinToggleBtn = document.getElementById('pinToggleBtn');
const quitBtn = document.getElementById('quitBtn');
const brandBadge = document.querySelector('.brand-badge');
const closedBar = document.getElementById('closedBar');

if (aotToggleBtn) {
  window.dexxyq.getAlwaysOnTop().then((res) => {
    if (res) aotToggleBtn.classList.toggle('pinned', !!res.enabled);
  });
  aotToggleBtn.addEventListener('click', async () => {
    const res = await window.dexxyq.toggleAlwaysOnTop();
    aotToggleBtn.classList.toggle('pinned', !!res.enabled);
    setMascotSpeech(res.enabled ? tr('Поверх всех окон и игр! 📌🔥') : tr('Обычное окно (игры перекрывают) 🪟'));
  });
}

window.dexxyq.onAlwaysOnTopChanged((data) => {
  if (aotToggleBtn) aotToggleBtn.classList.toggle('pinned', !!data.enabled);
  setMascotSpeech(data.enabled ? tr('Поверх всех окон и игр! 📌🔥') : tr('Обычное окно 🪟'));
});

if (monitorSwitchBtn) {
  monitorSwitchBtn.addEventListener('click', () => {
    window.dexxyq.switchMonitor();
    setMascotSpeech('Прыгнул на другой экран! 🖥️');
  });
}

let isPinned = false;
let isExpanded = false;
let isStealth = false;
let isGhostPassThrough = false;
let isGameModeActive = false;
let collapseTimer = null;
let mediaControlMode = 'soundcloud';
let isMusicPlaying = false;
let activeTab = 'home';

function setGameModeUI(active, gameName) {
  isGameModeActive = !!active;
  island.classList.toggle('game-mode', isGameModeActive);
  if (gameModeBtn) {
    gameModeBtn.classList.toggle('game-active', isGameModeActive);
  }
  if (isGameModeActive) {
    setMascotSpeech(gameName ? tr("Игра: {0} 🎮", gameName) : tr('FPS Boost включён! 🎮'));
  } else {
    setMascotSpeech('Обычный режим ⚡');
  }
}

if (gameModeBtn) {
  window.dexxyq.getGameMode().then((res) => {
    if (res && res.active) setGameModeUI(true, '');
  });
  gameModeBtn.addEventListener('click', async () => {
    const res = await window.dexxyq.toggleGameMode();
    setGameModeUI(res.active, res.active ? 'FPS Boost' : '');
  });
}

window.dexxyq.onGameModeChanged((data) => {
  setGameModeUI(data.active, data.gameName);
});

if (autoStartBtn) {
  window.dexxyq.getAutoStart().then((enabled) => {
    autoStartBtn.classList.toggle('pinned', !!enabled);
  });
  autoStartBtn.addEventListener('click', async () => {
    const isNow = !autoStartBtn.classList.contains('pinned');
    await window.dexxyq.setAutoStart(isNow);
    autoStartBtn.classList.toggle('pinned', isNow);
    setMascotSpeech(isNow ? tr('Автозапуск с ПК включён! 🚀') : tr('Автозапуск выключен 💤'));
  });
}

const cpuHistory = new Array(22).fill(0);
const ramHistory = new Array(22).fill(0);

// =====================================================
// 1. ZERO-JANK HOVER, STEALTH & GHOST PASS-THROUGH ENGINE
// =====================================================
function expandIsland() {
  if (isGhostPassThrough) return;
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
  if (!isExpanded) {
    isExpanded = true;
    window.dexxyq.setIgnoreMouse(false);
    island.classList.remove('closed', 'stealth');
    island.classList.add('expanded');
    syncTelegramLayout();
    requestAnimationFrame(updateTabPill);
    syncStatsView();
    if (activeTab === 'clipboard') refreshClipboardNow();
    if (activeTab === 'home') refreshMediaState();
    if (activeTab === 'telegram') window.dispatchEvent(new Event('telegram-open'));
  }
}

function scheduleCollapse() {
  if (isPinned || island.querySelector('dialog[open]')) return;
  if (collapseTimer) clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => {
    if (island.querySelector('dialog[open]')) return;
    isExpanded = false;
    island.classList.remove('expanded');
    island.classList.add(isStealth ? 'stealth' : 'closed');
    syncTelegramLayout();
    syncStatsView();
  }, 220);
}

function toggleStealthMode(forceState) {
  document.getElementById('mascotSettings').close();
  document.getElementById('islandSettings').close();
  isStealth = typeof forceState === 'boolean' ? forceState : !isStealth;
  isPinned = false;
  pinToggleBtn.classList.remove('pinned');
  isExpanded = false;
  island.classList.remove('expanded', 'closed', 'stealth');
  island.classList.add(isStealth ? 'stealth' : 'closed');
  syncTelegramLayout();
  syncStatsView();
}

function syncTelegramLayout() {
  const expanded = isExpanded && activeTab === 'telegram';
  const viewer = document.getElementById('telegramPhotoViewer');
  if (!expanded && viewer?.open) viewer.close();
  if (island.classList.contains('telegram-expanded') === expanded) return;
  island.classList.toggle('telegram-expanded', expanded);
  window.dexxyq.setTelegramLayout(expanded);
}

// Right-click anywhere on the island -> immediately collapse into thin 6px Stealth Strip so browser tabs are free!
island.addEventListener('contextmenu', (e) => {
  if (e.target.closest('#mascotSettings')) return;
  e.preventDefault();
  toggleStealthMode(!isStealth);
});

if (stealthBtn) {
  stealthBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleStealthMode(true);
  });
}

window.dexxyq.onToggleStealth(() => {
  toggleStealthMode();
});

island.addEventListener('mouseenter', () => {
  if (isGhostPassThrough) return;
  // In stealth mode, require hovering the 6px top bar or clicking it
  expandIsland();
});
island.addEventListener('mouseleave', scheduleCollapse);

// Hold CTRL (or ALT) while moving mouse -> Ghost Pass-Through mode!
// Island turns 85% transparent and lets your clicks go straight through to browser tabs underneath!
let currentInside = false;
window.addEventListener('mousemove', (e) => {
  if (document.getElementById('mascotSettings').open || document.getElementById('islandSettings').open) return;
  if (e.ctrlKey || e.altKey) {
    if (!isGhostPassThrough) {
      isGhostPassThrough = true;
      island.classList.add('ghost-passthrough');
      isExpanded = false;
      island.classList.remove('expanded');
      island.classList.add(isStealth ? 'stealth' : 'closed');
      syncTelegramLayout();
      syncStatsView();
      currentInside = false;
      window.dexxyq.setIgnoreMouse(true);
    }
    return;
  } else if (isGhostPassThrough) {
    isGhostPassThrough = false;
    island.classList.remove('ghost-passthrough');
  }

  const rect = island.getBoundingClientRect();
  const pad = isStealth ? 2 : 6;
  const inside =
    e.clientX >= rect.left - pad &&
    e.clientX <= rect.right + pad &&
    e.clientY >= rect.top - 2 &&
    e.clientY <= rect.bottom + pad;

  if (inside !== currentInside) {
    currentInside = inside;
    window.dexxyq.setIgnoreMouse(!inside);
  }

  if (isExpanded && mascotCharacter.getAttribute('data-mood') !== 'sleep') {
    const mRect = mascotStage.getBoundingClientRect();
    const cx = mRect.left + mRect.width / 2;
    const cy = mRect.top + mRect.height / 2;
    const dx = Math.max(-2.2, Math.min(2.2, (e.clientX - cx) / 90));
    const dy = Math.max(-1.6, Math.min(1.6, (e.clientY - cy) / 70));
    ghostEyes.style.transform = `translate(${dx}px, ${dy}px)`;
    ghostMouth.style.transform = `translate(${dx * 0.5}px, ${dy * 0.5}px)`;
  }
});

// Drag the island left/right along the top of the screen by holding left-click on the closed bar or "dexxyq" logo!
let isDraggingIsland = false;
let dragLastScreenX = 0;

function startIslandDrag(e) {
  if (e.button !== 0) return;
  isDraggingIsland = true;
  dragLastScreenX = e.screenX;
}

if (brandBadge) {
  brandBadge.title = tr('Зажми ЛКМ и тяни на любой монитор! Двойной клик — по центру экрана');
  brandBadge.addEventListener('mousedown', startIslandDrag);
  brandBadge.addEventListener('dblclick', () => {
    window.dexxyq.resetIslandX();
    setMascotSpeech('Вернулся в центр! 🎯');
  });
}

if (closedBar) {
  closedBar.addEventListener('mousedown', startIslandDrag);
}

window.addEventListener('mousemove', (e) => {
  if (!isDraggingIsland) return;
  const dx = e.screenX - dragLastScreenX;
  if (Math.abs(dx) >= 2) {
    dragLastScreenX = e.screenX;
    window.dexxyq.moveIslandX(dx);
  }
});

window.addEventListener('mouseup', () => {
  isDraggingIsland = false;
});

pinToggleBtn.addEventListener('click', () => {
  isPinned = !isPinned;
  pinToggleBtn.classList.toggle('pinned', isPinned);
  setMascotSpeech(isPinned ? tr('Закрепил остров! 📌') : tr('Свободный режим 👻'));
});

quitBtn.addEventListener('click', () => {
  window.dexxyq.quitApp();
});

// =====================================================
// 2. INTERACTIVE PIXEL GHOST MASCOT CONTROLLER
// =====================================================
const mascotStage = document.getElementById('mascotStage');
const mascotCharacter = document.getElementById('mascotCharacter');
const mascotSpeech = document.getElementById('mascotSpeech');
const ghostEyes = document.getElementById('ghostEyes');
const ghostMouth = document.getElementById('ghostMouth');
const actionBtns = document.querySelectorAll('.m-act-btn[data-act]');
const mascotDefaults = { color: '#b85cff', accessory: 'none', phrase: '' };
const mascotSettingsKey = 'dexxyq.mascot';
const mascotAccessoryNames = Array.from(
  document.querySelectorAll('input[name="mascotAccessory"]'),
  option => option.value
);
let mascotAppearance = { ...mascotDefaults };
try {
  const saved = JSON.parse(localStorage.getItem(mascotSettingsKey));
  if (saved && /^#[a-f\d]{6}$/i.test(saved.color)) mascotAppearance.color = saved.color;
  if (mascotAccessoryNames.includes(saved?.accessory)) mascotAppearance.accessory = saved.accessory;
  if (typeof saved?.phrase === 'string') mascotAppearance.phrase = saved.phrase.trim().slice(0, 80);
} catch {}

const mascotSettings = document.getElementById('mascotSettings');
const mascotForm = document.getElementById('mascotSettingsForm');
const mascotColor = document.getElementById('mascotColor');
const mascotAccessory = mascotForm.elements.namedItem('mascotAccessory');
const mascotSwatches = mascotForm.querySelectorAll('[data-color]');
const mascotPhrase = document.getElementById('mascotPhrase');
const mascotPreview = document.getElementById('mascotSettingsPreview');
const mascotPreviewPhrase = document.getElementById('mascotPreviewPhrase');
const mascotSettingsStatus = document.getElementById('mascotSettingsStatus');
const mascotArt = mascotCharacter.querySelector('svg');
const miniMascotArt = document.querySelector('#miniMascotWrap svg');

for (const art of [mascotArt, miniMascotArt]) {
  for (const name of mascotAccessoryNames.slice(1)) {
    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    overlay.setAttribute('href', '#mascot-' + name);
    overlay.setAttribute('class', 'mascot-accessory ' + name);
    art.append(overlay);
  }
}
const previewArt = mascotArt.cloneNode(true);
previewArt.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
document.getElementById('mascotPreviewArt').append(previewArt);

function applyMascotAppearance(element, { color, accessory }) {
  element.style.setProperty('--mascot-color', color);
  element.dataset.accessory = accessory;
}

function updateMascotPreview() {
  const color = mascotColor.validity.valid ? mascotColor.value : mascotAppearance.color;
  for (const swatch of mascotSwatches) {
    swatch.setAttribute('aria-pressed', String(swatch.dataset.color === color.toLowerCase()));
  }
  applyMascotAppearance(mascotPreview, { color, accessory: mascotAccessory.value });
  mascotPreviewPhrase.textContent = mascotPhrase.value.trim() || tr('Хе-хе! Я тут 👾');
}

function fillMascotSettings({ color, accessory, phrase }) {
  mascotColor.value = color;
  mascotAccessory.value = accessory;
  mascotPhrase.value = phrase;
  mascotSettingsStatus.textContent = '';
  updateMascotPreview();
}

applyMascotAppearance(island, mascotAppearance);
if (mascotAppearance.phrase) mascotSpeech.textContent = mascotAppearance.phrase;

document.getElementById('mascotSettingsButton').addEventListener('click', () => {
  clearTimeout(collapseTimer);
  collapseTimer = null;
  currentInside = true;
  window.dexxyq.setIgnoreMouse(false);
  fillMascotSettings(mascotAppearance);
  mascotSettings.showModal();
});
document.getElementById('mascotSettingsCancel').addEventListener('click', () => mascotSettings.close());
document.getElementById('mascotSettingsReset').addEventListener('click', () => fillMascotSettings(mascotDefaults));
for (const swatch of mascotSwatches) {
  swatch.addEventListener('click', () => {
    mascotColor.value = swatch.dataset.color;
    updateMascotPreview();
  });
}
mascotForm.addEventListener('input', updateMascotPreview);
mascotForm.addEventListener('submit', event => {
  event.preventDefault();
  const appearance = { color: mascotColor.value, accessory: mascotAccessory.value, phrase: mascotPhrase.value.trim() };
  try {
    localStorage.setItem(mascotSettingsKey, JSON.stringify(appearance));
  } catch {
    mascotSettingsStatus.textContent = tr('Не удалось сохранить настройки.');
    return;
  }
  mascotAppearance = appearance;
  applyMascotAppearance(island, appearance);
  mascotSettings.close();
  setMascotSpeech(appearance.phrase || tr('Хе-хе! Я тут 👾'));
});
const mascotReactions = {
  laugh: { text: 'Муа-ха-ха! 😈', duration: 3000 },
  dance: { text: 'Вайб включён! 🎶', duration: 5000 },
  rage: { text: 'МАКСИМУМ МОЩИ! ⚡', duration: 3000 },
  sleep: { text: 'Zzz... сплю 💤', duration: 6000 },
  wave: { text: 'Приветик! 👋', duration: 2600 },
  surprised: { text: 'Вот это да! 😮', duration: 2400 },
  love: { text: 'Лови сердечко! 💗', duration: 3000 }
};

const IDLE_PHRASES = [
  'Хе-хе! Я тут 👾',
  'dexxyq на страже 💜',
  'Врубай SoundCloud! 🔥',
  'Кидай файлы на полку!',
  'Твой ПК летает ⚡',
  'Буу! Не пугайся 😈',
  'Что слушаем сегодня? 🎧'
];
const APPS_PHRASES = [
  'Что запускаем? 🚀',
  'Все нужные программы под рукой!',
  'Выбирай приложение, я открою! 👾'
];

let moodResetTimer = null;

function setMascotSpeech(text) {
  mascotSpeech.textContent = text === mascotAppearance.phrase ? text : tr(text);
  mascotSpeech.classList.remove('pop');
  void mascotSpeech.offsetWidth;
  mascotSpeech.classList.add('pop');
  setTimeout(() => mascotSpeech.classList.remove('pop'), 280);
}

function setMascotMood(mood, speechText, durationMs = 3500) {
  if (moodResetTimer) clearTimeout(moodResetTimer);
  mascotCharacter.setAttribute('data-mood', mood);
  if (speechText) setMascotSpeech(speechText);

  if (durationMs > 0) {
    moodResetTimer = setTimeout(() => {
      moodResetTimer = null;
      mascotCharacter.setAttribute('data-mood', isMusicPlaying ? 'dance' : 'idle');
    }, durationMs);
  }
}

// Click on the ghost mascot -> cycle fun reactions
mascotCharacter.addEventListener('click', () => {
  const reactions = [
    { mood: 'laugh', text: tr('Хе-хе-хе! 😈') },
    { mood: 'dance', text: tr('Качаем бит! 🎧') },
    { mood: 'rage', text: tr('УЛЬТРА-РЕЖИМ! ⚡') },
    ...['wave', 'surprised', 'love'].map(mood => ({ mood, text: mascotReactions[mood].text }))
  ];
  const pick = reactions[Math.floor(Math.random() * reactions.length)];
  setMascotMood(pick.mood, pick.text, 2800);
});

// Double click -> Super Overdrive
mascotCharacter.addEventListener('dblclick', () => {
  setMascotMood('rage', 'DEXXYQ OVERDRIVE!! 🔥', 3500);
});

// Quick action buttons under the mascot
actionBtns.forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const act = btn.getAttribute('data-act');
    const reaction = mascotReactions[act];
    if (reaction) setMascotMood(act, reaction.text, reaction.duration);
  });
});

// Random idle chatter every 12 seconds
setInterval(() => {
  if (!isExpanded) return;
  const currentMood = mascotCharacter.getAttribute('data-mood');
  if (currentMood === 'idle' || currentMood === 'dance') {
    const phrase = mascotAppearance.phrase || IDLE_PHRASES[Math.floor(Math.random() * IDLE_PHRASES.length)];
    setMascotSpeech(phrase);
  }
}, 12000);

// =====================================================
// 3. TABS NAVIGATION WITH GLIDING PILL
// =====================================================
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');
const tabPillIndicator = document.getElementById('tabPillIndicator');

function updateTabPill() {
  const activeBtn = document.querySelector('.tab-btn.active');
  if (!activeBtn || !tabPillIndicator) return;
  tabPillIndicator.style.width = `${activeBtn.offsetWidth}px`;
  tabPillIndicator.style.transform = `translateX(${activeBtn.offsetLeft - 3}px)`;
}

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.getAttribute('data-tab');
    activeTab = target;
    tabButtons.forEach((b) => b.classList.remove('active'));
    tabPanes.forEach((p) => p.classList.remove('active'));

    btn.classList.add('active');
    document.getElementById(`tab-${target}`).classList.add('active');
    document.getElementById('tab-apps').inert = target !== 'apps';
    document.getElementById('tab-telegram').inert = target !== 'telegram';
    syncTelegramLayout();
    if (target === 'telegram') {
      setMascotMood('curious', 'Ооо, сейчас посмотрим, с кем ты переписываешься! 👀', 3200);
      window.dispatchEvent(new Event('telegram-open'));
    }
    updateTabPill();

    // Toggle compact closed-bar mode: when "stats" (Система) is selected, show CPU + RAM + GPU in the closed bar!
    island.classList.toggle('stats-mode', target === 'stats');
    syncStatsView();

    // Mascot reacts to tab switches!
    if (target === 'home') {
      setMascotSpeech('Врубай музло! 🎧');
      refreshMediaState();
    }
    if (target === 'stats') {
      setMascotSpeech('Чекаю датчики ПК 📊');
    }
    if (target === 'shelf') setMascotSpeech('Кидай файлы мне! 📁');
    if (target === 'apps') {
      const phrase = APPS_PHRASES[Math.floor(Math.random() * APPS_PHRASES.length)];
      setMascotMood('wave', phrase, 2600);
      if (!pinnedAppsLoaded) updatePinnedApps('list');
    }
    if (target === 'clipboard') {
      setMascotSpeech('Помню всё, что скопировал 📋');
      refreshClipboardNow();
    }
  });
});

setTimeout(updateTabPill, 80);

// =====================================================
// 4. MULTI-SERVICE MEDIA CONTROLS (SoundCloud / Spotify / Yandex Music)
// =====================================================
const trackTitle = document.getElementById('trackTitle');
const trackArtist = document.getElementById('trackArtist');
const closedTrack = document.getElementById('closedTrack');
const artworkCard = document.getElementById('artworkCard');
const artworkImg = document.getElementById('artworkImg');
const sourceBadge = document.getElementById('sourceBadge');
const musicTabLabel = document.getElementById('musicTabLabel');
const srvPills = document.querySelectorAll('.srv-pill');
const timeCurrent = document.getElementById('timeCurrent');
const timeDuration = document.getElementById('timeDuration');
const progressBarFill = document.getElementById('progressBarFill');
const miniVisualizer = document.getElementById('miniVisualizer');
const largeVisualizer = document.getElementById('largeVisualizer');
const playIcon = document.getElementById('playIcon');

const btnShuffle = document.getElementById('btnShuffle');
const btnPrev = document.getElementById('btnPrev');
const btnPlayPause = document.getElementById('btnPlayPause');
const btnNext = document.getElementById('btnNext');
const btnLike = document.getElementById('btnLike');
const btnMute = document.getElementById('btnMute');
const volIcon = document.getElementById('volIcon');
const volSlider = document.getElementById('volSlider');
const scSearchInput = document.getElementById('scSearchInput');
const scOpenWindowBtn = document.getElementById('scOpenWindowBtn');

const SERVICE_META = {
  soundcloud: {
    name: 'SoundCloud',
    tabName: 'SoundCloud',
    badge: 'SOUNDCLOUD',
    shortBtn: 'SC',
    placeholder: 'Поиск в SC + Enter...',
    speech: 'SoundCloud включён! ☁️🔥',
    svg: '<svg viewBox="0 0 24 24" class="sc-big-icon"><path fill="currentColor" d="M11.56 8.87V17h8.76c1.85 0 3.35-1.5 3.35-3.35 0-1.69-1.25-3.09-2.88-3.32-.37-2.29-2.36-4.05-4.76-4.05-1.92 0-3.58 1.13-4.35 2.75-.04-.05-.08-.11-.12-.16zM8.9 10.15v6.85h1.32V9.5c-.47.14-.91.37-1.32.65zm-2.63 1.87V17h1.31v-5.38c-.47.1-.91.24-1.31.4zm-2.63 1.48V17h1.31v-3.7c-.46.04-.9.11-1.31.2z"/></svg>'
  },
  spotify: {
    name: 'Spotify',
    tabName: 'Spotify',
    badge: 'SPOTIFY',
    shortBtn: 'SP',
    placeholder: 'Открыть поиск Spotify + Enter...',
    speech: 'Spotify на связи! 💚🎧',
    svg: '<svg viewBox="0 0 24 24" class="sc-big-icon"><path fill="currentColor" d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.563.387-.857.207-2.348-1.435-5.304-1.76-8.785-.964-.335.077-.67-.133-.746-.469-.077-.335.132-.67.469-.746 3.809-.871 7.077-.496 9.713 1.115.293.18.386.563.206.857zm1.223-2.723c-.226.367-.706.482-1.073.257-2.687-1.652-6.785-2.131-9.965-1.166-.413.125-.848-.106-.973-.518-.125-.413.106-.849.518-.973 3.632-1.102 8.147-.568 11.236 1.328.366.226.481.707.257 1.072zm.105-2.835C14.692 8.95 9.375 8.775 6.297 9.71c-.493.15-1.016-.128-1.166-.62-.149-.493.129-1.016.621-1.166 3.532-1.073 9.404-.865 13.115 1.338.445.264.59.837.326 1.282-.264.444-.838.59-1.279.322z"/></svg>'
  },
  yandex: {
    name: 'Яндекс Музыка',
    tabName: 'Я.Музыка',
    badge: 'Я.МУЗЫКА',
    shortBtn: 'ЯМ',
    placeholder: 'Поиск в Я.Музыке + Enter...',
    speech: 'Яндекс Музыка включена! 💛🎶',
    svg: '<svg viewBox="0 0 24 24" class="sc-big-icon"><path fill="currentColor" d="M12 2l2.6 6.8L22 9.4l-5.6 4.7 1.8 7.1L12 17.3l-6.2 3.9 1.8-7.1L2 9.4l7.4-.6L12 2z"/></svg>'
  }
};

function applyServiceTheme(serviceId, announce = false) {
  const srv = SERVICE_META[serviceId] ? serviceId : 'soundcloud';
  mediaControlMode = srv;
  const meta = SERVICE_META[srv];

  if (artworkCard) artworkCard.setAttribute('data-service', srv);
  if (sourceBadge) sourceBadge.textContent = tr(meta.badge);
  if (musicTabLabel) {
    musicTabLabel.textContent = tr(meta.tabName);
    requestAnimationFrame(updateTabPill);
  }
  if (scSearchInput) scSearchInput.placeholder = tr(meta.placeholder);
  if (scOpenWindowBtn) {
    scOpenWindowBtn.textContent = tr(meta.shortBtn);
    scOpenWindowBtn.title = srv === 'spotify' ? tr('Открыть или полностью закрыть Spotify') : tr('ЛКМ — открыть окно {0} | ПКМ — выгрузить плеер из ОЗУ', tr(meta.name));
  }
  const spotifyUsesClientControls = srv === 'spotify';
  btnLike.disabled = spotifyUsesClientControls;
  btnLike.title = spotifyUsesClientControls ? tr('Лайк в приложении Spotify') : tr('Лайк в {0}', tr(meta.name));
  btnShuffle.title = tr('Перемешать / Рандом (2x клик — следующий трек в перемешанной очереди)');
  volSlider.title = spotifyUsesClientControls ? tr('Громкость Spotify в микшере Windows') : '';
  btnMute.title = tr('Выкл / Вкл звук');

  srvPills.forEach((p) => {
    p.classList.toggle('active', p.getAttribute('data-srv') === srv);
  });

  if (!artworkImg.dataset.artwork && artworkImg.dataset.iconService !== srv) {
    artworkImg.innerHTML = meta.svg;
    artworkImg.dataset.iconService = srv;
  }

  if (announce) {
    setMascotMood('dance', meta.speech, 2600);
  }
}

async function selectMediaService(serviceId) {
  if (!SERVICE_META[serviceId]) return;
  artworkImg.style.backgroundImage = '';
  delete artworkImg.dataset.artwork;
  applyServiceTheme(serviceId, true);
  const state = await window.dexxyq.setMediaService(serviceId);
  if (state) renderMediaStateObject(state);
}

srvPills.forEach((pill) => {
  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    const srv = pill.getAttribute('data-srv');
    selectMediaService(srv);
  });
});

if (sourceBadge) {
  sourceBadge.addEventListener('click', (e) => {
    e.stopPropagation();
    const order = ['soundcloud', 'spotify', 'yandex'];
    const next = order[(order.indexOf(mediaControlMode) + 1) % order.length];
    selectMediaService(next);
  });
}

let currentVolume = 80;
let isMuted = false;

function applyVolume(vol) {
  currentVolume = Math.max(0, Math.min(100, Math.round(vol)));
  volSlider.value = currentVolume;
  window.dexxyq.mediaAction({ action: 'setVolume', value: currentVolume, mode: mediaControlMode });

  if (currentVolume === 0) {
    volIcon.innerHTML = '<path fill="currentColor" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>';
  } else if (currentVolume < 50) {
    volIcon.innerHTML = '<path fill="currentColor" d="M7 9v6h4l5 5V4l-5 5H7zm9.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>';
  } else {
    volIcon.innerHTML = '<path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
  }
}

volSlider.addEventListener('input', (e) => {
  const val = Number(e.target.value);
  isMuted = val === 0;
  applyVolume(val);
  setMascotSpeech(tr("Громкость: {0}% 🔊", val));
});

// Allow mouse wheel scrolling over the volume control for ultra-convenient adjustment!
volSlider.parentElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (volSlider.disabled) return;
  const delta = e.deltaY < 0 ? 5 : -5;
  applyVolume(currentVolume + delta);
  setMascotSpeech(tr("Громкость: {0}% 🔊", currentVolume));
});

btnMute.addEventListener('click', () => {
  isMuted = !isMuted;
  if (isMuted) {
    btnMute.dataset.prevVol = currentVolume || 80;
    applyVolume(0);
    setMascotSpeech('Звук выключен 🔇');
  } else {
    applyVolume(Number(btnMute.dataset.prevVol) || 80);
    setMascotSpeech(tr("Громкость: {0}% 🔊", currentVolume));
  }
});

btnShuffle.addEventListener('click', () => {
  if (mediaControlMode === 'spotify') {
    clearTimeout(spotifyShuffleClick);
    spotifyShuffleClick = setTimeout(() => applySpotifyShuffle('shuffle'), 260);
    return;
  }
  btnShuffle.classList.toggle('active-toggle');
  const active = btnShuffle.classList.contains('active-toggle');
  window.dexxyq.mediaAction({ action: 'shuffle', mode: mediaControlMode });
  setMascotMood('dance', active ? tr('Рандом включён! 🔀') : tr('По порядку ▶️'), 2600);
  setTimeout(refreshMediaState, 350);
});

let spotifyShuffleClick;
async function applySpotifyShuffle(action) {
  if (mediaControlMode !== 'spotify') return;
  await window.dexxyq.mediaAction({ action, mode: 'spotify' });
  if (mediaControlMode === 'spotify') await refreshMediaState();
}

let mediaRefreshTimer = null;
function scheduleMediaRefresh(delay = 360) {
  if (mediaRefreshTimer) clearTimeout(mediaRefreshTimer);
  mediaRefreshTimer = setTimeout(() => {
    mediaRefreshTimer = null;
    refreshMediaState();
  }, delay);
}

btnShuffle.addEventListener('dblclick', (e) => {
  e.stopPropagation();
  if (mediaControlMode === 'spotify') {
    clearTimeout(spotifyShuffleClick);
    applySpotifyShuffle('randomTrack');
    return;
  }
  btnShuffle.classList.add('active-toggle');
  window.dexxyq.mediaAction({ action: 'randomTrack', mode: mediaControlMode });
  setMascotMood('dance', 'Случайный трек! 🎲', 2800);
  scheduleMediaRefresh(420);
});

btnPlayPause.addEventListener('click', () => {
  window.dexxyq.mediaAction({ action: 'playPause', mode: mediaControlMode });
  scheduleMediaRefresh(300);
});

btnNext.addEventListener('click', () => {
  window.dexxyq.mediaAction({ action: 'next', mode: mediaControlMode });
  setMascotMood('dance', 'Следующий бэнгер! ⏭️', 2500);
  scheduleMediaRefresh(380);
});

btnPrev.addEventListener('click', () => {
  window.dexxyq.mediaAction({ action: 'prev', mode: mediaControlMode });
  scheduleMediaRefresh(380);
});

btnLike.addEventListener('click', () => {
  btnLike.classList.toggle('liked');
  window.dexxyq.mediaAction({ action: 'like', mode: mediaControlMode });
  setMascotMood('laugh', 'Лайк поставлен! 💜', 2500);
});

scOpenWindowBtn.addEventListener('click', async () => {
  if (mediaControlMode === 'spotify') {
    await window.dexxyq.mediaAction({ action: 'openWindow', mode: 'spotify' });
    if (mediaControlMode === 'spotify') await refreshMediaState();
    return;
  }
  const meta = SERVICE_META[mediaControlMode] || SERVICE_META.soundcloud;
  window.dexxyq.mediaAction({ action: 'openWindow', mode: mediaControlMode });
  setMascotSpeech(tr('Открываю {0}… 🎶', tr(meta.name)));
});

scOpenWindowBtn.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (mediaControlMode === 'spotify') return;
  window.dexxyq.mediaAction({ action: 'unloadWindow', mode: mediaControlMode });
  setMascotSpeech('Выгрузил плеер, ОЗУ очищена! 🧹⚡');
});

scSearchInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter' && scSearchInput.value.trim()) {
    const query = scSearchInput.value.trim();
    const meta = SERVICE_META[mediaControlMode] || SERVICE_META.soundcloud;
    if (mediaControlMode === 'spotify') {
      scSearchInput.value = '';
      setMascotSpeech('Открываю поиск в Spotify… 🔎');
      await window.dexxyq.mediaAction({ action: 'searchAndPlay', value: query, mode: 'spotify' });
      scheduleMediaRefresh(250);
      return;
    }
    trackTitle.textContent = tr("Поиск: {0}...", query);
    trackArtist.textContent = tr('Ищу трек в {0}...', tr(meta.name));
    setMascotMood('dance', tr("Ищу \"{0}\"! 🔎", query), 4000);
    scSearchInput.value = '';
    await window.dexxyq.mediaAction({ action: 'searchAndPlay', value: query, mode: mediaControlMode });
    scheduleMediaRefresh(250);
  }
});

function renderMediaStateObject(state) {
  if (!state) return;
  if (state.service && state.service !== mediaControlMode) {
    applyServiceTheme(state.service, false);
  }
  const meta = SERVICE_META[mediaControlMode] || SERVICE_META.soundcloud;

  trackTitle.textContent = !state.title || state.title.startsWith('dexxyq ') ? `dexxyq ${tr(meta.name)}` : state.title;
  trackArtist.textContent = state.artist ? tr(state.artist) : tr('Введи трек в поиск ниже и нажми Enter');
  const isDefaultTitle =
    !state.title ||
    state.title.startsWith('dexxyq ') ||
    state.title === 'SoundCloud Ready';
  closedTrack.textContent = !isDefaultTitle ? state.title : 'dexxyq';

  timeCurrent.textContent = state.currentTime || '0:00';
  timeDuration.textContent = state.duration || '0:00';
  progressBarFill.style.width = `${Math.min(100, Math.max(0, state.progress || 0))}%`;

  if (state.artwork) {
    if (artworkImg.dataset.artwork !== state.artwork) {
      artworkImg.style.backgroundImage = `url("${state.artwork}")`;
      artworkImg.replaceChildren();
      artworkImg.dataset.artwork = state.artwork;
      delete artworkImg.dataset.iconService;
    }
  } else {
    delete artworkImg.dataset.artwork;
    if (artworkImg.dataset.iconService !== mediaControlMode) {
      artworkImg.style.backgroundImage = '';
      artworkImg.innerHTML = meta.svg;
      artworkImg.dataset.iconService = mediaControlMode;
    }
  }

  const playing = !!state.isPlaying;
  if (playing !== isMusicPlaying) {
    isMusicPlaying = playing;
    miniVisualizer.classList.toggle('playing', playing);
    largeVisualizer.classList.toggle('playing', playing);
    playIcon.innerHTML = playing
      ? '<path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
      : '<path fill="currentColor" d="M8 5v14l11-7z"/>';
  }
  if (state.isShuffled != null) {
    btnShuffle.classList.toggle('active-toggle', !!state.isShuffled);
  }
  if (state.isLiked != null) {
    btnLike.classList.toggle('liked', !!state.isLiked);
  }
  if (state.isPlaying) {
    if (mascotCharacter.getAttribute('data-mood') === 'idle') {
      mascotCharacter.setAttribute('data-mood', 'dance');
    }
  } else {
    if (mascotCharacter.getAttribute('data-mood') === 'dance' && !moodResetTimer) {
      mascotCharacter.setAttribute('data-mood', 'idle');
    }
  }
}

async function refreshMediaState() {
  const state = await window.dexxyq.getMediaState();
  if (state) renderMediaStateObject(state);
}

refreshMediaState();

let mediaTick = 0;
setInterval(() => {
  if (isStealth && !isExpanded) return;
  if (isGameModeActive && !isExpanded) return;
  if (isExpanded && activeTab !== 'home') return;
  mediaTick++;
  if (!isExpanded && mediaTick % 2 !== 0) return;
  refreshMediaState();
}, 2000);

// =====================================================
// 5. SYSTEM STATS
// =====================================================
const CIRCUMFERENCE = 2 * Math.PI * 32;

function setRingProgress(el, percent) {
  const clamped = Math.min(100, Math.max(0, percent));
  const offset = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE;
  el.style.strokeDashoffset = offset;
}

function drawSparkline(canvasId, data, strokeColor) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.beginPath();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.8;

  const step = w / (data.length - 1);
  data.forEach((val, idx) => {
    const x = idx * step;
    const y = h - (Math.min(100, Math.max(0, val)) / 100) * (h - 4) - 2;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

let selectedDiskIdx = 0;

function formatNetSpeed(kbs) {
  if (!kbs || kbs <= 0) return '0 ' + tr('КБ/с');
  if (kbs >= 1024) return `${(kbs / 1024).toFixed(1)} ${tr('МБ/с')}`;
  return `${kbs} ${tr('КБ/с')}`;
}

async function refreshSystemStats() {
  const stats = await window.dexxyq.getStats();
  if (!stats) return;

  document.getElementById('closedCpuPill').textContent = `CPU ${stats.cpu.usage}%`;
  const ramPill = document.getElementById('closedRamPill');
  const gpuPill = document.getElementById('closedGpuPill');
  if (ramPill) ramPill.textContent = `RAM ${stats.memory.usage}%`;
  if (gpuPill) gpuPill.textContent = `GPU ${stats.gpu.usage}%`;

  if (!isExpanded || activeTab !== 'stats') return;

  document.getElementById('cpuVal').textContent = `${stats.cpu.usage}%`;
  const cpuSubEl = document.getElementById('cpuSub');
  if (cpuSubEl && stats.cpu.name) cpuSubEl.textContent = stats.cpu.name;
  setRingProgress(document.getElementById('cpuRing'), stats.cpu.usage);
  cpuHistory.push(stats.cpu.usage);
  cpuHistory.shift();
  drawSparkline('cpuSparkline', cpuHistory, '#38bdf8');

  document.getElementById('ramVal').textContent = `${stats.memory.usage}%`;
  document.getElementById('ramSub').textContent = `${stats.memory.usedGB} / ${stats.memory.totalGB} ${tr('ГБ')}`;
  setRingProgress(document.getElementById('ramRing'), stats.memory.usage);
  ramHistory.push(stats.memory.usage);
  ramHistory.shift();
  drawSparkline('ramSparkline', ramHistory, '#b85cff');

  document.getElementById('gpuVal').textContent = `${stats.gpu.usage}%`;
  document.getElementById('gpuSub').textContent = stats.gpu.name;
  setRingProgress(document.getElementById('gpuRing'), stats.gpu.usage);
  document.getElementById('netDownPill').textContent = `↓ ${formatNetSpeed(stats.network.downKBs)}`;
  document.getElementById('netUpPill').textContent = `↑ ${formatNetSpeed(stats.network.upKBs)}`;

  const drives = Array.isArray(stats.disk.drives) && stats.disk.drives.length > 0
    ? stats.disk.drives
    : [{ letter: 'C', usage: stats.disk.usage, usedGB: stats.disk.usedGB, totalGB: stats.disk.totalGB }];
  const activeDrive = drives[selectedDiskIdx % drives.length] || drives[0];
  const otherDrive = drives.length > 1 ? drives[(selectedDiskIdx + 1) % drives.length] : null;

  document.getElementById('diskVal').textContent = `${activeDrive.usage}%`;
  document.getElementById('diskSub').textContent = `${activeDrive.letter}: ${activeDrive.usedGB} / ${activeDrive.totalGB} ${tr('ГБ')}`;
  setRingProgress(document.getElementById('diskRing'), activeDrive.usage);

  const batPillEl = document.getElementById('batPill');
  if (batPillEl) {
    if (otherDrive) {
      batPillEl.textContent = `💾 ${otherDrive.letter}: ${otherDrive.usedGB}/${otherDrive.totalGB} ${tr('ГБ')}`;
      batPillEl.title = tr('Нажми, чтобы переключить отображаемый диск');
      batPillEl.style.cursor = 'pointer';
    } else {
      const batIcon = stats.battery.isCharging ? '⚡' : '🔋';
      batPillEl.textContent = `${batIcon} ${stats.battery.percent}%`;
    }
  }
}

const batPillClickEl = document.getElementById('batPill');
if (batPillClickEl) {
  batPillClickEl.addEventListener('click', () => {
    selectedDiskIdx++;
    refreshSystemStats();
  });
}

let statsView;
let statsTimer;
function syncStatsView() {
  const view = isExpanded ? (activeTab === 'stats' ? 'full' : 'hidden')
    : isStealth ? 'hidden' : activeTab === 'stats' ? 'compact' : 'cpu';
  if (view === statsView) return;
  statsView = view;
  window.dexxyq.setStatsView(view);
  clearInterval(statsTimer);
  if (view === 'hidden') return;
  refreshSystemStats();
  let ticks = 0;
  statsTimer = setInterval(() => {
    ticks++;
    if (isGameModeActive && !isExpanded && ticks % (view === 'cpu' ? 2 : 4) !== 0) return;
    refreshSystemStats();
  }, view === 'cpu' ? 4000 : 2000);
}
syncStatsView();

// =====================================================
// 6. FILE SHELF (Drag IN & Drag OUT to Desktop / Discord / Telegram!)
// =====================================================
const shelfDropZone = document.getElementById('shelfDropZone');
const shelfItemsGrid = document.getElementById('shelfItemsGrid');
const shelfFileInput = document.getElementById('shelfFileInput');
const shelfClearBtn = document.getElementById('shelfClearBtn');
const shelfCounter = document.getElementById('shelfCounter');
let isDraggingFromShelf = false;

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 Б';
  const k = 1024;
  const sizes = [tr('Б'), tr('КБ'), tr('МБ'), tr('ГБ')];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function serializeFileList(fileList) {
  const results = [];
  for (const f of Array.from(fileList)) {
    const resolvedPath = window.dexxyq.getFilePath ? window.dexxyq.getFilePath(f) : (f.path || '');
    let base64 = '';
    if (!resolvedPath && f.size && f.size < 25 * 1024 * 1024) {
      try {
        const ab = await f.arrayBuffer();
        const bytes = new Uint8Array(ab);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        base64 = btoa(binary);
      } catch (e) {}
    }
    results.push({
      name: f.name,
      path: resolvedPath,
      size: f.size,
      base64
    });
  }
  return results;
}

function renderShelfItems(items) {
  shelfCounter.textContent = items.length;
  shelfItemsGrid.innerHTML = '';

  if (items.length === 0) {
    shelfItemsGrid.innerHTML = `<div style="color: rgba(255,255,255,0.38); font-size: 11.5px; margin: auto;">${tr('Полка пуста — перетащи сюда файлы с рабочего стола или обратно!')}</div>`;
    return;
  }

  items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'shelf-card';
    card.draggable = true;
    card.title = tr('Зажми ЛКМ и вытащи файл на Рабочий стол / в Discord / в проводник! Двойной клик — открыть, ПКМ — скопировать файл (Ctrl+V)');

    const extLabel = (item.ext || '.file').replace('.', '');
    card.innerHTML = `
      <div class="shelf-card-top">
        <span class="shelf-ext">${extLabel}</span>
        <div style="display:flex; gap:4px; align-items:center;">
          <button class="shelf-del shelf-copy" title="${tr('Скопировать файл в буфер (для Ctrl+V)')}" style="font-size:11px;">📋</button>
          <button class="shelf-del shelf-rm" title="${tr('Убрать с полки')}">✕</button>
        </div>
      </div>
      <div class="shelf-name">${item.name}</div>
      <div class="shelf-size">${formatBytes(item.size)} • ${item.addedAt || ''}</div>
    `;

    card.querySelector('.shelf-rm').addEventListener('click', async (e) => {
      e.stopPropagation();
      const updated = await window.dexxyq.removeShelfItem(item.id);
      renderShelfItems(updated);
    });

    card.querySelector('.shelf-copy').addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.dexxyq.copyShelfFileToClipboard(item.exportPath || item.storedPath);
      setMascotSpeech('Файл скопирован! Жми Ctrl+V 📋');
    });

    card.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await window.dexxyq.copyShelfFileToClipboard(item.exportPath || item.storedPath);
      setMascotSpeech('Файл скопирован! Жми Ctrl+V 📋');
    });

    card.addEventListener('dblclick', () => {
      window.dexxyq.openShelfFile(item.storedPath);
    });

    card.addEventListener('dragstart', (e) => {
      e.preventDefault();
      isDraggingFromShelf = true;
      if (collapseTimer) {
        clearTimeout(collapseTimer);
        collapseTimer = null;
      }
      setMascotSpeech('Тащи файл куда нужно! 📤');
      window.dexxyq.startDrag(item);
      setTimeout(() => {
        isDraggingFromShelf = false;
      }, 1500);
    });

    shelfItemsGrid.appendChild(card);
  });
}

window.addEventListener('dragover', (e) => {
  if (isDraggingFromShelf) return;
  e.preventDefault();
  if (!isExpanded) {
    expandIsland();
    document.querySelector('[data-tab="shelf"]').click();
  }
  const overApps = activeTab === 'apps' && appsDropZone.contains(e.target);
  appsDropZone.classList.toggle('drag-over', overApps);
  shelfDropZone.classList.toggle('drag-over', !overApps);
});

window.addEventListener('dragleave', () => {
  shelfDropZone.classList.remove('drag-over');
  appsDropZone.classList.remove('drag-over');
});

window.addEventListener('drop', async (e) => {
  e.preventDefault();
  shelfDropZone.classList.remove('drag-over');
  appsDropZone.classList.remove('drag-over');
  if (isDraggingFromShelf) {
    isDraggingFromShelf = false;
    return;
  }
  if (!e.dataTransfer || !e.dataTransfer.files.length) return;
  if (activeTab === 'apps' && appsDropZone.contains(e.target)) {
    await updatePinnedApps('drop', Array.from(e.dataTransfer.files, file => window.dexxyq.getFilePath(file)));
    return;
  }

  const files = await serializeFileList(e.dataTransfer.files);
  await addFilesToShelf(files, 'Ням! Спрятал файл 👾');
});

shelfFileInput.addEventListener('change', async (e) => {
  const files = await serializeFileList(e.target.files);
  await addFilesToShelf(files, 'Файл на полке! 📁');
});

async function addFilesToShelf(files, singleFilePhrase) {
  if (!files.length) return;
  const { items, added } = await window.dexxyq.addShelfFiles(files);
  renderShelfItems(items);
  if (added > 1) setMascotMood('surprised', tr("Ого, файлов: {0}! 😮", added), 2400);
  else if (added === 1) setMascotMood('laugh', singleFilePhrase, 2800);
}

shelfClearBtn.addEventListener('click', async () => {
  const updated = await window.dexxyq.clearShelf();
  renderShelfItems(updated);
  setMascotSpeech('Полка чиста! ✨');
});

window.dexxyq.getShelf().then(renderShelfItems);

const appsDropZone = document.getElementById('appsDropZone');
const appsList = document.getElementById('pinnedAppsList');
const appsStatus = document.getElementById('appsStatus');
const addAppButton = document.getElementById('addPinnedApp');
let pinnedAppsLoaded = false;
let appsActionPending = false;

function renderPinnedApps(apps) {
  appsList.replaceChildren(...apps.map(({ file, name, icon }) => {
    const tile = document.createElement('div');
    tile.className = 'pinned-app';

    const launch = document.createElement('button');
    launch.className = 'btn-small pinned-app-launch';
    launch.type = 'button';
    launch.title = file;
    launch.setAttribute('aria-label', tr("Открыть {0}", name));
    const image = document.createElement(icon ? 'img' : 'span');
    if (icon) {
      image.src = icon;
      image.alt = '';
    } else {
      image.textContent = '▦';
      image.setAttribute('aria-hidden', 'true');
    }
    const label = document.createElement('span');
    label.className = 'pinned-app-name';
    label.textContent = name;
    launch.append(image, label);
    launch.addEventListener('click', () => updatePinnedApps('launch', file));

    const remove = document.createElement('button');
    remove.className = 'icon-btn danger pinned-app-remove';
    remove.type = 'button';
    remove.title = tr("Открепить {0}", name);
    remove.setAttribute('aria-label', remove.title);
    remove.textContent = '×';
    remove.addEventListener('click', () => updatePinnedApps('remove', file));
    tile.append(launch, remove);
    return tile;
  }));
}

async function updatePinnedApps(action, value) {
  if (appsActionPending) return;
  appsActionPending = true;
  addAppButton.disabled = true;
  try {
    const result = await window.dexxyq.pinnedApps(action, value);
    if (result.apps) {
      pinnedAppsLoaded = true;
      renderPinnedApps(result.apps);
    }
    appsStatus.textContent = result.error ? tr(result.error) : tr('Перетащи сюда .exe или ярлык .lnk');
    if (action === 'launch' && !result.error && activeTab === 'apps') {
      setMascotMood('wave', 'Приложение открывается! 👋', 2600);
    }
  } catch {
    appsStatus.textContent = tr('Не удалось выполнить действие.');
  } finally {
    appsActionPending = false;
    addAppButton.disabled = false;
  }
}

addAppButton.addEventListener('click', () => updatePinnedApps('pick'));

// =====================================================
// 7. CLIPBOARD HISTORY MANAGER (Text + Screenshots!)
// =====================================================
const clipList = document.getElementById('clipList');
const clipSearchInput = document.getElementById('clipSearchInput');
const clipPasteBtn = document.getElementById('clipPasteBtn');
const clipClearBtn = document.getElementById('clipClearBtn');
const clipCounter = document.getElementById('clipCounter');

let allClips = [];

async function refreshClipboardNow() {
  const data = await window.dexxyq.getClipboard();
  allClips = data || [];
  renderClips();
}

function renderClips() {
  const filter = (clipSearchInput.value || '').toLowerCase();
  const filtered = allClips.filter((c) => (c.text || '').toLowerCase().includes(filter));
  clipCounter.textContent = allClips.length;
  clipList.innerHTML = '';

  if (filtered.length === 0) {
    clipList.innerHTML = `<div style="color: rgba(255,255,255,0.45); font-size: 11.5px; text-align:center; padding-top: 26px;">${tr('Скопируй любой текст (Ctrl+C) или скриншот (Win+Shift+S), и он появится здесь!')}</div>`;
    return;
  }

  filtered.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'clip-item';

    const leftWrap = document.createElement('div');
    leftWrap.style.display = 'flex';
    leftWrap.style.alignItems = 'center';
    leftWrap.style.gap = '8px';
    leftWrap.style.overflow = 'hidden';

    if (item.type === 'image' && item.previewUrl) {
      const thumb = document.createElement('img');
      thumb.src = item.previewUrl;
      thumb.style.width = '32px';
      thumb.style.height = '24px';
      thumb.style.objectFit = 'cover';
      thumb.style.borderRadius = '5px';
      thumb.style.border = '1px solid rgba(184,92,255,0.4)';
      leftWrap.appendChild(thumb);
    }

    const textSpan = document.createElement('div');
    textSpan.className = 'clip-text';
    textSpan.textContent = item.text;
    leftWrap.appendChild(textSpan);

    const metaDiv = document.createElement('div');
    metaDiv.className = 'clip-meta';
    metaDiv.innerHTML = `<span class="clip-time">${item.time}</span>`;

    const delBtn = document.createElement('button');
    delBtn.className = 'shelf-del';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      allClips = await window.dexxyq.deleteClipboard(item.id);
      renderClips();
    });

    metaDiv.appendChild(delBtn);
    row.appendChild(leftWrap);
    row.appendChild(metaDiv);

    row.addEventListener('click', async () => {
      if (item.type === 'image' && item.fullDataUrl) {
        try {
          const res = await fetch(item.fullDataUrl);
          const blob = await res.blob();
          const pngBlob = blob.type === 'image/png' ? blob : new Blob([await blob.arrayBuffer()], { type: 'image/png' });
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
        } catch (err) {}
      }
      await window.dexxyq.copyClipboard(item);
      setMascotSpeech('Скопировал обратно! 📋');
      textSpan.style.color = '#d8b4fe';
      const orig = item.text;
      textSpan.textContent = tr('✓ Скопировано: ') + orig;
      setTimeout(() => {
        textSpan.style.color = '';
        textSpan.textContent = orig;
      }, 900);
    });

    clipList.appendChild(row);
  });
}

clipSearchInput.addEventListener('input', renderClips);

clipSearchInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter' && clipSearchInput.value.trim()) {
    allClips = await window.dexxyq.addManualClipboard(clipSearchInput.value.trim());
    clipSearchInput.value = '';
    renderClips();
    setMascotMood('laugh', 'Записал в буфер! 📋', 2500);
  }
});

if (clipPasteBtn) {
  clipPasteBtn.addEventListener('click', async () => {
    await refreshClipboardNow();
    setMascotSpeech('Обновил буфер! 📋');
  });
}

clipClearBtn.addEventListener('click', async () => {
  allClips = await window.dexxyq.clearClipboard();
  renderClips();
  setMascotSpeech('Буфер очищен! 🧹');
});

window.dexxyq.onClipboardUpdated((data) => {
  allClips = data || [];
  if (isExpanded && activeTab === 'clipboard') renderClips();
});

window.addEventListener('island-language-change', () => {
  applyServiceTheme(mediaControlMode);
  refreshMediaState();
  if (activeTab === 'stats') refreshSystemStats();
  if (activeTab === 'shelf') window.dexxyq.getShelf().then(renderShelfItems);
  if (activeTab === 'clipboard') renderClips();
  if (activeTab === 'apps') updatePinnedApps('list');
  setMascotSpeech(mascotAppearance.phrase || 'Хе-хе! Я тут 👾');
  requestAnimationFrame(updateTabPill);
});
