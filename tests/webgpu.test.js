import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock WebGPU API
const createMockWebGPU = () => {
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
    createRenderPipeline: vi.fn().mockReturnValue({
      getBindGroupLayout: vi.fn().mockReturnValue({})
    }),
    createBindGroup: vi.fn().mockReturnValue({}),
    createTexture: vi.fn().mockReturnValue({
      createView: vi.fn().mockReturnValue({}),
      destroy: vi.fn()
    }),
    createSampler: vi.fn().mockReturnValue({}),
    createCommandEncoder: vi.fn().mockReturnValue({
      beginRenderPass: vi.fn().mockReturnValue({
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        setVertexBuffer: vi.fn(),
        draw: vi.fn(),
        end: vi.fn()
      }),
      finish: vi.fn().mockReturnValue({})
    }),
    queue: {
      writeBuffer: vi.fn(),
      copyExternalImageToTexture: vi.fn(),
      submit: vi.fn()
    },
    destroy: vi.fn()
  };

  return {
    requestAdapter: vi.fn().mockResolvedValue({
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
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };

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
      expect(controller.config.snowminsize).toBe(15);
    });

    it('should merge user config with defaults', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController({
        snowmax: 100,
        sinkspeed: 0.8
      });

      expect(controller.config.snowmax).toBe(100);
      expect(controller.config.sinkspeed).toBe(0.8);
      expect(controller.config.snowminsize).toBe(15);
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
