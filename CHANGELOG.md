## 🇷🇺 DexxyqIsland 1.3.2 beta

Динамический остров для **Windows x64** с музыкой, Telegram, мониторингом ПК, файлами и быстрым доступом к повседневным действиям.

Этот выпуск объединяет изменения после **1.3.0 beta.18**.

### ✨ Новое в 1.3.2

- **Поиск по острову.** Кнопка **⌕** в шапке открывает поиск по закреплённым приложениям, папкам и ссылкам, файлам Полки, записям буфера и загруженным чатам подключённого Telegram. Стрелками можно выбрать результат, а Enter открывает его или копирует запись из буфера. По умолчанию глобальная горячая клавиша — **Ctrl+Shift+Space**. Внутри активного окна также работает **Ctrl+K**.
- **Избранное в буфере.** Нажми **☆** у записи, чтобы закрепить её. Кнопка **★** в панели буфера показывает избранное. Очистка истории сохраняет закреплённые записи. Можно закреплять текст, ссылки и скриншоты.
- **Таймеры и напоминания.** В панели **⌕ → Таймеры** задай название и время от 1 минуты до 7 дней. Можно создать до 20 таймеров. При срабатывании появляются уведомление Windows, запись в истории и реакция маскота.
- **Переключение звука.** В **⌕ → Звук** можно выбрать устройство вывода, микрофон и выключить или включить микрофон. Выбор устройства применяется к звуку Windows и звонкам. Список обновляется при открытии панели и по кнопке «Обновить».
- **Папки, файлы и ссылки в приложениях.** Во вкладке «Приложения» появились **+ Файл**, **+ Папка** и **+ Ссылка**. Можно закрепить документ, рабочую папку, сайт, программу или ярлык и открывать их плиткой.
- **Экспорт и импорт настроек.** Через **⌕ → Настройки** можно сохранить язык, кнопки панели, горячие клавиши и настройки маскота в JSON. Файл можно перенести на другой ПК. Перед применением импорт проверяется, затем остров перезагружается.
- **История уведомлений.** В **⌕ → Уведомления** сохраняются последние 100 событий острова, включая напоминания, уведомления Telegram, запуск закреплённых элементов и действия с Полкой. Из уведомления Telegram можно открыть соответствующий чат.

Таймеры работают при запущенном острове. После сна Windows проверяются просроченные напоминания. Если приложение было закрыто, такие напоминания появятся при следующем запуске. Доставка системного уведомления зависит от настроек уведомлений Windows.

### 💬 Изменения Telegram после beta.18

- Добавлены аватарки и ответы на конкретные сообщения с предпросмотром цитаты и отменой ответа.
- Можно прикреплять файлы с компьютера и отправлять их прямо с Полки.
- Добавлены эмодзи и стикеры из установленных наборов Telegram.
- Исправлено расположение списка наборов стикеров внутри острова.
- Доступны все чаты, архив и папки Telegram. Большие списки можно загружать дальше.
- Счётчик острова учитывает непрочитанные личные переписки. Для нового сообщения из незаглушённого личного чата добавлена короткая анимация уведомления.

### 🛠 Остальные изменения после beta.18

- В центре компактного острова появились часы.
- Текст и скриншоты из истории буфера можно перетаскивать на Полку. Они сохраняются как TXT и PNG.
- Облегчено определение трека настольной Яндекс Музыки, чтобы уменьшить связанную с опросом процессов нагрузку.
- Улучшено раскрытие при наведении. Внутренняя раскладка сохраняет размеры во время анимации, а обновление вкладки запускается после перехода.
- При повторном раскрытии Telegram сокращены изменения размера окна.
- Расширены русский и английский интерфейсы для новых функций.

### 📦 Как установить

Скачай **dexxyqisland-Setup-1.3.2-beta.exe** в **Assets** и установи приложение в ту же папку, где находится предыдущая версия.

Полный исходный код размещён в репозитории и в приложенном архиве **DexxyqIsland-source-1.3.2-beta.zip**.

### 🧪 Проверка и обратная связь

