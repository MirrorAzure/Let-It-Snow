import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock WebGPU API
const createMockWebGPU = () => {
  const pipelineObjects = [];
  const mockDevice = {
    createBuffer: vi.fn((descriptor) => {
      const numFloats = Math.ceil(descriptor.size / 4);
      return {
        size: descriptor.size,
        usage: descriptor.usage,
        getMappedRange: vi.fn(() => new Float32Array(numFloats)),
        unmap: vi.fn(),
        destroy: vi.fn()
      };
    }),
    createShaderModule: vi.fn().mockReturnValue({
      getCompilationInfo: vi.fn().mockResolvedValue({ messages: [] })
    }),
    createBindGroupLayout: vi.fn().mockReturnValue({}),
    createPipelineLayout: vi.fn().mockReturnValue({}),
    createRenderPipeline: vi.fn((descriptor) => {
      const pipeline = { descriptor };
      pipelineObjects.push(pipeline);
      return pipeline;
    }),
    createBindGroup: vi.fn().mockReturnValue({}),
    createTexture: vi.fn().mockReturnValue({
      createView: vi.fn().mockReturnValue({}),
      destroy: vi.fn()
    }),
    createSampler: vi.fn().mockReturnValue({}),
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: vi.fn(() => ({
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        setVertexBuffer: vi.fn(),
        draw: vi.fn(),
        end: vi.fn()
      })),
      finish: vi.fn().mockReturnValue({})
    })),
    queue: {
      writeBuffer: vi.fn(),
      copyExternalImageToTexture: vi.fn(),
      submit: vi.fn()
    },
    lost: new Promise(() => {}),
    destroy: vi.fn(),
    __pipelineObjects: pipelineObjects
  };

  return {
    requestAdapter: vi.fn().mockResolvedValue({
      isFallbackAdapter: false,
      requestDevice: vi.fn().mockResolvedValue(mockDevice)
    }),
    getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm')
  };
};

const originalRandom = Math.random;
const originalGpu = Object.getOwnPropertyDescriptor(global.navigator, 'gpu');
const originalCreateImageBitmap = global.createImageBitmap;
const originalGetContext = HTMLCanvasElement.prototype.getContext;

