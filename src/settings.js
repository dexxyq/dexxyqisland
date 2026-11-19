const settingsDialog = document.getElementById('islandSettings');
const shortcutList = document.getElementById('islandShortcutList');
const settingsStatus = document.getElementById('islandSettingsStatus');
const settingsForm = document.getElementById('islandSettingsForm');
const islandLanguage = settingsForm.elements.namedItem('islandLanguage');
const toolbarList = document.getElementById('islandToolbarList');
const shortcutActions = {
  search: ['Поиск по острову', 'islandToolsButton'],
  home: ['Музыка', 'tab:home'], stats: ['Система', 'tab:stats'], shelf: ['Полка', 'tab:shelf'],
  clipboard: ['Буфер', 'tab:clipboard'], apps: ['Приложения', 'tab:apps'], telegram: ['Telegram', 'tab:telegram'],
  aot: ['Поверх всех окон', 'aotToggleBtn'], monitor: ['Сменить монитор', 'monitorSwitchBtn'],
  game: ['FPS Boost', 'gameModeBtn'], autostart: ['Автозапуск', 'autoStartBtn'],
  stealth: ['Скрыть / показать остров', 'stealthBtn'], pin: ['Закрепить открытым', 'pinToggleBtn']
};
const toolbarButtons = [
  ...Object.values(shortcutActions).filter(([, target]) => !target.startsWith('tab:') && target !== 'islandToolsButton'),
  ['Закрыть dexxyq', 'quitBtn']
];
const toolbarSettingsKey = 'dexxyq.hiddenToolbarButtons';
let hiddenToolbarButtons = new Set();
try {
  const storedIds = JSON.parse(localStorage.getItem(toolbarSettingsKey));
  if (Array.isArray(storedIds)) {
    hiddenToolbarButtons = new Set(toolbarButtons.map(([, id]) => id).filter(id => storedIds.includes(id)));
  }
} catch {}

function applyToolbarVisibility() {
  for (const [, id] of toolbarButtons) {
    document.getElementById(id).hidden = hiddenToolbarButtons.has(id);
  }
  requestAnimationFrame(updateTabPill);
}

function showToolbarOptions() {
  toolbarList.replaceChildren(...toolbarButtons.map(([label, id]) => {
    const option = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = id;
    checkbox.checked = !hiddenToolbarButtons.has(id);
    option.append(checkbox, tr(label));
    return option;
  }));
}

applyToolbarVisibility();

window.dexxyq.onGlobalAction((action, accelerator) => {
  if (settingsDialog.open && shortcutList.contains(document.activeElement) && document.activeElement.matches('input')) {
    document.activeElement.value = accelerator;
    return;
  }
  const target = shortcutActions[action]?.[1];
  if (!target || island.querySelector('dialog[open]')) return;
  if (action === 'stealth') {
    toggleStealthMode();
  } else if (target.startsWith('tab:')) {
    isGhostPassThrough = false;
    island.classList.remove('ghost-passthrough');
    if (isStealth) toggleStealthMode(false);
    expandIsland();
    document.querySelector(`[data-tab="${target.slice(4)}"]`).click();
  } else {
    if (action === 'search') {
      isGhostPassThrough = false;
      island.classList.remove('ghost-passthrough');
      if (isStealth) toggleStealthMode(false);
      expandIsland();
    }
    if (action === 'pin' && !isPinned) expandIsland();
    document.getElementById(target).click();
  }
});

function shortcutInput(action, label, value) {
  const row = document.createElement('label');
  const name = document.createElement('span');
  name.textContent = tr(label);
  const input = document.createElement('input');
  input.name = action;
  input.value = value || '';
  input.placeholder = tr('Не задано');
  input.readOnly = true;
  input.addEventListener('keydown', event => {
    if (event.key === 'Tab' || event.key === 'Escape') return;
    event.preventDefault();
    if (event.key === 'Backspace' || event.key === 'Delete') {
      input.value = '';
      return;
    }
    const key = event.code === 'Space' ? 'Space' : /^(Key[A-Z]|Digit[0-9])$/.test(event.code) ? event.code.at(-1) : event.key;
    const modifiers = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super'].filter(Boolean);
    if (/^F(?:[1-9]|1[0-2])$/.test(key) || (modifiers.length && /^(?:[A-Z0-9]|Space)$/.test(key))) {
      input.value = [...modifiers, key].join('+');
    }
  });
  row.append(name, input);
  return row;
}

