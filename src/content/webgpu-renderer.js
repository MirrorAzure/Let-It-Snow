/**
 * WebGPU рендерер снежинок
 */

import shaderSource from './shader.wgsl?raw';
import { hexToRgb } from './utils/color-utils.js';
import { BackgroundMonitor } from './utils/background-monitor.js';
import { AtlasManager } from './graphics/atlas-manager.js';
import { UniformBufferManager } from './graphics/uniform-buffer.js';
import { SimulationEngine } from './physics/simulation-engine.js';
import { CollisionHandler } from './physics/collision-handler.js';
import { MouseHandler } from './physics/mouse-handler.js';

/**
 * Класс для рендеринга снега через WebGPU
 */
export class WebGPURenderer {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.context = null;
    this.device = null;
    this.pipeline = null;
    this.instances = [];
    this.instanceBuffer = null;
    this.instanceData = null;
    this.quadBuffer = null;
    this.canvasWidth = 0;
    this.canvasHeight = 0;
    this.viewportWidth = 0;
    this.viewportHeight = 0;
    this.frameRequest = null;
    this.resizeObserver = null;
    this.lastTimestamp = 0;
    this.backgroundMonitor = null;
    
    // Инициализация компонентов
    this.atlasManager = null;
    this.uniformBufferManager = null;
    this.simulationEngine = null;
    this.collisionHandler = new CollisionHandler(config);
    this.mouseHandler = new MouseHandler(config);

    this.sentenceCursor = 0;

    // Параметры коллизий
    this.enableCollisions = config.enableCollisions ?? true;
    this.collisionCheckRadius = config.collisionCheckRadius ?? 600;
    this.collisionDamping = config.collisionDamping ?? 0.7;
    this.debugCollisions = config.debugCollisions ?? false;
    this.playgroundDebugMode = config.playgroundDebugMode ?? false;
    this.windDebugLoggingEnabled = this.playgroundDebugMode && this.debugCollisions;
    
    // Debug overlay canvas для визуализации коллизий
    this.debugCanvas = null;
    this.debugCtx = null;

    // Параметры взаимодействия с мышью
    this.mouseX = -1000;
    this.mouseY = -1000;
    this.mouseVelocityX = 0;
    this.mouseVelocityY = 0;
    this.mouseLeftPressed = false;
    this.mouseRightPressed = false;
    this.mouseBurstDuration = 0.2;
    this.mouseBurstRadiusMultiplier = 3.5;
    this.mouseBurstTimer = 0;
    this.mouseBurstMode = null;
    this.mouseRadius = config.mouseRadius ?? 100;
    this.mouseForce = config.mouseForce ?? 300;
    this.mouseImpulseStrength = config.mouseImpulseStrength ?? 0.5;
    this.mouseDragThreshold = config.mouseDragThreshold ?? 500;
    this.mouseDragStrength = config.mouseDragStrength ?? 0.8;

