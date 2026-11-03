/*
 * Chrome Web Store listing texts (English + Russian).
 * {{version}} is replaced by the package version. "What's new" sections are extracted from
 * CHANGELOG.md (English) and CHANGELOG_RU.md (Russian); a warning is emitted when one is missing.
 */

export const LISTING = {
  en: {
    title: 'Let it snow',
    summary: 'Beautiful snowfall on any website: 3D snowflakes with glow, emoji, GIFs, wind, presets, external API and OBS overlay.',
    description: `Let it snow — v{{version}}

Turn any website into a winter scene. Snowflakes, emoji, text and GIFs gently fall over the page without getting in the way: the effect is click-through and works on every site.

KEY FEATURES
• Three renderers: fast WebGPU, compatible Canvas 2D and volumetric 3D (WebGL2) with tumbling extruded snowflakes.
• Soft glow that follows the shape of every flake, twinkles and adapts to light and dark pages automatically.
• Any symbols: snowflakes, stars, hearts, emoji (they keep their original colors), whole sentences and your own GIF images.
• Wind with gusts, adjustable direction and strength.
• Flexible settings: number of flakes, speed, size, color palette, 3D thickness.
• Presets apply instantly — even to a running snowfall; unsaved changes are never lost: save them as a new preset or into the current one.
• Built-in Help tab with searchable guides for every feature and integration, plus English and Russian documentation.
• Snowfall starts from the top of the screen and fills it naturally.

FOR STREAMERS AND POWER USERS
• Secure external API: trigger snow bursts, strong wind, specific glyphs or GIFs from scripts, bots or Stream Deck.
• Synchronize the effect across many tabs, windows and even several browsers.
• OBS Browser Source overlay with a transparent background and a standalone local relay (no Node.js required) plus an OBS script.
• Security first: loopback-only relay, token authentication, origin allowlist, strict command validation and rate limits.

PRIVACY
The extension does not collect, sell or transmit personal data. Settings are stored in your browser. The external API is disabled until you turn it on and works only on your computer.

LANGUAGES
English and Russian.

{{whatsNew}}`
  },
  ru: {
    title: 'Let it snow',
    summary: 'Красивый снегопад на любом сайте: 3D-снежинки со свечением, эмодзи, GIF, ветер, пресеты, внешний API и оверлей для OBS.',
    description: `Let it snow — v{{version}}

Превратите любой сайт в зимнюю сказку. Снежинки, эмодзи, текст и GIF мягко падают поверх страницы и не мешают работе: эффект пропускает клики и работает на любом сайте.

ОСНОВНЫЕ ВОЗМОЖНОСТИ
• Три режима отрисовки: быстрый WebGPU, совместимый Canvas 2D и объёмный 3D (WebGL2) с вращающимися объёмными снежинками.
• Мягкое свечение по форме каждой снежинки: мерцает и само подстраивается под светлые и тёмные страницы.
• Любые символы: снежинки, звёзды, сердечки, эмодзи (сохраняют свои цвета), целые фразы и собственные GIF-изображения.
• Ветер с порывами, настраиваемым направлением и силой.
• Гибкие настройки: количество, скорость, размер, палитра цветов, толщина в 3D.
• Пресеты применяются мгновенно — даже к уже идущему снегопаду; несохранённые изменения не теряются: их можно сохранить как новый пресет или в текущий.
• Встроенная вкладка «Помощь» с поиском и описанием всех функций и интеграций, документация на русском и английском.
• Снегопад начинается сверху экрана и заполняет его естественно.

ДЛЯ СТРИМЕРОВ И ПРОДВИНУТЫХ ПОЛЬЗОВАТЕЛЕЙ
• Безопасный внешний API: запускайте снежный залп, сильный ветер, нужные символы или GIF из скриптов, ботов или Stream Deck.
• Синхронизация эффекта между множеством вкладок, окон и даже разных браузеров.
• Оверлей для OBS (Browser Source) с прозрачным фоном, автономный локальный relay (без установки Node.js) и скрипт для OBS.
• Безопасность прежде всего: relay только на локальном адресе, авторизация по токену, список разрешённых источников, строгая проверка команд и ограничение частоты.

КОНФИДЕНЦИАЛЬНОСТЬ
Расширение не собирает, не продаёт и не передаёт персональные данные. Настройки хранятся в вашем браузере. Внешний API выключен, пока вы его не включите, и работает только на вашем компьютере.

ЯЗЫКИ
Английский и русский.

{{whatsNew}}`
  }
};

const HIDDEN_SECTIONS = /^###\s+(Security|Compatibility|Безопасность|Совместимость)/i;

const cleanMarkdown = (line) => line
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/\s*\((?:see|см\.)[^)]*\)/gi, '')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/\*\*([^*]+)\*\*/g, '$1')
  .trim();

export function extractChangelog(changelog, version) {
  const lines = String(changelog || '').split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start < 0) return [];
  const items = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('## ')) break;
    if (HIDDEN_SECTIONS.test(line)) {
      while (i + 1 < lines.length && !lines[i + 1].startsWith('#')) i += 1;
      continue;
    }
    const match = line.match(/^[-*]\s+(.*)$/);
    // Developer-only entries (build commands, CLI flags) are not interesting for store users.
    if (match && !/\bpnpm\b|\bCLI\b/.test(match[1])) items.push(cleanMarkdown(match[1]));
  }
  return items;
}

const firstSentence = (text) => {
  const match = text.match(/^(.+?[.!?])(\s|$)/);
  return match ? match[1] : text;
};

export function buildListing({ version, changelog, changelogRu, warn = () => {} }) {
  const enNews = extractChangelog(changelog, version).map(firstSentence);
  if (!enNews.length) warn(`CHANGELOG.md has no section for ${version}`);
  const ruNews = extractChangelog(changelogRu, version).map(firstSentence);
  if (!ruNews.length) warn(`CHANGELOG_RU.md has no section for ${version}`);

  const section = (heading, items) => (items.length ? `${heading}\n${items.map((item) => `• ${item}`).join('\n')}` : '');
  const news = {
    en: section(`WHAT'S NEW IN ${version}`, enNews),
    ru: section(`ЧТО НОВОГО В ${version}`, ruNews)
  };

  const result = {};
  for (const lang of Object.keys(LISTING)) {
    const source = LISTING[lang];
    const description = source.description
      .replaceAll('{{version}}', version)
      .replace('{{whatsNew}}', news[lang])
      .trim();
    result[lang] = { title: source.title, summary: source.summary, description };
    if (source.summary.length > 132) throw new Error(`${lang} summary is ${source.summary.length} > 132 chars`);
    if (description.length > 16000) throw new Error(`${lang} description is ${description.length} > 16000 chars`);
  }
  return result;
}
