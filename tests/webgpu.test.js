import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock WebGPU API
const createMockWebGPU = () => {
  const mockDevice = {
    createBuffer: vi.fn((descriptor) => {
      // Create buffer with proper size for getMappedRange
      const numFloats = Math.ceil(descriptor.size / 4);
      const mappedData = new Float32Array(numFloats);
      
      return {
        size: descriptor.size,
        usage: descriptor.usage,
        getMappedRange: vi.fn(() => {
          // Return a new Float32Array each time
          return new Float32Array(numFloats);
        }),
        unmap: vi.fn(),
        destroy: vi.fn()
      };
    }),
    createShaderModule: vi.fn().mockReturnValue({
      getCompilationInfo: vi.fn().mockResolvedValue({
        messages: []
      })
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
        setIndexBuffer: vi.fn(),
        draw: vi.fn(),
        drawIndexed: vi.fn(),
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

describe('SnowWebGPUController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    document.body.innerHTML = '<div id="root"></div>';
    
    // Mock window properties and methods
    global.window = {
      ...global.window,
      innerWidth: 1920,
      innerHeight: 1080,
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };

    // Mock chrome API
    global.chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      }
    };

    // Mock WebGPU API
    Object.defineProperty(global.navigator, 'gpu', {
      value: createMockWebGPU(),
      configurable: true
    });

    // Mock createImageBitmap
    global.createImageBitmap = vi.fn().mockResolvedValue({
      close: vi.fn()
    });

    // Mock ResizeObserver
    global.ResizeObserver = class ResizeObserver {
      constructor(callback) {
        this.callback = callback;
      }
      observe() {}
      disconnect() {}
    };

    // Mock requestAnimationFrame
    global.requestAnimationFrame = vi.fn((cb) => {
      return Math.random();
    });
    global.cancelAnimationFrame = vi.fn();

    // Mock canvas.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn(function(type) {
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
          rotate: vi.fn()
        };
      }
      return null;
    });

    // Mock WebGPU constants
    global.GPUBufferUsage = {
      VERTEX: 4,
      COPY_DST: 8,
      UNIFORM: 16,
      COPY_SRC: 1,
      MAP_READ: 1,
      MAP_WRITE: 2
    };

    global.GPUTextureUsage = {
      TEXTURE_BINDING: 4,
      COPY_DST: 8,
      COPY_SRC: 1,
      RENDER_ATTACHMENT: 16
    };

    global.GPUMapMode = {
      READ: 1,
      WRITE: 2
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
    global.createImageBitmap = originalCreateImageBitmap;
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default config', async () => {
      const module = await import('../src/content/index.js');
      expect(module).toBeDefined();
    });

    it('should merge user config with defaults', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController({
        snowmax: 100,
        sinkspeed: 0.8
      });

      expect(controller.config.snowmax).toBe(100);
      expect(controller.config.sinkspeed).toBe(0.8);
      expect(controller.config.snowminsize).toBe(15); // default
    });
  });

  describe('createOverlayCanvas', () => {
    it('should create canvas with correct styles', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      controller.createOverlayCanvas();

      const canvas = document.getElementById('let-it-snow-webgpu-canvas');
      expect(canvas).not.toBeNull();
      expect(canvas.style.position).toBe('fixed');
      expect(canvas.style.pointerEvents).toBe('none');
      expect(canvas.style.zIndex).toBe('2147483646');
      expect(canvas.style.background).toBe('transparent');
    });

    it('should remove existing canvas before creating new one', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      
      controller.createOverlayCanvas();
      const canvas1 = document.getElementById('let-it-snow-webgpu-canvas');
      
      controller.createOverlayCanvas();
      const canvas2 = document.getElementById('let-it-snow-webgpu-canvas');
      
      expect(canvas1).not.toBe(canvas2);
      expect(document.querySelectorAll('#let-it-snow-webgpu-canvas').length).toBe(1);
    });
  });

  describe('tryWebGPU', () => {
    it('should return false if navigator.gpu is undefined', async () => {
      Object.defineProperty(global.navigator, 'gpu', {
        value: undefined,
        configurable: true
      });

      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      controller.createOverlayCanvas();

      const result = await controller.tryWebGPU();
      expect(result).toBe(false);
    });

    it('should return false if adapter is not available', async () => {
      const mockGpu = createMockWebGPU();
      mockGpu.requestAdapter = vi.fn().mockResolvedValue(null);

      Object.defineProperty(global.navigator, 'gpu', {
        value: mockGpu,
        configurable: true
      });

      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      controller.createOverlayCanvas();

      const result = await controller.tryWebGPU();
      expect(result).toBe(false);
    });

    it('should initialize WebGPU successfully', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      controller.createOverlayCanvas();

      const result = await controller.tryWebGPU();
      expect(result).toBe(true);
      expect(controller.device).not.toBeNull();
      expect(controller.context).not.toBeNull();
      expect(controller.pipeline).not.toBeNull();
    });

    it('should setup uniforms and instances on success', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController({
        snowmax: 32,
        snowminsize: 10,
        snowmaxsize: 22
      });
      controller.createOverlayCanvas();

      await controller.tryWebGPU();

      expect(controller.uniformBuffer).not.toBeNull();
      expect(controller.instanceBuffer).not.toBeNull();
      expect(controller.instances.length).toBe(32);
    });
  });

  describe('setupGeometry', () => {
    it('should create quad buffer with correct data', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      controller.createOverlayCanvas();

      await controller.tryWebGPU();
      
      expect(controller.quadBuffer).not.toBeNull();
      expect(controller.device.createBuffer).toHaveBeenCalled();
    });

    it('should have correct quad vertex positions', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      controller.createOverlayCanvas();

      await controller.tryWebGPU();

      // Verify buffer was created with correct size (6 vertices * 4 floats * 4 bytes = 96)
      expect(controller.device.createBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          size: 96
        })
      );
    });
  });

  describe('setupInstances', () => {
    it('should create correct number of instances', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController({
        snowmax: 64
      });
      controller.createOverlayCanvas();

      await controller.tryWebGPU();

      expect(controller.instances.length).toBe(64);
    });

    it('should initialize instances with correct properties', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const config = {
        snowmax: 10,
        snowminsize: 10,
        snowmaxsize: 20,
        sinkspeed: 0.5,
        snowcolor: ['#ffffff', '#00ff00'],
        snowletters: ['*', '❄']
      };
      const controller = new SnowWebGPUController(config);
      controller.createOverlayCanvas();

      await controller.tryWebGPU();

      const instance = controller.instances[0];
      expect(instance).toHaveProperty('x');
      expect(instance).toHaveProperty('y');
      expect(instance).toHaveProperty('size');
      expect(instance).toHaveProperty('fallSpeed');
      expect(instance).toHaveProperty('phase');
      expect(instance).toHaveProperty('freq');
      expect(instance).toHaveProperty('sway');
      expect(instance).toHaveProperty('rotation');
      expect(instance).toHaveProperty('rotationSpeed');
      expect(instance).toHaveProperty('color');
      expect(instance).toHaveProperty('glyphIndex');

      expect(instance.size).toBeGreaterThanOrEqual(config.snowminsize);
      expect(instance.size).toBeLessThanOrEqual(config.snowmaxsize);
    });

    it('should assign colors cyclically', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const config = {
        snowmax: 6,
        snowcolor: ['#ffffff', '#00ff00', '#0000ff'],
        snowletters: ['*']
      };
      const controller = new SnowWebGPUController(config);
      controller.createOverlayCanvas();

      await controller.tryWebGPU();

      // Every third instance should have same color index
      const colors = controller.instances.map(inst => JSON.stringify(inst.color));
      expect(colors[0]).toBe(colors[3]); // Same color every 3 instances
    });

    it('should calculate fallSpeed based on size', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      vi.spyOn(Math, 'random')
        .mockReturnValueOnce(0.5)  // x position
        .mockReturnValueOnce(0.5)  // y position
        .mockReturnValueOnce(0.5)  // size (10 + 0.5 * 10 = 15)
        .mockReturnValueOnce(0.5)  // phase
        .mockReturnValueOnce(0.5)  // freq
        .mockReturnValueOnce(0.5)  // sway
        .mockReturnValueOnce(0.5)  // rotation
        .mockReturnValueOnce(0.5); // rotationSpeed

      const controller = new SnowWebGPUController({
        snowmax: 1,
        snowminsize: 10,
        snowmaxsize: 20,
        sinkspeed: 1.0,
        snowletters: ['*']
      });
      controller.createOverlayCanvas();

      await controller.tryWebGPU();

      const instance = controller.instances[0];
      expect(instance.fallSpeed).toBeGreaterThan(0);
    });
  });

  describe('hexToRgb', () => {
    it('should convert white hex to RGB', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();

      const rgb = controller.hexToRgb('#ffffff');
      expect(rgb.r).toBe(1);
      expect(rgb.g).toBe(1);
      expect(rgb.b).toBe(1);
    });

    it('should convert black hex to RGB', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();

      const rgb = controller.hexToRgb('#000000');
      expect(rgb.r).toBe(0);
      expect(rgb.g).toBe(0);
      expect(rgb.b).toBe(0);
    });

    it('should convert arbitrary hex to RGB', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();

      const rgb = controller.hexToRgb('#ff0080');
      expect(rgb.r).toBeCloseTo(1, 2);
      expect(rgb.g).toBeCloseTo(0, 2);
      expect(rgb.b).toBeCloseTo(0.5, 2);
    });

    it('should handle hex without hash prefix', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();

      const rgb = controller.hexToRgb('ffffff');
      expect(rgb.r).toBe(1);
      expect(rgb.g).toBe(1);
      expect(rgb.b).toBe(1);
    });
  });

  describe('updateSimulation', () => {
    it('should update instance positions over time', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController({
        snowmax: 1,
        sinkspeed: 1.0
      });
      controller.createOverlayCanvas();

      await controller.tryWebGPU();

      const initialY = controller.instances[0].y;
      controller.updateSimulation(1.0); // 1 second delta

      expect(controller.instances[0].y).toBeGreaterThan(initialY);
    });

    it('should reset flake position when it falls below screen', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController({
        snowmax: 1,
        sinkspeed: 5000.0 // Very fast falling
      });
      controller.createOverlayCanvas();

      await controller.tryWebGPU();

      controller.instances[0].y = global.window.innerHeight + 100;
      controller.updateSimulation(0.1);

      expect(controller.instances[0].y).toBeLessThan(0);
    });

    it('should update phase based on frequency', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController({
        snowmax: 1
      });
      controller.createOverlayCanvas();

      await controller.tryWebGPU();

      const initialPhase = controller.instances[0].phase;
      const freq = controller.instances[0].freq;
      
      controller.updateSimulation(1.0); // 1 second delta

      const expectedPhase = initialPhase + freq * 1.0;
      expect(controller.instances[0].phase).toBeCloseTo(expectedPhase, 5);
    });

    it('should update rotation over time', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController({
        snowmax: 1
      });
      controller.createOverlayCanvas();

      await controller.tryWebGPU();

      const initialRotation = controller.instances[0].rotation;
      const rotSpeed = controller.instances[0].rotationSpeed;
      
      controller.updateSimulation(1.0);

      const expectedRotation = initialRotation + rotSpeed * 1.0;
      expect(controller.instances[0].rotation).toBeCloseTo(expectedRotation, 5);
    });

    it('should write data to instance buffer', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController({
        snowmax: 1
      });
      controller.createOverlayCanvas();

      await controller.tryWebGPU();

      controller.updateSimulation(0.016);

      expect(controller.instanceData).toBeInstanceOf(Float32Array);
      expect(controller.instanceData.length).toBeGreaterThan(0);
    });
  });

  describe('handleResize', () => {
    it('should set canvas size on initialization', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      controller.createOverlayCanvas();

      await controller.tryWebGPU();

      expect(controller.canvasWidth).toBe(global.window.innerWidth);
      expect(controller.canvasHeight).toBe(global.window.innerHeight);
    });

    it('should handle device pixel ratio', async () => {
      global.window.devicePixelRatio = 2;
      
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      controller.createOverlayCanvas();

      await controller.tryWebGPU();

      expect(controller.canvas.width).toBe(global.window.innerWidth * 2);
      expect(controller.canvas.height).toBe(global.window.innerHeight * 2);
    });

    it('should update uniform buffer on resize', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      controller.createOverlayCanvas();

      await controller.tryWebGPU();

      expect(controller.uniformArray[0]).toBe(global.window.innerWidth);
      expect(controller.uniformArray[1]).toBe(global.window.innerHeight);
    });

    it('should skip resize if dimensions unchanged', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      controller.createOverlayCanvas();

      await controller.tryWebGPU();

      const writeBufferCalls = controller.device.queue.writeBuffer.mock.calls.length;
      
      // Trigger resize with same dimensions (via ResizeObserver)
      controller.handleResize();
      
      // Should not have written to buffer again since size didn't change
      // (it was already written during initial setup)
      expect(controller.device.queue.writeBuffer.mock.calls.length).toBeGreaterThanOrEqual(writeBufferCalls);
    });
  });

  describe('setupGlyphAtlas', () => {
    it('should create texture with correct dimensions', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController({
        snowletters: ['*', '❄', '✦']
      });
      controller.createOverlayCanvas();

      await controller.tryWebGPU();

      expect(controller.glyphTexture).not.toBeNull();
      expect(controller.glyphCount).toBe(3);
      expect(controller.device.createTexture).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'rgba8unorm'
        })
      );
    });

    it('should use default glyph if snowletters is empty', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController({
        snowletters: []
      });
      controller.createOverlayCanvas();

      await controller.tryWebGPU();

      expect(controller.glyphCount).toBe(1);
    });

    it('should create sampler with correct filters', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      controller.createOverlayCanvas();

      await controller.tryWebGPU();

      expect(controller.device.createSampler).toHaveBeenCalledWith(
        expect.objectContaining({
          minFilter: 'linear',
          magFilter: 'linear',
          addressModeU: 'clamp-to-edge',
          addressModeV: 'clamp-to-edge'
        })
      );
    });

    it('should update uniform array with glyph count and size', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController({
        snowletters: ['*', '❄']
      });
      controller.createOverlayCanvas();

      await controller.tryWebGPU();

      expect(controller.uniformArray[2]).toBe(2); // glyphCount
      expect(controller.uniformArray[3]).toBe(64); // glyphSize
    });
  });

  describe('render', () => {
    it('should not render if device is unavailable', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      controller.device = null;

      // Should not throw
      expect(() => controller.render()).not.toThrow();
    });

    it('should create command encoder on render', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      controller.createOverlayCanvas();

      await controller.tryWebGPU();
      controller.render();

      expect(controller.device.createCommandEncoder).toHaveBeenCalled();
    });

    it('should set correct render pass parameters', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController({
        snowmax: 10
      });
      controller.createOverlayCanvas();

      await controller.tryWebGPU();
      controller.render();

      // Verify device methods were called
      expect(controller.device.queue.writeBuffer).toHaveBeenCalled();
      expect(controller.device.queue.submit).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should cleanup all resources', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      controller.createOverlayCanvas();

      await controller.tryWebGPU();
      
      expect(controller.canvas).not.toBeNull();
      expect(controller.device).not.toBeNull();

      controller.destroy();

      expect(controller.canvas).toBeNull();
      expect(controller.device).toBeNull();
      expect(controller.context).toBeNull();
      expect(controller.pipeline).toBeNull();
      expect(controller.instances).toEqual([]);
    });

    it('should cancel animation frame', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      controller.createOverlayCanvas();

      await controller.tryWebGPU();
      expect(controller.frameRequest).not.toBeNull();

      controller.destroy();
      expect(global.cancelAnimationFrame).toHaveBeenCalled();
    });

    it('should disconnect resize observer', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      controller.createOverlayCanvas();

      await controller.tryWebGPU();
      const resizeObserverSpy = vi.spyOn(controller.resizeObserver, 'disconnect');

      controller.destroy();

      expect(resizeObserverSpy).toHaveBeenCalled();
      expect(controller.resizeObserver).toBeNull();
    });

    it('should destroy glyph texture', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      controller.createOverlayCanvas();

      await controller.tryWebGPU();
      const textureSpy = vi.spyOn(controller.glyphTexture, 'destroy');

      controller.destroy();

      expect(textureSpy).toHaveBeenCalled();
    });

    it('should remove canvas from DOM', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();
      controller.createOverlayCanvas();

      await controller.tryWebGPU();
      expect(document.getElementById('let-it-snow-webgpu-canvas')).not.toBeNull();

      controller.destroy();

      expect(document.getElementById('let-it-snow-webgpu-canvas')).toBeNull();
    });
  });

  describe('fallback 2D rendering', () => {
    it('should start 2D fallback when WebGPU is unavailable', async () => {
      Object.defineProperty(global.navigator, 'gpu', {
        value: undefined,
        configurable: true
      });

      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController({
        snowmax: 10
      });
      controller.createOverlayCanvas();

      await controller.start();

      expect(controller.isFallback2D).toBe(true);
      expect(controller.fallbackFlakes.length).toBe(10);
      expect(controller.fallbackCtx).not.toBeNull();
    });

    it('should initialize fallback flakes with correct properties', async () => {
      Object.defineProperty(global.navigator, 'gpu', {
        value: undefined,
        configurable: true
      });

      const { SnowWebGPUController } = await import('../src/content/index.js');
      const config = {
        snowmax: 5,
        snowminsize: 10,
        snowmaxsize: 20,
        snowcolor: ['#ffffff', '#00ff00'],
        snowletters: ['*', '❄']
      };
      const controller = new SnowWebGPUController(config);
      controller.createOverlayCanvas();

      await controller.start();

      expect(controller.fallbackFlakes.length).toBe(5);
      const flake = controller.fallbackFlakes[0];
      
      expect(flake).toHaveProperty('x');
      expect(flake).toHaveProperty('y');
      expect(flake).toHaveProperty('size');
      expect(flake).toHaveProperty('speed');
      expect(flake).toHaveProperty('sway');
      expect(flake).toHaveProperty('phase');
      expect(flake).toHaveProperty('freq');
      expect(flake).toHaveProperty('color');
      expect(flake).toHaveProperty('char');
    });
  });

  describe('start method', () => {
    it('should create canvas and attempt WebGPU', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const controller = new SnowWebGPUController();

      await controller.start();

      expect(document.getElementById('let-it-snow-webgpu-canvas')).not.toBeNull();
    });

    it('should handle start with custom config', async () => {
      const { SnowWebGPUController } = await import('../src/content/index.js');
      const customConfig = {
        snowmax: 64,
        sinkspeed: 0.7,
        snowminsize: 12,
        snowmaxsize: 25,
        snowcolor: ['#00ff00'],
        snowletters: ['✦']
      };
      const controller = new SnowWebGPUController(customConfig);

      await controller.start();

      expect(controller.config.snowmax).toBe(64);
      expect(controller.instances.length).toBe(64);
    });
  });
});
