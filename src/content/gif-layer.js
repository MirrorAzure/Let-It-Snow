/**
 * Модуль для управления слоем GIF анимаций
 */

import { CollisionHandler } from './physics/collision-handler.js';

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
    // Wind state
    this.currentWindForce = 0;
    this.currentWindLift = 0;
    // Mouse state
    this.mouseX = -1000;
    this.mouseY = -1000;
    this.mouseVelocityX = 0;
    this.mouseVelocityY = 0;
    this.mouseRadius = config.mouseRadius ?? 100;
    this.mouseForce = config.mouseForce ?? 300;
    this.mouseImpulseStrength = config.mouseImpulseStrength ?? 0.5;
    this.mouseDragThreshold = config.mouseDragThreshold ?? 500;
    this.mouseDragStrength = config.mouseDragStrength ?? 0.8;
    this.mouseBurstMode = null;
    this.mouseBurstTimer = 0;
    this.mouseBurstDuration = 0.2;
    this.mouseBurstRadiusMultiplier = 3.5;
    // Collision system
    this.collisionHandler = new CollisionHandler(config);
    this.enableCollisions = config.enableCollisions ?? true;
    // Reference to main renderer for real-time flake access
    this.mainRenderer = null;
    this.initialVisibleGifRatio = Math.max(0, Math.min(1, config.gifInitialVisibleRatio ?? 0.35));
    this._gifFallbackWarnedUrls = new Set();
    this.useBackgroundGifFetch = config.useBackgroundGifFetch !== false;
    this.backgroundGifFetchTimeoutMs = Math.max(500, Number(config.backgroundGifFetchTimeoutMs ?? 2500));
  }

  /**
   * Строит маску равномерно распределенных слотов.
   * @private
   */
  _buildDistributedSlotMask(total, selectedCount) {
    const mask = new Array(Math.max(0, total)).fill(false);
    const count = Math.min(Math.max(0, selectedCount), total);
    if (count === 0 || total <= 0) return mask;
    if (count >= total) {
      for (let i = 0; i < total; i++) mask[i] = true;
      return mask;
    }

    for (let i = 0; i < count; i++) {
      let slot = Math.floor(((i + 0.5) * total) / count);
      if (slot < 0) slot = 0;
      if (slot >= total) slot = total - 1;
      while (mask[slot]) {
        slot = (slot + 1) % total;
      }
      mask[slot] = true;
    }

    return mask;
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

    let backgroundFetchSucceeded = false;

    // Способ 1: через background service worker.
    // Background работает с origin расширения, а не страницы, поэтому
    // CORS-ограничения контент-скрипта на него не распространяются.
    // Это позволяет загружать GIF с любых серверов — даже тех, которые
    // не выдают CORS-заголовки для HTTP-страниц.
    if (this.useBackgroundGifFetch && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        const result = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(null), this.backgroundGifFetchTimeoutMs);
          try {
            chrome.runtime.sendMessage({ type: 'FETCH_GIF', url }, (response) => {
              clearTimeout(timer);
              // Читаем lastError чтобы Chrome не писал предупреждение об unhandled error
              void chrome.runtime?.lastError;
              resolve(response || null);
            });
          } catch {
            clearTimeout(timer);
            resolve(null);
          }
        });
        if (result?.success && result.dataUrl) {
          this.gifObjectUrls.set(url, result.dataUrl);
          backgroundFetchSucceeded = true;
          return result.dataUrl;
        }
      } catch {
        // background недоступен — переходим к прямому fetch
      }
    }

    // Для внешних URL после неуспеха background не тратим дополнительное время
    // на CORS fetch в контент-скрипте: сразу используем direct src.
    // Это устраняет длинные таймауты и ускоряет появление GIF.
    if (!backgroundFetchSucceeded && /^https?:\/\//.test(url)) {
      return url;
    }

    // Способ 2: прямой fetch из контент-скрипта (работает если отдаётся CORS).
    if (typeof fetch !== 'function') {
      return url;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      let response;
      try {
        response = await fetch(url, {
          cache: 'no-cache',
          mode: 'cors',
          credentials: 'omit',
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      if (!blob || blob.size === 0) {
        throw new Error('Empty response blob');
      }

      const objectUrl = URL.createObjectURL(blob);
      this.gifObjectUrls.set(url, objectUrl);
      return objectUrl;
    } catch (error) {
      const errorMsg = error?.message || 'Unknown error';
      const reason =
        error?.name === 'AbortError'
          ? '(timeout)'
          : error?.name === 'TypeError' && error?.message?.includes('Failed to fetch')
          ? '(CORS or network issue)'
          : error?.message?.includes('HTTP')
          ? '(Server error)'
          : '(Fetch failed)';

      const isTimeout = error?.name === 'AbortError';
      const isNetworkOrCors = error?.name === 'TypeError' && error?.message?.includes('Failed to fetch');
      const shouldWarn = !IS_TEST_ENV && !isTimeout && !isNetworkOrCors && !this._gifFallbackWarnedUrls.has(url);

      if (shouldWarn) {
        this._gifFallbackWarnedUrls.add(url);
        console.warn(`[Let It Snow] Unable to fetch GIF ${reason}:`, url, `- ${errorMsg}`, '— falling back to direct src');
      }
      // Способ 3: прямой URL — браузер загружает <img> без CORS (нет preflight),
      // но subject to page CSP. Лучше чем ничего.
      return url;
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
    this.gifObjectUrls.forEach((cachedUrl) => {
      // data: URL не требует освобождения, revokeObjectURL нужен только для blob:
      if (cachedUrl.startsWith('blob:')) {
        URL.revokeObjectURL(cachedUrl);
      }
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

    const initialVisibleCount = Math.min(count, Math.max(1, Math.ceil(count * this.initialVisibleGifRatio)));
    const initialVisibleMask = this._buildDistributedSlotMask(count, initialVisibleCount);

    // Создаем GIF снежинки
    const flakes = new Array(count).fill(null).map((_, idx) => {
      const size = this.config.snowminsize + Math.random() * sizeRange;
      const sinkspeed = this.config.sinkspeed ?? 1.0; // Default sink speed
      const speed = sinkspeed * (size / 20) * 20;

      const img = document.createElement('img');
      img.src = safeUrls[Math.floor(Math.random() * safeUrls.length)];
      img.alt = 'snow-gif';
      img.draggable = false;
      img.loading = 'eager';
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
        x: Math.random() * window.innerWidth,
        y: initialVisibleMask[idx]
          ? (-size * 0.5 + Math.random() * size)
          : (-size * 0.5 - Math.random() * window.innerHeight),
        velocityX: 0,
        velocityY: 0,
        rotationSpeed: 0,
        rotation: 0,
        collisionSize: size
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

    // Update burst timer
    if (this.mouseBurstTimer > 0) {
      this.mouseBurstTimer = Math.max(0, this.mouseBurstTimer - delta);
      if (this.mouseBurstTimer === 0) {
        this.mouseBurstMode = null;
      }
    }

    this.flakes.forEach((flake) => {
      // Apply wind force
      if (this.currentWindForce !== 0 || this.currentWindLift !== 0) {
        const sizeRatio = Math.sqrt(flake.size / 20);
        if (this.currentWindForce !== 0) {
          const windAccel = this.currentWindForce * sizeRatio * 40;
          flake.velocityX += windAccel * delta;
        }
        if (this.currentWindLift !== 0) {
          const liftAccel = -this.currentWindLift * sizeRatio * 70;
          flake.velocityY += liftAccel * delta;
        }
      }

      // Apply mouse interaction
      const dx = flake.x - this.mouseX;
      const dy = flake.y - this.mouseY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const mouseSpeed = Math.sqrt(this.mouseVelocityX * this.mouseVelocityX + this.mouseVelocityY * this.mouseVelocityY);
      const activityFactor = mouseSpeed > 0 ? 1 : 0;
      const burstActive = this.mouseBurstTimer > 0;
      const shouldApplyMouse = burstActive || activityFactor > 0;
      const isMouseFast = mouseSpeed > this.mouseDragThreshold;

      if (distance < (this.mouseRadius * (burstActive ? this.mouseBurstRadiusMultiplier : 1)) && shouldApplyMouse) {
        const radius = this.mouseRadius * (burstActive ? this.mouseBurstRadiusMultiplier : 1);
        const influence = 1 - distance / radius;
        const burstFactor = burstActive ? Math.min(1, this.mouseBurstTimer / this.mouseBurstDuration) : 0;
        const activeInfluence = influence * Math.max(activityFactor, burstFactor);

        if (burstActive && this.mouseBurstMode === 'explode') {
          const safeDistance = Math.max(distance, 0.0001);
          const nx = dx / safeDistance;
          const ny = dy / safeDistance;
          const burstAccel = activeInfluence * this.mouseForce * 10.0;
          flake.velocityX += nx * burstAccel * delta;
          flake.velocityY += ny * burstAccel * delta;
        } else if (burstActive && this.mouseBurstMode === 'suction') {
          const safeDistance = Math.max(distance, 0.0001);
          const nx = dx / safeDistance;
          const ny = dy / safeDistance;
          const pullAccel = activeInfluence * this.mouseForce * 10.0;
          flake.velocityX -= nx * pullAccel * delta;
          flake.velocityY -= ny * pullAccel * delta;
        } else if (isMouseFast) {
          // Нормализуем вектор скорости мыши
          const mouseVelMag = Math.sqrt(this.mouseVelocityX * this.mouseVelocityX + this.mouseVelocityY * this.mouseVelocityY);
          if (mouseVelMag > 0) {
            const mouseDirX = this.mouseVelocityX / mouseVelMag;
            const mouseDirY = this.mouseVelocityY / mouseVelMag;
            
            // Притягиваем снежинку в сторону движения мыши
            const dragForce = activeInfluence * this.mouseDragStrength * (mouseSpeed / 1000);
            flake.velocityX += mouseDirX * dragForce * delta * 1000;
            flake.velocityY += mouseDirY * dragForce * delta * 1000;
          }
        } else {
          // Обычное отталкивание при медленном движении
          const force = activeInfluence * this.mouseForce * delta;
          const angle = Math.atan2(dy, dx);
          flake.velocityX += Math.cos(angle) * force;
          flake.velocityY += Math.sin(angle) * force;
        }
        
        // Передаем импульс от движения мыши
        const impulseStrength = activeInfluence * this.mouseImpulseStrength;
        flake.velocityX += this.mouseVelocityX * impulseStrength * delta;
        flake.velocityY += this.mouseVelocityY * impulseStrength * delta;
        
        // Вращение снежинки при движении мыши рядом
        // Направление вращения зависит от того, с какой стороны пролетела мышка
        // Применяем вращение только если скорость мыши выше порога (> 10 пиксели/сек)
        // Это предотвращает вращение от дрожания мыши
        if (mouseSpeed > 10) {
          const cross = dx * this.mouseVelocityY - dy * this.mouseVelocityX;
          const rotationDirection = Math.sign(cross); // +1 или -1
          const rotationForce = activeInfluence * mouseSpeed * 0.01 * rotationDirection;
          flake.rotationSpeed += rotationForce * delta;
        }
      }

      // Apply velocity damping
      const damping = Math.pow(0.98, delta * 60);
      flake.velocityX *= damping;
      flake.velocityY *= damping;
      flake.rotationSpeed *= damping;
      
      // Обнулить очень малые значения вращения, чтобы избежать численных погрешностей
      if (Math.abs(flake.rotationSpeed) < 0.0001) {
        flake.rotationSpeed = 0;
      }

      // Update position
      flake.x += flake.velocityX * delta;
      flake.y += (flake.speed + flake.velocityY) * delta;

      // Update rotation
      flake.rotation += flake.rotationSpeed * delta;

      // Wrap around horizontal boundaries
      const halfSize = flake.size * 0.5;
      if (flake.x < -halfSize) {
        flake.x = width + halfSize;
      } else if (flake.x > width + halfSize) {
        flake.x = -halfSize;
      }

      // Сброс позиции если снежинка вышла за экран
      const flakeSize = flake.size ?? 20;
      const flakeHalfSize = flakeSize * 0.5;
      if (flake.y - flakeHalfSize > height) {
        flake.y = -flakeHalfSize;
        flake.x = Math.random() * width;
        flake.velocityX = 0;
        flake.velocityY = 0;
        flake.rotation = 0;
        flake.rotationSpeed = 0;
      }

      // Применяем трансформации
      flake.el.style.transform = `translate3d(${flake.x - flakeHalfSize}px, ${flake.y - flakeHalfSize}px, 0) rotate(${flake.rotation}rad)`;
    });

    // Process collisions between ALL flakes (GIF + flakes from main renderer)
    if (this.enableCollisions && this.collisionHandler) {
      // Получаем снежинки напрямую из рендерера для актуальных позиций
      const rendererFlakes = this.mainRenderer?.flakes || [];
      // Объединяем GIF снежинки с снежинками из Canvas2D/WebGPU
      const allFlakes = [...this.flakes, ...rendererFlakes];
      this.collisionHandler.handleCollisions(allFlakes, delta);
    }

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
   * Update wind state
   */
  updateWind(windForce, windLift) {
    this.currentWindForce = windForce;
    this.currentWindLift = windLift;
  }

  /**
   * Update mouse state
   */
  updateMouse(x, y, velocityX, velocityY) {
    this.mouseX = x;
    this.mouseY = y;
    this.mouseVelocityX = velocityX;
    this.mouseVelocityY = velocityY;
  }

  /**
   * Handle mouse button down
   */
  onMouseDown(x, y, button) {
    if (button === 0) {
      this.mouseBurstMode = 'explode';
      this.mouseBurstTimer = this.mouseBurstDuration;
    }
    if (button === 2) {
      this.mouseBurstMode = 'suction';
      this.mouseBurstTimer = this.mouseBurstDuration;
    }
    this.mouseX = x;
    this.mouseY = y;
  }

  /**
   * Handle mouse leave
   */
  onMouseLeave() {
    this.mouseBurstTimer = 0;
    this.mouseBurstMode = null;
    this.mouseX = -1000;
    this.mouseY = -1000;
  }

  /**
   * Set reference to main renderer for real-time collision detection
   * @param {Object} renderer - Main renderer (Canvas2D or WebGPU)
   */
  setMainRenderer(renderer) {
    this.mainRenderer = renderer;
  }

  /**
   * Update configuration
   */
  updateConfig(config) {
    if (config.mouseRadius !== undefined) this.mouseRadius = config.mouseRadius;
    if (config.mouseForce !== undefined) this.mouseForce = config.mouseForce;
    if (config.enableCollisions !== undefined) this.enableCollisions = config.enableCollisions;
    if (this.collisionHandler) {
      this.collisionHandler.updateConfig(config);
    }
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
