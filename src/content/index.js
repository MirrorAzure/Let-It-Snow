/**
 * Главный контроллер снегопада для Let It Snow extension
 * 
 * Этот модуль управляет созданием и отображением снежинок на веб-странице.
 * Поддерживает WebGPU для производительного рендеринга с автоматическим
 * fallback на Canvas 2D для браузеров без поддержки WebGPU.
 */

import { WebGPURenderer } from './webgpu-renderer.js';
import { Fallback2DRenderer } from './fallback-2d-renderer.js';
import { GifLayer } from './gif-layer.js';
import { splitSentences } from './utils/glyph-utils.js';
import { normalizeGlyphSizePercentRange, getViewportBaseSize } from './utils/size-utils.js';

// Константы
const OVERLAY_ID = 'let-it-snow-webgpu-canvas';
const MAX_Z_INDEX = '2147483646';
const PLAYGROUND_MESSAGE_TARGET = 'let-it-snow-playground';
const SNOW_PROGRESS_STORAGE_KEY = 'snowProgressV1';
const MAX_INITIAL_OFFSET_SECONDS = 6 * 60 * 60;

// Конфигурация по умолчанию
const DEFAULT_CONFIG = {
  snowmax: 80,
  sinkspeed: 0.4,
  snowminsize: 2.0,
  snowmaxsize: 4.0,
  snowcolor: ['#ffffff'],
  snowletters: ['❄'],
  snowsentences: [],
  sentenceCount: 0,
  gifUrls: [],
  gifCount: 0,
  debugCollisions: false,
  rendererMode: 'auto',
  mouseRadius: 100,
  windEnabled: false,
  windDirection: 'left',
  windStrength: 0.5,
  windGustFrequency: 3
};

const SENTENCE_CELL_SIZE = 64;

const estimateSentenceMaxLength = (cellSize) => {
  const fontSize = Math.max(10, Math.floor(cellSize * 0.25));
  const maxWidth = cellSize * 0.9;
  const lineHeight = fontSize * 1.2;
  const maxLines = Math.max(1, Math.floor(cellSize / lineHeight));
  const avgCharWidth = fontSize * 0.6;
  const maxCharsPerLine = Math.max(1, Math.floor(maxWidth / avgCharWidth));
  return Math.max(10, maxCharsPerLine * maxLines);
};

const MAX_SENTENCE_LENGTH = estimateSentenceMaxLength(SENTENCE_CELL_SIZE);

const normalizeSentences = (sentences, maxLength = MAX_SENTENCE_LENGTH) => {
  if (!Array.isArray(sentences)) return [];
  const result = [];

  sentences.forEach((sentence) => {
    const text = String(sentence || '').trim();
    if (!text) return;
    const parts = splitSentences(text, maxLength)
      .map((part) => part.trim())
      .filter(Boolean);
    result.push(...parts);
  });

  return result;
};

const normalizeSizeConfig = (rawConfig = {}) => {
  const { minPercent, maxPercent } = normalizeGlyphSizePercentRange(
    rawConfig.snowminsize,
    rawConfig.snowmaxsize
  );

  return {
    ...rawConfig,
    snowminsize: minPercent,
    snowmaxsize: maxPercent
  };
};

const getSnowStorageArea = () => {
  if (typeof chrome === 'undefined' || !chrome.storage) return null;
  return chrome.storage.local || chrome.storage.sync || null;
};

const resolveInitialOffsetSeconds = async (reuseExistingProgress = true) => {
  const storage = getSnowStorageArea();
  if (!storage) return 0;

  const now = Date.now();

  try {
    const stored = await storage.get([SNOW_PROGRESS_STORAGE_KEY]);
    const progress = stored?.[SNOW_PROGRESS_STORAGE_KEY] || null;
    const savedStartedAt = Number(progress?.startedAt);
    const canReuseSavedStart =
      reuseExistingProgress && Number.isFinite(savedStartedAt) && savedStartedAt > 0;

    const startedAt = canReuseSavedStart ? savedStartedAt : now;

    await storage.set({
      [SNOW_PROGRESS_STORAGE_KEY]: {
        version: 1,
        startedAt,
        lastSeenAt: now
      }
    });

    const elapsed = Math.max(0, (now - startedAt) / 1000);
    return Math.min(MAX_INITIAL_OFFSET_SECONDS, elapsed);
  } catch (err) {
    console.warn('[Let It Snow] Failed to resolve snow progress offset:', err);
    return 0;
  }
};

