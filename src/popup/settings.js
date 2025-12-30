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
  gifs: [],
  gifCount: 0,
  autoStart: false
};
