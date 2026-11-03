/**
 * UI контроллеры для управления элементами настроек
 */

import { t } from './localization.js';
import { saveSettings } from './settings.js';

const SYMBOL_MODE_TEXT = 'text';
const SYMBOL_MODE_EMOJI = 'emoji';
const SYMBOL_TEXT_FONT_STACK = '"Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", "Times New Roman", serif';
const SYMBOL_EMOJI_FONT_STACK = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

function normalizeSymbolMode(mode) {
  return mode === SYMBOL_MODE_EMOJI ? SYMBOL_MODE_EMOJI : SYMBOL_MODE_TEXT;
}

const EMOJI_PRESENTATION_RE = /\uFE0F|\u20E3|\p{Emoji_Presentation}|\p{Emoji_Modifier}|\p{Regional_Indicator}/u;
const TEXT_PRESENTATION_RE = /\uFE0E/u;

/**
 * Guesses how a symbol should be drawn: characters that are colored emoji by default
 * (🦖, 🌄, ❄️ with VS16) use the emoji font, everything else (❄, ★, letters) stays text.
 */
export function detectSymbolMode(symbol) {
  const text = String(symbol || '');
  if (!text.trim() || TEXT_PRESENTATION_RE.test(text)) return SYMBOL_MODE_TEXT;
  return EMOJI_PRESENTATION_RE.test(text) ? SYMBOL_MODE_EMOJI : SYMBOL_MODE_TEXT;
}

const TOAST_ICONS = {
  success: 'fa-check-circle',
  error: 'fa-exclamation-triangle',
  info: 'fa-info-circle'
};

/**
 * Non-blocking notification. Replaces alert(), which is unreliable in extension popups
 * (Firefox ignores it, Chrome may close the popup).
 */
export function showToast(message, type = 'info', { durationMs = 3200 } = {}) {
  if (typeof document === 'undefined' || !document.body) return null;
  let region = document.getElementById('toastRegion');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toastRegion';
    region.className = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  const kind = TOAST_ICONS[type] ? type : 'info';
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  const icon = document.createElement('i');
  icon.className = `fas ${TOAST_ICONS[kind]}`;
  const text = document.createElement('span');
  text.textContent = String(message ?? '');
  toast.append(icon, text);
  region.appendChild(toast);
  while (region.children.length > 3) region.firstElementChild.remove();
  const dismiss = () => {
    toast.classList.add('toast-leaving');
    setTimeout(() => toast.remove(), 250);
  };
  toast.addEventListener('click', dismiss);
  setTimeout(dismiss, durationMs);
  return toast;
}

/**
 * In-popup modal with several actions (confirm()/prompt() are unreliable in extension popups).
 * Resolves with { action, value }; action is null when dismissed (Escape / backdrop click).
 * @param {{title: string, message?: string, input?: {label?: string, value?: string},
 *   actions: Array<{id: string, label: string, variant?: 'primary'|'danger'|'ghost'}>}} options
 */
export function showChoiceDialog({ title, message = '', input = null, actions = [] }) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !document.body) {
      resolve({ action: null, value: '' });
      return;
    }
    document.getElementById('choiceDialog')?.remove();
    const previousFocus = document.activeElement;

    const backdrop = document.createElement('div');
    backdrop.id = 'choiceDialog';
    backdrop.className = 'choice-dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'choice-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'choiceDialogTitle');

    const heading = document.createElement('h4');
    heading.id = 'choiceDialogTitle';
    heading.textContent = title;
    dialog.appendChild(heading);
    if (message) {
      const text = document.createElement('p');
      text.textContent = message;
      dialog.appendChild(text);
    }

    let field = null;
    if (input) {
      const label = document.createElement('label');
      label.className = 'choice-dialog-field';
      if (input.label) {
        const caption = document.createElement('span');
        caption.textContent = input.label;
        label.appendChild(caption);
      }
      field = document.createElement('input');
      field.type = 'text';
      field.className = 'preset-name-input';
      field.value = input.value || '';
      field.maxLength = 80;
      label.appendChild(field);
      dialog.appendChild(label);
    }

    const buttons = document.createElement('div');
    buttons.className = 'choice-dialog-actions';
    const close = (action) => {
      document.removeEventListener('keydown', onKeyDown, true);
      backdrop.remove();
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      resolve({ action, value: field ? field.value.trim() : '' });
    };
    actions.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = item.id;
      button.className = `choice-dialog-btn choice-dialog-btn-${item.variant || 'ghost'}`;
      button.textContent = item.label;
      button.addEventListener('click', () => close(item.id));
      buttons.appendChild(button);
    });
    dialog.appendChild(buttons);

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
      } else if (event.key === 'Enter' && event.target === field && actions[0]) {
        event.preventDefault();
        close(actions[0].id);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close(null);
    });

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    (buttons.querySelector('.choice-dialog-btn-primary') || buttons.firstElementChild)?.focus();
  });
}

