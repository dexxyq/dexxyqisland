const { ipcMain, Notification, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function registerIslandTools({ directory, getWindow, openDialog }) {
  const statePath = path.join(directory, 'island-tools.json');
  let state = { timers: [], history: [] };
  let alarm;
  let checking = false;
  try {
    const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.timers = (Array.isArray(saved.timers) ? saved.timers : []).filter(timer =>
      typeof timer.id === 'string' && typeof timer.label === 'string' &&
      Number.isFinite(timer.due) && timer.due > 0).slice(0, 20);
    state.history = (Array.isArray(saved.history) ? saved.history : []).filter(entry =>
      typeof entry.id === 'string' && typeof entry.title === 'string' &&
      Number.isFinite(entry.time)).slice(0, 100);
  } catch {}

  function save(next) {
    fs.writeFileSync(statePath + '.tmp', JSON.stringify(next), 'utf8');
    fs.renameSync(statePath + '.tmp', statePath);
    state = next;
  }

  function send(payload) {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('island-tools-update', payload);
  }

  function notification(title, type = 'app', extra = {}) {
    const entry = { id: randomUUID(), title: title.slice(0, 300), type, time: Date.now(), ...extra };
    save({ ...state, history: [entry, ...state.history].slice(0, 100) });
    send({ state, notification: entry });
    return entry;
  }

  function schedule() {
    clearTimeout(alarm);
    if (!state.timers.length) return;
    const delay = Math.max(1, Math.min(2147483647, Math.min(...state.timers.map(timer => timer.due)) - Date.now()));
    alarm = setTimeout(checkTimers, delay);
  }

  function checkTimers() {
    if (checking) return;
    checking = true;
    try {
      const due = state.timers.filter(timer => timer.due <= Date.now());
      if (due.length) {
        const entries = due.map(timer => ({
          id: randomUUID(), title: timer.label, type: 'timer', time: Date.now()
        }));
        save({
          timers: state.timers.filter(timer => timer.due > Date.now()),
          history: [...entries, ...state.history].slice(0, 100)
        });
        for (const entry of entries) {
          send({ state, notification: entry });
          if (Notification.isSupported()) {
            const notice = new Notification({ title: 'DexxyqIsland · ⏲', body: entry.title });
            notice.on('click', () => {
              const win = getWindow();
              if (!win || win.isDestroyed()) return;
              win.show();
              win.focus();
              win.webContents.send('island-tools-open', 'history');
            });
            notice.on('failed', (_, error) => console.warn('Reminder notification:', error));
            notice.show();
          }
        }
        send({ state });
      }
    } catch (error) {
      console.warn('Reminders:', error.message);
    } finally {
      checking = false;
      schedule();
      // A disk failure must not cause a tight timer retry loop.
      if (state.timers.some(timer => timer.due <= Date.now())) {
        clearTimeout(alarm);
        alarm = setTimeout(checkTimers, 30_000);
      }
    }
  }

  ipcMain.handle('island-tools', async (event, action, value) => {
    if (getWindow()?.webContents !== event.sender || event.senderFrame?.parent !== null) return { error: 'Команда недоступна.' };
    try {
      if (action === 'get') { checkTimers(); return { state }; }
      if (action === 'timer-add') {
        const minutes = Number(value?.minutes);
        const label = typeof value?.label === 'string' ? value.label.trim().slice(0, 160) : '';
        if (!label || !Number.isFinite(minutes) || minutes < 1 || minutes > 10080 || state.timers.length >= 20) {
          return { error: 'Укажи название и время от 1 минуты до 7 дней. Максимум 20 таймеров.' };
        }
        const timer = { id: randomUUID(), label, due: Date.now() + Math.round(minutes * 60_000) };
        save({ ...state, timers: [...state.timers, timer] });
        schedule();
      } else if (action === 'timer-delete') {
        save({ ...state, timers: state.timers.filter(timer => timer.id !== value) });
        schedule();
      } else if (action === 'history-clear') {
        save({ ...state, history: [] });
      } else if (action === 'log') {
        if (typeof value?.title !== 'string' || !value.title.trim()) return {};
        notification(value.title.trim());
      } else if (action === 'history-delete') {
        save({ ...state, history: state.history.filter(entry => entry.id !== value) });
      } else if (action === 'settings-export') {
        const serialized = JSON.stringify(value, null, 2);
        if (!serialized || Buffer.byteLength(serialized) > 3_000_000 || value?.format !== 'dexxyq-settings' || value.version !== 1) {
          return { error: 'Некорректный файл настроек.' };
        }
        const result = await openDialog('save', {
          title: 'DexxyqIsland · JSON', defaultPath: 'DexxyqIsland-settings.json',
          filters: [{ name: 'JSON', extensions: ['json'] }]
        });
        if (result.canceled || !result.filePath) return { canceled: true };
        await fs.promises.writeFile(result.filePath, serialized, 'utf8');
        return { saved: true };
      } else if (action === 'settings-import') {
        const result = await openDialog('open', {
          title: 'DexxyqIsland · JSON', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile']
        });
        if (result.canceled || !result.filePaths.length) return { canceled: true };
        const handle = await fs.promises.open(result.filePaths[0], 'r');
        try {
          if ((await handle.stat()).size > 3_000_000) return { error: 'Некорректный файл настроек.' };
          const buffer = Buffer.alloc(3_000_001);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          if (bytesRead > 3_000_000) return { error: 'Некорректный файл настроек.' };
          return { settings: JSON.parse(buffer.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '')) };
        } finally { await handle.close(); }
      } else return {};
      send({ state });
      return { state };
    } catch (error) {
      console.warn('Island tools:', error.message);
      return { error: 'Не удалось выполнить действие. Проверь файл и права доступа.' };
    }
  });
  powerMonitor.on('resume', checkTimers);
  schedule();
  return { notification };
}

module.exports = { registerIslandTools };
