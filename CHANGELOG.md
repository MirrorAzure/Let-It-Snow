# Changelog

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
- GIF flakes remain 2D overlays and do not participate in 3D collisions.
