# Changelog

**English** | [Русский](./CHANGELOG_RU.md)

## [3.1.1] - 2026-11-05

### Added
- Quality-first adaptive rendering across Canvas 2D, WebGPU and 3D, targeting the observed display cadence with gradual resolution/3D-detail reduction and automatic restoration, without FPS-based particle-count reduction.
- Moving the mouse over accumulated flakes knocks them loose in all three renderers, including fast sweeps and the existing left/right click effects; an idle pointer leaves the row intact.
- DOM-aware emoji accumulation in Canvas 2D, WebGPU, and 3D: supported non-overlapping rows above suitable visible surfaces, with text/control checks and shared density limits. Settled flakes stay indefinitely: only sufficient impact speed/acceleration/relative size knocks one off; weak impacts settle nearby or in the second row. Sustained strong wind can overcome adhesion; page/nested scrolling sheds the pile immediately.
- API `burst` coordinates (`x`, `y`, viewport CSS pixels) and emoji mode for radial emission of selected symbols.
- API `status`, `pause`, `resume`, `update` (live speed, mouse radius, wind, accumulation), and `clearAccumulation`. Explicit pause survives tab visibility changes.

### Changed
- Trapped particles ineligible for accumulation now shed instead of hovering between supports. Pile contacts above the viewport release immediately, and layout shifts shed clipped upper rows.
- Fixed flakes hovering in wide gaps between settled neighbours: each movement segment rechecks earlier supports after another collision redirects the flake.
- Flakes resting between two settled neighbours recognize the entire support pocket despite alternating contacts, with both supports retained for stability checks and release propagation.
- Ordinary starts, autostarts and popup previews always create snowfall above the viewport instead of restoring old elapsed-time positions. Respawns and 3D horizontal portals reset swept-contact history so an offscreen jump cannot teleport a particle into a pile. Coordinate-based API bursts are unchanged.
- Fixed persistent airborne pile contacts: rest detection now samples final collision-resolved positions with a bounded jitter region and a subpixel contact tolerance. Shed flakes no longer collide with piles, and blocked unsafe/density-limited landings release instead of hovering.
- Supported flakes unable to fall or roll now join the pile after stable contact even on higher rows or shallow slopes, rather than hovering as airborne particles. Text protection, viewport bounds and the 32-particle density limit remain enforced.
- Fixed collision teleports to stale horizontal coordinates after pile contact in WebGPU. Landing preserves orientation and angled contact height; weak top contacts no longer bounce or receive repeated sideways kicks. Remaining movement checks neighbouring supports, with matching circular spacing for stable second-row contacts.
- Flakes stalled against the lower row settle as second-row particles after 0.3 seconds of stable contact without snapping; rolling or interrupted contacts do not freeze. Angled contacts preserve their actual height and support.
- Settled upper rows remain motionless: sway/spin are disabled until release, Canvas quality changes leave them untouched, and fractional-size contact tolerances prevent repeated detach/reattach jitter.
- Accumulation no longer snaps particles to free slots: weak impacts roll/bounce physically, swept pile contacts include side impacts, and settling runs before airborne collisions. API descent control no longer overwrites resolved collision positions.
- `burst` and `glyphs` emit once and remain until every particle falls past the bottom; `durationMs` is accepted for compatibility but no longer cuts these effects short. GIF effects retain their timers.
- A fifth simultaneous effect returns `effect_limit_reached` instead of deleting a visible layer. Explicit `stop`/`clearEffects` still remove effects immediately.

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