Новые сценарии, сохранение данных и импорт настроек проверены в отдельном профиле. Telegram проверялся на тестовых чатах, выбор звукового устройства и выключение микрофона — через Windows. Также проверены прежние функции Telegram, маскот и раскрытие острова.

Это ранняя бета, поэтому возможны баги и различия на разных ПК. Буду рад идеям и предложениям. Расскажи, что можно улучшить и какие функции стоит добавить. Сообщения об ошибках и пожелания можно оставлять в [Issues](https://github.com/dexxyq/dexxyqisland/issues) на русском или английском.

---

## 🇬🇧 DexxyqIsland 1.3.2 beta

A Dynamic Island for **Windows x64** with music controls, Telegram, system monitoring, files and shortcuts for everyday tasks.

This release includes changes made after **1.3.0 beta.18**.

### ✨ New in 1.3.2

- **Island search.** The **⌕** button searches pinned apps, folders and links, Shelf files, clipboard entries and loaded chats from your connected Telegram account. Use the arrow keys and Enter to open a result or copy a clipboard entry. The default global shortcut is **Ctrl+Shift+Space**. **Ctrl+K** also works while the island window is active.
- **Clipboard favorites.** Click **☆** beside an entry to pin it. The **★** toolbar button filters favorites. Clearing history keeps pinned entries. Text, links and screenshots can be pinned.
- **Timers and reminders.** Open **⌕ → Timers**, enter a title and set a duration from 1 minute to 7 days. Up to 20 timers are supported. A reminder triggers a Windows notification, a history entry and a mascot reaction.
- **Audio device controls.** In **⌕ → Audio**, choose an output device or microphone and mute or unmute a microphone. Device selection applies to Windows audio and calls. Devices refresh when the panel opens or when you click Refresh.
- **Pin folders, files and links.** The Apps tab now includes **+ File**, **+ Folder** and **+ Link**. Pin a document, work folder, website, application or shortcut and open it from a tile.
- **Export and import settings.** Under **⌕ → Settings**, save the language, toolbar buttons, keyboard shortcuts and mascot settings as JSON. Transfer the file to another PC. Imported settings are validated before application, then the island reloads.
- **Notification history.** **⌕ → Notifications** keeps the latest 100 island events, including reminders, Telegram notifications, opening pinned items and Shelf actions. A Telegram notification can open its chat.

Timers run while the island is open. Overdue reminders are checked after Windows resumes from sleep. If the app was closed, overdue reminders appear on its next launch. System notification delivery depends on your Windows notification settings.

### 💬 Telegram changes since beta.18

- Chat avatars and replies to specific messages, with a quote preview and the ability to cancel a reply.
- File attachments from your computer and directly from the Shelf.
- Emoji and stickers from your installed Telegram packs.
- The sticker pack list stays inside the island.
- Access to all chats, archived chats and Telegram folders, with loading more entries in large lists.
- The island badge counts unread direct chats. New messages from unmuted direct chats trigger a short notification animation.

### 🛠 Other changes since beta.18

- A clock in the center of the compact island.
- Drag clipboard text and screenshots onto the Shelf to save them as TXT and PNG files.
- Lighter desktop Yandex Music track detection to reduce process-query overhead.
- Improved hover expansion. Inner panels retain their size during the animation, and tab refreshes wait until the transition finishes.
- Fewer window resizes when repeatedly expanding Telegram.
- Russian and English translations for the new controls.

### 📦 Installation

Download **dexxyqisland-Setup-1.3.2-beta.exe** from **Assets** and install it into the same folder as your previous version.

The full source code is available in the repository and in the attached **DexxyqIsland-source-1.3.2-beta.zip** archive.

### 🧪 Validation and feedback

The new flows, persistence and settings import were checked in an isolated profile. Telegram checks used test chats. Output device selection and microphone muting were checked through Windows. Existing Telegram features, the mascot and hover expansion were also checked.

This is an early beta, so bugs and hardware differences are possible. Ideas and suggestions are welcome. Share what could be improved and what features you would like to see in [Issues](https://github.com/dexxyq/dexxyqisland/issues), in English or Russian.
