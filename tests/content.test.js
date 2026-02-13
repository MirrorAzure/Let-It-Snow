import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalRandom = Math.random;
const originalGpu = Object.getOwnPropertyDescriptor(global.navigator, 'gpu');
const originalGetContext = HTMLCanvasElement.prototype.getContext;

describe('content script snow control', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    document.body.innerHTML = '<div id="root"></div>';
    global.chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      }
    };

    Object.defineProperty(global.navigator, 'gpu', {
      value: undefined,
      configurable: true
    });

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn().mockReturnValue({
        actualBoundingBoxLeft: 5,
        actualBoundingBoxRight: 25,
        actualBoundingBoxAscent: 20,
        actualBoundingBoxDescent: 5
      }),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      getImageData: vi.fn().mockReturnValue({
        data: new Uint8ClampedArray()
      })
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    Math.random = originalRandom;
    document.body.innerHTML = '';
    delete global.chrome;
    vi.resetModules();
    if (originalGpu) {
      Object.defineProperty(global.navigator, 'gpu', originalGpu);
    } else {
      delete global.navigator.gpu;
    }
    if (originalGetContext) {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    } else {
      delete HTMLCanvasElement.prototype.getContext;
    }
  });

  it('adds and removes overlay canvas on start/stop', async () => {
    const module = await import('../src/content/index.js');
    expect(module).toBeDefined();

    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    handler({ action: 'startSnow', config: {
      snowmax: 32,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#fff'],
      snowletters: ['*']
    } });

    await vi.waitFor(() => {
      const canvas = document.getElementById('let-it-snow-webgpu-canvas');
      return canvas !== null;
    });

    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).not.toBeNull();
    expect(canvas.style.pointerEvents).toBe('none');

    handler({ action: 'stopSnow' });
    const removed = document.getElementById('let-it-snow-webgpu-canvas');
    expect(removed).toBeNull();
  });

  it('creates gif layer when gifs are provided', async () => {
    const { SnowWebGPUController } = await import('../src/content/index.js');
    const controller = new SnowWebGPUController({
      snowmax: 12,
      gifUrls: ['https://example.com/a.gif', 'https://example.com/b.gif'],
      gifCount: 3
    });

    await controller.start();

    const gifLayer = document.getElementById('let-it-snow-gif-layer');
    expect(gifLayer).not.toBeNull();
    expect(gifLayer.querySelectorAll('img').length).toBeGreaterThan(0);

    controller.destroy();
    const removedLayer = document.getElementById('let-it-snow-gif-layer');
    expect(removedLayer).toBeNull();
  });

  it('handles mouse burst explosion on left click', async () => {
    const { SnowWebGPUController } = await import('../src/content/index.js');
    const controller = new SnowWebGPUController({
      snowmax: 10,
      mouseRadius: 150,
      mouseForce: 300
    });

    await controller.start();

    // Simulate left mouse button down (button 0)
    const mouseDownEvent = new MouseEvent('mousedown', {
      clientX: 500,
      clientY: 300,
      button: 0,
      bubbles: true
    });
    document.dispatchEvent(mouseDownEvent);

    expect(controller.renderer.mouseBurstMode).toBe('explode');
    expect(controller.renderer.mouseBurstTimer).toBeGreaterThan(0);

    controller.destroy();
  });

  it('handles mouse burst suction on right click', async () => {
    const { SnowWebGPUController } = await import('../src/content/index.js');
    const controller = new SnowWebGPUController({
      snowmax: 10,
      mouseRadius: 150,
      mouseForce: 300
    });

    await controller.start();

    // Simulate right mouse button down (button 2)
    const mouseDownEvent = new MouseEvent('mousedown', {
      clientX: 500,
      clientY: 300,
      button: 2,
      bubbles: true
    });
    document.dispatchEvent(mouseDownEvent);

    expect(controller.renderer.mouseBurstMode).toBe('suction');
    expect(controller.renderer.mouseBurstTimer).toBeGreaterThan(0);

    controller.destroy();
  });

  it('applies mouse radius setting', async () => {
    const { SnowWebGPUController } = await import('../src/content/index.js');
    const controller = new SnowWebGPUController({
      snowmax: 10,
      mouseRadius: 200
    });

    await controller.start();

    expect(controller.renderer.mouseRadius).toBe(200);

    controller.destroy();
  });

  it('syncs wind state from renderer to gif layer', async () => {
    const { SnowWebGPUController } = await import('../src/content/index.js');
    const controller = new SnowWebGPUController({
      snowmax: 10,
      gifUrls: ['https://example.com/test.gif'],
      gifCount: 2,
      windEnabled: true,
      windStrength: 0.5
    });

    await controller.start();

    // Check wind sync interval is created
    expect(controller.windSyncInterval).not.toBeNull();

    // Stop renderer animation to prevent wind force updates
    if (controller.renderer && controller.renderer.frameRequest) {
      cancelAnimationFrame(controller.renderer.frameRequest);
      controller.renderer.frameRequest = null;
    }

    // Simulate wind force change
    if (controller.renderer) {
      controller.renderer.currentWindForce = 5.0;
      controller.renderer.currentWindLift = 2.0;
    }

    // Wait for sync interval
    await vi.advanceTimersByTimeAsync(150);

    if (controller.gifLayer) {
      expect(controller.gifLayer.currentWindForce).toBe(5.0);
      expect(controller.gifLayer.currentWindLift).toBe(2.0);
    }

    controller.destroy();
  });

  it('gif layer applies physics and collisions', async () => {
    const { SnowWebGPUController } = await import('../src/content/index.js');
    const controller = new SnowWebGPUController({
      snowmax: 0, // No regular flakes
      gifUrls: ['https://example.com/test.gif'],
      gifCount: 5,
      enableCollisions: true
    });

    await controller.start();

    expect(controller.gifLayer).not.toBeNull();
    expect(controller.gifLayer.collisionHandler).toBeDefined();
    expect(controller.gifLayer.enableCollisions).toBe(true);
    expect(controller.gifLayer.flakes.length).toBeGreaterThan(0);

    // Verify flakes have physics properties
    const flake = controller.gifLayer.flakes[0];
    expect(flake).toHaveProperty('velocityX');
    expect(flake).toHaveProperty('velocityY');
    expect(flake).toHaveProperty('rotationSpeed');
    expect(flake).toHaveProperty('collisionSize');

    controller.destroy();
  });

  it('gif layer wraps around horizontal boundaries', async () => {
    const { SnowWebGPUController } = await import('../src/content/index.js');
    const controller = new SnowWebGPUController({
      gifUrls: ['https://example.com/test.gif'],
      gifCount: 1
    });

    await controller.start();

    const flake = controller.gifLayer.flakes[0];
    const originalX = flake.x;

    // Push flake far left
    flake.x = -flake.size - 10;
    flake.velocityX = -100;

    // Trigger animation frame
    await vi.advanceTimersByTimeAsync(50);

    // Should wrap to right side
    expect(flake.x).toBeGreaterThan(window.innerWidth);

    controller.destroy();
  });

  it('gif layer responds to mouse interactions', async () => {
    const { SnowWebGPUController } = await import('../src/content/index.js');
    const controller = new SnowWebGPUController({
      gifUrls: ['https://example.com/test.gif'],
      gifCount: 2,
      mouseRadius: 100
    });

    await controller.start();

    // Simulate mouse move
    const mouseMoveEvent = new MouseEvent('mousemove', {
      clientX: 500,
      clientY: 300,
      bubbles: true
    });
    document.dispatchEvent(mouseMoveEvent);

    expect(controller.gifLayer.mouseX).toBe(500);
    expect(controller.gifLayer.mouseY).toBe(300);

    // Simulate left click for explosion
    const mouseDownEvent = new MouseEvent('mousedown', {
      clientX: 500,
      clientY: 300,
      button: 0,
      bubbles: true
    });
    document.dispatchEvent(mouseDownEvent);

    expect(controller.gifLayer.mouseBurstMode).toBe('explode');
    expect(controller.gifLayer.mouseBurstTimer).toBeGreaterThan(0);

    controller.destroy();
  });
});
