import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Устанавливаем флаг тестирования для подавления логов
if (typeof window !== 'undefined') {
  window.__TESTING__ = true;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const popupHtml = fs.readFileSync(path.join(__dirname, '../src/popup/popup.html'), 'utf-8');

// Загружаем локализацию для тестов
const messagesJson = fs.readFileSync(path.join(__dirname, '../src/_locales/ru/messages.json'), 'utf-8');
const messages = JSON.parse(messagesJson);

// Преобразуем формат {key: {message: "text"}} в {key: "text"}
const messageStrings = {};
Object.entries(messages).forEach(([key, obj]) => {
  if (obj && obj.message) {
    messageStrings[key] = obj.message;
  }
});

function createChromeMock(overrides = {}) {
  const stored = {
    snowmax: 80,
    sinkspeed: 0.4,
    snowminsize: 15,
    snowmaxsize: 40,
    colors: ['#ffffff'],
    symbols: ['❄'],
    sentenceCount: 0,
    mouseRadius: 100,
    windEnabled: false,
    windDirection: 'left',
    windStrength: 0.5,
    windGustFrequency: 3,
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
    i18n: { getMessage: vi.fn((key) => messageStrings[key] || key) },
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
    // Устанавливаем флаг тестирования в document и global
    document.__TESTING__ = true;
    if (typeof global !== 'undefined') {
      global.__TESTING__ = true;
    }
    vi.stubGlobal('alert', vi.fn());
    // Удаляем старый chrome объект перед каждым тестом
    delete global.chrome;
  });

  afterEach(() => {
    document.documentElement.innerHTML = '';
    delete document.__TESTING__;
    if (typeof global !== 'undefined') {
      delete global.__TESTING__;
    }
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
        sentenceCount: 0,
        gifUrls: [],
        gifCount: 0,
        mouseRadius: 100,
        windEnabled: false,
        windDirection: 'left',
        windStrength: 0.5,
        windGustFrequency: 3
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
