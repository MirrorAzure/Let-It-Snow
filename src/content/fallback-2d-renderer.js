/**
 * 2D Canvas fallback рендерер для браузеров без WebGPU
 */

import { CollisionHandler } from './physics/collision-handler.js';

/**
 * Класс для рендеринга снега через Canvas 2D API
 */
export class Fallback2DRenderer {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.ctx = null;
    this.flakes = [];
    this.frameRequest = null;
    this.drawCallback = null;
    this.sentenceQueue = [];
    this.sentenceCursor = 0;

    // Адаптивный контроль респауна: если FPS проседает, новые снежинки временно не появляются
    this.fpsSmoothing = 0.15; // Скорость EMA (выше = быстрее реакция)
    this._avgFrameDelta = 1 / 60; // EMA по delta, а не по fps (точнее при рывках)
    this.currentFpsEstimate = 60;
    this.respawnPauseFps = config.canvas2dRespawnPauseFps ?? 57;
    this.respawnResumeFps = config.canvas2dRespawnResumeFps ?? 59;
    this._pauseFpsCustom = config.canvas2dRespawnPauseFps !== undefined;
    this._resumeFpsCustom = config.canvas2dRespawnResumeFps !== undefined;
    // Авто-калибровка: усредняем первые 60 кадров чтобы определить реальный hz монитора
    this._calibrated = false;
    this._calibrationDeltaSum = 0;
    this._calibrationCount = 0;
    this.allowNewFlakes = true;
    this.minActiveFlakesWhenThrottled = config.canvas2dMinActiveFlakesWhenThrottled
      ?? Math.max(8, Math.min(24, Math.ceil((config.snowmax ?? 80) * 0.15)));
    this.maxRespawnsPerSecond = config.canvas2dMaxRespawnsPerSecond
      ?? Math.max(20, Math.min(90, Math.ceil((config.snowmax ?? 80) * 0.45)));
    this.maxRespawnBurst = config.canvas2dMaxRespawnBurst
      ?? Math.max(4, Math.min(16, Math.ceil((config.snowmax ?? 80) * 0.08)));
    this.initialActiveFlakes = config.canvas2dInitialActiveFlakes
      ?? Math.max(6, Math.min(24, Math.ceil((config.snowmax ?? 80) * 0.2)));
    this._respawnCredit = 0;
    this.lowQualityMode = false;
    
    // Параметры взаимодействия с мышью
    this.mouseX = -1000;
    this.mouseY = -1000;
    this.mouseVelocityX = 0;
    this.mouseVelocityY = 0;
    this.mouseLeftPressed = false;
    this.mouseRightPressed = false;
    this.mouseRadius = config.mouseRadius ?? 100;
    this.mouseForce = config.mouseForce ?? 300;
    this.mouseImpulseStrength = config.mouseImpulseStrength ?? 0.5;
    this.mouseDragThreshold = config.mouseDragThreshold ?? 500; // Порог скорости для эффекта затягивания
    this.mouseDragStrength = config.mouseDragStrength ?? 1.0; // Сила затягивания в поток
    this.mouseBurstDuration = 0.2;
    this.mouseBurstRadiusMultiplier = 3.5;
    this.mouseBurstTimer = 0;
    this.mouseBurstMode = null;
    this.maxMouseVelocity = config.maxMouseVelocity ?? 2200;
    this.mouseVelocitySmoothing = config.mouseVelocitySmoothing ?? 0.35;
    this.mouseActivityThreshold = config.mouseActivityThreshold ?? 45;
    this.maxFlakeSpeed = config.maxFlakeSpeed ?? 420;
    this.maxRotationSpeed = config.maxRotationSpeed ?? 8;
    this.canvas2dMaxDpr = config.canvas2dMaxDpr ?? 1.75;
    
    // Параметры коллизий между снежинками
    this.enableCollisions = config.enableCollisions ?? true; // Включить коллизии
    this.collisionDamping = 0.7; // Коэффициент упругости столкновений (0-1)
    this.collisionCheckRadius = 200; // Радиус проверки коллизий для оптимизации
    this.debugCollisions = config.debugCollisions ?? false; // Визуализация коллизий
    this.playgroundDebugMode = config.playgroundDebugMode ?? false;
    this.windDebugLoggingEnabled = this.playgroundDebugMode && this.debugCollisions;
    this.collisionHandler = new CollisionHandler({
      enableCollisions: this.enableCollisions,
      collisionDamping: this.collisionDamping,
      collisionCheckRadius: this.collisionCheckRadius,
      debugCollisions: this.debugCollisions
    });
    this._collisionFrameStride = 1;
    this._collisionFrameCounter = 0;
    
    // Параметры ветра
    this.windEnabled = config.windEnabled ?? false;
    this.windDirection = config.windDirection ?? 'left';
    this.windStrength = config.windStrength ?? 0.5;
    this.windGustFrequency = config.windGustFrequency ?? 3;
    this.windTime = 0;
    this.currentWindForce = 0;
    this.currentWindLift = 0; // Вертикальная составляющая ветра
    this.prevWindForce = 0;
    this.prevWindLift = 0;
    this.windDirectionPhase = Math.random() * Math.PI * 2;
    this.lastWindLogged = false;

