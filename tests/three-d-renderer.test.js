import { describe, expect, it } from 'vitest';
import {
  ThreeDSnowRenderer,
  createGlyphGeometry,
  createGlyphGlowGeometry,
  resolveGlyphAppearance,
  resolveGlowPulse
} from '../src/content/three-d-renderer.js';
import rendererSource from '../src/content/three-d-renderer.js?raw';

describe('ThreeDSnowRenderer', () => {
  it('uses instance colors for glow without requiring missing vertex colors', () => {
    expect(rendererSource).not.toContain('vertexColors: true');
    expect(rendererSource).toContain('glowMesh.setColorAt(meshIndex, flake.color)');
  });

  it('uses a soft glow with a subtle inner edge and progressively fading outer layers', () => {
    const layersSource = rendererSource.match(/const GLOW_LAYERS = \[([\s\S]*?)\];/)?.[1] || '';
    const layers = Array.from(layersSource.matchAll(
      /\{ radius: ([\d.]+), opacity: ([\d.]+) \}/g
    ), ([, radius, opacity]) => ({ radius: Number(radius), opacity: Number(opacity) }));

    expect(layers.length).toBeGreaterThanOrEqual(10);
    expect(layers[0].opacity).toBeLessThanOrEqual(0.01);
    expect(layers[0].radius).toBeLessThanOrEqual(0.02);
    expect(layers.slice(6).every((layer, index) => (
      layer.radius > layers[index + 5].radius && layer.opacity < layers[index + 5].opacity
    ))).toBe(true);
  });

  it('pulses visibly instead of keeping the glow near full brightness', () => {
    expect(resolveGlowPulse(-Math.PI / 2)).toBeCloseTo(0.16);
    expect(resolveGlowPulse(Math.PI / 2)).toBeCloseTo(1);
    expect(resolveGlowPulse(0)).toBeGreaterThan(resolveGlowPulse(-Math.PI / 2));
  });

  it('creates a glow ring that expands beyond the matching glyph silhouette', () => {
    const mask = new Uint8Array([
      0, 0, 0,
      0, 1, 0,
      0, 0, 0
    ]);
    const glyph = createGlyphGeometry(mask, 3, 3);
    const glow = createGlyphGlowGeometry(mask, 3, 3, 0.07, 0, 1);
    const glyphPositions = glyph.getAttribute('position').array;
    const glowPositions = glow.getAttribute('position').array;
    const glyphX = Array.from(glyphPositions).filter((_, index) => index % 3 === 0);
    const glowX = Array.from(glowPositions).filter((_, index) => index % 3 === 0);
    const glowDepth = Array.from(glowPositions).filter((_, index) => index % 3 === 2);

    expect(Math.min(...glowX)).toBeLessThan(Math.min(...glyphX));
    expect(Math.max(...glowX)).toBeGreaterThan(Math.max(...glyphX));
    expect(Math.max(...glowDepth) - Math.min(...glowDepth)).toBeCloseTo(0.18);
    expect(glow.getAttribute('normal')).toBeDefined();
    glyph.dispose();
    glow.dispose();
  });

  it('creates an extruded glyph geometry with the configured cross-section depth', () => {
    const geometry = createGlyphGeometry(
      new Uint8Array([
        0, 1, 0,
        1, 1, 1,
        0, 1, 0
      ]),
      3,
      3,
      0.12
    );
    const positions = geometry.getAttribute('position').array;
    const depthValues = Array.from(positions).filter((_, index) => index % 3 === 2);

    expect(Math.max(...depthValues) - Math.min(...depthValues)).toBeCloseTo(0.12);
    expect(geometry.getAttribute('normal')).toBeDefined();
    geometry.dispose();
  });

  it('selects configured glyphs, modes, and palette colors per flake', () => {
    expect(resolveGlyphAppearance({
      snowletters: ['❄', '✦'],
      snowglyphmodes: ['text', 'emoji'],
      snowcolor: ['#ff0000', '#00ff00']
    }, 1)).toEqual({
      glyph: '✦',
      glyphMode: 'emoji',
      color: '#00ff00',
      isSentence: false
    });
  });

  it('keeps configured sentence flakes in the 3D glyph stream', () => {
    expect(resolveGlyphAppearance({
      snowmax: 4,
      snowletters: ['❄'],
      snowsentences: ['Happy winter'],
      sentenceCount: 1
    }, 3)).toMatchObject({
      glyph: 'Happy winter',
      isSentence: true
    });
  });

  it('projects objects at greater depth to a larger scale', () => {
    const renderer = new ThreeDSnowRenderer(null);
    renderer.viewportHeight = 1000;

    expect(renderer._worldScaleAtDepth(10)).toBeLessThan(renderer._worldScaleAtDepth(-10));
  });

  it('separates flakes with coincident centers without producing invalid positions', () => {
    const renderer = new ThreeDSnowRenderer(null);
    renderer.viewportWidth = 100;
    renderer.viewportHeight = 100;
    renderer.flakes = [
      { x: 50, y: 50, z: 0, size: 2, velocityX: 0, velocityY: 0, velocityZ: 0 },
      { x: 50, y: 50, z: 0, size: 2, velocityX: 0, velocityY: 0, velocityZ: 0 }
    ];
    const positions = [
      { x: 0, y: 0, z: 0, scale: 1 },
      { x: 0, y: 0, z: 0, scale: 1 }
    ];

    renderer._resolveCollisions(positions);

    expect(positions[0].x).toBeLessThan(positions[1].x);
    expect(renderer.flakes.every((flake) => Number.isFinite(flake.x) && Number.isFinite(flake.y))).toBe(true);
  });
});
