# Let It Snow - Browser Extension

**English** | [Русский](./README_RU.md)

A beautiful customizable snowfall effect extension for any website.

Current version: **3.1.1**

Documentation:
- Release notes: [CHANGELOG.md](./CHANGELOG.md) (Русский: [CHANGELOG_RU.md](./CHANGELOG_RU.md))
- User guide: [docs/USAGE.md](./docs/USAGE.md) (Русский: [docs/USAGE_RU.md](./docs/USAGE_RU.md))
- External API reference: [docs/EXTERNAL_API.md](./docs/EXTERNAL_API.md) (Русский: [docs/EXTERNAL_API_RU.md](./docs/EXTERNAL_API_RU.md))
- Playground: [playground/README.md](./playground/README.md) (Русский: [playground/README_RU.md](./playground/README_RU.md))
- Architecture: [diagrams/architecture.md](./diagrams/architecture.md) (Русский: [diagrams/architecture_RU.md](./diagrams/architecture_RU.md))

## Store Description (v3.1.1)

Let it snow adds a festive, customizable snowfall effect to any website.

Create your own winter look:
- Adjust snowflake count, size, and fluffiness; shape is automatic by default with manual global and per-flake overrides
- Use custom symbols, long phrases, and multiple colors
- Add animated GIF flakes from URLs or local files
- Interact with snow using mouse and touch gestures
- Enjoy automatic WebGPU rendering with a reliable Canvas 2D fallback
- Enable optional Three.js WebGL2 3D snowfall with perspective and tumbling
- Customize 3D glyphs, colors, and extrusion thickness
- See shape-matched glow effects that pulse with the snowflakes
- Trigger snow bursts, strong wind, glyph and GIF showers via a secure local API
- Sync snowfall across all windows and even between browsers
- Add snow to OBS streams with a transparent Browser Source overlay
- Save and switch presets for different moods
- Import and export settings in JSON
- Transfer all presets during import/export with one toggle
- Restore built-in preset templates in one click
- Use the extension in English and Russian

Perfect for holiday vibes, stream styling, demos, and everyday beautiful browsing.

Changes in version 3.1.1:
- Emoji accumulate on suitable visible page surfaces and shed on scroll without blocking interaction
- Coordinate bursts spawn selected emoji at a screen point; API particles fall to the bottom without timed disappearance or respawning
- Added API status, pause/resume, live settings, and accumulation controls

Changes in version 3.1.0:
- Added a secure external API (local relay over HTTP/WebSocket and an opt-in page API) for bursts, wind, glyphs, and GIF effects
- Added synchronization of all windows and between several browsers
- Added an OBS Browser Source overlay
- Reworked the 3D glow: soft and clean, with no dark halo on light pages

Changes in version 3.0.0 (from 2.0.5):
- Added optional 3D snowfall with user-selected glyphs, colors, adjustable depth, perspective, and collisions
- Added shape-matched pulsing glow effects to WebGPU, Canvas 2D, and 3D rendering
- Improved renderer stability, glyph handling, and snow physics

Privacy
Let it snow does not collect, sell, or share personal data.
The extension works locally in your browser and stores settings (for example: snowflake count, symbols, colors, presets, popup width, and optional API settings) in browser storage (chrome.storage).
No account, registration, analytics, or tracking is required.
If you manually add GIF URLs, these files are requested directly from the specified source in your browser to display animation.
The optional relay connection works only with a local server on your own computer (127.0.0.1); its access token is stored only in local browser storage.

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

**[Learn more about Playground →](./playground/README.md)** (Русский: [playground/README_RU.md](./playground/README_RU.md))

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
- Chrome Web Store materials in `store-assets/` (local builds only, skipped when `CI` is set): localized `en`/`ru` screenshots 1280×800 (24-bit PNG) of the real snowfall and popup, promo tiles 440×280 and 1400×560, and `title`/`summary`/`description` texts with the current version. Requires a local Chrome/Chromium/Edge (`CHROME_PATH` to override). Regenerate with `pnpm store:assets`; skip with `SKIP_STORE_ASSETS=1` or `pnpm build -- --no-store-assets`.

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

