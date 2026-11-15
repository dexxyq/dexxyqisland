(() => {
  const auth = document.getElementById('telegramAuth');
  const fields = document.getElementById('telegramFields');
  const next = document.getElementById('telegramContinue');
  const qrButton = document.getElementById('telegramQrButton');
  const qrPanel = document.getElementById('telegramQr');
  const qrImage = document.getElementById('telegramQrImage');
  const chats = document.getElementById('telegramChats');
  const list = document.getElementById('telegramChatList');
  const filter = document.getElementById('telegramFilter');
  const title = document.getElementById('telegramChatTitle');
  const empty = document.getElementById('telegramEmpty');
  const history = document.getElementById('telegramHistory');
  const reply = document.getElementById('telegramReply');
  const text = document.getElementById('telegramText');
  const attachment = document.getElementById('telegramAttachment');
  const attachmentImage = document.getElementById('telegramAttachmentImage');
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
  let latestIncoming;
  let viewerRequest = 0;
  let unreadEventReceived = false;
  let lastUnreadCount = 0;
  const drafts = new Map();
  const photos = new Map();
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

  function renderAttachment() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const image = photos.get(selected);
    attachment.hidden = !image;
    previewUrl = image ? URL.createObjectURL(image) : undefined;
    if (previewUrl) attachmentImage.src = previewUrl;
    else attachmentImage.removeAttribute('src');
  }

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
      filter.value = '';
      title.textContent = 'Telegram';
      empty.hidden = false;
      history.hidden = true;
      drafts.clear();
      photos.clear();
      renderAttachment();
      text.value = '';
      history.replaceChildren();
      reply.hidden = true;
    }
  }

  async function refreshChats() {
    const current = ++revision;
    const result = await call('chats');
    if (current !== revision || state !== 'authorizationStateReady') return;
    if (result.error) { status.textContent = tr(result.error); return; }
    recentChats = result.chats || [];
    renderChats();
  }

  function renderChats() {
    const query = filter.value.trim().toLocaleLowerCase();
    const visible = recentChats.filter(chat => (chat.title || '').toLocaleLowerCase().includes(query));
    const signature = JSON.stringify([query, visible]);
    if (signature === chatListSignature) return;
    chatListSignature = signature;
    const scroll = list.scrollTop;
    list.replaceChildren(...visible.map(chat => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'telegram-chat';
      const avatar = document.createElement('span');
      avatar.className = 'telegram-avatar';
      avatar.textContent = Array.from((chat.title || '').trim())[0]?.toLocaleUpperCase() || '•';
      avatar.setAttribute('aria-hidden', 'true');
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
      button.setAttribute('aria-pressed', String(selected === chat.id));
      button.addEventListener('click', () => {
        if (selected !== undefined) drafts.set(selected, text.value);
        selected = chat.id;
        latestIncoming = undefined;
        title.textContent = chat.title;
        empty.hidden = true;
        history.hidden = false;
        text.value = drafts.get(selected) || '';
        renderAttachment();
        for (const item of list.children) item.setAttribute('aria-pressed', String(item === button));
        reply.hidden = false;
        history.textContent = tr('Загрузка…');
        refreshHistory(true);
      });
      return button;
    }));
    if (!visible.length) {
      const hint = document.createElement('p');
      hint.className = 'telegram-list-empty';
      hint.textContent = query ? tr('Чаты не найдены') : tr('Пока нет чатов');
      list.append(hint);
    }
    list.scrollTop = scroll;
  }

  filter.addEventListener('input', renderChats);

  function identities(messages) {
    return messages.map(message => [message.id, message.text, message.pending, message.failed, message.read,
      message.photoId, message.fullPhotoId, message.thumbnail]);
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
    history.replaceChildren(...messages.map(message => {
      const item = document.createElement('div');
      item.className = message.outgoing ? 'telegram-message outgoing' : 'telegram-message';
      const body = document.createElement('span');
      body.textContent = message.text;
      const time = document.createElement('small');
      time.textContent = message.failed ? tr('Ошибка') : message.pending ? tr('Отправка…')
        : new Date(message.date * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (message.photoId || message.thumbnail) {
        item.append(renderPhoto(message, chatId));
        if (message.text !== 'Фото') item.append(body);
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

  reply.addEventListener('submit', async event => {
    event.preventDefault();
    if (send.disabled || selected === undefined) return;
    const chatId = selected;
    const body = text.value;
    const photo = photos.get(chatId);
    if (!body.trim() && !photo) return;
    send.disabled = true;
    try {
      const result = photo
        ? await call('send-photo', { chatId, text: body, image: new Uint8Array(await photo.arrayBuffer()) })
        : await call('send', { chatId, text: body });
      status.textContent = tr(result.error || '');
      if (!result.error) {
        if (drafts.get(chatId) === body) drafts.delete(chatId);
        if (selected === chatId && text.value === body) text.value = '';
        if (photo && photos.get(chatId) === photo) {
          photos.delete(chatId);
          if (selected === chatId) renderAttachment();
        }
        await refreshHistory(selected === chatId);
      }
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
    if (!document.getElementById('island').classList.contains('telegram-expanded')) return;
    if (update.type === 'auth') { refreshState(); return; }
    if (update.sent && update.chatId === selected) {
      setMascotMood('love', 'Сообщение улетело! 💗', 3000);
    }
    if (update.failed) status.textContent = tr('Telegram не отправил сообщение.');
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (state !== 'authorizationStateReady') return;
      await refreshChats();
      await refreshHistory();
    }, 450);
  });
  call('unread').then(result => {
    if (!unreadEventReceived) renderUnread(result.unread);
  }).catch(() => {});
})();
