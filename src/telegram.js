(() => {
  const auth = document.getElementById('telegramAuth');
  const fields = document.getElementById('telegramFields');
  const next = document.getElementById('telegramContinue');
  const qrButton = document.getElementById('telegramQrButton');
  const qrPanel = document.getElementById('telegramQr');
  const qrImage = document.getElementById('telegramQrImage');
  const chats = document.getElementById('telegramChats');
  const list = document.getElementById('telegramChatList');
  const folders = document.getElementById('telegramFolders');
  const filter = document.getElementById('telegramFilter');
  const title = document.getElementById('telegramChatTitle');
  const empty = document.getElementById('telegramEmpty');
  const history = document.getElementById('telegramHistory');
  const reply = document.getElementById('telegramReply');
  const replyTarget = document.getElementById('telegramReplyTarget');
  const replyPreview = document.getElementById('telegramReplyPreview');
  const text = document.getElementById('telegramText');
  const attachment = document.getElementById('telegramAttachment');
  const attachmentImage = document.getElementById('telegramAttachmentImage');
  const documentList = document.getElementById('telegramDocuments');
  const fileInput = document.getElementById('telegramFileInput');
  const picker = document.getElementById('telegramPicker');
  const pickerGrid = document.getElementById('telegramPickerGrid');
  const pickerStatus = document.getElementById('telegramPickerStatus');
  const packToggle = document.getElementById('telegramStickerPack');
  const packName = document.getElementById('telegramStickerPackName');
  const packList = document.getElementById('telegramPackList');
  const emojiButton = document.getElementById('telegramEmojiButton');
  const stickerButton = document.getElementById('telegramStickerButton');
  const viewer = document.getElementById('telegramPhotoViewer');
  const viewerImage = document.getElementById('telegramViewerImage');
  const viewerStatus = document.getElementById('telegramViewerStatus');
  const send = reply.querySelector('[type=submit]');
  const status = document.getElementById('telegramStatus');
  const compactBadge = document.getElementById('telegramCompactBadge');
  const compactCount = document.getElementById('telegramCompactCount');
  const tabCount = document.getElementById('telegramTabCount');
  const tab = document.querySelector('[data-tab="telegram"]');
  const call = window.dexxyq.telegram;
  let state;
  let selected;
  let request = 0;
  let timer;
  let revision = 0;
  let stateRequest = 0;
  let requestingQr = false;
  let recentChats = [];
  let chatListSignature = '';
  let folderSignature = '';
  let activeFolder = 'all';
  let chatLimit = 60;
  let loadingChats = false;
  let chatLoadFailed = false;
  let refreshSelectedHistory = false;
  let lastNotificationAnimation = -Infinity;
  let latestIncoming;
  let viewerRequest = 0;
  let unreadEventReceived = false;
  let lastUnreadCount = 0;
  const drafts = new Map();
  const photos = new Map();
  const documents = new Map();
  const replies = new Map();
  const maxDocuments = 10;
  const emojis = '😀 😃 😄 😁 😂 🤣 😊 😍 🥰 😘 😉 🙃 😎 🤩 🥳 😅 😬 🤔 🫠 😴 🙄 😢 😭 😤 😡 🤯 😱 🫡 🤝 👍 👎 👏 🙌 🙏 👀 💪 👋 🫶 ❤️ 💜 💔 🔥 ✨ 🎉 ✅ 💯 😈 💀 🤍 ☕'.split(' ');
  let pickerMode;
  let pickerRequest = 0;
  let selectedPack;
  const stickerImages = new Map();
  const stickerObserver = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      stickerObserver.unobserve(target);
      loadStickerImage(target);
    }
  });
  const avatars = new Map();
  const avatarObserver = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      avatarObserver.unobserve(target);
      loadAvatar(target);
    }
  }, { root: list });
  let previewUrl;
  const prompts = {
    authorizationStateWaitPhoneNumber: ['Номер телефона с кодом страны', 'tel'],
    authorizationStateWaitCode: ['Код из Telegram', 'text'],
    authorizationStateWaitPassword: ['Пароль двухэтапной защиты', 'password'],
    authorizationStateWaitEmailAddress: ['Электронная почта', 'email'],
    authorizationStateWaitEmailCode: ['Код из письма', 'text']
  };

  function countLabel(count) {
    return count > 99 ? '99+' : String(count);
  }

  function loadAvatar(avatar) {
    const chatId = Number(avatar.dataset.chatId);
    const fileId = Number(avatar.dataset.fileId);
    if (!avatars.has(fileId)) {
      const download = call('avatar', { chatId, fileId }).then(result => result.image).catch(() => undefined);
      avatars.set(fileId, download);
      if (avatars.size > 60) avatars.delete(avatars.keys().next().value);
    }
    const download = avatars.get(fileId);
    download.then(url => {
      if (!url) {
        if (avatars.get(fileId) === download) avatars.delete(fileId);
        return;
      }
      if (!avatar.isConnected) return;
      const image = document.createElement('img');
      image.alt = '';
      image.addEventListener('load', () => avatar.append(image), { once: true });
      image.src = url;
    });
  }

  function messageAuthor(message) {
    return message.outgoing ? tr('Вы') : message.sender || title.textContent;
  }

  function writeQuote(quote, heading, snippet) {
    const author = document.createElement('strong');
    author.textContent = heading;
    const preview = document.createElement('span');
    preview.textContent = snippet.replace(/\s+/g, ' ').trim().slice(0, 160);
    quote.replaceChildren(author, preview);
  }

  function renderReply() {
    const message = replies.get(selected);
    replyTarget.hidden = !message;
    if (!message) {
      replyPreview.replaceChildren();
      return;
    }
    writeQuote(replyPreview, tr('Ответ для {0}', messageAuthor(message)), message.text);
  }

  document.getElementById('telegramCancelReply').addEventListener('click', () => {
    replies.delete(selected);
    renderReply();
    text.focus();
  });

  function renderAttachment() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const image = photos.get(selected);
    attachment.hidden = !image;
    previewUrl = image ? URL.createObjectURL(image) : undefined;
    if (previewUrl) attachmentImage.src = previewUrl;
    else attachmentImage.removeAttribute('src');
  }

  function renderDocuments() {
    const files = documents.get(selected) || [];
    documentList.hidden = !files.length;
    documentList.replaceChildren(...files.map(file => {
      const chip = document.createElement('div');
      chip.className = 'telegram-document-chip';
      const name = document.createElement('span');
      name.textContent = `📎 ${file.name}`;
      name.title = file.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn-small';
      remove.textContent = '×';
      remove.setAttribute('aria-label', tr('Убрать файл {0}', file.name));
      const chatId = selected;
      remove.addEventListener('click', () => {
        removeDocument(chatId, file);
        renderDocuments();
      });
      chip.append(name, remove);
      return chip;
    }));
  }

  function removeDocument(chatId, file) {
    const remaining = documents.get(chatId)?.filter(item => item !== file);
    if (remaining?.length) documents.set(chatId, remaining);
    else documents.delete(chatId);
  }

  function queueDocuments(files) {
    const queued = [...(documents.get(selected) || [])];
    let message = '';
    for (const file of files) {
      if (!file.path && !file.shelfId) {
        message = tr('Файл не найден или недоступен.');
        continue;
      }
      if (queued.some(item => item.path === file.path && item.shelfId === file.shelfId)) continue;
      if (queued.length >= maxDocuments) {
        message = tr('За раз можно прикрепить до {0} файлов.', maxDocuments);
        break;
      }
      queued.push(file);
    }
    if (queued.length) documents.set(selected, queued);
    status.textContent = message;
    renderDocuments();
  }

  window.addEventListener('telegram-files', event => queueDocuments(event.detail));
  document.getElementById('telegramAddFiles').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    queueDocuments(Array.from(fileInput.files, file => ({ path: window.dexxyq.getFilePath(file), name: file.name })));
    fileInput.value = '';
  });

  function loadStickerImage(art) {
    const { fileId, chatId, packId, stickerId } = art.dataset;
    if (!stickerImages.has(fileId)) {
      const request = call('sticker-preview', { chatId: Number(chatId), packId, stickerId: Number(stickerId) })
        .then(result => result.image).catch(() => undefined);
      stickerImages.set(fileId, request);
      if (stickerImages.size > 60) stickerImages.delete(stickerImages.keys().next().value);
    }
    const request = stickerImages.get(fileId);
    request.then(src => {
      if (!src) {
        if (stickerImages.get(fileId) === request) stickerImages.delete(fileId);
        return;
      }
      if (!art.isConnected) return;
      const image = document.createElement('img');
      image.alt = '';
      image.addEventListener('load', () => art.replaceChildren(image), { once: true });
      image.src = src;
    });
  }

  function renderSticker(sticker, chatId, packId) {
    const art = document.createElement('span');
    art.className = 'telegram-sticker-art';
    art.textContent = sticker.emoji || '🗂';
    if (sticker.previewId) {
      art.dataset.fileId = sticker.previewId;
      art.dataset.chatId = chatId;
      art.dataset.stickerId = sticker.id;
      if (packId) art.dataset.packId = packId;
      stickerObserver.observe(art);
    }
    return art;
  }

  function setPickerStatus(message = '') {
    pickerStatus.textContent = message;
    pickerStatus.hidden = !message;
  }

  function clearPickerGrid() {
    for (const art of pickerGrid.querySelectorAll('.telegram-sticker-art')) stickerObserver.unobserve(art);
    pickerGrid.replaceChildren();
  }

  function togglePackList(open) {
    packToggle.setAttribute('aria-expanded', String(open));
    packList.hidden = !open;
    pickerGrid.hidden = open;
    if (open) {
      const option = packList.querySelector('[aria-pressed="true"]') || packList.firstElementChild;
      option?.focus();
    }
  }

  function renderPackList(packs) {
    const current = packs.find(pack => pack.id === selectedPack) || packs[0];
    packToggle.hidden = false;
    packName.textContent = current.name;
    packList.replaceChildren(...packs.map(pack => {
      const option = document.createElement('button');
      option.type = 'button';
      const label = document.createElement('span');
      label.textContent = pack.name;
      option.append(label);
      option.title = pack.name;
      option.setAttribute('aria-pressed', String(pack.id === current.id));
      option.addEventListener('click', () => {
        for (const button of packList.children) button.setAttribute('aria-pressed', String(button === option));
        packName.textContent = pack.name;
        togglePackList(false);
        packToggle.focus();
        if (pack.id !== selectedPack) showStickers(pack.id);
      });
      return option;
    }));
    return current.id;
  }

  async function showStickers(packId) {
    selectedPack = packId;
    const sequence = ++pickerRequest;
    const chatId = selected;
    clearPickerGrid();
    setPickerStatus(tr('Загрузка…'));
    const result = await call('stickers', packId).catch(() => ({ error: 'Не удалось выполнить действие в Telegram.' }));
    if (sequence !== pickerRequest) return;
    if (!result.stickers?.length) {
      setPickerStatus(tr(result.error || 'В этом наборе нет стикеров.'));
      return;
    }
    setPickerStatus();
    pickerGrid.append(...result.stickers.map(sticker => {
      const button = document.createElement('button');
      button.type = 'button';
      button.title = tr('Отправить стикер {0}', sticker.emoji || '');
      button.setAttribute('aria-label', button.title);
      button.append(renderSticker(sticker, chatId, packId));
      button.addEventListener('click', () => sendSticker(packId, sticker.id));
      return button;
    }));
  }

  async function showPicker(mode) {
    const sequence = ++pickerRequest;
    pickerMode = mode;
    picker.hidden = !mode;
    emojiButton.setAttribute('aria-pressed', String(mode === 'emoji'));
    stickerButton.setAttribute('aria-pressed', String(mode === 'stickers'));
    pickerGrid.classList.toggle('stickers', mode === 'stickers');
    packToggle.hidden = true;
    togglePackList(false);
    packList.replaceChildren();
    clearPickerGrid();
    setPickerStatus();
    if (mode === 'emoji') {
      pickerGrid.append(...emojis.map(emoji => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = emoji;
        button.addEventListener('click', () => {
          const start = text.selectionStart;
          const end = text.selectionEnd;
          if (text.value.length - (end - start) + emoji.length <= text.maxLength) {
            text.setRangeText(emoji, start, end, 'end');
          }
          text.focus();
        });
        return button;
      }));
    } else if (mode === 'stickers') {
      setPickerStatus(tr('Загрузка…'));
      const result = await call('sticker-packs').catch(() => ({ error: 'Не удалось выполнить действие в Telegram.' }));
      if (sequence !== pickerRequest) return;
      if (!result.packs?.length) {
        setPickerStatus(tr(result.error || 'Установленных наборов стикеров нет.'));
        return;
      }
      await showStickers(renderPackList(result.packs));
    }
  }

  emojiButton.addEventListener('click', () => showPicker(pickerMode === 'emoji' ? undefined : 'emoji'));
  stickerButton.addEventListener('click', () => showPicker(pickerMode === 'stickers' ? undefined : 'stickers'));
  packToggle.addEventListener('click', () => togglePackList(packList.hidden));
  picker.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || packList.hidden) return;
    event.stopPropagation();
    togglePackList(false);
    packToggle.focus();
  });

  text.addEventListener('paste', event => {
    if (selected === undefined) return;
    const item = Array.from(event.clipboardData?.items || [])
      .find(entry => ['image/png', 'image/jpeg'].includes(entry.type));
    const image = item?.getAsFile();
    if (!image) return;
    event.preventDefault();
    if (image.size > 10_000_000) {
      status.textContent = tr('Размер изображения должен быть до 10 МБ.');
      return;
    }
    photos.set(selected, image);
    renderAttachment();
    status.textContent = '';
  });

  document.getElementById('telegramRemoveAttachment').addEventListener('click', () => {
    photos.delete(selected);
    renderAttachment();
    text.focus();
  });

  function renderUnread(count = 0) {
    lastUnreadCount = count;
    compactBadge.hidden = tabCount.hidden = count <= 0;
    compactCount.textContent = tabCount.textContent = countLabel(count);
    const label = count > 0 ? tr("Telegram · непрочитанных: {0}", count) : 'Telegram';
    compactBadge.title = tab.title = label;
    tab.setAttribute('aria-label', label);
  }

  function animateIncomingNotification() {
    const now = performance.now();
    if (now - lastNotificationAnimation < 950 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    lastNotificationAnimation = now;
    const frames = [
      { scale: '1', boxShadow: '0 0 0 0 #8bdfff00' },
      { scale: '1.18', boxShadow: '0 0 0 4px #8bdfff5c', offset: 0.24 },
      { scale: '1', boxShadow: '0 0 0 8px #8bdfff00', offset: 0.66 },
      { scale: '1', boxShadow: '0 0 0 8px #8bdfff00' }
    ];
    const options = { duration: 900, easing: 'ease-out' };
    compactBadge.animate(frames, options);
    tabCount.animate(frames, options);
    tab.querySelector('svg')?.animate([
      { rotate: '0deg' }, { rotate: '-14deg' }, { rotate: '10deg' }, { rotate: '0deg' }
    ], { duration: 470, easing: 'ease-in-out' });
  }

  function markVisibleMessages() {
    if (!latestIncoming || latestIncoming.chatId !== selected || !document.hasFocus() ||
        !document.getElementById('island').classList.contains('telegram-expanded') ||
        history.scrollHeight - history.scrollTop - history.clientHeight > 16) return;
    const message = latestIncoming;
    latestIncoming = undefined;
    call('read', message).catch(() => {});
  }

  history.addEventListener('scroll', markVisibleMessages);
  window.addEventListener('focus', markVisibleMessages);

  function input(name, label, type = 'text') {
    const field = document.createElement('input');
    field.className = 'clip-search';
    field.name = name;
    field.type = type;
    field.placeholder = label;
    field.setAttribute('aria-label', label);
    field.required = true;
    return field;
  }

  async function refreshState() {
    const sequence = ++stateRequest;
    const result = await call('state');
    if (sequence !== stateRequest) return;
    const value = result.state || 'setup';
    const ready = value === 'authorizationStateReady';
    const qrActive = value === 'authorizationStateWaitOtherDeviceConfirmation';
    qrButton.hidden = value !== 'authorizationStateWaitPhoneNumber';
    qrPanel.hidden = !qrActive;
    if (qrActive && result.qr) {
      if (qrImage.getAttribute('src') !== result.qr) qrImage.src = result.qr;
    } else {
      qrImage.removeAttribute('src');
    }
    if (state !== value) {
      state = value;
      auth.hidden = ready || qrActive;
      chats.hidden = !ready;
      fields.replaceChildren();
      next.hidden = false;
      if (state === 'setup' || state === 'authorizationStateClosed') {
        fields.append(input('apiId', 'API ID'), input('apiHash', 'API Hash', 'password'));
        next.textContent = tr('Подключить');
      } else if (prompts[state]) {
        const [label, type] = prompts[state];
        fields.append(input('value', tr(label), type));
        next.textContent = tr('Продолжить');
      } else if (!ready) {
        next.hidden = true;
      }
    }
    status.textContent = tr(result.error || '') || (state === 'setup'
      ? tr('Создай приложение на my.telegram.org и введи API ID и API Hash.')
      : !ready && !qrActive && !prompts[state] && state !== 'authorizationStateClosed'
        ? (state === 'connecting' || state === 'authorizationStateWaitTdlibParameters' ? tr('Подключение…') : tr('Этот этап входа пока недоступен.'))
        : '');
    if (ready) {
      await refreshChats();
    } else {
      selected = undefined;
      latestIncoming = undefined;
      recentChats = [];
      chatListSignature = '';
      folderSignature = '';
      activeFolder = 'all';
      chatLimit = 60;
      folders.replaceChildren();
      avatarObserver.disconnect();
      avatars.clear();
      chatPhotos.clear();
      list.replaceChildren();
      filter.value = '';
      title.textContent = 'Telegram';
      empty.hidden = false;
      history.hidden = true;
      drafts.clear();
      photos.clear();
      documents.clear();
      replies.clear();
      showPicker();
      selectedPack = undefined;
      stickerImages.clear();
      stickerObserver.disconnect();
      renderReply();
      renderAttachment();
      renderDocuments();
      text.value = '';
      history.replaceChildren();
      reply.hidden = true;
    }
  }

  function renderFolders(items, mainPosition) {
    const entries = items.map(({ id, name }) => ({ id, name }));
    entries.splice(mainPosition || 0, 0, { id: 'all', name: tr('Все чаты') });
    entries.push({ id: 'archive', name: tr('Архив') });
    const signature = JSON.stringify([activeFolder, entries]);
    if (signature === folderSignature) return;
    folderSignature = signature;
    const scroll = folders.scrollLeft;
    const focused = document.activeElement?.dataset.folder;
    folders.replaceChildren(...entries.map(({ id, name }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.folder = id;
      button.textContent = name;
      button.title = name;
      button.setAttribute('aria-pressed', String(id === activeFolder));
      button.addEventListener('click', () => {
        if (id === activeFolder) return;
        activeFolder = id;
        for (const item of folders.children) item.setAttribute('aria-pressed', String(item === button));
        chatLimit = 60;
        list.scrollTop = 0;
        recentChats = [];
        loadingChats = true;
        chatLoadFailed = false;
        renderChats();
        void refreshChats();
      });
      return button;
    }));
    folders.scrollLeft = scroll;
    if (focused) Array.from(folders.children).find(button => button.dataset.folder === focused)?.focus({ preventScroll: true });
  }

  folders.addEventListener('wheel', event => {
    if (event.deltaX || folders.scrollWidth <= folders.clientWidth) return;
    const distance = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
    const before = folders.scrollLeft;
    folders.scrollLeft += distance;
    if (folders.scrollLeft !== before) event.preventDefault();
  }, { passive: false });

  async function refreshChats(retry = false) {
    const current = ++revision;
    const result = await call('chats', { key: activeFolder, retry });
    if (current !== revision || state !== 'authorizationStateReady') return;
    if (result.error) { status.textContent = tr(result.error); return; }
    activeFolder = result.key || activeFolder;
    loadingChats = !!result.loading;
    chatLoadFailed = !!result.failed;
    recentChats = result.chats || [];
    renderFolders(result.folders || [], result.mainFolderPosition);
    renderChats();
  }

  function selectTelegramChat(chat) {
    if (selected !== undefined) drafts.set(selected, text.value);
    selected = chat.id;
    const unassigned = documents.get(undefined);
    if (unassigned) {
      documents.set(selected, unassigned);
      documents.delete(undefined);
    }
    latestIncoming = undefined;
    title.textContent = chat.title;
    empty.hidden = true;
    history.hidden = false;
    text.value = drafts.get(selected) || '';
    renderAttachment();
    renderDocuments();
    renderReply();
    showPicker();
    for (const item of list.children) item.setAttribute('aria-pressed', String(item.dataset.chatId === String(selected)));
    reply.hidden = false;
    clearHistoryStickers();
    history.textContent = tr('Загрузка…');
    refreshHistory(true);
  }

  window.addEventListener('island-open-chat', event => {
    const chat = event.detail;
    if (!chat || !Number.isSafeInteger(chat.id) || typeof chat.title !== 'string') return;
    selectTelegramChat(chat);
  });

  function renderChats() {
    const query = filter.value.trim().toLocaleLowerCase();
    const matches = query ? recentChats.filter(chat => (chat.title || '').toLocaleLowerCase().includes(query)) : recentChats;
    const visible = matches.slice(0, chatLimit);
    const hasMore = matches.length > visible.length;
    const signature = JSON.stringify([query, visible, hasMore, loadingChats, chatLoadFailed]);
    if (signature === chatListSignature) return;
    chatListSignature = signature;
    const scroll = list.scrollTop;
    avatarObserver.disconnect();
    list.replaceChildren(...visible.map(chat => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'telegram-chat';
      const avatar = document.createElement('span');
      avatar.className = 'telegram-avatar';
      avatar.textContent = Array.from((chat.title || '').trim())[0]?.toLocaleUpperCase() || '•';
      avatar.setAttribute('aria-hidden', 'true');
      if (chat.avatarId) {
        avatar.dataset.chatId = chat.id;
        avatar.dataset.fileId = chat.avatarId;
        avatarObserver.observe(avatar);
      }
      const details = document.createElement('span');
      details.className = 'telegram-chat-details';
      const name = document.createElement('strong');
      name.textContent = chat.title;
      const preview = document.createElement('small');
      preview.textContent = chat.preview || '';
      details.append(name, preview);
      button.append(avatar, details);
      if (chat.unread > 0) {
        const badge = document.createElement('span');
        badge.className = 'telegram-chat-count';
        badge.textContent = countLabel(chat.unread);
        badge.setAttribute('aria-label', tr("Непрочитанных: {0}", chat.unread));
        button.append(badge);
      }
      button.title = chat.title;
      button.dataset.chatId = chat.id;
      button.setAttribute('aria-pressed', String(selected === chat.id));
      button.addEventListener('click', () => selectTelegramChat(chat));
      return button;
    }));
    if (!visible.length || loadingChats) {
      const hint = document.createElement('p');
      hint.className = 'telegram-list-empty';
      hint.textContent = loadingChats ? tr('Загружаю чаты…') : query ? tr('Чаты не найдены') : tr('Пока нет чатов');
      list.append(hint);
    }
    if (hasMore) {
      const more = document.createElement('button');
      more.className = 'btn-small telegram-more';
      more.textContent = tr('Показать ещё чаты');
      more.addEventListener('click', () => {
        chatLimit += 60;
        renderChats();
      });
      list.append(more);
    }
    if (chatLoadFailed && !loadingChats) {
      const retry = document.createElement('button');
      retry.className = 'btn-small telegram-more';
      retry.textContent = tr('Повторить загрузку чатов');
      retry.addEventListener('click', () => void refreshChats(true));
      list.append(retry);
    }
    list.scrollTop = scroll;
  }

  filter.addEventListener('input', () => {
    chatLimit = 60;
    list.scrollTop = 0;
    renderChats();
  });

  function identities(messages) {
    return messages.map(message => [message.id, message.text, message.pending, message.failed, message.read,
      message.photoId, message.fullPhotoId, message.thumbnail, message.sender, message.reply, message.sticker, message.documentName]);
  }

  function clearHistoryStickers() {
    for (const art of history.querySelectorAll('.telegram-sticker-art')) stickerObserver.unobserve(art);
  }

  function renderQuote(message, chatId, messagesById) {
    const reference = message.reply;
    const original = reference.chatId === chatId ? messagesById.get(reference.id) : undefined;
    const quote = document.createElement(original ? 'button' : 'blockquote');
    quote.className = 'telegram-quote';
    writeQuote(quote, original ? messageAuthor(original) : tr('Ответ на сообщение'),
      reference.preview || original?.text || tr('Исходное сообщение'));
    if (original) {
      quote.type = 'button';
      quote.addEventListener('click', () => {
        const target = document.getElementById(`telegram-message-${original.id}`);
        target.scrollIntoView({ block: 'nearest' });
        target.classList.add('telegram-message-highlight');
        target.addEventListener('animationend', () => target.classList.remove('telegram-message-highlight'), { once: true });
      });
    }
    return quote;
  }

  document.getElementById('telegramClosePhoto').addEventListener('click', () => viewer.close());
  viewer.addEventListener('click', event => {
    if (event.target === viewer) viewer.close();
  });
  viewer.addEventListener('close', () => {
    viewerRequest++;
    viewerImage.removeAttribute('src');
  });

  async function openPhoto(message, chatId, preview) {
    const sequence = ++viewerRequest;
    viewerImage.hidden = !preview;
    if (preview) viewerImage.src = preview;
    else viewerImage.removeAttribute('src');
    viewerStatus.textContent = message.fullPhotoId ? tr('Загрузка фото…') : '';
    viewer.showModal();
    if (!message.fullPhotoId) return;
    const result = await call('photo', { chatId, fileId: message.fullPhotoId }).catch(() => ({}));
    if (sequence !== viewerRequest || !viewer.open) return;
    if (result.image) {
      viewerImage.src = result.image;
      viewerImage.hidden = false;
    }
    viewerStatus.textContent = result.image ? '' : tr('Не удалось загрузить фото в полном размере.');
  }

  const chatPhotos = new Map();
  function renderPhoto(message, chatId) {
    const image = document.createElement('img');
    image.className = 'telegram-message-photo';
    image.alt = tr('Фото из переписки');
    if (message.thumbnail) image.src = message.thumbnail;
    if (message.photoId) {
      const fileId = message.photoId;
      if (!chatPhotos.has(fileId)) {
        chatPhotos.set(fileId, call('photo', { chatId, fileId }).then(result => result.image).catch(() => undefined));
        if (chatPhotos.size > 30) chatPhotos.delete(chatPhotos.keys().next().value);
      }
      const download = chatPhotos.get(fileId);
      download.then(url => {
        if (url) image.src = url;
        else if (chatPhotos.get(fileId) === download) chatPhotos.delete(fileId);
      });
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'telegram-photo-button';
    button.setAttribute('aria-label', tr('Увеличить фото'));
    button.append(image);
    button.addEventListener('click', () => openPhoto(message, chatId, image.getAttribute('src')));
    return button;
  }
  async function refreshHistory(forceBottom = false) {
    const chatId = selected;
    const sequence = ++request;
    if (chatId === undefined) return;
    const result = await call('history', { chatId });
    if (sequence !== request || chatId !== selected) return;
    if (result.error) { status.textContent = tr(result.error); return; }
    const messages = result.messages || [];
    const lastIncoming = messages.findLast(message => !message.outgoing);
    latestIncoming = lastIncoming ? { chatId, messageId: lastIncoming.id } : undefined;
    const signature = JSON.stringify([chatId, identities(messages)]);
    if (!forceBottom && signature === history.dataset.signature) {
      markVisibleMessages();
      return;
    }
    history.dataset.signature = signature;
    const atBottom = forceBottom || history.scrollHeight - history.scrollTop - history.clientHeight < 30;
    const messagesById = new Map(messages.map(message => [message.id, message]));
    clearHistoryStickers();
    history.replaceChildren(...messages.map(message => {
      const item = document.createElement('div');
      item.className = message.outgoing ? 'telegram-message outgoing' : 'telegram-message';
      item.id = `telegram-message-${message.id}`;
      if (message.reply) item.append(renderQuote(message, chatId, messagesById));
      const body = document.createElement('span');
      body.textContent = message.text;
      const time = document.createElement('small');
      time.textContent = message.failed ? tr('Ошибка') : message.pending ? tr('Отправка…')
        : new Date(message.date * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (message.photoId || message.thumbnail) {
        item.append(renderPhoto(message, chatId));
        if (message.text !== 'Фото') item.append(body);
      } else if (message.sticker) {
        item.append(renderSticker(message.sticker, chatId));
      } else if (message.documentName) {
        const filename = document.createElement('span');
        filename.className = 'telegram-document-name';
        filename.textContent = `📎 ${message.documentName}`;
        item.append(filename);
        if (message.text !== message.documentName) item.append(body);
      } else {
        item.append(body);
      }
      item.append(time);
      if (typeof message.read === 'boolean') {
        const receipt = document.createElement('span');
        receipt.className = message.read ? 'telegram-receipt read' : 'telegram-receipt';
        receipt.textContent = message.read ? '✓✓' : '✓';
        receipt.title = message.read ? tr('Прочитано') : tr('Отправлено');
        receipt.setAttribute('aria-label', receipt.title);
        item.append(receipt);
      }
      if (message.id > 0 && !message.pending && !message.failed) {
        const respond = document.createElement('button');
        respond.type = 'button';
        respond.className = 'telegram-message-reply';
        respond.textContent = '↩';
        respond.title = tr('Ответить');
        respond.setAttribute('aria-label', respond.title);
        respond.addEventListener('click', () => {
          replies.set(chatId, message);
          renderReply();
          text.focus();
        });
        item.append(respond);
      }
      return item;
    }));
    if (!messages.length) history.textContent = tr('Нет сообщений');
    if (atBottom) history.scrollTop = history.scrollHeight;
    markVisibleMessages();
  }

  auth.addEventListener('submit', async event => {
    event.preventDefault();
    if (next.disabled || requestingQr) return;
    next.disabled = true;
    qrButton.disabled = true;
    const data = new FormData(auth);
    try {
      const result = data.has('apiId')
        ? await call('configure', { apiId: data.get('apiId'), apiHash: data.get('apiHash') })
        : await call('auth', data.get('value'));
      if (result.error) status.textContent = tr(result.error);
      else await refreshState();
    } finally {
      next.disabled = false;
      qrButton.disabled = false;
    }
  });

  qrButton.addEventListener('click', async () => {
    if (requestingQr || next.disabled) return;
    requestingQr = true;
    qrButton.disabled = true;
    next.disabled = true;
    status.textContent = tr('Получаю QR-код…');
    try {
      const result = await call('qr');
      if (result.error) status.textContent = tr(result.error);
      else await refreshState();
    } catch {
      status.textContent = tr('Не удалось получить QR-код.');
    } finally {
      requestingQr = false;
      qrButton.disabled = false;
      next.disabled = false;
    }
  });

  function clearSentReply(chatId, target) {
    if (target && replies.get(chatId) === target) {
      replies.delete(chatId);
      if (selected === chatId) renderReply();
    }
  }

  async function sendSticker(packId, stickerId) {
    if (send.disabled || selected === undefined) return;
    const chatId = selected;
    const target = replies.get(chatId);
    send.disabled = true;
    try {
      const result = await call('send-sticker', { chatId, packId, stickerId, text: '', replyTo: target?.id });
      if (selected === chatId) status.textContent = tr(result.error || '');
      if (!result.error) {
        clearSentReply(chatId, target);
        if (selected === chatId) {
          showPicker();
          await refreshHistory(true);
        }
      }
    } catch {
      if (selected === chatId) status.textContent = tr('Не удалось отправить сообщение.');
    } finally {
      send.disabled = false;
    }
  }

  reply.addEventListener('submit', async event => {
    event.preventDefault();
    if (send.disabled || selected === undefined) return;
    const chatId = selected;
    const body = text.value;
    const photo = photos.get(chatId);
    const files = documents.get(chatId) || [];
    const target = replies.get(chatId);
    if (!body.trim() && !photo && !files.length) return;
    const outgoing = [];
    if (photo) outgoing.push({ action: 'send-photo', photo });
    for (const file of files) outgoing.push({ action: 'send-document', file });
    if (!outgoing.length) outgoing.push({ action: 'send' });
    send.disabled = true;
    try {
      let caption = body;
      let remaining = outgoing.length;
      for (const [index, item] of outgoing.entries()) {
        if (state !== 'authorizationStateReady') break;
        const payload = { chatId, ...item.file, text: caption, replyTo: target?.id };
        if (item.photo) payload.image = new Uint8Array(await item.photo.arrayBuffer());
        const result = await call(item.action, payload);
        if (selected === chatId) status.textContent = tr(result.error || '');
        if (result.error) break;
        if (index === 0) {
          if (drafts.get(chatId) === body) drafts.delete(chatId);
          if (selected === chatId && text.value === body) text.value = '';
          caption = '';
        }
        remaining--;
        if (item.photo && photos.get(chatId) === item.photo) {
          photos.delete(chatId);
          if (selected === chatId) renderAttachment();
        }
        if (item.file) {
          removeDocument(chatId, item.file);
          if (selected === chatId) renderDocuments();
        }
      }
      if (!remaining) clearSentReply(chatId, target);
      if (selected === chatId) await refreshHistory(true);
    } catch {
      status.textContent = tr('Не удалось отправить сообщение.');
    } finally {
      send.disabled = false;
    }
  });

  document.getElementById('telegramLogout').addEventListener('click', async () => {
    const result = await call('logout');
    if (result.error) status.textContent = tr(result.error);
    else await refreshState();
  });
  window.addEventListener('telegram-open', async () => {
    await refreshState();
    if (selected !== undefined) await refreshHistory();
  });
  window.addEventListener('island-language-change', () => {
    renderUnread(lastUnreadCount);
    renderReply();
    renderDocuments();
    if (pickerMode) showPicker(pickerMode);
    chatListSignature = '';
    delete history.dataset.signature;
    const field = fields.querySelector('[name=value]');
    if (field && prompts[state]) {
      field.placeholder = tr(prompts[state][0]);
      field.setAttribute('aria-label', field.placeholder);
    }
    if (state === 'setup' || state === 'authorizationStateClosed') next.textContent = tr('Подключить');
    if (prompts[state]) next.textContent = tr('Продолжить');
    if (document.getElementById('island').classList.contains('telegram-expanded')) {
      refreshState();
      if (selected !== undefined) refreshHistory();
    }
  });
  window.dexxyq.onTelegramUpdate(update => {
    if (update.type === 'unread') {
      unreadEventReceived = true;
      renderUnread(update.count);
      return;
    }
    if (update.type === 'incoming') { animateIncomingNotification(); return; }
    if (!document.getElementById('island').matches('.telegram-expanded:not(.opening)')) return;
    if (update.type === 'auth') { refreshState(); return; }
    if (update.type === 'chats') { void refreshChats(); return; }
    if (update.type === 'sticker-packs') {
      if (pickerMode === 'stickers') showPicker('stickers');
      return;
    }
    if (update.sent && update.chatId === selected) {
      setMascotMood('love', 'Сообщение улетело! 💗', 3000);
    }
    if (update.failed) status.textContent = tr('Telegram не отправил сообщение.');
    if (selected !== undefined && (update.chatId === undefined || update.chatId === selected)) refreshSelectedHistory = true;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (state !== 'authorizationStateReady' || !document.getElementById('island').matches('.telegram-expanded:not(.opening)')) return;
      const refreshMessages = refreshSelectedHistory;
      refreshSelectedHistory = false;
      await refreshChats();
      if (refreshMessages) await refreshHistory();
    }, 450);
  });
  call('unread').then(result => {
    if (!unreadEventReceived) renderUnread(result.unread);
  }).catch(() => {});
})();
