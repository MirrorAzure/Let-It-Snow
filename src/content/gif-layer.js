/**
 * Модуль для управления слоем GIF анимаций
 */

import { CollisionHandler } from './physics/collision-handler.js';
import { applyMouseMotion, applyMouseRepulsion } from './physics/mouse-handler.js';
import { createWindVortexField, applyVortexWindImpulse } from './physics/wind-field.js';
import { applyAirBurstImpulse, applyMouseFieldForce, MIN_MOUSE_ACTIVITY_SPEED, stepSinkSpeed } from './physics/snow-physics.js';
import { resolveGlyphSizeRangePx, resolveInitialSpawnSpanRatio } from './utils/size-utils.js';
import { advancePhysicsClock, createPhysicsClock } from './physics/time-step.js';

const GIF_LAYER_ID = 'let-it-snow-gif-layer';
const MAX_Z_INDEX = '2147483646';
const FALLBACK_GIF_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAPAAAP///wAAACwAAAAAAQABAEACAkQBADs=';
const IS_TEST_ENV = import.meta?.env?.MODE === 'test';
const GIF_MAX_SLAB_LAYERS = 12;
const GIF_GLOW_FLICKER = 0.45;
// Max tilt per axis: the face never turns fully edge-on (|cos X · cos Y| ≥ cos²(0.95) ≈ 0.34),
// where a stack of flat layers has no visible thickness and Chrome rasterizes it at a tiny scale.
const GIF_MAX_TILT = 0.95;

/**
 * Slab depth in px for a 3D GIF; matches the glyph extrusion (thickness × size).
 */
export function resolveGifSlabDepth(size, thickness) {
  const t = Number.isFinite(Number(thickness)) ? Math.min(0.18, Math.max(0.02, Number(thickness))) : 0.07;
  return Math.max(1, size * t);
}

/**
 * Number of stacked image layers needed to make the slab edge look solid (≈1px apart).
 */
export function resolveGifSlabLayerCount(depthPx, maxLayers = GIF_MAX_SLAB_LAYERS) {
  return Math.max(2, Math.min(maxLayers, Math.round(depthPx) + 1));
}

/**
 * Same twinkle curve as the 3D glyph glow: slow wave plus a sharp sparkle peak.
 * @returns {number} Multiplier in [1 - amount, 1].
 */
export function resolveGifGlowFlicker(time, flake, amount = GIF_GLOW_FLICKER) {
  if (!Number.isFinite(flake?.twinkleSpeedA)) return 1;
  const slow = 0.5 + 0.5 * Math.sin(time * flake.twinkleSpeedA + flake.twinklePhaseA);
  const fast = 0.5 + 0.5 * Math.sin(time * flake.twinkleSpeedB + flake.twinklePhaseB);
  const twinkle = Math.min(1, Math.max(0, slow * 0.7 + Math.pow(fast, 6) * 0.6));
  return 1 - amount * (1 - twinkle);
}

/**
 * Bounded tumble angles (radians) for a 3D GIF at its current phases.
 */
export function resolveGifTilt(flake) {
  const ampX = Math.min(GIF_MAX_TILT, Math.abs(flake.tiltAmpX ?? GIF_MAX_TILT));
  const ampY = Math.min(GIF_MAX_TILT, Math.abs(flake.tiltAmpY ?? GIF_MAX_TILT));
  return {
    x: ampX * Math.sin(flake.tiltX || 0),
    y: ampY * Math.sin(flake.tiltY || 0)
  };
}

/**
 * Orthographic screen projection of CSS `rotateX(x) rotateY(y) rotateZ(z)` as a 2D
 * `matrix(a, b, c, d, 0, 0)`. The glow uses it instead of a 3D transform so the blur
 * filter works on flat content (no flattened 3D context, no low-resolution raster).
 */
export function projectGifRotation(x, y, z) {
  const ca = Math.cos(x), sa = Math.sin(x);
  const cb = Math.cos(y), sb = Math.sin(y);
  const cc = Math.cos(z), sc = Math.sin(z);
  return [
    cb * cc,
    ca * sc + sa * sb * cc,
    -cb * sc,
    ca * cc - sa * sb * sc
  ];
}

/**
 * Класс для управления слоем с GIF снежинками
 */
