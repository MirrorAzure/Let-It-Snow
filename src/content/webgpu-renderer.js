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

    // Параметры взаимодействия с мышью
    this.mouseX = -1000;
    this.mouseY = -1000;
    this.mouseVelocityX = 0;
    this.mouseVelocityY = 0;
    this.mousePressed = false;
    this.mouseRadius = config.mouseRadius ?? 100;
    this.mouseForce = config.mouseForce ?? 300;
    this.mouseImpulseStrength = config.mouseImpulseStrength ?? 0.5;
    this.mouseDragThreshold = config.mouseDragThreshold ?? 500;
    this.mouseDragStrength = config.mouseDragStrength ?? 0.8;
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

    this.instances = new Array(Math.max(1, snowmax)).fill(null).map((_, idx) => {
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

      return {
        x: Math.random() * window.innerWidth,
        y: -size - Math.random() * window.innerHeight,
        size,
        collisionSize,
        fallSpeed: speed,
        phase: Math.random() * Math.PI * 2,
        freq: 0.8 + Math.random() * 1.4,
        sway: 10 + Math.random() * 25,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: 0,
        color,
        glyphIndex,
        isSentence,
        sentenceIndex,
        velocityX: 0,
        velocityY: 0
      };
    });

    const strideFloats = 14;
    this.instanceData = new Float32Array(this.instances.length * strideFloats);
    this.instanceBuffer = this.device.createBuffer({
      size: this.instanceData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
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
      const ratio = window.devicePixelRatio || 1;
      const width = Math.floor(window.innerWidth * ratio);
      const height = Math.floor(window.innerHeight * ratio);
      if (width === this.canvasWidth && height === this.canvasHeight) return;

      this.canvasWidth = width;
      this.canvasHeight = height;
      this.canvas.width = width;
      this.canvas.height = height;
      this.uniformBufferManager?.setCanvasSize(width, height);
      this.context?.configure({
        device: this.device,
        format: navigator.gpu.getPreferredCanvasFormat(),
        alphaMode: 'premultiplied',
        size: { width, height }
      });
    };

    resize();
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(document.documentElement);
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
   * Проверка и обработка коллизий между снежинками
   */
  handleCollisions() {
    if (!this.enableCollisions || this.instances.length < 2) return;

    // Оптимизация: проверяем только близкие пары
    for (let i = 0; i < this.instances.length; i++) {
      const flakeA = this.instances[i];
      
      // Проверяем только снежинки в радиусе collisionCheckRadius
      for (let j = i + 1; j < this.instances.length; j++) {
        const flakeB = this.instances[j];
        
        const dx = flakeB.x - flakeA.x;
        const dy = flakeB.y - flakeA.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Пропускаем, если снежинки слишком далеко
        if (distance > this.collisionCheckRadius) continue;
        
        // Используем collisionSize для проверки коллизий (соответствует визуальному размеру)
        const minDistance = (flakeA.collisionSize + flakeB.collisionSize) * 0.5;
        
        // Если снежинки пересекаются
        if (distance < minDistance && distance > 0) {
          // Нормализованный вектор между снежинками
          const nx = dx / distance;
          const ny = dy / distance;
          
          // Относительная скорость
          const dvx = flakeB.velocityX - flakeA.velocityX;
          const dvy = flakeB.velocityY - flakeA.velocityY;
          
          // Скорость сближения
          const dvn = dvx * nx + dvy * ny;
          
          // Если снежинки уже расходятся, не обрабатываем коллизию
          if (dvn > 0) continue;
          
          // Импульс столкновения (упрощенная физика для равных масс)
          const impulse = dvn * this.collisionDamping;
          
          // Применяем импульс к обеим снежинкам
          flakeA.velocityX += nx * impulse;
          flakeA.velocityY += ny * impulse;
          flakeB.velocityX -= nx * impulse;
          flakeB.velocityY -= ny * impulse;
          
          // Разводим снежинки, чтобы они не застревали друг в друге
          const overlap = minDistance - distance;
          const separationX = nx * overlap * 0.5;
          const separationY = ny * overlap * 0.5;
          
          flakeA.x -= separationX;
          flakeA.y -= separationY;
          flakeB.x += separationX;
          flakeB.y += separationY;
        }
      }
    }
  }

  /**
   * Обновление симуляции
   * @param {number} delta - Время с последнего кадра в секундах
   */
  updateSimulation(delta) {
    const width = this.canvasWidth || window.innerWidth;
    const height = this.canvasHeight || window.innerHeight;
    const strideFloats = 14;
    const glyphCount = this.atlasManager?.glyphAtlas.count || 0;
    const sentenceCount = this.atlasManager?.sentenceAtlas.count || 0;
    const monotoneFlags = this.glyphMonotoneFlags || this.atlasManager?.getMonotoneFlags() || [];
    let hasChanges = false;

    this.instances.forEach((flake, idx) => {
      // Вычисляем скорость движения мыши
      const mouseSpeed = Math.sqrt(this.mouseVelocityX * this.mouseVelocityX + this.mouseVelocityY * this.mouseVelocityY);
      const isMouseFast = mouseSpeed > this.mouseDragThreshold;
      
      // Применяем физику взаимодействия с мышью
      const dx = flake.x - this.mouseX;
      const dy = flake.y - this.mouseY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < this.mouseRadius && distance > 0) {
        const influence = 1 - distance / this.mouseRadius;
        
        // Если мышь движется быстро - создаем эффект воздушного потока
        if (isMouseFast) {
          // Нормализуем вектор скорости мыши
          const mouseVelMag = Math.sqrt(this.mouseVelocityX * this.mouseVelocityX + this.mouseVelocityY * this.mouseVelocityY);
          if (mouseVelMag > 0) {
            const mouseDirX = this.mouseVelocityX / mouseVelMag;
            const mouseDirY = this.mouseVelocityY / mouseVelMag;
            
            // Притягиваем снежинку в сторону движения мыши
            const dragForce = influence * this.mouseDragStrength * (mouseSpeed / 1000);
            flake.velocityX += mouseDirX * dragForce * delta * 1000;
            flake.velocityY += mouseDirY * dragForce * delta * 1000;
          }
        } else {
          // Обычное отталкивание при медленном движении
          const force = influence * this.mouseForce * delta;
          const angle = Math.atan2(dy, dx);
          flake.x += Math.cos(angle) * force;
          flake.y += Math.sin(angle) * force;
        }
        
        // Передаем импульс от движения мыши
        const impulseStrength = influence * this.mouseImpulseStrength;
        flake.velocityX += this.mouseVelocityX * impulseStrength * delta;
        flake.velocityY += this.mouseVelocityY * impulseStrength * delta;
        
        // Вращение снежинки при движении мыши рядом
        // Направление вращения зависит от того, с какой стороны пролетела мышка
        const cross = dx * this.mouseVelocityY - dy * this.mouseVelocityX;
        const rotationDirection = Math.sign(cross); // +1 или -1
        const rotationForce = influence * mouseSpeed * 0.01 * rotationDirection;
        flake.rotationSpeed += rotationForce * delta;
        
        // При зажатии кнопки мыши - захватываем снежинку
        if (this.mousePressed && distance < this.mouseRadius * 0.5) {
          // Позиция снежинки следует за мышью
          flake.x = this.mouseX;
          flake.y = this.mouseY;
          // Обнуляем скорость при захвате
          flake.velocityX = 0;
          flake.velocityY = 0;
        }
      }

      // Применяем импульс к позиции
      flake.x += flake.velocityX * delta;
      flake.y += flake.velocityY * delta;
      
      // Затухание импульса (0.95 = 95% сохраняется каждую секунду)
      const damping = Math.pow(0.95, delta * 60);
      flake.velocityX *= damping;
      flake.velocityY *= damping;
      flake.rotationSpeed *= damping;

      flake.phase += flake.freq * delta;
      
      // Добавляем собственное вращение снежинки в зависимости от направления качания
      // Когда снежинка качается в одну сторону, она вращается в эту же сторону
      const swayRotation = Math.cos(flake.phase) * flake.freq * 0.5;
      flake.rotationSpeed += swayRotation * delta;
      
      flake.rotation += flake.rotationSpeed * delta;
      flake.y += flake.fallSpeed * delta;

      // Сброс позиции если снежинка вышла за экран
      if (flake.y - flake.size > height) {
        flake.y = -flake.size;
        flake.x = Math.random() * width;
        flake.phase = Math.random() * Math.PI * 2;
        flake.rotation = Math.random() * Math.PI * 2;
        flake.rotationSpeed = 0;
        flake.velocityX = 0;
        flake.velocityY = 0;

        if (flake.isSentence && sentenceCount > 0) {
          flake.sentenceIndex = this._nextSentenceIndex(sentenceCount);
          flake.glyphIndex = glyphCount + flake.sentenceIndex;
        }
      }

      // Запись данных в буфер
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
      
      hasChanges = true;
    });
    
    // Обрабатываем коллизии между снежинками
    this.handleCollisions();
    
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
  onMouseDown(x, y) {
    this.mousePressed = true;
    this.mouseX = x;
    this.mouseY = y;
  }

  /**
   * Обработчик отпускания кнопки мыши
   */
  onMouseUp() {
    this.mousePressed = false;
  }

  /**
   * Обработчик выхода мыши за пределы canvas
   */
  onMouseLeave() {
    this.mousePressed = false;
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
