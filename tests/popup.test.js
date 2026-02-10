import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const popupHtml = fs.readFileSync(path.join(__dirname, '../src/popup/popup.html'), 'utf-8');

function createChromeMock(overrides = {}) {
  const stored = {
    snowmax: 80,
    sinkspeed: 0.4,
    snowminsize: 15,
    snowmaxsize: 40,
    colors: ['#ffffff'],
    symbols: ['❄'],
    ...overrides
  };

  const syncSet = vi.fn(async (data) => {
    Object.assign(stored, data);
  });

  const syncGet = vi.fn(async (keys) => {
    const result = {};
    keys.forEach((k) => {
      if (stored[k] !== undefined) result[k] = stored[k];
    });
    return result;
  });

  return {
    i18n: { getMessage: vi.fn((key) => key) },
    storage: { sync: { get: syncGet, set: syncSet } },
    tabs: {
      query: vi.fn(async () => [{ id: 1, url: 'https://example.com' }]),
      sendMessage: vi.fn(async () => {})
    },
    scripting: {
      executeScript: vi.fn(async () => {})
    },
    runtime: {
      getManifest: vi.fn(() => ({ version: '1.0.0' }))
    }
  };
}

describe('popup UI', () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.innerHTML = popupHtml;
    vi.stubGlobal('alert', vi.fn());
    // Удаляем старый chrome объект перед каждым тестом
    delete global.chrome;
  });

  afterEach(() => {
    document.documentElement.innerHTML = '';
    vi.unstubAllGlobals();
    delete global.chrome;
  });

  it('prefills saved settings and sends config on start', async () => {
    // Устанавливаем мок до импорта модуля
    global.chrome = createChromeMock({
      snowmax: 120,
      sinkspeed: 1.1,
      snowminsize: 12,
      snowmaxsize: 30,
      colors: ['#111111', '#222222'],
      symbols: ['❄', '*']
    });

    // Динамически импортируем модуль после установки мока
    await import('../src/popup/popup.js?t=' + Date.now());
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.getElementById('snowmax').value).toBe('120');
    expect(document.getElementById('sinkspeedValue').textContent).toBe('1.1');
    expect(global.chrome.storage.sync.get).toHaveBeenCalled();

    document.getElementById('startSnow').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(global.chrome.tabs.sendMessage).toHaveBeenCalled();

    expect(global.chrome.tabs.query).toHaveBeenCalledTimes(1);
    expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
      action: 'startSnow',
      config: {
        snowmax: 120,
        sinkspeed: 1.1,
        snowminsize: 12,
        snowmaxsize: 30,
        snowcolor: ['#111111', '#222222'],
        snowletters: ['❄', '*'],
        snowsentences: [],
        gifUrls: [],
        gifCount: 0
      }
    });
  });

  it('saves settings when sliders change', async () => {
    // Устанавливаем мок до импорта модуля
    global.chrome = createChromeMock();

    // Динамически импортируем модуль после установки мока
    await import('../src/popup/popup.js?t=' + Date.now());
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(global.chrome.storage.sync.get).toHaveBeenCalled();

    const snowmaxInput = document.getElementById('snowmax');
    snowmaxInput.value = '200';
    snowmaxInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(global.chrome.storage.sync.set).toHaveBeenCalled();
    const lastCall = global.chrome.storage.sync.set.mock.calls.at(-1)[0];
    expect(lastCall.snowmax).toBe(200);
  });
});
