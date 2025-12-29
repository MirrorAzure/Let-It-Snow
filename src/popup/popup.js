import './popup.css';

function t(key) {
  return chrome.i18n.getMessage(key) || key;
}

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('[data-i18n]').forEach(el => {
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

  document.querySelectorAll('input[type="text"]').forEach(input => {
    if (input.closest('#symbolsList')) {
      input.placeholder = t('placeholderSymbol');
    }
  });

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
    startSnow: document.getElementById('startSnow'),
    addColor: document.getElementById('addColor'),
    addSymbol: document.getElementById('addSymbol'),
    autoStart: document.getElementById('autoStart'),
    gifsList: document.getElementById('gifsList'),
    addGif: document.getElementById('addGif'),
    gifCount: document.getElementById('gifCount'),
    gifCountValue: document.getElementById('gifCountValue')
  };

  const saveSettings = async () => {
    const colors = Array.from(elements.colorsList.querySelectorAll('input[type="color"]')).map(i => i.value);
    const symbols = Array.from(elements.symbolsList.querySelectorAll('input[type="text"]')).map(i => i.value.trim()).filter(s => s !== '');
    const gifs = Array.from(elements.gifsList.querySelectorAll('input[type="url"]')).map(i => i.value.trim()).filter(s => s !== '');

    await chrome.storage.sync.set({
      snowmax: parseInt(elements.snowmax.value),
      sinkspeed: parseFloat(elements.sinkspeed.value),
      snowminsize: parseInt(elements.snowminsize.value),
      snowmaxsize: parseInt(elements.snowmaxsize.value),
      colors: colors.length > 0 ? colors : ['#ffffff'],
      symbols: symbols.length > 0 ? symbols : ['❄'],
      gifs,
      gifCount: parseInt(elements.gifCount.value) || 0,
      autoStart: elements.autoStart.checked
    });
  };

  const saved = await chrome.storage.sync.get([
    'snowmax', 'sinkspeed', 'snowminsize', 'snowmaxsize',
    'colors', 'symbols', 'autoStart', 'gifs', 'gifCount'
  ]);

  const defaults = {
    snowmax: 80,
    sinkspeed: 0.4,
    snowminsize: 15,
    snowmaxsize: 40,
    colors: ['#ffffff', '#4fc3f7', '#bbdefb', '#e1f5fe'],
    symbols: ['❄', '❅', '❆', '＊', '⋅', '✦'],
    gifs: [],
    gifCount: 0
  };

  const config = { ...defaults, ...saved };

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

  elements.colorsList.innerHTML = '';
  elements.symbolsList.innerHTML = '';
  elements.gifsList.innerHTML = '';
  config.colors.forEach(color => addColorItem(color));
  config.symbols.forEach(symbol => addSymbolItem(symbol));
  (config.gifs || []).forEach(gif => addGifItem(gif));

  if (elements.colorsList.children.length === 0) addColorItem('#ffffff');
  if (elements.symbolsList.children.length === 0) addSymbolItem('❄');
  if (elements.gifsList.children.length === 0) addGifItem('');

  function addColorItem(color = '#ffffff') {
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
    
    colorInput.addEventListener('input', () => {
      textInput.value = colorInput.value;
      saveSettings();
    });
    
    textInput.addEventListener('input', () => {
      if (/^#[0-9A-F]{6}$/i.test(textInput.value)) {
        colorInput.value = textInput.value;
        saveSettings();
      }
    });
    
    deleteBtn.addEventListener('click', () => {
      if (elements.colorsList.children.length > 1) {
        div.remove();
        saveSettings();
      } else {
        alert(t('errorNoColor'));
      }
    });
    
    elements.colorsList.appendChild(div);
  }

  function addSymbolItem(symbol = '❄') {
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
    
    textInput.addEventListener('input', () => {
      preview.textContent = textInput.value || '?';
      saveSettings();
    });
    
    deleteBtn.addEventListener('click', () => {
      if (elements.symbolsList.children.length > 1) {
        div.remove();
        saveSettings();
      } else {
        alert(t('errorNoSymbol'));
      }
    });
    
    elements.symbolsList.appendChild(div);
  }

  function addGifItem(url = '') {
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

    urlInput.addEventListener('input', () => {
      preview.src = urlInput.value;
      saveSettings();
    });

    deleteBtn.addEventListener('click', () => {
      div.remove();
      saveSettings();
    });

    elements.gifsList.appendChild(div);
  }

  elements.addColor.addEventListener('click', () => {
    const randomColor = '#' + Math.floor(Math.random()*16777215).toString(16);
    addColorItem(randomColor);
    saveSettings();
  });

  elements.autoStart.addEventListener('change', () => {
    saveSettings();
  });

  elements.addGif.addEventListener('click', () => {
    addGifItem('https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNWx1d29qYnYxODNyeXd2OTl1MGkxZHkwZWEwZDRqc2pkb2Y2b3hxdiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/vbQMBnrKxwmFH8gq3V/giphy.gif');
    saveSettings();
  });

  elements.addSymbol.addEventListener('click', () => {
    const symbols = ['❄', '❅', '❆', '＊', '⋅', '✦', '❋', '✧', '✶', '✴', '✳', '❇'];
    const randomSymbol = symbols[Math.floor(Math.random() * symbols.length)];
    addSymbolItem(randomSymbol);
    saveSettings();
  });

  elements.snowmax.addEventListener('input', () => {
    elements.snowmaxValue.textContent = elements.snowmax.value;
    saveSettings();
  });

  elements.sinkspeed.addEventListener('input', () => {
    elements.sinkspeedValue.textContent = parseFloat(elements.sinkspeed.value).toFixed(1);
    saveSettings();
  });

  elements.gifCount.addEventListener('input', () => {
    elements.gifCountValue.textContent = elements.gifCount.value;
    saveSettings();
  });

  elements.snowminsize.addEventListener('input', () => {
    if (parseInt(elements.snowminsize.value) >= parseInt(elements.snowmaxsize.value)) {
      elements.snowmaxsize.value = parseInt(elements.snowminsize.value) + 1;
      elements.maxsizeValue.textContent = elements.snowmaxsize.value;
    }
    elements.minsizeValue.textContent = elements.snowminsize.value;
    saveSettings();
  });

  elements.snowmaxsize.addEventListener('input', () => {
    if (parseInt(elements.snowmaxsize.value) <= parseInt(elements.snowminsize.value)) {
      elements.snowminsize.value = parseInt(elements.snowmaxsize.value) - 1;
      elements.minsizeValue.textContent = elements.snowminsize.value;
    }
    elements.maxsizeValue.textContent = elements.snowmaxsize.value;
    saveSettings();
  });

  elements.startSnow.addEventListener('click', async () => {
    const colors = Array.from(elements.colorsList.querySelectorAll('input[type="color"]')).map(i => i.value);
    const symbols = Array.from(elements.symbolsList.querySelectorAll('input[type="text"]')).map(i => i.value.trim()).filter(s => s !== '');
    const gifs = Array.from(elements.gifsList.querySelectorAll('input[type="url"]')).map(i => i.value.trim()).filter(s => s !== '');

    if (colors.length === 0) {
      alert(t('errorNoColor'));
      return;
    }
    if (symbols.length === 0) {
      alert(t('errorNoSymbol'));
      return;
    }

    const config = {
      snowmax: parseInt(elements.snowmax.value),
      sinkspeed: parseFloat(elements.sinkspeed.value),
      snowminsize: parseInt(elements.snowminsize.value),
      snowmaxsize: parseInt(elements.snowmaxsize.value),
      snowcolor: colors,
      snowletters: symbols,
      gifUrls: gifs,
      gifCount: gifs.length > 0 ? parseInt(elements.gifCount.value) || 0 : 0
    };

    const originalHtml = elements.startSnow.innerHTML;
    const originalBackground = elements.startSnow.style.background;
    elements.startSnow.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Запускаем волшебство...</span>';
    elements.startSnow.disabled = true;
    
    let blinkCount = 0;
    const blinkInterval = setInterval(() => {
      const colors = ['#ff6b6b', '#4fc3f7', '#66bb6a', '#ffa726'];
      elements.startSnow.style.background = `linear-gradient(135deg, ${colors[blinkCount % 4]}, ${colors[(blinkCount + 1) % 4]})`;
      blinkCount++;
    }, 200);

    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.id || tab.url.startsWith('chrome:')) {
        clearInterval(blinkInterval);
        elements.startSnow.innerHTML = originalHtml;
        elements.startSnow.disabled = false;
        elements.startSnow.style.background = originalBackground;
        alert(t('errorChromePage'));
        return;
      }

      await chrome.tabs.sendMessage(tab.id, { action: 'startSnow', config });
      
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
      
      if (error.message?.includes('Receiving end does not exist')) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          await chrome.tabs.sendMessage(tab.id, { action: 'startSnow', config });
          
          elements.startSnow.innerHTML = '<i class="fas fa-check"></i><span>Снегопад запущен!</span>';
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
