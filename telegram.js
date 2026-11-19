const { app, safeStorage, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

function registerTelegram(ipcMain, getWindow, getShelfItem, onNotification = () => {}) {
  const directory = path.join(app.getPath('userData'), 'telegram');
  const settingsFile = path.join(directory, 'settings.dat');
  const chats = new Map();
  const people = new Map();
  const photoFiles = new Map();
  const pendingUploads = new Map();
  const installedSets = new Set();
  const stickerPacks = new Map();
  const historyStickers = new Map();
  const listLoads = new Map();
  let folders = [];
  let mainFolderPosition = 0;
  let chatListTimer;
  let privateMuteUntil = 0;
  let client;
  let authorization = { _: 'setup' };
  let loadError = '';
  let configured = false;
  let requestedChats = false;
  let quitting = false;
  let unread = 0;
  let unreadTimer;

  const isPersonal = chat => chat?.type?._ === 'chatTypePrivate' && people.get(chat.type.user_id)?.regular;
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

  function listKey(list) {
    if (list._ === 'chatListMain') return 'main';
    if (list._ === 'chatListArchive') return 'archive';
    if (list._ === 'chatListFolder') return `folder:${list.chat_folder_id}`;
  }

  function orderOf(positions, key) {
    let best = 0n;
    let fallback = 0n;
    for (const position of positions || []) {
      const positionKey = listKey(position.list);
      if (key !== 'all' && positionKey !== key) continue;
      const order = BigInt(position.order);
      if (key === 'all' && positionKey?.startsWith('folder:')) {
        if (order > fallback && folders.some(folder => folder.id === positionKey)) fallback = order;
      } else if (order > best) best = order;
    }
    return best || fallback;
  }

  function updateChatListsSoon() {
    if (chatListTimer) return;
    chatListTimer = setTimeout(() => {
      chatListTimer = undefined;
      notify({ type: 'chats' });
    }, 200);
  }

  function loadChatList(connection, key, list, retry = false) {
    const previous = listLoads.get(key);
    if (previous?.running || previous?.done || (!retry && previous?.retryAt > Date.now())) return;
    const load = { running: true, done: false };
    listLoads.set(key, load);
    void (async () => {
      while (client === connection && authorization._ === 'authorizationStateReady' && listLoads.get(key) === load) {
        try {
          await connection.invoke({ _: 'loadChats', chat_list: list, limit: 100 });
          updateChatListsSoon();
        } catch (error) {
          load.done = error.code === 404;
          if (!load.done) load.retryAt = Date.now() + 5000;
          break;
        }
      }
      load.running = false;
      if (client === connection) updateChatListsSoon();
    })();
  }

  function notify(change) {
    try { onNotification(change); } catch (error) { console.warn('Telegram notification:', error.message); }
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
      if (client !== connection) return;
      if (update._ === 'updateAuthorizationState') {
        authorization = update.authorization_state;
        if (authorization._ === 'authorizationStateClosed') {
          client = undefined;
          chats.clear();
          people.clear();
          photoFiles.clear();
          installedSets.clear();
          stickerPacks.clear();
          historyStickers.clear();
          listLoads.clear();
          folders = [];
          mainFolderPosition = 0;
          privateMuteUntil = 0;
          requestedChats = false;
          unread = 0;
          notify({ type: 'unread', count: unread });
        }
        if (authorization._ === 'authorizationStateReady' && !requestedChats) {
          requestedChats = true;
          loadChatList(connection, 'main', { _: 'chatListMain' });
          loadChatList(connection, 'archive', { _: 'chatListArchive' });
        }
        notify({ type: 'auth' });
        return;
      }
      if (update._ === 'updateMessageSendSucceeded' || update._ === 'updateMessageSendFailed') {
        const key = `${update.message.chat_id}:${update.old_message_id}`;
        const cleanup = pendingUploads.get(key);
        if (cleanup) {
          pendingUploads.delete(key);
          void cleanup();
        }
      }
      if (update._ === 'updateInstalledStickerSets') notify({ type: 'sticker-packs' });
      if (update._ === 'updateChatFolders') {
        folders = update.chat_folders.map(folder => ({
          id: `folder:${folder.id}`, folderId: folder.id, name: folder.name.text.text
        }));
        mainFolderPosition = update.main_chat_list_position;
        const ids = new Set(folders.map(folder => folder.id));
        for (const key of listLoads.keys()) if (key.startsWith('folder:') && !ids.has(key)) listLoads.delete(key);
        updateChatListsSoon();
      }
      if (update._ === 'updateScopeNotificationSettings' && update.scope._ === 'notificationSettingsScopePrivateChats') {
        privateMuteUntil = Date.now() + update.notification_settings.mute_for * 1000;
      }
      const chat = chats.get(update.chat_id ?? update.message?.chat_id);
      if (update._ === 'updateNewChat') {
        update.chat.muteUntil = Date.now() + (update.chat.notification_settings?.mute_for || 0) * 1000;
        chats.set(update.chat.id, update.chat);
        updateUnreadSoon();
        updateChatListsSoon();
      } else if (update._ === 'updateUser') {
        const user = update.user;
        people.set(user.id, {
          name: [user.first_name, user.last_name].filter(Boolean).join(' '),
          regular: user.type._ === 'userTypeRegular'
        });
        updateUnreadSoon();
      } else if (update._ === 'updateChatTitle' && chat) {
        chat.title = update.title;
      } else if (update._ === 'updateChatPhoto' && chat) {
        chat.photo = update.photo;
        updateChatListsSoon();
      } else if (update._ === 'updateChatNotificationSettings' && chat) {
        chat.notification_settings = update.notification_settings;
        chat.muteUntil = Date.now() + update.notification_settings.mute_for * 1000;
      } else if (update._ === 'updateChatPosition' && chat) {
        const key = listKey(update.position.list);
        chat.positions = (chat.positions || []).filter(position => listKey(position.list) !== key);
        if (BigInt(update.position.order) !== 0n) chat.positions.push(update.position);
        updateChatListsSoon();
      } else if (update._ === 'updateChatDraftMessage' && chat) {
        chat.positions = update.positions;
        updateChatListsSoon();
      } else if (update._ === 'updateChatLastMessage' && chat) {
        chat.last_message = update.last_message;
        chat.positions = update.positions ?? chat.positions;
      } else if (update._ === 'updateChatReadInbox' && chat) {
        chat.unread_count = update.unread_count;
        chat.last_read_inbox_message_id = update.last_read_inbox_message_id;
        updateUnreadSoon();
      } else if (update._ === 'updateChatReadOutbox' && chat) {
        chat.last_read_outbox_message_id = update.last_read_outbox_message_id;
      }
      if (update._ === 'updateNewMessage' && authorization._ === 'authorizationStateReady' &&
          isPersonal(chat) && !update.message.is_outgoing && update.message.id > (chat.last_read_inbox_message_id || 0) &&
          Date.now() >= (chat.notification_settings?.use_default_mute_for ? privateMuteUntil : chat.muteUntil || 0)) {
        notify({ type: 'incoming', title: chat.title, chatId: chat.id });
      }
      if (['updateNewMessage', 'updateMessageContent', 'updateMessageSendSucceeded', 'updateMessageSendFailed', 'updateDeleteMessages', 'updateChatLastMessage', 'updateChatTitle', 'updateChatReadInbox', 'updateChatReadOutbox'].includes(update._)) {
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

  function messageText(content) {
    return content?.text?.text || content?.caption?.text || content?.document?.file_name || ({
      messagePhoto: 'Фото', messageVideo: 'Видео', messageSticker: content?.sticker?.emoji || 'Стикер',
      messageVoiceNote: 'Голосовое сообщение', messageDocument: 'Файл'
    }[content?._] || 'Сообщение');
  }

  function stickerPreview(sticker) {
    const thumb = sticker.thumbnail;
    const formats = { thumbnailFormatWebp: 'webp', thumbnailFormatJpeg: 'jpeg', thumbnailFormatPng: 'png' };
    const format = formats[thumb?.format?._];
    if (format) return { file: thumb.file, format };
    if (sticker.format?._ === 'stickerFormatWebp') return { file: sticker.sticker, format: 'webp' };
  }

  function describeSticker(sticker) {
    return { id: sticker.sticker.id, emoji: sticker.emoji, previewId: stickerPreview(sticker)?.file.id };
  }

  function summarize(message) {
    const content = message.content;
    const sizes = content?._ === 'messagePhoto' ? content.photo.sizes : [];
    const candidates = sizes.filter(size => (size.photo.size || size.photo.expected_size) <= 2_000_000);
    const photo = candidates.find(size => Math.max(size.width, size.height) >= 320) || candidates.at(-1);
    const fullPhoto = sizes.filter(size => (size.photo.size || size.photo.expected_size) <= 10_000_000).at(-1);
    const thumbnail = content?._ === 'messagePhoto' ? content.photo.minithumbnail?.data : undefined;
    const sender = message.sender_id;
    const reply = message.reply_to;
    return {
      id: message.id,
      outgoing: message.is_outgoing,
      date: message.date,
      text: messageText(content),
      documentName: content?._ === 'messageDocument' ? content.document.file_name : undefined,
      sticker: content?._ === 'messageSticker' ? describeSticker(content.sticker) : undefined,
      sender: sender?._ === 'messageSenderUser' ? people.get(sender.user_id)?.name : chats.get(sender?.chat_id)?.title,
      reply: reply?._ === 'messageReplyToMessage' ? {
        id: reply.message_id,
        chatId: reply.chat_id,
        preview: reply.quote?.text?.text?.slice(0, 160) || (reply.content ? messageText(reply.content).slice(0, 160) : undefined)
      } : undefined,
      pending: message.sending_state?._ === 'messageSendingStatePending',
      failed: message.sending_state?._ === 'messageSendingStateFailed',
      photoId: photo?.photo.id,
      fullPhotoId: fullPhoto?.photo.id,
      thumbnail: thumbnail ? `data:image/jpeg;base64,${thumbnail}` : undefined
    };
  }

  async function sendContent(connection, chatId, input, replyOptions, cleanup) {
    let pending = false;
    try {
      if (client !== connection || authorization._ !== 'authorizationStateReady') return { error: 'Заверши вход в Telegram.' };
      const message = await connection.invoke({
        _: 'sendMessage', chat_id: chatId, ...replyOptions, input_message_content: input
      });
      pending = message.sending_state?._ === 'messageSendingStatePending';
      if (pending && cleanup) pendingUploads.set(`${chatId}:${message.id}`, cleanup);
      return message.sending_state?._ === 'messageSendingStateFailed'
        ? { error: 'Telegram не отправил сообщение.' } : {};
    } finally {
      if (!pending && cleanup) await cleanup();
    }
  }

  async function sendPhoto(connection, chatId, bytes, caption, replyOptions) {
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
    return sendContent(connection, chatId, {
      _: 'inputMessagePhoto',
      photo: { _: 'inputPhoto', photo: { _: 'inputFileLocal', path: file }, width, height },
      caption: { _: 'formattedText', text: caption, entities: [] }
    }, replyOptions, () => fs.promises.unlink(file).catch(() => {}));
  }

  async function sendDocument(connection, chatId, value, caption, replyOptions) {
    const shelfItem = typeof value.shelfId === 'string' ? getShelfItem?.(value.shelfId) : undefined;
    const source = value.shelfId === undefined ? value.path : shelfItem?.storedPath;
    if (typeof source !== 'string' || !path.isAbsolute(source) ||
        !(await fs.promises.stat(source).catch(() => null))?.isFile()) {
      return { error: 'Файл не найден или недоступен.' };
    }
    let file = source;
    let cleanup;
    if (shelfItem) {
      const name = path.basename(shelfItem.name);
      if (!name || name === '.' || name === '..') return { error: 'Файл не найден или недоступен.' };
      const uploads = path.join(directory, 'uploads');
      await fs.promises.mkdir(uploads, { recursive: true });
      const staging = await fs.promises.mkdtemp(path.join(uploads, 'document-'));
      file = path.join(staging, name);
      cleanup = async () => {
        await fs.promises.unlink(file).catch(() => {});
        await fs.promises.rmdir(staging).catch(() => {});
      };
      try {
        await fs.promises.link(source, file).catch(() => fs.promises.copyFile(source, file));
      } catch (error) {
        await cleanup();
        throw error;
      }
    }
    return sendContent(connection, chatId, {
      _: 'inputMessageDocument',
      document: { _: 'inputDocument', document: { _: 'inputFileLocal', path: file }, disable_content_type_detection: true },
      caption: { _: 'formattedText', text: caption, entities: [] }
    }, replyOptions, cleanup);
  }

  async function readPreview(photo, format, maxBytes) {
    const file = photo.local?.is_downloading_completed ? photo
      : await invoke('downloadFile', { file_id: photo.id, priority: 3, synchronous: true });
    if (!file.local?.is_downloading_completed || !file.local.path || file.size > maxBytes) return {};
    const stat = await fs.promises.stat(file.local.path);
    if (stat.size > maxBytes) return {};
    const bytes = await fs.promises.readFile(file.local.path);
    return { image: `data:image/${format};base64,${bytes.toString('base64')}` };
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
      const connection = client;
      if (action === 'sticker-packs') {
        const result = await invoke('getInstalledStickerSets', { sticker_type: { _: 'stickerTypeRegular' } });
        if (client !== connection) return {};
        installedSets.clear();
        for (const pack of result.sets) installedSets.add(String(pack.id));
        for (const id of stickerPacks.keys()) if (!installedSets.has(id)) stickerPacks.delete(id);
        return { packs: result.sets.map(pack => ({ id: String(pack.id), name: pack.title })) };
      }
      if (action === 'stickers' && installedSets.has(value)) {
        const result = await invoke('getStickerSet', { set_id: value });
        if (client !== connection) return {};
        const pack = new Map(result.stickers.map(sticker => [sticker.sticker.id, sticker]));
        stickerPacks.delete(value);
        stickerPacks.set(value, pack);
        if (stickerPacks.size > 4) stickerPacks.delete(stickerPacks.keys().next().value);
        return { stickers: result.stickers.map(describeSticker) };
      }
      if (action === 'chats') {
        const requested = value?.key;
        const retry = value?.retry === true;
        const folder = folders.find(entry => entry.id === requested);
        const key = folder?.id || (requested === 'archive' ? 'archive' : 'all');
        if (folder) loadChatList(connection, key, { _: 'chatListFolder', chat_folder_id: folder.folderId }, retry);
        else {
          if (key === 'all') loadChatList(connection, 'main', { _: 'chatListMain' }, retry);
          loadChatList(connection, 'archive', { _: 'chatListArchive' }, retry);
        }
        const loads = (key === 'all' ? ['main', 'archive'] : [key]).map(list => listLoads.get(list));
        const loading = loads.some(load => load?.running);
        const failed = loads.some(load => load?.retryAt);
        const entries = [...chats.values()].map(chat => ({ chat, order: orderOf(chat.positions, key) }))
          .filter(entry => entry.order > 0n)
          .sort((a, b) => a.order === b.order ? b.chat.id - a.chat.id : a.order > b.order ? -1 : 1);
        return { key, loading, failed, folders, mainFolderPosition, chats: entries
          .map(({ chat }) => ({
            id: chat.id,
            title: chat.title,
            unread: personalUnread(chat),
            preview: chat.last_message ? messageText(chat.last_message.content).slice(0, 120) : '',
            avatarId: chat.photo?.small?.id
          })) };
      }
      if (action === 'logout') {
        await invoke('logOut');
        return { state: authorization._ };
      }
      const chatId = value?.chatId;
      if (!chats.has(chatId)) return { error: 'Выбери чат.' };
      if (action === 'sticker-preview') {
        const sticker = value.packId ? stickerPacks.get(value.packId)?.get(value.stickerId)
          : historyStickers.get(chatId)?.get(value.stickerId);
        const preview = sticker && stickerPreview(sticker);
        return preview ? await readPreview(preview.file, preview.format, 512_000) : {};
      }
      if (action === 'avatar') {
        const photo = chats.get(chatId).photo?.small;
        if (!photo || photo.id !== value.fileId) return {};
        return await readPreview(photo, 'jpeg', 250_000);
      }
      if (action === 'history') {
        const history = await invoke('getChatHistory', { chat_id: chatId, from_message_id: 0, offset: 0, limit: 30, only_local: false });
        const chat = chats.get(chatId);
        if (client !== connection || !chat) return {};
        const stickers = history.messages.filter(message => message.content?._ === 'messageSticker')
          .map(message => [message.content.sticker.sticker.id, message.content.sticker]);
        historyStickers.set(chatId, new Map(stickers));
        if (historyStickers.size > 5) historyStickers.delete(historyStickers.keys().next().value);
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
      if (['send', 'send-photo', 'send-document', 'send-sticker'].includes(action)) {
        if (typeof value.text !== 'string' || value.text.length > 4096) return { error: 'Действие недоступно.' };
        const text = value.text.trim();
        if (action === 'send' && !text) return { error: 'Действие недоступно.' };
        let replyOptions;
        if (value.replyTo !== undefined) {
          const messageId = value.replyTo;
          if (!Number.isSafeInteger(messageId) || messageId <= 0) return { error: 'Ответ на это сообщение недоступен.' };
          const target = await invoke('getMessage', { chat_id: chatId, message_id: messageId }).catch(() => undefined);
          if (!target || target.sending_state) return { error: 'Ответ на это сообщение недоступен.' };
          replyOptions = {
            topic_id: target.topic_id,
            reply_to: { _: 'inputMessageReplyToMessage', message_id: messageId }
          };
        }
        if (action === 'send-photo') return await sendPhoto(connection, chatId, value.image, text, replyOptions);
        if (action === 'send-document') return await sendDocument(connection, chatId, value, text, replyOptions);
        if (action === 'send-sticker') {
          const sticker = stickerPacks.get(value.packId)?.get(value.stickerId);
          if (!installedSets.has(value.packId) || !sticker) return { error: 'Стикер недоступен.' };
          return await sendContent(connection, chatId, {
            _: 'inputMessageSticker',
            sticker: {
              _: 'inputSticker', sticker: { _: 'inputFileId', id: sticker.sticker.id },
              width: sticker.width, height: sticker.height
            },
            emoji: sticker.emoji
          }, replyOptions);
        }
        return await sendContent(connection, chatId, {
          _: 'inputMessageText', text: { _: 'formattedText', text, entities: [] }
        }, replyOptions);
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
