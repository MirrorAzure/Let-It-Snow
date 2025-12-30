/**
 * Модуль для управления слоем GIF анимаций
 */

const GIF_LAYER_ID = 'let-it-snow-gif-layer';
const MAX_Z_INDEX = '2147483646';
const FALLBACK_GIF_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAPAAAP///wAAACwAAAAAAQABAEACAkQBADs=';
const IS_TEST_ENV = import.meta?.env?.MODE === 'test';

/**
 * Класс для управления слоем с GIF снежинками
 */
export class GifLayer {
  constructor(config) {
    this.config = config;
    this.layer = null;
    this.flakes = [];
    this.frameRequest = null;
    this.lastTimestamp = 0;
    this.gifObjectUrls = new Map();
  }

  /**
   * Конвертирует URL в безопасный для CSP
   * @param {string} url - Исходный URL
   * @returns {Promise<string|null>}
   */
  async toSafeGifUrl(url) {
    if (!url) return null;

    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return url;
    }

    const extensionOrigin =
      typeof chrome !== 'undefined' && chrome.runtime?.id
        ? `chrome-extension://${chrome.runtime.id}/`
        : '';

    if (extensionOrigin && url.startsWith(extensionOrigin)) {
      return url;
    }

    if (this.gifObjectUrls.has(url)) {
      return this.gifObjectUrls.get(url);
    }

    if (IS_TEST_ENV && /^https?:\/\//.test(url)) {
      return FALLBACK_GIF_DATA_URL;
    }

    if (typeof fetch !== 'function') {
      return url;
    }

    try {
      const response = await fetch(url, { cache: 'no-cache', mode: 'cors' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      this.gifObjectUrls.set(url, objectUrl);
      return objectUrl;
    } catch (error) {
      if (!IS_TEST_ENV) {
        console.warn('Unable to fetch GIF for CSP-safe rendering:', url, error);
      }
      return FALLBACK_GIF_DATA_URL;
    }
  }

  /**
   * Разрешает массив URL в безопасные
   * @param {string[]} urls - Массив URL
   * @returns {Promise<string[]>}
   */
  async resolveGifUrls(urls) {
    const resolved = await Promise.all(urls.map((u) => this.toSafeGifUrl(u)));
    return resolved.filter(Boolean);
  }

  /**
   * Очищает все созданные object URL
   */
  cleanupGifObjectUrls() {
    this.gifObjectUrls.forEach((objectUrl) => {
      URL.revokeObjectURL(objectUrl);
    });
    this.gifObjectUrls.clear();
  }

  /**
   * Запускает слой GIF
   */
  async start() {
    const urls = Array.isArray(this.config.gifUrls)
      ? this.config.gifUrls.filter((u) => typeof u === 'string' && u.trim() !== '')
      : [];
    const count = Math.max(0, Math.min(this.config.gifCount || 0, 160));

    this.stop();

    if (!urls.length || count === 0) return;

    const safeUrls = await this.resolveGifUrls(urls);
    if (!safeUrls.length) return;

    const existing = document.getElementById(GIF_LAYER_ID);
    if (existing) existing.remove();

    // Создаем контейнер для GIF
    const layer = document.createElement('div');
    layer.id = GIF_LAYER_ID;
    layer.style.position = 'fixed';
    layer.style.top = '0';
    layer.style.left = '0';
    layer.style.width = '100vw';
    layer.style.height = '100vh';
    layer.style.pointerEvents = 'none';
    layer.style.userSelect = 'none';
    layer.style.zIndex = MAX_Z_INDEX;
    layer.style.inset = '0';
    layer.style.overflow = 'hidden';
    layer.style.display = 'block';
    layer.style.background = 'transparent';
    document.documentElement.appendChild(layer);

    const sizeRange = this.config.snowmaxsize - this.config.snowminsize;

    // Создаем GIF снежинки
    const flakes = new Array(count).fill(null).map(() => {
      const size = this.config.snowminsize + Math.random() * sizeRange;
      const speed = this.config.sinkspeed * (size / 20) * 20;
      const sway = 10 + Math.random() * 25;
      const freq = 0.6 + Math.random() * 1.2;

      const img = document.createElement('img');
      img.src = safeUrls[Math.floor(Math.random() * safeUrls.length)];
      img.alt = 'snow-gif';
      img.draggable = false;
      img.loading = 'lazy';
      img.style.position = 'absolute';
      img.style.pointerEvents = 'none';
      img.style.userSelect = 'none';
      img.style.willChange = 'transform, opacity';
      img.style.width = `${size}px`;
      img.style.height = `${size}px`;
      img.style.opacity = '0.9';
      layer.appendChild(img);

      return {
        el: img,
        size,
        speed,
        sway,
        freq,
        x: Math.random() * window.innerWidth,
        y: -size - Math.random() * window.innerHeight,
        phase: Math.random() * Math.PI * 2
      };
    });

    this.layer = layer;
    this.flakes = flakes;
    this.lastTimestamp = performance.now();
    this.frameRequest = requestAnimationFrame((ts) => this.animate(ts));
  }

  /**
   * Анимация GIF снежинок
   * @param {number} timestamp - Текущее время
   */
  animate(timestamp) {
    if (!this.layer || !this.flakes.length) return;

    const delta = Math.max(0.001, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.flakes.forEach((flake) => {
      flake.phase += flake.freq * delta;
      flake.y += flake.speed * delta;

      // Сброс позиции если снежинка вышла за экран
      if (flake.y - flake.size > height) {
        flake.y = -flake.size;
        flake.x = Math.random() * width;
        flake.phase = Math.random() * Math.PI * 2;
      }

      // Применяем трансформации
      const x = flake.x + Math.sin(flake.phase) * flake.sway;
      const rotation = Math.sin(flake.phase * 0.5) * 0.4;
      flake.el.style.transform = `translate3d(${x}px, ${flake.y}px, 0) rotate(${rotation}rad)`;
    });

    this.frameRequest = requestAnimationFrame((ts) => this.animate(ts));
  }

  /**
   * Приостанавливает анимацию
   */
  pause() {
    if (this.frameRequest) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }
  }

  /**
   * Возобновляет анимацию
   */
  resume() {
    if (!this.flakes.length || !this.layer) return;
    this.lastTimestamp = performance.now();
    this.frameRequest = requestAnimationFrame((ts) => this.animate(ts));
  }

  /**
   * Останавливает и удаляет слой
   */
  stop() {
    if (this.frameRequest) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }

    this.flakes.forEach((flake) => {
      if (flake.el?.parentElement) {
        flake.el.remove();
      }
    });

    this.flakes = [];

    const layer = this.layer || document.getElementById(GIF_LAYER_ID);
    if (layer) {
      layer.remove();
    }
    this.layer = null;

    this.cleanupGifObjectUrls();
  }
}
