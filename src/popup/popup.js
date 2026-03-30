/**
 * Главный файл popup интерфейса расширения Let It Snow
 * 
 * Управляет пользовательским интерфейсом настроек снегопада,
 * включая цвета, символы, GIF анимации и параметры поведения.
 */

import './popup.css';
import { t, applyLocalization } from './localization.js';
import { saveSettings, loadSettings, DEFAULT_SETTINGS } from './settings.js';
import {
  createColorItem,
  createSymbolItem,
  createSentenceItem,
  createGifItem,
  setupSliderListener,
  getSymbolFontStack
} from './ui-controllers.js';

const SETTINGS_KEYS = [
  'snowmax',
  'sinkspeed',
  'snowminsize',
  'snowmaxsize',
  'colors',
  'symbols',
  'symbolModes',
  'sentences',
  'sentenceCount',
  'autoStart',
  'gifs',
  'gifCount',
  'mouseRadius',
  'windEnabled',
  'windDirection',
  'windStrength',
  'windGustFrequency'
];

const PRESETS_STORAGE_KEY = 'savedPresets';
const ACTIVE_PRESET_STORAGE_KEY = 'activePresetId';

/**
 * Инициализация popup при загрузке DOM
 */
document.addEventListener('DOMContentLoaded', async () => {
  // Пропускаем инициализацию в playground среде (инициализация будет в popup-playground.js)
  if (window.__IS_PLAYGROUND__) {
    return;
  }
  
  // Применяем локализацию
  applyLocalization();

  // Загружаем версию расширения
  const manifest = chrome.runtime.getManifest();
  const versionElement = document.getElementById('versionNumber');
  if (versionElement) {
    versionElement.textContent = manifest.version;
  }

  // Инициализация табов
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetTab = button.dataset.tab;
      
      // Удаляем активный класс у всех кнопок и контента
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));
      
      // Добавляем активный класс к выбранной вкладке
      button.classList.add('active');
      const targetContent = document.getElementById(`${targetTab}-tab`);
      if (targetContent) {
        targetContent.classList.add('active');
      }
    });
  });

  // Инициализация под-вкладок внутри настроек
  const subTabButtons = document.querySelectorAll('.sub-tab-button');
  const subTabContents = document.querySelectorAll('.sub-tab-content');

  subTabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetSubTab = button.dataset.subtab;

      subTabButtons.forEach(btn => btn.classList.remove('active'));
      subTabContents.forEach(content => content.classList.remove('active'));

      button.classList.add('active');
      const targetContent = document.getElementById(`subtab-${targetSubTab}`);
      if (targetContent) {
        targetContent.classList.add('active');
      }
    });
  });

  // Получаем ссылки на все элементы UI
  const elements = {
    snowmax: document.getElementById('snowmax'),
    snowmaxValue: document.getElementById('snowmaxValue'),
    sinkspeed: document.getElementById('sinkspeed'),
    sinkspeedValue: document.getElementById('sinkspeedValue'),
    snowminsize: document.getElementById('snowminsize'),
    snowmaxsize: document.getElementById('snowmaxsize'),
    minsizeValue: document.getElementById('minsizeValue'),
    maxsizeValue: document.getElementById('maxsizeValue'),
    sizePreviewMinFlake: document.getElementById('sizePreviewMinFlake'),
    sizePreviewMaxFlake: document.getElementById('sizePreviewMaxFlake'),
    sizePreviewMinMeta: document.getElementById('sizePreviewMinMeta'),
    sizePreviewMaxMeta: document.getElementById('sizePreviewMaxMeta'),
    sizePreviewGlyphPicker: document.getElementById('sizePreviewGlyphPicker'),
    colorsList: document.getElementById('colorsList'),
    symbolsList: document.getElementById('symbolsList'),
    sentencesList: document.getElementById('sentencesList'),
    sentenceCount: document.getElementById('sentenceCount'),
    sentenceCountValue: document.getElementById('sentenceCountValue'),
    startSnow: document.getElementById('startSnow'),
    stopSnow: document.getElementById('stopSnow'),
    addColor: document.getElementById('addColor'),
    addSymbol: document.getElementById('addSymbol'),
    addSentence: document.getElementById('addSentence'),
    presetSelect: document.getElementById('presetSelect'),
    presetNameInput: document.getElementById('presetNameInput'),
    savePreset: document.getElementById('savePreset'),
    renamePreset: document.getElementById('renamePreset'),
    applyPreset: document.getElementById('applyPreset'),
    deletePreset: document.getElementById('deletePreset'),
    exportSettings: document.getElementById('exportSettings'),
    importSettings: document.getElementById('importSettings'),
    importSettingsInput: document.getElementById('importSettingsInput'),
    autoStart: document.getElementById('autoStart'),
    gifsList: document.getElementById('gifsList'),
    addGif: document.getElementById('addGif'),
    gifCount: document.getElementById('gifCount'),
    gifCountValue: document.getElementById('gifCountValue'),
    mouseRadius: document.getElementById('mouseRadius'),
    mouseRadiusValue: document.getElementById('mouseRadiusValue'),
    windEnabled: document.getElementById('windEnabled'),
    windSettings: document.getElementById('windSettings'),
    windDirection: document.getElementById('windDirection'),
    windStrength: document.getElementById('windStrength'),
    windStrengthValue: document.getElementById('windStrengthValue'),
    windGustFrequency: document.getElementById('windGustFrequency'),
    windGustFrequencyValue: document.getElementById('windGustFrequencyValue')
  };

  elements.presetNameInput.placeholder = t('presetNamePlaceholder');

  const LEGACY_PIXEL_THRESHOLD = 6;
  const SIZE_PERCENT_MIN = parseFloat(elements.snowminsize.min) || 0.2;
  const SIZE_PERCENT_MAX = parseFloat(elements.snowmaxsize.max) || 6;
  const SIZE_PERCENT_STEP = parseFloat(elements.snowminsize.step) || 0.1;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const getViewportBaseForPreview = () => {
    const width = Number(window?.screen?.width) || window.innerWidth || 1920;
    const height = Number(window?.screen?.height) || window.innerHeight || 1080;
    return Math.max(1, Math.min(width, height));
  };

  const formatPercent = (value) => {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };

  const normalizeSizePercentRange = (rawMin, rawMax) => {
    const viewportBase = getViewportBaseForPreview();
    const toPercent = (value, fallback) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return fallback;
      const converted = numeric > LEGACY_PIXEL_THRESHOLD
        ? (numeric / viewportBase) * 100
        : numeric;
      return clamp(converted, SIZE_PERCENT_MIN, SIZE_PERCENT_MAX);
    };

    const minPercent = toPercent(rawMin, DEFAULT_SETTINGS.snowminsize);
    const maxPercent = toPercent(rawMax, DEFAULT_SETTINGS.snowmaxsize);

    if (maxPercent <= minPercent) {
      return {
        minPercent,
        maxPercent: clamp(minPercent + SIZE_PERCENT_STEP, SIZE_PERCENT_MIN + SIZE_PERCENT_STEP, SIZE_PERCENT_MAX)
      };
    }

    return { minPercent, maxPercent };
  };

  let previewGlyph = { symbol: '❄', mode: 'text' };

  const updateSizePreview = () => {
    const minPercent = parseFloat(elements.snowminsize.value);
    const maxPercent = parseFloat(elements.snowmaxsize.value);
    const viewportBase = getViewportBaseForPreview();
    const minPx = Math.max(1, Math.round((minPercent / 100) * viewportBase));
    const maxPx = Math.max(1, Math.round((maxPercent / 100) * viewportBase));
    const glyph = previewGlyph.symbol;
    const fontFamily = getSymbolFontStack(previewGlyph.mode);

    if (elements.sizePreviewMinFlake) {
      elements.sizePreviewMinFlake.style.fontSize = `${clamp(minPx, 12, 44)}px`;
      elements.sizePreviewMinFlake.style.fontFamily = fontFamily;
      elements.sizePreviewMinFlake.textContent = glyph;
    }
    if (elements.sizePreviewMaxFlake) {
      elements.sizePreviewMaxFlake.style.fontSize = `${clamp(maxPx, 16, 56)}px`;
      elements.sizePreviewMaxFlake.style.fontFamily = fontFamily;
      elements.sizePreviewMaxFlake.textContent = glyph;
    }
    if (elements.sizePreviewMinMeta) {
      elements.sizePreviewMinMeta.textContent = `~${minPx}px`;
    }
    if (elements.sizePreviewMaxMeta) {
      elements.sizePreviewMaxMeta.textContent = `~${maxPx}px`;
    }
  };

  const getSymbolsFromPool = () => {
    const items = Array.from(elements.symbolsList.querySelectorAll('.item'));
    const seen = new Set();
    const result = [];
    for (const item of items) {
      const input = item.querySelector('input[type="text"]');
      if (!input) continue;
      const symbol = input.value.trim();
      if (!symbol || seen.has(symbol)) continue;
      seen.add(symbol);
      result.push({ symbol, mode: item.dataset.symbolMode || 'text' });
    }
    return result.length > 0 ? result : [{ symbol: '❄', mode: 'text' }];
  };

  const refreshGlyphPicker = () => {
    if (!elements.sizePreviewGlyphPicker) return;
    const entries = getSymbolsFromPool();
    if (!entries.some(e => e.symbol === previewGlyph.symbol)) {
      previewGlyph = entries[0];
    }
    elements.sizePreviewGlyphPicker.innerHTML = '';
    entries.forEach(entry => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'glyph-chip' + (entry.symbol === previewGlyph.symbol ? ' active' : '');
      chip.textContent = entry.symbol;
      chip.style.fontFamily = getSymbolFontStack(entry.mode);
      chip.addEventListener('click', () => {
        previewGlyph = entry;
        elements.sizePreviewGlyphPicker.querySelectorAll('.glyph-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        updateSizePreview();
      });
      elements.sizePreviewGlyphPicker.appendChild(chip);
    });
    updateSizePreview();
  };

  const createPresetId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `preset-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  };

  const normalizeSettings = (rawConfig = {}) => {
    const config = { ...DEFAULT_SETTINGS, ...rawConfig };
    const rawSymbols = Array.isArray(config.symbols) ? config.symbols : [...DEFAULT_SETTINGS.symbols];
    const normalizedSymbolEntries = rawSymbols
      .map((entry) => {
        if (typeof entry === 'string') {
          return { symbol: entry, mode: null };
        }
        if (entry && typeof entry === 'object') {
          const symbol = String(entry.symbol || entry.char || '').trim();
          if (!symbol) return null;
          const mode = entry.mode === 'emoji' ? 'emoji' : (entry.mode === 'text' ? 'text' : null);
          return { symbol, mode };
        }
        return null;
      })
      .filter(Boolean);

    const normalizedSymbols = normalizedSymbolEntries.length > 0
      ? normalizedSymbolEntries.map((entry) => entry.symbol)
      : [...DEFAULT_SETTINGS.symbols];

    const rawSymbolModes = Array.isArray(config.symbolModes) ? config.symbolModes : [];
    const symbolModes = normalizedSymbols.map((_, index) => {
      const entryMode = normalizedSymbolEntries[index]?.mode;
      if (entryMode === 'emoji' || entryMode === 'text') {
        return entryMode;
      }
      return rawSymbolModes[index] === 'emoji' ? 'emoji' : 'text';
    });

    const { minPercent, maxPercent } = normalizeSizePercentRange(
      config.snowminsize,
      config.snowmaxsize
    );

    return {
      snowmax: Number.isFinite(config.snowmax) ? config.snowmax : DEFAULT_SETTINGS.snowmax,
      sinkspeed: Number.isFinite(config.sinkspeed) ? config.sinkspeed : DEFAULT_SETTINGS.sinkspeed,
      snowminsize: minPercent,
      snowmaxsize: maxPercent,
      colors: Array.isArray(config.colors) && config.colors.length > 0
        ? config.colors
        : [...DEFAULT_SETTINGS.colors],
      symbols: normalizedSymbols,
      symbolModes,
      sentences: Array.isArray(config.sentences) ? config.sentences : [],
      sentenceCount: Number.isFinite(config.sentenceCount) ? config.sentenceCount : 0,
      gifs: Array.isArray(config.gifs) ? config.gifs : [],
      gifCount: Number.isFinite(config.gifCount) ? config.gifCount : 0,
      autoStart: Boolean(config.autoStart),
      mouseRadius: Number.isFinite(config.mouseRadius) ? config.mouseRadius : DEFAULT_SETTINGS.mouseRadius,
      windEnabled: Boolean(config.windEnabled),
      windDirection: ['left', 'right', 'random'].includes(config.windDirection)
        ? config.windDirection
        : DEFAULT_SETTINGS.windDirection,
      windStrength: Number.isFinite(config.windStrength) ? config.windStrength : DEFAULT_SETTINGS.windStrength,
      windGustFrequency: Number.isFinite(config.windGustFrequency)
        ? config.windGustFrequency
        : DEFAULT_SETTINGS.windGustFrequency
    };
  };

  const createPresetObject = (name, settings) => ({
    id: createPresetId(),
    name: (name || '').trim() || `${t('presetNameFallback')} ${new Date().toLocaleDateString()}`,
    settings: normalizeSettings(settings),
    updatedAt: Date.now()
  });

  const getPresetDisplayName = (name, fallbackIndex = null) => {
    const normalizedName = (name || '').trim();
    if (normalizedName) {
      return normalizedName;
    }

    if (fallbackIndex !== null) {
      return `${t('presetNameFallback')} ${fallbackIndex}`;
    }

    return t('presetNameFallback');
  };

  const sanitizeFilenamePart = (value) => {
    const normalized = (value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, '-')
      .replace(/^-+|-+$/g, '');

    return normalized || 'preset';
  };

  const stripFileExtension = (filename = '') => filename.replace(/\.[^/.]+$/, '').trim();

  const extractImportedPreset = (parsed, fileName = '') => {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid_settings');
    }

    if (parsed.settings && typeof parsed.settings === 'object' && !Array.isArray(parsed.settings)) {
      return {
        name: getPresetDisplayName(parsed.name || parsed.presetName || stripFileExtension(fileName)),
        settings: normalizeSettings(parsed.settings)
      };
    }

    return {
      name: getPresetDisplayName(parsed.name || parsed.presetName || stripFileExtension(fileName)),
      settings: normalizeSettings(parsed)
    };
  };

  let presets = [];
  let activePresetId = null;

  const syncPresetNameInput = () => {
    const activePreset = presets.find((preset) => preset.id === activePresetId);
    elements.presetNameInput.value = activePreset ? activePreset.name : '';
  };

  const setPresetButtonsState = () => {
    const hasPresets = presets.length > 0;
    elements.applyPreset.disabled = !hasPresets;
    elements.renamePreset.disabled = !hasPresets;
    elements.deletePreset.disabled = !hasPresets;
    elements.presetSelect.disabled = !hasPresets;
  };

  const refreshPresetSelect = () => {
    const previousSelection = elements.presetSelect.value;
    elements.presetSelect.innerHTML = '';

    presets.forEach((preset) => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name;
      elements.presetSelect.appendChild(option);
    });

    const selectedId = presets.some((preset) => preset.id === activePresetId)
      ? activePresetId
      : previousSelection;

    if (selectedId && presets.some((preset) => preset.id === selectedId)) {
      elements.presetSelect.value = selectedId;
    } else if (presets.length > 0) {
      activePresetId = presets[0].id;
      elements.presetSelect.value = activePresetId;
    }

    setPresetButtonsState();
    syncPresetNameInput();
  };

  const findPresetById = (presetId) => presets.find((preset) => preset.id === presetId);

  const persistPresets = async () => {
    await saveSettings({
      [PRESETS_STORAGE_KEY]: presets,
      [ACTIVE_PRESET_STORAGE_KEY]: activePresetId
    });
  };

  /**
   * Собирает текущие настройки из UI
   * @returns {Object}
   */
  const buildSettingsPayload = () => {
    const colors = Array.from(
      elements.colorsList.querySelectorAll('.item')
    ).map((item) => item.querySelector('input[type="color"]').value);

    const symbolEntries = Array.from(
      elements.symbolsList.querySelectorAll('.item')
    )
      .map((item) => {
        const symbol = item.querySelector('input[type="text"]').value.trim();
        const mode = item.dataset.symbolMode === 'emoji' ? 'emoji' : 'text';
        return { symbol, mode };
      })
      .filter((entry) => entry.symbol !== '');

    const symbols = symbolEntries.map((entry) => entry.symbol);
    const symbolModes = symbolEntries.map((entry) => entry.mode);

    const sentences = Array.from(
      elements.sentencesList.querySelectorAll('.item')
    )
      .map((item) => item.querySelector('.sentence-text').value.trim())
      .filter((s) => s !== '');

    const gifs = Array.from(elements.gifsList.querySelectorAll('.item'))
      .map((item) => item.querySelector('input[type="url"]').value.trim())
      .filter((s) => s !== '');

    const { minPercent, maxPercent } = normalizeSizePercentRange(
      elements.snowminsize.value,
      elements.snowmaxsize.value
    );

    return {
      snowmax: parseInt(elements.snowmax.value),
      sinkspeed: parseFloat(elements.sinkspeed.value),
      snowminsize: minPercent,
      snowmaxsize: maxPercent,
      colors: colors.length > 0 ? colors : ['#ffffff'],
      symbols: symbols.length > 0 ? symbols : ['❄'],
      symbolModes: symbolModes.length > 0 ? symbolModes : ['text'],
      sentences,
      sentenceCount: parseInt(elements.sentenceCount.value) || 0,
      gifs,
      gifCount: parseInt(elements.gifCount.value) || 0,
      autoStart: elements.autoStart.checked,
      mouseRadius: parseInt(elements.mouseRadius.value),
      windEnabled: elements.windEnabled.checked,
      windDirection: elements.windDirection.value,
      windStrength: parseFloat(elements.windStrength.value),
      windGustFrequency: parseFloat(elements.windGustFrequency.value)
    };
  };

  /**
   * Применяет объект настроек к UI
   * @param {Object} rawConfig
   */
  const applySettingsToUI = (rawConfig = {}) => {
    const config = normalizeSettings(rawConfig);
    const colors = Array.isArray(config.colors) && config.colors.length > 0
      ? config.colors
      : DEFAULT_SETTINGS.colors;
    const symbols = Array.isArray(config.symbols) && config.symbols.length > 0
      ? config.symbols
      : DEFAULT_SETTINGS.symbols;
    const symbolModes = Array.isArray(config.symbolModes) && config.symbolModes.length > 0
      ? config.symbolModes
      : new Array(symbols.length).fill('text');
    const sentences = Array.isArray(config.sentences) ? config.sentences : [];
    const gifs = Array.isArray(config.gifs) ? config.gifs : [];

    elements.snowmax.value = config.snowmax;
    elements.snowmaxValue.textContent = config.snowmax;
    elements.sinkspeed.value = config.sinkspeed;
    elements.sinkspeedValue.textContent = parseFloat(config.sinkspeed).toFixed(1);
    elements.snowminsize.value = config.snowminsize;
    elements.snowmaxsize.value = config.snowmaxsize;
    elements.minsizeValue.textContent = formatPercent(config.snowminsize);
    elements.maxsizeValue.textContent = formatPercent(config.snowmaxsize);
    updateSizePreview();
    elements.autoStart.checked = Boolean(config.autoStart);
    elements.gifCount.value = config.gifCount || 0;
    elements.gifCountValue.textContent = config.gifCount || 0;
    elements.sentenceCount.value = config.sentenceCount || 0;
    elements.sentenceCountValue.textContent = config.sentenceCount || 0;
    elements.mouseRadius.value = config.mouseRadius || 100;
    elements.mouseRadiusValue.textContent = config.mouseRadius || 100;

    elements.windEnabled.checked = Boolean(config.windEnabled);
    elements.windDirection.value = config.windDirection || 'left';
    elements.windStrength.value = config.windStrength || 0.5;
    elements.windStrengthValue.textContent = (config.windStrength || 0.5).toFixed(1);
    elements.windGustFrequency.value = config.windGustFrequency || 3;
    elements.windGustFrequencyValue.textContent = (config.windGustFrequency || 3).toFixed(1);
    elements.windSettings.classList.toggle('wind-controls-disabled', !elements.windEnabled.checked);

    elements.colorsList.innerHTML = '';
    elements.symbolsList.innerHTML = '';
    elements.sentencesList.innerHTML = '';
    elements.gifsList.innerHTML = '';

    colors.forEach((color) => createColorItem(color, elements.colorsList, saveAllSettings));
    symbols.forEach((symbol, index) => createSymbolItem(
      symbol,
      elements.symbolsList,
      saveAllSettings,
      symbolModes[index] === 'emoji' ? 'emoji' : 'text'
    ));
    sentences.forEach((sentence) => createSentenceItem(sentence, elements.sentencesList, saveAllSettings));
    gifs.forEach((gif) => createGifItem(gif, elements.gifsList, saveAllSettings));

    if (elements.colorsList.children.length === 0) {
      createColorItem('#ffffff', elements.colorsList, saveAllSettings);
    }
    if (elements.symbolsList.children.length === 0) {
      createSymbolItem('❄', elements.symbolsList, saveAllSettings, 'text');
    }
    if (elements.gifsList.children.length === 0) {
      createGifItem('', elements.gifsList, saveAllSettings);
    }
    refreshGlyphPicker();
  };

  /**
   * Сохраняет все настройки из UI в chrome.storage
   */
  const saveAllSettings = async (syncActivePreset = true) => {
    const payload = buildSettingsPayload();
    await saveSettings(payload);

    if (syncActivePreset && activePresetId) {
      const presetIndex = presets.findIndex((preset) => preset.id === activePresetId);
      if (presetIndex !== -1) {
        presets[presetIndex] = {
          ...presets[presetIndex],
          settings: normalizeSettings(payload),
          updatedAt: Date.now()
        };
        await persistPresets();
      }
    }

    return payload;
  };

  // Загружаем сохраненные настройки
  const saved = await loadSettings([...SETTINGS_KEYS, PRESETS_STORAGE_KEY, ACTIVE_PRESET_STORAGE_KEY]);

  const loadedPresets = Array.isArray(saved[PRESETS_STORAGE_KEY])
    ? saved[PRESETS_STORAGE_KEY]
        .filter((preset) => preset && typeof preset === 'object')
        .map((preset) => ({
          id: typeof preset.id === 'string' && preset.id.trim() ? preset.id : createPresetId(),
          name: typeof preset.name === 'string' && preset.name.trim() ? preset.name.trim() : t('presetNameFallback'),
          settings: normalizeSettings(preset.settings),
          updatedAt: Number.isFinite(preset.updatedAt) ? preset.updatedAt : Date.now()
        }))
    : [];

  const config = normalizeSettings(saved);
  presets = loadedPresets.length > 0
    ? loadedPresets
    : [createPresetObject(t('presetDefaultName'), config)];
  activePresetId = saved[ACTIVE_PRESET_STORAGE_KEY] || presets[0].id;

  const activePreset = findPresetById(activePresetId) || presets[0];
  activePresetId = activePreset.id;

  refreshPresetSelect();
  applySettingsToUI(activePreset.settings);

  // Обновляем пул глифов при добавлении/удалении символов или смене режима text/emoji
  new MutationObserver(() => refreshGlyphPicker())
    .observe(elements.symbolsList, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-symbol-mode'] });
  // Обновляем пул глифов при редактировании существующего символа
  elements.symbolsList.addEventListener('input', () => refreshGlyphPicker());

  // === Настройка обработчиков событий ===

  // Добавление нового цвета
  elements.addColor.addEventListener('click', () => {
    const randomColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
    createColorItem(randomColor, elements.colorsList, saveAllSettings);
    saveAllSettings();
  });

  // Добавление нового символа
  elements.addSymbol.addEventListener('click', () => {
    const symbols = ['❄', '❅', '❆', '＊', '⋅', '✦', '❋', '✧', '✶', '✴', '✳', '❇'];
    const randomSymbol = symbols[Math.floor(Math.random() * symbols.length)];
    createSymbolItem(randomSymbol, elements.symbolsList, saveAllSettings, 'text');
    saveAllSettings();
  });

  // Добавление нового предложения
  elements.addSentence.addEventListener('click', () => {
    const examples = [
      'Счастливого Нового года!',
      'С праздником!',
      'Веселых праздников!',
      'Чудесных выходных!',
      'Хорошего настроения!'
    ];
    const randomSentence = examples[Math.floor(Math.random() * examples.length)];
    createSentenceItem(randomSentence, elements.sentencesList, saveAllSettings);
    saveAllSettings();
  });

  // Добавление нового GIF
  elements.addGif.addEventListener('click', () => {
    createGifItem(
      'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNWx1d29qYnYxODNyeXd2OTl1MGkxZHkwZWEwZDRqc2pkb2Y2b3hxdiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/vbQMBnrKxwmFH8gq3V/giphy.gif',
      elements.gifsList,
      saveAllSettings
    );
    saveAllSettings();
  });

  elements.presetSelect.addEventListener('change', () => {
    const selectedId = elements.presetSelect.value;
    if (findPresetById(selectedId)) {
      activePresetId = selectedId;
      syncPresetNameInput();
      persistPresets();
    }
  });

  elements.savePreset.addEventListener('click', async () => {
    const payload = await saveAllSettings(false);
    const rawName = elements.presetNameInput.value.trim();
    const defaultName = getPresetDisplayName(rawName, presets.length + 1);
    const preset = createPresetObject(rawName || defaultName, payload);

    presets.push(preset);
    activePresetId = preset.id;
    refreshPresetSelect();
    await persistPresets();
  });

  elements.renamePreset.addEventListener('click', async () => {
    const selectedId = elements.presetSelect.value;
    const selectedPreset = findPresetById(selectedId);

    if (!selectedPreset) {
      return;
    }

    const nextName = getPresetDisplayName(elements.presetNameInput.value, presets.indexOf(selectedPreset) + 1);
    selectedPreset.name = nextName;
    selectedPreset.updatedAt = Date.now();
    activePresetId = selectedPreset.id;
    refreshPresetSelect();
    await persistPresets();
  });

  elements.applyPreset.addEventListener('click', async () => {
    const selectedId = elements.presetSelect.value;
    const selectedPreset = findPresetById(selectedId);

    if (!selectedPreset) {
      return;
    }

    activePresetId = selectedPreset.id;
    applySettingsToUI(selectedPreset.settings);
    await saveAllSettings(false);
    await persistPresets();
  });

  elements.deletePreset.addEventListener('click', async () => {
    const selectedId = elements.presetSelect.value;
    const selectedPreset = findPresetById(selectedId);

    if (!selectedPreset) {
      return;
    }

    const confirmed = confirm(t('confirmDeletePreset'));
    if (!confirmed) {
      return;
    }

    presets = presets.filter((preset) => preset.id !== selectedId);

    if (presets.length === 0) {
      const payload = await saveAllSettings(false);
      const fallbackPreset = createPresetObject(t('presetDefaultName'), payload);
      presets = [fallbackPreset];
      activePresetId = fallbackPreset.id;
      applySettingsToUI(fallbackPreset.settings);
    } else {
      activePresetId = presets[0].id;
      applySettingsToUI(presets[0].settings);
      await saveAllSettings(false);
    }

    refreshPresetSelect();
    await persistPresets();
  });

  // Автостарт
  elements.autoStart.addEventListener('change', () => {
    saveAllSettings();
  });

  // Экспорт настроек в JSON
  elements.exportSettings.addEventListener('click', async () => {
    const payload = await saveAllSettings();
    const activePreset = findPresetById(activePresetId);
    const presetName = getPresetDisplayName(
      activePreset?.name || elements.presetNameInput.value,
      presets.indexOf(activePreset) + 1
    );
    const exportData = {
      name: presetName,
      presetName,
      exportedAt: new Date().toISOString(),
      settings: normalizeSettings(payload)
    };
    const data = JSON.stringify(exportData, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `let-it-snow-${sanitizeFilenamePart(presetName)}-${date}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  // Открытие выбора файла импорта
  elements.importSettings.addEventListener('click', () => {
    elements.importSettingsInput.click();
  });

  // Импорт настроек из JSON
  elements.importSettingsInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const importedPreset = extractImportedPreset(parsed, file.name);
      const preset = createPresetObject(
        getPresetDisplayName(importedPreset.name, presets.length + 1),
        importedPreset.settings
      );

      presets.push(preset);
      activePresetId = preset.id;
      refreshPresetSelect();
      applySettingsToUI(preset.settings);
      await saveAllSettings(false);
      await persistPresets();
    } catch (error) {
      console.error(error);
      alert(t('errorImportSettings'));
    } finally {
      elements.importSettingsInput.value = '';
    }
  });

  // Настройка слайдеров
  setupSliderListener(elements.snowmax, elements.snowmaxValue, saveAllSettings);

  setupSliderListener(
    elements.sinkspeed,
    elements.sinkspeedValue,
    saveAllSettings,
    (val) => parseFloat(val).toFixed(1)
  );

  setupSliderListener(elements.gifCount, elements.gifCountValue, saveAllSettings);
  
  setupSliderListener(elements.sentenceCount, elements.sentenceCountValue, saveAllSettings);

  setupSliderListener(elements.mouseRadius, elements.mouseRadiusValue, saveAllSettings);

  // Слайдер минимального размера
  elements.snowminsize.addEventListener('input', () => {
    const minValue = parseFloat(elements.snowminsize.value);
    const maxValue = parseFloat(elements.snowmaxsize.value);
    if (minValue >= maxValue) {
      elements.snowmaxsize.value = clamp(minValue + SIZE_PERCENT_STEP, SIZE_PERCENT_MIN + SIZE_PERCENT_STEP, SIZE_PERCENT_MAX).toFixed(1);
    }
    elements.minsizeValue.textContent = formatPercent(parseFloat(elements.snowminsize.value));
    elements.maxsizeValue.textContent = formatPercent(parseFloat(elements.snowmaxsize.value));
    updateSizePreview();
    saveAllSettings();
  });

  // Слайдер максимального размера
  elements.snowmaxsize.addEventListener('input', () => {
    const minValue = parseFloat(elements.snowminsize.value);
    const maxValue = parseFloat(elements.snowmaxsize.value);
    if (maxValue <= minValue) {
      elements.snowminsize.value = clamp(maxValue - SIZE_PERCENT_STEP, SIZE_PERCENT_MIN, SIZE_PERCENT_MAX - SIZE_PERCENT_STEP).toFixed(1);
    }
    elements.minsizeValue.textContent = formatPercent(parseFloat(elements.snowminsize.value));
    elements.maxsizeValue.textContent = formatPercent(parseFloat(elements.snowmaxsize.value));
    updateSizePreview();
    saveAllSettings();
  });

  // Включение/отключение ветра
  elements.windEnabled.addEventListener('change', () => {
    elements.windSettings.classList.toggle('wind-controls-disabled', !elements.windEnabled.checked);
    saveAllSettings();
  });

  // Направление ветра
  elements.windDirection.addEventListener('change', () => {
    saveAllSettings();
  });

  // Сила ветра
  setupSliderListener(
    elements.windStrength,
    elements.windStrengthValue,
    saveAllSettings,
    (val) => parseFloat(val).toFixed(1)
  );

  // Частота порывов ветра
  setupSliderListener(
    elements.windGustFrequency,
    elements.windGustFrequencyValue,
    saveAllSettings,
    (val) => parseFloat(val).toFixed(1)
  );

  /**
   * Запуск снегопада на активной вкладке
   */
  elements.startSnow.addEventListener('click', async () => {
    const payload = buildSettingsPayload();
    const colors = payload.colors;
    const symbols = payload.symbols;
    const sentences = payload.sentences;
    const gifs = payload.gifs;

    // Валидация
    if (colors.length === 0) {
      alert(t('errorNoColor'));
      return;
    }
    if (symbols.length === 0 && sentences.length === 0) {
      alert(t('errorNoSymbol'));
      return;
    }

    // Формируем конфигурацию
    const config = {
      snowmax: payload.snowmax,
      sinkspeed: payload.sinkspeed,
      snowminsize: payload.snowminsize,
      snowmaxsize: payload.snowmaxsize,
      snowcolor: colors,
      snowletters: symbols.length > 0 ? symbols : ['❄'],
      snowglyphmodes: payload.symbolModes && payload.symbolModes.length > 0
        ? payload.symbolModes
        : ['text'],
      snowsentences: sentences,
      sentenceCount: payload.sentenceCount,
      gifUrls: gifs,
      gifCount: gifs.length > 0 ? payload.gifCount : 0,
      mouseRadius: payload.mouseRadius,
      windEnabled: payload.windEnabled,
      windDirection: payload.windDirection,
      windStrength: payload.windStrength,
      windGustFrequency: payload.windGustFrequency
    };

    // UI анимация кнопки
    const originalHtml = elements.startSnow.innerHTML;
    const originalBackground = elements.startSnow.style.background;
    elements.startSnow.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i><span>Запускаем волшебство...</span>';
    elements.startSnow.disabled = true;

    // Мигающая анимация
    let blinkCount = 0;
    const blinkInterval = setInterval(() => {
      const colors = ['#ff6b6b', '#4fc3f7', '#66bb6a', '#ffa726'];
      elements.startSnow.style.background = `linear-gradient(135deg, ${colors[blinkCount % 4]}, ${
        colors[(blinkCount + 1) % 4]
      })`;
      blinkCount++;
    }, 200);

    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Проверка на системные страницы Chrome
      if (!tab?.id || tab.url.startsWith('chrome:')) {
        clearInterval(blinkInterval);
        elements.startSnow.innerHTML = originalHtml;
        elements.startSnow.disabled = false;
        elements.startSnow.style.background = originalBackground;
        alert(t('errorChromePage'));
        return;
      }

      // Отправка сообщения content script
      await chrome.tabs.sendMessage(tab.id, { action: 'startSnow', config });

      // Успешный запуск
      clearInterval(blinkInterval);
      elements.startSnow.innerHTML = `<i class="fas fa-check"></i><span>${t('snowStarted')}</span>`;
      elements.startSnow.style.background = 'linear-gradient(135deg, #66bb6a, #2e7d32)';

      setTimeout(() => {
        elements.startSnow.innerHTML = originalHtml;
        elements.startSnow.disabled = false;
        elements.startSnow.style.background = '';
      }, 2000);
    } catch (error) {
      clearInterval(blinkInterval);
      elements.startSnow.innerHTML = originalHtml;
      elements.startSnow.disabled = false;
      elements.startSnow.style.background = originalBackground;

      // Попытка инъекции content script если он не был загружен
      if (error.message?.includes('Receiving end does not exist')) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          await chrome.tabs.sendMessage(tab.id, { action: 'startSnow', config });

          elements.startSnow.innerHTML =
            `<i class="fas fa-check"></i><span>${t('snowStarted')}</span>`;
          elements.startSnow.style.background = 'linear-gradient(135deg, #66bb6a, #2e7d32)';

          setTimeout(() => {
            elements.startSnow.innerHTML = originalHtml;
            elements.startSnow.disabled = false;
            elements.startSnow.style.background = '';
          }, 2000);
        } catch {
          alert(t('errorInject'));
        }
      } else {
        console.error(error);
        alert('Произошла ошибка: ' + error.message);
      }
    }
  });

  /**
   * Остановка снегопада и очистка активной вкладки
   */
  elements.stopSnow.addEventListener('click', async () => {
    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.id || tab.url.startsWith('chrome:')) {
        alert(t('errorChromePage'));
        return;
      }

      await chrome.tabs.sendMessage(tab.id, { action: 'stopSnow' });
    } catch (error) {
      if (!error.message?.includes('Receiving end does not exist')) {
        console.error(error);
      }
    }
  });
});