const clearSnowProgress = async () => {
  const storage = getSnowStorageArea();
  if (!storage) return;
  try {
    await storage.remove(SNOW_PROGRESS_STORAGE_KEY);
  } catch (err) {
    console.warn('[Let It Snow] Failed to clear snow progress:', err);
  }
};

// Глобальный контроллер
let controller = null;

/**
 * Главный класс управления снегопадом
 */
class SnowWebGPUController {
  constructor(userConfig = {}) {
    const mergedConfig = { ...DEFAULT_CONFIG, ...userConfig };
    mergedConfig.snowsentences = normalizeSentences(mergedConfig.snowsentences);
    this.config = normalizeSizeConfig(mergedConfig);
    this.canvas = null;
    this.renderer = null;
    this.gifLayer = null;
    this.isPaused = false;
    this.mouseX = 0;
    this.mouseY = 0;
    this.mousePrevX = 0;
    this.mousePrevY = 0;
    this.mouseVelocityX = 0;
    this.mouseVelocityY = 0;
    this.lastMouseTime = 0;
    this.mouseIdleTimeoutId = null;
    this.mouseLeftPressed = false;
    this.mouseRightPressed = false;
    this.mouseInteractionEnabled = true;
    this.windSyncInterval = null;
  }

  /**
   * Запуск снегопада
   */
  async start() {
    this.createOverlayCanvas();
    const gifStartPromise = this.startGifLayer();
    const mode = String(this.config.rendererMode || 'auto').toLowerCase();
    const rendererMode = mode === 'webgpu' || mode === '2d' ? mode : 'auto';
    const debugEnabled = Boolean(
      this.config?.debug === true ||
      this.config?.debugCollisions === true ||
      this.config?.playgroundDebugMode === true
    );

    if (rendererMode !== '2d') {
      // Пытаемся использовать WebGPU, если не получается - fallback в auto-режиме
      const webgpuRenderer = new WebGPURenderer(this.canvas, this.config);
      const webgpuSupported = await webgpuRenderer.init();

      if (webgpuSupported) {
        this.renderer = webgpuRenderer;
        this.renderer.setDeviceLostHandler?.(() => {
          // В strict webgpu-режиме не переключаемся автоматически на 2D.
          if (rendererMode === 'webgpu') {
            if (debugEnabled) {
              console.warn('[Let It Snow] WebGPU device lost in strict webgpu mode. Auto-fallback is disabled.');
            }
            return;
          }

          const fallbackRenderer = new Fallback2DRenderer(this.canvas, this.config);
          const fallbackInit = fallbackRenderer.init();
          if (fallbackInit) {
            this.renderer = fallbackRenderer;
            this.renderer.start();
            if (this.gifLayer) {
              this.gifLayer.setMainRenderer?.(this.renderer);
            }
            if (debugEnabled) {
              console.debug('[Let It Snow] Switched to Canvas2D after WebGPU device loss.');
            }
          } else if (debugEnabled) {
            console.warn('[Let It Snow] Failed to initialize Canvas2D fallback after WebGPU device loss.');
          }
        });
        this.renderer.start();
      } else if (rendererMode === 'webgpu') {
        if (debugEnabled) {
          const info = webgpuRenderer.getLastInitInfo?.();
          console.warn('[Let It Snow] WebGPU mode requested but unavailable. Snow renderer is not started.', info || '');
        }
      } else if (debugEnabled) {
        const info = webgpuRenderer.getLastInitInfo?.();
        console.debug('[Let It Snow] Auto mode selected Canvas2D fallback.', info || '');
      }
    }

    if (!this.renderer && rendererMode !== 'webgpu') {
      // Fallback на 2D Canvas
      const fallbackRenderer = new Fallback2DRenderer(this.canvas, this.config);
      const fallbackInit = fallbackRenderer.init();
      if (fallbackInit) {
        this.renderer = fallbackRenderer;
        this.renderer.start();
      }
    }

    // GIF запускаем параллельно с инициализацией рендера,
    // чтобы не ждать завершения тяжелого WebGPU init.
    await gifStartPromise;

    // Передаем ссылку на рендерер в GifLayer для коллизий в реальном времени
    if (this.gifLayer && this.renderer) {
      this.gifLayer.setMainRenderer?.(this.renderer);
    }

    // Start wind synchronization
    if (this.gifLayer && this.renderer) {
      this.windSyncInterval = setInterval(() => {
        if (this.renderer && this.gifLayer) {
          const windForce = this.renderer.currentWindForce ?? 0;
          const windLift = this.renderer.currentWindLift ?? 0;
          this.gifLayer.updateWind?.(windForce, windLift);
        }
      }, 100);
    }
  }

