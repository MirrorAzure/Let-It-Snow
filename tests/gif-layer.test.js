import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GifLayer } from '../src/content/gif-layer.js';

describe('GifLayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
    expect(gifLayer.mouseBurstTimer).toBe(0.2);
    expect(gifLayer.mouseX).toBe(500);
    expect(gifLayer.mouseY).toBe(300);

    // Right click (button 2) - suction
    gifLayer.onMouseDown(600, 400, 2);
    expect(gifLayer.mouseBurstMode).toBe('suction');
    expect(gifLayer.mouseBurstTimer).toBe(0.2);

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

    gifLayer.animate(performance.now() + 16);

    // Wind should have affected velocities
    expect(Math.abs(flake.velocityX)).toBeGreaterThan(0);

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
    flake.x = -flake.size - 5;
    gifLayer.animate(performance.now() + 16);
    expect(flake.x).toBe(width + flake.size);

    // Test wrap from right to left
    flake.x = width + flake.size + 5;
    gifLayer.animate(performance.now() + 16);
    expect(flake.x).toBe(-flake.size);

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
    flake.y = window.innerHeight + flake.size + 10;
    flake.velocityX = 50;
    flake.velocityY = 30;
    flake.rotation = 3.14;
    flake.rotationSpeed = 0.5;

    gifLayer.animate(performance.now() + 16);

    expect(flake.y).toBe(-flake.size);
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

    gifLayer.animate(performance.now() + 16);

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

    gifLayer.animate(performance.now() + 16);

    // Rotation speed should be affected by mouse movement
    // (cross product of position vector and velocity vector)
    expect(flake.rotationSpeed).not.toBe(0);

    gifLayer.stop();
  });
});
