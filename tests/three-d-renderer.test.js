import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  ThreeDSnowRenderer,
  createGlyphGeometry,
  getGlyphScreenTransform,
  resolveGlyphAppearance
} from '../src/content/three-d-renderer.js';

describe('ThreeDSnowRenderer', () => {
  it('projects the glyph mask around its center using its 3D rotation', () => {
    const flake = {
      x: 100,
      y: 80,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0
    };

    expect(getGlyphScreenTransform(flake, 20, 2)).toEqual({
      a: 40,
      b: -0,
      c: 0,
      d: 20,
      e: 80,
      f: 70
    });

    const rotated = getGlyphScreenTransform({ ...flake, rotationZ: Math.PI / 2 }, 20, 2);
    expect(rotated.a).toBeCloseTo(0);
    expect(rotated.b).toBeCloseTo(-40);
    expect(rotated.c).toBeCloseTo(20);
    expect(rotated.d).toBeCloseTo(0);

    const tiltedFlake = {
      ...flake,
      rotationX: 0.73,
      rotationY: -1.12,
      rotationZ: 0.38
    };
    const tilted = getGlyphScreenTransform(tiltedFlake, 20, 2);
    const rotation = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(tiltedFlake.rotationX, tiltedFlake.rotationY, tiltedFlake.rotationZ)
    ).elements;
    expect(tilted.a).toBeCloseTo(20 * 2 * rotation[0]);
    expect(tilted.b).toBeCloseTo(-20 * 2 * rotation[1]);
    expect(tilted.c).toBeCloseTo(-20 * rotation[4]);
    expect(tilted.d).toBeCloseTo(20 * rotation[5]);
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