  /**
   * Создание overlay canvas элемента
   */
  createOverlayCanvas() {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();

    const canvas = document.createElement('canvas');
    canvas.id = OVERLAY_ID;
    const setStyle = (prop, value) => canvas.style.setProperty(prop, value, 'important');
    setStyle('position', 'fixed');
    setStyle('top', '0');
    setStyle('left', '0');
    setStyle('right', '0');
    setStyle('bottom', '0');
    setStyle('width', '100vw');
    setStyle('height', '100vh');
    setStyle('max-width', 'none');
    setStyle('max-height', 'none');
    setStyle('pointer-events', 'none');
    setStyle('user-select', 'none');
    setStyle('z-index', MAX_Z_INDEX);
    setStyle('inset', '0');
    setStyle('display', 'block');
    setStyle('background', 'transparent');
    document.documentElement.appendChild(canvas);

    this.canvas = canvas;
    this.setupMouseInteraction();
  }

  /**
   * Приводит координаты указателя к системе координат симуляции (CSS px).
   * Это устраняет рассинхрон при zoom/pinch и нестандартном viewport.
   * @param {MouseEvent|PointerEvent|TouchEvent} event
   * @returns {{x: number, y: number}}
   */
  normalizePointerPosition(event) {
    const touchPoint = event?.touches?.[0] || event?.changedTouches?.[0] || null;
    const rawX = Number(touchPoint?.clientX ?? event?.clientX);
    const rawY = Number(touchPoint?.clientY ?? event?.clientY);
    let x = Number.isFinite(rawX) ? rawX : 0;
    let y = Number.isFinite(rawY) ? rawY : 0;

    const rect = this.canvas?.getBoundingClientRect?.();
    const viewportWidth = this.renderer?.viewportWidth || window.innerWidth || 1;
    const viewportHeight = this.renderer?.viewportHeight || window.innerHeight || 1;

    if (rect && rect.width > 0 && rect.height > 0) {
      const normalizedX = (x - rect.left) / rect.width;
      const normalizedY = (y - rect.top) / rect.height;
      x = normalizedX * viewportWidth;
      y = normalizedY * viewportHeight;
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      x = 0;
      y = 0;
    }

    return { x, y };
  }

  /**
   * Запуск слоя GIF анимаций
   */
  async startGifLayer() {
    this.stopGifLayer();
    this.gifLayer = new GifLayer(this.config);
    await this.gifLayer.start();
  }

  /**
   * Остановка слоя GIF
   */
  stopGifLayer() {
    if (this.gifLayer) {
      this.gifLayer.stop();
      this.gifLayer = null;
    }
  }

  /**
   * Приостановка всех анимаций
   */
  pauseAnimations() {
    if (this.isPaused) return;
    this.isPaused = true;

    if (this.renderer) {
      this.renderer.pause();
    }

    if (this.gifLayer) {
      this.gifLayer.pause();
    }
  }

  /**
   * Возобновление всех анимаций
   */
  resumeAnimations() {
    if (!this.isPaused) return;
    this.isPaused = false;

    if (this.renderer) {
      this.renderer.resume();
    }

    if (this.gifLayer) {
      this.gifLayer.resume();
    }
  }