    if (this.windDebugLoggingEnabled) {
      console.log('🌬️ Fallback2DRenderer initialized with wind config:', {
        windEnabled: this.windEnabled,
        windDirection: this.windDirection,
        windStrength: this.windStrength,
        windGustFrequency: this.windGustFrequency
      });
    }
  }

  /**
   * Возвращает стабильные размеры viewport в CSS-пикселях.
   * Некоторые сайты/режимы кратковременно отдают 0, поэтому используем несколько источников.
   * @private
   */
  _getViewportSize() {
    const vv = window.visualViewport;
    const width =
      window.innerWidth ||
      document.documentElement?.clientWidth ||
      document.body?.clientWidth ||
      vv?.width ||
      0;
    const height =
      window.innerHeight ||
      document.documentElement?.clientHeight ||
      document.body?.clientHeight ||
      vv?.height ||
      0;

    return {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height))
    };
  }

  /**
   * Найти безопасную позицию спауна, чтобы снежинка не пересекалась с существующими
   * @private
   */
  _findSafeSpawnX(newSize) {
    const width = window.innerWidth;
    const minCollisionDistance = newSize; // Минимальное расстояние для избежания перекрытия
    const attempts = 20; // Количество попыток найти безопасное место
    
    for (let attempt = 0; attempt < attempts; attempt++) {
      const x = Math.random() * width;
      let isSafe = true;
      
      // Проверяем расстояние до всех существующих снежинок
      if (this.flakes && this.flakes.length > 0) {
        for (const flake of this.flakes) {
          if (!flake) continue;
          if (flake.isAwaitingRespawn) continue;
          
          const dx = x - (flake.baseX ?? flake.x);
          // Проверяем только по X, так как по Y они находятся выше экрана
          const minDistance = minCollisionDistance + (flake.collisionSize ?? flake.size ?? 20);
          
          if (Math.abs(dx) < minDistance * 0.5) {
            isSafe = false;
            break;
          }
        }
      }
      
      if (isSafe) return x;
    }
    
    // Если не удалось найти за 20 попыток, возвращаем случайную позицию
    return Math.random() * width;
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
   * Подготовить кэш многострочного рендера предложения.
   * Вызывается при init и при смене текста после респауна.
   * @private
   */
  _prepareSentenceRenderData(flake) {
    if (!this.ctx || !flake?.isSentence) return;

    const fontSize = Math.max(10, flake.size * 0.3);
    const maxWidth = flake.size * 2;
    const text = String(flake.char || '');
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    this.ctx.font = `bold ${fontSize}px Arial, sans-serif`;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = this.ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;

    flake.sentenceFont = `bold ${fontSize}px Arial, sans-serif`;
    flake.sentenceLines = lines;
    flake.sentenceLineHeight = lineHeight;
    flake.sentenceStartY = -totalHeight / 2 + lineHeight / 2;
  }

  /**
   * Респаун снежинки в верхней части экрана.
   * @private
   */
  _respawnFlake(flake) {
    flake.y = -flake.size;
    const newX = this._findSafeSpawnX(flake.size);
    flake.x = newX;
    flake.baseX = newX;
    flake.phase = Math.random() * Math.PI * 2;
    flake._sinPhase = Math.sin(flake.phase);
    const newRotation = Math.random() * Math.PI * 2;
    flake.rotation = newRotation;
    flake.cumulativeSpin = newRotation;
    flake.rotationSpeed = 0;
    flake.velocityX = 0;
    flake.velocityY = 0;
    flake.isAwaitingRespawn = false;

    if (flake.isSentence) {
      flake.char = this._nextSentence();
      this._prepareSentenceRenderData(flake);
    }
  }

  /**
   * Помещает снежинку в режим ожидания респауна до восстановления FPS.
   * @private
   */
  _deferRespawn(flake, worldHeight) {
    flake.y = worldHeight + flake.size * 2;
    flake.velocityX = 0;
    flake.velocityY = 0;
    flake.isAwaitingRespawn = true;
  }

  /**
   * Проверка числового значения на корректность.
   * @private
   */
  _isFiniteNumber(value) {
    return Number.isFinite(value);
  }

  /**
   * Санитизация состояния снежинки. Возвращает true, если был выполнен аварийный сброс.
   * @private
   */
  _sanitizeFlakeState(flake, worldWidth, worldHeight, canRespawnFlake) {
    const hasInvalidState =
      !this._isFiniteNumber(flake.size) ||
      flake.size <= 0 ||
      !this._isFiniteNumber(flake.x) ||
      !this._isFiniteNumber(flake.baseX) ||
      !this._isFiniteNumber(flake.y) ||
      !this._isFiniteNumber(flake.velocityX) ||
      !this._isFiniteNumber(flake.velocityY) ||
      !this._isFiniteNumber(flake.phase) ||
      !this._isFiniteNumber(flake.rotationSpeed) ||
      !this._isFiniteNumber(flake.cumulativeSpin) ||
      !this._isFiniteNumber(flake.fallSpeed);

    if (hasInvalidState) {
      const safeSize = this._isFiniteNumber(flake.size) && flake.size > 0 ? flake.size : 24;
      flake.size = safeSize;
      flake.collisionSize = this._isFiniteNumber(flake.collisionSize) && flake.collisionSize > 0
        ? flake.collisionSize
        : safeSize;
      flake.fallSpeed = this._isFiniteNumber(flake.fallSpeed) ? flake.fallSpeed : (this.config.sinkspeed ?? 0.4) * safeSize;
      flake.speed = flake.fallSpeed;
      flake.velocityX = 0;
      flake.velocityY = 0;
      flake.phase = Math.random() * Math.PI * 2;
      flake._sinPhase = Math.sin(flake.phase);
      flake.rotationSpeed = 0;
      flake.cumulativeSpin = Math.random() * Math.PI * 2;
      flake.rotation = flake.cumulativeSpin;
      flake.x = Math.random() * worldWidth;
      flake.baseX = flake.x;
      flake.isGrabbed = false;
      flake.isAwaitingRespawn = false;

      if (canRespawnFlake()) {
        this._respawnFlake(flake);
      } else {
        this._deferRespawn(flake, worldHeight);
      }
      return true;
    }

    const maxVerticalDrift = Math.max(2000, worldHeight * 2);
    if (flake.y > worldHeight + maxVerticalDrift || flake.y < -maxVerticalDrift) {
      if (canRespawnFlake()) {
        this._respawnFlake(flake);
      } else {
        this._deferRespawn(flake, worldHeight);
      }
      return true;
    }

    return false;
  }

  /**
   * Инициализация 2D контекста
   * @returns {boolean} true если успешно
   */
  init() {
    if (!this.canvas || typeof this.canvas.getContext !== 'function') return false;

    try {
      this.ctx = this.canvas.getContext('2d');
    } catch (err) {
      console.warn('2D context unavailable, skipping fallback.', err);
      return false;
    }

    if (!this.ctx) return false;

    const { snowmax, snowminsize, snowmaxsize, sinkspeed, snowcolor, snowletters, snowsentences, sentenceCount } = this.config;

    const sizeRange = snowmaxsize - snowminsize;
    
    const hasGlyphs = snowletters && snowletters.length > 0;
    const hasSentences = snowsentences && snowsentences.length > 0;
    
    // Количество текстовых снежинок ограничено настройкой sentenceCount
    const maxSentenceInstances = hasSentences ? Math.min(sentenceCount || 0, snowmax) : 0;

    this.sentenceQueue = hasSentences ? snowsentences : [];
    this.sentenceCursor = 0;

    // Создаем снежинки - контролируемое количество предложений + глифы
    this.flakes = []; // Инициализируем как пустой массив для безопасного спауна
    
    const totalFlakes = Math.max(1, snowmax);
    const initialActive = Math.min(totalFlakes, this.initialActiveFlakes);

    const activeMask = this._buildDistributedSlotMask(totalFlakes, initialActive);
    const sentenceMask = hasSentences
      ? this._buildDistributedSlotMask(totalFlakes, maxSentenceInstances)
      : new Array(totalFlakes).fill(false);
    let glyphCursor = 0;

    for (let idx = 0; idx < totalFlakes; idx++) {
      // Выбираем между глифами и предложениями на основе sentenceCount
      let textItem;
      const isSentence = sentenceMask[idx];
      const isInitiallyActive = activeMask[idx];
      
      if (isSentence) {
        // Равномерно распределенные слоты предложений
        textItem = this._nextSentence();
      } else if (hasGlyphs) {
        // Слоты глифов
        textItem = snowletters[glyphCursor % snowletters.length];
        glyphCursor++;
      } else {
        // Если нет глифов, используем дефолтный
        textItem = '❄';
      }
      
      // Предложения должны быть больше
      const size = isSentence 
        ? Math.max(snowmaxsize * 1.2, 60) + Math.random() * 20
        : snowminsize + Math.random() * sizeRange;
      
      // Размер коллизии точно соответствует фактическому размеру отрисованного глифа
      // Это гарантирует физически точные столкновения
      const collisionSize = size;
      
      const speed = sinkspeed * (size / 20) * 20;
      const color = snowcolor[idx % snowcolor.length];
      
      // Используем функцию поиска безопасной позиции спауна
      const x = this._findSafeSpawnX(size);
      const initialRotation = Math.random() * Math.PI * 2; // Случайный начальный угол для разнообразия
      const initialPhase = Math.random() * Math.PI * 2;

      this.flakes.push({
        x,
        baseX: x,
        y: isInitiallyActive
          ? (-size - Math.random() * window.innerHeight * 0.5)
          : (window.innerHeight + size * 2),
        size,
        collisionSize,
        speed,
        fallSpeed: speed,
        sway: 10 + Math.random() * 25,
        phase: initialPhase,
        freq: 0.8 + Math.random() * 1.4,
        color,
        char: textItem,
        isSentence,
        rotationSpeed: 0,
        cumulativeSpin: initialRotation,
        velocityX: 0,
        velocityY: 0,
        isAwaitingRespawn: !isInitiallyActive,
        isGrabbed: false,
        // Предвычисленные поля для горячего цикла рендера
        _sizeRatio: Math.sqrt(size / 20),
        _collisionRadius: size * 0.5,
        _swayBuffer: Math.sin(0.35) * size * 0.5,
        _sinPhase: Math.sin(initialPhase)
      });

      const flake = this.flakes[this.flakes.length - 1];
      if (flake.isSentence) {
        this._prepareSentenceRenderData(flake);
      } else {
        flake.glyphFont = `${Math.max(16, flake.size)}px serif`;
      }
    }

    return true;
  }

  /**
   * Обработка коллизий между снежинками с использованием CollisionHandler
   */
  handleCollisions(delta = 0.016) {
    if (!this.collisionHandler || !this.enableCollisions) return;
    this.collisionHandler.handleCollisions(this.flakes, delta);
  }

  /**
   * Запускает рендеринг
   */
  start() {
    const ctx = this.ctx;
    const { snowminsize, snowmaxsize } = this.config;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    let lastFrameTime = performance.now();
    const draw = (now = performance.now()) => {
      const rawDelta = Math.min((now - lastFrameTime) / 1000, 0.05);
      lastFrameTime = now;

      // EMA по frame-delta (а не по fps): медленные кадры вносят больший вклад,
      // поэтому просадки fps детектируются точнее чем при EMA(1/delta).
      this._avgFrameDelta = this._avgFrameDelta * (1 - this.fpsSmoothing) + rawDelta * this.fpsSmoothing;
      this.currentFpsEstimate = 1 / this._avgFrameDelta;
      // Для физики используем реальный rawDelta (не сглаженный), только ограничиваем
      // сверху чтобы снежинки не прыгали после длинной паузы вкладки.
      const delta = Math.min(rawDelta, 1 / 20);

      // Авто-калибровка: первые 60 кадров определяют базовый fps монитора (60/120/144 Hz и т.д.)
      if (!this._calibrated) {
        this._calibrationDeltaSum += rawDelta;
        this._calibrationCount++;
        if (this._calibrationCount >= 60) {
          const baseDelta = this._calibrationDeltaSum / this._calibrationCount;
          this._avgFrameDelta = baseDelta;
          this.currentFpsEstimate = 1 / baseDelta;
          if (!this._pauseFpsCustom) this.respawnPauseFps = this.currentFpsEstimate * 0.95;
          if (!this._resumeFpsCustom) this.respawnResumeFps = this.currentFpsEstimate * 0.98;
          this._calibrated = true;
        }
      }

      if (this.allowNewFlakes && this.currentFpsEstimate < this.respawnPauseFps) {
        this.allowNewFlakes = false;
      } else if (!this.allowNewFlakes && this.currentFpsEstimate >= this.respawnResumeFps) {
        this.allowNewFlakes = true;
      }

      let forcedRespawnBudget = 0;
      if (!this.allowNewFlakes) {
        let activeFlakeCount = 0;
        for (let i = 0; i < this.flakes.length; i++) {
          if (!this.flakes[i]?.isAwaitingRespawn) {
            activeFlakeCount++;
          }
        }

        const minActive = Math.min(this.flakes.length, this.minActiveFlakesWhenThrottled);
        if (activeFlakeCount < minActive) {
          forcedRespawnBudget = minActive - activeFlakeCount;
        }
      }

      // Равномерный респаун предотвращает стартовый burst и выравнивает нагрузку на CPU.
      this._respawnCredit = Math.min(
        this.maxRespawnBurst,
        this._respawnCredit + delta * this.maxRespawnsPerSecond
      );
      let respawnRateBudget = Math.floor(this._respawnCredit);
      this._respawnCredit -= respawnRateBudget;

      const canRespawnFlake = () => {
        if (this.allowNewFlakes) {
          if (respawnRateBudget > 0) {
            respawnRateBudget--;
            return true;
          }
          return false;
        }
        if (forcedRespawnBudget > 0) {
          forcedRespawnBudget--;
          return true;
        }
        return false;
      };

      const flakeCount = this.flakes.length;
      if (flakeCount >= 260 || this.currentFpsEstimate < 42) {
        this._collisionFrameStride = 5;
      } else if (flakeCount >= 180 || this.currentFpsEstimate < 48) {
        this._collisionFrameStride = 4;
      } else if (flakeCount >= 120 || this.currentFpsEstimate < 54) {
        this._collisionFrameStride = 3;
      } else if (flakeCount >= 80 || this.currentFpsEstimate < 58) {
        this._collisionFrameStride = 2;
      } else {
        this._collisionFrameStride = 1;
      }

      // Гистерезис: переключаемся в low-quality при fps < 48, выходим только при fps > 54.
      // Без гистерезиса режим мог переключаться каждый кадр при fps ~52, вызывая прыжки.
      // При смене режима поглощаем/изымаем swingAngle в cumulativeSpin, чтобы не было
      // визуального скачка угла — рендерный finalRotation при этом не изменится.
      if (!this.lowQualityMode && flakeCount >= 100 && this.currentFpsEstimate < 48) {
        this.lowQualityMode = true;
        for (let _i = 0; _i < this.flakes.length; _i++) {
          const _f = this.flakes[_i];
          if (_f.isAwaitingRespawn || _f.isGrabbed) continue;
          _f.cumulativeSpin = (_f.cumulativeSpin || 0) + (_f._sinPhase || 0) * 0.35 * (_f.swayLimit ?? 1.0);
        }
      } else if (this.lowQualityMode && this.currentFpsEstimate > 54) {
        this.lowQualityMode = false;
        for (let _i = 0; _i < this.flakes.length; _i++) {
          const _f = this.flakes[_i];
          if (_f.isAwaitingRespawn || _f.isGrabbed) continue;
          _f.cumulativeSpin = (_f.cumulativeSpin || 0) - (_f._sinPhase || 0) * 0.35 * (_f.swayLimit ?? 1.0);
        }
      }

      const ratio = Math.min(window.devicePixelRatio || 1, this.canvas2dMaxDpr);
      const viewport = this._getViewportSize();
      const worldWidth = viewport.width;
      const worldHeight = viewport.height;
      const width = Math.floor(worldWidth * ratio);
      const height = Math.floor(worldHeight * ratio);

      // Обновляем размер canvas если изменился
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);

      // Обновляем параметры ветра
      if (this.windEnabled) {
        this.windTime += delta;

        // Реалистичный ветер: смесь долгих циклов, порывов и турбулентности
        const baseFreq = Math.max(0.1, this.windGustFrequency * 0.5);
        const baseTime = (this.windTime / (20 / baseFreq)) % 1.0;
        const baseWind = Math.sin(baseTime * Math.PI) * 0.6;

        const midFreq = this.windGustFrequency;
        const midTime = (this.windTime / (10 / midFreq)) % 1.0;
        const midWind = Math.sin(midTime * Math.PI * 2) * Math.cos(this.windTime * 0.3) * 0.25;

        const highFreq1 = Math.sin(this.windTime * 1.7) * Math.exp(-0.1 * (this.windTime % 5)) * 0.06;
        const highFreq2 = Math.sin(this.windTime * 2.9 + Math.cos(this.windTime)) * 0.04;
        const highFreq3 = Math.sin(this.windTime * 4.1) * Math.sin(this.windTime * 0.7) * 0.018; // значение 0.016 приводит к вращению
        const turbulence = highFreq1 + highFreq2 + highFreq3;

        let gust = baseWind + midWind + turbulence;
        gust = Math.max(-1, Math.min(1, gust));
        const gustIntensity = Math.min(1, Math.abs(gust));

        let directionFactor = 1;
        if (this.windDirection === 'left') {
          directionFactor = -1;
        } else if (this.windDirection === 'right') {
          directionFactor = 1;
        } else {
          const dirTime = this.windTime * 0.12 + this.windDirectionPhase;
          const dirNoise = Math.sin(dirTime) + Math.sin(dirTime * 0.23 + Math.cos(this.windTime * 0.05)) * 0.35;
          directionFactor = Math.max(-1, Math.min(1, dirNoise));
        }

        const targetWindForce = directionFactor * gustIntensity * this.windStrength;
        const targetWindLift = gustIntensity * 0.3 * this.windStrength;

        const windSmoothFactor = 0.05;
        this.currentWindForce = this.prevWindForce * (1 - windSmoothFactor) + targetWindForce * windSmoothFactor;
        this.currentWindLift = this.prevWindLift * (1 - windSmoothFactor) + targetWindLift * windSmoothFactor;
        this.prevWindForce = this.currentWindForce;
        this.prevWindLift = this.currentWindLift;

        if (this.windDebugLoggingEnabled && gustIntensity > 0.5 && !this.lastWindLogged) {
          console.log('🌬️ Wind is blowing with turbulence:', {
            direction: this.windDirection,
            strength: this.windStrength,
            force: this.currentWindForce.toFixed(2),
            turbulence: gustIntensity.toFixed(2)
          });
          this.lastWindLogged = true;
        } else if (gustIntensity <= 0.5) {
          this.lastWindLogged = false;
        }
      } else {
        this.currentWindForce = 0;
        this.currentWindLift = 0;
        this.prevWindForce = 0;
        this.prevWindLift = 0;
      }

      if (this.mouseBurstTimer > 0) {
        this.mouseBurstTimer = Math.max(0, this.mouseBurstTimer - delta);
        if (this.mouseBurstTimer === 0) {
          this.mouseBurstMode = null;
        }
      }

      const flakes = this.flakes;
      const burstActive = this.mouseBurstTimer > 0;
      const radiusMultiplier = burstActive ? this.mouseBurstRadiusMultiplier : 1;
      const interactionRadius = this.mouseRadius * radiusMultiplier;
      const interactionRadiusSq = interactionRadius * interactionRadius;
      const mouseVx = this.mouseVelocityX;
      const mouseVy = this.mouseVelocityY;
      const mouseSpeed = Math.sqrt(mouseVx * mouseVx + mouseVy * mouseVy);
      const isMouseActive = mouseSpeed > this.mouseActivityThreshold;
      const activityFactor = isMouseActive ? 1 : 0;
      const shouldApplyMouse = burstActive || isMouseActive;
      const isMouseFast = mouseSpeed > this.mouseDragThreshold;
      const mouseVelMag = mouseSpeed > 0 ? mouseSpeed : 0;

      // ПЕРВЫЙ ПРОХОД: Обновляем физику и позиции для всех снежинок
      for (let i = 0; i < flakes.length; i++) {
        const flake = flakes[i];

        if (this._sanitizeFlakeState(flake, worldWidth, worldHeight, canRespawnFlake)) {
          if (flake.isAwaitingRespawn) {
            continue;
          }
        }

        if (flake.isAwaitingRespawn) {
          if (canRespawnFlake()) {
            this._respawnFlake(flake);
          } else {
            continue;
          }
        }

        // Применяем физику взаимодействия с мышью
        const dx = flake.x - this.mouseX;
        const dy = flake.y - this.mouseY;
        const distanceSq = dx * dx + dy * dy;

        if (!this.mouseLeftPressed && !this.mouseRightPressed && flake.isGrabbed) {
          flake.isGrabbed = false;
          flake.swayLimit = 1.0;
        }
        
        if (distanceSq < interactionRadiusSq && shouldApplyMouse) {
          const distance = Math.sqrt(distanceSq);
          const influence = 1 - distance / interactionRadius;
          const burstFactor = burstActive ? Math.min(1, this.mouseBurstTimer / this.mouseBurstDuration) : 0;
          const activeInfluence = influence * Math.max(activityFactor, burstFactor);
          
          // Кратковременный взрыв/втягивание при клике
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
            if (mouseVelMag > 0) {
              const mouseDirX = mouseVx / mouseVelMag;
              const mouseDirY = mouseVy / mouseVelMag;
              
              // Притягиваем снежинку в сторону движения мыши
              const dragForce = activeInfluence * this.mouseDragStrength * (mouseSpeed / 1000);
              flake.velocityX += mouseDirX * dragForce * delta * 1000;
              flake.velocityY += mouseDirY * dragForce * delta * 1000;
            }
          } else {
            // Обычное отталкивание при медленном движении
            const force = activeInfluence * this.mouseForce;
            const safeDistance = Math.max(distance, 0.0001);
            const nx = dx / safeDistance;
            const ny = dy / safeDistance;
            const verticalBias = ny < 0 ? 0.35 : 1.0;
            const accel = force * delta;
            flake.velocityX += nx * accel;
            flake.velocityY += ny * accel * verticalBias;
          }
          
          // Передаем импульс от движения мыши
          const impulseStrength = activeInfluence * this.mouseImpulseStrength;
          flake.velocityX += mouseVx * impulseStrength * delta;
          flake.velocityY += mouseVy * impulseStrength * delta;
          
          // Вращение снежинки при движении мыши рядом
          // Направление вращения зависит от того, с какой стороны пролетела мышка
          // mouseSpeed уже объявлена выше в этом forEach-коллбэке
          // Применяем вращение только если скорость мыши выше порога (> 10 пиксели/сек)
          // Это предотвращает вращение от дрожания мыши
          if (mouseSpeed > 10) {
            const cross = dx * mouseVy - dy * mouseVx;
            const rotationDirection = Math.sign(cross); // +1 или -1
            const rotationForce = activeInfluence * mouseSpeed * 0.01 * rotationDirection;
            flake.rotationSpeed = (flake.rotationSpeed || 0) + rotationForce * delta;
          }
          
          if (!this.mouseLeftPressed && !this.mouseRightPressed) {
            if (flake.isGrabbed) {
              flake.grabOffsetX = undefined;
              flake.grabOffsetY = undefined;
            }
            flake.isGrabbed = false;
            flake.swayLimit = 1.0;
          }
        }

        // Ограничиваем экстремальные скорости, чтобы исключить резкие выбросы
        // при высокочастотных mousemove событиях и рывках delta.
        const maxSpeed = this.maxFlakeSpeed * (flake._sizeRatio || 1);
        const speedSq = flake.velocityX * flake.velocityX + flake.velocityY * flake.velocityY;
        const maxSpeedSq = maxSpeed * maxSpeed;
        if (speedSq > maxSpeedSq) {
          const scale = maxSpeed / Math.sqrt(speedSq);
          flake.velocityX *= scale;
          flake.velocityY *= scale;
        }
        flake.rotationSpeed = clamp(flake.rotationSpeed || 0, -this.maxRotationSpeed, this.maxRotationSpeed);

        // Применяем импульс к позиции (скорость в px/сек, умножаем на delta)
        flake.baseX += flake.velocityX * delta;
        flake.y += flake.velocityY * delta;
        // Обновляем визуальную позицию (с покачиванием)
        flake.x = flake.baseX;

        if (!flake.isGrabbed) {
          flake.phase += flake.freq * delta;
          // Нормализуем phase чтобы предотвратить потерю точности float64 при длинных сессиях
          if (flake.phase > 6283.185 || flake.phase < -6283.185) {
            flake.phase = flake.phase % (Math.PI * 2);
          }
          flake._sinPhase = Math.sin(flake.phase);
          flake.cumulativeSpin = (flake.cumulativeSpin || 0) + (flake.rotationSpeed || 0) * delta;
          // Нормализуем cumulativeSpin чтобы предотвратить потерю точности float64
          // при очень длинных сессиях (> ~1000 оборотов)
          if (flake.cumulativeSpin > 6283.185 || flake.cumulativeSpin < -6283.185) {
            flake.cumulativeSpin = flake.cumulativeSpin % (Math.PI * 2);
          }
          flake.y += flake.fallSpeed * delta;
        } else {
          flake._sinPhase = 0;
        }

        // Сброс позиции если вышла за экран
        if (flake.y - flake.size * 0.5 > worldHeight) {
          if (canRespawnFlake()) {
            this._respawnFlake(flake);
          } else {
            this._deferRespawn(flake, worldHeight);
          }
        }
      }
      
      // Применяем ветер как горизонтальное ускорение (и вертикальный лифт)
      if (this.currentWindForce !== 0 || this.currentWindLift !== 0) {
        const wf = this.currentWindForce;
        const wl = this.currentWindLift;
        for (let wi = 0; wi < flakes.length; wi++) {
          const flake = flakes[wi];
          if (flake.isAwaitingRespawn || flake.isGrabbed) continue;
          const sr = flake._sizeRatio;
          if (wf !== 0) flake.velocityX += wf * sr * 40 * delta;
          if (wl !== 0) flake.velocityY += -wl * sr * 70 * delta;
        }
      }
      
      // КРИТИЧНЫЙ ШАГ: Обрабатываем коллизии между снежинками ДО рендеринга
      // При высокой нагрузке считаем коллизии реже, чтобы стабилизировать FPS.
      this._collisionFrameCounter = (this._collisionFrameCounter + 1) % this._collisionFrameStride;
      if (this._collisionFrameCounter === 0) {
        this.handleCollisions(delta);
      }
      
      // Затухание + портальное перемещение — один проход
      const damping = Math.pow(0.98, delta * 60);
      for (let i = 0; i < flakes.length; i++) {
        const flake = flakes[i];
        if (flake.isAwaitingRespawn) continue;
        if (!flake.isGrabbed) {
          flake.velocityX *= damping;
          flake.velocityY *= damping;
          const rs = (flake.rotationSpeed || 0) * damping;
          flake.rotationSpeed = Math.abs(rs) < 0.0001 ? 0 : rs;
        }
        const cr = flake._collisionRadius;
        if (flake.x + cr < 0) {
          flake.x = worldWidth + cr;
          flake.baseX = flake.x;
        } else if (flake.x - cr > worldWidth) {
          flake.x = -cr;
          flake.baseX = flake.x;
        }
      }

      // ВТОРОЙ ПРОХОД: Рендерим каждую снежинку
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let lastFillStyle = '';
      let lastFont = '';

      for (let i = 0; i < flakes.length; i++) {
        const flake = flakes[i];
        if (flake.isAwaitingRespawn) continue;
        const cullMargin = flake.size * 2;
        if (flake.y < -cullMargin || flake.y > worldHeight + cullMargin) {
          continue;
        }

        // Позиция БЕЗ горизонтального смещения (качание теперь визуальное через ротацию)
        const x = flake.x * ratio;
        const y = flake.y * ratio;

        if (lastFillStyle !== flake.color) {
          ctx.fillStyle = flake.color;
          lastFillStyle = flake.color;
        }
        // В low quality режиме вращение не обновляется — cumulativeSpin заморожен.
        // Но setTransform всегда выставляет x,y + вращение из cumulativeSpin,
        // чтобы координатное пространство оставалось единым и снежинки не прыгали
        // при переключении режима.
        const swayLimit = flake.swayLimit ?? 1.0;
        const swingAngle = (!this.lowQualityMode && !flake.isGrabbed)
          ? (flake._sinPhase || 0) * 0.35 * swayLimit
          : 0;
        const finalRotation = (flake.cumulativeSpin || 0) + swingAngle;
        const cosR = Math.cos(finalRotation);
        const sinR = Math.sin(finalRotation);
        ctx.setTransform(cosR, sinR, -sinR, cosR, x, y);

        if (flake.isSentence) {
          const sentenceFont = flake.sentenceFont || `bold ${Math.max(10, flake.size * 0.3)}px Arial, sans-serif`;
          if (lastFont !== sentenceFont) {
            ctx.font = sentenceFont;
            lastFont = sentenceFont;
          }

          const lines = flake.sentenceLines || [String(flake.char || '')];
          const lineHeight = flake.sentenceLineHeight || Math.max(10, flake.size * 0.3) * 1.2;
          const startY = flake.sentenceStartY ?? (-lineHeight / 2);

          for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const lineY = startY + lineIdx * lineHeight;
            const line = lines[lineIdx];
            ctx.fillText(line, 0, lineY);
          }
        } else {
          const glyphFont = flake.glyphFont || `${Math.max(16, flake.size)}px serif`;
          if (lastFont !== glyphFont) {
            ctx.font = glyphFont;
            lastFont = glyphFont;
          }
          ctx.fillText(flake.char, 0, 0);
        }
      }

      // Сбрасываем transform после render-прохода (был setTransform на каждую снежинку)
      ctx.resetTransform();

      // DEBUG: Визуализация коллизий
      if (this.debugCollisions) {
        this.flakes.forEach((flake) => {
          if (flake.isAwaitingRespawn) return;
          const x = flake.x * ratio;
          const y = flake.y * ratio;
          const collisionRadius = (flake.collisionSize ?? flake.size ?? 20) * 0.5 * ratio;
          
          ctx.save();
          
          // Рисуем границу коллизии
          ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, collisionRadius, 0, Math.PI * 2);
          ctx.stroke();
          
          // Рисуем центр
          ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
          
          // Рисуем вектор скорости
          if (flake.velocityX || flake.velocityY) {
            const velScale = 0.5;
            ctx.strokeStyle = 'rgba(0, 255, 0, 0.7)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + flake.velocityX * velScale * ratio, y + flake.velocityY * velScale * ratio);
            ctx.stroke();
          }
          
          // Показываем rotationSpeed
          if (flake.rotationSpeed && Math.abs(flake.rotationSpeed) > 0.001) {
            ctx.fillStyle = 'rgba(255, 255, 0, 0.9)';
            ctx.font = '10px monospace';
            ctx.fillText(`ω: ${flake.rotationSpeed.toFixed(3)}`, x + collisionRadius + 5, y);
          }
          
          ctx.restore();
        });
      }

      this.frameRequest = requestAnimationFrame(draw);
    };

    this.drawCallback = draw;
    draw(performance.now());
  }

  /**
   * Останавливает рендеринг
   */
  stop() {
    if (this.frameRequest) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }
    this.drawCallback = null;
    this.flakes = [];
    this.ctx = null;
  }

  /**
   * Приостанавливает рендеринг
   */
  pause() {
    if (this.frameRequest) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }
  }

  /**
   * Возобновляет рендеринг
   */
  resume() {
    if (this.drawCallback) {
      this.frameRequest = requestAnimationFrame(this.drawCallback);
    }
  }

  _nextSentence() {
    const count = this.sentenceQueue.length;
    if (!count) return '';
    const index = this.sentenceCursor % count;
    this.sentenceCursor = (this.sentenceCursor + 1) % count;
    return this.sentenceQueue[index];
  }

  /**
   * Обновление позиции мыши
   * @param {number} x - X координата
   * @param {number} y - Y координата
   * @param {number} vx - Скорость по X
   * @param {number} vy - Скорость по Y
   */
  updateMousePosition(x, y, vx = 0, vy = 0) {
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const maxMouseV = this.maxMouseVelocity;
    const smooth = clamp(this.mouseVelocitySmoothing, 0.05, 1);

    // При idle-сигнале сразу гасим скорость, чтобы поле влияния не оставалось активным.
    if (Math.abs(vx) < 0.001 && Math.abs(vy) < 0.001) {
      this.mouseX = x;
      this.mouseY = y;
      this.mouseVelocityX = 0;
      this.mouseVelocityY = 0;
      return;
    }

    const clampedVx = clamp(vx, -maxMouseV, maxMouseV);
    const clampedVy = clamp(vy, -maxMouseV, maxMouseV);

    this.mouseX = x;
    this.mouseY = y;
    this.mouseVelocityX = this.mouseVelocityX * (1 - smooth) + clampedVx * smooth;
    this.mouseVelocityY = this.mouseVelocityY * (1 - smooth) + clampedVy * smooth;
  }

  /**
   * Обработчик нажатия кнопки мыши
   * @param {number} x - X координата
   * @param {number} y - Y координата
   */
  onMouseDown(x, y, button) {
    if (button === 0) {
      this.mouseLeftPressed = true;
      this.mouseBurstMode = 'explode';
      this.mouseBurstTimer = this.mouseBurstDuration;
    }
    if (button === 2) {
      this.mouseRightPressed = true;
      this.mouseBurstMode = 'suction';
      this.mouseBurstTimer = this.mouseBurstDuration;
    }
    this.mouseX = x;
    this.mouseY = y;
  }

  /**
   * Обработчик отпускания кнопки мыши
   */
  onMouseUp(button) {
    if (button === 0) this.mouseLeftPressed = false;
    if (button === 2) this.mouseRightPressed = false;
    // Отпускаем все захваченные снежинки
    if (this.flakes) {
      this.flakes.forEach(flake => {
        flake.isGrabbed = false;
      });
    }
  }

  /**
   * Обработчик выхода мыши за пределы canvas
   */
  onMouseLeave() {
    this.mouseLeftPressed = false;
    this.mouseRightPressed = false;
    this.mouseBurstTimer = 0;
    this.mouseBurstMode = null;
    this.mouseX = -1000;
    this.mouseY = -1000;
    this.mouseVelocityX = 0;
    this.mouseVelocityY = 0;
  }
}
