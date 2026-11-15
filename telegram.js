const { app, safeStorage, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

function registerTelegram(ipcMain, getWindow) {
  const directory = path.join(app.getPath('userData'), 'telegram');
  const settingsFile = path.join(directory, 'settings.dat');
  const chats = new Map();
  const people = new Set();
  const photoFiles = new Map();
  const pendingPhotos = new Map();
  let client;
  let authorization = { _: 'setup' };
  let loadError = '';
  let configured = false;
  let requestedChats = false;
  let quitting = false;
  let unread = 0;
  let unreadTimer;

  const isPersonal = chat => chat.type?._ === 'chatTypePrivate' && people.has(chat.type.user_id);
  function personalUnread(chat) {
    return isPersonal(chat) ? chat.unread_count || 0 : 0;
  }

  function updateUnreadSoon() {
    if (unreadTimer) return;
    unreadTimer = setTimeout(() => {
      unreadTimer = undefined;
      const count = [...chats.values()].reduce((total, chat) => total + personalUnread(chat), 0);
      if (count === unread) return;
      unread = count;
      notify({ type: 'unread', count });
    }, 150);
  }

  async function loadChatLists(connection) {
    for (const list of ['chatListMain', 'chatListArchive']) {
      while (client === connection && authorization._ === 'authorizationStateReady') {
        try {
          await connection.invoke({ _: 'loadChats', chat_list: { _: list }, limit: 100 });
        } catch {
          break;
        }
      }
    }
    if (client === connection) notify({ type: 'messages' });
  }

  function notify(change) {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('telegram-update', change);
  }

  function connect(settings) {
    const tdl = require('tdl');
    if (!configured) {
      const tdjson = require('prebuilt-tdlib').getTdjson()
        .replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
      tdl.configure({ tdjson, verbosityLevel: 0 });
      configured = true;
    }
    const connection = tdl.createClient({
      apiId: settings.apiId,
      apiHash: settings.apiHash,
      databaseDirectory: path.join(directory, 'database'),
      filesDirectory: path.join(directory, 'files'),
      databaseEncryptionKey: settings.key,
      tdlibParameters: {
        use_message_database: true, use_secret_chats: false,
        system_language_code: 'ru', device_model: 'DexxyqIsland', application_version: app.getVersion()
      }
    });
    client = connection;
    authorization = { _: 'connecting' };
    loadError = '';
    connection.on('error', () => {
      loadError = 'Ошибка подключения Telegram. Проверь соединение и попробуй снова.';
      notify({ type: 'auth' });
    });
    connection.on('update', update => {
      if (update._ === 'updateAuthorizationState') {
        authorization = update.authorization_state;
        if (authorization._ === 'authorizationStateClosed') {
          client = undefined;
          chats.clear();
          people.clear();
          photoFiles.clear();
          requestedChats = false;
          unread = 0;
          notify({ type: 'unread', count: unread });
        }
        if (authorization._ === 'authorizationStateReady' && !requestedChats) {
          requestedChats = true;
          loadChatLists(connection);
        }
        notify({ type: 'auth' });
        return;
      }
      if (update._ === 'updateMessageSendSucceeded' || update._ === 'updateMessageSendFailed') {
        const key = `${update.message.chat_id}:${update.old_message_id}`;
        const file = pendingPhotos.get(key);
        if (file) {
          pendingPhotos.delete(key);
          fs.promises.unlink(file).catch(() => {});
        }
      }
      if (update._ === 'updateNewChat') {
        chats.set(update.chat.id, update.chat);
        updateUnreadSoon();
      } else if (update._ === 'updateUser') {
        if (update.user.type._ === 'userTypeRegular') people.add(update.user.id);
        else people.delete(update.user.id);
        updateUnreadSoon();
      } else if (update._ === 'updateChatTitle' && chats.has(update.chat_id)) {
        chats.get(update.chat_id).title = update.title;
      } else if (update._ === 'updateChatLastMessage' && chats.has(update.chat_id)) {
        chats.get(update.chat_id).last_message = update.last_message;
      } else if (update._ === 'updateChatReadInbox' && chats.has(update.chat_id)) {
        const chat = chats.get(update.chat_id);
        chat.unread_count = update.unread_count;
        chat.last_read_inbox_message_id = update.last_read_inbox_message_id;
        updateUnreadSoon();
      } else if (update._ === 'updateChatReadOutbox' && chats.has(update.chat_id)) {
        chats.get(update.chat_id).last_read_outbox_message_id = update.last_read_outbox_message_id;
      }
      if (['updateNewMessage', 'updateMessageContent', 'updateMessageSendSucceeded', 'updateMessageSendFailed', 'updateDeleteMessages', 'updateChatLastMessage', 'updateChatTitle', 'updateNewChat', 'updateChatReadInbox', 'updateChatReadOutbox'].includes(update._)) {
        notify({
          type: 'messages',
          chatId: update.chat_id ?? update.message?.chat_id,
          sent: update._ === 'updateMessageSendSucceeded',
          failed: update._ === 'updateMessageSendFailed'
        });
      }
    });
  }

  function start() {
    if (client || !fs.existsSync(settingsFile)) return;
    connect(JSON.parse(safeStorage.decryptString(fs.readFileSync(settingsFile))));
  }

  const invoke = (type, args) => client.invoke({ _: type, ...args });

  function summarize(message) {
    const content = message.content;
    const sizes = content?._ === 'messagePhoto' ? content.photo.sizes : [];
    const candidates = sizes.filter(size => (size.photo.size || size.photo.expected_size) <= 2_000_000);
    const photo = candidates.find(size => Math.max(size.width, size.height) >= 320) || candidates.at(-1);
    const fullPhoto = sizes.filter(size => (size.photo.size || size.photo.expected_size) <= 10_000_000).at(-1);
    const thumbnail = content?._ === 'messagePhoto' ? content.photo.minithumbnail?.data : undefined;
    return {
      id: message.id,
      outgoing: message.is_outgoing,
      date: message.date,
      text: (message.content?.text?.text || message.content?.caption?.text) || ({
        messagePhoto: 'Фото', messageVideo: 'Видео', messageSticker: 'Стикер',
        messageVoiceNote: 'Голосовое сообщение', messageDocument: 'Файл'
      }[message.content?._] || 'Сообщение'),
      pending: message.sending_state?._ === 'messageSendingStatePending',
      failed: message.sending_state?._ === 'messageSendingStateFailed',
      photoId: photo?.photo.id,
      fullPhotoId: fullPhoto?.photo.id,
      thumbnail: thumbnail ? `data:image/jpeg;base64,${thumbnail}` : undefined
    };
  }

  async function sendPhoto(chatId, bytes, caption) {
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > 10_000_000) {
      return { error: 'Размер изображения должен быть до 10 МБ.' };
    }
    const image = nativeImage.createFromBuffer(Buffer.from(bytes));
    if (image.isEmpty()) return { error: 'Не удалось открыть изображение из буфера.' };
    const { width, height } = image.getSize();
    if (width + height > 10000 || Math.max(width / height, height / width) > 20) {
      return { error: 'Telegram не поддерживает такие размеры изображения.' };
    }
    const png = image.toPNG();
    if (png.length > 10_000_000) return { error: 'Размер изображения должен быть до 10 МБ.' };
    const uploads = path.join(directory, 'uploads');
    await fs.promises.mkdir(uploads, { recursive: true });
    const file = path.join(uploads, `screenshot-${randomBytes(12).toString('hex')}.png`);
    await fs.promises.writeFile(file, png);
    let pending = false;
    try {
      const message = await invoke('sendMessage', { chat_id: chatId, input_message_content: {
        _: 'inputMessagePhoto',
        photo: { _: 'inputPhoto', photo: { _: 'inputFileLocal', path: file }, width, height },
        caption: { _: 'formattedText', text: caption, entities: [] }
      } });
      pending = message.sending_state?._ === 'messageSendingStatePending';
      if (pending) pendingPhotos.set(`${chatId}:${message.id}`, file);
      return message.sending_state?._ === 'messageSendingStateFailed'
        ? { error: 'Telegram не отправил изображение.' } : {};
    } finally {
      if (!pending) await fs.promises.unlink(file).catch(() => {});
    }
  }

  ipcMain.handle('telegram', async (event, action, value) => {
    if (getWindow()?.webContents !== event.sender || event.senderFrame?.parent !== null) return {};
    try {
      if (action === 'state') {
        start();
        const state = authorization._;
        const qr = state === 'authorizationStateWaitOtherDeviceConfirmation'
          ? await require('qrcode').toDataURL(authorization.link, { scale: 5, margin: 4 }) : undefined;
        return { state, error: loadError, qr };
      }
      if (action === 'unread') {
        start();
        return { unread };
      }
      if (action === 'configure' && !client) {
        const apiId = Number(value?.apiId);
        const apiHash = typeof value?.apiHash === 'string' ? value.apiHash.trim() : '';
        if (!Number.isInteger(apiId) || apiId < 1 || apiId > 2147483647 || !/^[a-f0-9]{32}$/i.test(apiHash)) {
          return { error: 'Проверь API ID и API Hash.' };
        }
        if (!safeStorage.isEncryptionAvailable()) return { error: 'Хранилище Windows недоступно.' };
        const key = fs.existsSync(settingsFile)
          ? JSON.parse(safeStorage.decryptString(fs.readFileSync(settingsFile))).key
          : randomBytes(32).toString('hex');
        const settings = { apiId, apiHash, key };
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(settingsFile, safeStorage.encryptString(JSON.stringify(settings)));
        connect(settings);
        return { state: authorization._ };
      }
      if (!client) return { error: 'Сначала подключи Telegram.' };
      if (action === 'qr' && authorization._ === 'authorizationStateWaitPhoneNumber') {
        await invoke('requestQrCodeAuthentication', { other_user_ids: [] });
        return {};
      }
      const auth = {
        authorizationStateWaitPhoneNumber: ['setAuthenticationPhoneNumber', 'phone_number'],
        authorizationStateWaitCode: ['checkAuthenticationCode', 'code'],
        authorizationStateWaitPassword: ['checkAuthenticationPassword', 'password'],
        authorizationStateWaitEmailAddress: ['setAuthenticationEmailAddress', 'email_address'],
        authorizationStateWaitEmailCode: ['checkAuthenticationEmailCode', 'code']
      }[authorization._];
      if (action === 'auth' && auth && typeof value === 'string' && value.trim()) {
        const input = auth[1] === 'password' ? value : value.trim();
        await invoke(auth[0], { [auth[1]]: auth[0] === 'checkAuthenticationEmailCode'
          ? { _: 'emailAddressAuthenticationCode', code: input } : input });
        return { state: authorization._ };
      }
      if (authorization._ !== 'authorizationStateReady') return { error: 'Заверши вход в Telegram.' };
      if (action === 'chats') {
        const chatList = { _: 'chatListMain' };
        const result = await invoke('getChats', { chat_list: chatList, limit: 30 });
        return { chats: result.chat_ids.map(id => chats.get(id)).filter(Boolean)
          .map(chat => ({
            id: chat.id,
            title: chat.title,
            unread: personalUnread(chat),
            preview: chat.last_message ? summarize(chat.last_message).text.slice(0, 120) : ''
          })) };
      }
      if (action === 'logout') {
        await invoke('logOut');
        return { state: authorization._ };
      }
      const chatId = value?.chatId;
      if (!chats.has(chatId)) return { error: 'Выбери чат.' };
      if (action === 'history') {
        const history = await invoke('getChatHistory', { chat_id: chatId, from_message_id: 0, offset: 0, limit: 30, only_local: false });
        const chat = chats.get(chatId);
        const messages = history.messages.map(message => {
          const entry = summarize(message);
          if (entry.outgoing && !entry.pending && !entry.failed && isPersonal(chat)) {
            entry.read = entry.id <= (chat.last_read_outbox_message_id || 0);
          }
          return entry;
        }).reverse();
        photoFiles.set(chatId, new Set(messages.flatMap(message => [message.photoId, message.fullPhotoId]).filter(Boolean)));
        return { messages };
      }
      if (action === 'photo' && photoFiles.get(chatId)?.has(value.fileId)) {
        const file = await invoke('downloadFile', { file_id: value.fileId, priority: 8, synchronous: true });
        if (!file.local.is_downloading_completed || !file.local.path || file.size > 10_000_000) return {};
        const bytes = await fs.promises.readFile(file.local.path);
        if (bytes.length > 10_000_000) return {};
        return { image: `data:image/jpeg;base64,${bytes.toString('base64')}` };
      }
      if (action === 'read' && Number.isSafeInteger(value.messageId) &&
          value.messageId > (chats.get(chatId).last_read_inbox_message_id || 0)) {
        await invoke('viewMessages', { chat_id: chatId, message_ids: [value.messageId], force_read: true });
        return {};
      }
      if (action === 'read') return {};
      if (action === 'send-photo' && typeof value.text === 'string' && value.text.length <= 4096) {
        return await sendPhoto(chatId, value.image, value.text.trim());
      }
      if (action === 'send' && typeof value.text === 'string' && value.text.trim() && value.text.length <= 4096) {
        await invoke('sendMessage', { chat_id: chatId, input_message_content: {
          _: 'inputMessageText', text: { _: 'formattedText', text: value.text.trim(), entities: [] }
        } });
        return {};
      }
      return { error: 'Действие недоступно.' };
    } catch (error) {
      const code = typeof error.message === 'string' ? error.message.match(/^[A-Z][A-Z0-9_]+$/)?.[0] : '';
      return { error: code ? `Telegram: ${code}` : 'Не удалось выполнить действие в Telegram.' };
    }
  });

  app.on('before-quit', event => {
    if (!client || quitting) return;
    event.preventDefault();
    quitting = true;
    Promise.race([
      client.close().catch(() => {}),
      new Promise(resolve => setTimeout(resolve, 2500))
    ]).finally(() => app.quit());
  });
}

module.exports = { registerTelegram };
