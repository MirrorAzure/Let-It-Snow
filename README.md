# Let It Snow - Browser Extension

A beautiful customizable snowfall effect extension for any website.

Current version: **2.0.5** (April 2026)

## Store Description (v2.0.5)

### English

Let it snow adds a festive snowfall effect to any website and gives you full control over the animation style.

Create your own winter look:
- Adjust snowflake count, fall speed, and size range
- Use custom symbols, long phrases, and multiple colors
- Add animated GIF flakes from URLs or local files
- Interact with snow using mouse and touch gestures
- Save and switch presets for different moods
- Import and export settings in JSON
- Transfer all presets during import/export with one toggle
- Restore built-in preset templates in one click
- Enjoy smooth rendering with WebGPU and a reliable Canvas 2D fallback
- Use the extension in English and Russian

Perfect for holiday vibes, stream styling, demos, and everyday beautiful browsing.

Changes in version 2.0.5 (from 2.0.4):
- Improved glyph size range normalization with shared 2-10% handling and legacy value conversion
- Enhanced glyph size preview fidelity to better match renderer output
- Added tests for glyph size normalization edge cases

Privacy
Let it snow does not collect, sell, or share personal data.
The extension works locally in your browser and stores only your visual settings (for example: snowflake count, symbols, colors, presets, popup width) in browser storage (chrome.storage).
No account, registration, analytics, or tracking is required.
If you manually add GIF URLs, these files are requested directly from the specified source in your browser to display animation.

### Русский

Let it snow добавляет праздничный эффект снегопада на любой сайт и позволяет гибко настроить внешний вид анимации.

Создайте свой зимний стиль:
- Настраивайте количество снежинок, скорость падения и диапазон размеров
- Используйте собственные символы, длинные фразы и несколько цветов
- Добавляйте анимированные GIF-снежинки по ссылке или из локальных файлов
- Взаимодействуйте со снегом мышью и touch-жестами
- Сохраняйте и переключайте пресеты под разное настроение
- Импортируйте и экспортируйте настройки в JSON
- Переносите все пресеты при импорте/экспорте одним переключателем
- Восстанавливайте встроенные шаблоны пресетов в один клик
- Получайте плавный рендеринг в WebGPU и надежный Canvas 2D fallback
- Пользуйтесь расширением на английском и русском языках

Идеально для праздничной атмосферы, оформления стримов, демо и просто красивого повседневного браузинга.

Изменения в версии 2.0.5 (с 2.0.4):
- Улучшена нормализация диапазона размеров символов с единым правилом 2-10% и конвертацией legacy-значений
- Повышена точность предпросмотра размеров символов для большего соответствия реальному рендерингу
- Добавлены тесты для граничных сценариев нормализации размеров

Конфиденциальность
Let it snow не собирает, не продает и не передает персональные данные.
Расширение работает локально в браузере и сохраняет только ваши визуальные настройки (например: количество снежинок, символы, цвета, пресеты, ширину popup) в хранилище браузера (chrome.storage).
Аккаунт, регистрация, аналитика и трекинг не требуются.
Если вы вручную добавляете URL GIF, эти файлы запрашиваются напрямую с указанного источника в вашем браузере для отображения анимации.

## Installation & Setup

### Prerequisites
- Node.js 16.x or higher
- pnpm package manager (install with: `npm install -g pnpm`)

### Installation

1. Clone or navigate to the project directory
2. Install dependencies:
```bash
pnpm install
```

## Development

### 🎨 Playground - Quick Testing with Hot Reload

**Quick way to test animations and popup UI WITHOUT installing the extension:**

```bash
pnpm run playground
```

✅ Snow animation playground with HMR for `src/content/`  
✅ Popup UI playground with HMR for `src/popup/`  
✅ Full WebGPU/Fallback2D functionality  
✅ All parameters configurable via UI  

Open:
- Snow animation: `http://localhost:5173/playground/`
- Popup UI: `http://localhost:5173/playground/popup-playground.html`

**[Learn more about Playground →](./playground/README.md)**

### Build for development
```bash
pnpm run dev
```
This starts the Vite development server for extension building.

### Build for production
```bash
pnpm run build
```
This builds for all browsers and outputs:
- Unpacked builds in `dist/chrome`, `dist/firefox`, `dist/edge`
- Packaged artifacts in `builds/` (ZIPs for Chrome/Firefox and CRX for Edge)

### Packaging (optional)
```bash
pnpm run pack:chrome
pnpm run pack:firefox
pnpm run pack:edge
```
Use these if you want to regenerate specific artifacts after a build.

### Load the extension in Chrome

1. Run `pnpm run build` to generate the dist folder
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `dist/chrome` folder from your project

## Architecture Diagram

Architecture materials in `diagrams/` are up to date for version **2.0.5**.

