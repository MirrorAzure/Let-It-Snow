import shaderSource from './shader.wgsl?raw';

const OVERLAY_ID = 'let-it-snow-webgpu-canvas';
const GIF_LAYER_ID = 'let-it-snow-gif-layer';
const MAX_Z_INDEX = '2147483646';
const FALLBACK_GIF_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAPAAAP///wAAACwAAAAAAQABAEACAkQBADs='; // 1x1 transparent gif
const IS_TEST_ENV = import.meta?.env?.MODE === 'test';
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

let controller = null;

class SnowWebGPUController {
  constructor(userConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...userConfig };
    this.canvas = null;
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
    this.instanceBuffer = null;
    this.instanceData = null;
    this.instances = [];
    this.frameRequest = null;
    this.resizeObserver = null;
    this.lastTimestamp = 0;
    this.quadBuffer = null;
    this.canvasWidth = 0;
    this.canvasHeight = 0;
    this.isFallback2D = false;
    this.fallbackFlakes = [];
    this.fallbackCtx = null;
    this.gifLayer = null;
    this.gifFlakes = [];
    this.gifFrameRequest = null;
    this.gifLastTimestamp = 0;
    this.isPaused = false;
    this.fallbackDraw = null;
    this.gifObjectUrls = new Map();
    this.backgroundObserver = null;
    this.colorSchemeMedia = null;
    this.handleBackgroundChange = null;
  }

  async start() {
    this.createOverlayCanvas();
    const ok = await this.tryWebGPU();
    if (!ok) {
      this.startFallback2D();
    }
    await this.startGifLayer();
  }

  destroy() {
    if (this.frameRequest) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
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
    this.fallbackFlakes = [];
    this.fallbackCtx = null;
    this.fallbackDraw = null;
    this.isPaused = false;
    this.stopGifLayer();
    this.stopBackgroundMonitoring();
  }

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

  cleanupGifObjectUrls() {
    this.gifObjectUrls.forEach((objectUrl) => {
      URL.revokeObjectURL(objectUrl);
    });
    this.gifObjectUrls.clear();
  }

  async toSafeGifUrl(url) {
    if (!url) return null;

    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return url;
    }

    const extensionOrigin = typeof chrome !== 'undefined' && chrome.runtime?.id
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
      // Fallback to embedded transparent GIF to keep the layer alive without CSP violations.
      return FALLBACK_GIF_DATA_URL;
    }
  }

  async resolveGifUrls(urls) {
    const resolved = await Promise.all(urls.map((u) => this.toSafeGifUrl(u)));
    return resolved.filter(Boolean);
  }

  async startGifLayer() {
    const urls = Array.isArray(this.config.gifUrls)
      ? this.config.gifUrls.filter((u) => typeof u === 'string' && u.trim() !== '')
      : [];
    const count = Math.max(0, Math.min(this.config.gifCount || 0, 160));

    this.stopGifLayer();

    if (!urls.length || count === 0) return;

    const safeUrls = await this.resolveGifUrls(urls);
    if (!safeUrls.length) return;

    const existing = document.getElementById(GIF_LAYER_ID);
    if (existing) existing.remove();

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

    this.gifLayer = layer;
    this.gifFlakes = flakes;
    this.gifLastTimestamp = performance.now();
    this.gifFrameRequest = requestAnimationFrame((ts) => this.animateGifLayer(ts));
  }

  pauseAnimations() {
    if (this.isPaused) return;
    this.isPaused = true;
    if (this.frameRequest) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }
    if (this.gifFrameRequest) {
      cancelAnimationFrame(this.gifFrameRequest);
      this.gifFrameRequest = null;
    }
  }

  resumeAnimations() {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.lastTimestamp = performance.now();
    this.gifLastTimestamp = performance.now();

    if (this.isFallback2D && this.fallbackDraw) {
      this.frameRequest = requestAnimationFrame(this.fallbackDraw);
    } else if (this.device && this.context) {
      this.frameRequest = requestAnimationFrame((ts) => this.frame(ts));
    }

    if (this.gifFlakes.length && this.gifLayer) {
      this.gifFrameRequest = requestAnimationFrame((ts) => this.animateGifLayer(ts));
    }
  }

  animateGifLayer(timestamp) {
    if (!this.gifLayer || !this.gifFlakes.length) return;

    const delta = Math.max(0.001, (timestamp - this.gifLastTimestamp) / 1000);
    this.gifLastTimestamp = timestamp;
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.gifFlakes.forEach((flake) => {
      flake.phase += flake.freq * delta;
      flake.y += flake.speed * delta;

      if (flake.y - flake.size > height) {
        flake.y = -flake.size;
        flake.x = Math.random() * width;
        flake.phase = Math.random() * Math.PI * 2;
      }

      const x = flake.x + Math.sin(flake.phase) * flake.sway;
      const rotation = Math.sin(flake.phase * 0.5) * 0.4;
      flake.el.style.transform = `translate3d(${x}px, ${flake.y}px, 0) rotate(${rotation}rad)`;
    });

    this.gifFrameRequest = requestAnimationFrame((ts) => this.animateGifLayer(ts));
  }

  stopGifLayer() {
    if (this.gifFrameRequest) {
      cancelAnimationFrame(this.gifFrameRequest);
      this.gifFrameRequest = null;
    }

    this.gifFlakes.forEach((flake) => {
      if (flake.el?.parentElement) {
        flake.el.remove();
      }
    });

    this.gifFlakes = [];

    const layer = this.gifLayer || document.getElementById(GIF_LAYER_ID);
    if (layer) {
      layer.remove();
    }
    this.gifLayer = null;

    this.cleanupGifObjectUrls();
  }

  async tryWebGPU() {
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

      this.lastTimestamp = performance.now();
      this.frameRequest = requestAnimationFrame((ts) => this.frame(ts));
      return true;
    } catch (error) {
      console.warn('WebGPU init failed, switching to 2D fallback.', error);
      this.pipeline = null;
      this.device = null;
      this.context = null;
      this.uniformBuffer = null;
      this.instanceBuffer = null;
      this.quadBuffer = null;
      return false;
    }
  }

  setupGeometry() {
    const quad = new Float32Array([
      -0.5, -0.5, 0, 1,
       0.5, -0.5, 1, 1,
      -0.5,  0.5, 0, 0,
      -0.5,  0.5, 0, 0,
       0.5, -0.5, 1, 1,
       0.5,  0.5, 1, 0
    ]);

    this.quadBuffer = this.device.createBuffer({
      size: quad.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });

    new Float32Array(this.quadBuffer.getMappedRange()).set(quad);
    this.quadBuffer.unmap();
  }

  async setupPipeline(format) {
    const shaderModule = this.device.createShaderModule({
      code: shaderSource
    });

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
          {
            arrayStride: 16,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x2' }
            ]
          },
          {
            arrayStride: 52,
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
              { shaderLocation: 11, offset: 48, format: 'float32' }
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

  setupInstances() {
    const {
      snowmax,
      snowminsize,
      snowmaxsize,
      sinkspeed,
      snowcolor,
      snowletters
    } = this.config;

    const sizeRange = snowmaxsize - snowminsize;
    const seeds = snowletters.map((s) => s.charCodeAt(0) || 0);
    this.glyphCount = Math.max(1, snowletters.length);

    this.instances = new Array(Math.max(1, snowmax)).fill(null).map((_, idx) => {
      const size = snowminsize + Math.random() * sizeRange;
      const colorHex = snowcolor[Math.floor(Math.random() * snowcolor.length)];
      const color = this.hexToRgb(colorHex);
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

    const strideFloats = 13;
    this.instanceData = new Float32Array(this.instances.length * strideFloats);
    this.instanceBuffer = this.device.createBuffer({
      size: this.instanceData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
  }

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

  frame(timestamp) {
    const delta = Math.max(0.001, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;
    this.updateSimulation(delta);
    this.render();
    this.frameRequest = requestAnimationFrame((ts) => this.frame(ts));
  }

  updateSimulation(delta) {
    const width = this.canvasWidth || window.innerWidth;
    const height = this.canvasHeight || window.innerHeight;
    const strideFloats = 13;

    this.instances.forEach((flake, idx) => {
      flake.phase += flake.freq * delta;
      flake.rotation += flake.rotationSpeed * delta;
      flake.y += flake.fallSpeed * delta;

      if (flake.y - flake.size > height) {
        flake.y = -flake.size;
        flake.x = Math.random() * width;
        flake.phase = Math.random() * Math.PI * 2;
      }

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
    });
  }

  render() {
    if (!this.device || !this.context) return;

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformArray);
    this.device.queue.writeBuffer(this.instanceBuffer, 0, this.instanceData.buffer, 0, this.instanceData.byteLength);

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

  async setupGlyphAtlas() {
    const glyphs = (this.config.snowletters && this.config.snowletters.length)
      ? this.config.snowletters
      : ['❄'];

    this.glyphCount = Math.max(1, glyphs.length);
    const cellSize = this.glyphSize;
    const width = cellSize * this.glyphCount;
    const height = cellSize;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable for glyph atlas');

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `bold ${Math.floor(cellSize * 0.7)}px serif`;

    glyphs.forEach((g, i) => {
      const metrics = ctx.measureText(g);
      const left = metrics.actualBoundingBoxLeft || 0;
      const right = metrics.actualBoundingBoxRight || 0;
      const ascent = metrics.actualBoundingBoxAscent || 0;
      const descent = metrics.actualBoundingBoxDescent || 0;
      const centerX = i * cellSize + cellSize / 2;
      const centerY = height / 2;
      const x = centerX - (right - left) / 2;
      const y = centerY + (ascent - descent) / 2;
      ctx.fillText(g, x, y);
    });

    // Проверка на монотонность текстуры
    let isMonotone = false;
    try {
      const imageData = ctx.getImageData(0, 0, width, height);
      isMonotone = this.isTextureMonotone(imageData);
    } catch (e) {
      // getImageData может не поддерживаться в тестовом окружении
      isMonotone = false;
    }
    
    const bitmap = await createImageBitmap(canvas);
    
    if (this.glyphTexture) {
      this.glyphTexture.destroy();
    }

    this.glyphTexture = this.device.createTexture({
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
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

  startFallback2D() {
    this.isFallback2D = true;
    if (!this.canvas || typeof this.canvas.getContext !== 'function') return;
    let ctx = null;
    try {
      ctx = this.canvas.getContext('2d');
    } catch (err) {
      console.warn('2D context unavailable, skipping fallback.', err);
      return;
    }
    if (!ctx) return;
    this.fallbackCtx = ctx;
    const {
      snowmax,
      snowminsize,
      snowmaxsize,
      sinkspeed,
      snowcolor,
      snowletters
    } = this.config;

    const sizeRange = snowmaxsize - snowminsize;
    this.fallbackFlakes = new Array(Math.max(1, snowmax)).fill(null).map((_, idx) => {
      const size = snowminsize + Math.random() * sizeRange;
      const speed = sinkspeed * (size / 20) * 20;
      return {
        x: Math.random() * window.innerWidth,
        y: -size - Math.random() * window.innerHeight,
        size,
        speed,
        sway: 10 + Math.random() * 25,
        phase: Math.random() * Math.PI * 2,
        freq: 0.8 + Math.random() * 1.4,
        color: snowcolor[idx % snowcolor.length],
        char: snowletters[idx % snowletters.length]
      };
    });

    const drawFallback = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.floor(window.innerWidth * ratio);
      const height = Math.floor(window.innerHeight * ratio);
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      ctx.clearRect(0, 0, width, height);
      ctx.font = `${Math.max(16, snowminsize)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      this.fallbackFlakes.forEach((flake) => {
        flake.phase += flake.freq * 0.016;
        flake.y += flake.speed * 0.016;
        const x = (flake.x + Math.sin(flake.phase) * flake.sway) * ratio;
        const y = flake.y * ratio;
        if (y - flake.size * ratio > height) {
          flake.y = -flake.size;
          flake.x = Math.random() * window.innerWidth;
        }
        ctx.fillStyle = flake.color;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.sin(flake.phase) * 0.2);
        ctx.fillText(flake.char, 0, 0);
        ctx.restore();
      });

      this.frameRequest = requestAnimationFrame(drawFallback);
    };

    this.fallbackDraw = drawFallback;
    drawFallback();
  }

  hexToRgb(hex) {
    const normalized = hex.replace('#', '');
    const bigint = parseInt(normalized, 16);
    const r = ((bigint >> 16) & 255) / 255;
    const g = ((bigint >> 8) & 255) / 255;
    const b = (bigint & 255) / 255;
    return { r, g, b };
  }

  parseCssColor(value) {
    if (!value) return null;
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'transparent') return null;

    const rgbMatch = trimmed.match(/^rgba?\(([^)]+)\)$/);
    if (rgbMatch) {
      const parts = rgbMatch[1].split(',').map((v) => v.trim());
      const r = Math.min(255, Math.max(0, parseFloat(parts[0])));
      const g = Math.min(255, Math.max(0, parseFloat(parts[1])));
      const b = Math.min(255, Math.max(0, parseFloat(parts[2])));
      const a = parts[3] !== undefined ? Math.min(1, Math.max(0, parseFloat(parts[3]))) : 1;
      return { r: r / 255, g: g / 255, b: b / 255, a };
    }

    if (trimmed.startsWith('#')) {
      let hex = trimmed.slice(1);
      if (hex.length === 3) {
        hex = hex.split('').map((ch) => ch + ch).join('') + 'ff';
      } else if (hex.length === 4) {
        hex = hex.split('').map((ch) => ch + ch).join('');
      } else if (hex.length === 6) {
        hex = `${hex}ff`;
      } else if (hex.length !== 8) {
        return null;
      }

      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      const a = parseInt(hex.slice(6, 8), 16) / 255;
      return { r, g, b, a };
    }

    return null;
  }

  computeLuminance(color) {
    const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const r = srgbToLinear(color.r);
    const g = srgbToLinear(color.g);
    const b = srgbToLinear(color.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  getSnowColorLightShare() {
    const colors = Array.isArray(this.config.snowcolor) ? this.config.snowcolor : [];
    let lightCount = 0;
    let totalCount = 0;

    colors.forEach((value) => {
      const parsed = this.parseCssColor(value);
      if (!parsed) return;
      totalCount += 1;
      const luminance = this.computeLuminance(parsed);
      if (luminance >= 0.75) {
        lightCount += 1;
      }
    });

    return {
      lightCount,
      totalCount,
      share: totalCount > 0 ? lightCount / totalCount : 0
    };
  }

  getEffectiveBackgroundColor() {
    const candidates = [document.body, document.documentElement];
    for (const el of candidates) {
      if (!el) continue;
      const styles = getComputedStyle(el);
      const parsed = this.parseCssColor(styles.backgroundColor);
      if (parsed && parsed.a > 0) {
        return parsed;
      }
    }
    return { r: 1, g: 1, b: 1, a: 1 };
  }

  updateGlowState() {
    const bg = this.getEffectiveBackgroundColor();
    const luminance = this.computeLuminance(bg);
    const { share } = this.getSnowColorLightShare();

    const hasLightBackground = luminance >= 0.9;
    const hasMostlyLightSnow = share >= 0.6;

    const glowStrength = hasLightBackground || hasMostlyLightSnow ? 0 : 1;
    if (this.uniformArray[5] === glowStrength) return;
    this.uniformArray[5] = glowStrength;
    if (this.uniformBuffer && this.device) {
      this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformArray);
    }
  }

  startBackgroundMonitoring() {
    this.stopBackgroundMonitoring();
    this.handleBackgroundChange = () => this.updateGlowState();

    const observer = new MutationObserver(this.handleBackgroundChange);
    [document.body, document.documentElement].forEach((el) => {
      if (!el) return;
      observer.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
    });
    this.backgroundObserver = observer;

    if (typeof window !== 'undefined' && window.matchMedia) {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      media.addEventListener('change', this.handleBackgroundChange);
      this.colorSchemeMedia = media;
    }
  }

  stopBackgroundMonitoring() {
    if (this.backgroundObserver) {
      this.backgroundObserver.disconnect();
      this.backgroundObserver = null;
    }
    if (this.colorSchemeMedia && this.handleBackgroundChange) {
      this.colorSchemeMedia.removeEventListener('change', this.handleBackgroundChange);
      this.colorSchemeMedia = null;
    }
    this.handleBackgroundChange = null;
  }

  isTextureMonotone(imageData) {
    const data = imageData.data;
    if (data.length === 0) return true;
    
    let firstR = -1, firstG = -1, firstB = -1, firstA = -1;
    let foundNonTransparent = false;
    
    // Находим первый непрозрачный пиксель
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a > 0) {
        firstR = data[i];
        firstG = data[i + 1];
        firstB = data[i + 2];
        firstA = a;
        foundNonTransparent = true;
        break;
      }
    }
    
    if (!foundNonTransparent) return true;
    
    // Проверяем все остальные непрозрачные пиксели
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      
      if (a > 0) {
        if (r !== firstR || g !== firstG || b !== firstB || a !== firstA) {
          return false;
        }
      }
    }
    
    return true;
  }
}

function stopSnow() {
  if (controller) {
    controller.destroy();
    controller = null;
  }
}

async function startSnow(config) {
  stopSnow();
  controller = new SnowWebGPUController(config);
  await controller.start();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const respond = typeof sendResponse === 'function' ? sendResponse : () => {};
  try {
    if (message.action === 'startSnow') {
      // Fire-and-forget launch; respond immediately to close the channel.
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

window.addEventListener('beforeunload', stopSnow);

const handleVisibilityChange = () => {
  if (!controller) return;
  if (document.hidden) {
    controller.pauseAnimations();
  } else {
    controller.resumeAnimations();
  }
};

document.addEventListener('visibilitychange', handleVisibilityChange);

// Auto-start if enabled
(async () => {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const stored = await chrome.storage.sync.get(['autoStart', 'snowmax', 'sinkspeed', 'snowminsize', 'snowmaxsize', 'colors', 'symbols', 'gifs', 'gifCount']);
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

// Export for testing
export { SnowWebGPUController };
