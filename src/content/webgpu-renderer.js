/**
 * WebGPU рендерер снежинок
 */

import shaderSource from './shader.wgsl?raw';
import { createGlyphAtlas, createSentenceAtlas } from './utils/glyph-utils.js';
import { hexToRgb } from './utils/color-utils.js';
import { BackgroundMonitor } from './utils/background-monitor.js';

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
    this.uniformBuffer = null;
    this.uniformArray = new Float32Array(8);
    this.uniformArray[5] = 1; // glow enabled by default
    this.uniformBindGroup = null;
    
    // Раздельные атласы для глифов и предложений
    this.glyphAtlas = {
      texture: null,
      sampler: null,
      size: 64,
      count: 1,
      monotoneFlags: [true],
      isMonotone: true,
      canvas: null
    };
    
    this.sentenceAtlas = {
      texture: null,
      sampler: null,
      size: 64,
      count: 0,
      monotoneFlags: [],
      isMonotone: false,
      canvas: null
    };

    // Дополнительные uniform параметры
    this.uniformArray[6] = 0; // sentenceCount
    this.uniformArray[7] = 64; // sentenceSize
    
    // Для совместимости (deprecated)
    this.glyphTexture = null;
    this.glyphSampler = null;
    this.glyphSize = 64;
    this.glyphCount = 1;
    this.glyphMonotoneFlags = [true];
    this.instanceBuffer = null;
    this.instanceData = null;
    this.instances = [];
    this.sentenceQueue = [];
    this.sentenceCursor = 0;
    this.quadBuffer = null;
    this.canvasWidth = 0;
    this.canvasHeight = 0;
    this.frameRequest = null;
    this.resizeObserver = null;
    this.lastTimestamp = 0;
    this.backgroundMonitor = null;
  }

  /**
   * Инициализация WebGPU
   * @returns {Promise<boolean>} true если успешно
   */
  async init() {
    if (!navigator.gpu) return false;

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
    if (!adapter) return false;

    try {
      this.device = await adapter.requestDevice();
      const format = navigator.gpu.getPreferredCanvasFormat();

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
      await this.setupGlyphAtlas();
      this.setupUniforms();
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
   * Настройка instance данных (снежинок)
   */
  setupInstances() {
    const { snowmax, snowminsize, snowmaxsize, sinkspeed, snowcolor, snowletters, snowsentences } = this.config;

    const sizeRange = snowmaxsize - snowminsize;
    const hasGlyphs = snowletters && snowletters.length > 0;
    const hasSentences = snowsentences && snowsentences.length > 0;
    const useDefaultGlyph = !hasGlyphs && !hasSentences;
    const effectiveHasGlyphs = hasGlyphs || useDefaultGlyph;
    
    // Определяем количество глифов и предложений
    const glyphCount = effectiveHasGlyphs ? (hasGlyphs ? snowletters.length : 1) : 0;
    const sentenceCount = hasSentences ? snowsentences.length : 0;
    const totalCount = glyphCount + sentenceCount || 1;

    this.sentenceQueue = hasSentences ? snowsentences : [];
    this.sentenceCursor = 0;

    this.glyphCount = totalCount;

    const seeds = effectiveHasGlyphs
      ? (hasGlyphs ? snowletters.map((s) => s.charCodeAt(0) || 0) : [1])
      : [1];

    this.instances = new Array(Math.max(1, snowmax)).fill(null).map((_, idx) => {
      const size = snowminsize + Math.random() * sizeRange;
      const colorHex = snowcolor[Math.floor(Math.random() * snowcolor.length)];
      const color = hexToRgb(colorHex);
      const speed = sinkspeed * (size / 20) * 20;
      const sway = 10 + Math.random() * 25;
      const phaseSeed = seeds.length ? seeds[idx % seeds.length] : 1;

      // Выбираем случайно между глифами и предложениями
      let glyphIndex;
      let isSentence = false;
      let sentenceIndex = 0;

      if (!hasSentences) {
        // Только глифы
        glyphIndex = idx % glyphCount;
      } else if (!effectiveHasGlyphs) {
        // Только предложения
        isSentence = true;
        sentenceIndex = this._nextSentenceIndex(sentenceCount);
        glyphIndex = sentenceIndex;
      } else {
        // Микс глифов и предложений
        const randomChoice = Math.random();
        if (randomChoice < 0.5) {
          // Выбираем глиф
          glyphIndex = idx % glyphCount;
        } else {
          // Выбираем предложение
          isSentence = true;
          sentenceIndex = this._nextSentenceIndex(sentenceCount);
          glyphIndex = glyphCount + sentenceIndex;
        }
      }

      return {
        x: Math.random() * window.innerWidth,
        y: -size - Math.random() * window.innerHeight,
        size,
        fallSpeed: speed,
        phase: Math.random() * Math.PI * 2 + phaseSeed,
        freq: 0.8 + Math.random() * 1.4,
        sway,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.6,
        color,
        glyphIndex,
        isSentence,
        sentenceIndex
      };
    });

    const strideFloats = 14;
    this.instanceData = new Float32Array(this.instances.length * strideFloats);
    this.instanceBuffer = this.device.createBuffer({
      size: this.instanceData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
  }

  _nextSentenceIndex(sentenceCount) {
    if (!sentenceCount) return 0;
    const index = this.sentenceCursor % sentenceCount;
    this.sentenceCursor = (this.sentenceCursor + 1) % sentenceCount;
    return index;
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
      this.sentenceAtlas.monotoneFlags = new Array(sentenceResult.sentenceCount).fill(false);
      this.sentenceAtlas.isMonotone = false;
      this.sentenceAtlas.canvas = sentenceResult.canvas;

      // Создаем текстуру для предложений
      await this._createAtlasTexture(this.sentenceAtlas, 'sentence');
    } else {
      // Сбрасываем атлас предложений
      this.sentenceAtlas.canvas = null;
      this.sentenceAtlas.count = 0;
      this.sentenceAtlas.monotoneFlags = [];
      this.sentenceAtlas.isMonotone = false;
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
      this.uniformArray[0] = width;
      this.uniformArray[1] = height;
      this.device?.queue.writeBuffer(this.uniformBuffer, 0, this.uniformArray);
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
    if (this.uniformArray[5] === glowStrength) return;
    this.uniformArray[5] = glowStrength;
    if (this.uniformBuffer && this.device) {
      this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformArray);
    }
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
    const width = this.canvasWidth || window.innerWidth;
    const height = this.canvasHeight || window.innerHeight;
    const strideFloats = 14;
    const glyphCount = this.glyphAtlas.count || 0;
    const sentenceCount = this.sentenceAtlas.count || 0;

    this.instances.forEach((flake, idx) => {
      flake.phase += flake.freq * delta;
      flake.rotation += flake.rotationSpeed * delta;
      flake.y += flake.fallSpeed * delta;

      // Сброс позиции если снежинка вышла за экран
      if (flake.y - flake.size > height) {
        flake.y = -flake.size;
        flake.x = Math.random() * width;
        flake.phase = Math.random() * Math.PI * 2;

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
      const monoFlag = this.glyphMonotoneFlags?.[flake.glyphIndex] ? 1 : 0;
      this.instanceData[base + 13] = monoFlag;
    });
  }

  /**
   * Рендеринг кадра
   */
  render() {
    if (!this.device || !this.context) return;

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformArray);
    this.device.queue.writeBuffer(
      this.instanceBuffer,
      0,
      this.instanceData.buffer,
      0,
      this.instanceData.byteLength
    );

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

    if (this.glyphAtlas.texture) {
      this.glyphAtlas.texture.destroy();
      this.glyphAtlas.texture = null;
    }
    if (this.sentenceAtlas.texture) {
      this.sentenceAtlas.texture.destroy();
      this.sentenceAtlas.texture = null;
    }
    if (this.glyphTexture) {
      this.glyphTexture = null;
    }

    this.glyphSampler = null;
    this.device = null;
    this.context = null;
    this.pipeline = null;
    this.uniformBuffer = null;
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
    if (glyphIndex < this.glyphAtlas.count) {
      return {
        atlas: this.glyphAtlas,
        localIndex: glyphIndex,
        type: 'glyph'
      };
    } else {
      return {
        atlas: this.sentenceAtlas,
        localIndex: glyphIndex - this.glyphAtlas.count,
        type: 'sentence'
      };
    }
  }

  /**
   * Получить информацию о глифах
   * @returns {object} Статистика по атласам
   */
  getAtlasInfo() {
    return {
      glyphs: {
        count: this.glyphAtlas.count,
        isMonotone: this.glyphAtlas.isMonotone,
        hasTexture: !!this.glyphAtlas.texture
      },
      sentences: {
        count: this.sentenceAtlas.count,
        isMonotone: this.sentenceAtlas.isMonotone,
        hasTexture: !!this.sentenceAtlas.texture
      },
      total: this.glyphAtlas.count + this.sentenceAtlas.count
    };
  }
}
