/**
 * WebGPU рендерер снежинок
 */

import shaderSource from './shader.wgsl?raw';
import { createGlyphAtlas } from './utils/glyph-utils.js';
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
    this.glyphTexture = null;
    this.glyphSampler = null;
    this.glyphSize = 64;
    this.glyphCount = 1;
    this.glyphMonotoneFlags = [true];
    this.instanceBuffer = null;
    this.instanceData = null;
    this.instances = [];
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
      -0.5, -0.5, 0, 1,
      0.5, -0.5, 1, 1,
      -0.5, 0.5, 0, 0,
      -0.5, 0.5, 0, 0,
      0.5, -0.5, 1, 1,
      0.5, 0.5, 1, 0
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
          resource: this.glyphSampler
        },
        {
          binding: 2,
          resource: this.glyphTexture.createView()
        }
      ]
    });
  }

  /**
   * Настройка instance данных (снежинок)
   */
  setupInstances() {
    const { snowmax, snowminsize, snowmaxsize, sinkspeed, snowcolor, snowletters } = this.config;

    const sizeRange = snowmaxsize - snowminsize;
    const seeds = snowletters.map((s) => s.charCodeAt(0) || 0);
    this.glyphCount = Math.max(1, snowletters.length);

    this.instances = new Array(Math.max(1, snowmax)).fill(null).map((_, idx) => {
      const size = snowminsize + Math.random() * sizeRange;
      const colorHex = snowcolor[Math.floor(Math.random() * snowcolor.length)];
      const color = hexToRgb(colorHex);
      const speed = sinkspeed * (size / 20) * 20;
      const sway = 10 + Math.random() * 25;
      const phaseSeed = seeds.length ? seeds[idx % seeds.length] : 1;

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
        glyphIndex: idx % this.glyphCount
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
    const glyphs =
      this.config.snowletters && this.config.snowletters.length
        ? this.config.snowletters
        : ['❄'];

    const { canvas, glyphCount, isMonotone, glyphMonotoneFlags } = await createGlyphAtlas(
      glyphs,
      this.glyphSize
    );

    this.glyphCount = glyphCount;
    this.glyphMonotoneFlags = glyphMonotoneFlags;

    const bitmap = await createImageBitmap(canvas);

    if (this.glyphTexture) {
      this.glyphTexture.destroy();
    }

    const width = this.glyphSize * this.glyphCount;
    const height = this.glyphSize;

    this.glyphTexture = this.device.createTexture({
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT
    });

    this.device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: this.glyphTexture },
      { width, height }
    );

    this.glyphSampler = this.device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });

    bitmap.close();

    this.uniformArray[2] = this.glyphCount;
    this.uniformArray[3] = this.glyphSize;
    this.uniformArray[4] = isMonotone ? 1.0 : 0.0;
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

    this.instances.forEach((flake, idx) => {
      flake.phase += flake.freq * delta;
      flake.rotation += flake.rotationSpeed * delta;
      flake.y += flake.fallSpeed * delta;

      // Сброс позиции если снежинка вышла за экран
      if (flake.y - flake.size > height) {
        flake.y = -flake.size;
        flake.x = Math.random() * width;
        flake.phase = Math.random() * Math.PI * 2;
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

    if (this.glyphTexture) {
      this.glyphTexture.destroy();
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
}
