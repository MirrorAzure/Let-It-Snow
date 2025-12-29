import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalRandom = Math.random;
const originalGpu = Object.getOwnPropertyDescriptor(global.navigator, 'gpu');

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

    vi.advanceTimersByTime(20);

    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).not.toBeNull();
    expect(canvas.style.pointerEvents).toBe('none');

    handler({ action: 'stopSnow' });
    const removed = document.getElementById('let-it-snow-webgpu-canvas');
    expect(removed).toBeNull();
  });
});