Project Architecture:
- **Web Pages** — web pages where the extension works
- **Content Script** — main extension script with the snowfall engine
- **Renderers** — WebGPU (modern) and Fallback 2D (compatibility)
- **Graphics Layer** — atlas and uniform buffer management for WebGPU
- **Physics Layer** — simulation, collisions, mouse interactions, and shared wind field
- **Shared Utilities** — viewport stability and circular cursor helpers used across renderers
- **Popup UI** — extension control interface
- **Settings Manager** — settings management and saving
- **Localization** — support for English and Russian languages
- **Storage** — saving user settings
- **Manifest Config** — configurations for Chrome, Firefox and Edge

## Project Structure

```
src/
├── manifest.json          # Extension configuration
├── content/
│   ├── index.js          # Content script (injected into web pages)
│   ├── webgpu-renderer.js    # WebGPU rendering engine
│   ├── fallback-2d-renderer.js  # 2D Canvas fallback
│   ├── gif-layer.js      # GIF layer support
│   ├── shader.wgsl       # WebGPU shaders
│   ├── graphics/
│   │   ├── atlas-manager.js   # Glyph/sentence atlas handling
│   │   └── uniform-buffer.js  # Uniform buffer management
│   ├── physics/
│   │   ├── simulation-engine.js  # Frame simulation logic
│   │   ├── collision-handler.js  # Flake collisions
│   │   ├── mouse-handler.js      # Mouse interaction
│   │   └── wind-field.js         # Shared wind + vortex field physics
│   └── utils/
│       ├── background-monitor.js      # Background monitoring
│       ├── color-utils.js             # Color utilities
│       ├── glyph-utils.js             # Glyph/symbol utilities
│       ├── glyph-quality-estimator.js # Glyph complexity analysis for atlas sizing
│       ├── size-utils.js              # Viewport/canvas size resolution
│       ├── viewport-utils.js          # Stable viewport size resolver
│       └── circular-cursor.js         # Shared circular index helper
├── popup/
│   ├── popup.html        # Popup UI
│   ├── popup.js          # Popup logic
│   ├── settings.js       # Settings management
│   ├── ui-controllers.js # UI controls
│   ├── localization.js   # Localization logic
│   ├── popup.css         # Popup styles
│   └── presets/
│       └── built-in-presets.js  # Built-in preset templates
├── _locales/
│   ├── en/
│   │   └── messages.json # English translations
│   └── ru/
│       └── messages.json # Russian translations
├── manifests/
│   ├── manifest.chrome.json   # Chrome manifest
│   ├── manifest.firefox.json  # Firefox manifest
│   └── manifest.edge.json     # Edge manifest
└── icons/                     # Extension icons
```

## Features

- **Customizable snowflakes**: Adjust count, size, and falling speed
- **Color selection**: Choose multiple colors for snowflakes
- **Symbol customization**: Use different characters as snowflakes, with per-symbol text/emoji render mode toggle
- **Presets**: Save and load custom presets; built-in seasonal templates (Winter, Spring, etc.)
- **GIF support**: Add GIFs by URL or local file upload
- **Mouse interaction**: Push, swirl, and drag snow with pointer movement
- **Soft collisions**: Snowflakes gently bounce off each other
- **Wind effects**: Physically accurate wind simulation with turbulence
  - Multi-layer wind turbulence (low, medium, high frequencies)
  - Wind applies as force/acceleration (not just displacement)
  - Size-dependent wind resistance (smaller flakes affected more)
  - Vertical lift effect during strong winds
  - Dual moving vortex field with opposite rotation directions
  - Per-session randomized vortex trajectories to avoid static hotspot patterns
  - Shared wind physics module used by both WebGPU and Fallback 2D renderers
- **Atlas quality estimation**: Automatic glyph complexity analysis for optimal WebGPU atlas cell sizing
- **Glyph size normalization**: Shared size range normalization with 2-10% limits and legacy value conversion
- **About tab**: Version, authors, repository, and tech stack in popup
- **Configurable popup width**: Adjustable popup panel width in screen percent with instant % + px preview
- **Settings persistence**: All settings are automatically saved
- **Multi-language support**: English and Russian translations

## Building with Vite

This extension uses Vite with the CRXJS plugin for building Chrome extensions. The configuration automatically:
- Bundles JavaScript modules
- Processes CSS imports
- Handles manifest versioning
- Optimizes assets for production

## Notes

- Icons need to be placed in `src/icons/` directory (16px, 48px, 128px)
- The dist folder is generated during build and should not be committed to git
- Use `pnpm` commands instead of `npm` for consistency
- `activeTab` permission removed from manifests

## Browser Support

- Chrome/Chromium-based browsers (Manifest V3)
- Tested on Chrome 90+

## License

See LICENSE file for details
