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
const originalCanvasGetContext = HTMLCanvasElement.prototype.getContext;

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
    snowminsize: 2.0,
    snowmaxsize: 4.0,
    colors: ['#ffffff'],
    symbols: ['❄'],
    sentenceCount: 0,
    popupWidthPercent: 20,
    popupWidth: 380,
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
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      clearRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn().mockReturnValue({
        actualBoundingBoxLeft: 5,
        actualBoundingBoxRight: 24,
        actualBoundingBoxAscent: 20,
        actualBoundingBoxDescent: 4
      }),
      textAlign: 'center',
      textBaseline: 'middle',
      font: '',
      fillStyle: '#fff'
    }));
    // Устанавливаем флаг тестирования в document и global
    document.__TESTING__ = true;
    if (typeof global !== 'undefined') {
      global.__TESTING__ = true;
    }
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('confirm', vi.fn(() => true));
    // Удаляем старый chrome объект перед каждым тестом
    delete global.chrome;
  });

  afterEach(() => {
    document.documentElement.innerHTML = '';
    if (originalCanvasGetContext) {
      HTMLCanvasElement.prototype.getContext = originalCanvasGetContext;
    } else {
      delete HTMLCanvasElement.prototype.getContext;
    }
    delete document.__TESTING__;
    if (typeof global !== 'undefined') {
      delete global.__TESTING__;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete global.chrome;
  });

  it('prefills saved settings and sends config on start', async () => {
    // Устанавливаем мок до импорта модуля
    global.chrome = createChromeMock({
      snowmax: 120,
      sinkspeed: 1.1,
      snowminsize: 2.2,
      snowmaxsize: 3.0,
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
        snowminsize: 2.2,
        snowmaxsize: 3,
        snowcolor: ['#111111', '#222222'],
        snowletters: ['❄', '*'],
        snowglyphmodes: ['text', 'text'],
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
    const payloadCall = global.chrome.storage.sync.set.mock.calls.find(
      (call) => call[0].snowmax !== undefined
    );
    expect(payloadCall).toBeDefined();
    expect(payloadCall[0].snowmax).toBe(200);
  });

  it('sends stopSnow action when stop button is clicked', async () => {
    global.chrome = createChromeMock();

    await import('../src/popup/popup.js?t=' + Date.now());
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    document.getElementById('stopSnow').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
      action: 'stopSnow'
    });
  });

  it('loads and saves mouseRadius setting', async () => {
    global.chrome = createChromeMock({ mouseRadius: 150 });

    await import('../src/popup/popup.js?t=' + Date.now());
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const mouseRadiusInput = document.getElementById('mouseRadius');
    expect(mouseRadiusInput).not.toBeNull();
    expect(mouseRadiusInput.value).toBe('150');

    // Change value
    mouseRadiusInput.value = '200';
    mouseRadiusInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(global.chrome.storage.sync.set).toHaveBeenCalled();
    const savedData = global.chrome.storage.sync.set.mock.calls.find(
      call => call[0].mouseRadius !== undefined
    );
    expect(savedData).toBeDefined();
    expect(savedData[0].mouseRadius).toBe(200);
  });

  it('loads and saves popupWidth setting', async () => {
    global.chrome = createChromeMock({ popupWidthPercent: 25, popupWidth: undefined });

    await import('../src/popup/popup.js?t=' + Date.now());
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const popupWidthInput = document.getElementById('popupWidth');
    const popupWidthValue = document.getElementById('popupWidthValue');
    const minPercent = parseFloat(popupWidthInput.min);
    const maxPercent = parseFloat(popupWidthInput.max);
    const normalizedInitialPercent = Math.max(minPercent, Math.min(maxPercent, 25));
    const initialWidthCss = document.body.style.getPropertyValue('--popup-width');
    const expectedInitialPx = parseInt(initialWidthCss, 10);
    const screenWidth = Number(window?.screen?.width) || window.innerWidth || 1920;

    expect(popupWidthInput).not.toBeNull();
    expect(popupWidthInput.value).toBe(normalizedInitialPercent.toFixed(1));
    expect(popupWidthValue.textContent).toBe(`${normalizedInitialPercent.toFixed(1)}% (~${expectedInitialPx}px)`);
    expect(initialWidthCss).toBe(`${expectedInitialPx}px`);

    popupWidthInput.value = '26.4';
    popupWidthInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(global.chrome.storage.sync.set).toHaveBeenCalled();
    const savedData = global.chrome.storage.sync.set.mock.calls.find(
      call => call[0].popupWidthPercent !== undefined
    );
    const normalizedUpdatedPercent = Math.max(minPercent, Math.min(maxPercent, 26.4));
    expect(savedData).toBeDefined();
    expect(savedData[0].popupWidthPercent).toBeCloseTo(normalizedUpdatedPercent, 5);

    const expectedUpdatedPx = Math.round(screenWidth * (normalizedUpdatedPercent / 100));
    expect(document.body.style.getPropertyValue('--popup-width')).toBe(`${expectedUpdatedPx}px`);
  });

  it('loads and saves wind settings', async () => {
    global.chrome = createChromeMock({
      windEnabled: true,
      windDirection: 'right',
      windStrength: 0.8,
      windGustFrequency: 5
    });

    await import('../src/popup/popup.js?t=' + Date.now());
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const windEnabledCheckbox = document.getElementById('windEnabled');
    const windDirectionSelect = document.getElementById('windDirection');
    const windStrengthInput = document.getElementById('windStrength');
    const windGustFrequencyInput = document.getElementById('windGustFrequency');

    expect(windEnabledCheckbox.checked).toBe(true);
    expect(windDirectionSelect.value).toBe('right');
    expect(windStrengthInput.value).toBe('0.8');
    expect(windGustFrequencyInput.value).toBe('5');

    // Change wind strength
    windStrengthInput.value = '1.0';
    windStrengthInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(global.chrome.storage.sync.set).toHaveBeenCalled();
    const savedData = global.chrome.storage.sync.set.mock.calls.find(
      call => call[0].windStrength !== undefined
    );
    expect(savedData).toBeDefined();
    expect(savedData[0].windStrength).toBe(1.0);
  });

  it('creates a new preset on import and selects it', async () => {
    global.chrome = createChromeMock();

    await import('../src/popup/popup.js?t=' + Date.now());
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const presetSelect = document.getElementById('presetSelect');
    const initialPresetCount = presetSelect.options.length;

    const importInput = document.getElementById('importSettingsInput');
    const importedFile = new File(
      [JSON.stringify({
        name: 'Импортированный пресет',
        settings: {
          snowmax: 150,
          colors: ['#123456'],
          symbols: ['*']
        }
      })],
      'imported-preset.json',
      { type: 'application/json' }
    );

    Object.defineProperty(importInput, 'files', {
      value: [importedFile],
      configurable: true
    });

    importInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(presetSelect.options).toHaveLength(initialPresetCount + 1);
    expect(presetSelect.options[presetSelect.selectedIndex].textContent).toBe('Импортированный пресет');
    expect(document.getElementById('snowmax').value).toBe('150');

    const presetsCall = global.chrome.storage.sync.set.mock.calls.find(
      (call) => Array.isArray(call[0].savedPresets)
    );
    expect(presetsCall).toBeDefined();
    expect(presetsCall[0].savedPresets.some((preset) => preset.name === 'Импортированный пресет')).toBe(true);
  });

  it('renames the selected preset', async () => {
    global.chrome = createChromeMock();

    await import('../src/popup/popup.js?t=' + Date.now());
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const presetNameInput = document.getElementById('presetNameInput');
    presetNameInput.value = 'Праздничный набор';

    document.getElementById('renamePreset').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const presetSelect = document.getElementById('presetSelect');
    expect(presetSelect.options[0].textContent).toBe('Праздничный набор');

    const presetsCall = global.chrome.storage.sync.set.mock.calls.findLast(
      (call) => Array.isArray(call[0].savedPresets)
    );
    expect(presetsCall).toBeDefined();
    expect(presetsCall[0].savedPresets[0].name).toBe('Праздничный набор');
  });

  it('exports active preset name in filename and JSON payload', async () => {
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
      writable: true
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true,
      writable: true
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    global.chrome = createChromeMock({
      savedPresets: [
        {
          id: 'preset-1',
          name: 'Holiday Magic',
          settings: {
            snowmax: 140,
            sinkspeed: 0.7,
            snowminsize: 10,
            snowmaxsize: 24,
            colors: ['#abcdef'],
            symbols: ['❄'],
            sentences: [],
            sentenceCount: 0,
            gifs: [],
            gifCount: 0,
            autoStart: false,
            mouseRadius: 100,
            windEnabled: false,
            windDirection: 'left',
            windStrength: 0.5,
            windGustFrequency: 3
          },
          updatedAt: Date.now()
        }
      ],
      activePresetId: 'preset-1'
    });

    await import('../src/popup/popup.js?t=' + Date.now());
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const appendSpy = vi.spyOn(document.body, 'appendChild');
    document.getElementById('exportSettings').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clickSpy).toHaveBeenCalled();
    const exportedLink = appendSpy.mock.calls.at(-1)[0];
    expect(exportedLink.download).toMatch(/^let-it-snow-holiday-magic-\d{4}-\d{2}-\d{2}\.json$/);

    const exportedBlob = createObjectURL.mock.calls[0][0];
    const exportedText = await exportedBlob.text();
    const exportedJson = JSON.parse(exportedText);

    expect(exportedJson.name).toBe('Holiday Magic');
    expect(exportedJson.presetName).toBe('Holiday Magic');
    expect(exportedJson.settings.snowmax).toBe(140);

    Object.defineProperty(URL, 'createObjectURL', {
      value: originalCreateObjectURL,
      configurable: true,
      writable: true
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: originalRevokeObjectURL,
      configurable: true,
      writable: true
    });
    clickSpy.mockRestore();
  });

  it('exports all presets when transfer-all checkbox is enabled', async () => {
    const createObjectURL = vi.fn(() => 'blob:test-all');
    const revokeObjectURL = vi.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
      writable: true
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true,
      writable: true
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    global.chrome = createChromeMock({
      savedPresets: [
        {
          id: 'preset-1',
          name: 'First',
          settings: { snowmax: 100, colors: ['#111111'], symbols: ['A'] },
          updatedAt: Date.now()
        },
        {
          id: 'preset-2',
          name: 'Second',
          settings: { snowmax: 120, colors: ['#222222'], symbols: ['B'] },
          updatedAt: Date.now()
        }
      ],
      activePresetId: 'preset-1'
    });

    await import('../src/popup/popup.js?t=' + Date.now());
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    document.getElementById('transferAllPresets').checked = true;
    const appendSpy = vi.spyOn(document.body, 'appendChild');

    document.getElementById('exportSettings').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const exportedLink = appendSpy.mock.calls.at(-1)[0];
    expect(exportedLink.download).toMatch(/^let-it-snow-all-presets-\d{4}-\d{2}-\d{2}\.json$/);

    const exportedBlob = createObjectURL.mock.calls[0][0];
    const exportedText = await exportedBlob.text();
    const exportedJson = JSON.parse(exportedText);

    expect(exportedJson.exportScope).toBe('all-presets');
    expect(Array.isArray(exportedJson.presets)).toBe(true);
    expect(exportedJson.presets).toHaveLength(2);
    expect(exportedJson.presets.map((preset) => preset.name)).toEqual(['First', 'Second']);

    Object.defineProperty(URL, 'createObjectURL', {
      value: originalCreateObjectURL,
      configurable: true,
      writable: true
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: originalRevokeObjectURL,
      configurable: true,
      writable: true
    });
    clickSpy.mockRestore();
  });

  it('imports all presets from multi-preset JSON payload', async () => {
    global.chrome = createChromeMock();

    await import('../src/popup/popup.js?t=' + Date.now());
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const presetSelect = document.getElementById('presetSelect');
    const initialPresetCount = presetSelect.options.length;

    const importInput = document.getElementById('importSettingsInput');
    const importedFile = new File(
      [JSON.stringify({
        exportScope: 'all-presets',
        presets: [
          { name: 'Pack One', settings: { snowmax: 130, colors: ['#123456'], symbols: ['1'] } },
          { name: 'Pack Two', settings: { snowmax: 140, colors: ['#654321'], symbols: ['2'] } }
        ]
      })],
      'imported-preset-pack.json',
      { type: 'application/json' }
    );

    Object.defineProperty(importInput, 'files', {
      value: [importedFile],
      configurable: true
    });

    importInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(presetSelect.options).toHaveLength(initialPresetCount + 2);
    const optionNames = Array.from(presetSelect.options).map((option) => option.textContent);
    expect(optionNames).toContain('Pack One');
    expect(optionNames).toContain('Pack Two');

    const presetsCall = global.chrome.storage.sync.set.mock.calls.findLast(
      (call) => Array.isArray(call[0].savedPresets)
    );
    expect(presetsCall).toBeDefined();
    const savedNames = presetsCall[0].savedPresets.map((preset) => preset.name);
    expect(savedNames).toContain('Pack One');
    expect(savedNames).toContain('Pack Two');
  });

  it('restores built-in templates and overwrites existing presets by name', async () => {
    global.chrome = createChromeMock({
      savedPresets: [
        {
          id: 'custom-winter-id',
          name: 'Зимний',
          settings: {
            snowmax: 12,
            sinkspeed: 0.2,
            snowminsize: 2,
            snowmaxsize: 3,
            colors: ['#101010'],
            symbols: ['*'],
            symbolModes: ['text'],
            sentences: [],
            sentenceCount: 0,
            gifs: [],
            gifCount: 0,
            autoStart: false,
            popupWidth: 380,
            mouseRadius: 100,
            windEnabled: false,
            windDirection: 'left',
            windStrength: 0.5,
            windGustFrequency: 3
          },
          updatedAt: Date.now()
        },
        {
          id: 'my-custom-id',
          name: 'Мой уникальный',
          settings: {
            snowmax: 77,
            sinkspeed: 0.5,
            snowminsize: 2,
            snowmaxsize: 4,
            colors: ['#abcdef'],
            symbols: ['❄'],
            symbolModes: ['text'],
            sentences: [],
            sentenceCount: 0,
            gifs: [],
            gifCount: 0,
            autoStart: false,
            popupWidth: 380,
            mouseRadius: 100,
            windEnabled: false,
            windDirection: 'left',
            windStrength: 0.5,
            windGustFrequency: 3
          },
          updatedAt: Date.now()
        }
      ],
      activePresetId: 'custom-winter-id'
    });

    await import('../src/popup/popup.js?t=' + Date.now());
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    document.getElementById('restorePresetTemplates').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const presetsCall = global.chrome.storage.sync.set.mock.calls.findLast(
      (call) => Array.isArray(call[0].savedPresets)
    );
    expect(presetsCall).toBeDefined();

    const savedPresets = presetsCall[0].savedPresets;
    const winterPresets = savedPresets.filter((preset) => preset.name === 'Зимний');
    expect(winterPresets).toHaveLength(1);
    expect(winterPresets[0].settings.snowmax).toBe(120);

    const customPreset = savedPresets.find((preset) => preset.name === 'Мой уникальный');
    expect(customPreset).toBeDefined();
    expect(customPreset.settings.snowmax).toBe(77);
  });

  it('keeps popup width separate when applying presets', async () => {
    global.chrome = createChromeMock({
      popupWidthPercent: 26,
      savedPresets: [
        {
          id: 'preset-1',
          name: 'Preset One',
          settings: {
            snowmax: 111,
            sinkspeed: 0.7,
            snowminsize: 2,
            snowmaxsize: 4,
            colors: ['#ffffff'],
            symbols: ['❄'],
            symbolModes: ['text'],
            sentences: [],
            sentenceCount: 0,
            gifs: [],
            gifCount: 0,
            autoStart: false,
            popupWidthPercent: 18,
            windEnabled: false,
            windDirection: 'left',
            windStrength: 0.5,
            windGustFrequency: 3
          },
          updatedAt: Date.now()
        }
      ],
      activePresetId: 'preset-1'
    });

    await import('../src/popup/popup.js?t=' + Date.now());
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const popupWidthInput = document.getElementById('popupWidth');
    const minPercent = parseFloat(popupWidthInput.min);
    const maxPercent = parseFloat(popupWidthInput.max);
    const normalizedPercent = Math.max(minPercent, Math.min(maxPercent, 26));
    expect(popupWidthInput.value).toBe(normalizedPercent.toFixed(1));

    document.getElementById('applyPreset').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.getElementById('popupWidth').value).toBe(normalizedPercent.toFixed(1));

    const presetsCall = global.chrome.storage.sync.set.mock.calls.findLast(
      (call) => Array.isArray(call[0].savedPresets)
    );
    expect(presetsCall).toBeDefined();
    expect(presetsCall[0].savedPresets[0].settings.popupWidthPercent).toBeUndefined();
  });
});
