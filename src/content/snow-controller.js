/**
 * Контроллер одного слоя снегопада (canvas + рендерер + GIF-слой).
 * Используется content script, слоями эффектов внешнего API и OBS-оверлеем.
 */

import { WebGPURenderer } from './webgpu-renderer.js';
import { Fallback2DRenderer } from './fallback-2d-renderer.js';
import { ThreeDSnowRenderer } from './three-d-renderer.js';
import { GifLayer } from './gif-layer.js';
import { splitSentences } from './utils/glyph-utils.js';
import { normalizeGlyphSizePercentRange } from './utils/size-utils.js';

export const OVERLAY_ID = 'let-it-snow-webgpu-canvas';
export const MAX_Z_INDEX = '2147483646';

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
  minGlowStrength: 0.42,
  snow3dThickness: 0.07,
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

/**
 * Главный класс управления снегопадом
 */
export class SnowWebGPUController {
  /**
   * @param {Object} userConfig - Конфигурация снегопада
   * @param {Object} [options]
   * @param {string} [options.overlayId] - id canvas (у слоёв эффектов свой id)
   * @param {string} [options.gifLayerId] - id контейнера GIF
   * @param {boolean} [options.renderSnow=true] - false = только GIF-слой без снежинок
   * @param {boolean} [options.mouseInteraction=true] - подписка на события указателя
   * @param {() => Object|null} [options.windSource] - рендерер-источник ветра для GIF без собственного рендерера
   */
  constructor(userConfig = {}, options = {}) {
    this.overlayId = options.overlayId || OVERLAY_ID;
    this.gifLayerId = options.gifLayerId || null;
    this.renderSnow = options.renderSnow !== false;
    this.enableMouseInteraction = options.mouseInteraction !== false;
    this.windSource = typeof options.windSource === 'function' ? options.windSource : null;
    this.windOverride = null;
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
    this.isDestroyed = false;
  }

  /**
   * Запуск снегопада
   */
  async start() {
    this.createOverlayCanvas();
    const gifStartPromise = this.startGifLayer();
    const mode = String(this.config.rendererMode || 'auto').toLowerCase();
    const rendererMode = ['webgpu', '2d', '3d'].includes(mode) ? mode : 'auto';
    const debugEnabled = Boolean(
      this.config?.debug === true ||
      this.config?.debugCollisions === true ||
      this.config?.playgroundDebugMode === true
    );

    if (!this.renderSnow) {
      // Слой только с GIF: рендерер снежинок не создаём.
    } else if (rendererMode === '3d') {
      const threeRenderer = new ThreeDSnowRenderer(this.canvas, this.config);
      if (threeRenderer.init()) {
        this.renderer = threeRenderer;
        this.renderer.start();
      } else if (debugEnabled) {
        console.warn('[Let It Snow] 3D rendering is unavailable; using Canvas 2D fallback.');
      }
    } else if (rendererMode !== '2d') {
      // Пытаемся использовать WebGPU, если не получается - fallback в auto-режиме
      const webgpuRenderer = new WebGPURenderer(this.canvas, this.config);
      const webgpuSupported = await webgpuRenderer.init();
      if (this.isDestroyed) {
        webgpuRenderer.cleanup?.();
        return;
      }

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

    if (this.renderSnow && !this.renderer && rendererMode !== 'webgpu') {
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
    if (this.isDestroyed) {
      this.stopGifLayer();
      return;
    }

    // Передаем ссылку на рендерер в GifLayer для коллизий в реальном времени
    if (this.gifLayer && this.renderer) {
      this.gifLayer.setMainRenderer?.(this.renderer);
    }

    if (this.windOverride) {
      this.applyWindOverride(this.windOverride);
    }

    // Start wind synchronization
    if (this.gifLayer && (this.renderer || this.windSource)) {
      this.windSyncInterval = setInterval(() => {
        const source = this.renderer || this.windSource?.();
        if (source && this.gifLayer) {
          const windForce = source.currentWindForce ?? 0;
          const windLift = source.currentWindLift ?? 0;
          const windVortex = source.currentWindVortex ?? 0;
          const windTime = source.windTime ?? 0;
          this.gifLayer.updateWind?.(windForce, windLift, windVortex, windTime);
        }
      }, 100);
    }
  }

  /**
   * Временно переопределяет параметры ветра (внешний API).
   * @param {{enabled: boolean, direction: string, strength: number, gustFrequency: number}|null} override
   *   null — вернуть ветер из конфигурации.
   */
  applyWindOverride(override) {
    this.windOverride = override || null;
    const wind = override || {
      enabled: Boolean(this.config.windEnabled),
      direction: this.config.windDirection,
      strength: this.config.windStrength,
      gustFrequency: this.config.windGustFrequency
    };
    const renderer = this.renderer;
    if (!renderer) return;
    renderer.windEnabled = Boolean(wind.enabled);
    if (wind.direction !== undefined) renderer.windDirection = wind.direction;
    if (Number.isFinite(wind.strength)) renderer.windStrength = wind.strength;
    if (Number.isFinite(wind.gustFrequency)) renderer.windGustFrequency = wind.gustFrequency;
  }

  /**
   * Плавно скрывает слой и затем уничтожает его.
   * @param {number} durationMs
   * @returns {Promise<void>}
   */
  fadeOutAndDestroy(durationMs = 700) {
    if (this.isDestroyed) return Promise.resolve();
    const elements = [this.canvas, this.gifLayer?.layer].filter(Boolean);
    elements.forEach((el) => {
      el.style.setProperty('transition', `opacity ${durationMs}ms ease`, 'important');
      el.style.setProperty('opacity', '0', 'important');
    });
    return new Promise((resolve) => {
      setTimeout(() => {
        this.destroy();
        resolve();
      }, durationMs);
    });
  }

  /**
   * Создание overlay canvas элемента
   */
  createOverlayCanvas() {
    const existing = document.getElementById(this.overlayId);
    if (existing) existing.remove();

    const canvas = document.createElement('canvas');
    canvas.id = this.overlayId;
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
    if (this.enableMouseInteraction) {
      this.setupMouseInteraction();
    }
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
    const gifConfig = this.gifLayerId
      ? { ...this.config, gifLayerId: this.gifLayerId }
      : this.config;
    this.gifLayer = new GifLayer(gifConfig);
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
    this.isDestroyed = true;

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


export { DEFAULT_CONFIG, normalizeSentences, normalizeSizeConfig };
