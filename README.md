<p align="center">
  <img src="build/icon.png" width="92" alt="DexxyqIsland">
</p>

<h1 align="center">DexxyqIsland</h1>

<p align="center">
  Динамический остров для Windows · A Dynamic Island for Windows<br>
  <strong>Windows x64 · Electron · 1.3.0-beta.18</strong>
</p>

<p align="center">
  <a href="#русский">Русский</a> · <a href="#english">English</a> · <a href="#скриншоты--screenshots">Скриншоты / Screenshots</a>
</p>

![DexxyqIsland с открытым плеером SoundCloud / DexxyqIsland with the SoundCloud player open](docs/screenshots/soundcloud.png)

*В плеере SoundCloud видны обложка, прогресс трека, кнопки воспроизведения и реакция маскота. / The SoundCloud player shows album art, track progress, playback controls, and a mascot reaction.*

## Русский

**DexxyqIsland** — компактная панель вверху экрана Windows. Она раскрывается при наведении и даёт быстрый доступ к музыке, показателям ПК, Telegram, файлам, буферу обмена и закреплённым приложениям. Интерфейс доступен на русском и английском.

В этом репозитории находится **полный исходный код версии для Windows**, включая интерфейс, интеграции и конфигурацию сборки установщика. Код написан на JavaScript, HTML и CSS и работает на Electron.

### 📦 Установка и первые шаги

1. Открой **Releases** в этом репозитории и скачай `dexxyqisland-Setup-1.3.0-beta.18.exe` из раздела **Assets**.
2. Запусти установщик, выбери папку и при желании включи создание ярлыка и автозапуск.
3. Наведи курсор на капсулу вверху экрана. В шапке выбери нужную вкладку или нажми значок шестерёнки, чтобы открыть настройки.