export class GifLayer {
  constructor(config) {
    this.config = config;
    this.layerId = typeof config.gifLayerId === 'string' && config.gifLayerId ? config.gifLayerId : GIF_LAYER_ID;
    this.layer = null;
    this.flakes = [];
    this.frameRequest = null;
    this.lastTimestamp = 0;
    this.physicsClock = createPhysicsClock();
    this.gifObjectUrls = new Map();
    // Wind state
    this.currentWindForce = 0;
    this.currentWindLift = 0;
    this.currentWindVortex = 0;
    this.windTime = 0;
    this.windVortexSeed = 0;
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
    this.mouseLeftPressed = false;
    this.mouseRightPressed = false;
    // Collision system
    this.collisionHandler = new CollisionHandler(config);
    this.enableCollisions = config.enableCollisions ?? true;
    // Reference to main renderer for real-time flake access
    this.mainRenderer = null;
    this.initialVisibleGifRatio = Math.max(0, Math.min(1, config.gifInitialVisibleRatio ?? 0.35));
    this.is3D = String(config.rendererMode || '').toLowerCase() === '3d';
    this._gifFallbackWarnedUrls = new Set();
    this.useBackgroundGifFetch = config.useBackgroundGifFetch !== false;
    this.backgroundGifFetchTimeoutMs = Math.max(500, Number(config.backgroundGifFetchTimeoutMs ?? 2500));
    this.startGeneration = 0;
  }

  _wrapInitialYPosition(y, size, viewportHeight) {
    const minY = -size;
    const maxY = viewportHeight + size;
    const span = maxY - minY;
    if (!Number.isFinite(span) || span <= 0) return minY;
    const wrapped = ((y - minY) % span + span) % span;
    return minY + wrapped;
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
    const generation = ++this.startGeneration;

    if (!urls.length || count === 0) return;

    const safeUrls = await this.resolveGifUrls(urls);
    if (generation !== this.startGeneration) {
      this.cleanupGifObjectUrls();
      return;
    }
    if (!safeUrls.length) return;

    const existing = document.getElementById(this.layerId);
    if (existing) existing.remove();

    // Создаем контейнер для GIF
    const layer = document.createElement('div');
    layer.id = this.layerId;
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

    const { minPx: snowminsize, maxPx: snowmaxsize } = resolveGlyphSizeRangePx(this.config);
    const initialOffsetSeconds = Math.max(0, Number(this.config.initialTimeOffsetSeconds) || 0);
    const sizeRange = snowmaxsize - snowminsize;
    const spawnSpan = window.innerHeight * resolveInitialSpawnSpanRatio(this.config, 1);

    const initialVisibleCount = Math.min(count, Math.max(1, Math.ceil(count * this.initialVisibleGifRatio)));
    const initialVisibleMask = this._buildDistributedSlotMask(count, initialVisibleCount);

    // Создаем GIF снежинки
    const flakes = new Array(count).fill(null).map((_, idx) => {
      const size = snowminsize + Math.random() * sizeRange;
      const sinkspeed = this.config.sinkspeed ?? 1.0; // Default sink speed
      const speed = sinkspeed * (size / 20) * 20;
      const baseY = initialVisibleMask[idx]
        ? (-size * 0.5 + Math.random() * size)
        : (-size * 0.5 - Math.random() * spawnSpan);
      const startY = initialOffsetSeconds > 0
        ? this._wrapInitialYPosition(baseY + speed * initialOffsetSeconds, size, window.innerHeight)
        : baseY;

      const src = safeUrls[Math.floor(Math.random() * safeUrls.length)];
      const parts = this.is3D
        ? this._createGif3dElement(src, size, count > 60 ? 4 : GIF_MAX_SLAB_LAYERS)
        : this._createGif2dElement(src, size);
      parts.el.style.position = 'absolute';
      parts.el.style.left = '0';
      parts.el.style.top = '0';
      // In 3D the slab layers carry their own 3D transforms; a will-change hint on the
      // ancestor would freeze their raster scale and pixelate them at steep angles.
      if (!this.is3D) parts.el.style.willChange = 'transform';
      parts.el.style.opacity = '0.9';
      layer.appendChild(parts.el);

      return {
        el: parts.el,
        slab: parts.slab || null,
        glowWrap: parts.glowWrap || null,
        glowImg: parts.glowImg || null,
        size,
        speed,
        nominalFallSpeed: speed,
        x: Math.random() * window.innerWidth,
        y: startY,
        velocityX: 0,
        velocityY: speed,
        rotationSpeed: 0,
        rotation: 0,
        tiltX: Math.random() * Math.PI * 2,
        tiltY: Math.random() * Math.PI * 2,
        tiltSpeedX: (0.35 + Math.random() * 0.6) * (Math.random() < 0.5 ? -1 : 1),
        tiltSpeedY: (0.35 + Math.random() * 0.6) * (Math.random() < 0.5 ? -1 : 1),
        tiltAmpX: 0.55 + Math.random() * (GIF_MAX_TILT - 0.55),
        tiltAmpY: 0.55 + Math.random() * (GIF_MAX_TILT - 0.55),
        spin: Math.random() * Math.PI * 2,
        spinSpeed: (Math.random() - 0.5) * 0.8,
        twinkleSpeedA: 1.6 + Math.random() * 1.8,
        twinkleSpeedB: 4.5 + Math.random() * 4,
        twinklePhaseA: Math.random() * Math.PI * 2,
        twinklePhaseB: Math.random() * Math.PI * 2,
        collisionSize: size
      };
    });

    this.layer = layer;
    this.flakes = flakes;
    this.lastTimestamp = performance.now();
    this.physicsClock.accumulator = 0;
    this.frameRequest = requestAnimationFrame((ts) => this.animate(ts));
  }

