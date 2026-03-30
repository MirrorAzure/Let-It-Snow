/**
 * Popup Playground - entry point для HMR
 * Импортирует исходный CSS и JS модули из src/popup для горячей перезагрузки
 */

// Импортируем сообщения локализации
import ruMessages from '../src/_locales/ru/messages.json' assert { type: 'json' };

console.log('🔍 Debug: ruMessages imported:', ruMessages);
console.log('🔍 Debug: ruMessages.default:', ruMessages?.default);
console.log('🔍 Debug: ruMessages keys count:', Object.keys(ruMessages || {}).length);
console.log('🔍 Debug: Sample key "title":', ruMessages?.title);

// Флаг playground должен быть установлен ДО импорта popup.js
window.__IS_PLAYGROUND__ = true;

// Полифилл для Chrome Extension API в playground среде
if (!window.chrome) {
  window.chrome = {};
}

// Инициализируем chrome.i18n с поддержкой локализации
if (!window.chrome.i18n) {
  console.log('🔍 Debug: Initializing chrome.i18n...');
  console.log('🔍 Debug: ruMessages available?', !!ruMessages);
  console.log('🔍 Debug: typeof ruMessages:', typeof ruMessages);
  
  // Обрабатываем как прямой импорт, так и импорт с .default
  const messagesSource = ruMessages?.default || ruMessages;
  console.log('🔍 Debug: Using messagesSource:', !!messagesSource);
  console.log('🔍 Debug: messagesSource keys:', Object.keys(messagesSource || {}).length);
  
  // Преобразуем формат {key: {message: "text"}} в {key: "text"} синхронно
  const messages = {};
  let count = 0;
  
  if (messagesSource && typeof messagesSource === 'object') {
    Object.entries(messagesSource).forEach(([key, obj]) => {
      if (obj && obj.message) {
        messages[key] = obj.message;
        count++;
      }
    });
  }
  
  console.log(`✓ Loaded ${count} localization messages (synchronous)`);
  if (count > 0) {
    console.log('🔍 Debug: Sample message "title":', messages.title);
    console.log('🔍 Debug: Sample message "extenstionTitle":', messages.extenstionTitle);
  } else {
    console.warn('⚠️ No messages were loaded! This will cause localization warnings.');
    console.warn('⚠️ Attempting fallback: fetch messages from /src/_locales/ru/messages.json');
  }
  
  window.chrome.i18n = {
    messages: messages,
    getMessage: function(key) {
      const msg = this.messages[key];
      if (!msg) {
        console.warn(`⚠️ Missing localization key: "${key}"`);
      }
      return msg || key;
    },
    _loadingPromise: count > 0 
      ? Promise.resolve(messages)
      : fetch('/src/_locales/ru/messages.json')
          .then(res => res.json())
          .then(fetchedMessages => {
            console.log('✓ Fallback fetch successful');
            Object.entries(fetchedMessages).forEach(([key, obj]) => {
              if (obj && obj.message) {
                window.chrome.i18n.messages[key] = obj.message;
              }
            });
            console.log('✓ Loaded', Object.keys(window.chrome.i18n.messages).length, 'messages via fetch');
            return window.chrome.i18n.messages;
          })
          .catch(err => {
            console.error('❌ Fallback fetch failed:', err);
            return {};
          }),
    _isLoaded: count > 0
  };
  
  console.log('✓ chrome.i18n initialized with', Object.keys(window.chrome.i18n.messages).length, 'messages');
} else {
  // Если chrome.i18n уже существует, убедимся, что messages инициализирована
  if (!window.chrome.i18n.messages) {
    window.chrome.i18n.messages = {};
  }
  if (!window.chrome.i18n._loadingPromise) {
    window.chrome.i18n._loadingPromise = Promise.resolve({});
  }
}

// Инициализируем chrome.storage (локальное)
if (!window.chrome.storage) {
  window.chrome.storage = {
    sync: {
      set: async (settings) => {
        localStorage.setItem('snow-settings', JSON.stringify(settings));
        console.log('✓ Settings saved to localStorage');
      },
      get: async (keys) => {
        const stored = localStorage.getItem('snow-settings');
        if (stored) {
          return JSON.parse(stored);
        }
        return {};
      }
    }
  };
}

// Инициализируем chrome.runtime.getManifest()
if (!window.chrome.runtime) {
  window.chrome.runtime = {
    getManifest: () => ({
      version: '1.6.1'
    })
  };
}