| Вкладка | Как пользоваться |
| --- | --- |
| **Музыка** | Выбери SoundCloud, Spotify или Яндекс Музыку. Используй поиск, кнопки треков и регулятор громкости. Для управления Spotify запусти трек в клиенте Spotify для Windows. Кнопка **SP** открывает или закрывает клиент. |
| **Система** | Следи за загрузкой CPU, RAM и GPU, дисками и скоростью сети. Доступность показателей GPU зависит от оборудования. |
| **Полка** | Перетащи файлы на вкладку или нажми **+ Файл**. Забери файл перетаскиванием, открой двойным кликом или скопируй в системный буфер. |
| **Буфер** | Копируй текст и ссылки через **Ctrl+C**, а скриншоты делай через **Win+Shift+S**. Найди нужную запись в истории и нажми на неё для повторного копирования. |
| **Приложения** | Перетащи `.exe` или ярлык `.lnk` либо нажми **+ Приложение**. Клик по плитке запускает программу. Крестик убирает её из списка закреплений. |
| **Telegram** | Нажми самолётик, введи собственные API ID и API Hash с [my.telegram.org](https://my.telegram.org) и войди по QR-коду или номеру. Выбери чат, чтобы прочитать сообщения и ответить. **Ctrl+V** вставляет скриншот в поле ответа. Клик по фото в переписке открывает его крупнее. |

### ⌨️ Жесты и горячие клавиши

| Действие | Что произойдёт |
| --- | --- |
| **Правый клик по острову** | Сворачивает остров в тонкую полоску, чтобы он не перекрывал вкладки браузера. Правый клик по полоске возвращает обычную капсулу. По умолчанию то же делает **Alt+X**. |
| **Двойной клик по надписи `dexxyq`** | Возвращает остров в центр верхнего края текущего монитора. |
| **Перетаскивание надписи `dexxyq` левой кнопкой** | Сдвигает остров вдоль верхнего края. Так его можно перетащить и на другой монитор. |
| **Удерживай Ctrl или Alt при движении мыши** | Позволяет кликнуть по окну под островом. Отпусти клавишу и снова сдвинь курсор, чтобы взаимодействовать с островом. |
| **Alt+T** | По умолчанию включает или выключает режим «поверх всех окон». |
| **Правый клик по файлу на Полке** | Копирует файл в буфер обмена. Вставь его через **Ctrl+V** там, где поддерживается вставка файлов. |
| **Двойной клик по кнопке перемешивания** | Переключает на случайный трек в плеере. |
| **Двойной клик по маскоту** | Запускает анимацию **DEXXYQ OVERDRIVE**. |

**Настройки острова.** В верхней шестерёнке можно сменить язык, скрыть или вернуть кнопки панели и назначить горячие клавиши. FPS Boost снижает фоновую активность острова в игре. Кнопка монитора переносит остров на другой экран, а кнопка с булавкой удерживает его раскрытым.

**Маскот.** Нажимай на эмоции под ним или на самого маскота. В маленькой шестерёнке рядом с эмоциями можно выбрать цвет, аксессуар и свою фразу. Маскот также реагирует на запуск закреплённого приложения, отправку сообщения в Telegram и добавление нескольких файлов на Полку.

### Ранняя бета и обратная связь

Это только начало проекта. В бете могут встречаться баги, а отдельные функции могут по-разному работать на разных ПК. Буду рад отзывам и идеям. Расскажи, что можно сделать удобнее, чего не хватает и какие функции стоит добавить.

Открой **Issues** в этом репозитории, чтобы оставить предложение или сообщить о проблеме. Для бага полезно указать версию приложения и Windows, ожидаемое поведение и шаги воспроизведения. Отчёты и предложения можно писать на русском или английском.

## English

**DexxyqIsland** is a compact panel at the top of your Windows screen. Hover to expand it and access music, system stats, Telegram, files, clipboard history, and pinned apps. The interface is available in English and Russian.

This repository contains the **complete Windows application source**, including the interface, integrations, and installer build configuration. It is built with JavaScript, HTML, CSS, and Electron.

### 📦 Install and get started

1. Open **Releases** in this repository and download `dexxyqisland-Setup-1.3.0-beta.18.exe` under **Assets**.
2. Run the installer, choose an installation folder, and optionally enable the desktop shortcut and startup with Windows.
3. Hover over the capsule at the top of your screen. Choose a tab or use the gear icon in the header to open settings.

| Tab | How to use it |
| --- | --- |
| **Music** | Switch between SoundCloud, Spotify, and Yandex Music. Search for tracks and use the playback and volume controls. To control Spotify, start a track in Spotify for Windows. **SP** opens or quits the Spotify client. |
| **System** | See CPU, RAM, GPU, disk, and network stats. Available GPU metrics depend on your hardware. |
| **Shelf** | Drag files onto the shelf or click **+ File**. Drag a file back out, double-click to open it, or copy it to the Windows clipboard. |
| **Clipboard** | Copy text and links with **Ctrl+C**, or capture an area with **Win+Shift+S**. Find an entry in the history and click it to copy it again. |
| **Apps** | Drop an `.exe` or `.lnk` shortcut onto the tab, or click **+ App**. Click a tile to launch the app. Use the cross to unpin it. |
| **Telegram** | Click the paper plane, enter your own API ID and API hash from [my.telegram.org](https://my.telegram.org), and sign in by QR code or phone number. Open a chat to read and reply. Use **Ctrl+V** to paste a screenshot while composing. Click a photo in the conversation to enlarge it. |

### ⌨️ Gestures and keyboard shortcuts

| Action | What it does |
| --- | --- |
| **Right-click the island** | Collapses the island into a thin strip so it stays out of the way of browser tabs. Right-click the strip to restore the capsule. **Alt+X** does the same by default. |
| **Double-click the `dexxyq` label** | Moves the island back to the top center of the current monitor. |
| **Drag the `dexxyq` label with the left mouse button** | Moves the island along the top edge. You can also drag it to another monitor. |
| **Hold Ctrl or Alt while moving the mouse** | Lets you click the window underneath the island. Release the key and move the cursor again to interact with the island. |
| **Alt+T** | Toggles always-on-top by default. |
| **Right-click a file on the Shelf** | Copies it to the clipboard. Use **Ctrl+V** where pasting files is supported. |
| **Double-click the shuffle button** | Skips to a random track in the player. |
| **Double-click the mascot** | Plays the **DEXXYQ OVERDRIVE** animation. |

**Island settings.** Use the header gear to change the language, show or hide toolbar buttons, and assign shortcuts. FPS Boost reduces the island’s background activity during games. Use the monitor button to switch screens and the pin to keep the island open.

**Mascot.** Click the mascot or the reaction buttons below it. The small gear next to the reactions lets you pick a color, an accessory, and a custom line. The mascot also reacts when you launch a pinned app, send a Telegram message, or add several files to the shelf.

### Early beta and feedback

This project is just getting started. Expect bugs and differences across Windows setups. I’d love to hear what could be easier to use, what’s missing, or what you’d like to see added.

Open an **Issue** in this repository to share an idea or report a bug. For bug reports, include the app version, Windows version, expected behavior, and steps to reproduce. Feedback in English or Russian is welcome.

## Скриншоты / Screenshots

### Музыка / Music

![Плеер Spotify / Spotify player](docs/screenshots/spotify.png)

**Spotify.** Зелёная плашка обозначает активный сервис. Кнопка SP управляет клиентом для Windows. / The green panel identifies the active service. The SP button opens or quits the Windows client.

![Плеер Яндекс Музыки / Yandex Music player](docs/screenshots/yandex-music.png)

**Яндекс Музыка / Yandex Music.** Оранжевая плашка, поиск и кнопки воспроизведения. / Orange artwork panel, search, and playback controls.

### Система и файлы / System and files

![Вкладка Система / System tab](docs/screenshots/system.png)

**Система / System.** Карточки CPU, RAM, GPU и диска. Под ними доступны дополнительные показатели, включая температуру и скорость сети, когда они поддерживаются. / Cards show CPU, RAM, GPU, and disk usage, with details such as temperature and network speed where available.

![Вкладка Полка / Shelf tab](docs/screenshots/shelf.png)

**Полка / Shelf.** Пунктирная область принимает файлы. На снимке Полка пуста. / The dashed drop area accepts files. The screenshot shows the empty shelf.

![Вкладка Буфер / Clipboard tab](docs/screenshots/clipboard.png)

**Буфер / Clipboard.** Сверху поиск, захват текущего буфера и очистка. Список ниже заполняется скопированными записями. / Search, clipboard capture, and clear controls sit above the history list.

![Закреплённые приложения / Pinned apps](docs/screenshots/apps.png)

**Приложения / Apps.** Steam, Discord и Firefox показаны как отдельные плитки для запуска. / Steam, Discord, and Firefox are shown as individual launch tiles.

### Telegram и настройки / Telegram and settings

![Telegram со скрытой перепиской / Telegram with chat content redacted](docs/screenshots/telegram.png)

**Telegram.** Список чатов расположен слева, переписка справа, поле ответа внизу. Личные данные на снимке скрыты. Если есть непрочитанные личные сообщения, счётчик появляется у самолётика и в свёрнутом острове. / Chats sit on the left, the conversation on the right, and the reply field below. Personal details are redacted. Unread direct messages appear on the Telegram tab and the collapsed island.

![Настройки маскота / Mascot customization](docs/screenshots/mascot.png)

**Маскот / Mascot.** Предпросмотр показывает выбранный цвет, аксессуар и фразу до сохранения. На снимке выбрана корона. / Preview the color, accessory, and custom line before saving. The crown is selected here.

![Общие настройки острова / General island settings](docs/screenshots/settings.png)

**Настройки / Settings.** Кнопки «Русский» и «English» меняют язык интерфейса. Флажки показывают или скрывают кнопки шапки. Горячие клавиши настраиваются ниже. / Choose the language, show or hide individual toolbar buttons, and scroll down to configure shortcuts.

## Сборка из исходников / Build from source

Открой PowerShell в корне репозитория на Windows x64 с установленным Node.js и npm. / Open PowerShell in the repository root on Windows x64 with Node.js and npm installed.

```powershell
npm.cmd ci
npm.cmd start
```

Для сборки установщика выполни следующую команду. Готовый `.exe` появится в `dist`. / Run the following command to build the installer. The resulting `.exe` appears in `dist`.

```powershell
npm.cmd run dist
```

