import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalRandom = Math.random;

describe('content script snow control', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Stable randomness to avoid twinkle style injection and random letters
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    document.body.innerHTML = '<div id="root"></div>';
    global.chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      }
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    Math.random = originalRandom;
    document.body.innerHTML = '';
    delete global.chrome;
    vi.resetModules();
  });

  it('creates and removes snowflakes on messages', async () => {
    const module = await import('../src/content/index.js');
    expect(module).toBeDefined();

    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    handler({ action: 'startSnow', config: {
      snowmax: 160,
      sinkspeed: 0.5,
      snowminsize: 10,
      snowmaxsize: 20,
      snowcolor: ['#fff'],
      snowletters: ['*']
    } });

    // First group spawns immediately
    const initialFlakes = document.querySelectorAll('span[id^="snowflake-"]').length;
    expect(initialFlakes).toBeGreaterThan(0);

    // Next group after 1s
    vi.advanceTimersByTime(1000);
    const laterFlakes = document.querySelectorAll('span[id^="snowflake-"]').length;
    expect(laterFlakes).toBeGreaterThanOrEqual(initialFlakes);

    handler({ action: 'stopSnow' });
    expect(document.querySelectorAll('span[id^="snowflake-"]').length).toBe(0);
  });
});