  _createGifImage(src, size) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'snow-gif';
    img.draggable = false;
    img.loading = 'eager';
    img.decoding = 'async';
    img.style.display = 'block';
    img.style.pointerEvents = 'none';
    img.style.userSelect = 'none';
    img.style.width = `${size}px`;
    img.style.height = `${size}px`;
    return img;
  }

  /**
   * Glow shared by all modes: a blurred, slightly enlarged copy of the same frame, so
   * the halo takes its colors from the GIF's own edges and stays in sync with the
   * animation. Works for cross-origin GIFs because no pixels are read.
   */
  _createGifGlow(src, size) {
    const glowWrap = document.createElement('div');
    glowWrap.style.position = 'absolute';
    glowWrap.style.inset = '0';
    glowWrap.style.pointerEvents = 'none';
    glowWrap.style.transform = 'scale(1.16)';
    glowWrap.style.filter = `blur(${Math.max(2, size * 0.11).toFixed(1)}px) saturate(1.5) brightness(1.25)`;
    glowWrap.style.opacity = '0';
    const glowImg = this._createGifImage(src, size);
    glowWrap.appendChild(glowImg);
    return { glowWrap, glowImg };
  }

  _createGifRoot(size) {
    const root = document.createElement('div');
    root.style.width = `${size}px`;
    root.style.height = `${size}px`;
    root.style.pointerEvents = 'none';
    return root;
  }

  /**
   * Canvas 2D / WebGPU GIF: the whole element rotates in 2D, the glow rotates with it.
   */
  _createGif2dElement(src, size) {
    const root = this._createGifRoot(size);
    const { glowWrap, glowImg } = this._createGifGlow(src, size);
    root.appendChild(glowWrap);
    const body = this._createGifImage(src, size);
    body.style.position = 'absolute';
    body.style.inset = '0';
    root.appendChild(body);
    return { el: root, glowWrap, glowImg };
  }

  /**
   * 3D GIF: a slab of stacked frames (thickness) plus the screen-space glow.
   * Slab layers have no CSS filters: a filter forces a separate render surface that
   * Chrome rasterizes at the (tiny) projected scale of a steep layer.
   */
  _createGif3dElement(src, size, maxLayers = GIF_MAX_SLAB_LAYERS) {
    const root = this._createGifRoot(size);
    const { glowWrap, glowImg } = this._createGifGlow(src, size);
    root.appendChild(glowWrap);

    const slab = document.createElement('div');
    slab.style.position = 'absolute';
    slab.style.inset = '0';
    slab.style.transformStyle = 'preserve-3d';
    slab.style.pointerEvents = 'none';

    const depth = resolveGifSlabDepth(size, this.config.snow3dThickness);
    const layers = resolveGifSlabLayerCount(depth, maxLayers);
    for (let i = 0; i < layers; i += 1) {
      const z = depth * (i / (layers - 1) - 0.5);
      const face = this._createGifImage(src, size);
      face.style.position = 'absolute';
      face.style.inset = '0';
      face.style.backfaceVisibility = 'visible';
      face.style.transform = `translateZ(${z.toFixed(2)}px)`;
      slab.appendChild(face);
    }
    root.appendChild(slab);

    return { el: root, slab, glowWrap, glowImg };
  }

  /**
   * Анимация GIF снежинок
   * @param {number} timestamp - Текущее время
   */
  animate(timestamp, fixedDelta = null) {
    if (!this.layer || !this.flakes.length) return;

    if (fixedDelta === null) {
      const elapsed = Math.max(0, (timestamp - this.lastTimestamp) / 1000);
      this.lastTimestamp = timestamp;
      if (document.hidden) {
        this.physicsClock.accumulator = 0;
      } else {
        const steps = advancePhysicsClock(
          this.physicsClock,
          elapsed,
          (delta) => this.animate(timestamp, delta)
        );
        if (steps === 0 && !document.hidden) this.animate(timestamp, 0);
      }
      this.frameRequest = requestAnimationFrame((nextTimestamp) => this.animate(nextTimestamp));
      return;
    }

    const delta = fixedDelta;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const vortexField = createWindVortexField(width, height, this.windTime);

    // Update burst timer
    if (this.mouseBurstTimer > 0) {
      this.mouseBurstTimer = Math.max(0, this.mouseBurstTimer - delta);
      if (this.mouseBurstTimer === 0) {
        this.mouseBurstMode = null;
      }
    }

    this.flakes.forEach((flake) => {
      flake.previousCollisionX = flake.x;
      flake.previousCollisionY = flake.y;
      // Apply wind force
      if (this.currentWindForce !== 0 || this.currentWindLift !== 0 || this.currentWindVortex !== 0) {
        const sizeRatio = Math.sqrt(flake.size / 20);
        if (this.currentWindForce !== 0) {
          const windAccel = this.currentWindForce * sizeRatio * 40;
          flake.velocityX += windAccel * delta;
        }
        if (this.currentWindLift !== 0) {
          const liftAccel = -this.currentWindLift * sizeRatio * 70;
          flake.velocityY += liftAccel * delta;
        }
        if (this.currentWindVortex !== 0) {
          const vortexAccel = this.currentWindVortex * sizeRatio * 420;
          applyVortexWindImpulse(flake, delta, vortexAccel, vortexField);
        }
      }

      // Apply mouse interaction
      const dx = flake.x - this.mouseX;
      const dy = flake.y - this.mouseY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const mouseSpeed = Math.sqrt(this.mouseVelocityX * this.mouseVelocityX + this.mouseVelocityY * this.mouseVelocityY);
      const activityFactor = mouseSpeed > MIN_MOUSE_ACTIVITY_SPEED ? 1 : 0;
      const burstActive = this.mouseBurstTimer > 0;
      const shouldApplyMouse = burstActive || activityFactor > 0;
      const isMouseFast = mouseSpeed > this.mouseDragThreshold;

      const heldMouseMode = this.mouseLeftPressed ? 'blower'
        : this.mouseRightPressed ? 'suction' : null;
      if (heldMouseMode && distance < this.mouseRadius * this.mouseBurstRadiusMultiplier) {
        applyMouseFieldForce(
          flake,
          this.mouseX,
          this.mouseY,
          this.mouseRadius * this.mouseBurstRadiusMultiplier,
          heldMouseMode,
          this.mouseForce * 10,
          delta
        );
      } else if (distance < (this.mouseRadius * (burstActive ? this.mouseBurstRadiusMultiplier : 1)) && shouldApplyMouse) {
        const radius = this.mouseRadius * (burstActive ? this.mouseBurstRadiusMultiplier : 1);
        const influence = 1 - distance / radius;
        const burstFactor = burstActive ? Math.min(1, this.mouseBurstTimer / this.mouseBurstDuration) : 0;
        const activeInfluence = influence * Math.max(activityFactor, burstFactor);

        let dragActive = false;
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
          dragActive = true;
        } else {
          // Обычное отталкивание при медленном движении
          applyMouseRepulsion(flake, dx, dy, activeInfluence, this.mouseForce, delta, dy < 0 ? 0.35 : 1.0);
        }
        
        applyMouseMotion(flake, {
          dx,
          dy,
          mouseVelocityX: this.mouseVelocityX,
          mouseVelocityY: this.mouseVelocityY,
          influence: activeInfluence,
          dragActive,
          dragStrength: this.mouseDragStrength,
          impulseStrength: this.mouseImpulseStrength,
          delta
        });
      }

      // Apply velocity damping
      const damping = Math.pow(0.98, delta * 60);
      flake.velocityX *= damping;
      flake.velocityY *= damping;
      stepSinkSpeed(flake, delta);
      flake.rotationSpeed *= damping;
      
      // Обнулить очень малые значения вращения, чтобы избежать численных погрешностей
      if (Math.abs(flake.rotationSpeed) < 0.0001) {
        flake.rotationSpeed = 0;
      }

      // Update position
      flake.x += flake.velocityX * delta;
      flake.y += flake.velocityY * delta;

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

    });

    // GIF flakes can collide with main-renderer flakes only when both use 2D physics.
    if (this.enableCollisions && this.collisionHandler) {
      const rendererFlakes = this.mainRenderer?.is3D
        ? []
        : (this.mainRenderer?.instances || this.mainRenderer?.flakes || []);
      // GIF остаются DOM-слоем, поэтому 3D-снежинки не участвуют в 2D-коллизиях.
      const gifFlakes = new Set(this.flakes);
      const allFlakes = [...this.flakes, ...rendererFlakes];
      this.collisionHandler.handleCollisions(
        allFlakes,
        delta,
        (flakeA, flakeB) => gifFlakes.has(flakeA) || gifFlakes.has(flakeB)
      );
    }

    const glowStrength = Number.isFinite(this.mainRenderer?.glowStrength)
      ? Math.min(1, Math.max(0, this.mainRenderer.glowStrength))
      : 1;
    this.flakes.forEach((flake) => {
      const halfSize = flake.size * 0.5;
      const translate = `translate3d(${flake.x - halfSize}px, ${flake.y - halfSize}px, 0)`;
      if (this.is3D) {
        flake.tiltX += flake.tiltSpeedX * delta;
        flake.tiltY += flake.tiltSpeedY * delta;
        flake.spin = (flake.spin || 0) + (flake.spinSpeed || 0) * delta;
        const tilt = resolveGifTilt(flake);
        const rotZ = flake.rotation + (flake.spin || 0);
        // Per-element perspective keeps the tumble size-relative and leaves the layout size unchanged.
        const rotation = `perspective(${Math.round(flake.size * 5)}px) `
          + `rotateX(${tilt.x.toFixed(4)}rad) rotateY(${tilt.y.toFixed(4)}rad) rotateZ(${rotZ.toFixed(4)}rad)`;
        if (flake.slab) {
          flake.el.style.transform = translate;
          flake.slab.style.transform = rotation;
          const [a, b, c, d] = projectGifRotation(tilt.x, tilt.y, rotZ);
          flake.glowImg.style.transform = `matrix(${a.toFixed(4)}, ${b.toFixed(4)}, ${c.toFixed(4)}, ${d.toFixed(4)}, 0, 0)`;
        } else {
          flake.el.style.transform = `${translate} ${rotation}`;
        }
      } else {
        flake.el.style.transform = `${translate} rotate(${flake.rotation}rad)`;
      }
      if (flake.glowWrap) {
        const glow = 0.85 * glowStrength * resolveGifGlowFlicker(this.windTime, flake);
        flake.glowWrap.style.opacity = glow.toFixed(3);
      }
    });

    this.windTime += delta;
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
    this.physicsClock.accumulator = 0;
    this.frameRequest = requestAnimationFrame((ts) => this.animate(ts));
  }

  /**
   * Update wind state
   */
  updateWind(windForce, windLift, windVortex = this.currentWindVortex, windTime = this.windTime) {
    this.currentWindForce = windForce;
    this.currentWindLift = windLift;
    this.currentWindVortex = windVortex;
    this.windTime = windTime;
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
      this.mouseLeftPressed = true;
      this.mouseBurstMode = 'explode';
      const radius = this.mouseRadius * this.mouseBurstRadiusMultiplier;
      const strength = this.mouseForce * 10;
      for (const flake of this.flakes) {
        applyAirBurstImpulse(flake, x, y, radius, 'explode', strength, this.mouseBurstDuration);
      }
    }
    if (button === 2) {
      this.mouseRightPressed = true;
      this.mouseBurstMode = 'suction';
    }
    this.mouseX = x;
    this.mouseY = y;
  }

  onMouseUp(button) {
    if (button === 0) this.mouseLeftPressed = false;
    if (button === 2) this.mouseRightPressed = false;
    if (!this.mouseLeftPressed && !this.mouseRightPressed) {
      this.mouseBurstTimer = 0;
      this.mouseBurstMode = null;
    }
  }

  /**
   * Handle mouse leave
   */
  onMouseLeave() {
    this.mouseLeftPressed = false;
    this.mouseRightPressed = false;
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
    this.windVortexSeed = renderer?.windVortexSeed ?? this.windVortexSeed;
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
    this.startGeneration++;

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

    const layer = this.layer || document.getElementById(this.layerId);
    if (layer) {
      layer.remove();
    }
    this.layer = null;

    this.cleanupGifObjectUrls();
  }
}
