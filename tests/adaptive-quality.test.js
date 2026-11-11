import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { AdaptiveQuality } from '../src/content/utils/adaptive-quality.js';
import { Fallback2DRenderer } from '../src/content/fallback-2d-renderer.js';
import { WebGPURenderer } from '../src/content/webgpu-renderer.js';
import { ThreeDSnowRenderer, createGlyphDetailGeometry } from '../src/content/three-d-renderer.js';
import { ThreeDGlowPass } from '../src/content/graphics/three-d-glow-pass.js';

function run(quality, fps, seconds) {
  for (let frame = 0; frame < Math.ceil(fps * seconds); frame++) quality.update(1 / fps);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('quality-first adaptation', () => {
  it.each([60, 120, 144, 165, 240])('keeps full quality and learns a %s Hz cadence', (hz) => {
    const quality = new AdaptiveQuality();
    run(quality, hz, 3);
    expect(quality.targetFps).toBeCloseTo(hz);
    expect(quality.level).toBe(0);
    expect(quality.resolutionScale).toBe(1);
  });

  it('does not mistake slow startup for a low-refresh display', () => {
    const quality = new AdaptiveQuality();
    run(quality, 30, 2);
    expect(quality.targetFps).toBe(60);
    expect(quality.level).toBe(0);
    run(quality, 30, 2);
    expect(quality.level).toBe(1);
    expect(quality.resolutionScale).toBe(0.85);
  });

  it('still adapts during sustained severe overload rather than treating every frame as a pause', () => {
    const quality = new AdaptiveQuality();
    run(quality, 4, 10);
    expect(quality.level).toBe(3);
  });

  it.each([60, 120, 144, 240])('reduces stepwise under sustained load on a %s Hz display', (hz) => {
    const quality = new AdaptiveQuality();
    run(quality, hz, 2);
    run(quality, hz / 2, 1);
    expect(quality.level).toBe(0);
    run(quality, hz / 2, 2);
    expect(quality.level).toBe(1);
    run(quality, hz / 2, 2.1);
    expect(quality.level).toBe(2);
    run(quality, hz / 2, 10);
    expect(quality.level).toBe(3);
    expect(quality.resolutionScale).toBe(0.55);
    expect(quality.targetFps).toBeCloseTo(hz);
  });

  it('restores full quality slowly instead of oscillating near the threshold', () => {
    const quality = new AdaptiveQuality();
    run(quality, 120, 2);
    run(quality, 40, 10);
    expect(quality.level).toBe(3);
    run(quality, 120, 7);
    expect(quality.level).toBe(3);
    run(quality, 120, 3);
    expect(quality.level).toBe(2);
    run(quality, 120, 17);
    expect(quality.level).toBe(0);
    for (let frame = 0; frame < 1200; frame++) quality.update(frame % 2 ? 1 / 110 : 1 / 120);
    expect(quality.level).toBe(0);
  });

  it('ignores hidden tabs, long pauses, duplicate timestamps, and isolated short frames', () => {
    const quality = new AdaptiveQuality();
    for (let frame = 0; frame < 180; frame++) {
      quality.update(frame % 60 === 0 ? 1 / 500 : 1 / 60);
    }
    expect(quality.targetFps).toBe(60);
    for (const delta of [0, -1, NaN, Infinity, 1, 10]) {
      expect(quality.update(delta)).toBe(false);
    }
    for (let frame = 0; frame < 120; frame++) quality.update(0.1, true);
    run(quality, 60, 3);
    expect(quality.level).toBe(0);
  });

  it('resets sampling after resume without discarding the current quality', () => {
    const quality = new AdaptiveQuality();
    run(quality, 144, 2);
    run(quality, 40, 4);
    const level = quality.level;
    quality.resetTiming();
    expect(quality.level).toBe(level);
    expect(quality.targetFps).toBeCloseTo(144);
    run(quality, 144, 1);
    expect(quality.level).toBe(level);
  });
});

describe('renderer quality integration', () => {
  const mockAnimation = () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  };

  it.each([1, 2])('scales Canvas detail at DPR %s without changing CSS size, motion or count', (dpr) => {
    mockAnimation();
    vi.stubGlobal('devicePixelRatio', dpr);
    expect(window.devicePixelRatio).toBe(dpr);
    const canvas = document.createElement('canvas');
    const renderer = new Fallback2DRenderer(canvas, { snowmax: 12, enableCollisions: false });
    renderer.ctx = {
      clearRect: vi.fn(), resetTransform: vi.fn(), setTransform: vi.fn(), fillText: vi.fn()
    };
    const flake = {
      x: 120, baseX: 120, y: 120, size: 20, char: '*', color: '#ffffff',
      velocityX: 0, velocityY: 0, fallSpeed: 0, phase: 0, freq: 0,
      cumulativeSpin: 0, rotationSpeed: 0, glyphDrawX: 0, glyphDrawY: 0
    };
    renderer.flakes = [flake];
    renderer.start();
    let timestamp = performance.now();
    const draw = (fps, seconds) => {
      for (let i = 0; i < fps * seconds; i++) {
        timestamp += 1000 / fps;
        renderer.drawCallback(timestamp);
      }
    };
    draw(120, 2);
    const originalWidth = canvas.width;
    expect(renderer.canvas2dMaxDpr).toBe(2);
    draw(40, 4);
    expect(renderer.adaptiveQuality.level).toBeGreaterThan(0);
    const ratio = Math.min(window.devicePixelRatio || 1, renderer.canvas2dMaxDpr)
      * renderer.adaptiveQuality.resolutionScale;
    expect(canvas.width).toBeLessThan(originalWidth);
    expect(renderer.ctx.setTransform).toHaveBeenLastCalledWith(ratio, 0, -0, ratio, 120 * ratio, 120 * ratio);
    expect(flake.size).toBe(20);
    expect(flake.x).toBe(120);
    expect(flake.y).toBe(120);
    expect(renderer.flakes).toEqual([flake]);
    expect(flake.isAwaitingRespawn).not.toBe(true);
    draw(120, 30);
    expect(canvas.width).toBe(originalWidth);
    renderer.stop();
  });

  it('reconfigures WebGPU resolution without resizing flakes or rebuilding atlases', () => {
    mockAnimation();
    const canvas = document.createElement('canvas');
    const renderer = new WebGPURenderer(canvas, {});
    renderer._getViewportSize = () => ({ width: 800, height: 600 });
    renderer._rescaleFlakeSizes = vi.fn();
    renderer.updateSimulation = vi.fn();
    renderer.render = vi.fn();
    renderer.uniformBufferManager = { setCanvasSize: vi.fn() };
    const atlas = {};
    renderer.atlasManager = atlas;
    renderer.instances = [{ size: 20, x: 100, y: 120, isSettled: true }];
    renderer._resizeCanvas();
    renderer._rescaleFlakeSizes.mockClear();
    renderer.lastTimestamp = 0;
    let timestamp = 0;
    const draw = (fps, seconds) => {
      for (let i = 0; i < fps * seconds; i++) {
        timestamp += 1000 / fps;
        renderer.frame(timestamp);
      }
    };
    draw(144, 2);
    draw(60, 4);
    expect(renderer.adaptiveQuality.level).toBeGreaterThan(0);
    expect(canvas.width).toBe(Math.floor(800 * (window.devicePixelRatio || 1)
      * renderer.adaptiveQuality.resolutionScale));
    expect(renderer._rescaleFlakeSizes).not.toHaveBeenCalled();
    expect(renderer.atlasManager).toBe(atlas);
    expect(renderer.instances).toEqual([{ size: 20, x: 100, y: 120, isSettled: true }]);
    draw(144, 30);
    expect(canvas.width).toBe(800 * (window.devicePixelRatio || 1));
    renderer.pause();
  });

  it('switches 3D geometry and glow together, restores originals, and releases every LOD', () => {
    mockAnimation();
    const snow = new ThreeDSnowRenderer(document.createElement('canvas'));
    const width = 32;
    const shape = {
      width, height: width, unit: 24,
      mask: Uint8Array.from({ length: width * width }, (_, index) =>
        index % width % 4 === 0 || Math.floor(index / width) % 4 === 0 ? 1 : 0)
    };
    const original = createGlyphDetailGeometry(shape, 0.07);
    const mesh = new THREE.InstancedMesh(original, new THREE.MeshBasicMaterial(), 1);
    const flake = { glowRgb: [1, 1, 1], isSettled: true, x: 120, y: 100, size: 20 };
    snow.flakes = [flake];
    snow.renderer = { setPixelRatio: vi.fn(), dispose: vi.fn() };
    snow.resize = vi.fn();
    snow.glowPass = new ThreeDGlowPass(snow.renderer);
    const glow = snow.glowPass.addGlyphMesh(mesh, [flake]);
    const group = { mesh, glow, shape, flakes: [flake], geometries: new Map([[1, original]]) };
    snow.glyphMeshes.set('*', group);
    for (let i = 0; i < 288; i++) snow._adaptQuality(1 / 144);
    for (let i = 0; i < 400; i++) snow._adaptQuality(1 / 40);
    expect(snow.adaptiveQuality.level).toBe(3);
    expect(mesh.geometry.getAttribute('position').count).toBeLessThan(original.getAttribute('position').count);
    expect(glow.mesh.geometry).toBe(mesh.geometry);
    expect(mesh.geometry.getAttribute('glowPulse')).toBe(glow.pulse);
    expect(glow.mesh.instanceMatrix).toBe(mesh.instanceMatrix);
    for (let i = 0; i < 144 * 30; i++) snow._adaptQuality(1 / 144);
    expect(mesh.geometry).toBe(original);
    expect(glow.mesh.geometry).toBe(original);
    expect(snow.renderer.setPixelRatio).toHaveBeenLastCalledWith(Math.min(window.devicePixelRatio || 1, 1.5));
    expect(snow.flakes).toEqual([flake]);
    const disposals = [...new Set(group.geometries.values())].map((geometry) => vi.spyOn(geometry, 'dispose'));
    snow.cleanup();
    disposals.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1));
    mesh.material.dispose();
  });

  it('preserves thin 3D branches and projected bounds at reduced detail', () => {
    const mask = new Uint8Array(32 * 32);
    for (let i = 0; i < 32; i++) {
      mask[16 * 32 + i] = 1;
      mask[i * 32 + 16] = 1;
    }
    const shape = { mask, width: 32, height: 32, unit: 24 };
    const original = createGlyphDetailGeometry(shape, 0.07);
    original.computeBoundingBox();
    for (const step of [2, 3]) {
      const detail = createGlyphDetailGeometry(shape, 0.07, step);
      detail.computeBoundingBox();
      expect(detail.getAttribute('position').count).toBeGreaterThan(0);
      for (const axis of ['x', 'y', 'z']) {
        expect(detail.boundingBox.min[axis]).toBeCloseTo(original.boundingBox.min[axis]);
        expect(detail.boundingBox.max[axis]).toBeCloseTo(original.boundingBox.max[axis]);
      }
      detail.dispose();
    }
    expect(() => createGlyphDetailGeometry(shape, 0.07, 0)).toThrow(RangeError);
    original.dispose();
  });
});