export function getSymbolFontStack(mode) {
  return mode === SYMBOL_MODE_EMOJI ? SYMBOL_EMOJI_FONT_STACK : SYMBOL_TEXT_FONT_STACK;
}

function renderSymbolPreview(previewCanvas, symbol, mode) {
  if (!previewCanvas || typeof previewCanvas.getContext !== 'function') return;

  const ctx = previewCanvas.getContext('2d');
  if (!ctx) return;

  const width = previewCanvas.width || 48;
  const height = previewCanvas.height || 48;
  const centerX = width * 0.5;
  const centerY = height * 0.56;
  const text = String(symbol || '').trim() || '❄';
  const renderMode = normalizeSymbolMode(mode);

  ctx.clearRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `normal ${Math.floor(height * 0.64)}px ${renderMode === SYMBOL_MODE_EMOJI ? SYMBOL_EMOJI_FONT_STACK : SYMBOL_TEXT_FONT_STACK}`;

  if (renderMode === SYMBOL_MODE_TEXT) {
    ctx.fillStyle = '#ffffff';
  }

  ctx.fillText(text, centerX, centerY);
}

function updateSymbolModeButton(button, mode) {
  const normalizedMode = normalizeSymbolMode(mode);
  button.dataset.mode = normalizedMode;
  button.textContent = normalizedMode === SYMBOL_MODE_EMOJI ? '🙂' : 'Aa';
  const title = normalizedMode === SYMBOL_MODE_EMOJI
    ? t('tooltipSymbolModeEmoji')
    : t('tooltipSymbolModeText');
  button.title = title;
  button.setAttribute('aria-label', title);
  button.setAttribute('aria-pressed', String(normalizedMode === SYMBOL_MODE_EMOJI));
}

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
    <input type="color" title="${t('tooltipColorPicker')}">
    <input type="text" class="color-text" spellcheck="false" maxlength="7" title="${t('tooltipColorHex')}">
    <button type="button" class="delete-btn" title="${t('delete')}" aria-label="${t('delete')}"><i class="fas fa-trash"></i></button>
  `;

  const colorInput = div.querySelector('input[type="color"]');
  const textInput = div.querySelector('.color-text');
  const deleteBtn = div.querySelector('button');
  colorInput.value = color;
  textInput.value = color;

  // Синхронизация color picker и текстового поля
  colorInput.addEventListener('input', () => {
    textInput.value = colorInput.value;
    textInput.classList.remove('input-invalid');
    onSave();
  });

  textInput.addEventListener('input', () => {
    const value = textInput.value.trim();
    const normalized = value.startsWith('#') ? value : `#${value}`;
    const valid = /^#[0-9A-F]{6}$/i.test(normalized);
    textInput.classList.toggle('input-invalid', value.length > 0 && !valid);
    if (valid) {
      colorInput.value = normalized.toLowerCase();
      onSave();
    }
  });

  textInput.addEventListener('blur', () => {
    textInput.value = colorInput.value;
    textInput.classList.remove('input-invalid');
  });

  // Удаление цвета
  deleteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (container.children.length > 1) {
      div.remove();
      onSave();
    } else {
      showToast(t('errorNoColor'), 'error');
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
export function createSymbolItem(symbol, container, onSave, mode = SYMBOL_MODE_TEXT) {
  const initialMode = normalizeSymbolMode(mode);
  const div = document.createElement('div');
  div.className = 'item symbol-item';
  div.innerHTML = `
    <canvas class="symbol-preview" width="48" height="48" aria-hidden="true"></canvas>
    <input type="text" class="symbol-text" spellcheck="false" autocomplete="off" placeholder="${t('placeholderSymbol')}" title="${t('tooltipSymbolInput')}" aria-label="${t('tooltipSymbolInput')}">
    <button type="button" class="symbol-mode-btn">Aa</button>
    <button type="button" class="delete-btn" title="${t('delete')}" aria-label="${t('delete')}"><i class="fas fa-trash"></i></button>
  `;

  const preview = div.querySelector('.symbol-preview');
  const textInput = div.querySelector('input[type="text"]');
  const modeBtn = div.querySelector('.symbol-mode-btn');
  const deleteBtn = div.querySelector('.delete-btn');
  textInput.value = symbol;

  div.dataset.symbolMode = initialMode;
  updateSymbolModeButton(modeBtn, initialMode);
  renderSymbolPreview(preview, symbol, initialMode);

  const removeItem = () => {
    if (container.children.length > 1) {
      div.remove();
      onSave();
      return true;
    }
    showToast(t('errorNoSymbol'), 'error');
    return false;
  };

  // Clearing the field to type a replacement must not delete the row; empty rows are
  // dropped only when the field loses focus.
  textInput.addEventListener('input', () => {
    const currentValue = textInput.value.trim();
    if (currentValue && div.dataset.modeLocked !== '1') {
      const detected = detectSymbolMode(currentValue);
      if (detected !== div.dataset.symbolMode) {
        div.dataset.symbolMode = detected;
        updateSymbolModeButton(modeBtn, detected);
      }
    }
    renderSymbolPreview(preview, currentValue || '❄', div.dataset.symbolMode || SYMBOL_MODE_TEXT);
    if (currentValue !== '') {
      onSave();
    }
  });

  textInput.addEventListener('blur', () => {
    if (textInput.value.trim() !== '') return;
    if (!removeItem()) {
      textInput.value = '❄';
      renderSymbolPreview(preview, '❄', div.dataset.symbolMode);
      onSave();
    }
  });

  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      textInput.blur();
    }
  });

  modeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const currentMode = normalizeSymbolMode(div.dataset.symbolMode);
    const nextMode = currentMode === SYMBOL_MODE_TEXT ? SYMBOL_MODE_EMOJI : SYMBOL_MODE_TEXT;
    div.dataset.symbolMode = nextMode;
    div.dataset.modeLocked = '1';
    updateSymbolModeButton(modeBtn, nextMode);
    renderSymbolPreview(preview, textInput.value.trim() || '❄', nextMode);
    onSave();
  });

  // Удаление символа
  deleteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    removeItem();
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
    <input type="text" class="sentence-text" placeholder="${t('placeholderSentence')}" title="${t('tooltipSentenceInput')}">
    <button type="button" class="delete-btn" title="${t('delete')}" aria-label="${t('delete')}"><i class="fas fa-trash"></i></button>
  `;

  const textInput = div.querySelector('.sentence-text');
  const deleteBtn = div.querySelector('button');
  textInput.value = sentence;

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
    <div class="gif-preview"></div>
    <div class="gif-controls">
      <input type="url" class="gif-url" placeholder="${t('gifPlaceholder')}" title="${t('tooltipGifUrlInput')}" aria-label="${t('tooltipGifUrlInput')}">
      <div class="gif-buttons">
        <input type="file" accept="image/gif" class="gif-file-input" hidden>
        <button type="button" class="gif-file-btn" title="${t('gifChooseFile')}">
          <i class="fas fa-folder-open"></i>
          <span>${t('gifChooseFile')}</span>
        </button>
        <button type="button" class="delete-btn" title="${t('delete')}" aria-label="${t('delete')}"><i class="fas fa-trash"></i></button>
      </div>
    </div>
  `;

  const previewContainer = div.querySelector('.gif-preview');
  const urlInput = div.querySelector('.gif-url');
  const fileInput = div.querySelector('.gif-file-input');
  const fileBtn = div.querySelector('.gif-file-btn');
  const deleteBtn = div.querySelector('.delete-btn');
  urlInput.value = url;

  // Функция обновления превью
  const updatePreview = (src) => {
    previewContainer.replaceChildren();
    if (src) {
      const img = document.createElement('img');
      img.alt = 'GIF preview';
      img.src = src;
      previewContainer.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'gif-placeholder';
      placeholder.innerHTML = '<i class="fas fa-image"></i>';
      previewContainer.appendChild(placeholder);
    }
  };
  updatePreview(url);

  // Открытие диалога выбора файла
  fileBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileInput.click();
  });

  // Обработка выбора файла
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type !== 'image/gif') {
      showToast(t('errorGifType'), 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target.result;
      urlInput.value = dataUrl;
      updatePreview(dataUrl);
      onSave();
    };
    reader.onerror = () => {
      console.error('Ошибка чтения файла:', reader.error);
      showToast(t('errorGifRead'), 'error');
    };
    reader.readAsDataURL(file);
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
