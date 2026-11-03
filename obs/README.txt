Let It Snow — relay (standalone)
================================

RU
--
Relay — маленький локальный сервер для внешнего API, синхронизации окон и OBS.
Node.js и pnpm не нужны.

Вариант 1. Отдельное приложение
  1. Запустите let-it-snow-relay (Windows: let-it-snow-relay.exe) двойным кликом.
  2. В окне будут показаны токен и URL оверлея для OBS. Токен сохраняется в
     Windows: %APPDATA%\LetItSnow\relay-token.txt
     macOS:   ~/Library/Application Support/LetItSnow/relay-token.txt
     Linux:   ~/.config/let-it-snow/relay-token.txt
  3. Вставьте токен во вкладку «API» в popup расширения.
  Параметры: --port 8787, --token <...>, --token-file <путь>, --help.

Вариант 2. Скрипт OBS (relay запускается и останавливается вместе с OBS)
  1. Распакуйте архив в постоянную папку (exe и .lua должны лежать рядом).
  2. OBS → Инструменты → Скрипты → «+» → выберите let-it-snow-relay.lua.
  3. Нажмите «Add / update browser source» — в текущую сцену добавится источник
     «Let It Snow». Токен виден в настройках скрипта (поле Token).

macOS: если система блокирует запуск, выполните
  xattr -d com.apple.quarantine let-it-snow-relay
Linux: chmod +x let-it-snow-relay

Безопасность: relay слушает только 127.0.0.1; не публикуйте токен и URL оверлея
(в нём есть токен), не показывайте их на стриме.

EN
--
The relay is a tiny local server for the external API, window sync and OBS.
No Node.js or pnpm required.

Option 1. Standalone app
  Double-click let-it-snow-relay(.exe). It prints the token and the OBS overlay URL.
  The token is stored in the per-user config folder listed above.
  Paste the token into the extension popup → API tab.

Option 2. OBS script
  Keep the executable and let-it-snow-relay.lua in the same folder.
  OBS → Tools → Scripts → "+" → let-it-snow-relay.lua, then press
  "Add / update browser source".

The relay only listens on 127.0.0.1. Keep the token and the overlay URL private.
