# Changelog

**English** | [Русский](./CHANGELOG_RU.md)

## [3.1.0] - 2026-11-03

### Added
- Secure external API for runtime control: `burst`, `wind`, `glyphs`, `gif`, `start`, `stop`, `clearEffects` (see [docs/EXTERNAL_API.md](./docs/EXTERNAL_API.md)).
- Temporary effect layers (up to 4) on top of the main snowfall with fade-out and automatic wind restore.
- Local relay (`pnpm relay`): zero-dependency HTTP + WebSocket server bound to loopback with token authentication.
- Synchronization of all tabs/windows and of several browsers through the relay.
- OBS Browser Source overlay (`pnpm build:obs`, served at `/obs/` by the relay) with transparent background and query-string configuration.
- Opt-in page API via `window.postMessage`, restricted to an explicit origin allowlist.
- New popup "API" tab with quick actions, sync, relay, page API, and OBS URL settings (English and Russian).
- Standalone relay without Node.js/pnpm (`pnpm build:relay`): a single executable for Windows, macOS and Linux with the OBS overlay embedded and a persistent per-user token file; built by CI and attached to releases.
- OBS script `let-it-snow-relay.lua`: starts/stops the relay with OBS and adds or updates the overlay Browser Source.
- Relay CLI: `--token-file`, `--pid-file`, `--parent-pid` (auto-exit with OBS), `--version`.
- Chrome Web Store materials (`pnpm store:assets`, also run by local `pnpm build`, skipped in CI): `store-assets/` with English and Russian screenshots of the real snowfall and popup, promo tiles, and listing texts with the current version.

### Improved
- 3D glow now uses the actual rotating 3D silhouette with a soft screen-space blur and gentle pulsing; it whitens on light pages instead of producing dark halos.
- 3D glow twinkles per flake and eases smoothly when the page background changes; background detection now also polls (≈1 s) and reacts to CSS transitions, catching stylesheet/theme swaps in all modes.
- 3D emoji keep their original colors (textured extrusion, like WebGPU) instead of being tinted by the palette. Color is detected from the rendered pixels, so multicolor glyphs such as 🦖 keep their colors even in text mode.
- Popup: new symbols get text/emoji mode automatically (🌄, 🦖 → emoji); existing presets are migrated once. Compact header, sticky Start/Stop footer, non-truncated sub-tab labels, toast notifications instead of `alert`/`confirm` (which Firefox popups block), two-step preset deletion, feedback for preset actions, the 3D thickness slider shown only in 3D mode, GIF rows that no longer overflow, and safer DOM construction for list items.
- Presets apply instantly: choosing a preset updates the popup and a snowfall that is already running (no "Apply" button). Edits are no longer written into the preset silently — an "Unsaved changes" bar with a "Save" button appears, the draft survives reopening the popup, and switching presets, importing or restoring templates with unsaved edits asks whether to save them as a new preset, write them into the previous preset, discard them or cancel.
- 3D glyph size now follows the configured size in font units, matching Canvas 2D/WebGPU; sentences are wrapped like in 2D.
- Snowfall enters from the top on explicit start in every mode (3D included); only auto-start on navigation resumes earlier progress. API effects with `entry: instant` now fall in from the top as one dense wave instead of filling the screen at once.
- GIF flakes in 3D mode tumble as thick slabs (stacked layers that follow the 3D thickness setting) with a twinkling glow that takes its colors from the GIF edges and fades on light backgrounds. The tilt is limited so the slab never turns exactly edge-on: the thickness stays visible and edges stay crisp without flickering or blocky pixels.
- GIF flakes get the same edge-colored twinkling glow in WebGPU and Canvas 2D modes.
- 3D performance: merged glyph faces/walls (far fewer triangles), allocation-free per-frame updates, numeric collision grid, cached glyph masks, glow pass skipped when invisible, and automatic pixel-ratio reduction on slow devices.
- Background-aware glow now accounts for translucent page backgrounds in all rendering modes.
- Start commands preserve the selected text/emoji glyph modes through relay and content-script validation.
- Popup: new **Help** tab with a guide to every feature and integration (sync, relay, OBS, HTTP and page API, troubleshooting); top-level and sub-tab menu items now have equal size and aligned icons/labels.
- Documentation is available in English and Russian (README, user guide, External API, playground, architecture, changelog).

### Security
- Strict command validation at every hop, payload size limits, and rate limits.
- Relay: constant-time token comparison, DNS-rebinding protection, origin allowlist, no CORS, strict CSP for the OBS page.
- Background GIF fetch limited to `http(s)` `image/*` responses up to 15 MB; page-originated GIFs never use the background fetch.
- Playground bridge restricted to localhost; extension messages accepted only from the extension itself.

### Compatibility
- Added the `alarms` permission (relay keep-alive).
- Firefox minimum version is now 112 (module background script).

## [3.0.0] - 2026-10-30

### Added
- Optional Three.js/WebGL2 3D snowfall with perspective, tumbling, wind, pointer interaction, and 3D collisions.
- User-selected text and emoji glyphs, palette colors, and adjustable extrusion thickness in 3D mode.
- Shape-matched glow effects and pulsing across WebGPU, Canvas 2D, and 3D renderers.
- Playground controls for 3D preview, extrusion thickness, and renderer/glow comparison.

### Improved
- Renderer, glyph, and physics handling.
- Build tooling and cross-browser packaging for Chrome, Firefox, and Edge.

### Compatibility
- The automatic WebGPU/Canvas 2D rendering path remains the default.
- 3D rendering requires WebGL2; unsupported environments use the Canvas 2D fallback.
- GIF flakes remain DOM overlays and do not participate in 3D collisions.