    // Параметры ветра
    this.windEnabled = config.windEnabled ?? false;
    this.windDirection = config.windDirection ?? 'left';
    this.windStrength = config.windStrength ?? 0.5;
    this.windGustFrequency = config.windGustFrequency ?? 3;
    this.windTime = 0;
    this.currentWindForce = 0;
    this.currentWindLift = 0;
    this.prevWindForce = 0;
    this.prevWindLift = 0;
    this.windDirectionPhase = Math.random() * Math.PI * 2;
    this.lastWindLogged = false;
  }

  /**
   * Возвращает стабильные размеры viewport в CSS-пикселях.
   * Некоторые страницы могут временно отдавать 0 при перестроении layout.
   * @private
   */
  _getViewportSize() {
    const vv = window.visualViewport;
    const width =
      window.innerWidth ||
      document.documentElement?.clientWidth ||
      document.body?.clientWidth ||
      vv?.width ||
      this.viewportWidth ||
      1;
    const height =
      window.innerHeight ||
      document.documentElement?.clientHeight ||
      document.body?.clientHeight ||
      vv?.height ||
      this.viewportHeight ||
      1;

    return {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height))
    };
  }

  /**
   * Геттер для совместимости с GifLayer
   * @returns {Array} Массив снежинок
   */
  get flakes() {
    return this.instances;
  }

  /**
   * Инициализация WebGPU
   * @returns {Promise<boolean>} true если успешно
   */
  async init() {
    if (!navigator.gpu) return false;

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return false;

    try {
      this.device = await adapter.requestDevice();
      const format = navigator.gpu.getPreferredCanvasFormat();

      // Инициализация компонентов
      this.uniformBufferManager = new UniformBufferManager(this.device);
      this.atlasManager = new AtlasManager(this.device, 64);
      this.simulationEngine = new SimulationEngine(this.config);

      this.setupGeometry();
      await this.setupPipeline(format);

      this.context = this.canvas.getContext('webgpu');
      if (!this.context) throw new Error('WebGPU context is unavailable');

      this.context.configure({
        device: this.device,
        format,
        alphaMode: 'premultiplied'
      });

      this.setupInstances();
      await this.atlasManager.initialize(this.config);
      this.glyphMonotoneFlags = this.atlasManager.getMonotoneFlags();
      this.uniformBufferManager.setGlyphParams(
        this.atlasManager.glyphAtlas.count,
        this.atlasManager.glyphAtlas.size,
        this.atlasManager.glyphAtlas.isMonotone
      );
      this.uniformBufferManager.setSentenceParams(
        this.atlasManager.sentenceAtlas.count,
        this.atlasManager.sentenceAtlas.size
      );
      this.uniformBufferManager.initialize();
      this.setupBindGroup();
      this.updateGlowState();
      this.startBackgroundMonitoring();
      this.handleResize();
      
      // Настройка debug canvas если включен
      if (this.debugCollisions) {
        this.setupDebugCanvas();
      }

      return true;
    } catch (error) {
      console.warn('WebGPU init failed, switching to 2D fallback.', error);
      this.cleanup();
      return false;
    }
  }

  /**
   * Настройка геометрии квада
   */
  setupGeometry() {
    const quad = new Float32Array([
      -0.5, -0.5, 0, 0,
      0.5, -0.5, 1, 0,
      -0.5, 0.5, 0, 1,
      -0.5, 0.5, 0, 1,
      0.5, -0.5, 1, 0,
      0.5, 0.5, 1, 1
    ]);

    this.quadBuffer = this.device.createBuffer({
      size: quad.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });

    new Float32Array(this.quadBuffer.getMappedRange()).set(quad);
    this.quadBuffer.unmap();
  }

  /**
   * Настройка render pipeline
   * @param {string} format - Формат текстуры
   */
  async setupPipeline(format) {
    const shaderModule = this.device.createShaderModule({
      code: shaderSource
    });

    // Проверка компиляции шейдера
    const compilationInfoPromise = shaderModule.getCompilationInfo
      ? shaderModule.getCompilationInfo()
      : shaderModule.compilationInfo
        ? shaderModule.compilationInfo()
        : null;

    if (compilationInfoPromise) {
      const compilationInfo = await compilationInfoPromise;
      const errors = compilationInfo.messages?.filter((msg) => msg.type === 'error') || [];
      if (errors.length) {
        const details = errors.map((msg) => `${msg.lineNum}:${msg.linePos} ${msg.message}`).join(' | ');
        throw new Error(`WGSL compilation failed: ${details}`);
      }
    }

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs',
        buffers: [
          // Vertex buffer (квад)
          {
            arrayStride: 16,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x2' }
            ]
          },
          // Instance buffer (данные снежинок)
          {
            arrayStride: 56,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 2, offset: 0, format: 'float32x2' },
              { shaderLocation: 3, offset: 8, format: 'float32' },
              { shaderLocation: 4, offset: 12, format: 'float32' },
              { shaderLocation: 5, offset: 16, format: 'float32' },
              { shaderLocation: 6, offset: 20, format: 'float32' },
              { shaderLocation: 7, offset: 24, format: 'float32' },
              { shaderLocation: 8, offset: 28, format: 'float32' },
              { shaderLocation: 9, offset: 32, format: 'float32' },
              { shaderLocation: 10, offset: 36, format: 'float32x3' },
              { shaderLocation: 11, offset: 48, format: 'float32' },
              { shaderLocation: 12, offset: 52, format: 'float32' }
            ]
          }
        ]
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs',
        targets: [
          {
            format,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add'
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add'
              }
            }
          }
        ]
      },
      primitive: { topology: 'triangle-list' }
    });
  }

  /**
   * Настройка uniform буфера и bind группы
   */
  setupUniforms() {
    this.uniformBuffer = this.device.createBuffer({
      size: this.uniformArray.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.uniformBindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer }
        },
        {
          binding: 1,
          resource: this.glyphAtlas.sampler
        },
        {
          binding: 2,
          resource: this.glyphAtlas.texture.createView()
        },
        {
          binding: 3,
          resource: this.sentenceAtlas.sampler
        },
        {
          binding: 4,
          resource: this.sentenceAtlas.texture.createView()
        }
      ]
    });
  }

  /**
   * Настройка bind группы
   */
  setupBindGroup() {
    const bindGroupLayout = this.pipeline.getBindGroupLayout(0);
    const entries = [
      {
        binding: 0,
        resource: { buffer: this.uniformBufferManager.buffer }
      },
      {
        binding: 1,
        resource: this.atlasManager.glyphAtlas.sampler
      },
      {
        binding: 2,
        resource: this.atlasManager.glyphAtlas.texture.createView()
      },
      {
        binding: 3,
        resource: this.atlasManager.sentenceAtlas.sampler
      },
      {
        binding: 4,
        resource: this.atlasManager.sentenceAtlas.texture.createView()
      }
    ];

    this.uniformBindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries
    });
  }

  /**
   * Настройка instance данных (снежинок)
   */
  setupInstances() {
    const { snowmax, snowminsize, snowmaxsize, sinkspeed, snowcolor, snowletters, snowsentences, sentenceCount } = this.config;

    const sizeRange = snowmaxsize - snowminsize;
    const hasGlyphs = snowletters && snowletters.length > 0;
    const hasSentences = snowsentences && snowsentences.length > 0;
    const useDefaultGlyph = !hasGlyphs && !hasSentences;
    
    const maxSentenceInstances = hasSentences ? Math.min(sentenceCount || 0, snowmax) : 0;

    this.instances = [];

    for (let idx = 0; idx < Math.max(1, snowmax); idx++) {
      let glyphIndex;
      let isSentence = false;
      let sentenceIndex = 0;

      if (hasSentences && idx < maxSentenceInstances) {
        isSentence = true;
        sentenceIndex = 0;
        glyphIndex = (hasGlyphs ? snowletters.length : 1) + sentenceIndex;
      } else {
        const glyphCount = hasGlyphs ? snowletters.length : (useDefaultGlyph ? 1 : 0);
        glyphIndex = (idx - maxSentenceInstances) % (glyphCount || 1);
      }

      const size = isSentence 
        ? Math.max(snowmaxsize * 1.2, 60) + Math.random() * 20
        : snowminsize + Math.random() * sizeRange;
      
      const collisionSize = isSentence 
        ? Math.max(snowminsize, 20) + Math.random() * 15
        : size;
      
      const colorHex = snowcolor[Math.floor(Math.random() * snowcolor.length)];
      const color = hexToRgb(colorHex);
      const speed = sinkspeed * (size / 20) * 20;
      const spawnX = this._findSafeSpawnX(size);
      const initialRotation = Math.random() * Math.PI * 2; // Случайный начальный угол для разнообразия

      this.instances.push({
        x: spawnX,
        y: -size - Math.random() * window.innerHeight,
        size,
        collisionSize,
        fallSpeed: speed,
        phase: Math.random() * Math.PI * 2,
        freq: 0.8 + Math.random() * 1.4,
        sway: 10 + Math.random() * 25,
        rotation: initialRotation,
        rotationSpeed: 0,
        cumulativeSpin: initialRotation,
        color,
        glyphIndex,
        isSentence,
        sentenceIndex,
        velocityX: 0,
        velocityY: 0
      });
    }

    const strideFloats = 14;
    this.instanceData = new Float32Array(this.instances.length * strideFloats);
    this.instanceBuffer = this.device.createBuffer({
      size: this.instanceData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
  }

  /**
   * Найти безопасную позицию спауна по X, чтобы избежать перекрытий
   * @private
   */
  _findSafeSpawnX(newSize) {
    const width = window.innerWidth;
    const minCollisionDistance = newSize;
    const attempts = 20;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const x = Math.random() * width;
      let isSafe = true;

      for (const flake of this.instances) {
        if (!flake) continue;
        const dx = x - (flake.x ?? 0);
        const minDistance = minCollisionDistance + (flake.collisionSize ?? flake.size ?? 20);
        if (Math.abs(dx) < minDistance * 0.5) {
          isSafe = false;
          break;
        }
      }

      if (isSafe) return x;
    }

    return Math.random() * width;
  }

  /**
   * Настройка атласа глифов
   */
  async setupGlyphAtlas() {
    // Получаем символы и предложения
    const hasGlyphs = this.config.snowletters && this.config.snowletters.length > 0;
    const hasSentences = this.config.snowsentences && this.config.snowsentences.length > 0;
    const useDefaultGlyph = !hasGlyphs && !hasSentences;

    const glyphs = hasGlyphs
      ? this.config.snowletters
      : (useDefaultGlyph ? ['❄'] : []);

    const sentences = hasSentences
      ? this.config.snowsentences
      : null;

    // Создаем атлас для глифов
    const glyphResult = await createGlyphAtlas(glyphs, this.glyphAtlas.size);
    
    // Обновляем данные атласа глифов
    this.glyphAtlas.count = hasGlyphs || useDefaultGlyph ? glyphResult.glyphCount : 0;
    this.glyphAtlas.monotoneFlags = hasGlyphs || useDefaultGlyph ? glyphResult.glyphMonotoneFlags : [];
    this.glyphAtlas.isMonotone = hasGlyphs || useDefaultGlyph ? glyphResult.isMonotone : false;
    this.glyphAtlas.canvas = glyphResult.canvas;

    // Создаем текстуру для глифов
    await this._createAtlasTexture(this.glyphAtlas, 'glyph');

    // Создаем атлас для предложений (если есть)
    if (sentences) {
      const sentenceResult = await createSentenceAtlas(sentences, this.sentenceAtlas.size);
      
      this.sentenceAtlas.count = sentenceResult.sentenceCount;
      this.sentenceAtlas.monotoneFlags = new Array(sentenceResult.sentenceCount).fill(true);
      this.sentenceAtlas.isMonotone = true;
      this.sentenceAtlas.canvas = sentenceResult.canvas;

      // Создаем текстуру для предложений
      await this._createAtlasTexture(this.sentenceAtlas, 'sentence');
    } else {
      // Сбрасываем атлас предложений
      this.sentenceAtlas.canvas = null;
      this.sentenceAtlas.count = 0;
      this.sentenceAtlas.monotoneFlags = [];
      this.sentenceAtlas.isMonotone = true;
      await this._createAtlasTexture(this.sentenceAtlas, 'sentence');
    }

    // Обновляем deprecated поля для совместимости
    this.glyphCount = this.glyphAtlas.count + this.sentenceAtlas.count;
    this.glyphMonotoneFlags = [
      ...this.glyphAtlas.monotoneFlags,
      ...this.sentenceAtlas.monotoneFlags
    ];
    this.glyphTexture = this.glyphAtlas.texture;
    this.glyphSampler = this.glyphAtlas.sampler;

    this.uniformArray[2] = this.glyphAtlas.count;
    this.uniformArray[3] = this.glyphAtlas.size;
    this.uniformArray[4] = this.glyphAtlas.isMonotone ? 1.0 : 0.0;
    this.uniformArray[6] = this.sentenceAtlas.count;
    this.uniformArray[7] = this.sentenceAtlas.size;
  }

  /**
   * Вспомогательный метод для создания текстуры атласа
   * @private
   */
  async _createAtlasTexture(atlas, type) {
    const sourceCanvas = atlas.canvas || this._createFallbackCanvas();
    const bitmap = await createImageBitmap(sourceCanvas);

    if (atlas.texture) {
      atlas.texture.destroy();
    }

    const width = sourceCanvas.width;
    const height = sourceCanvas.height;

    atlas.texture = this.device.createTexture({
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
      label: `${type}Atlas`
    });

    this.device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: atlas.texture },
      { width, height }
    );

    atlas.sampler = this.device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      label: `${type}Sampler`
    });

    bitmap.close();
  }

  /**
   * Создает резервный прозрачный canvas 1x1
   * @private
   */
  _createFallbackCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, 1, 1);
    return canvas;
  }

  /**
   * Обработка изменения размеров окна
   */
  handleResize() {
    const resize = () => {
      const viewport = this._getViewportSize();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.floor(viewport.width * ratio);
      const height = Math.floor(viewport.height * ratio);
      if (width === this.canvasWidth && height === this.canvasHeight) return;

      this.canvasWidth = width;
      this.canvasHeight = height;
      this.viewportWidth = viewport.width;
      this.viewportHeight = viewport.height;
      this.canvas.width = width;
      this.canvas.height = height;
      this.uniformBufferManager?.setCanvasSize(viewport.width, viewport.height);
      this.context?.configure({
        device: this.device,
        format: navigator.gpu.getPreferredCanvasFormat(),
        alphaMode: 'premultiplied',
        size: { width, height }
      });
      
      // Обновляем debug canvas если включен
      if (this.debugCollisions) {
        this.setupDebugCanvas();
      }
    };

    resize();
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(document.documentElement);
  }

  /**
   * Настройка debug canvas для визуализации коллизий
   */
  setupDebugCanvas() {
    if (!this.debugCollisions) {
      if (this.debugCanvas) {
        this.debugCanvas.remove();
        this.debugCanvas = null;
        this.debugCtx = null;
      }
      return;
    }

    if (!this.debugCanvas) {
      this.debugCanvas = document.createElement('canvas');
      this.debugCanvas.id = 'let-it-snow-debug-canvas';
      this.debugCanvas.style.position = 'fixed';
      this.debugCanvas.style.top = '0';
      this.debugCanvas.style.left = '0';
      this.debugCanvas.style.width = '100vw';
      this.debugCanvas.style.height = '100vh';
      this.debugCanvas.style.pointerEvents = 'none';
      this.debugCanvas.style.zIndex = '2147483647'; // Поверх всего
      document.documentElement.appendChild(this.debugCanvas);
      this.debugCtx = this.debugCanvas.getContext('2d');
    }

    const ratio = window.devicePixelRatio || 1;
    this.debugCanvas.width = Math.floor(window.innerWidth * ratio);
    this.debugCanvas.height = Math.floor(window.innerHeight * ratio);
  }

  /**
   * Отрисовка debug информации о коллизиях
   */
  renderDebugCollisions() {
    if (!this.debugCollisions || !this.debugCtx || !this.debugCanvas) return;

    const ctx = this.debugCtx;
    const ratio = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, this.debugCanvas.width, this.debugCanvas.height);

    this.instances.forEach((flake) => {
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

  /**
   * Обновление состояния свечения на основе фона
   */
  updateGlowState() {
    if (!this.backgroundMonitor) return;
    const glowStrength = this.backgroundMonitor.calculateGlowStrength();
    this.uniformBufferManager?.setGlowStrength(glowStrength);
  }

  /**
   * Запуск мониторинга фона
   */
  startBackgroundMonitoring() {
    this.stopBackgroundMonitoring();
    this.backgroundMonitor = new BackgroundMonitor(() => this.updateGlowState());
    this.backgroundMonitor.start();
  }

  /**
   * Остановка мониторинга фона
   */
  stopBackgroundMonitoring() {
    if (this.backgroundMonitor) {
      this.backgroundMonitor.stop();
      this.backgroundMonitor = null;
    }
  }


  /**
   * Обновление симуляции
   * @param {number} delta - Время с последнего кадра в секундах
   */
  updateSimulation(delta) {
    const width = this.viewportWidth || this._getViewportSize().width;
    const height = this.viewportHeight || this._getViewportSize().height;
    const strideFloats = 14;
    const glyphCount = this.atlasManager?.glyphAtlas.count || 0;
    const sentenceCount = this.atlasManager?.sentenceAtlas.count || 0;
    const monotoneFlags = this.glyphMonotoneFlags || this.atlasManager?.getMonotoneFlags() || [];
    let hasChanges = false;

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
      const highFreq3 = Math.sin(this.windTime * 4.1) * Math.sin(this.windTime * 0.7) * 0.02;
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

    this.instances.forEach((flake, idx) => {
      // Вычисляем скорость движения мыши
      const mouseSpeed = Math.sqrt(this.mouseVelocityX * this.mouseVelocityX + this.mouseVelocityY * this.mouseVelocityY);
      const activityFactor = mouseSpeed > 0 ? 1 : 0;
      const burstActive = this.mouseBurstTimer > 0;
      const shouldApplyMouse = burstActive || activityFactor > 0;
      const isMouseFast = mouseSpeed > this.mouseDragThreshold;

      // Применяем физику взаимодействия с мышью
      const dx = flake.x - this.mouseX;
      const dy = flake.y - this.mouseY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < (this.mouseRadius * (burstActive ? this.mouseBurstRadiusMultiplier : 1)) && distance > 0 && shouldApplyMouse) {
        const radius = this.mouseRadius * (burstActive ? this.mouseBurstRadiusMultiplier : 1);
        const influence = 1 - distance / radius;
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
          flake.x += Math.cos(angle) * force;
          flake.y += Math.sin(angle) * force;
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

      // Применяем импульс к позиции
      flake.x += flake.velocityX * delta;
      flake.y += flake.velocityY * delta;
      
      // Затухание импульса (0.98 = 98% сохраняется каждую секунду)
      const damping = Math.pow(0.98, delta * 60);
      flake.velocityX *= damping;
      flake.velocityY *= damping;
      flake.rotationSpeed *= damping;
      
      // Обнулить очень малые значения вращения, чтобы избежать численных погрешностей
      if (Math.abs(flake.rotationSpeed) < 0.0001) {
        flake.rotationSpeed = 0;
      }

      flake.phase += flake.freq * delta;
      
      // Обрабатываем вращение снежинки
      flake.cumulativeSpin = (flake.cumulativeSpin ?? 0) + (flake.rotationSpeed ?? 0) * delta;
      
      // Качание как маятник: добавляем визуальный наклон к ротации
      const maxSwingAngle = 0.35;
      const swingAngle = Math.sin(flake.phase) * maxSwingAngle * (flake.swayLimit ?? 1.0);
      
      // Финальная ротация = постоянное кручение + качание маятника
      flake.rotation = flake.cumulativeSpin + swingAngle;
      
      flake.y += flake.fallSpeed * delta;

      // Применяем ветер как горизонтальное и вертикальное воздействие
      if ((this.currentWindForce !== 0 || this.currentWindLift !== 0)) {
        // Площадь поперечного сечения пропорциональна размеру
        // Маленькие объекты поддаются ветру сильнее
        const sizeRatio = Math.sqrt(flake.size / 20);
        
        // Горизонтальное воздействие ветра
        if (this.currentWindForce !== 0) {
          const windAccel = this.currentWindForce * sizeRatio * 40;
          flake.x += windAccel * delta;
        }
        
        // Вертикальное воздействие ветра (лифт)
        if (this.currentWindLift !== 0) {
          const liftAccel = -this.currentWindLift * sizeRatio * 70;
          flake.y += liftAccel * delta;
        }
      }

      // Сброс позиции если снежинка вышла за экран
      if (flake.y - flake.size > height) {
        flake.y = -flake.size;
        flake.x = Math.random() * width;
        flake.phase = Math.random() * Math.PI * 2;
        const newRotation = Math.random() * Math.PI * 2; // Новый случайный угол (но скорость = 0)
        flake.rotation = newRotation;
        flake.cumulativeSpin = newRotation;
        flake.rotationSpeed = 0;
        flake.velocityX = 0;
        flake.velocityY = 0;

        if (flake.isSentence && sentenceCount > 0) {
          flake.sentenceIndex = this._nextSentenceIndex(sentenceCount);
          flake.glyphIndex = glyphCount + flake.sentenceIndex;
        }
      }

      hasChanges = true;
    });
    
    // Обрабатываем коллизии между снежинками
    if (this.collisionHandler) {
      this.collisionHandler.handleCollisions(this.instances, delta);
    }
    
    // Обрабатываем края экрана как порталы (wrapping)
    this.instances.forEach((flake) => {
      const collisionRadius = (flake.size ?? 20) * 0.5;
      
      if (flake.x + collisionRadius < 0) {
        flake.x = width + collisionRadius;
      } else if (flake.x - collisionRadius > width) {
        flake.x = -collisionRadius;
      }
    });
    
    // Записываем финальные данные в буфер
    this.instances.forEach((flake, idx) => {
      const base = idx * strideFloats;
      this.instanceData[base + 0] = flake.x;
      this.instanceData[base + 1] = flake.y;
      this.instanceData[base + 2] = flake.size;
      this.instanceData[base + 3] = flake.fallSpeed;
      this.instanceData[base + 4] = flake.phase;
      this.instanceData[base + 5] = flake.freq;
      this.instanceData[base + 6] = flake.sway;
      this.instanceData[base + 7] = flake.rotation;
      this.instanceData[base + 8] = flake.rotationSpeed;
      this.instanceData[base + 9] = flake.color.r;
      this.instanceData[base + 10] = flake.color.g;
      this.instanceData[base + 11] = flake.color.b;
      this.instanceData[base + 12] = flake.glyphIndex;
      const monoFlag = monotoneFlags[flake.glyphIndex] ? 1 : 0;
      this.instanceData[base + 13] = monoFlag;
    });
    
    // Отмечаем, что буфер экземпляров нужно обновить
    if (hasChanges) {
      this.instanceBufferNeedsUpdate = true;
    }
  }

  /**
   * Рендеринг кадра
   */
  render() {
    if (!this.device || !this.context) return;

    // Обновляем буфер uniform только если требуется
    this.uniformBufferManager?.flush();
    
    // Обновляем буфер экземпляров только если требуется
    if (this.instanceBufferNeedsUpdate) {
      this.device.queue.writeBuffer(
        this.instanceBuffer,
        0,
        this.instanceData.buffer,
        0,
        this.instanceData.byteLength
      );
      this.instanceBufferNeedsUpdate = false;
    }

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 }
        }
      ]
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.uniformBindGroup);
    pass.setVertexBuffer(0, this.quadBuffer);
    pass.setVertexBuffer(1, this.instanceBuffer);
    pass.draw(6, this.instances.length, 0, 0);
    pass.end();

    this.device.queue.submit([encoder.finish()]);
    
    // Отрисовка debug информации
    this.renderDebugCollisions();
  }

  /**
   * Основной цикл рендеринга
   * @param {number} timestamp - Текущее время
   */
  frame(timestamp) {
    const delta = Math.max(0.001, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;
    this.updateSimulation(delta);
    this.render();
    this.frameRequest = requestAnimationFrame((ts) => this.frame(ts));
  }

  /**
   * Запуск рендеринга
   */
  start() {
    this.lastTimestamp = performance.now();
    this.frameRequest = requestAnimationFrame((ts) => this.frame(ts));
  }

  /**
   * Приостановка рендеринга
   */
  pause() {
    if (this.frameRequest) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }
  }

  /**
   * Возобновление рендеринга
   */
  resume() {
    if (!this.device || !this.context) return;
    this.lastTimestamp = performance.now();
    this.frameRequest = requestAnimationFrame((ts) => this.frame(ts));
  }

  /**
   * Очистка ресурсов
   */
  cleanup() {
    this.pause();
    this.stopBackgroundMonitoring();

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    
    // Очистка debug canvas
    if (this.debugCanvas) {
      this.debugCanvas.remove();
      this.debugCanvas = null;
      this.debugCtx = null;
    }

    if (this.atlasManager) {
      this.atlasManager.cleanup();
      this.atlasManager = null;
    }
    if (this.uniformBufferManager) {
      this.uniformBufferManager.cleanup();
      this.uniformBufferManager = null;
    }
    this.glyphMonotoneFlags = null;
    this.device = null;
    this.context = null;
    this.pipeline = null;
    this.instanceBuffer = null;
    this.instanceData = null;
    this.instances = [];
  }

  /**
   * Получить данные атласа для конкретной снежинки
   * @param {number} glyphIndex - Индекс глифа
   * @returns {object} Объект с информацией об атласе { atlas, localIndex }
   */
  getAtlasForGlyph(glyphIndex) {
    if (!this.atlasManager) return null;
    if (glyphIndex < this.atlasManager.glyphAtlas.count) {
      return {
        atlas: this.atlasManager.glyphAtlas,
        localIndex: glyphIndex,
        type: 'glyph'
      };
    } else {
      return {
        atlas: this.atlasManager.sentenceAtlas,
        localIndex: glyphIndex - this.atlasManager.glyphAtlas.count,
        type: 'sentence'
      };
    }
  }

  /**
   * Получить информацию о глифах
   * @returns {object} Статистика по атласам
   */
  getAtlasInfo() {
    if (!this.atlasManager) return null;
    return {
      glyphs: {
        count: this.atlasManager.glyphAtlas.count,
        isMonotone: this.atlasManager.glyphAtlas.isMonotone,
        hasTexture: !!this.atlasManager.glyphAtlas.texture
      },
      sentences: {
        count: this.atlasManager.sentenceAtlas.count,
        isMonotone: this.atlasManager.sentenceAtlas.isMonotone,
        hasTexture: !!this.atlasManager.sentenceAtlas.texture
      },
      total: this.atlasManager.glyphAtlas.count + this.atlasManager.sentenceAtlas.count
    };
  }

  /**
   * Обновление позиции мыши
   * @param {number} x - X координата
   * @param {number} y - Y координата
   * @param {number} vx - Скорость по X
   * @param {number} vy - Скорость по Y
   */
  updateMousePosition(x, y, vx = 0, vy = 0) {
    this.mouseX = x;
    this.mouseY = y;
    this.mouseVelocityX = vx;
    this.mouseVelocityY = vy;
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

  /**
   * Получить следующий индекс предложения
   * @private
   */
  _nextSentenceIndex(sentenceCount) {
    if (!sentenceCount) return 0;
    const index = this.sentenceCursor % sentenceCount;
    this.sentenceCursor = (this.sentenceCursor + 1) % sentenceCount;
    return index;
  }
}