/**
 * Утилиты для работы с настройками расширения
 */

/**
 * Сохраняет настройки в chrome.storage
 * @param {Object} settings - Объект с настройками
 * @returns {Promise<void>}
 */
export async function saveSettings(settings) {
  await chrome.storage.sync.set(settings);
}

/**
 * Загружает настройки из chrome.storage
 * @param {string[]} keys - Массив ключей для загрузки
 * @returns {Promise<Object>} Объект с настройками
 */
export async function loadSettings(keys) {
  return await chrome.storage.sync.get(keys);
}

/**
 * Дефолтные настройки
 */
export const DEFAULT_SETTINGS = {
  snowmax: 80,
  sinkspeed: 0.4,
  snowminsize: 15,
  snowmaxsize: 40,
  colors: ['#ffffff', '#4fc3f7', '#bbdefb', '#e1f5fe'],
  symbols: ['❄', '❅', '❆', '＊', '⋅', '✦'],
  sentences: [],
  sentenceCount: 0,
  gifs: [],
  gifCount: 0,
  autoStart: false,
  windEnabled: false,
  windDirection: 'left', // 'left', 'right', 'random'
  windStrength: 0.5, // 0-1
  windGustFrequency: 3 // Частота порывов в секундах
};
