# Let It Snow - Browser Extension

A beautiful customizable snowfall effect extension for any website.

Current version: **3.0.0**

See the [3.0.0 release notes](./CHANGELOG.md).

## Store Description (v3.0.0)

### English

Let it snow adds a festive, customizable snowfall effect to any website.

Create your own winter look:
- Adjust snowflake count, fall speed, and size range
- Use custom symbols, long phrases, and multiple colors
- Add animated GIF flakes from URLs or local files
- Interact with snow using mouse and touch gestures
- Enjoy automatic WebGPU rendering with a reliable Canvas 2D fallback
- Enable optional Three.js WebGL2 3D snowfall with perspective and tumbling
- Customize 3D glyphs, colors, and extrusion thickness
- See shape-matched glow effects that pulse with the snowflakes
- Save and switch presets for different moods
- Import and export settings in JSON
- Transfer all presets during import/export with one toggle
- Restore built-in preset templates in one click
- Use the extension in English and Russian

Perfect for holiday vibes, stream styling, demos, and everyday beautiful browsing.

Changes in version 3.0.0 (from 2.0.5):
- Added optional 3D snowfall with user-selected glyphs, colors, adjustable depth, perspective, and collisions
- Added shape-matched pulsing glow effects to WebGPU, Canvas 2D, and 3D rendering
- Improved renderer stability, glyph handling, and snow physics

Privacy
Let it snow does not collect, sell, or share personal data.
The extension works locally in your browser and stores only your visual settings (for example: snowflake count, symbols, colors, presets, popup width) in browser storage (chrome.storage).
No account, registration, analytics, or tracking is required.
If you manually add GIF URLs, these files are requested directly from the specified source in your browser to display animation.

### Русский

Let it snow добавляет на любой сайт праздничный настраиваемый снегопад.

Создайте свой зимний стиль:
- Настраивайте количество снежинок, скорость падения и диапазон размеров
- Используйте собственные символы, длинные фразы и несколько цветов
- Добавляйте анимированные GIF-снежинки по ссылке или из локальных файлов
- Взаимодействуйте со снегом мышью и touch-жестами
- Используйте автоматический рендеринг WebGPU с надежным резервным Canvas 2D
- Включайте дополнительный 3D-снегопад Three.js/WebGL2 с перспективой и вращением
- Настраивайте 3D-глифы, цвета и толщину объёмных снежинок
- Наблюдайте свечение по форме снежинок, пульсирующее вместе с ними
- Сохраняйте и переключайте пресеты под разное настроение
- Импортируйте и экспортируйте настройки в JSON
- Переносите все пресеты при импорте/экспорте одним переключателем
- Восстанавливайте встроенные шаблоны пресетов в один клик
- Пользуйтесь расширением на английском и русском языках

Идеально для праздничной атмосферы, оформления стримов, демо и просто красивого повседневного браузинга.

Изменения в версии 3.0.0 (с 2.0.5):
- Добавлен дополнительный 3D-режим с пользовательскими глифами, цветами, перспективой, толщиной и столкновениями
- Добавлено свечение по форме снежинок с пульсацией в WebGPU, Canvas 2D и 3D
- Улучшены стабильность рендереров, обработка глифов и физика снегопада

Конфиденциальность
Let it snow не собирает, не продает и не передает персональные данные.
Расширение работает локально в браузере и сохраняет только ваши визуальные настройки (например: количество снежинок, символы, цвета, пресеты, ширину popup) в хранилище браузера (chrome.storage).
Аккаунт, регистрация, аналитика и трекинг не требуются.
Если вы вручную добавляете URL GIF, эти файлы запрашиваются напрямую с указанного источника в вашем браузере для отображения анимации.

## Installation & Setup

### Prerequisites
- Node.js 22.22.2+, 24.15.0+, or 26+
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
✅ Renderer glow comparison with a configurable shared minimum strength
✅ 3D renderer preview in the snow playground

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

### Load an unpacked extension

1. Run `pnpm run build` to generate browser-specific builds in `dist/`.
2. In Chrome, open `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, and select `dist/chrome`.
3. In Edge, open `edge://extensions/`, enable **Developer mode**, click **Load unpacked**, and select `dist/edge`.
4. In Firefox, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `dist/firefox/manifest.json`. Temporary add-ons are removed when Firefox closes.

Packaged release files are written to `builds/`.

## Architecture Diagram

Architecture materials in `diagrams/` are updated for version **3.0.0**.

Project Architecture:
- **Web Pages** — web pages where the extension works
- **Content Script** — main extension script with the snowfall engine
- **Renderers** — WebGPU, Canvas 2D fallback, and optional Three.js WebGL2 3D mode
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
│   ├── three-d-renderer.js   # Optional Three.js WebGL2 renderer
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
- **Optional 3D snow mode**: Lit, instanced user-selected glyphs with palette colors, adjustable extrusion thickness, perspective depth, tumbling, wind, pointer interaction, and 3D sphere collisions. GIFs remain 2D overlays and do not collide with 3D snow. The default automatic WebGPU/Canvas mode remains unchanged; browsers without WebGL2 fall back to Canvas 2D.
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
- Firefox (Manifest V3)
- Automatic WebGPU rendering with Canvas 2D fallback when WebGPU is unavailable
- Optional WebGL2 3D mode; falls back to Canvas 2D if WebGL2 is unavailable

## License

See LICENSE file for details