// Инициализируем chrome.tabs (stub для playground)
if (!window.chrome.tabs) {
  window.chrome.tabs = {
    query: async (query) => {
      console.log('⚠️ chrome.tabs.query() не доступен в playground');
      return [];
    },
    sendMessage: async (tabId, message) => {
      console.log('⚠️ chrome.tabs.sendMessage() не доступен в playground');
    }
  };
}

// Инициализируем chrome.scripting (stub для playground)
if (!window.chrome.scripting) {
  window.chrome.scripting = {
    executeScript: async (args) => {
      console.log('⚠️ chrome.scripting.executeScript() не доступен в playground');
    }
  };
}

// Импортируем CSS и JS модули из исходников для HMR
import '../src/popup/popup.css';
import { t, applyLocalization } from '../src/popup/localization.js';
import '../src/popup/settings.js';
import '../src/popup/ui-controllers.js';
import '../src/popup/popup.js'; // Импортируем для побочных эффектов (но инициализация пропустится)

// Функция загрузки popup HTML из src
async function loadPopupHTML() {
  try {
    const response = await fetch('/src/popup/popup.html');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const html = await response.text();
    
    // Парсим HTML и извлекаем содержимое body
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const bodyContent = doc.body.innerHTML;
    
    // Вставляем в контейнер preview
    const popupPreview = document.getElementById('popupPreview');
    if (popupPreview) {
      popupPreview.innerHTML = bodyContent;
      console.log('✓ Popup HTML loaded from src/popup/popup.html');
      
      // Логируем все элементы с data-i18n для отладки
      const i18nElements = popupPreview.querySelectorAll('[data-i18n]');
      console.log(`📋 Found ${i18nElements.length} elements with data-i18n`);
      if (i18nElements.length > 0) {
        console.log('First few i18n keys:', Array.from(i18nElements).slice(0, 3).map(el => el.getAttribute('data-i18n')));
      }
      
      return true;
    }
  } catch (error) {
    console.error('❌ Error loading popup HTML:', error);
    const popupPreview = document.getElementById('popupPreview');
    if (popupPreview) {
      popupPreview.innerHTML = `
        <div class="loading-indicator" style="color: #ff6b6b;">
          <i class="fas fa-exclamation-triangle"></i>
          <p>Error loading: ${error.message}</p>
        </div>
      `;
    }
    return false;
  }
}

