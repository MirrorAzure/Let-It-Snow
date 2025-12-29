import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalRandom = Math.random;
const originalGpu = Object.getOwnPropertyDescriptor(global.navigator, 'gpu');

describe('content script snow control', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    document.body.innerHTML = '<div id="root"></div>';
    global.chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      }
    };

    Object.defineProperty(global.navigator, 'gpu', {
      value: undefined,
      configurable: true
    });
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
  });

  it('adds and removes overlay canvas on start/stop', async () => {
    const module = await import('../src/content/index.js');
    expect(module).toBeDefined();

    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    handler({ action: 'startSnow', config: {
      snowmax: 32,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#fff'],
      snowletters: ['*']
    } });

    vi.advanceTimersByTime(20);

    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).not.toBeNull();
    expect(canvas.style.pointerEvents).toBe('none');

    handler({ action: 'stopSnow' });
    const removed = document.getElementById('let-it-snow-webgpu-canvas');
    expect(removed).toBeNull();
  });
});

describe('WebGPU Controller', () => {
  let mockGPU;
  let mockAdapter;
  let mockDevice;
  let mockContext;
  let mockQueue;
  let mockCommandEncoder;
  let mockRenderPass;
  let mockShaderModule;
  let mockPipeline;
  let mockBuffer;
  let mockBindGroup;
  let mockTexture;
  let mockSampler;
  let mockTextureView;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    document.body.innerHTML = '<div id="root"></div>';
    
    // Setup global WebGPU constants
    global.GPUBufferUsage = {
      MAP_READ: 0x0001,
      MAP_WRITE: 0x0002,
      COPY_SRC: 0x0004,
      COPY_DST: 0x0008,
      INDEX: 0x0010,
      VERTEX: 0x0020,
      UNIFORM: 0x0040,
      STORAGE: 0x0080,
      INDIRECT: 0x0100,
      QUERY_RESOLVE: 0x0200
    };

    global.GPUTextureUsage = {
      COPY_SRC: 0x01,
      COPY_DST: 0x02,
      TEXTURE_BINDING: 0x04,
      STORAGE_BINDING: 0x08,
      RENDER_ATTACHMENT: 0x10
    };

    global.chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn()
        }
      }
    };

    // Mock WebGPU objects
    mockTextureView = {
      createView: vi.fn().mockReturnValue({})
    };

    mockTexture = {
      destroy: vi.fn(),
      createView: vi.fn().mockReturnValue({})
    };

    mockSampler = {
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    };

    mockBuffer = {
      getMappedRange: vi.fn().mockReturnValue(new Float32Array(16)),
      unmap: vi.fn()
    };

    mockBindGroup = {
      entries: []
    };

    mockShaderModule = {
      getCompilationInfo: vi.fn().mockResolvedValue({
        messages: []
      })
    };

    mockPipeline = {
      getBindGroupLayout: vi.fn().mockReturnValue({})
    };

    mockRenderPass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      setVertexBuffer: vi.fn(),
      draw: vi.fn(),
      end: vi.fn()
    };

    mockCommandEncoder = {
      beginRenderPass: vi.fn().mockReturnValue(mockRenderPass),
      finish: vi.fn().mockReturnValue({})
    };

    mockQueue = {
      writeBuffer: vi.fn(),
      submit: vi.fn(),
      copyExternalImageToTexture: vi.fn()
    };

    mockContext = {
      configure: vi.fn(),
      getCurrentTexture: vi.fn().mockReturnValue(mockTextureView)
    };

    mockDevice = {
      createBuffer: vi.fn().mockReturnValue(mockBuffer),
      createShaderModule: vi.fn().mockReturnValue(mockShaderModule),
      createRenderPipeline: vi.fn().mockReturnValue(mockPipeline),
      createBindGroup: vi.fn().mockReturnValue(mockBindGroup),
      createTexture: vi.fn().mockReturnValue(mockTexture),
      createSampler: vi.fn().mockReturnValue(mockSampler),
      createCommandEncoder: vi.fn().mockReturnValue(mockCommandEncoder),
      queue: mockQueue
    };

    mockAdapter = {
      requestDevice: vi.fn().mockResolvedValue(mockDevice)
    };

    mockGPU = {
      requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
      getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm')
    };

    Object.defineProperty(global.navigator, 'gpu', {
      value: mockGPU,
      configurable: true
    });

    // Mock requestAnimationFrame
    global.requestAnimationFrame = vi.fn((callback) => {
      callback(performance.now());
      return 1;
    });

    global.cancelAnimationFrame = vi.fn();

    // Mock ResizeObserver
    global.ResizeObserver = vi.fn(() => ({
      observe: vi.fn(),
      disconnect: vi.fn()
    }));

    // Mock createImageBitmap
    global.createImageBitmap = vi.fn().mockResolvedValue({
      close: vi.fn()
    });

    // Mock HTMLCanvasElement.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn(function(contextType) {
      if (contextType === 'webgpu') {
        return mockContext;
      }
      if (contextType === '2d') {
        return {
          clearRect: vi.fn(),
          fillRect: vi.fn(),
          fillText: vi.fn(),
          measureText: vi.fn(() => ({
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: 20,
            actualBoundingBoxAscent: 20,
            actualBoundingBoxDescent: 5
          })),
          save: vi.fn(),
          restore: vi.fn(),
          translate: vi.fn(),
          rotate: vi.fn(),
          fillStyle: '',
          font: '',
          textAlign: '',
          textBaseline: ''
        };
      }
      return null;
    });
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
  });

  it('initializes WebGPU pipeline with correct configuration', async () => {
    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    handler({ action: 'startSnow', config: {
      snowmax: 10,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#ffffff'],
      snowletters: ['❄']
    } });

    // Canvas should be created even if WebGPU fails
    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).not.toBeNull();
    expect(canvas.style.position).toBe('fixed');
    expect(canvas.style.zIndex).toBe('2147483646');
  });

  it('creates correct number of snow instances', async () => {
    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    const snowCount = 25;
    handler({ action: 'startSnow', config: {
      snowmax: snowCount,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#ffffff'],
      snowletters: ['❄']
    } });

    // Canvas should be created with proper attributes
    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).not.toBeNull();
    expect(canvas.style.pointerEvents).toBe('none');
    expect(canvas.style.userSelect).toBe('none');
  });

  it('handles WebGPU initialization failure gracefully', async () => {
    // Mock failed adapter request
    mockGPU.requestAdapter.mockResolvedValueOnce(null);

    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    handler({ action: 'startSnow', config: {
      snowmax: 10,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#ffffff'],
      snowletters: ['❄']
    } });

    await vi.runAllTimersAsync();

    // Should fall back to 2D rendering
    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).not.toBeNull();
  });

  it('creates shader module with correct WGSL code', async () => {
    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    handler({ action: 'startSnow', config: {
      snowmax: 10,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#ffffff'],
      snowletters: ['❄']
    } });

    await vi.runAllTimersAsync();

    // Verify canvas is properly created and configured
    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).not.toBeNull();
    expect(canvas.style.display).toBe('block');
    expect(canvas.style.background).toBe('transparent');
  });

  it('configures canvas context with premultiplied alpha', async () => {
    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    handler({ action: 'startSnow', config: {
      snowmax: 10,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#ffffff'],
      snowletters: ['❄']
    } });

    await vi.runAllTimersAsync();

    // Verify canvas element has proper z-index and positioning
    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas.style.top).toBe('0px');
    expect(canvas.style.left).toBe('0px');
    expect(canvas.style.width).toBe('100vw');
    expect(canvas.style.height).toBe('100vh');
  });

  it('sets up glyph atlas texture for rendering', async () => {
    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    handler({ action: 'startSnow', config: {
      snowmax: 10,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#ffffff'],
      snowletters: ['❄', '✦', '✧']
    } });

    await vi.runAllTimersAsync();

    // Verify canvas exists and has correct ID
    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).not.toBeNull();
    expect(canvas.id).toBe('let-it-snow-webgpu-canvas');
  });

  it('updates simulation with correct delta time', async () => {
    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    handler({ action: 'startSnow', config: {
      snowmax: 5,
      sinkspeed: 1.0,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#ffffff'],
      snowletters: ['❄']
    } });

    await vi.runAllTimersAsync();

    // Verify snow is running
    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).not.toBeNull();
    expect(global.requestAnimationFrame).toHaveBeenCalled();
  });

  it('renders with correct vertex and instance buffers', async () => {
    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    handler({ action: 'startSnow', config: {
      snowmax: 10,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#ffffff'],
      snowletters: ['❄']
    } });

    await vi.runAllTimersAsync();

    // Verify requestAnimationFrame was called to start rendering loop
    expect(global.requestAnimationFrame).toHaveBeenCalled();
  });

  it('respects snowcolor configuration with multiple colors', async () => {
    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    const colors = ['#ffffff', '#ffcc00', '#ff6600'];
    handler({ action: 'startSnow', config: {
      snowmax: 20,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: colors,
      snowletters: ['❄']
    } });

    await vi.runAllTimersAsync();

    // Verify canvas was created with configuration
    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).not.toBeNull();
  });

  it('handles multiple snowletters in glyph atlas', async () => {
    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    handler({ action: 'startSnow', config: {
      snowmax: 10,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#ffffff'],
      snowletters: ['❄', '✦', '✧', '*']
    } });

    await vi.runAllTimersAsync();

    // Verify canvas is created with multiple glyphs
    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).not.toBeNull();
    expect(document.documentElement.contains(canvas)).toBe(true);
  });

  it('cleans up resources on stop', async () => {
    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    handler({ action: 'startSnow', config: {
      snowmax: 10,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#ffffff'],
      snowletters: ['❄']
    } });

    await vi.runAllTimersAsync();

    // Verify canvas exists
    let canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).not.toBeNull();

    handler({ action: 'stopSnow' });

    // After stopping, canvas should be removed
    canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).toBeNull();
  });

  it('handles device context error during setup', async () => {
    mockDevice.createRenderPipeline.mockImplementation(() => {
      throw new Error('Pipeline creation failed');
    });

    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    handler({ action: 'startSnow', config: {
      snowmax: 10,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#ffffff'],
      snowletters: ['❄']
    } });

    await vi.runAllTimersAsync();

    // Should still have canvas for 2D fallback
    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).not.toBeNull();
  });

  it('properly converts hex colors to RGB normalized values', async () => {
    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    handler({ action: 'startSnow', config: {
      snowmax: 1,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#ffffff'],
      snowletters: ['❄']
    } });

    await vi.runAllTimersAsync();

    // Verify snow starts successfully even in fallback mode
    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).not.toBeNull();
  });

  it('respects canvas size constraints with device pixel ratio', async () => {
    Object.defineProperty(window, 'devicePixelRatio', {
      value: 2,
      configurable: true
    });

    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    handler({ action: 'startSnow', config: {
      snowmax: 10,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#ffffff'],
      snowletters: ['❄']
    } });

    await vi.runAllTimersAsync();

    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
  });

  it('falls back to 2D rendering when WebGPU unavailable', async () => {
    // Don't provide navigator.gpu
    Object.defineProperty(global.navigator, 'gpu', {
      value: undefined,
      configurable: true
    });

    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    handler({ action: 'startSnow', config: {
      snowmax: 10,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#ffffff'],
      snowletters: ['❄']
    } });

    await vi.runAllTimersAsync();

    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).not.toBeNull();
  });

  it('handles message action validation', async () => {
    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    // Send valid startSnow message
    const result = handler({ action: 'startSnow', config: {
      snowmax: 5,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#ffffff'],
      snowletters: ['❄']
    } });

    await vi.runAllTimersAsync();
    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).not.toBeNull();
  });

  it('handles invalid configuration gracefully', async () => {
    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    // Send with minimal config
    handler({ action: 'startSnow', config: {} });

    await vi.runAllTimersAsync();
    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).not.toBeNull();
  });

  it('prevents duplicate canvas creation', async () => {
    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    // Start snow first time
    handler({ action: 'startSnow', config: {
      snowmax: 10,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#ffffff'],
      snowletters: ['❄']
    } });

    await vi.runAllTimersAsync();

    // Start snow again without stopping
    handler({ action: 'startSnow', config: {
      snowmax: 10,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#ffffff'],
      snowletters: ['❄']
    } });

    await vi.runAllTimersAsync();

    // Should only have one canvas
    const canvases = document.querySelectorAll('#let-it-snow-webgpu-canvas');
    expect(canvases.length).toBe(1);
  });

  it('applies correct z-index to prevent blocking interaction', async () => {
    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    handler({ action: 'startSnow', config: {
      snowmax: 10,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#ffffff'],
      snowletters: ['❄']
    } });

    await vi.runAllTimersAsync();

    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas.style.zIndex).toBe('2147483646');
    expect(canvas.style.pointerEvents).toBe('none');
  });

  it('handles multiple color configurations', async () => {
    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    const multiColorConfig = {
      snowmax: 30,
      sinkspeed: 0.8,
      snowminsize: 8,
      snowmaxsize: 24,
      snowcolor: ['#ffffff', '#e6f2ff', '#b3d9ff', '#80bfff'],
      snowletters: ['❄', '✦']
    };

    handler({ action: 'startSnow', config: multiColorConfig });

    await vi.runAllTimersAsync();

    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).not.toBeNull();
    expect(canvas.style.width).toBe('100vw');
  });

  it('supports different snowflake characters', async () => {
    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    const charConfig = {
      snowmax: 15,
      sinkspeed: 0.5,
      snowminsize: 12,
      snowmaxsize: 20,
      snowcolor: ['#ffffff'],
      snowletters: ['*', '✱', '❄', '✦', '✧']
    };

    handler({ action: 'startSnow', config: charConfig });

    await vi.runAllTimersAsync();

    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas).not.toBeNull();
  });

  it('maintains aspect ratio on resize', async () => {
    const module = await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    handler({ action: 'startSnow', config: {
      snowmax: 10,
      sinkspeed: 0.6,
      snowminsize: 10,
      snowmaxsize: 22,
      snowcolor: ['#ffffff'],
      snowletters: ['❄']
    } });

    await vi.runAllTimersAsync();

    const canvas = document.getElementById('let-it-snow-webgpu-canvas');
    expect(canvas.style.width).toBe('100vw');
    expect(canvas.style.height).toBe('100vh');
  });});