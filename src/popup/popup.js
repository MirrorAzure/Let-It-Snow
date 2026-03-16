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
  setupSliderListener
} from './ui-controllers.js';

const SETTINGS_KEYS = [
  'snowmax',
  'sinkspeed',
  'snowminsize',
  'snowmaxsize',
  'colors',
  'symbols',
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

  const createPresetId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `preset-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  };

  const normalizeSettings = (rawConfig = {}) => {
    const config = { ...DEFAULT_SETTINGS, ...rawConfig };
    return {
      snowmax: Number.isFinite(config.snowmax) ? config.snowmax : DEFAULT_SETTINGS.snowmax,
      sinkspeed: Number.isFinite(config.sinkspeed) ? config.sinkspeed : DEFAULT_SETTINGS.sinkspeed,
      snowminsize: Number.isFinite(config.snowminsize)
        ? config.snowminsize
        : DEFAULT_SETTINGS.snowminsize,
      snowmaxsize: Number.isFinite(config.snowmaxsize)
        ? config.snowmaxsize
        : DEFAULT_SETTINGS.snowmaxsize,
      colors: Array.isArray(config.colors) && config.colors.length > 0
        ? config.colors
        : [...DEFAULT_SETTINGS.colors],
      symbols: Array.isArray(config.symbols) && config.symbols.length > 0
        ? config.symbols
        : [...DEFAULT_SETTINGS.symbols],
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

    const symbols = Array.from(
      elements.symbolsList.querySelectorAll('.item')
    )
      .map((item) => item.querySelector('input[type="text"]').value.trim())
      .filter((s) => s !== '');

    const sentences = Array.from(
      elements.sentencesList.querySelectorAll('.item')
    )
      .map((item) => item.querySelector('.sentence-text').value.trim())
      .filter((s) => s !== '');

    const gifs = Array.from(elements.gifsList.querySelectorAll('.item'))
      .map((item) => item.querySelector('input[type="url"]').value.trim())
      .filter((s) => s !== '');

    return {
      snowmax: parseInt(elements.snowmax.value),
      sinkspeed: parseFloat(elements.sinkspeed.value),
      snowminsize: parseInt(elements.snowminsize.value),
      snowmaxsize: parseInt(elements.snowmaxsize.value),
      colors: colors.length > 0 ? colors : ['#ffffff'],
      symbols: symbols.length > 0 ? symbols : ['❄'],
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
    const sentences = Array.isArray(config.sentences) ? config.sentences : [];
    const gifs = Array.isArray(config.gifs) ? config.gifs : [];

    elements.snowmax.value = config.snowmax;
    elements.snowmaxValue.textContent = config.snowmax;
    elements.sinkspeed.value = config.sinkspeed;
    elements.sinkspeedValue.textContent = parseFloat(config.sinkspeed).toFixed(1);
    elements.snowminsize.value = config.snowminsize;
    elements.snowmaxsize.value = config.snowmaxsize;
    elements.minsizeValue.textContent = config.snowminsize;
    elements.maxsizeValue.textContent = config.snowmaxsize;
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
    elements.windSettings.style.display = elements.windEnabled.checked ? 'block' : 'none';

    elements.colorsList.innerHTML = '';
    elements.symbolsList.innerHTML = '';
    elements.sentencesList.innerHTML = '';
    elements.gifsList.innerHTML = '';

    colors.forEach((color) => createColorItem(color, elements.colorsList, saveAllSettings));
    symbols.forEach((symbol) => createSymbolItem(symbol, elements.symbolsList, saveAllSettings));
    sentences.forEach((sentence) => createSentenceItem(sentence, elements.sentencesList, saveAllSettings));
    gifs.forEach((gif) => createGifItem(gif, elements.gifsList, saveAllSettings));

    if (elements.colorsList.children.length === 0) {
      createColorItem('#ffffff', elements.colorsList, saveAllSettings);
    }
    if (elements.symbolsList.children.length === 0) {
      createSymbolItem('❄', elements.symbolsList, saveAllSettings);
    }
    if (elements.gifsList.children.length === 0) {
      createGifItem('', elements.gifsList, saveAllSettings);
    }
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
    createSymbolItem(randomSymbol, elements.symbolsList, saveAllSettings);
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
    if (parseInt(elements.snowminsize.value) >= parseInt(elements.snowmaxsize.value)) {
      elements.snowmaxsize.value = parseInt(elements.snowminsize.value) + 1;
      elements.maxsizeValue.textContent = elements.snowmaxsize.value;
    }
    elements.minsizeValue.textContent = elements.snowminsize.value;
    saveAllSettings();
  });

  // Слайдер максимального размера
  elements.snowmaxsize.addEventListener('input', () => {
    if (parseInt(elements.snowmaxsize.value) <= parseInt(elements.snowminsize.value)) {
      elements.snowminsize.value = parseInt(elements.snowmaxsize.value) - 1;
      elements.minsizeValue.textContent = elements.snowminsize.value;
    }
    elements.maxsizeValue.textContent = elements.snowmaxsize.value;
    saveAllSettings();
  });

  // Включение/отключение ветра
  elements.windEnabled.addEventListener('change', () => {
    elements.windSettings.style.display = elements.windEnabled.checked ? 'block' : 'none';
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
