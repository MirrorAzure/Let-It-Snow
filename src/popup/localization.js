/**
 * Утилиты локализации для popup
 */

/**
 * Получает локализованную строку
 * @param {string} key - Ключ сообщения
 * @returns {string} Локализованная строка
 */
export function t(key) {
  const msg = chrome.i18n.getMessage(key);
  return msg || key;
}

/**
 * Применяет локализацию ко всем элементам с атрибутом data-i18n
 */
export function applyLocalization() {
  const i18nElements = document.querySelectorAll('[data-i18n]');
  
  // Логируем только в браузере (не в тестах)
  const isTestEnv = (typeof global !== 'undefined' && global.__TESTING__) || 
                    (typeof document !== 'undefined' && document.__TESTING__);
  
  if (!isTestEnv) {
    console.log(`🌍 Applying localization to ${i18nElements.length} elements`);
  }
  let successCount = 0;
  
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const message = t(key);

    // Если ключ не найден, пропускаем
    // (t() возвращает ключ, если chrome.i18n.getMessage() не находит сообщение)
    if (message === key) {
      return;
    }

    successCount++;
    
    // Если элемент не содержит дочерних элементов, просто устанавливаем текст
    if (el.children.length === 0) {
      el.textContent = message;
      return;
    }

    // Для элементов с дочерними элементами (как <h1><i>...</i> Text <i>...</i></h1>)
    // Нужно быть осторожнее с заменой текста
    let replaced = false;
    
    // Пытаемся заменить первый значимый текстовый узел
    for (let node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '') {
        node.textContent = message;
        replaced = true;
        break;
      }
    }

    // Если не нашли текстовый узел для замены, очищаем содержимое и добавляем в начало
    if (!replaced) {
      // Сохраняем первый дочерний элемент, если это иконка
      const firstChild = el.firstElementChild;
      
      // Удаляем все текстовые узлы  
      for (let node of Array.from(el.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
          node.remove();
        }
      }
      
      // Добавляем текст в начало
      if (firstChild) {
        firstChild.insertAdjacentText('beforebegin', message + ' ');
      } else {
        el.textContent = message;
      }
    }
  });
  
  if (!isTestEnv) {
    console.log(`✅ Localization applied successfully to ${successCount}/${i18nElements.length} elements`);
  }

  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    const message = t(key);
    if (message && message !== key) {
      el.setAttribute('title', message);
    }
  });

  // Применяем placeholder'ы к текстовым полям
  document.querySelectorAll('input[type="text"]').forEach((input) => {
    if (input.closest('#symbolsList')) {
      input.placeholder = t('placeholderSymbol');
    }
  });
}
