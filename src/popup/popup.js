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
  getSymbolFontStack,
  detectSymbolMode,
  showToast,
  showChoiceDialog
} from './ui-controllers.js';
import { normalizeGlyphSizePercentRange } from '../content/utils/size-utils.js';
import { BUILT_IN_PRESET_TEMPLATES, createBuiltInPresets } from './presets/built-in-presets.js';
import { initApiPanel, requestSnowSync } from './api-panel.js';
import { initHelpPanel } from './help-panel.js';

const SETTINGS_KEYS = [
  'snowmax',
  'snowminsize',
  'snowmaxsize',
  'snowFluffiness',
  'snowShape',
  'gravity',
  'airDensity',
  'colors',
  'symbols',
  'symbolModes',
  'sentences',
  'sentenceCount',
  'autoStart',
  'rendererMode',
  'snow3dThickness',
  'popupWidthPercent',
  'popupWidth',
  'gifs',
  'gifCount',
  'mouseRadius',
  'windEnabled',
  'windDirection',
  'windStrength',
  'windGustFrequency',
  'windGustStrength',
  'turbulenceStrength',
  'updraftStrength'
];

const PRESETS_STORAGE_KEY = 'savedPresets';
const ACTIVE_PRESET_STORAGE_KEY = 'activePresetId';
// Id of the preset whose settings were edited but not saved yet (the edits live in the plain settings keys).
const PRESET_DRAFT_STORAGE_KEY = 'presetDraftFor';
const SYMBOL_MODE_MIGRATION_KEY = 'symbolModeAutoDetect';
const BUILT_IN_PRESET_VERSION_KEY = 'builtInPresetVersion';
// Increment when built-in templates change; user-created presets remain untouched.
const BUILT_IN_PRESET_VERSION = 2;
const LAST_SUBTAB_STORAGE_KEY = 'letItSnow.popup.subtab';
const DELETE_CONFIRM_WINDOW_MS = 3000;
const GLYPH_VISUAL_SCALE = 0.84;
const WIND_PRESETS = {
  weak: { windStrength: 0.4, windGustFrequency: 4, windGustStrength: 0.2, turbulenceStrength: 0.15, updraftStrength: 0 },
  strong: { windStrength: 1.5, windGustFrequency: 3, windGustStrength: 0.6, turbulenceStrength: 0.55, updraftStrength: 8 },
  hurricane: { windStrength: 3, windGustFrequency: 1.5, windGustStrength: 1, turbulenceStrength: 1, updraftStrength: 30 }
};
const POPUP_WIDTH_MIN_PX = 320;
const POPUP_WIDTH_MAX_PX = 520;
const POPUP_WIDTH_PERCENT_FLOOR = 10;
const POPUP_WIDTH_PERCENT_CEIL = 90;
const isRestrictedTab = (tab) => {
  if (!tab?.id || typeof tab.url !== 'string') return true;

  try {
    return new Set([
      'about:',
      'chrome:',
      'chrome-extension:',
      'data:',
      'devtools:',
      'edge:',
      'javascript:',
      'moz-extension:',
      'view-source:'
    ]).has(new URL(tab.url).protocol);
  } catch {
    return true;
  }
};

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

  const activateTab = (targetTab) => {
    const targetContent = document.getElementById(`${targetTab}-tab`);
    if (!targetContent) return;
    tabButtons.forEach((btn) => {
      const isActive = btn.dataset.tab === targetTab;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });
    tabContents.forEach((content) => content.classList.toggle('active', content === targetContent));
  };

  tabButtons.forEach(button => {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
  });

  // Инициализация под-вкладок внутри настроек
  const subTabButtons = document.querySelectorAll('.sub-tab-button');
  const subTabContents = document.querySelectorAll('.sub-tab-content');

  const activateSubTab = (targetSubTab) => {
    const button = Array.from(subTabButtons).find((btn) => btn.dataset.subtab === targetSubTab);
    const targetContent = document.getElementById(`subtab-${targetSubTab}`);
    if (!button || !targetContent) return false;

    subTabButtons.forEach((btn) => {
      btn.classList.remove('active');
      btn.setAttribute('aria-selected', 'false');
    });
    subTabContents.forEach(content => content.classList.remove('active'));

    button.classList.add('active');
    button.setAttribute('aria-selected', 'true');
    targetContent.classList.add('active');
    return true;
  };

  subTabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetSubTab = button.dataset.subtab;
      if (activateSubTab(targetSubTab)) {
        try {
          localStorage.setItem(LAST_SUBTAB_STORAGE_KEY, targetSubTab);
        } catch {
          // Storage can be unavailable (private mode); the popup just won't remember the tab.
        }
      }
    });
  });

  try {
    const lastSubTab = localStorage.getItem(LAST_SUBTAB_STORAGE_KEY);
    if (lastSubTab) activateSubTab(lastSubTab);
  } catch {
    // Ignore unavailable storage.
  }

  initApiPanel().catch((err) => console.warn('[Let It Snow] API panel init failed:', err));
  initHelpPanel({
    onNavigate: (subtab) => {
      activateTab('settings');
      activateSubTab(subtab);
      document.querySelector('.sub-tabs-navigation')?.scrollIntoView?.({ block: 'start' });
    }
  });

  // Получаем ссылки на все элементы UI
  const elements = {
    snowmax: document.getElementById('snowmax'),
    snowmaxValue: document.getElementById('snowmaxValue'),
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
    updatePreset: document.getElementById('updatePreset'),
    presetDirtyRow: document.getElementById('presetDirtyRow'),
    presetsSubTabButton: document.querySelector('.sub-tab-button[data-subtab="presets"]'),
    deletePreset: document.getElementById('deletePreset'),
    restorePresetTemplates: document.getElementById('restorePresetTemplates'),
    exportSettings: document.getElementById('exportSettings'),
    importSettings: document.getElementById('importSettings'),
    importSettingsInput: document.getElementById('importSettingsInput'),
    transferAllPresets: document.getElementById('transferAllPresets'),
    autoStart: document.getElementById('autoStart'),
    rendererMode: document.getElementById('rendererMode'),
    snow3dThickness: document.getElementById('snow3dThickness'),
    snow3dThicknessValue: document.getElementById('snow3dThicknessValue'),
    gifsList: document.getElementById('gifsList'),
    addGif: document.getElementById('addGif'),
    gifCount: document.getElementById('gifCount'),
    gifCountValue: document.getElementById('gifCountValue'),
    mouseRadius: document.getElementById('mouseRadius'),
    mouseRadiusValue: document.getElementById('mouseRadiusValue'),
    popupWidth: document.getElementById('popupWidth'),
    popupWidthValue: document.getElementById('popupWidthValue'),
    windEnabled: document.getElementById('windEnabled'),
    windSettings: document.getElementById('windSettings'),
    windPreset: document.getElementById('windPreset'),
    windDirection: document.getElementById('windDirection'),
    windStrength: document.getElementById('windStrength'),
    windStrengthValue: document.getElementById('windStrengthValue'),
    windGustFrequency: document.getElementById('windGustFrequency'),
    windGustFrequencyValue: document.getElementById('windGustFrequencyValue'),
    snowFluffiness: document.getElementById('snowFluffiness'),
    snowFluffinessValue: document.getElementById('snowFluffinessValue'),
    snowShape: document.getElementById('snowShape'),
    gravity: document.getElementById('gravity'),
    gravityValue: document.getElementById('gravityValue'),
    airDensity: document.getElementById('airDensity'),
    airDensityValue: document.getElementById('airDensityValue'),
    windGustStrength: document.getElementById('windGustStrength'),
    windGustStrengthValue: document.getElementById('windGustStrengthValue'),
    turbulenceStrength: document.getElementById('turbulenceStrength'),
    turbulenceStrengthValue: document.getElementById('turbulenceStrengthValue'),
    updraftStrength: document.getElementById('updraftStrength'),
    updraftStrengthValue: document.getElementById('updraftStrengthValue')
  };

  elements.presetNameInput.placeholder = t('presetNamePlaceholder');

  const update3dControlsVisibility = () => {
    const item = document.getElementById('snow3dThicknessItem');
    if (item) item.hidden = elements.rendererMode.value !== '3d';
  };

  const SIZE_PERCENT_MIN = parseFloat(elements.snowminsize.min) || 2;
  const SIZE_PERCENT_MAX = parseFloat(elements.snowmaxsize.max) || 10;
  const SIZE_PERCENT_STEP = parseFloat(elements.snowminsize.step) || 0.1;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const getScreenWidthBase = () => {
    const width = Number(window?.screen?.width) || window.innerWidth || 1920;
    return Math.max(1, width);
  };

  const getPopupWidthPercentBounds = () => {
    const screenWidth = getScreenWidthBase();
    const rawMinPercent = (POPUP_WIDTH_MIN_PX / screenWidth) * 100;
    const rawMaxPercent = (POPUP_WIDTH_MAX_PX / screenWidth) * 100;
    const minPercent = clamp(rawMinPercent, POPUP_WIDTH_PERCENT_FLOOR, POPUP_WIDTH_PERCENT_CEIL - 1);
    const maxPercent = clamp(rawMaxPercent, minPercent + 1, POPUP_WIDTH_PERCENT_CEIL);
    return { minPercent, maxPercent };
  };

  const getDefaultPopupWidthPercent = () => {
    if (Number.isFinite(DEFAULT_SETTINGS.popupWidthPercent)) {
      return DEFAULT_SETTINGS.popupWidthPercent;
    }
    if (Number.isFinite(DEFAULT_SETTINGS.popupWidth)) {
      return (DEFAULT_SETTINGS.popupWidth / getScreenWidthBase()) * 100;
    }
    return 20;
  };

  const setupPopupWidthSliderBounds = () => {
    const { minPercent, maxPercent } = getPopupWidthPercentBounds();
    elements.popupWidth.min = minPercent.toFixed(1);
    elements.popupWidth.max = maxPercent.toFixed(1);
    elements.popupWidth.step = '0.1';
  };

  const clampPopupWidthPercent = (value) => {
    const { minPercent, maxPercent } = getPopupWidthPercentBounds();
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return clamp(getDefaultPopupWidthPercent(), minPercent, maxPercent);
    }
    return clamp(numeric, minPercent, maxPercent);
  };

  const popupWidthPercentToPx = (percent) => {
    const screenWidth = getScreenWidthBase();
    const percentValue = clampPopupWidthPercent(percent);
    return Math.max(1, Math.round((percentValue / 100) * screenWidth));
  };

  const popupWidthPxToPercent = (px) => {
    const screenWidth = getScreenWidthBase();
    const numeric = Number(px);
    if (!Number.isFinite(numeric)) {
      return clampPopupWidthPercent(getDefaultPopupWidthPercent());
    }
    return clampPopupWidthPercent((numeric / screenWidth) * 100);
  };

  const formatPopupWidthValue = (percent, px) => `${percent.toFixed(1)}% (~${px}px)`;

  const applyPopupWidthPercent = (value) => {
    const nextPercent = clampPopupWidthPercent(value);
    const nextWidthPx = popupWidthPercentToPx(nextPercent);
    document.documentElement.style.setProperty('--popup-width', `${nextWidthPx}px`);
    document.body.style.setProperty('--popup-width', `${nextWidthPx}px`);
    if (elements.popupWidth) {
      elements.popupWidth.value = nextPercent.toFixed(1);
    }
    if (elements.popupWidthValue) {
      elements.popupWidthValue.textContent = formatPopupWidthValue(nextPercent, nextWidthPx);
    }
    return { percent: nextPercent, px: nextWidthPx };
  };

  let previewViewportBaseSize = 0;

  const getViewportBaseForPreview = () => {
    if (Number.isFinite(previewViewportBaseSize) && previewViewportBaseSize > 0) {
      return previewViewportBaseSize;
    }
    const width = Number(window?.screen?.width) || window.innerWidth || 1920;
    const height = Number(window?.screen?.height) || window.innerHeight || 1080;
    return Math.max(1, Math.min(width, height));
  };

  const refreshPreviewViewportBaseSize = async () => {
    try {
      if (!chrome?.tabs?.query || !chrome?.tabs?.sendMessage) return;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || String(tab.url || '').startsWith('chrome:')) return;
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getViewportBaseSize' });
      const value = Number(response?.viewportBaseSize);
      if (response?.ok && Number.isFinite(value) && value > 0) {
        previewViewportBaseSize = value;
      }
    } catch {
      // Нормальный сценарий: content-script может быть не инжектирован до первого запуска.
    }
  };

  const setupCanvasResizeListener = () => {
    if (typeof chrome === 'undefined' || !chrome?.tabs?.query) return;
    try {
      let resizeTimeout = null;
      const handleCanvasResize = async () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(async () => {
          await refreshPreviewViewportBaseSize();
          updateSizePreview();
        }, 100);
      };
      window.addEventListener('resize', handleCanvasResize, { passive: true });
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleCanvasResize, { passive: true });
      }
    } catch {
      // Игнорируем ошибки инициализации
    }
  };

  const formatPercent = (value) => {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };

  const normalizeSizePercentRange = (rawMin, rawMax) => {
    const viewportBase = getViewportBaseForPreview();
    const { minPercent, maxPercent } = normalizeGlyphSizePercentRange(rawMin, rawMax, viewportBase);

    if (maxPercent <= minPercent) {
      return {
        minPercent,
        maxPercent: clamp(minPercent + SIZE_PERCENT_STEP, SIZE_PERCENT_MIN + SIZE_PERCENT_STEP, SIZE_PERCENT_MAX)
      };
    }

    return {
      minPercent: clamp(minPercent, SIZE_PERCENT_MIN, SIZE_PERCENT_MAX),
      maxPercent: clamp(maxPercent, SIZE_PERCENT_MIN + SIZE_PERCENT_STEP, SIZE_PERCENT_MAX)
    };
  };

  let previewGlyph = { symbol: '❄', mode: 'text' };

  const updateSizePreview = () => {
    const minPercent = parseFloat(elements.snowminsize.value);
    const maxPercent = parseFloat(elements.snowmaxsize.value);
    const viewportBase = getViewportBaseForPreview();
    const minPx = Math.max(0.1, (minPercent / 100) * viewportBase);
    const maxPx = Math.max(0.1, (maxPercent / 100) * viewportBase);
    const minGlyphPx = Math.max(0.1, minPx * GLYPH_VISUAL_SCALE);
    const maxGlyphPx = Math.max(0.1, maxPx * GLYPH_VISUAL_SCALE);
    const formatPx = (value) => {
      const rounded = Math.round(value * 10) / 10;
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    };
    const glyph = previewGlyph.symbol;
    const fontFamily = getSymbolFontStack(previewGlyph.mode);

    if (elements.sizePreviewMinFlake) {
      elements.sizePreviewMinFlake.style.fontSize = `${minGlyphPx.toFixed(2)}px`;
      elements.sizePreviewMinFlake.style.fontFamily = fontFamily;
      elements.sizePreviewMinFlake.textContent = glyph;
    }
    if (elements.sizePreviewMaxFlake) {
      elements.sizePreviewMaxFlake.style.fontSize = `${maxGlyphPx.toFixed(2)}px`;
      elements.sizePreviewMaxFlake.style.fontFamily = fontFamily;
      elements.sizePreviewMaxFlake.textContent = glyph;
    }
    if (elements.sizePreviewMinMeta) {
      elements.sizePreviewMinMeta.textContent = `~${formatPx(minGlyphPx)}px`;
    }
    if (elements.sizePreviewMaxMeta) {
      elements.sizePreviewMaxMeta.textContent = `~${formatPx(maxGlyphPx)}px`;
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
    const symbolModes = normalizedSymbols.map((symbol, index) => {
      const entryMode = normalizedSymbolEntries[index]?.mode;
      if (entryMode === 'emoji' || entryMode === 'text') {
        return entryMode;
      }
      const rawMode = rawSymbolModes[index];
      if (rawMode === 'emoji' || rawMode === 'text') {
        return rawMode;
      }
      return detectSymbolMode(symbol);
    });

    const { minPercent, maxPercent } = normalizeSizePercentRange(
      config.snowminsize,
      config.snowmaxsize
    );

    const popupWidthPercent = Number.isFinite(config.popupWidthPercent)
      ? clampPopupWidthPercent(config.popupWidthPercent)
      : popupWidthPxToPercent(config.popupWidth);

    return {
      snowmax: Number.isFinite(config.snowmax) ? config.snowmax : DEFAULT_SETTINGS.snowmax,
      snowminsize: minPercent,
      snowmaxsize: maxPercent,
      snowFluffiness: Number.isFinite(config.snowFluffiness) ? clamp(config.snowFluffiness, 0, 1) : DEFAULT_SETTINGS.snowFluffiness,
      snowShape: ['auto', 'compact', 'regular', 'lacy'].includes(config.snowShape) ? config.snowShape : DEFAULT_SETTINGS.snowShape,
      gravity: Number.isFinite(config.gravity) ? clamp(config.gravity, 0, 20) : DEFAULT_SETTINGS.gravity,
      airDensity: Number.isFinite(config.airDensity) ? clamp(config.airDensity, 0.4, 2) : DEFAULT_SETTINGS.airDensity,
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
      rendererMode: config.rendererMode === '3d' ? '3d' : 'auto',
      snow3dThickness: Number.isFinite(config.snow3dThickness)
        ? clamp(config.snow3dThickness, 0.02, 0.18)
        : DEFAULT_SETTINGS.snow3dThickness,
      popupWidthPercent,
      popupWidth: popupWidthPercentToPx(popupWidthPercent),
      mouseRadius: Number.isFinite(config.mouseRadius) ? config.mouseRadius : DEFAULT_SETTINGS.mouseRadius,
      windEnabled: Boolean(config.windEnabled),
      windDirection: ['left', 'right', 'random'].includes(config.windDirection)
        ? config.windDirection
        : DEFAULT_SETTINGS.windDirection,
      windStrength: Number.isFinite(config.windStrength) ? config.windStrength : DEFAULT_SETTINGS.windStrength,
      windGustFrequency: Number.isFinite(config.windGustFrequency)
        ? config.windGustFrequency
        : DEFAULT_SETTINGS.windGustFrequency,
      windGustStrength: Number.isFinite(config.windGustStrength)
        ? clamp(config.windGustStrength, 0, 1)
        : DEFAULT_SETTINGS.windGustStrength,
      turbulenceStrength: Number.isFinite(config.turbulenceStrength)
        ? clamp(config.turbulenceStrength, 0, 1)
        : DEFAULT_SETTINGS.turbulenceStrength,
      updraftStrength: Number.isFinite(config.updraftStrength)
        ? clamp(config.updraftStrength, 0, 80)
        : DEFAULT_SETTINGS.updraftStrength
    };
  };

  const normalizePresetSettings = (rawConfig = {}) => {
    const normalized = normalizeSettings(rawConfig);
    const { popupWidth, popupWidthPercent, ...presetSettings } = normalized;
    return presetSettings;
  };

  const createPresetObject = (name, settings) => ({
    id: createPresetId(),
    name: (name || '').trim() || `${t('presetNameFallback')} ${new Date().toLocaleDateString()}`,
    settings: normalizePresetSettings(settings),
    updatedAt: Date.now()
  });

  const normalizePresetNameForMatch = (name) => String(name || '').trim().toLowerCase();

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
        settings: normalizePresetSettings(parsed.settings)
      };
    }

    return {
      name: getPresetDisplayName(parsed.name || parsed.presetName || stripFileExtension(fileName)),
      settings: normalizePresetSettings(parsed)
    };
  };

  const extractImportedPresets = (parsed, fileName = '') => {
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.presets)) {
      return parsed.presets
        .map((item, index) => {
          try {
            return extractImportedPreset(item, `${stripFileExtension(fileName)}-${index + 1}`);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    }

    return [extractImportedPreset(parsed, fileName)];
  };

  let presets = [];
  let activePresetId = null;

  const syncPresetNameInput = () => {
    const activePreset = presets.find((preset) => preset.id === activePresetId);
    elements.presetNameInput.value = activePreset ? activePreset.name : '';
  };

  const setPresetButtonsState = () => {
    const hasPresets = presets.length > 0;
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

  const mergeBuiltInPresetTemplates = ({ replaceExisting = false, migrateLegacy = false } = {}) => {
    const builtInPresets = createBuiltInPresets(DEFAULT_SETTINGS, { createPresetObject, t });
    const builtInByKey = new Map(builtInPresets.map((preset) => [preset.builtInKey, preset]));
    const legacyKeyByName = new Map([
      ['default', 'default'],
      ['основной', 'default'],
      ...BUILT_IN_PRESET_TEMPLATES.flatMap((template) =>
        template.legacyNames.map((name) => [normalizePresetNameForMatch(name), template.id])
      )
    ]);
    const merged = [];
    const mergedByKey = new Map();
    const previousActiveId = activePresetId;
    let activeIdReplacement = null;
    let changed = false;

    presets.forEach((preset) => {
      const key = builtInByKey.has(preset.builtInKey)
        ? preset.builtInKey
        : migrateLegacy ? legacyKeyByName.get(normalizePresetNameForMatch(preset.name)) : null;
      const builtInPreset = builtInByKey.get(key);
      if (!builtInPreset) {
        merged.push(preset);
        return;
      }

      const existing = mergedByKey.get(key);
      if (existing) {
        changed = true;
        if (preset.id === previousActiveId) activeIdReplacement = existing.id;
        return;
      }

      const shouldReplace = replaceExisting || preset.builtInKey !== key;
      const nextPreset = {
        ...preset,
        builtInKey: key,
        name: replaceExisting ? builtInPreset.name : preset.name,
        settings: shouldReplace ? builtInPreset.settings : preset.settings,
        updatedAt: shouldReplace ? Date.now() : preset.updatedAt
      };
      if (
        nextPreset.builtInKey !== preset.builtInKey
        || nextPreset.name !== preset.name
        || (shouldReplace && JSON.stringify(nextPreset.settings) !== JSON.stringify(preset.settings))
      ) {
        changed = true;
      }
      merged.push(nextPreset);
      mergedByKey.set(key, nextPreset);
    });

    for (const builtInPreset of builtInPresets) {
      if (mergedByKey.has(builtInPreset.builtInKey)) continue;
      merged.push(builtInPreset);
      mergedByKey.set(builtInPreset.builtInKey, builtInPreset);
      changed = true;
    }

    presets = merged;
    if (activeIdReplacement) activePresetId = activeIdReplacement;
    return changed;
  };

  const persistPresets = async () => {
    await saveSettings({
      [PRESETS_STORAGE_KEY]: presets,
      [ACTIVE_PRESET_STORAGE_KEY]: activePresetId,
      [PRESET_DRAFT_STORAGE_KEY]: updatePresetDirtyState() ? activePresetId : '',
      [BUILT_IN_PRESET_VERSION_KEY]: BUILT_IN_PRESET_VERSION
    });
  };

  // Stable fingerprint of preset settings, tolerant to color case and float noise.
  const canonicalPresetSettings = (settings) => {
    const normalized = normalizePresetSettings(settings);
    const sortKeys = (value) => {
      if (Array.isArray(value)) return value.map(sortKeys);
      if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((acc, key) => {
          acc[key] = sortKeys(value[key]);
          return acc;
        }, {});
      }
      if (typeof value === 'number') return Math.round(value * 1000) / 1000;
      if (typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value)) return value.toLowerCase();
      return value;
    };
    return JSON.stringify(sortKeys(normalized));
  };

  // Fingerprint of the UI right after the active preset was applied or saved.
  let presetBaseline = null;

  const markPresetBaseline = () => {
    presetBaseline = canonicalPresetSettings(buildSettingsPayload());
  };

  const isPresetDirty = () => {
    if (!findPresetById(activePresetId) || presetBaseline === null) return false;
    return canonicalPresetSettings(buildSettingsPayload()) !== presetBaseline;
  };

  const updatePresetDirtyState = () => {
    const dirty = isPresetDirty();
    if (elements.presetDirtyRow) elements.presetDirtyRow.hidden = !dirty;
    elements.presetsSubTabButton?.classList.toggle('has-unsaved', dirty);
    return dirty;
  };

  const applyPresetToUI = (preset) => {
    applySettingsToUI(preset.settings, { preservePopupWidth: true });
    markPresetBaseline();
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
      snowminsize: minPercent,
      snowmaxsize: maxPercent,
      snowFluffiness: parseFloat(elements.snowFluffiness.value),
      snowShape: elements.snowShape.value,
      gravity: parseFloat(elements.gravity.value),
      airDensity: parseFloat(elements.airDensity.value),
      colors: colors.length > 0 ? colors : ['#ffffff'],
      symbols: symbols.length > 0 ? symbols : ['❄'],
      symbolModes: symbolModes.length > 0 ? symbolModes : ['text'],
      sentences,
      sentenceCount: parseInt(elements.sentenceCount.value) || 0,
      gifs,
      gifCount: parseInt(elements.gifCount.value) || 0,
      autoStart: elements.autoStart.checked,
      rendererMode: elements.rendererMode.value,
      snow3dThickness: parseFloat(elements.snow3dThickness.value),
      popupWidthPercent: clampPopupWidthPercent(elements.popupWidth.value),
      mouseRadius: parseInt(elements.mouseRadius.value),
      windEnabled: elements.windEnabled.checked,
      windDirection: elements.windDirection.value,
      windStrength: parseFloat(elements.windStrength.value),
      windGustFrequency: parseFloat(elements.windGustFrequency.value),
      windGustStrength: parseFloat(elements.windGustStrength.value),
      turbulenceStrength: parseFloat(elements.turbulenceStrength.value),
      updraftStrength: parseFloat(elements.updraftStrength.value)
    };
  };

  /**
   * Применяет объект настроек к UI
   * @param {Object} rawConfig
   */
  const applySettingsToUI = (rawConfig = {}, { preservePopupWidth = false } = {}) => {
    const config = normalizeSettings(rawConfig);
    const matchingWindPreset = Object.entries(WIND_PRESETS).find(([, values]) =>
      Object.entries(values).every(([key, value]) => Math.abs(config[key] - value) < 0.001)
    );
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
    elements.snowFluffiness.value = config.snowFluffiness;
    elements.snowFluffinessValue.textContent = Number(config.snowFluffiness).toFixed(2);
    elements.snowShape.value = config.snowShape;
    elements.gravity.value = config.gravity;
    elements.gravityValue.textContent = Number(config.gravity).toFixed(1);
    elements.airDensity.value = config.airDensity;
    elements.airDensityValue.textContent = Number(config.airDensity).toFixed(1);
    elements.snowminsize.value = config.snowminsize;
    elements.snowmaxsize.value = config.snowmaxsize;
    elements.minsizeValue.textContent = formatPercent(config.snowminsize);
    elements.maxsizeValue.textContent = formatPercent(config.snowmaxsize);
    updateSizePreview();
    elements.autoStart.checked = Boolean(config.autoStart);
    elements.rendererMode.value = config.rendererMode;
    update3dControlsVisibility();
    elements.snow3dThickness.value = config.snow3dThickness;
    elements.snow3dThicknessValue.textContent = config.snow3dThickness.toFixed(2);
    elements.gifCount.value = config.gifCount || 0;
    elements.gifCountValue.textContent = config.gifCount || 0;
    elements.sentenceCount.value = config.sentenceCount || 0;
    elements.sentenceCountValue.textContent = config.sentenceCount || 0;
    elements.mouseRadius.value = config.mouseRadius || 100;
    elements.mouseRadiusValue.textContent = config.mouseRadius || 100;
    if (!preservePopupWidth) {
      applyPopupWidthPercent(config.popupWidthPercent);
    }

    elements.windEnabled.checked = Boolean(config.windEnabled);
    elements.windPreset.value = matchingWindPreset?.[0] || 'custom';
    elements.windDirection.value = config.windDirection || 'left';
    elements.windStrength.value = config.windStrength;
    elements.windStrengthValue.textContent = Number(config.windStrength).toFixed(1);
    elements.windGustFrequency.value = config.windGustFrequency;
    elements.windGustFrequencyValue.textContent = Number(config.windGustFrequency).toFixed(1);
    elements.windGustStrength.value = config.windGustStrength;
    elements.windGustStrengthValue.textContent = Number(config.windGustStrength).toFixed(2);
    elements.turbulenceStrength.value = config.turbulenceStrength;
    elements.turbulenceStrengthValue.textContent = Number(config.turbulenceStrength).toFixed(2);
    elements.updraftStrength.value = config.updraftStrength;
    elements.updraftStrengthValue.textContent = Number(config.updraftStrength).toFixed(0);
    elements.windSettings.classList.toggle('wind-controls-disabled', !elements.windEnabled.checked);

    elements.colorsList.innerHTML = '';
    elements.symbolsList.innerHTML = '';
    elements.sentencesList.innerHTML = '';
    elements.gifsList.innerHTML = '';

    colors.forEach((color) => createColorItem(color, elements.colorsList, saveAllSettings));
    symbols.forEach((symbol, index) => createSymbolItem(
      symbol,
      elements.symbolsList,
      () => {
        elements.windPreset.value = 'custom';
        saveAllSettings();
      },
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
   * Сохраняет все настройки из UI в chrome.storage.
   * Пресет не перезаписывается: правки остаются черновиком, пока пользователь не сохранит их.
   */
  const saveAllSettings = async () => {
    const payload = buildSettingsPayload();
    const dirty = updatePresetDirtyState();
    await saveSettings({
      ...payload,
      [PRESET_DRAFT_STORAGE_KEY]: dirty ? activePresetId : ''
    });
    return payload;
  };

  // Загружаем сохраненные настройки
  const saved = await loadSettings([
    ...SETTINGS_KEYS,
    PRESETS_STORAGE_KEY,
    ACTIVE_PRESET_STORAGE_KEY,
    PRESET_DRAFT_STORAGE_KEY,
    SYMBOL_MODE_MIGRATION_KEY,
    BUILT_IN_PRESET_VERSION_KEY
  ]);

  const loadedPresets = Array.isArray(saved[PRESETS_STORAGE_KEY])
    ? saved[PRESETS_STORAGE_KEY]
        .filter((preset) => preset && typeof preset === 'object')
        .map((preset) => ({
          id: typeof preset.id === 'string' && preset.id.trim() ? preset.id : createPresetId(),
          name: typeof preset.name === 'string' && preset.name.trim() ? preset.name.trim() : t('presetNameFallback'),
          ...(typeof preset.builtInKey === 'string' ? { builtInKey: preset.builtInKey } : {}),
          settings: normalizePresetSettings(preset.settings),
          updatedAt: Number.isFinite(preset.updatedAt) ? preset.updatedAt : Date.now()
        }))
    : [];

  setupPopupWidthSliderBounds();
  const config = normalizeSettings(saved);
  const isFreshPresetList = loadedPresets.length === 0;
  presets = loadedPresets.length > 0
    ? loadedPresets
    : createBuiltInPresets(config, { createPresetObject, t });
  activePresetId = saved[ACTIVE_PRESET_STORAGE_KEY] || presets[0].id;

  const builtInPresetsNeedUpgrade = !Number.isInteger(saved[BUILT_IN_PRESET_VERSION_KEY])
    || saved[BUILT_IN_PRESET_VERSION_KEY] < BUILT_IN_PRESET_VERSION;
  const builtInPresetsChanged = mergeBuiltInPresetTemplates({
    replaceExisting: builtInPresetsNeedUpgrade && !isFreshPresetList,
    migrateLegacy: builtInPresetsNeedUpgrade && !isFreshPresetList
  });
  const activePreset = findPresetById(activePresetId) || presets[0];
  activePresetId = activePreset.id;
  if (builtInPresetsChanged || saved[BUILT_IN_PRESET_VERSION_KEY] !== BUILT_IN_PRESET_VERSION) {
    await persistPresets();
  }

  // One-time upgrade: earlier versions defaulted every new symbol to "text",
  // which made color emoji (🌄, 🦖) render as monochrome outlines.
  let symbolModesMigrated = false;
  if (!saved[SYMBOL_MODE_MIGRATION_KEY]) {
    const upgradeModes = (settings) => {
      if (!settings || !Array.isArray(settings.symbols)) return false;
      const modes = Array.isArray(settings.symbolModes) ? [...settings.symbolModes] : [];
      let changed = false;
      settings.symbols.forEach((symbol, index) => {
        if (modes[index] !== 'emoji' && detectSymbolMode(symbol) === 'emoji') {
          modes[index] = 'emoji';
          changed = true;
        }
      });
      if (changed) settings.symbolModes = modes;
      return changed;
    };
    presets.forEach((preset) => { symbolModesMigrated = upgradeModes(preset.settings) || symbolModesMigrated; });
    if (symbolModesMigrated) {
      await persistPresets();
    }
    await saveSettings({ [SYMBOL_MODE_MIGRATION_KEY]: 1 });
  }

  refreshPresetSelect();
  applyPopupWidthPercent(config.popupWidthPercent);
  applyPresetToUI(activePreset);
  // Restore unsaved edits from the previous popup session.
  if (saved[PRESET_DRAFT_STORAGE_KEY] && saved[PRESET_DRAFT_STORAGE_KEY] === activePresetId) {
    applySettingsToUI(config, { preservePopupWidth: true });
  }
  updatePresetDirtyState();
  if (symbolModesMigrated || builtInPresetsChanged) {
    await saveAllSettings();
  }

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
    const item = createSymbolItem(randomSymbol, elements.symbolsList, saveAllSettings, detectSymbolMode(randomSymbol));
    saveAllSettings();
    const input = item.querySelector('input[type="text"]');
    input?.focus();
    input?.select();
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

  const buildSnowConfig = (payload) => {
    if (payload.colors.length === 0 || (payload.symbols.length === 0 && payload.sentences.length === 0)) {
      return null;
    }
    return {
      snowmax: payload.snowmax,
      snowminsize: payload.snowminsize,
      snowmaxsize: payload.snowmaxsize,
      snowFluffiness: payload.snowFluffiness,
      snowShape: payload.snowShape,
      gravity: payload.gravity,
      airDensity: payload.airDensity,
      snowcolor: payload.colors,
      snowletters: payload.symbols.length > 0 ? payload.symbols : ['❄'],
      snowglyphmodes: payload.symbolModes && payload.symbolModes.length > 0
        ? payload.symbolModes
        : ['text'],
      snowsentences: payload.sentences,
      sentenceCount: payload.sentenceCount,
      gifUrls: payload.gifs,
      gifCount: payload.gifs.length > 0 ? payload.gifCount : 0,
      mouseRadius: payload.mouseRadius,
      windEnabled: payload.windEnabled,
      windDirection: payload.windDirection,
      windStrength: payload.windStrength,
      windGustFrequency: payload.windGustFrequency,
      windGustStrength: payload.windGustStrength,
      turbulenceStrength: payload.turbulenceStrength,
      updraftStrength: payload.updraftStrength,
      rendererMode: payload.rendererMode,
      snow3dThickness: payload.snow3dThickness
    };
  };

  // Re-renders a snowfall that is already running on the active tab; never starts a new one.
  const previewOnActiveTab = async () => {
    const config = buildSnowConfig(buildSettingsPayload());
    if (!config || !chrome?.tabs?.query || !chrome?.tabs?.sendMessage) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || isRestrictedTab(tab)) return;
      await chrome.tabs.sendMessage(tab.id, { action: 'previewSnow', config });
    } catch {
      // No content script on this tab — nothing is running, nothing to preview.
    }
  };

  const switchToPreset = async (presetId) => {
    const preset = findPresetById(presetId);
    if (!preset) return;
    activePresetId = preset.id;
    applyPresetToUI(preset);
    refreshPresetSelect();
    await saveAllSettings();
    await persistPresets();
    previewOnActiveTab();
    showToast(t('presetApplied'), 'success', { durationMs: 1400 });
  };

  /**
   * Asks what to do with unsaved edits of the active preset.
   * @returns {Promise<boolean>} false when the user cancelled the pending action
   */
  const resolveUnsavedChanges = async () => {
    const currentPreset = findPresetById(activePresetId);
    if (!currentPreset || !isPresetDirty()) return true;

    const { action, value } = await showChoiceDialog({
      title: t('presetUnsavedTitle'),
      message: t('presetUnsavedMessage').replace('{name}', currentPreset.name),
      input: {
        label: t('presetNewNameLabel'),
        value: `${currentPreset.name} (${t('presetCopySuffix')})`
      },
      actions: [
        { id: 'saveNew', label: t('presetUnsavedSaveNew'), variant: 'primary' },
        { id: 'overwrite', label: t('presetUnsavedOverwrite').replace('{name}', currentPreset.name) },
        { id: 'discard', label: t('presetUnsavedDiscard'), variant: 'danger' },
        { id: 'cancel', label: t('presetUnsavedCancel'), variant: 'ghost' }
      ]
    });

    if (action === 'saveNew') {
      const name = getPresetDisplayName(value, presets.length + 1);
      presets.push(createPresetObject(name, buildSettingsPayload()));
      await persistPresets();
      showToast(t('presetSaved'), 'success');
      return true;
    }
    if (action === 'overwrite') {
      currentPreset.settings = normalizePresetSettings(buildSettingsPayload());
      currentPreset.updatedAt = Date.now();
      markPresetBaseline();
      await persistPresets();
      showToast(t('presetUpdated'), 'success');
      return true;
    }
    return action === 'discard';
  };

  elements.presetSelect.addEventListener('change', async () => {
    const selectedId = elements.presetSelect.value;
    if (!findPresetById(selectedId) || selectedId === activePresetId) return;

    // Keep the previous preset visible while the user decides about unsaved edits.
    elements.presetSelect.value = activePresetId;
    if (!(await resolveUnsavedChanges())) {
      refreshPresetSelect();
      return;
    }
    await switchToPreset(selectedId);
  });

  elements.updatePreset?.addEventListener('click', async () => {
    const preset = findPresetById(activePresetId);
    if (!preset) return;
    preset.settings = normalizePresetSettings(await saveAllSettings());
    preset.updatedAt = Date.now();
    markPresetBaseline();
    await persistPresets();
    showToast(t('presetUpdated'), 'success');
  });

  elements.savePreset.addEventListener('click', async () => {
    const payload = await saveAllSettings();
    const rawName = elements.presetNameInput.value.trim();
    const defaultName = getPresetDisplayName(rawName, presets.length + 1);
    const preset = createPresetObject(rawName || defaultName, payload);

    presets.push(preset);
    activePresetId = preset.id;
    markPresetBaseline();
    refreshPresetSelect();
    await persistPresets();
    showToast(t('presetSaved'), 'success');
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
    showToast(t('presetRenamed'), 'success');
  });

  // Two-step delete instead of confirm(), which Firefox popups do not support.
  let deleteArmedTimer = null;
  const disarmDeletePreset = () => {
    clearTimeout(deleteArmedTimer);
    deleteArmedTimer = null;
    elements.deletePreset.classList.remove('confirm-armed');
    const label = elements.deletePreset.querySelector('span');
    if (label) label.textContent = t('deletePreset');
  };

  elements.deletePreset.addEventListener('click', async () => {
    const selectedId = elements.presetSelect.value;
    const selectedPreset = findPresetById(selectedId);

    if (!selectedPreset) {
      return;
    }

    if (!deleteArmedTimer) {
      elements.deletePreset.classList.add('confirm-armed');
      const label = elements.deletePreset.querySelector('span');
      if (label) label.textContent = t('confirmDeletePresetShort');
      deleteArmedTimer = setTimeout(disarmDeletePreset, DELETE_CONFIRM_WINDOW_MS);
      return;
    }
    disarmDeletePreset();

    presets = presets.filter((preset) => preset.id !== selectedId);

    if (presets.length === 0) {
      const payload = await saveAllSettings();
      const fallbackPreset = createPresetObject(t('presetDefaultName'), payload);
      presets = [fallbackPreset];
      activePresetId = fallbackPreset.id;
      applyPresetToUI(fallbackPreset);
    } else {
      activePresetId = presets[0].id;
      applyPresetToUI(presets[0]);
    }
    await saveAllSettings();

    refreshPresetSelect();
    await persistPresets();
    previewOnActiveTab();
    showToast(t('presetDeleted'), 'success');
  });

  elements.presetSelect.addEventListener('change', disarmDeletePreset);

  elements.restorePresetTemplates.addEventListener('click', async () => {
    if (!(await resolveUnsavedChanges())) return;

    const selectedIdBeforeRestore = elements.presetSelect.value;

    mergeBuiltInPresetTemplates({ replaceExisting: true });

    if (findPresetById(selectedIdBeforeRestore)) {
      activePresetId = selectedIdBeforeRestore;
    } else if (!findPresetById(activePresetId) && presets.length > 0) {
      activePresetId = presets[0].id;
    }

    refreshPresetSelect();

    const activePreset = findPresetById(activePresetId);
    if (activePreset) {
      applyPresetToUI(activePreset);
      await saveAllSettings();
    }

    await persistPresets();
    previewOnActiveTab();
  });

  // Автостарт
  elements.autoStart.addEventListener('change', () => {
    saveAllSettings();
  });
  elements.rendererMode.addEventListener('change', () => {
    update3dControlsVisibility();
    saveAllSettings();
  });

  // Экспорт настроек в JSON
  elements.exportSettings.addEventListener('click', async () => {
    const payload = await saveAllSettings();
    const transferAllPresets = Boolean(elements.transferAllPresets?.checked);
    const activePreset = findPresetById(activePresetId);
    const presetName = getPresetDisplayName(
      activePreset?.name || elements.presetNameInput.value,
      presets.indexOf(activePreset) + 1
    );
    const exportData = transferAllPresets
      ? {
          exportScope: 'all-presets',
          exportedAt: new Date().toISOString(),
          activePresetId,
          presets: presets.map((preset, index) => ({
            name: getPresetDisplayName(preset.name, index + 1),
            settings: normalizePresetSettings(preset.settings)
          }))
        }
      : {
          exportScope: 'single-preset',
          name: presetName,
          presetName,
          exportedAt: new Date().toISOString(),
          // What the user sees in the popup, including unsaved edits.
          settings: normalizePresetSettings(payload)
        };
    const data = JSON.stringify(exportData, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    const fileNamePart = transferAllPresets ? 'all-presets' : sanitizeFilenamePart(presetName);
    link.download = `let-it-snow-${fileNamePart}-${date}.json`;
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
      const importedPresets = extractImportedPresets(parsed, file.name);
      if (importedPresets.length === 0) {
        throw new Error('invalid_settings');
      }

      if (!(await resolveUnsavedChanges())) return;

      const createdPresets = importedPresets.map((importedPreset, index) => {
        return createPresetObject(
          getPresetDisplayName(importedPreset.name, presets.length + index + 1),
          importedPreset.settings
        );
      });

      presets.push(...createdPresets);
      activePresetId = createdPresets[createdPresets.length - 1].id;
      refreshPresetSelect();
      applyPresetToUI(createdPresets[createdPresets.length - 1]);
      await saveAllSettings();
      await persistPresets();
      previewOnActiveTab();
      showToast(t('settingsImported'), 'success');
    } catch (error) {
      console.error(error);
      showToast(t('errorImportSettings'), 'error', { durationMs: 5000 });
    } finally {
      elements.importSettingsInput.value = '';
    }
  });

  // Настройка слайдеров
  setupSliderListener(elements.snowmax, elements.snowmaxValue, saveAllSettings);
  setupSliderListener(
    elements.snow3dThickness,
    elements.snow3dThicknessValue,
    saveAllSettings,
    (value) => parseFloat(value).toFixed(2)
  );

  setupSliderListener(elements.snowFluffiness, elements.snowFluffinessValue, saveAllSettings, (value) => parseFloat(value).toFixed(2));
  setupSliderListener(elements.gravity, elements.gravityValue, saveAllSettings, (value) => parseFloat(value).toFixed(1));
  setupSliderListener(elements.airDensity, elements.airDensityValue, saveAllSettings, (value) => parseFloat(value).toFixed(1));
  setupSliderListener(elements.windGustStrength, elements.windGustStrengthValue, () => {
    elements.windPreset.value = 'custom';
    saveAllSettings();
  }, (value) => parseFloat(value).toFixed(2));
  setupSliderListener(elements.turbulenceStrength, elements.turbulenceStrengthValue, () => {
    elements.windPreset.value = 'custom';
    saveAllSettings();
  }, (value) => parseFloat(value).toFixed(2));
  setupSliderListener(elements.updraftStrength, elements.updraftStrengthValue, () => {
    elements.windPreset.value = 'custom';
    saveAllSettings();
  });
  elements.snowShape.addEventListener('change', saveAllSettings);

  setupSliderListener(elements.gifCount, elements.gifCountValue, saveAllSettings);
  
  setupSliderListener(elements.sentenceCount, elements.sentenceCountValue, saveAllSettings);

  setupSliderListener(elements.mouseRadius, elements.mouseRadiusValue, saveAllSettings);

  setupSliderListener(
    elements.popupWidth,
    elements.popupWidthValue,
    () => {
      applyPopupWidthPercent(elements.popupWidth.value);
      return saveAllSettings();
    },
    (val) => {
      const normalizedPercent = clampPopupWidthPercent(val);
      const widthPx = popupWidthPercentToPx(normalizedPercent);
      return formatPopupWidthValue(normalizedPercent, widthPx);
    }
  );

  // Слайдер минимального размера
  elements.snowminsize.addEventListener('input', () => {
    refreshPreviewViewportBaseSize().finally(() => {
      updateSizePreview();
    });
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
    refreshPreviewViewportBaseSize().finally(() => {
      updateSizePreview();
    });
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

  elements.windPreset.addEventListener('change', () => {
    const profile = WIND_PRESETS[elements.windPreset.value];
    if (!profile) return;
    for (const [key, value] of Object.entries(profile)) {
      elements[key].value = value;
      const valueDisplay = elements[`${key}Value`];
      if (valueDisplay) valueDisplay.textContent = key === 'windStrength'
        || key === 'windGustFrequency' ? Number(value).toFixed(1) : Number(value).toFixed(2);
    }
    elements.windSettings.classList.remove('wind-controls-disabled');
    elements.windEnabled.checked = true;
    saveAllSettings();
  });

  // Сила ветра
  setupSliderListener(
    elements.windStrength,
    elements.windStrengthValue,
    () => {
      elements.windPreset.value = 'custom';
      saveAllSettings();
    },
    (val) => parseFloat(val).toFixed(1)
  );

  // Частота порывов ветра
  setupSliderListener(
    elements.windGustFrequency,
    elements.windGustFrequencyValue,
    () => {
      elements.windPreset.value = 'custom';
      saveAllSettings();
    },
    (val) => parseFloat(val).toFixed(1)
  );

  // Инициализируем слушатель resize canvas для обновления превью
  setupCanvasResizeListener();

  /**
   * Запуск снегопада на активной вкладке
   */
  elements.startSnow.addEventListener('click', async () => {
    const payload = buildSettingsPayload();
    const colors = payload.colors;
    const symbols = payload.symbols;
    const sentences = payload.sentences;

    // Валидация
    if (colors.length === 0) {
      showToast(t('errorNoColor'), 'error');
      return;
    }
    if (symbols.length === 0 && sentences.length === 0) {
      showToast(t('errorNoSymbol'), 'error');
      return;
    }

    // Формируем конфигурацию
    const config = buildSnowConfig(payload);

    const startLabel = elements.startSnow.querySelector('span');
    const startIcon = elements.startSnow.querySelector('i');
    const originalLabel = startLabel?.textContent ?? '';
    const originalIconClass = startIcon?.className ?? '';
    const setStartState = (state) => {
      elements.startSnow.classList.remove('is-loading', 'is-success');
      elements.startSnow.disabled = state === 'loading';
      elements.startSnow.setAttribute('aria-busy', String(state === 'loading'));
      if (state === 'loading') {
        elements.startSnow.classList.add('is-loading');
        if (startIcon) startIcon.className = 'fas fa-spinner fa-spin';
        if (startLabel) startLabel.textContent = t('snowStarting');
      } else if (state === 'success') {
        elements.startSnow.classList.add('is-success');
        if (startIcon) startIcon.className = 'fas fa-check';
        if (startLabel) startLabel.textContent = t('snowStarted');
        setTimeout(() => setStartState('idle'), 1600);
      } else {
        if (startIcon) startIcon.className = originalIconClass;
        if (startLabel) startLabel.textContent = originalLabel;
      }
    };

    setStartState('loading');

    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      requestSnowSync('startSnow', config, tab?.id);

      // Проверка на системные страницы браузера
      if (isRestrictedTab(tab)) {
        setStartState('idle');
        showToast(t('errorChromePage'), 'error', { durationMs: 5000 });
        return;
      }

      await chrome.tabs.sendMessage(tab.id, { action: 'startSnow', config });
      setStartState('success');
    } catch (error) {
      // Попытка инъекции content script, если он не был загружен
      if (tab?.id && error.message?.includes('Receiving end does not exist')) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['index.js-loader.js']
          });
          await chrome.tabs.sendMessage(tab.id, { action: 'startSnow', config });
          setStartState('success');
        } catch {
          setStartState('idle');
          showToast(t('errorInject'), 'error', { durationMs: 5000 });
        }
      } else {
        console.error(error);
        setStartState('idle');
        showToast(`${t('errorGeneric')} ${error?.message || ''}`.trim(), 'error', { durationMs: 5000 });
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
      requestSnowSync('stopSnow', null, tab?.id);

      if (isRestrictedTab(tab)) {
        showToast(t('errorChromePage'), 'error', { durationMs: 5000 });
        return;
      }

      await chrome.tabs.sendMessage(tab.id, { action: 'stopSnow' });
      showToast(t('snowStopped'), 'info', { durationMs: 1800 });
    } catch (error) {
      if (!error.message?.includes('Receiving end does not exist')) {
        console.error(error);
      }
    }
  });
});
