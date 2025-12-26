# Команды для сборки расширения

## Быстрая сборка для разработки
```bash
# Запуск dev-сервера (для Chrome)
pnpm dev

# Просмотр собранного расширения
pnpm preview
```

## Сборка для конкретного браузера
```bash
# Собрать для Chrome
pnpm build:chrome

# Собрать для Firefox
pnpm build:firefox

# Собрать для Edge
pnpm build:edge
```

## Полная сборка всех браузеров
```bash
# Собрать для всех браузеров и упаковать
pnpm build
```

## Упаковка готовых файлов
```bash
# Упаковать Chrome в CRX
pnpm pack:chrome

# Упаковать Firefox в ZIP
pnpm pack:firefox

# Упаковать Edge в CRX
pnpm pack:edge
```

## Структура проекта

```
/src
  /manifest.json           - основной manifest (текущий браузер)
  /manifests/
    /manifest.chrome.json  - конфиг для Chrome
    /manifest.firefox.json - конфиг для Firefox
    /manifest.edge.json    - конфиг для Edge
  /popup/
  /content/
  /icons/
  /_locales/

/dist
  /chrome/                 - собранное расширение для Chrome
  /firefox/                - собранное расширение для Firefox
  /edge/                   - собранное расширение для Edge

/builds                    - готовые к распространению файлы
  /let-it-snow-chrome.crx
  /let-it-snow-firefox.zip
  /let-it-snow-edge.crx

/scripts
  /build.js                - скрипт для сборки всех браузеров
```

## Установка расширения

### Chrome/Edge
1. Откройте `chrome://extensions/` (Chrome) или `edge://extensions/` (Edge)
2. Включите "Режим разработчика"
3. Нажмите "Загрузить распакованное расширение"
4. Выберите папку `dist/chrome` или `dist/edge`

### Firefox
1. Откройте `about:debugging#/runtime/this-firefox`
2. Нажмите "Загрузить временное дополнение"
3. Выберите файл из папки `dist/firefox` или загруженный ZIP

## Отладка

### Для Chrome/Edge
- Используйте встроенные DevTools (F12)
- Консоль popup доступна через контекстное меню → "Inspect"

### Для Firefox
- Включите консоль браузера (Ctrl+Shift+K)
- Для content scripts используйте `console.log` с фильтром

## Примечания

- Файлы в `/manifests` содержат специфичные для браузера настройки
- Firefox требует уникальный ID в `browser_specific_settings`
- Автоматическая сборка восстанавливает оригинальный manifest после окончания
- Для zip-упаковки Firefox требуется установленная утилита `zip`

## Версионирование

- Используйте `pnpm version patch|minor|major` — скрипт `scripts/sync-version.js` автоматически проставит новую версию во всех manifest-файлах.
- Для ручного запуска синхронизации используйте `pnpm sync-version`.