  /**
   * Настройка обработчиков событий мыши
   */
  setupMouseInteraction() {
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const maxMouseVelocity = Number(this.config.maxMouseVelocity ?? 3800);
    const mouseVelocitySmoothing = Number(this.config.mouseVelocitySmoothing ?? 0.35);
    const supportsPointerEvents = typeof window !== 'undefined' && 'PointerEvent' in window;
    const getPointerButton = (event, isUp = false) => {
      const button = Number(event?.button);
      if (button === 0 || button === 2) return button;
      const pointerType = String(event?.pointerType || '').toLowerCase();
      if (pointerType === 'touch' || pointerType === 'pen') {
        if (isUp && !this.mouseLeftPressed) return -1;
        return 0;
      }
      return -1;
    };

    this.mouseMoveHandler = (e) => {
      const now = performance.now();
      const rawDt = this.lastMouseTime ? (now - this.lastMouseTime) / 1000 : 0.016;
      const dt = clamp(rawDt || 0.016, 1 / 240, 0.05);
      const pointer = this.normalizePointerPosition(e);
      
      this.mousePrevX = this.mouseX;
      this.mousePrevY = this.mouseY;
      this.mouseX = pointer.x;
      this.mouseY = pointer.y;
      
      // Вычисляем скорость движения мыши
      if (dt > 0) {
        const rawVx = (this.mouseX - this.mousePrevX) / dt;
        const rawVy = (this.mouseY - this.mousePrevY) / dt;
        const clampedVx = clamp(rawVx, -maxMouseVelocity, maxMouseVelocity);
        const clampedVy = clamp(rawVy, -maxMouseVelocity, maxMouseVelocity);
        const a = clamp(mouseVelocitySmoothing, 0.05, 1);
        this.mouseVelocityX = this.mouseVelocityX * (1 - a) + clampedVx * a;
        this.mouseVelocityY = this.mouseVelocityY * (1 - a) + clampedVy * a;
      }
      
      this.lastMouseTime = now;

      if (this.mouseIdleTimeoutId) {
        clearTimeout(this.mouseIdleTimeoutId);
      }
      this.mouseIdleTimeoutId = setTimeout(() => {
        this.mouseVelocityX = 0;
        this.mouseVelocityY = 0;
        this.lastMouseTime = performance.now();
        if (this.renderer && this.mouseInteractionEnabled) {
          this.renderer.updateMousePosition?.(this.mouseX, this.mouseY, 0, 0);
        }
        if (this.gifLayer && this.mouseInteractionEnabled) {
          this.gifLayer.updateMouse?.(this.mouseX, this.mouseY, 0, 0);
        }
      }, 32);
      
      if (this.renderer && this.mouseInteractionEnabled) {
        this.renderer.updateMousePosition?.(this.mouseX, this.mouseY, this.mouseVelocityX, this.mouseVelocityY);
      }
      if (this.gifLayer && this.mouseInteractionEnabled) {
        this.gifLayer.updateMouse?.(this.mouseX, this.mouseY, this.mouseVelocityX, this.mouseVelocityY);
      }
    };

    this.mouseDownHandler = (e) => {
      const button = getPointerButton(e);
      if (button !== 0 && button !== 2) return;
      const pointer = this.normalizePointerPosition(e);
      if (button === 0) this.mouseLeftPressed = true;
      if (button === 2) this.mouseRightPressed = true;
      if (this.renderer && this.mouseInteractionEnabled) {
        this.renderer.onMouseDown?.(pointer.x, pointer.y, button);
      }
      if (this.gifLayer && this.mouseInteractionEnabled) {
        this.gifLayer.onMouseDown?.(pointer.x, pointer.y, button);
      }
    };

    this.mouseUpHandler = (e) => {
      const button = getPointerButton(e, true);
      if (button !== 0 && button !== 2) return;
      if (button === 0) this.mouseLeftPressed = false;
      if (button === 2) this.mouseRightPressed = false;
      if (this.renderer && this.mouseInteractionEnabled) {
        this.renderer.onMouseUp?.(button);
      }
    };

    this.mouseLeaveHandler = () => {
      this.mouseLeftPressed = false;
      this.mouseRightPressed = false;
      this.mouseVelocityX = 0;
      this.mouseVelocityY = 0;
      if (this.mouseIdleTimeoutId) {
        clearTimeout(this.mouseIdleTimeoutId);
        this.mouseIdleTimeoutId = null;
      }
      if (this.renderer && this.mouseInteractionEnabled) {
        this.renderer.onMouseLeave?.();
      }
      if (this.gifLayer && this.mouseInteractionEnabled) {
        this.gifLayer.onMouseLeave?.();
      }
    };

    // Отслеживаем события на document, чтобы не блокировать взаимодействие со страницей.
    // Для мобильных/планшетов используем Pointer Events, с fallback на touch+mouse.
    this.usingPointerEvents = supportsPointerEvents;
    if (supportsPointerEvents) {
      document.addEventListener('pointermove', this.mouseMoveHandler, { passive: true });
      document.addEventListener('pointerdown', this.mouseDownHandler, { passive: true });
      document.addEventListener('pointerup', this.mouseUpHandler, { passive: true });
      document.addEventListener('pointercancel', this.mouseLeaveHandler, { passive: true });
      document.addEventListener('pointerleave', this.mouseLeaveHandler, { passive: true });
      return;
    }

    this.touchStartHandler = (e) => this.mouseDownHandler(e);
    this.touchMoveHandler = (e) => this.mouseMoveHandler(e);
    this.touchEndHandler = (e) => this.mouseUpHandler(e);

    document.addEventListener('touchstart', this.touchStartHandler, { passive: true });
    document.addEventListener('touchmove', this.touchMoveHandler, { passive: true });
    document.addEventListener('touchend', this.touchEndHandler, { passive: true });
    document.addEventListener('touchcancel', this.mouseLeaveHandler, { passive: true });

    document.addEventListener('mousemove', this.mouseMoveHandler, { passive: true });
    document.addEventListener('mousedown', this.mouseDownHandler, { passive: true });
    document.addEventListener('mouseup', this.mouseUpHandler, { passive: true });
    document.addEventListener('mouseleave', this.mouseLeaveHandler, { passive: true });
  }

