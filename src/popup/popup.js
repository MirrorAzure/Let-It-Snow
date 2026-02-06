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

/**
 * Инициализация popup при загрузке DOM
 */
document.addEventListener('DOMContentLoaded', async () => {
  // Применяем локализацию
  applyLocalization();

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
    startSnow: document.getElementById('startSnow'),
    addColor: document.getElementById('addColor'),
    addSymbol: document.getElementById('addSymbol'),
    addSentence: document.getElementById('addSentence'),
    autoStart: document.getElementById('autoStart'),
    gifsList: document.getElementById('gifsList'),
    addGif: document.getElementById('addGif'),
    gifCount: document.getElementById('gifCount'),
    gifCountValue: document.getElementById('gifCountValue')
  };

  /**
   * Сохраняет все настройки из UI в chrome.storage
   */
  const saveAllSettings = async () => {
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

    await saveSettings({
      snowmax: parseInt(elements.snowmax.value),
      sinkspeed: parseFloat(elements.sinkspeed.value),
      snowminsize: parseInt(elements.snowminsize.value),
      snowmaxsize: parseInt(elements.snowmaxsize.value),
      colors: colors.length > 0 ? colors : ['#ffffff'],
      symbols: symbols.length > 0 ? symbols : ['❄'],
      sentences: sentences,
      gifs,
      gifCount: parseInt(elements.gifCount.value) || 0,
      autoStart: elements.autoStart.checked
    });
  };

  // Загружаем сохраненные настройки
  const saved = await loadSettings([
    'snowmax',
    'sinkspeed',
    'snowminsize',
    'snowmaxsize',
    'colors',
    'symbols',
    'sentences',
    'autoStart',
    'gifs',
    'gifCount'
  ]);

  const config = { ...DEFAULT_SETTINGS, ...saved };

  // Устанавливаем значения в UI
  elements.snowmax.value = config.snowmax;
  elements.snowmaxValue.textContent = config.snowmax;
  elements.sinkspeed.value = config.sinkspeed;
  elements.sinkspeedValue.textContent = parseFloat(config.sinkspeed).toFixed(1);
  elements.snowminsize.value = config.snowminsize;
  elements.snowmaxsize.value = config.snowmaxsize;
  elements.minsizeValue.textContent = config.snowminsize;
  elements.maxsizeValue.textContent = config.snowmaxsize;
  elements.autoStart.checked = config.autoStart || false;
  elements.gifCount.value = config.gifCount || 0;
  elements.gifCountValue.textContent = config.gifCount || 0;

  // Очищаем списки и заполняем сохраненными значениями
  elements.colorsList.innerHTML = '';
  elements.symbolsList.innerHTML = '';
  elements.sentencesList.innerHTML = '';
  elements.gifsList.innerHTML = '';

  config.colors.forEach((color) =>
    createColorItem(color, elements.colorsList, saveAllSettings)
  );
  config.symbols.forEach((symbol) =>
    createSymbolItem(symbol, elements.symbolsList, saveAllSettings)
  );
  (config.sentences || []).forEach((sentence) =>
    createSentenceItem(sentence, elements.sentencesList, saveAllSettings)
  );
  (config.gifs || []).forEach((gif) =>
    createGifItem(gif, elements.gifsList, saveAllSettings)
  );

  // Минимум по одному элементу в каждом списке
  if (elements.colorsList.children.length === 0) {
    createColorItem('#ffffff', elements.colorsList, saveAllSettings);
  }
  if (elements.symbolsList.children.length === 0) {
    createSymbolItem('❄', elements.symbolsList, saveAllSettings);
  }
  if (elements.gifsList.children.length === 0) {
    createGifItem('', elements.gifsList, saveAllSettings);
  }

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

  // Автостарт
  elements.autoStart.addEventListener('change', () => {
    saveAllSettings();
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

  /**
   * Запуск снегопада на активной вкладке
   */
  elements.startSnow.addEventListener('click', async () => {
    const colors = Array.from(
      elements.colorsList.querySelectorAll('input[type="color"]')
    ).map((i) => i.value);

    const symbols = Array.from(
      elements.symbolsList.querySelectorAll('input[type="text"]')
    )
      .map((i) => i.value.trim())
      .filter((s) => s !== '');

    const sentences = Array.from(
      elements.sentencesList.querySelectorAll('.sentence-text')
    )
      .map((i) => i.value.trim())
      .filter((s) => s !== '');

    const gifs = Array.from(elements.gifsList.querySelectorAll('input[type="url"]'))
      .map((i) => i.value.trim())
      .filter((s) => s !== '');

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
      snowmax: parseInt(elements.snowmax.value),
      sinkspeed: parseFloat(elements.sinkspeed.value),
      snowminsize: parseInt(elements.snowminsize.value),
      snowmaxsize: parseInt(elements.snowmaxsize.value),
      snowcolor: colors,
      snowletters: symbols.length > 0 ? symbols : ['❄'],
      snowsentences: sentences,
      gifUrls: gifs,
      gifCount: gifs.length > 0 ? parseInt(elements.gifCount.value) || 0 : 0
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
      elements.startSnow.innerHTML = '<i class="fas fa-check"></i><span>Снегопад запущен!</span>';
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
            '<i class="fas fa-check"></i><span>Снегопад запущен!</span>';
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
});
