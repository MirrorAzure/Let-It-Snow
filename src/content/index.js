const OVERLAY_ID = 'let-it-snow-webgpu-canvas';
const MAX_Z_INDEX = '2147483646';
const DEFAULT_CONFIG = {
  snowmax: 80,
  sinkspeed: 0.4,
  snowminsize: 15,
  snowmaxsize: 40,
  snowcolor: ['#ffffff'],
  snowletters: ['❄']
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
    this.uniformArray = new Float32Array(4);
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
  }

  async start() {
    this.createOverlayCanvas();
    const ok = await this.tryWebGPU();
    if (!ok) {
      this.startFallback2D();
    }
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
    const shaderSource = [
      'struct Uniforms {',
      '  viewport: vec2<f32>,',
      '  glyphCount: f32,',
      '  glyphSize: f32,',
      '};',
      '@group(0) @binding(0) var<uniform> uniforms: Uniforms;',
      '@group(0) @binding(1) var glyphSampler: sampler;',
      '@group(0) @binding(2) var glyphTexture: texture_2d<f32>;',
      'struct VSOut {',
      '  @builtin(position) position: vec4<f32>,',
      '  @location(0) uv: vec2<f32>,',
      '  @location(1) color: vec3<f32>,',
      '  @location(2) glyph: f32,',
      '};',
      '@vertex',
      'fn vs(',
      '  @location(0) position: vec2<f32>,',
      '  @location(1) uvIn: vec2<f32>,',
      '  @location(2) iPos: vec2<f32>,',
      '  @location(3) iSize: f32,',
      '  @location(4) iFall: f32,',
      '  @location(5) iPhase: f32,',
      '  @location(6) iFreq: f32,',
      '  @location(7) iSway: f32,',
      '  @location(8) iRot: f32,',
      '  @location(9) iRotSpeed: f32,',
      '  @location(10) iColor: vec3<f32>,',
      '  @location(11) iGlyph: f32',
      ') -> VSOut {',
      '  var out: VSOut;',
      '  let local = position * iSize;',
      '  let c = cos(iRot);',
      '  let s = sin(iRot);',
      '  let rotated = vec2<f32>(local.x * c - local.y * s, local.x * s + local.y * c);',
      '  let sway = sin(iPhase) * iSway;',
      '  let world = vec2<f32>(iPos.x + rotated.x + sway, iPos.y + rotated.y);',
      '  let clip = vec2<f32>(',
      '    (world.x / uniforms.viewport.x) * 2.0 - 1.0,',
      '    1.0 - (world.y / uniforms.viewport.y) * 2.0',
      '  );',
      '  out.position = vec4<f32>(clip, 0.0, 1.0);',
      '  out.uv = uvIn;',
      '  out.color = iColor;',
      '  out.glyph = iGlyph;',
      '  return out;',
      '}',
      '@fragment',
      'fn fs(',
      '  @location(0) uv: vec2<f32>,',
      '  @location(1) color: vec3<f32>,',
      '  @location(2) glyph: f32',
      ') -> @location(0) vec4<f32> {',
      '  let glyphIdx = clamp(i32(round(glyph)), 0, i32(uniforms.glyphCount) - 1);',
      '  let atlasWidth = uniforms.glyphSize * uniforms.glyphCount;',
      '  let atlasUV = vec2<f32>((',
      '    uv.x * uniforms.glyphSize + uniforms.glyphSize * f32(glyphIdx)) / atlasWidth,',
      '    uv.y',
      '  );',
      '  let glyphSample = textureSample(glyphTexture, glyphSampler, atlasUV);',
      '  let p = uv * 2.0 - 1.0;',
      '  let halo = exp(-6.0 * dot(p, p));',
      '  let alpha = clamp(glyphSample.a + halo * 0.35, 0.0, 1.0);',
      '  return vec4<f32>(color, alpha);',
      '}'
    ].join('\n');

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
      const colorHex = snowcolor[idx % snowcolor.length];
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
  }

  startFallback2D() {
    this.isFallback2D = true;
    if (!this.canvas || typeof this.canvas.getContext !== 'function') return;
    const ctx = this.canvas.getContext('2d');
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

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'startSnow') {
    startSnow(message.config || {}).catch((err) => console.error(err));
  } else if (message.action === 'stopSnow') {
    stopSnow();
  }
});

window.addEventListener('beforeunload', stopSnow);