// Интерактивная функциональность для playground
async function initPlayground() {
  try {
    console.log('🚀 Initializing playground...');
    
    // Ждем загрузки локализации
    if (window.chrome.i18n && window.chrome.i18n._loadingPromise) {
      console.log('⏳ Waiting for localization...');
      await window.chrome.i18n._loadingPromise;
    }
    
    const messagesCount = (window.chrome.i18n && window.chrome.i18n.messages) 
      ? Object.keys(window.chrome.i18n.messages).length 
      : 0;
    console.log(`📦 Loaded messages count: ${messagesCount}`);
    
    // Сначала загружаем HTML
    console.log('📄 Loading popup HTML...');
    const loaded = await loadPopupHTML();
    if (!loaded) {
      throw new Error('Failed to load popup HTML');
    }
    
    console.log('🌍 Applying localization...');
    // Применяем локализацию после загрузки HTML
    applyLocalization();
    console.log('✅ Localization applied');

  // Инициализация переключения табов
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');
  
  console.log(`📑 Found ${tabButtons.length} tab buttons and ${tabContents.length} tab contents`);
  
  if (tabButtons.length === 0) {
    console.warn('⚠️ No tab buttons found! HTML might not be loaded correctly.');
  }

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetTab = button.dataset.tab;
      console.log(`📑 Switching to tab: ${targetTab}`);
      
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

  // Инициализация под-вкладок внутри вкладки настроек
  const subTabButtons = document.querySelectorAll('.sub-tab-button');
  const subTabContents = document.querySelectorAll('.sub-tab-content');

  console.log(`🧩 Found ${subTabButtons.length} sub-tab buttons and ${subTabContents.length} sub-tab contents`);

  subTabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetSubTab = button.dataset.subtab;
      console.log(`🧩 Switching to sub-tab: ${targetSubTab}`);

      subTabButtons.forEach(btn => btn.classList.remove('active'));
      subTabContents.forEach(content => content.classList.remove('active'));

      button.classList.add('active');
      const targetContent = document.getElementById(`subtab-${targetSubTab}`);
      if (targetContent) {
        targetContent.classList.add('active');
      }
    });
  });

  // Загружаем версию расширения
  const versionElement = document.getElementById('versionNumber');
  if (versionElement) {
    versionElement.textContent = '1.6.2';
  }

  const colorsList = document.getElementById('colorsList');
  const symbolsList = document.getElementById('symbolsList');
  const sentencesList = document.getElementById('sentencesList');
  const gifsList = document.getElementById('gifsList');
  const windEnabled = document.getElementById('windEnabled');
  const windSettings = document.getElementById('windSettings');
  const snowMinSize = document.getElementById('snowminsize');
  const snowMaxSize = document.getElementById('snowmaxsize');
  const minSizeValue = document.getElementById('minsizeValue');
  const maxSizeValue = document.getElementById('maxsizeValue');
  const sizePreviewMinFlake = document.getElementById('sizePreviewMinFlake');
  const sizePreviewMaxFlake = document.getElementById('sizePreviewMaxFlake');
  const sizePreviewMinMeta = document.getElementById('sizePreviewMinMeta');
  const sizePreviewMaxMeta = document.getElementById('sizePreviewMaxMeta');

  const SIZE_PERCENT_STEP = 0.1;
  const SIZE_PERCENT_MIN = Number(snowMinSize?.min) || 2;
  const SIZE_PERCENT_MAX = Number(snowMaxSize?.max) || 10;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const formatPercent = (value) => {
    const rounded = Math.round(Number(value) * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };
  const getPreviewViewportBase = () => {
    const width = Number(window?.screen?.width) || window.innerWidth || 1920;
    const height = Number(window?.screen?.height) || window.innerHeight || 1080;
    return Math.max(1, Math.min(width, height));
  };
  const updateSizePreview = () => {
    if (!snowMinSize || !snowMaxSize) return;

    const minPercent = Number(snowMinSize.value);
    const maxPercent = Number(snowMaxSize.value);
    const viewportBase = getPreviewViewportBase();
    const minPx = Math.max(1, Math.round((minPercent / 100) * viewportBase));
    const maxPx = Math.max(1, Math.round((maxPercent / 100) * viewportBase));

    if (minSizeValue) minSizeValue.textContent = formatPercent(minPercent);
    if (maxSizeValue) maxSizeValue.textContent = formatPercent(maxPercent);
    if (sizePreviewMinFlake) sizePreviewMinFlake.style.fontSize = `${clamp(minPx, 12, 44)}px`;
    if (sizePreviewMaxFlake) sizePreviewMaxFlake.style.fontSize = `${clamp(maxPx, 16, 56)}px`;
    if (sizePreviewMinMeta) sizePreviewMinMeta.textContent = `~${minPx}px`;
    if (sizePreviewMaxMeta) sizePreviewMaxMeta.textContent = `~${maxPx}px`;
  };

  // Обработчики для слайдеров
  const setupSlider = (sliderId, valueId, formatter = (v) => v) => {
    const slider = document.getElementById(sliderId);
    const valueDisplay = document.getElementById(valueId);
    
    if (slider && valueDisplay) {
      slider.addEventListener('input', (e) => {
        valueDisplay.textContent = formatter(e.target.value);
      });
    }
  };

  setupSlider('snowmax', 'snowmaxValue');
  setupSlider('sinkspeed', 'sinkspeedValue', (v) => parseFloat(v).toFixed(1));
  setupSlider('gifCount', 'gifCountValue');
  setupSlider('sentenceCount', 'sentenceCountValue');
  setupSlider('mouseRadius', 'mouseRadiusValue');

  if (windEnabled && windSettings) {
    windSettings.classList.toggle('wind-controls-disabled', !windEnabled.checked);
    windEnabled.addEventListener('change', () => {
      windSettings.classList.toggle('wind-controls-disabled', !windEnabled.checked);
    });
  }

  if (snowMinSize && snowMaxSize) {
    snowMinSize.addEventListener('input', () => {
      const minValue = Number(snowMinSize.value);
      const maxValue = Number(snowMaxSize.value);
      if (minValue >= maxValue) {
        snowMaxSize.value = clamp(minValue + SIZE_PERCENT_STEP, SIZE_PERCENT_MIN + SIZE_PERCENT_STEP, SIZE_PERCENT_MAX).toFixed(1);
      }
      updateSizePreview();
    });

    snowMaxSize.addEventListener('input', () => {
      const minValue = Number(snowMinSize.value);
      const maxValue = Number(snowMaxSize.value);
      if (maxValue <= minValue) {
        snowMinSize.value = clamp(maxValue - SIZE_PERCENT_STEP, SIZE_PERCENT_MIN, SIZE_PERCENT_MAX - SIZE_PERCENT_STEP).toFixed(1);
      }
      updateSizePreview();
    });

    updateSizePreview();
  }

  // Создание нового элемента цвета
  const createColorItem = () => {
    const item = document.createElement('div');
    item.className = 'item';
    const randomColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    item.innerHTML = `
      <input type="color" value="${randomColor}" title="${t('tooltipColorPicker')}">
      <input type="text" class="color-text" value="${randomColor}" readonly title="${t('tooltipColorHex')}">
      <button title="${t('delete')}"><i class="fas fa-trash"></i></button>
    `;
    
    const colorInput = item.querySelector('input[type="color"]');
    const textInput = item.querySelector('.color-text');
    colorInput.addEventListener('input', (e) => {
      textInput.value = e.target.value;
    });
    
    item.querySelector('button').addEventListener('click', () => {
      if (colorsList.children.length > 1) {
        item.remove();
      }
    });
    
    return item;
  };

  // Создание нового элемента символа
  const createSymbolItem = () => {
    const item = document.createElement('div');
    item.className = 'item';
    const symbols = ['❄', '⛄', '☃', '❅', '❆', '⛇', '🎄', '🎅', '🦌', '⭐'];
    const randomSymbol = symbols[Math.floor(Math.random() * symbols.length)];
    item.innerHTML = `
      <div class="symbol-preview">${randomSymbol}</div>
      <input type="text" value="${randomSymbol}" maxlength="3" title="${t('tooltipSymbolInput')}">
      <button title="${t('delete')}"><i class="fas fa-trash"></i></button>
    `;
    
    const textInput = item.querySelector('input[type="text"]');
    const preview = item.querySelector('.symbol-preview');
    textInput.addEventListener('input', (e) => {
      preview.textContent = e.target.value;
    });
    
    item.querySelector('button').addEventListener('click', () => {
      if (symbolsList.children.length > 1) {
        item.remove();
      }
    });
    
    return item;
  };

  // Создание нового элемента предложения
  const createSentenceItem = () => {
    const item = document.createElement('div');
    item.className = 'item sentence-item';
    const sentences = [
      'С Новым Годом!',
      'Счастливого Рождества!',
      'Пусть сбудутся мечты!',
      'Волшебного праздника!'
    ];
    const randomSentence = sentences[Math.floor(Math.random() * sentences.length)];
    item.innerHTML = `
      <input type="text" class="sentence-text" value="${randomSentence}" title="${t('tooltipSentenceInput')}">
      <button title="${t('delete')}"><i class="fas fa-trash"></i></button>
    `;
    
    item.querySelector('button').addEventListener('click', () => {
      item.remove();
    });
    
    return item;
  };

  // Создание нового элемента GIF
  const createGifItem = () => {
    const item = document.createElement('div');
    item.className = 'item gif-item';
    item.innerHTML = `
      <div class="gif-preview">
        <div class="gif-placeholder"><i class="fas fa-image"></i></div>
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
          <span class="gif-url-label">или введите URL</span>
          <input type="url" class="gif-url" placeholder="https://example.com/snow.gif" title="${t('tooltipGifUrlInput')}">
        </div>
      </div>
    `;
    
    const urlInput = item.querySelector('.gif-url');
    const previewContainer = item.querySelector('.gif-preview');
    const fileInput = item.querySelector('.gif-file-input');
    const fileBtn = item.querySelector('.gif-file-btn');
    const deleteBtn = item.querySelector('.delete-btn');
    
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
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && file.type === 'image/gif') {
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target.result;
          urlInput.value = dataUrl;
          updatePreview(dataUrl);
        };
        reader.readAsDataURL(file);
      } else {
        alert('Пожалуйста, выберите файл формата GIF.');
      }
    });
    
    // Обновление превью при изменении URL
    urlInput.addEventListener('input', (e) => {
      updatePreview(e.target.value);
    });
    
    // Удаление GIF
    deleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.remove();
    });
    
    return item;
  };

  // Кнопки добавления элементов
  const addColorBtn = document.getElementById('addColor');
  const addSymbolBtn = document.getElementById('addSymbol');
  const addSentenceBtn = document.getElementById('addSentence');
  const addGifBtn = document.getElementById('addGif');

  if (addColorBtn) {
    addColorBtn.addEventListener('click', () => {
      colorsList.appendChild(createColorItem());
    });
  }

  if (addSymbolBtn) {
    addSymbolBtn.addEventListener('click', () => {
      symbolsList.appendChild(createSymbolItem());
    });
  }

  if (addSentenceBtn) {
    addSentenceBtn.addEventListener('click', () => {
      sentencesList.appendChild(createSentenceItem());
    });
  }

  if (addGifBtn) {
    addGifBtn.addEventListener('click', () => {
      gifsList.appendChild(createGifItem());
    });
  }

  // Обработчики существующих кнопок удаления
  document.querySelectorAll('.item button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const item = e.target.closest('.item');
      const list = item.parentElement;
      if (list.children.length > 1 || list.id === 'sentencesList' || list.id === 'gifsList') {
        item.remove();
      }
    });
  });

  // Обработчики синхронизации цветов
  document.querySelectorAll('.item input[type="color"]').forEach(input => {
    const item = input.closest('.item');
    const textInput = item.querySelector('.color-text');
    if (textInput) {
      input.addEventListener('input', (e) => {
        textInput.value = e.target.value;
      });
    }
  });

  // Обработчики синхронизации символов
  document.querySelectorAll('.item input[type="text"]').forEach(input => {
    const item = input.closest('.item');
    const preview = item.querySelector('.symbol-preview');
    if (preview) {
      input.addEventListener('input', (e) => {
        preview.textContent = e.target.value;
      });
    }
  });

  // Контрольные кнопки playground
  const toggleColorsBtn = document.getElementById('toggleColors');
  const toggleSymbolsBtn = document.getElementById('toggleSymbols');
  const resetPreviewBtn = document.getElementById('resetPreview');

  if (toggleColorsBtn) {
    toggleColorsBtn.addEventListener('click', () => {
      colorsList.appendChild(createColorItem());
    });
  }

  if (toggleSymbolsBtn) {
    toggleSymbolsBtn.addEventListener('click', () => {
      symbolsList.appendChild(createSymbolItem());
    });
  }

  if (resetPreviewBtn) {
    resetPreviewBtn.addEventListener('click', () => {
      location.reload();
    });
  }

  // Кнопка запуска снегопада (визуальная обратная связь)
  const startSnowBtn = document.getElementById('startSnow');
  if (startSnowBtn) {
    startSnowBtn.addEventListener('click', function() {
      this.innerHTML = '<i class="fas fa-check-circle"></i><span>Снегопад запущен!</span>';
      this.style.background = 'linear-gradient(135deg, #66bb6a, #2e7d32)';
      
      setTimeout(() => {
        this.innerHTML = '<i class="fas fa-play-circle"></i><span>Запустить снегопад!</span>';
        this.style.background = 'linear-gradient(135deg, #ff6b6b, #c62828)';
      }, 2000);
    });
  }

  // Toggle для auto-start
  const autoStartCheckbox = document.getElementById('autoStart');
  if (autoStartCheckbox) {
    const toggleSwitch = autoStartCheckbox.nextElementSibling;
    if (toggleSwitch) {
      toggleSwitch.addEventListener('click', () => {
        autoStartCheckbox.checked = !autoStartCheckbox.checked;
      });
    }
  }
  
  console.log('🎉 Playground initialization complete!');
  } catch (err) {
    console.error('❌ Error during playground initialization:', err);
    throw err; // Пробросим ошибку дальше для обработки в catch блоке DOMContentLoaded
  }
}

// Запускаем инициализацию при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
  console.log('📋 DOM Content Loaded - starting playground init');
  initPlayground().catch(err => {
    console.error('❌ Playground initialization failed:', err);
    console.error('Stack:', err.stack);
    
    // Показываем ошибку в popup preview
    const popupPreview = document.getElementById('popupPreview');
    if (popupPreview) {
      popupPreview.innerHTML = `
        <div class="loading-indicator" style="color: #ff6b6b; padding: 40px 20px;">
          <i class="fas fa-exclamation-circle"></i>
          <h2>Initialization Error</h2>
          <p>${err.message}</p>
          <pre style="text-align: left; background: rgba(255,0,0,0.1); padding: 10px; border-radius: 5px; font-size: 11px; overflow-x: auto;">
${err.stack}
          </pre>
        </div>
      `;
    }
  });
});

// Включаем HMR для hot reload
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log('🔄 Popup modules reloaded (CSS + JS)');
    location.reload(); // Перезагружаем страницу для применения изменений в JS
  });
}
