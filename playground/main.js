const target = 'let-it-snow-playground';

// Import content script with hot reload support
import { startSnow, stopSnow } from './content-script.js';
import { normalizeGlyphSizePercentRange } from '../src/content/utils/size-utils.js';

// HMR support indicator
if (import.meta.hot) {
  import.meta.hot.accept(['./content-script.js'], () => {
    console.log('🔄 Hot reload: content script updated');
  });
}

function parseSnowShapeOverrides(text) {
  const raw = text.trim();
  if (!raw) return [];
  let overrides;
  try {
    overrides = JSON.parse(raw);
  } catch {
    throw new Error('Per-flake shape overrides must be valid JSON.');
  }
  if (!Array.isArray(overrides) || overrides.length > 320) {
    throw new Error('Per-flake shape overrides must be an array of at most 320 entries.');
  }
  if (overrides.some((shape) => shape !== null && !['auto', 'compact', 'regular', 'lacy'].includes(shape))) {
    throw new Error('Each override must be null, "auto", "compact", "regular", or "lacy".');
  }
  return overrides;
}

const els = {
  start: document.getElementById('start-btn'),
  stop: document.getElementById('stop-btn'),
  light: document.getElementById('light-btn'),
  dark: document.getElementById('dark-btn'),
  reset: document.getElementById('reset-btn'),
  debug: document.getElementById('debug-btn'),
  snowmax: document.getElementById('snowmax'),
  snowminsize: document.getElementById('snowminsize'),
  snowmaxsize: document.getElementById('snowmaxsize'),
  snowFluffiness: document.getElementById('snowFluffiness'),
  snowShape: document.getElementById('snowShape'),
  snowShapeOverrides: document.getElementById('snowShapeOverrides'),
  gravity: document.getElementById('gravity'),
  airDensity: document.getElementById('airDensity'),
  gifs: document.getElementById('gifs'),
  gifCount: document.getElementById('gifCount'),
  mouseRadius: document.getElementById('mouseRadius'),
  sentenceCount: document.getElementById('sentenceCount'),
  colorsList: document.getElementById('colors-list'),
  colorText: document.getElementById('color-text'),
  colorPicker: document.getElementById('color-picker'),
  addColor: document.getElementById('add-color'),
  symbolsList: document.getElementById('symbols-list'),
  symbolInput: document.getElementById('symbol-input'),
  addSymbol: document.getElementById('add-symbol'),
  sentencesList: document.getElementById('sentences-list'),
  sentenceInput: document.getElementById('sentence-input'),
  addSentence: document.getElementById('add-sentence'),
  status: document.getElementById('status'),
  windEnabled: document.getElementById('windEnabled'),
  windLeft: document.getElementById('wind-left'),
  windRight: document.getElementById('wind-right'),
  windRandom: document.getElementById('wind-random'),
  windStrength: document.getElementById('windStrength'),
  windGustFrequency: document.getElementById('windGustFrequency'),
  windGustStrength: document.getElementById('windGustStrength'),
  turbulenceStrength: document.getElementById('turbulenceStrength'),
  updraftStrength: document.getElementById('updraftStrength'),
  rendererAuto: document.getElementById('renderer-auto'),
  rendererWebgpu: document.getElementById('renderer-webgpu'),
  renderer2d: document.getElementById('renderer-2d'),
  renderer3d: document.getElementById('renderer-3d'),
  minGlowStrength: document.getElementById('minGlowStrength'),
  minGlowStrengthValue: document.getElementById('minGlowStrengthValue'),
  snow3dThickness: document.getElementById('snow3dThickness'),
  snow3dThicknessValue: document.getElementById('snow3dThicknessValue'),
  sizePreviewText: document.getElementById('size-preview-text'),
  sizePreviewMinFlake: document.getElementById('size-preview-min-flake'),
  sizePreviewMaxFlake: document.getElementById('size-preview-max-flake'),
  sizePreviewMinMeta: document.getElementById('size-preview-min-meta'),
  sizePreviewMaxMeta: document.getElementById('size-preview-max-meta'),
  sizePreviewGlyphPicker: document.getElementById('size-preview-glyph-picker')
};

const defaults = {
  snowmax: 120,
  snowminsize: 2.0,
  snowmaxsize: 4.0,
  snowFluffiness: 0.3,
  snowShape: 'auto',
  snowShapeOverrides: [],
  gravity: 9.81,
  airDensity: 1.2,
  colors: ['#ffffff', '#b7e0ff', '#7dd3fc'],
  symbols: ['❄', '✺', '✴'],
  sentences: [],
  sentenceCount: 0,
  gifs: [],
  gifCount: 0,
  mouseRadius: 100,
  debugCollisions: false,
  windEnabled: false,
  windDirection: 'left',
  windStrength: 0.5,
  windGustFrequency: 3,
  windGustStrength: 0.35,
  turbulenceStrength: 0.2,
  updraftStrength: 0,
  rendererMode: 'auto',
  minGlowStrength: 0.42,
  snow3dThickness: 0.07
};

