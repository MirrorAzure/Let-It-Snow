# Let It Snow - Browser Extension

A beautiful customizable snowfall effect extension for any website.

Current version: **2.0.1** (March 2026)

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

Architecture materials in `diagrams/` are up to date for version **2.0.1**.
  
![ScheemProject](./diagrams/architecture.drawio.svg)

Project Architecture:
- **Web Pages** — web pages where the extension works
- **Content Script** — main extension script with the snowfall engine
- **Renderers** — WebGPU (modern) and Fallback 2D (compatibility)
- **Graphics Layer** — atlas and uniform buffer management for WebGPU
- **Physics Layer** — simulation, collisions, and mouse interactions
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
│   │   └── mouse-handler.js      # Mouse interaction
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
- **GIF support**: Add GIFs by URL or local file upload
- **Mouse interaction**: Push, swirl, and drag snow with pointer movement
- **Soft collisions**: Snowflakes gently bounce off each other
- **Wind effects**: Physically accurate wind simulation with turbulence
  - Multi-layer wind turbulence (low, medium, high frequencies)
  - Wind applies as force/acceleration (not just displacement)
  - Size-dependent wind resistance (smaller flakes affected more)
  - Vertical lift effect during strong winds
- **About tab**: Version, authors, repository, and tech stack in popup
- **Settings persistence**: All settings are automatically saved
- **Multi-language support**: English and Russian translations

[**Learn more about wind physics improvements →**](./WIND_PHYSICS_IMPROVEMENTS.md)

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
