import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GifLayer,
  resolveGifSlabDepth,
  resolveGifSlabLayerCount,
  resolveGifGlowFlicker,
  resolveGifTilt,
  projectGifRotation
} from '../src/content/gif-layer.js';
import { createWindVortexField } from '../src/content/physics/wind-field.js';

describe('GifLayer', () => {
  const originalRandom = Math.random;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    document.body.innerHTML = '<div id="root"></div>';
    global.URL.createObjectURL = vi.fn(() => 'blob:test');
    global.URL.revokeObjectURL = vi.fn();
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(new Blob(['test'], { type: 'image/gif' }))
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    Math.random = originalRandom;
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('creates layer with correct properties', () => {
    const config = {
      snowminsize: 10,
      snowmaxsize: 30,
      sinkspeed: 0.5,
      mouseRadius: 100,
      mouseForce: 300,
      enableCollisions: true
    };
    const gifLayer = new GifLayer(config);

    expect(gifLayer.config).toEqual(config);
    expect(gifLayer.mouseRadius).toBe(100);
    expect(gifLayer.mouseForce).toBe(300);
    expect(gifLayer.enableCollisions).toBe(true);
    expect(gifLayer.collisionHandler).toBeDefined();
  });

  it('builds a GIF slab whose thickness follows snow3dThickness and dims the glow on light backgrounds', async () => {
    const gifLayer = new GifLayer({
      gifUrls: ['https://test.com/test.gif'],
      gifCount: 1,
      snowminsize: 40,
      snowmaxsize: 40,
      rendererMode: '3d',
      snow3dThickness: 0.15,
      enableCollisions: false
    });
    await gifLayer.start();
    const flake = gifLayer.flakes[0];
    const layers = [...flake.slab.querySelectorAll('img')];
    const zs = layers.map((img) => Number(img.style.transform.match(/translateZ\((-?[\d.]+)px\)/)[1]));
    const depth = resolveGifSlabDepth(flake.size, 0.15);
    expect(layers.length).toBe(resolveGifSlabLayerCount(depth));
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(depth, 1);
    expect(flake.glowWrap.style.filter).toContain('blur(');
    expect(flake.glowImg.src).toBe(layers[0].src);

    gifLayer.setMainRenderer({ is3D: true, glowStrength: 1 });
    gifLayer.animate(gifLayer.lastTimestamp + 16);
    const darkGlow = Number(flake.glowWrap.style.opacity);
    gifLayer.setMainRenderer({ is3D: true, glowStrength: 0.2 });
    gifLayer.animate(gifLayer.lastTimestamp + 16);
    expect(darkGlow).toBeGreaterThan(0);
    expect(Number(flake.glowWrap.style.opacity)).toBeLessThan(darkGlow);
    gifLayer.stop();
  });

  it('resolves slab depth and twinkle within safe bounds', () => {
    expect(resolveGifSlabDepth(100, 1)).toBeCloseTo(18);
    expect(resolveGifSlabDepth(100, 0)).toBeCloseTo(2);
    expect(resolveGifSlabLayerCount(0.5)).toBe(2);
    expect(resolveGifSlabLayerCount(50)).toBe(12);
    const flake = { twinkleSpeedA: 2, twinkleSpeedB: 5, twinklePhaseA: 0, twinklePhaseB: 0 };
    for (let t = 0; t < 5; t += 0.37) {
      const v = resolveGifGlowFlicker(t, flake);
      expect(v).toBeGreaterThanOrEqual(0.55 - 1e-9);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('tumbles GIF flakes with CSS 3D transforms in 3D renderer mode', async () => {
    const gifLayer = new GifLayer({
      gifUrls: ['https://test.com/test.gif'],
      gifCount: 2,
      snowminsize: 15,
      snowmaxsize: 25,
      rendererMode: '3d',
      enableCollisions: false
    });
    await gifLayer.start();
    gifLayer.animate(gifLayer.lastTimestamp + 16);

    const flake = gifLayer.flakes[0];
    expect(flake.el.style.transform).toContain('translate3d(');
    expect(flake.el.style.willChange).toBe('');
    const transform = flake.slab.style.transform;
    expect(transform).toContain('perspective(');
    expect(transform).toContain('rotateX(');
    expect(transform).toContain('rotateY(');
    // Glow is a flat 2D projection of the same rotation (no 3D content under the blur filter).
    expect(flake.glowImg.style.transform).toMatch(/^matrix\(/);
    expect(flake.slab.style.transformStyle).toBe('preserve-3d');
    // Slab layers must not use filters (separate low-res render surfaces at steep angles).
    [...flake.slab.querySelectorAll('img')].forEach((img) => expect(img.style.filter).toBe(''));
    gifLayer.stop();

    const flatLayer = new GifLayer({
      gifUrls: ['https://test.com/test.gif'],
      gifCount: 1,
      snowminsize: 15,
      snowmaxsize: 25,
      enableCollisions: false
    });
    await flatLayer.start();
    flatLayer.setMainRenderer({ is3D: false, glowStrength: 0.8 });
    flatLayer.animate(flatLayer.lastTimestamp + 16);
    const flat = flatLayer.flakes[0];
    expect(flat.el.style.transform).not.toContain('rotateX(');
    // Canvas 2D / WebGPU get the same edge-colored glow.
    expect(flat.glowWrap.style.filter).toContain('blur(');
    expect(flat.glowImg.src).toBe(flat.el.lastElementChild.src);
    expect(Number(flat.glowWrap.style.opacity)).toBeGreaterThan(0);
    flatLayer.stop();
  });

  it('collides WebGPU GIF flakes with instances without resolving snow pairs twice', async () => {
    const gifLayer = new GifLayer({
      gifUrls: ['https://test.com/test.gif'],
      gifCount: 1,
      snowminsize: 20,
      snowmaxsize: 20,
      enableCollisions: true
    });
    await gifLayer.start();
    const mainFlakes = [
      { x: 300, y: 300, size: 20, velocityX: 0, velocityY: 0 },
      { x: 400, y: 400, size: 20, velocityX: 0, velocityY: 0 }
    ];
    gifLayer.setMainRenderer({ is3D: false, instances: mainFlakes });
    const collisionSpy = vi.spyOn(gifLayer.collisionHandler, 'handleCollisions').mockImplementation(() => {});

    gifLayer.animate(performance.now() + 16, 1 / 60);

    const [flakes, , pairFilter] = collisionSpy.mock.calls[0];
    expect(flakes).toEqual([...gifLayer.flakes, ...mainFlakes]);
    expect(pairFilter(gifLayer.flakes[0], mainFlakes[0])).toBe(true);
    expect(pairFilter(mainFlakes[0], mainFlakes[1])).toBe(false);
    gifLayer.stop();
  });

  it('keeps 3D GIF tumble away from edge-on and projects the glow consistently', () => {
    for (let phase = 0; phase < Math.PI * 2; phase += 0.2) {
      const tilt = resolveGifTilt({ tiltX: phase, tiltY: phase * 1.7, tiltAmpX: 5, tiltAmpY: 5 });
      expect(Math.abs(Math.cos(tilt.x) * Math.cos(tilt.y))).toBeGreaterThan(0.33);
    }
    expect(projectGifRotation(0, 0, 0)).toEqual([1, 0, -0, 1]);
    const [a, b, c, d] = projectGifRotation(0, Math.PI / 3, 0);
    expect(a).toBeCloseTo(0.5);
    expect(b).toBeCloseTo(0);
    expect(c).toBeCloseTo(0);
    expect(d).toBeCloseTo(1);
    const [, , , dx] = projectGifRotation(Math.PI / 3, 0, 0);
    expect(dx).toBeCloseTo(0.5);
  });

  it('starts and creates flakes with physics properties', async () => {
    const config = {
      gifUrls: ['https://test.com/test.gif'],
      gifCount: 3,
      snowminsize: 15,
      snowmaxsize: 25,
      sinkspeed: 0.6
    };
    const gifLayer = new GifLayer(config);

    await gifLayer.start();

    expect(gifLayer.layer).not.toBeNull();
    expect(gifLayer.flakes.length).toBe(3);

    const flake = gifLayer.flakes[0];
    expect(flake).toHaveProperty('el');
    expect(flake).toHaveProperty('size');
    expect(flake).toHaveProperty('speed');
    expect(flake).toHaveProperty('x');
    expect(flake).toHaveProperty('y');
    expect(flake).toHaveProperty('velocityX');
    expect(flake).toHaveProperty('velocityY');
    expect(flake).toHaveProperty('rotationSpeed');
    expect(flake).toHaveProperty('rotation');
    expect(flake).toHaveProperty('collisionSize');

    // Verify no sway/phase properties
    expect(flake).not.toHaveProperty('sway');
    expect(flake).not.toHaveProperty('freq');
    expect(flake).not.toHaveProperty('phase');

    gifLayer.stop();
  });

  it('shows part of GIF flakes immediately on start', async () => {
    const config = {
      gifUrls: ['https://test.com/test.gif'],
      gifCount: 10,
      gifInitialVisibleRatio: 0.4,
      snowminsize: 20,
      snowmaxsize: 20,
      sinkspeed: 0.6
    };
    const gifLayer = new GifLayer(config);

    await gifLayer.start();

    const visibleNow = gifLayer.flakes.filter((flake) => flake.y >= -(flake.size * 0.5)).length;
    expect(visibleNow).toBeGreaterThanOrEqual(4);

    gifLayer.stop();
  });

  it('updates wind state', async () => {
    const gifLayer = new GifLayer({ gifUrls: ['test.gif'], gifCount: 1 });
    await gifLayer.start();

    expect(gifLayer.currentWindForce).toBe(0);
    expect(gifLayer.currentWindLift).toBe(0);

    gifLayer.updateWind(5.0, 2.5);

    expect(gifLayer.currentWindForce).toBe(5.0);
    expect(gifLayer.currentWindLift).toBe(2.5);

    gifLayer.stop();
  });

  it('updates mouse state', async () => {
    const gifLayer = new GifLayer({ gifUrls: ['test.gif'], gifCount: 1 });
    await gifLayer.start();

    expect(gifLayer.mouseX).toBe(-1000);
    expect(gifLayer.mouseY).toBe(-1000);

    gifLayer.updateMouse(500, 300, 10, 20);

    expect(gifLayer.mouseX).toBe(500);
    expect(gifLayer.mouseY).toBe(300);
    expect(gifLayer.mouseVelocityX).toBe(10);
    expect(gifLayer.mouseVelocityY).toBe(20);

    gifLayer.stop();
  });

  it('handles mouse down for explosion and suction', async () => {
    const gifLayer = new GifLayer({ gifUrls: ['test.gif'], gifCount: 1 });
    await gifLayer.start();

    // Left click (button 0) - explosion
    gifLayer.onMouseDown(500, 300, 0);
    expect(gifLayer.mouseBurstMode).toBe('explode');
    expect(gifLayer.mouseLeftPressed).toBe(true);
    expect(gifLayer.mouseBurstTimer).toBe(0);
    expect(gifLayer.mouseX).toBe(500);
    expect(gifLayer.mouseY).toBe(300);

    // Right click (button 2) - suction
    gifLayer.onMouseDown(600, 400, 2);
    expect(gifLayer.mouseBurstMode).toBe('suction');
    expect(gifLayer.mouseRightPressed).toBe(true);
    expect(gifLayer.mouseBurstTimer).toBe(0);

    gifLayer.stop();
  });

  it('handles mouse leave', async () => {
    const gifLayer = new GifLayer({ gifUrls: ['test.gif'], gifCount: 1 });
    await gifLayer.start();

    gifLayer.mouseBurstMode = 'explode';
    gifLayer.mouseBurstTimer = 0.15;

    gifLayer.onMouseLeave();

    expect(gifLayer.mouseBurstTimer).toBe(0);
    expect(gifLayer.mouseBurstMode).toBeNull();
    expect(gifLayer.mouseX).toBe(-1000);
    expect(gifLayer.mouseY).toBe(-1000);

    gifLayer.stop();
  });

  it('applies wind force to flakes', async () => {
    const gifLayer = new GifLayer({
      gifUrls: ['test.gif'],
      gifCount: 1,
      snowminsize: 20,
      snowmaxsize: 20
    });
    await gifLayer.start();

    const flake = gifLayer.flakes[0];
    flake.velocityX = 0;
    flake.velocityY = 0;

    // Set wind
    gifLayer.currentWindForce = 1.0;
    gifLayer.currentWindLift = 0.5;

    // Trigger animation
    const animateCallback = vi.fn();
    global.requestAnimationFrame = vi.fn((cb) => {
      animateCallback.mockImplementation(cb);
      return 1;
    });

    gifLayer.animate(performance.now() + 20);

    // Wind should have affected velocities
    expect(Math.abs(flake.velocityX)).toBeGreaterThan(0);

    gifLayer.stop();
  });

  it('applies vortex wind to GIF flakes', async () => {
    const gifLayer = new GifLayer({
      gifUrls: ['test.gif'],
      gifCount: 1,
      snowminsize: 20,
      snowmaxsize: 20
    });
    await gifLayer.start();

    const flake = gifLayer.flakes[0];
    const field = createWindVortexField(window.innerWidth, window.innerHeight, 0);
    flake.x = field.centers[0].x + 50;
    flake.y = field.centers[0].y;
    flake.velocityX = 0;
    flake.velocityY = 0;
    gifLayer.windTime = 0;
    gifLayer.currentWindVortex = 1;
    gifLayer.animate(performance.now() + 20);

    expect(Math.abs(flake.velocityY)).toBeGreaterThan(0);

    gifLayer.stop();
  });

  it('renders GIF positions after collision resolution', async () => {
    const gifLayer = new GifLayer({
      gifUrls: ['test.gif'],
      gifCount: 1,
      snowminsize: 20,
      snowmaxsize: 20
    });
    await gifLayer.start();

    const flake = gifLayer.flakes[0];
    flake.x = 200;
    flake.y = 200;
    gifLayer.setMainRenderer({
      flakes: [{
        x: 210,
        baseX: 210,
        y: 200,
        size: 20,
        collisionSize: 20,
        velocityX: 0,
        velocityY: 0
      }]
    });
    gifLayer.animate(performance.now() + 20);

    const transform = flake.el.style.transform.match(
      /^translate3d\(([-\d.]+)px, ([-\d.]+)px, 0px?\) rotate\(([-\d.]+)rad\)$/
    );
    expect(transform).not.toBeNull();
    expect(Number(transform[1])).toBeCloseTo(flake.x - flake.size * 0.5, 2);
    expect(Number(transform[2])).toBeCloseTo(flake.y - flake.size * 0.5, 2);
    expect(Number(transform[3])).toBeCloseTo(flake.rotation, 2);

    gifLayer.stop();
  });

  it('wraps flakes around horizontal boundaries', async () => {
    const gifLayer = new GifLayer({
      gifUrls: ['test.gif'],
      gifCount: 1,
      snowminsize: 20,
      snowmaxsize: 20
    });
    await gifLayer.start();

    const flake = gifLayer.flakes[0];
    const width = window.innerWidth;

    // Test wrap from left to right
    flake.x = -(flake.size * 0.5) - 5;
    gifLayer.animate(performance.now() + 20);
    expect(flake.x).toBe(width + flake.size * 0.5);

    // Test wrap from right to left
    flake.x = width + flake.size * 0.5 + 5;
    gifLayer.animate(performance.now() + 20);
    expect(flake.x).toBe(-flake.size * 0.5);

    gifLayer.stop();
  });

  it('resets flake when it goes off bottom', async () => {
    const gifLayer = new GifLayer({
      gifUrls: ['test.gif'],
      gifCount: 1,
      snowminsize: 20,
      snowmaxsize: 20
    });
    await gifLayer.start();

    const flake = gifLayer.flakes[0];
    flake.y = window.innerHeight + flake.size * 0.5 + 10;
    flake.velocityX = 50;
    flake.velocityY = 30;
    flake.rotation = 3.14;
    flake.rotationSpeed = 0.5;

    gifLayer.animate(performance.now() + 20);

    expect(flake.y).toBe(-flake.size * 0.5);
    expect(flake.velocityX).toBe(0);
    expect(flake.velocityY).toBe(0);
    expect(flake.rotation).toBe(0);
    expect(flake.rotationSpeed).toBe(0);

    gifLayer.stop();
  });

  it('applies damping to velocities', async () => {
    const gifLayer = new GifLayer({
      gifUrls: ['test.gif'],
      gifCount: 1
    });
    await gifLayer.start();

    const flake = gifLayer.flakes[0];
    flake.velocityX = 100;
    flake.velocityY = 100;
    flake.rotationSpeed = 1.0;

    gifLayer.animate(performance.now() + 20);

    // Velocities should be damped (reduced)
    expect(Math.abs(flake.velocityX)).toBeLessThan(100);
    expect(Math.abs(flake.velocityY)).toBeLessThan(100);
    expect(Math.abs(flake.rotationSpeed)).toBeLessThan(1.0);

    gifLayer.stop();
  });

  it('updates config dynamically', async () => {
    const gifLayer = new GifLayer({
      gifUrls: ['test.gif'],
      gifCount: 1,
      mouseRadius: 100,
      mouseForce: 300,
      enableCollisions: true
    });
    await gifLayer.start();

    expect(gifLayer.mouseRadius).toBe(100);
    expect(gifLayer.enableCollisions).toBe(true);

    gifLayer.updateConfig({
      mouseRadius: 200,
      mouseForce: 500,
      enableCollisions: false
    });

    expect(gifLayer.mouseRadius).toBe(200);
    expect(gifLayer.mouseForce).toBe(500);
    expect(gifLayer.enableCollisions).toBe(false);

    gifLayer.stop();
  });

  it('pauses and resumes animation', async () => {
    const gifLayer = new GifLayer({
      gifUrls: ['test.gif'],
      gifCount: 1
    });
    await gifLayer.start();

    expect(gifLayer.frameRequest).not.toBeNull();

    gifLayer.pause();
    expect(gifLayer.frameRequest).toBeNull();

    gifLayer.resume();
    expect(gifLayer.frameRequest).not.toBeNull();

    gifLayer.stop();
  });

  it('cleans up resources on stop', async () => {
    const gifLayer = new GifLayer({
      gifUrls: ['test.gif'],
      gifCount: 2
    });

    await gifLayer.start();

    expect(gifLayer.layer).not.toBeNull();
    expect(gifLayer.flakes.length).toBe(2);
    expect(gifLayer.frameRequest).not.toBeNull();

    gifLayer.stop();

    expect(gifLayer.layer).toBeNull();
    expect(gifLayer.flakes.length).toBe(0);
    expect(gifLayer.frameRequest).toBeNull();
    expect(global.URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('handles burst timer countdown', async () => {
    const gifLayer = new GifLayer({
      gifUrls: ['test.gif'],
      gifCount: 1
    });
    await gifLayer.start();

    gifLayer.mouseBurstMode = 'explode';
    gifLayer.mouseBurstTimer = 0.2;

    // Simulate animation frame with delta 0.1s
    const startTime = performance.now();
    gifLayer.lastTimestamp = startTime;
    gifLayer.animate(startTime + 100);

    expect(gifLayer.mouseBurstTimer).toBeCloseTo(0.1, 1);
    expect(gifLayer.mouseBurstMode).toBe('explode');

    // Another frame to deplete timer
    gifLayer.animate(startTime + 250);

    expect(gifLayer.mouseBurstTimer).toBe(0);
    expect(gifLayer.mouseBurstMode).toBeNull();

    gifLayer.stop();
  });

  it('applies rotation during mouse interaction', async () => {
    const gifLayer = new GifLayer({
      gifUrls: ['test.gif'],
      gifCount: 1,
      mouseRadius: 200,
      snowminsize: 20,
      snowmaxsize: 20
    });
    await gifLayer.start();

    const flake = gifLayer.flakes[0];
    flake.x = 500;
    flake.y = 300;
    flake.rotationSpeed = 0;

    // Mouse moving near flake
    gifLayer.mouseX = 520;
    gifLayer.mouseY = 300;
    gifLayer.mouseVelocityX = 0;
    gifLayer.mouseVelocityY = 100; // Moving down

    gifLayer.animate(performance.now() + 20);

    // Rotation speed should be affected by mouse movement
    // (cross product of position vector and velocity vector)
    expect(flake.rotationSpeed).not.toBe(0);

    gifLayer.stop();
  });
});
