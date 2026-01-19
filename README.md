# Let It Snow - Browser Extension

A beautiful customizable snowfall effect extension for any website.

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

**Quick way to test animations WITHOUT installing the extension:**

```bash
pnpm run playground
```

✅ Loads source code from `src/` with HMR support  
✅ Hot reload on any changes  
✅ Full WebGPU/Fallback2D functionality  
✅ All parameters configurable via UI  

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
This creates an optimized build in the `dist` folder.

### Build and pack
```bash
pnpm run build && pnpm run pack
```

Serves the `playground/` page for quickly testing the content script. Load the extension in your browser, open `http://localhost:4177`, and use the controls to start/stop snow, tweak parameters, and flip light/dark backgrounds.

### Load the extension in Chrome

1. Run `pnpm run build` to generate the dist folder
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `dist` folder from your project

## Architecture Diagram

Полная интерактивная диаграмма доступна в формате DrawIO:  
![ScheemProject](./diagrams/architecture.drawio.svg)

Архитектура проекта:
- **Web Pages** — веб-страницы, на которых работает расширение
- **Content Script** — основной скрипт расширения с движком снегопада
- **Renderers** — WebGPU (современный) и Fallback 2D (совместимость)
- **Popup UI** — интерфейс управления расширением
- **Settings Manager** — управление и сохранение параметров
- **Localization** — поддержка английского и русского языков
- **Storage** — сохранение пользовательских настроек
- **Manifest Config** — конфигурации для Chrome, Firefox и Edge

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
│   └── utils/
│       ├── background-monitor.js  # Background monitoring
│       ├── color-utils.js         # Color utilities
│       └── glyph-utils.js         # Glyph/symbol utilities
├── popup/
│   ├── popup.html        # Popup UI
│   ├── popup.js          # Popup logic
│   ├── settings.js       # Settings management
│   ├── ui-controllers.js # UI controls
│   ├── localization.js   # Localization logic
│   └── popup.css         # Popup styles
├── _locales/
│   ├── en/
│   │   └── messages.json # English translations
│   └── ru/
│       └── messages.json # Russian translations
├── manifests/
│   ├── manifest.chrome.json   # Chrome manifest
│   ├── manifest.firefox.json  # Firefox manifest
│   └── manifest.edge.json     # Edge manifest
├── icons/                     # Extension icons
└── assets/                    # Static assets
```

## Features

- **Customizable snowflakes**: Adjust count, size, and falling speed
- **Color selection**: Choose multiple colors for snowflakes
- **Symbol customization**: Use different characters as snowflakes
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

## Browser Support

- Chrome/Chromium-based browsers (Manifest V3)
- Tested on Chrome 90+

## License

See LICENSE file for details