describe('Snow Animation System', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    document.body.innerHTML = '<div id="root"></div>';
    
    global.window = {
      ...global.window,
      innerWidth: 1920,
      innerHeight: 1080,
      devicePixelRatio: 1,
      isSecureContext: true,
      matchMedia: vi.fn().mockReturnValue({
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };

    Object.defineProperty(global, 'isSecureContext', {
      value: true,
      configurable: true,
      writable: true
    });

    global.chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      }
    };

    Object.defineProperty(global.navigator, 'gpu', {
      value: createMockWebGPU(),
      configurable: true
    });

    global.createImageBitmap = vi.fn().mockResolvedValue({
      width: 100,
      height: 100,
      close: vi.fn()
    });

    HTMLCanvasElement.prototype.getContext = vi.fn((type) => {
      if (type === 'webgpu') {
        return {
          configure: vi.fn(),
          getCurrentTexture: vi.fn().mockReturnValue({
            createView: vi.fn().mockReturnValue({})
          })
        };
      }
      if (type === '2d') {
        return {
          clearRect: vi.fn(),
          fillRect: vi.fn(),
          fillText: vi.fn(),
          measureText: vi.fn().mockReturnValue({
            actualBoundingBoxLeft: 5,
            actualBoundingBoxRight: 25,
            actualBoundingBoxAscent: 20,
            actualBoundingBoxDescent: 5
          }),
          save: vi.fn(),
          restore: vi.fn(),
          translate: vi.fn(),
          rotate: vi.fn(),
          setTransform: vi.fn(),
          resetTransform: vi.fn(),
          getImageData: vi.fn().mockReturnValue({
            data: new Uint8ClampedArray(4)
          })
        };
      }
      return null;
    });

    global.ResizeObserver = vi.fn(function() {
      this.observe = vi.fn();
      this.disconnect = vi.fn();
      this.unobserve = vi.fn();
    });

    global.requestAnimationFrame = vi.fn((cb) => {
      const id = Math.random();
      setTimeout(() => cb(performance.now()), 16);
      return id;
    });

    global.cancelAnimationFrame = vi.fn();

    global.GPUBufferUsage = {
      VERTEX: 4,
      COPY_DST: 8,
      UNIFORM: 16
    };

    global.GPUTextureUsage = {
      TEXTURE_BINDING: 4,
      COPY_DST: 8,
      RENDER_ATTACHMENT: 16
    };

    global.GPUShaderStage = {
      VERTEX: 1,
      FRAGMENT: 2
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    Math.random = originalRandom;
    document.body.innerHTML = '';
    delete global.chrome;
    vi.resetModules();
    
    if (originalGpu) {
      Object.defineProperty(global.navigator, 'gpu', originalGpu);
    } else {
      delete global.navigator.gpu;
    }
    
    if (originalCreateImageBitmap) {
      global.createImageBitmap = originalCreateImageBitmap;
    }
    
    if (originalGetContext) {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    }
    
    vi.clearAllMocks();
  });

  describe('SnowWebGPUController', () => {
    it('should initialize with default config', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();

      expect(controller.config.snowmax).toBe(80);
      expect(controller.config.sinkspeed).toBe(0.4);
      expect(controller.config.snowminsize).toBe(2.0);
    });

    it('should merge user config with defaults', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController({
        snowmax: 100,
        sinkspeed: 0.8
      });

      expect(controller.config.snowmax).toBe(100);
      expect(controller.config.sinkspeed).toBe(0.8);
      expect(controller.config.snowminsize).toBe(2.0);
    });

    it('should create canvas with correct styles', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      controller.createOverlayCanvas();

      const canvas = document.getElementById('let-it-snow-webgpu-canvas');
      expect(canvas).not.toBeNull();
      expect(canvas.style.position).toBe('fixed');
      expect(canvas.style.pointerEvents).toBe('none');
      expect(canvas.style.zIndex).toBe('2147483646');
    });

    it('should start with WebGPU renderer', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();

      await controller.start();

      expect(controller.canvas).not.toBeNull();
      expect(controller.renderer).not.toBeNull();
    });

    it('should cleanup on destroy', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();

      await controller.start();
      controller.destroy();

      expect(controller.canvas).toBeNull();
      expect(controller.renderer).toBeNull();
      expect(document.getElementById('let-it-snow-webgpu-canvas')).toBeNull();
    });

    it('should pause and resume animations', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();

      await controller.start();

      expect(controller.isPaused).toBe(false);
      controller.pauseAnimations();
      expect(controller.isPaused).toBe(true);
      controller.resumeAnimations();
      expect(controller.isPaused).toBe(false);
    });
  });

  describe('WebGPURenderer', () => {
    it('should initialize successfully', async () => {
      const { WebGPURenderer } = await import('../src/content/webgpu-renderer.js');
      const canvas = document.createElement('canvas');
      const config = {
        snowmax: 10,
        snowminsize: 10,
        snowmaxsize: 20,
        snowcolor: ['#ffffff'],
        snowletters: ['❄']
      };

      const renderer = new WebGPURenderer(canvas, config);
      const result = await renderer.init();

      expect(result).toBe(true);
      expect(renderer.device).not.toBeNull();
    });

    it('should use premultiplied alpha blending for canvas compositing', async () => {
      const { WebGPURenderer } = await import('../src/content/webgpu-renderer.js');
      const canvas = document.createElement('canvas');
      const config = {
        snowmax: 10,
        snowminsize: 10,
        snowmaxsize: 20,
        snowcolor: ['#ffffff'],
        snowletters: ['❄']
      };

      const renderer = new WebGPURenderer(canvas, config);
      const result = await renderer.init();

      expect(result).toBe(true);

      expect(renderer.device.createRenderPipeline).toHaveBeenCalledTimes(2);

      const glowDescriptor = renderer.device.createRenderPipeline.mock.calls[0][0];
      const surfaceDescriptor = renderer.device.createRenderPipeline.mock.calls[1][0];
      const expectedBlend = {
        color: {
          srcFactor: 'one',
          dstFactor: 'one-minus-src-alpha',
          operation: 'add'
        },
        alpha: {
          srcFactor: 'one',
          dstFactor: 'one-minus-src-alpha',
          operation: 'add'
        }
      };

      expect(glowDescriptor.vertex.entryPoint).toBe('vsGlow');
      expect(glowDescriptor.fragment.entryPoint).toBe('fsGlow');
      expect(glowDescriptor.fragment.targets[0].blend).toEqual(expectedBlend);
      expect(surfaceDescriptor.vertex.entryPoint).toBe('vsSurface');
      expect(surfaceDescriptor.fragment.entryPoint).toBe('fsSurface');
      expect(surfaceDescriptor.fragment.targets[0].blend).toEqual(expectedBlend);
    });

    it('should render glow and surface in separate passes', async () => {
      const { WebGPURenderer } = await import('../src/content/webgpu-renderer.js');
      const canvas = document.createElement('canvas');
      const config = {
        snowmax: 10,
        snowminsize: 10,
        snowmaxsize: 20,
        snowcolor: ['#ffffff'],
        snowletters: ['❄']
      };

      const renderer = new WebGPURenderer(canvas, config);
      const result = await renderer.init();

      expect(result).toBe(true);

      renderer.instanceBufferNeedsUpdate = true;
      renderer.render();

      const renderEncoder = renderer.device.createCommandEncoder.mock.results.at(-1).value;
      expect(renderEncoder.beginRenderPass).toHaveBeenCalledTimes(2);
      expect(renderEncoder.beginRenderPass.mock.calls[0][0].colorAttachments[0].loadOp).toBe('clear');
      expect(renderEncoder.beginRenderPass.mock.calls[1][0].colorAttachments[0].loadOp).toBe('load');
    });

    it('should return false if WebGPU unavailable', async () => {
      Object.defineProperty(global.navigator, 'gpu', {
        value: undefined,
        configurable: true
      });

      const { WebGPURenderer } = await import('../src/content/webgpu-renderer.js');
      const canvas = document.createElement('canvas');
      const config = { snowmax: 10 };

      const renderer = new WebGPURenderer(canvas, config);
      const result = await renderer.init();

      expect(result).toBe(false);
    });

    it('should create instances based on config', async () => {
      const { WebGPURenderer } = await import('../src/content/webgpu-renderer.js');
      const canvas = document.createElement('canvas');
      const config = {
        snowmax: 32,
        snowminsize: 10,
        snowmaxsize: 20,
        snowcolor: ['#ffffff'],
        snowletters: ['❄']
      };

      const renderer = new WebGPURenderer(canvas, config);
      await renderer.init();

      expect(renderer.instances.length).toBe(32);
    });
  });

  describe('Fallback2DRenderer', () => {
    it('should initialize 2D renderer', async () => {
      const { Fallback2DRenderer } = await import('../src/content/fallback-2d-renderer.js');
      const canvas = document.createElement('canvas');
      const config = {
        snowmax: 5,
        snowminsize: 10,
        snowmaxsize: 20,
        sinkspeed: 1.0,
        snowcolor: ['#ffffff'],
        snowletters: ['❄']
      };

      const renderer = new Fallback2DRenderer(canvas, config);
      const result = renderer.init();

      expect(result).toBe(true);
      expect(renderer.flakes.length).toBe(5);
    });

    it('should create flakes with correct properties', async () => {
      const { Fallback2DRenderer } = await import('../src/content/fallback-2d-renderer.js');
      const canvas = document.createElement('canvas');
      const config = {
        snowmax: 3,
        snowminsize: 10,
        snowmaxsize: 20,
        sinkspeed: 1.0,
        snowcolor: ['#ffffff'],
        snowletters: ['❄']
      };

      const renderer = new Fallback2DRenderer(canvas, config);
      renderer.init();

      const flake = renderer.flakes[0];
      expect(flake).toHaveProperty('x');
      expect(flake).toHaveProperty('y');
      expect(flake).toHaveProperty('size');
      expect(flake).toHaveProperty('speed');
      expect(flake).toHaveProperty('color');
      expect(flake).toHaveProperty('char');
    });

    it('should keep minimum active flakes when respawn is throttled', async () => {
      const { Fallback2DRenderer } = await import('../src/content/fallback-2d-renderer.js');
      const canvas = document.createElement('canvas');
      const config = {
        snowmax: 12,
        snowminsize: 10,
        snowmaxsize: 20,
        sinkspeed: 1.0,
        snowcolor: ['#ffffff'],
        snowletters: ['❄'],
        canvas2dRespawnPauseFps: 120,
        canvas2dRespawnResumeFps: 121
      };

      const renderer = new Fallback2DRenderer(canvas, config);
      renderer.init();

      renderer.flakes.forEach((flake) => {
        flake.y = window.innerHeight + flake.size + 1;
        flake.isAwaitingRespawn = false;
      });

      renderer.start();
      vi.advanceTimersByTime(96);

      const activeFlakes = renderer.flakes.filter((flake) => !flake.isAwaitingRespawn);
      const expectedMin = Math.min(renderer.flakes.length, renderer.minActiveFlakesWhenThrottled);

      expect(activeFlakes.length).toBeGreaterThan(0);
      expect(activeFlakes.length).toBeGreaterThanOrEqual(expectedMin);

      renderer.stop();
    });

    it('should sanitize invalid flake state and recover rendering', async () => {
      const { Fallback2DRenderer } = await import('../src/content/fallback-2d-renderer.js');
      const canvas = document.createElement('canvas');
      const config = {
        snowmax: 5,
        snowminsize: 10,
        snowmaxsize: 20,
        sinkspeed: 1.0,
        snowcolor: ['#ffffff'],
        snowletters: ['❄']
      };

      const renderer = new Fallback2DRenderer(canvas, config);
      renderer.init();

      const corrupted = renderer.flakes[0];
      corrupted.y = Number.NaN;
      corrupted.x = Number.POSITIVE_INFINITY;
      corrupted.baseX = Number.NaN;
      corrupted.velocityY = Number.NaN;

      renderer.start();
      vi.advanceTimersByTime(64);

      expect(Number.isFinite(corrupted.y)).toBe(true);
      expect(Number.isFinite(corrupted.x)).toBe(true);
      expect(Number.isFinite(corrupted.baseX)).toBe(true);
      expect(Number.isFinite(corrupted.velocityY)).toBe(true);

      renderer.stop();
    });

    it('should mix sentence and glyph flakes in initial active pool', async () => {
      const { Fallback2DRenderer } = await import('../src/content/fallback-2d-renderer.js');
      const canvas = document.createElement('canvas');
      const config = {
        snowmax: 20,
        snowminsize: 10,
        snowmaxsize: 20,
        sinkspeed: 1.0,
        snowcolor: ['#ffffff'],
        snowletters: ['❄', '✺'],
        snowsentences: ['HELLO', 'WORLD'],
        sentenceCount: 6,
        canvas2dInitialActiveFlakes: 10
      };

      const renderer = new Fallback2DRenderer(canvas, config);
      renderer.init();

      const activeFlakes = renderer.flakes.filter((flake) => !flake.isAwaitingRespawn);
      const activeSentences = activeFlakes.filter((flake) => flake.isSentence).length;
      const activeGlyphs = activeFlakes.filter((flake) => !flake.isSentence).length;

      expect(activeFlakes.length).toBe(10);
      expect(activeSentences).toBeGreaterThan(0);
      expect(activeGlyphs).toBeGreaterThan(0);
    });

    it('should render a glow pass in 2D fallback', async () => {
      const { Fallback2DRenderer } = await import('../src/content/fallback-2d-renderer.js');
      const canvas = document.createElement('canvas');
      const config = {
        snowmax: 1,
        snowminsize: 10,
        snowmaxsize: 20,
        sinkspeed: 1.0,
        snowcolor: ['#ffffff'],
        snowletters: ['❄'],
        minGlowStrength: 0.6
      };

      const renderer = new Fallback2DRenderer(canvas, config);
      renderer.init();
      renderer.flakes[0].isAwaitingRespawn = false;
      renderer.flakes[0].x = 120;
      renderer.flakes[0].baseX = 120;
      renderer.flakes[0].y = 120;
      renderer.start();
      renderer.drawCallback(performance.now());

      expect(renderer.ctx.fillText.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(renderer.ctx.globalAlpha).toBe(1);

      renderer.stop();
    });
  });

  describe('Integration', () => {
    it('should start with WebGPU when available', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController({ snowmax: 10 });

      await controller.start();

      expect(controller.renderer).not.toBeNull();
      expect(document.getElementById('let-it-snow-webgpu-canvas')).not.toBeNull();
    });

    it('should fallback to 2D when WebGPU unavailable', async () => {
      Object.defineProperty(global.navigator, 'gpu', {
        value: undefined,
        configurable: true
      });

      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController({ snowmax: 10 });

      await controller.start();

      expect(controller.renderer).not.toBeNull();
    });
  });
});