const state = {
  colors: [...defaults.colors],
  symbols: [...defaults.symbols],
  sentences: [...defaults.sentences],
  debugCollisions: defaults.debugCollisions,
  windEnabled: defaults.windEnabled,
  windDirection: defaults.windDirection,
  ready: false,
  pingAttempts: 0,
  rendererMode: defaults.rendererMode
};

const SIZE_PERCENT_MIN = Number(els.snowminsize.min) || 2;
const SIZE_PERCENT_MAX = Number(els.snowmaxsize.max) || 10;
const SIZE_PERCENT_STEP = Number(els.snowminsize.step) || 0.1;
const GLYPH_VISUAL_SCALE = 0.84;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const readNumber = (input, fallback) => {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
};
const getViewportBaseSize = () => {
  const width = Number(window?.innerWidth) || 1920;
  const height = Number(window?.innerHeight) || 1080;
  return Math.max(1, Math.min(width, height));
};
const formatPercent = (value) => {
  const rounded = Math.round(Number(value) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

function normalizeSizePercentRange(rawMin, rawMax) {
  const viewportBase = getViewportBaseSize();
  const normalized = normalizeGlyphSizePercentRange(rawMin, rawMax, viewportBase);
  let minPercent = clamp(normalized.minPercent, SIZE_PERCENT_MIN, SIZE_PERCENT_MAX);
  let maxPercent = clamp(normalized.maxPercent, SIZE_PERCENT_MIN + SIZE_PERCENT_STEP, SIZE_PERCENT_MAX);

  if (maxPercent <= minPercent) {
    maxPercent = clamp(minPercent + SIZE_PERCENT_STEP, SIZE_PERCENT_MIN + SIZE_PERCENT_STEP, SIZE_PERCENT_MAX);
    if (maxPercent <= minPercent) {
      minPercent = clamp(maxPercent - SIZE_PERCENT_STEP, SIZE_PERCENT_MIN, SIZE_PERCENT_MAX - SIZE_PERCENT_STEP);
    }
  }

  return { minPercent, maxPercent };
}

let previewGlyph = defaults.symbols[0] || '❄';

function refreshGlyphPicker() {
  if (!els.sizePreviewGlyphPicker) return;

  const symbols = state.symbols.filter(Boolean);
  if (symbols.length === 0) {
    previewGlyph = '❄';
  } else if (!symbols.includes(previewGlyph)) {
    previewGlyph = symbols[0];
  }

  els.sizePreviewGlyphPicker.innerHTML = '';
  symbols.forEach((symbol) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'glyph-chip' + (symbol === previewGlyph ? ' active' : '');
    chip.textContent = symbol;
    chip.addEventListener('click', () => {
      previewGlyph = symbol;
      els.sizePreviewGlyphPicker.querySelectorAll('.glyph-chip').forEach((node) => node.classList.remove('active'));
      chip.classList.add('active');
      updateSizePreview();
    });
    els.sizePreviewGlyphPicker.appendChild(chip);
  });
}

function updateSizePreview() {
  if (!els.sizePreviewText) return;
  const { minPercent, maxPercent } = normalizeSizePercentRange(els.snowminsize.value, els.snowmaxsize.value);
  const viewportBase = getViewportBaseSize();
  const minPx = Math.max(0.1, (minPercent / 100) * viewportBase);
  const maxPx = Math.max(0.1, (maxPercent / 100) * viewportBase);
  const minGlyphPx = Math.max(0.1, minPx * GLYPH_VISUAL_SCALE);
  const maxGlyphPx = Math.max(0.1, maxPx * GLYPH_VISUAL_SCALE);
  const formatPx = (value) => {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };

  if (els.sizePreviewMinFlake) {
    els.sizePreviewMinFlake.textContent = previewGlyph;
    els.sizePreviewMinFlake.style.fontSize = `${minGlyphPx.toFixed(2)}px`;
  }
  if (els.sizePreviewMaxFlake) {
    els.sizePreviewMaxFlake.textContent = previewGlyph;
    els.sizePreviewMaxFlake.style.fontSize = `${maxGlyphPx.toFixed(2)}px`;
  }
  if (els.sizePreviewMinMeta) {
    els.sizePreviewMinMeta.textContent = `~${formatPx(minGlyphPx)}px`;
  }
  if (els.sizePreviewMaxMeta) {
    els.sizePreviewMaxMeta.textContent = `~${formatPx(maxGlyphPx)}px`;
  }

  els.sizePreviewText.textContent = `Approx: ${formatPx(minPx)}px - ${formatPx(maxPx)}px (${formatPercent(minPercent)}% - ${formatPercent(maxPercent)}%)`;
}

function setStatus(mode, text) {
  els.status.textContent = text;
  els.status.classList.remove('status-wait', 'status-ready', 'status-missing', 'status-error');
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
  refreshGlyphPicker();
  updateSizePreview();
}

function renderSentences() {
  renderPills(els.sentencesList, state.sentences, {
    onRemove: (idx) => {
      state.sentences.splice(idx, 1);
      renderSentences();
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

function addSentence(value) {
  const val = (value || '').trim();
  if (!val) return;
  if (state.sentences.includes(val)) return;
  state.sentences.push(val);
  renderSentences();
}

function getConfigFromForm() {
  const { minPercent: minSize, maxPercent: maxSize } = normalizeSizePercentRange(
    els.snowminsize.value,
    els.snowmaxsize.value
  );

  return {
    snowmax: Math.max(1, Math.min(400, Number(els.snowmax.value) || defaults.snowmax)),
    snowminsize: minSize,
    snowmaxsize: maxSize,
    snowFluffiness: clamp(readNumber(els.snowFluffiness, defaults.snowFluffiness), 0, 1),
    snowShape: els.snowShape.value,
    snowShapeOverrides: parseSnowShapeOverrides(els.snowShapeOverrides.value),
    gravity: clamp(readNumber(els.gravity, defaults.gravity), 0, 20),
    airDensity: clamp(readNumber(els.airDensity, defaults.airDensity), 0.4, 2),
    snowcolor: state.colors.slice(0, 12),
    snowletters: state.symbols.slice(0, 12),
    snowsentences: state.sentences.slice(0, 12),
    sentenceCount: Math.max(0, Math.min(80, Number(els.sentenceCount.value) || defaults.sentenceCount)),
    gifUrls: toLines(els.gifs.value).slice(0, 10),
    gifCount: Math.max(0, Math.min(200, Number(els.gifCount.value) || defaults.gifCount)),
    mouseRadius: Math.max(50, Math.min(250, Number(els.mouseRadius.value) || defaults.mouseRadius)),
    debugCollisions: state.debugCollisions,
    playgroundDebugMode: state.debugCollisions,
    windEnabled: state.windEnabled,
    windDirection: state.windDirection,
    windStrength: clamp(readNumber(els.windStrength, defaults.windStrength), 0, 5),
    windGustFrequency: clamp(readNumber(els.windGustFrequency, defaults.windGustFrequency), 0.5, 10),
    windGustStrength: clamp(readNumber(els.windGustStrength, defaults.windGustStrength), 0, 1),
    turbulenceStrength: clamp(readNumber(els.turbulenceStrength, defaults.turbulenceStrength), 0, 1),
    updraftStrength: clamp(readNumber(els.updraftStrength, defaults.updraftStrength), 0, 80),
    rendererMode: state.rendererMode,
    minGlowStrength: Number(els.minGlowStrength.value),
    snow3dThickness: Number(els.snow3dThickness.value)
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
  els.snowminsize.value = defaults.snowminsize;
  els.snowmaxsize.value = defaults.snowmaxsize;
  els.snowFluffiness.value = defaults.snowFluffiness;
  els.snowShape.value = defaults.snowShape;
  els.snowShapeOverrides.value = JSON.stringify(defaults.snowShapeOverrides);
  els.gravity.value = defaults.gravity;
  els.airDensity.value = defaults.airDensity;
  els.gifCount.value = defaults.gifCount;
  els.mouseRadius.value = defaults.mouseRadius;
  els.sentenceCount.value = defaults.sentenceCount;
  els.gifs.value = defaults.gifs.join('\n');
  els.windEnabled.checked = defaults.windEnabled;
  els.windStrength.value = defaults.windStrength;
  els.windGustFrequency.value = defaults.windGustFrequency;
  els.windGustStrength.value = defaults.windGustStrength;
  els.turbulenceStrength.value = defaults.turbulenceStrength;
  els.updraftStrength.value = defaults.updraftStrength;
  els.minGlowStrength.value = defaults.minGlowStrength;
  els.minGlowStrengthValue.value = defaults.minGlowStrength.toFixed(2);
  els.snow3dThickness.value = defaults.snow3dThickness;
  els.snow3dThicknessValue.value = defaults.snow3dThickness.toFixed(2);
  state.colors = [...defaults.colors];
  state.symbols = [...defaults.symbols];
  state.sentences = [...defaults.sentences];
  state.debugCollisions = defaults.debugCollisions;
  state.rendererMode = defaults.rendererMode;
  state.windEnabled = defaults.windEnabled;
  state.windDirection = defaults.windDirection;
  previewGlyph = defaults.symbols[0] || '❄';
  updateWindButtons();
  updateRendererButtons();
  renderColors();
  renderSymbols();
  renderSentences();
  updateDebugButton();
  updateSizePreview();
}

function updateDebugButton() {
  const isDebugEnabled = state.debugCollisions;
  els.debug.classList.toggle('active', isDebugEnabled);
  els.debug.textContent = isDebugEnabled ? '✓ Debug ON' : 'Debug';
}

function updateWindButtons() {
  els.windLeft.classList.toggle('active', state.windDirection === 'left');
  els.windRight.classList.toggle('active', state.windDirection === 'right');
  els.windRandom.classList.toggle('active', state.windDirection === 'random');
}

function updateRendererButtons() {
  els.rendererAuto.classList.toggle('active', state.rendererMode === 'auto');
  els.rendererWebgpu.classList.toggle('active', state.rendererMode === 'webgpu');
  els.renderer2d.classList.toggle('active', state.rendererMode === '2d');
  els.renderer3d.classList.toggle('active', state.rendererMode === '3d');
}

els.start.addEventListener('click', async () => {
  try {
    await startSnow(getConfigFromForm());
  } catch (error) {
    console.error('Unable to start playground snow:', error);
    setStatus('error', error.message);
  }
});

els.stop.addEventListener('click', () => {
  stopSnow();
});
els.light.addEventListener('click', () => setTheme('light'));
els.dark.addEventListener('click', () => setTheme('dark'));
els.reset.addEventListener('click', () => resetForm());
els.debug.addEventListener('click', () => {
  state.debugCollisions = !state.debugCollisions;
  updateDebugButton();
  console.log(`%c🔧 Collision debug ${state.debugCollisions ? 'enabled' : 'disabled'}`, 'color: #ffd43b; font-weight: bold;');
});

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

els.addSentence.addEventListener('click', () => {
  addSentence(els.sentenceInput.value);
  els.sentenceInput.value = '';
});

els.sentenceInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addSentence(els.sentenceInput.value);
    els.sentenceInput.value = '';
  }
});

els.snowminsize.addEventListener('input', () => {
  const { minPercent, maxPercent } = normalizeSizePercentRange(els.snowminsize.value, els.snowmaxsize.value);
  els.snowminsize.value = minPercent.toFixed(1);
  els.snowmaxsize.value = maxPercent.toFixed(1);
  updateSizePreview();
});

els.snowmaxsize.addEventListener('input', () => {
  const { minPercent, maxPercent } = normalizeSizePercentRange(els.snowminsize.value, els.snowmaxsize.value);
  els.snowminsize.value = minPercent.toFixed(1);
  els.snowmaxsize.value = maxPercent.toFixed(1);
  updateSizePreview();
});

els.windEnabled.addEventListener('change', (e) => {
  state.windEnabled = e.target.checked;
});

els.minGlowStrength.addEventListener('input', () => {
  els.minGlowStrengthValue.value = Number(els.minGlowStrength.value).toFixed(2);
});

els.snow3dThickness.addEventListener('input', () => {
  els.snow3dThicknessValue.value = Number(els.snow3dThickness.value).toFixed(2);
});

els.rendererAuto.addEventListener('click', () => {
  state.rendererMode = 'auto';
  updateRendererButtons();
});

els.rendererWebgpu.addEventListener('click', () => {
  state.rendererMode = 'webgpu';
  updateRendererButtons();
});

els.renderer2d.addEventListener('click', () => {
  state.rendererMode = '2d';
  updateRendererButtons();
});

els.renderer3d.addEventListener('click', () => {
  state.rendererMode = '3d';
  updateRendererButtons();
});

els.windLeft.addEventListener('click', () => {
  state.windDirection = 'left';
  updateWindButtons();
});

els.windRight.addEventListener('click', () => {
  state.windDirection = 'right';
  updateWindButtons();
});

els.windRandom.addEventListener('click', () => {
  state.windDirection = 'random';
  updateWindButtons();
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
updateRendererButtons();
refreshGlyphPicker();
updateSizePreview();

// Initialize - playground uses direct source import
setStatus('ready', 'Playground: ready - hot reload enabled');
