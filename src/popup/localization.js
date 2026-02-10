/**
 * Утилиты локализации для popup
 */

/**
 * Получает локализованную строку
 * @param {string} key - Ключ сообщения
 * @returns {string} Локализованная строка
 */
export function t(key) {
  return chrome.i18n.getMessage(key) || key;
}

/**
 * Применяет локализацию ко всем элементам с атрибутом data-i18n
 */
export function applyLocalization() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const message = t(key);

    if (el.children.length === 0) {
      el.textContent = message;
      return;
    }

    let replaced = false;
    for (let node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '') {
        node.textContent = message;
        replaced = true;
        break;
      }
    }

    if (!replaced) {
      el.prepend(document.createTextNode(message));
    }
  });

  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    const message = t(key);
    el.setAttribute('title', message);
  });

  // Применяем placeholder'ы к текстовым полям
  document.querySelectorAll('input[type="text"]').forEach((input) => {
    if (input.closest('#symbolsList')) {
      input.placeholder = t('placeholderSymbol');
    }
  });
}
