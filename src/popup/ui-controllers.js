/**
 * UI контроллеры для управления элементами настроек
 */

import { t } from './localization.js';
import { saveSettings } from './settings.js';

/**
 * Создает элемент цвета
 * @param {string} color - Цвет в формате HEX
 * @param {HTMLElement} container - Контейнер для добавления элемента
 * @param {Function} onSave - Callback для сохранения
 * @returns {HTMLElement}
 */
export function createColorItem(color, container, onSave) {
  const div = document.createElement('div');
  div.className = 'item';
  div.innerHTML = `
    <input type="color" value="${color}">
    <input type="text" class="color-text" value="${color}">
    <button type="button" title="${t('delete')}"><i class="fas fa-trash"></i></button>
  `;

  const colorInput = div.querySelector('input[type="color"]');
  const textInput = div.querySelector('.color-text');
  const deleteBtn = div.querySelector('button');

  // Синхронизация color picker и текстового поля
  colorInput.addEventListener('input', () => {
    textInput.value = colorInput.value;
    onSave();
  });

  textInput.addEventListener('input', () => {
    if (/^#[0-9A-F]{6}$/i.test(textInput.value)) {
      colorInput.value = textInput.value;
      onSave();
    }
  });

  // Удаление цвета
  deleteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (container.children.length > 1) {
      div.remove();
      onSave();
    } else {
      alert(t('errorNoColor'));
    }
  });

  container.appendChild(div);
  return div;
}

/**
 * Создает элемент символа
 * @param {string} symbol - Символ снежинки
 * @param {HTMLElement} container - Контейнер для добавления элемента
 * @param {Function} onSave - Callback для сохранения
 * @returns {HTMLElement}
 */
export function createSymbolItem(symbol, container, onSave) {
  const div = document.createElement('div');
  div.className = 'item';
  div.innerHTML = `
    <div class="symbol-preview">${symbol}</div>
    <input type="text" value="${symbol}" placeholder="${t('placeholderSymbol')}">
    <button type="button" title="${t('delete')}"><i class="fas fa-trash"></i></button>
  `;

  const preview = div.querySelector('.symbol-preview');
  const textInput = div.querySelector('input[type="text"]');
  const deleteBtn = div.querySelector('button');

  preview.style.fontSize = '24px';
  preview.style.width = '40px';
  preview.style.textAlign = 'center';

  // Обновление превью и автоудаление пустых
  textInput.addEventListener('input', () => {
    const currentValue = textInput.value.trim();
    preview.textContent = currentValue || '?';
    if (currentValue === '' && container.children.length > 1) {
      div.remove();
      onSave();
    } else if (currentValue !== '') {
      onSave();
    }
  });

  // Удаление символа
  deleteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (container.children.length > 1) {
      div.remove();
      onSave();
    } else {
      alert(t('errorNoSymbol'));
    }
  });

  container.appendChild(div);
  return div;
}

/**
 * Создает элемент GIF URL
 * @param {string} url - URL GIF изображения
 * @param {HTMLElement} container - Контейнер для добавления элемента
 * @param {Function} onSave - Callback для сохранения
 * @returns {HTMLElement}
 */
export function createGifItem(url, container, onSave) {
  const div = document.createElement('div');
  div.className = 'item gif-item';
  div.innerHTML = `
    <div class="gif-preview"><img src="${url}" alt="GIF preview"></div>
    <input type="url" class="gif-url" value="${url}" placeholder="${t('gifPlaceholder')}">
    <button type="button" title="${t('delete')}"><i class="fas fa-trash"></i></button>
  `;

  const preview = div.querySelector('.gif-preview img');
  const urlInput = div.querySelector('.gif-url');
  const deleteBtn = div.querySelector('button');

  // Обновление превью при изменении URL
  urlInput.addEventListener('input', () => {
    preview.src = urlInput.value;
    onSave();
  });

  // Удаление GIF
  deleteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    div.remove();
    onSave();
  });

  container.appendChild(div);
  return div;
}

/**
 * Настраивает слушатели для слайдеров
 * @param {HTMLElement} slider - Элемент слайдера
 * @param {HTMLElement} valueDisplay - Элемент для отображения значения
 * @param {Function} onSave - Callback для сохранения
 * @param {Function} formatter - Функция форматирования значения (опционально)
 */
export function setupSliderListener(slider, valueDisplay, onSave, formatter = null) {
  slider.addEventListener('input', () => {
    const value = formatter ? formatter(slider.value) : slider.value;
    valueDisplay.textContent = value;
    onSave();
  });
}
