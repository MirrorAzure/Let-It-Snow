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
});
