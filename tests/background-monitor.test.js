import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackgroundMonitor, getEffectiveBackgroundColor } from '../src/content/utils/background-monitor.js';

afterEach(() => {
  document.documentElement.style.backgroundColor = '';
  document.body.style.backgroundColor = '';
});

describe('background monitoring', () => {
  it('uses the opaque body background when present', () => {
    document.documentElement.style.backgroundColor = '#ffffff';
    document.body.style.backgroundColor = '#183048';

    expect(getEffectiveBackgroundColor()).toEqual({
      r: 24 / 255, g: 48 / 255, b: 72 / 255, a: 1
    });
  });

  it('composites transparent body and root backgrounds over white', () => {
    document.documentElement.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
    document.body.style.backgroundColor = 'rgba(255, 255, 255, 0.5)';

    const color = getEffectiveBackgroundColor();
    expect(color.r).toBeCloseTo(0.9);
    expect(color.g).toBeCloseTo(0.9);
    expect(color.b).toBeCloseTo(0.9);
    expect(color.a).toBe(1);
  });

  it('recognizes a translucent dark body over a light page as a light background', () => {
    document.documentElement.style.backgroundColor = '#ffffff';
    document.body.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';

    expect(getEffectiveBackgroundColor().r).toBeCloseTo(0.95);
    expect(new BackgroundMonitor(() => {}).calculateGlowStrength(0, 1)).toBeLessThan(0.1);
  });

  it('polls for background changes that do not touch html/body attributes', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const monitor = new BackgroundMonitor(onChange, { pollIntervalMs: 500 });
    try {
      monitor.start();
      vi.advanceTimersByTime(1000);
      expect(onChange).not.toHaveBeenCalled();

      const style = document.createElement('style');
      style.textContent = 'body { background-color: rgb(10, 20, 30); }';
      document.head.appendChild(style);
      vi.advanceTimersByTime(500);
      expect(onChange).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1000);
      expect(onChange).toHaveBeenCalledTimes(1);
      style.remove();

      monitor.stop();
      document.body.style.backgroundColor = '#000000';
      vi.advanceTimersByTime(1000);
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      monitor.stop();
      vi.useRealTimers();
    }
  });
});
