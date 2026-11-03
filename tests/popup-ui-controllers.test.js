import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  detectSymbolMode,
  showToast,
  createSymbolItem
} from '../src/popup/ui-controllers.js';
import { isCellMonotone } from '../src/content/utils/glyph-utils.js';

describe('detectSymbolMode', () => {
  it('treats pictographic emoji as emoji', () => {
    expect(detectSymbolMode('🦖')).toBe('emoji');
    expect(detectSymbolMode('🌄')).toBe('emoji');
    expect(detectSymbolMode('❄️')).toBe('emoji');
    expect(detectSymbolMode('👍🏽')).toBe('emoji');
    expect(detectSymbolMode('🇷🇺')).toBe('emoji');
  });

  it('keeps plain text glyphs as text', () => {
    expect(detectSymbolMode('❄')).toBe('text');
    expect(detectSymbolMode('*')).toBe('text');
    expect(detectSymbolMode('✦')).toBe('text');
    expect(detectSymbolMode('❄︎')).toBe('text');
    expect(detectSymbolMode('')).toBe('text');
  });
});

describe('showToast', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('renders an accessible, text-only toast and caps the stack', () => {
    for (let i = 0; i < 5; i += 1) {
      showToast(`<img src=x onerror=alert(1)> ${i}`, 'error');
    }
    const region = document.getElementById('toastRegion');
    expect(region.getAttribute('role')).toBe('status');
    const toasts = region.querySelectorAll('.toast');
    expect(toasts.length).toBeLessThanOrEqual(3);
    expect(region.querySelector('img')).toBeNull();
    expect(toasts[toasts.length - 1].textContent).toContain('<img');
  });
});

describe('createSymbolItem', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', { i18n: { getMessage: () => '' } });
    document.body.innerHTML = '<div id="list"></div>';
  });

  it('auto-detects emoji mode while typing until the user picks a mode', () => {
    const list = document.getElementById('list');
    const onChange = vi.fn();
    const item = createSymbolItem('❄', list, onChange, 'text');
    const input = item.querySelector('input[type="text"]');

    input.value = '🦖';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(item.dataset.symbolMode).toBe('emoji');

    item.querySelector('.symbol-mode-btn').click();
    expect(item.dataset.symbolMode).toBe('text');

    input.value = '🌄';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(item.dataset.symbolMode).toBe('text');
  });

  it('removes an emptied row only on blur and never removes the last row', () => {
    const list = document.getElementById('list');
    const onChange = vi.fn();
    createSymbolItem('❄', list, onChange, 'text');
    const second = createSymbolItem('✦', list, onChange, 'text');
    const input = second.querySelector('input[type="text"]');

    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(list.children.length).toBe(2);

    input.dispatchEvent(new Event('blur'));
    expect(list.children.length).toBe(1);

    const last = list.firstElementChild.querySelector('input[type="text"]');
    last.value = '';
    last.dispatchEvent(new Event('input', { bubbles: true }));
    last.dispatchEvent(new Event('blur'));
    expect(list.children.length).toBe(1);
    expect(last.value).toBe('❄');
  });
});

describe('isCellMonotone (shared WebGPU/3D color detection)', () => {
  const makeCell = (pixels) => {
    const data = new Uint8ClampedArray(pixels.length * 4);
    pixels.forEach(([r, g, b, a], i) => data.set([r, g, b, a], i * 4));
    return data;
  };

  it('flags a single-colour glyph as monotone (tinted with snow colours)', () => {
    const data = makeCell([[255, 255, 255, 255], [254, 255, 255, 120], [0, 0, 0, 0], [255, 255, 255, 30]]);
    expect(isCellMonotone(data, 4, 0, 0, 4, 1)).toBe(true);
  });

  it('flags a multicolour emoji as colourful (keeps its own colours)', () => {
    const data = makeCell([[76, 175, 80, 255], [56, 142, 60, 255], [255, 255, 255, 255], [0, 0, 0, 255]]);
    expect(isCellMonotone(data, 4, 0, 0, 4, 1)).toBe(false);
  });
});
