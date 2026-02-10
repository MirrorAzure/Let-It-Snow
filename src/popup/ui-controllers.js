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
    <input type="color" value="${color}" title="${t('tooltipColorPicker')}">
    <input type="text" class="color-text" value="${color}" title="${t('tooltipColorHex')}">
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
    <input type="text" value="${symbol}" placeholder="${t('placeholderSymbol')}" title="${t('tooltipSymbolInput')}">
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
 * Создает элемент длинного предложения
 * @param {string} sentence - Длинное предложение
 * @param {HTMLElement} container - Контейнер для добавления элемента
 * @param {Function} onSave - Callback для сохранения
 * @returns {HTMLElement}
 */
export function createSentenceItem(sentence, container, onSave) {
  const div = document.createElement('div');
  div.className = 'item sentence-item';
  div.innerHTML = `
    <input type="text" class="sentence-text" value="${sentence}" placeholder="${t('placeholderSentence', 'Введите предложение...')}" title="${t('tooltipSentenceInput')}">
    <button type="button" title="${t('delete')}"><i class="fas fa-trash"></i></button>
  `;

  const textInput = div.querySelector('.sentence-text');
  const deleteBtn = div.querySelector('button');

  // Обновление при изменении текста
  textInput.addEventListener('input', () => {
    onSave();
  });

  // Удаление предложения
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
 * Создает элемент GIF URL
 * @param {string} url - URL GIF изображения или Data URL
 * @param {HTMLElement} container - Контейнер для добавления элемента
 * @param {Function} onSave - Callback для сохранения
 * @returns {HTMLElement}
 */
export function createGifItem(url, container, onSave) {
  const div = document.createElement('div');
  div.className = 'item gif-item';
  div.innerHTML = `
    <div class="gif-preview">
      ${url ? `<img src="${url}" alt="GIF preview">` : '<div class="gif-placeholder"><i class="fas fa-image"></i></div>'}
    </div>
    <div class="gif-controls">
      <div class="gif-buttons">
        <input type="file" accept="image/gif" class="gif-file-input" style="display: none;">
        <button type="button" class="gif-file-btn" title="${t('gifChooseFile')}">
          <i class="fas fa-folder-open"></i>
        </button>
        <button type="button" class="delete-btn" title="${t('delete')}"><i class="fas fa-trash"></i></button>
      </div>
      <div class="gif-url-row">
        <span class="gif-url-label">${t('gifFromUrl')}</span>
        <input type="url" class="gif-url" value="${url}" placeholder="${t('gifPlaceholder')}" title="${t('tooltipGifUrlInput')}">
      </div>
    </div>
  `;

  const previewContainer = div.querySelector('.gif-preview');
  const urlInput = div.querySelector('.gif-url');
  const fileInput = div.querySelector('.gif-file-input');
  const fileBtn = div.querySelector('.gif-file-btn');
  const deleteBtn = div.querySelector('.delete-btn');

  // Функция обновления превью
  const updatePreview = (src) => {
    if (src) {
      previewContainer.innerHTML = `<img src="${src}" alt="GIF preview">`;
    } else {
      previewContainer.innerHTML = '<div class="gif-placeholder"><i class="fas fa-image"></i></div>';
    }
  };

  // Открытие диалога выбора файла
  fileBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileInput.click();
  });

  // Обработка выбора файла
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'image/gif') {
      try {
        // Конвертируем файл в Data URL (base64)
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target.result;
          urlInput.value = dataUrl;
          updatePreview(dataUrl);
          onSave();
        };
        reader.readAsDataURL(file);
      } catch (error) {
        console.error('Ошибка чтения файла:', error);
        alert('Не удалось загрузить файл. Попробуйте другой GIF.');
      }
    } else {
      alert('Пожалуйста, выберите файл формата GIF.');
    }
  });

  // Обновление превью при изменении URL
  urlInput.addEventListener('input', () => {
    updatePreview(urlInput.value);
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