  /**
   * Удаление обработчиков событий мыши
   */
  removeMouseInteraction() {
    if (this.usingPointerEvents) {
      if (this.mouseMoveHandler) {
        document.removeEventListener('pointermove', this.mouseMoveHandler);
      }
      if (this.mouseDownHandler) {
        document.removeEventListener('pointerdown', this.mouseDownHandler);
      }
      if (this.mouseUpHandler) {
        document.removeEventListener('pointerup', this.mouseUpHandler);
      }
      if (this.mouseLeaveHandler) {
        document.removeEventListener('pointercancel', this.mouseLeaveHandler);
        document.removeEventListener('pointerleave', this.mouseLeaveHandler);
      }
    }

    if (this.touchStartHandler) {
      document.removeEventListener('touchstart', this.touchStartHandler);
    }
    if (this.touchMoveHandler) {
      document.removeEventListener('touchmove', this.touchMoveHandler);
    }
    if (this.touchEndHandler) {
      document.removeEventListener('touchend', this.touchEndHandler);
    }

    if (this.mouseMoveHandler) {
      document.removeEventListener('mousemove', this.mouseMoveHandler);
    }
    if (this.mouseDownHandler) {
      document.removeEventListener('mousedown', this.mouseDownHandler);
    }
    if (this.mouseUpHandler) {
      document.removeEventListener('mouseup', this.mouseUpHandler);
    }
    if (this.mouseLeaveHandler) {
      document.removeEventListener('mouseleave', this.mouseLeaveHandler);
    }

    this.mouseMoveHandler = null;
    this.mouseDownHandler = null;
    this.mouseUpHandler = null;
    this.mouseLeaveHandler = null;
    this.touchStartHandler = null;
    this.touchMoveHandler = null;
    this.touchEndHandler = null;
    this.usingPointerEvents = false;
  }

  /**
   * Полная очистка и удаление снегопада
   */
  destroy() {
    if (this.windSyncInterval) {
      clearInterval(this.windSyncInterval);
      this.windSyncInterval = null;
    }

    if (this.renderer) {
      this.renderer.cleanup?.();
      this.renderer.stop?.();
      this.renderer = null;
    }

    this.stopGifLayer();
    this.removeMouseInteraction();

    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }

    this.isPaused = false;
  }
}

/**
 * Остановить снегопад
 */
function stopSnow(options = {}) {
  const { preserveProgress = false } = options;
  if (controller) {
    controller.destroy();
    controller = null;
  }

  if (!preserveProgress) {
    clearSnowProgress().catch(() => {});
  }
}

/**
 * Запустить снегопад с заданной конфигурацией
 * @param {Object} config - Конфигурация снегопада
 */
