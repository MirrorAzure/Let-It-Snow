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

// Константы
const OVERLAY_ID = 'let-it-snow-webgpu-canvas';
const MAX_Z_INDEX = '2147483646';
const PLAYGROUND_MESSAGE_TARGET = 'let-it-snow-playground';

// Конфигурация по умолчанию
const DEFAULT_CONFIG = {
  snowmax: 80,
  sinkspeed: 0.4,
  snowminsize: 15,
  snowmaxsize: 40,
  snowcolor: ['#ffffff'],
  snowletters: ['❄'],
  gifUrls: [],
  gifCount: 0
};

// Глобальный контроллер
let controller = null;

/**
 * Главный класс управления снегопадом
 */
class SnowWebGPUController {
  constructor(userConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...userConfig };
    this.canvas = null;
    this.renderer = null;
    this.gifLayer = null;
    this.isPaused = false;
  }

  /**
   * Запуск снегопада
   */
  async start() {
    this.createOverlayCanvas();

    // Пытаемся использовать WebGPU, если не получается - 2D fallback
    const webgpuRenderer = new WebGPURenderer(this.canvas, this.config);
    const webgpuSupported = await webgpuRenderer.init();

    if (webgpuSupported) {
      this.renderer = webgpuRenderer;
      this.renderer.start();
    } else {
      // Fallback на 2D Canvas
      const fallbackRenderer = new Fallback2DRenderer(this.canvas, this.config);
      const fallbackInit = fallbackRenderer.init();
      if (fallbackInit) {
        this.renderer = fallbackRenderer;
        this.renderer.start();
      }
    }

    // Запуск слоя GIF (если настроен)
    await this.startGifLayer();
  }

  /**
   * Создание overlay canvas элемента
   */
  createOverlayCanvas() {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();

    const canvas = document.createElement('canvas');
    canvas.id = OVERLAY_ID;
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.userSelect = 'none';
    canvas.style.zIndex = MAX_Z_INDEX;
    canvas.style.inset = '0';
    canvas.style.display = 'block';
    canvas.style.background = 'transparent';
    document.documentElement.appendChild(canvas);

    this.canvas = canvas;
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
   * Полная очистка и удаление снегопада
   */
  destroy() {
    if (this.renderer) {
      this.renderer.cleanup?.();
      this.renderer.stop?.();
      this.renderer = null;
    }

    this.stopGifLayer();

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
function stopSnow() {
  if (controller) {
    controller.destroy();
    controller = null;
  }
}

/**
 * Запустить снегопад с заданной конфигурацией
 * @param {Object} config - Конфигурация снегопада
 */
async function startSnow(config) {
  stopSnow();
  controller = new SnowWebGPUController(config);
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

      respond({ ok: false, reason: 'unknown_action' });
    } catch (err) {
      console.error(err);
      respond({ ok: false, error: err?.message || 'unknown_error' });
    }
  });
}

// Очистка при закрытии страницы
window.addEventListener('beforeunload', stopSnow);

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
        'gifs',
        'gifCount'
      ]);

      if (stored.autoStart) {
        const config = {
          snowmax: stored.snowmax || 80,
          sinkspeed: stored.sinkspeed || 0.4,
          snowminsize: stored.snowminsize || 15,
          snowmaxsize: stored.snowmaxsize || 40,
          snowcolor: stored.colors || ['#ffffff'],
          snowletters: stored.symbols || ['❄'],
          gifUrls: stored.gifs || [],
          gifCount: stored.gifCount || 0
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