document.getElementById('islandSettingsButton').addEventListener('click', async () => {
  if (settingsDialog.open) return;
  clearTimeout(collapseTimer);
  window.dexxyq.setIgnoreMouse(false);
  islandLanguage.value = document.documentElement.lang;
  showToolbarOptions();
  settingsStatus.textContent = '';
  shortcutList.replaceChildren();
  const save = settingsForm.querySelector('[type=submit]');
  save.disabled = true;
  settingsDialog.showModal();
  try {
    const values = await window.dexxyq.getShortcuts();
    shortcutList.replaceChildren(...Object.entries(shortcutActions).map(([action, [label]]) =>
      shortcutInput(action, label, values[action])));
    save.disabled = false;
  } catch {
    settingsStatus.textContent = tr('Не удалось загрузить горячие клавиши.');
  }
});
document.getElementById('islandSettingsClose').addEventListener('click', () => settingsDialog.close());

settingsForm.addEventListener('submit', async event => {
  event.preventDefault();
  const save = settingsForm.querySelector('[type=submit]');
  if (save.disabled) return;
  save.disabled = true;
  try {
    const result = await window.dexxyq.saveShortcuts(Object.fromEntries(new FormData(settingsForm)));
    if (result.error) {
      const label = tr(shortcutActions[result.action]?.[0] || '');
      settingsStatus.textContent = [label, tr({
        duplicate: 'Сочетание уже назначено.',
        unavailable: 'Сочетание занято в Windows или другом приложении.',
        invalid: 'Недопустимое сочетание.',
        save: 'Не удалось сохранить настройки.'
      }[result.error])].filter(Boolean).join(' · ');
      return;
    }
    const hiddenIds = Array.from(toolbarList.querySelectorAll('input:not(:checked)'), checkbox => checkbox.value);
    localStorage.setItem(toolbarSettingsKey, JSON.stringify(hiddenIds));
    hiddenToolbarButtons = new Set(hiddenIds);
    applyToolbarVisibility();
    setIslandLanguage(islandLanguage.value);
    settingsDialog.close();
  } catch {
    settingsStatus.textContent = tr('Не удалось сохранить настройки.');
  } finally {
    save.disabled = false;
  }
});

const islandTooltip = document.createElement('div');
islandTooltip.id = 'islandTooltip';
islandTooltip.setAttribute('role', 'tooltip');
islandTooltip.setAttribute('popover', 'manual');
document.body.append(islandTooltip);
const tooltipTitles = new WeakMap();
let tooltipTarget;
let tooltipTimer;

function hideIslandTooltip() {
  clearTimeout(tooltipTimer);
  if (islandTooltip.matches(':popover-open')) islandTooltip.hidePopover();
  tooltipTarget = undefined;
}

function queueIslandTooltip(element) {
  let target = element instanceof Element ? element.closest('[title], [data-island-tooltip]') : null;
  if (target && !island.contains(target)) target = null;
  if (target === tooltipTarget && !target?.hasAttribute('title')) return;
  hideIslandTooltip();
  if (!target) return;
  if (target.hasAttribute('title')) {
    tooltipTitles.set(target, target.getAttribute('title'));
    target.removeAttribute('title');
    target.setAttribute('data-island-tooltip', '');
  }
  const label = tooltipTitles.get(target);
  if (!label) return;
  tooltipTarget = target;
  tooltipTimer = setTimeout(() => {
    if (!target.isConnected || !target.getClientRects().length) return;
    islandTooltip.textContent = tr(label);
    islandTooltip.showPopover();
    const rect = target.getBoundingClientRect();
    const tip = islandTooltip.getBoundingClientRect();
    islandTooltip.style.left = Math.max(8, Math.min(rect.left + (rect.width - tip.width) / 2, innerWidth - tip.width - 8)) + 'px';
    const below = rect.bottom + 6;
    islandTooltip.style.top = (below + tip.height <= innerHeight - 8 ? below : Math.max(8, rect.top - tip.height - 6)) + 'px';
  }, 380);
}

island.addEventListener('pointerover', event => queueIslandTooltip(event.target));
island.addEventListener('pointerleave', hideIslandTooltip);
island.addEventListener('focusin', event => {
  if (event.target.matches(':focus-visible')) queueIslandTooltip(event.target);
});
island.addEventListener('focusout', hideIslandTooltip);
document.addEventListener('scroll', hideIslandTooltip, true);
document.addEventListener('pointerdown', hideIslandTooltip, true);
window.addEventListener('blur', hideIslandTooltip);
window.addEventListener('island-language-change', hideIslandTooltip);