async function startSnow(config, options = {}) {
  const { reuseExistingProgress = true } = options;
  const initialTimeOffsetSeconds = await resolveInitialOffsetSeconds(reuseExistingProgress);
  const runtimeConfig = normalizeSizeConfig({
    ...config,
    initialTimeOffsetSeconds
  });

  stopSnow({ preserveProgress: true });
  controller = new SnowWebGPUController(runtimeConfig);
  await controller.start();
}

/**
 * Безопасная отправка postMessage
 * @param {Object} payload - Данные для отправки
 */
const safePostMessage = (payload) => {
  if (typeof window === 'undefined') return;
  if (typeof window.postMessage !== 'function') return;
  window.postMessage(payload, '*');
};

/**
 * Обработчик сообщений для playground режима
 * @param {MessageEvent} event - Событие сообщения
 */
const handleWindowBridgeMessage = (event) => {
  if (event.source !== window) return;

  const { target, action, config } = event.data || {};
  if (target !== PLAYGROUND_MESSAGE_TARGET) return;

  if (action === 'startSnow') {
    startSnow(config || {}).catch((err) => console.error(err));
    return;
  }

  if (action === 'stopSnow') {
    stopSnow();
    return;
  }

  if (action === 'ping') {
    safePostMessage({ target: PLAYGROUND_MESSAGE_TARGET, action: 'pong' });
  }
};

// Слушаем сообщения для playground режима
window.addEventListener('message', handleWindowBridgeMessage);
safePostMessage({ target: PLAYGROUND_MESSAGE_TARGET, action: 'ready' });

// Chrome/Firefox extension messaging
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const respond = typeof sendResponse === 'function' ? sendResponse : () => {};
    try {
      if (message.action === 'startSnow') {
        startSnow(message.config || {}).catch((err) => console.error(err));
        respond({ ok: true });
        return;
      }

      if (message.action === 'stopSnow') {
        stopSnow();
        respond({ ok: true });
        return;
      }

      if (message.action === 'getViewportBaseSize') {
        respond({ ok: true, viewportBaseSize: getViewportBaseSize() });
        return;
      }

      respond({ ok: false, reason: 'unknown_action' });
    } catch (err) {
      console.error(err);
      respond({ ok: false, error: err?.message || 'unknown_error' });
    }
  });
}

// Очистка при закрытии страницы
window.addEventListener('beforeunload', () => {
  stopSnow({ preserveProgress: true });
});

// Пауза/возобновление при смене вкладки
const handleVisibilityChange = () => {
  if (!controller) return;
  if (document.hidden) {
    controller.pauseAnimations();
  } else {
    controller.resumeAnimations();
  }
};

document.addEventListener('visibilitychange', handleVisibilityChange);

// Автозапуск если включен в настройках
(async () => {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const stored = await chrome.storage.sync.get([
        'autoStart',
        'snowmax',
        'sinkspeed',
        'snowminsize',
        'snowmaxsize',
        'colors',
        'symbols',
        'symbolModes',
        'sentences',
        'sentenceCount',
        'gifs',
        'gifCount',
        'mouseRadius',
        'windEnabled',
        'windDirection',
        'windStrength',
        'windGustFrequency'
      ]);

      if (stored.autoStart) {
        const sizeConfig = normalizeSizeConfig({
          snowminsize: stored.snowminsize,
          snowmaxsize: stored.snowmaxsize
        });
        const config = {
          snowmax: stored.snowmax || 80,
          sinkspeed: stored.sinkspeed || 0.4,
          snowminsize: sizeConfig.snowminsize,
          snowmaxsize: sizeConfig.snowmaxsize,
          snowcolor: stored.colors || ['#ffffff'],
          snowletters: stored.symbols || ['❄'],
          snowglyphmodes: stored.symbolModes || ['text'],
          snowsentences: stored.sentences || [],
          sentenceCount: stored.sentenceCount || 0,
          gifUrls: stored.gifs || [],
          gifCount: stored.gifCount || 0,
          mouseRadius: stored.mouseRadius || 100,
          windEnabled: stored.windEnabled || false,
          windDirection: stored.windDirection || 'left',
          windStrength: stored.windStrength || 0.5,
          windGustFrequency: stored.windGustFrequency || 3
        };
        startSnow(config).catch((err) => console.error(err));
      }
    }
  } catch (err) {
    console.error('Error checking auto-start setting:', err);
  }
})();

// Экспорт для playground и тестирования
export { SnowWebGPUController, startSnow, stopSnow };
