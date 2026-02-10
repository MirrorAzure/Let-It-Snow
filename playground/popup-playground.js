/**
 * Popup Playground - entry point для HMR
 * Импортирует исходный CSS и JS модули из src/popup для горячей перезагрузки
 */

// Импортируем CSS и JS модули из исходников для HMR
import '../src/popup/popup.css';
import { t, applyLocalization } from '../src/popup/localization.js';
import '../src/popup/settings.js';
import '../src/popup/ui-controllers.js';

// Интерактивная функциональность для playground
document.addEventListener('DOMContentLoaded', () => {
  applyLocalization();

  const colorsList = document.getElementById('colorsList');
  const symbolsList = document.getElementById('symbolsList');
  const sentencesList = document.getElementById('sentencesList');
  const gifsList = document.getElementById('gifsList');

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
  setupSlider('snowminsize', 'minsizeValue');
  setupSlider('snowmaxsize', 'maxsizeValue');
  setupSlider('gifCount', 'gifCountValue');

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
});

// Включаем HMR для hot reload
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log('🔄 Popup modules reloaded (CSS + JS)');
    location.reload(); // Перезагружаем страницу для применения изменений в JS
  });
}
