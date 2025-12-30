const target = 'let-it-snow-playground';

// Import content script with hot reload support
import { startSnow, stopSnow } from './content-script.js';

// HMR support indicator
if (import.meta.hot) {
  import.meta.hot.accept(['./content-script.js'], () => {
    console.log('🔄 Hot reload: content script updated');
  });
}

const els = {
  start: document.getElementById('start-btn'),
  stop: document.getElementById('stop-btn'),
  light: document.getElementById('light-btn'),
  dark: document.getElementById('dark-btn'),
  reset: document.getElementById('reset-btn'),
  snowmax: document.getElementById('snowmax'),
  sinkspeed: document.getElementById('sinkspeed'),
  snowminsize: document.getElementById('snowminsize'),
  snowmaxsize: document.getElementById('snowmaxsize'),
  gifs: document.getElementById('gifs'),
  gifCount: document.getElementById('gifCount'),
  colorsList: document.getElementById('colors-list'),
  colorText: document.getElementById('color-text'),
  colorPicker: document.getElementById('color-picker'),
  addColor: document.getElementById('add-color'),
  symbolsList: document.getElementById('symbols-list'),
  symbolInput: document.getElementById('symbol-input'),
  addSymbol: document.getElementById('add-symbol'),
  status: document.getElementById('status')
};

const defaults = {
  snowmax: 120,
  sinkspeed: 1.0,
  snowminsize: 18,
  snowmaxsize: 48,
  colors: ['#ffffff', '#b7e0ff', '#7dd3fc'],
  symbols: ['❄', '✺', '✴'],
  gifs: [],
  gifCount: 0
};

const state = {
  colors: [...defaults.colors],
  symbols: [...defaults.symbols],
  ready: false,
  pingAttempts: 0
};

function setStatus(mode, text) {
  els.status.textContent = text;
  els.status.classList.remove('status-wait', 'status-ready', 'status-missing');
  els.status.classList.add(`status-${mode}`);
}

function toLines(text) {
  return text
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function renderPills(el, items, { isColor = false, onRemove }) {
  el.innerHTML = '';
  items.forEach((item, idx) => {
    const pill = document.createElement('span');
    pill.className = 'pill';
    if (isColor) {
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = item;
      pill.appendChild(swatch);
    }
    const text = document.createElement('span');
    text.textContent = item;
    pill.appendChild(text);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onRemove(idx);
    });
    pill.appendChild(close);
    el.appendChild(pill);
  });
}

function renderColors() {
  renderPills(els.colorsList, state.colors, {
    isColor: true,
    onRemove: (idx) => {
      if (state.colors.length > 1) {
        state.colors.splice(idx, 1);
        renderColors();
      } else {
        alert('You must have at least one color');
      }
    }
  });
}

function renderSymbols() {
  renderPills(els.symbolsList, state.symbols, {
    onRemove: (idx) => {
      if (state.symbols.length > 1) {
        state.symbols.splice(idx, 1);
        renderSymbols();
      } else {
        alert('You must have at least one symbol');
      }
    }
  });
}

function addColor(value) {
  const val = (value || '').trim();
  if (!val) return;
  if (state.colors.includes(val)) return;
  state.colors.push(val);
  renderColors();
}

function addSymbol(value) {
  const val = (value || '').trim();
  if (!val) return;
  if (state.symbols.includes(val)) return;
  state.symbols.push(val);
  renderSymbols();
}

function getConfigFromForm() {
  const snowminsize = Number(els.snowminsize.value) || defaults.snowminsize;
  const snowmaxsize = Number(els.snowmaxsize.value) || defaults.snowmaxsize;
  const minSize = Math.min(snowminsize, snowmaxsize - 1);
  const maxSize = Math.max(snowmaxsize, minSize + 1);

  return {
    snowmax: Math.max(1, Math.min(400, Number(els.snowmax.value) || defaults.snowmax)),
    sinkspeed: Math.max(0.05, Math.min(2, Number(els.sinkspeed.value) || defaults.sinkspeed)),
    snowminsize: minSize,
    snowmaxsize: maxSize,
    snowcolor: state.colors.slice(0, 12),
    snowletters: state.symbols.slice(0, 12),
    gifUrls: toLines(els.gifs.value).slice(0, 10),
    gifCount: Math.max(0, Math.min(200, Number(els.gifCount.value) || defaults.gifCount))
  };
}

function post(action, config) {
  window.postMessage({ target, action, config }, '*');
}

function requestPing() {
  if (state.ready) return;
  state.pingAttempts += 1;
  setStatus('wait', 'Content script: waiting…');
  post('ping');
  if (state.pingAttempts >= 5) {
    setStatus('missing', 'Content script not detected — reload extension & page');
    return;
  }
  setTimeout(requestPing, 1000);
}

function setTheme(theme) {
  document.body.classList.toggle('theme-light', theme === 'light');
  document.body.classList.toggle('theme-dark', theme === 'dark');
  els.light.classList.toggle('active', theme === 'light');
  els.dark.classList.toggle('active', theme === 'dark');
}

function resetForm() {
  els.snowmax.value = defaults.snowmax;
  els.sinkspeed.value = defaults.sinkspeed;
  els.snowminsize.value = defaults.snowminsize;
  els.snowmaxsize.value = defaults.snowmaxsize;
  els.gifCount.value = defaults.gifCount;
  els.gifs.value = defaults.gifs.join('\n');
  state.colors = [...defaults.colors];
  state.symbols = [...defaults.symbols];
  renderColors();
  renderSymbols();
}

els.start.addEventListener('click', async () => {
  await startSnow(getConfigFromForm());
});

els.stop.addEventListener('click', () => {
  stopSnow();
});
els.light.addEventListener('click', () => setTheme('light'));
els.dark.addEventListener('click', () => setTheme('dark'));
els.reset.addEventListener('click', () => resetForm());

els.addColor.addEventListener('click', () => {
  addColor(els.colorText.value || els.colorPicker.value);
  els.colorText.value = '';
});

els.colorText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addColor(els.colorText.value);
    els.colorText.value = '';
  }
});

els.colorText.addEventListener('input', (e) => {
  const val = e.target.value.trim();
  if (/^#[0-9A-F]{6}$/i.test(val)) {
    els.colorPicker.value = val;
  }
});

els.colorPicker.addEventListener('input', (e) => {
  els.colorText.value = e.target.value;
});

els.addSymbol.addEventListener('click', () => {
  addSymbol(els.symbolInput.value);
  els.symbolInput.value = '';
});

els.symbolInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addSymbol(els.symbolInput.value);
    els.symbolInput.value = '';
  }
});

window.addEventListener('message', (event) => {
  const { target: tgt, action } = event.data || {};
  if (tgt !== target) return;
  if (action === 'ready' || action === 'pong') {
    state.ready = true;
    setStatus('ready', 'Content script: connected');
  }
});

resetForm();
setTheme('dark');

// Initialize - playground uses direct source import
setStatus('ready', 'Playground: ready - hot reload enabled');