Architecture materials in `diagrams/` are updated for version **3.0.0**. See [diagrams/architecture.md](./diagrams/architecture.md) (Русский: [diagrams/architecture_RU.md](./diagrams/architecture_RU.md)).

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
├── background.js          # Service worker: command dispatch, window sync, relay client
├── api/
│   └── command-protocol.js  # Shared, validated external command protocol
├── obs/
│   ├── index.html        # Transparent OBS Browser Source page
│   └── overlay.js        # OBS overlay + relay client
├── content/
│   ├── index.js          # Content script (injected into web pages)
│   ├── snow-controller.js    # Snow layer controller (main + effect layers)
│   ├── command-runtime.js    # Executes external commands via temporary effect layers
│   ├── webgpu-renderer.js    # WebGPU rendering engine
│   ├── fallback-2d-renderer.js  # 2D Canvas fallback
│   ├── three-d-renderer.js   # Optional Three.js WebGL2 renderer
│   ├── gif-layer.js      # GIF layer support
│   ├── shader.wgsl       # WebGPU shaders
│   ├── graphics/
│   │   ├── atlas-manager.js   # Glyph/sentence atlas handling
│   │   ├── three-d-glow-pass.js # 3D silhouette glow and screen-space blur
│   │   └── uniform-buffer.js  # Uniform buffer management
│   ├── physics/
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
│   ├── api-panel.js      # API / sync / relay / OBS settings tab
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

- **Customizable snowflakes**: Adjust count, size, and fluffiness; shape and fall speed are calculated automatically, with global and per-flake shape overrides
- **Color selection**: Choose multiple colors for snowflakes
- **Symbol customization**: Use different characters as snowflakes, with per-symbol text/emoji render mode toggle
- **Presets**: Save and load custom presets; built-in seasonal templates (Winter, Spring, etc.)
- **GIF support**: Add GIFs by URL or local file upload
- **Mouse interaction**: Push, swirl, and drag snow with pointer movement
- **Soft collisions**: Snowflakes gently bounce off each other
- **Optional 3D snow mode**: Lit, instanced user-selected glyphs with palette colors (emoji keep their own colors), adjustable extrusion thickness, perspective depth, tumbling, twinkling background-aware glow, wind, pointer interaction, and 3D sphere collisions. GIFs tumble with CSS 3D transforms but stay DOM overlays and do not collide with 3D snow. The default automatic WebGPU/Canvas mode remains unchanged; browsers without WebGL2 fall back to Canvas 2D.
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
- **Help tab**: built-in guide in the popup describing every feature and integration (sync, relay, OBS, HTTP/page API), in English and Russian
- **About tab**: Version, authors, repository, and tech stack in popup
- **Configurable popup width**: Adjustable popup panel width in screen percent with instant % + px preview
- **External API (3.1.0)**: Burst, wind, glyphs, GIF, start/stop commands via a token-protected local relay (HTTP + WebSocket) or an opt-in, origin-restricted page API — see [docs/EXTERNAL_API.md](./docs/EXTERNAL_API.md)
- **Multi-window & multi-browser sync**: Broadcast to all tabs/windows; connect several browsers to the same relay
- **OBS support**: Transparent Browser Source overlay served by the relay (`pnpm relay`, `http://127.0.0.1:8787/obs/#token=...`)
- **Settings persistence**: All settings are automatically saved
- **Multi-language support**: English and Russian translations

## Building with Vite

This extension uses Vite with the CRXJS plugin for building Chrome extensions. The configuration automatically:
- Bundles JavaScript modules
- Processes CSS imports
- Handles manifest versioning
- Optimizes assets for production

## External API, Sync & OBS

```bash
pnpm build            # builds extensions and dist/obs
pnpm relay            # local relay on 127.0.0.1:8787 (prints token and OBS URL)
```

Step-by-step instructions: [docs/USAGE.md](./docs/USAGE.md) (Русский: [docs/USAGE_RU.md](./docs/USAGE_RU.md)).
Full protocol, limits, and security model: [docs/EXTERNAL_API.md](./docs/EXTERNAL_API.md) (Русский: [docs/EXTERNAL_API_RU.md](./docs/EXTERNAL_API_RU.md)).

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
