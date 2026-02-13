/**
 * Интеграционные тесты взаимодействия GIF снежинок с глифами/предложениями
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { GifLayer } from '../src/content/gif-layer.js';

// Mock для fetch
global.fetch = vi.fn();
global.URL = {
  createObjectURL: vi.fn(() => 'blob:mock-url'),
  revokeObjectURL: vi.fn()
};

// Mock для document и DOM элементов
global.document = {
  getElementById: vi.fn(() => null),
  createElement: vi.fn((tag) => {
    const elem = {
      id: '',
      style: {},
      appendChild: vi.fn(),
      remove: vi.fn()
    };
    if (tag === 'img') {
      elem.src = '';
      elem.alt = '';
      elem.draggable = false;
      elem.loading = 'lazy';
    }
    return elem;
  }),
  documentElement: {
    appendChild: vi.fn()
  }
};

// Mock для window
global.window = {
  innerWidth: 1024,
  innerHeight: 768,
  devicePixelRatio: 1
};

// Mock для performance.now
global.performance = {
  now: vi.fn(() => Date.now())
};

// Mock для requestAnimationFrame
global.requestAnimationFrame = vi.fn((cb) => setTimeout(() => cb(Date.now()), 16));
global.cancelAnimationFrame = vi.fn();

describe('GIF Layer - Integration with External Flakes', () => {
  beforeAll(() => {
    fetch.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['fake-gif-data'], { type: 'image/gif' })
    });
  });

  it('should accept external flakes from renderer', () => {
    const config = {
      snowmax: 5,
      snowminsize: 20,
      snowmaxsize: 40,
      sinkspeed: 1.0,
      gifUrls: ['https://example.com/snow.gif'],
      gifCount: 3,
      enableCollisions: true
    };

    const gifLayer = new GifLayer(config);

    // Имитируем рендерер со снежинками (глифы/предложения)
    const mockRenderer = {
      flakes: [
        {
          x: 100,
          y: 100,
          baseX: 100,
          size: 30,
          velocityX: 10,
          velocityY: 5,
          collisionSize: 30,
          phase: 0,
          isGrabbed: false
        },
        {
          x: 200,
          y: 150,
          baseX: 200,
          size: 25,
          velocityX: -5,
          velocityY: 8,
          collisionSize: 25,
          phase: Math.PI / 2,
          isGrabbed: false
        }
      ]
    };

    // Устанавливаем ссылку на рендерер
    gifLayer.setMainRenderer(mockRenderer);

    // Проверяем, что ссылка сохранена
    expect(gifLayer.mainRenderer).toBe(mockRenderer);
    expect(gifLayer.mainRenderer.flakes).toHaveLength(2);
  });

  it('should handle collisions between GIF and external flakes', async () => {
    const config = {
      snowmax: 5,
      snowminsize: 20,
      snowmaxsize: 40,
      sinkspeed: 1.0,
      gifUrls: ['https://example.com/snow.gif'],
      gifCount: 2,
      enableCollisions: true
    };

    const gifLayer = new GifLayer(config);
    await gifLayer.start();

    // Проверяем, что есть хотя бы одна GIF снежинка
    expect(gifLayer.flakes.length).toBeGreaterThan(0);

    // Создаем мок-рендерер со снежинкой ОЧЕНЬ близко к первой GIF снежинке
    const gifFlake = gifLayer.flakes[0];
    const mockRenderer = {
      flakes: [
        {
          x: gifFlake.x + 10, // Очень близко (перекрытие гарантировано)
          y: gifFlake.y,
          baseX: gifFlake.x + 10,
          size: 30,
          velocityX: 0,
          velocityY: 0,
          collisionSize: 30,
          phase: 0,
          isGrabbed: false
        }
      ]
    };

    gifLayer.setMainRenderer(mockRenderer);

    // Сохраняем начальные позиции
    const initialX0 = gifFlake.x;
    const initialX1 = mockRenderer.flakes[0].x;

    // Вызываем обработчик коллизий вручную
    const allFlakes = [...gifLayer.flakes, ...mockRenderer.flakes];
    
    if (gifLayer.collisionHandler && allFlakes.length >= 2) {
      gifLayer.collisionHandler.handleCollisions(allFlakes, 0.016);
    }

    // После коллизии позиции должны измениться (снежинки разойдутся)
    const finalX0 = allFlakes[0].x;
    const finalX1 = allFlakes[allFlakes.length - 1].x;

    // Хотя бы одна координата должна измениться из-за коллизии
    const hasPositionChanged = 
      Math.abs(finalX0 - initialX0) > 0.001 ||
      Math.abs(finalX1 - initialX1) > 0.001;

    expect(hasPositionChanged).toBe(true);

    gifLayer.stop();
  });

  it('should clear renderer reference when null is passed', () => {
    const config = {
      snowmax: 5,
      snowminsize: 20,
      snowmaxsize: 40,
      sinkspeed: 1.0,
      gifUrls: ['https://example.com/snow.gif'],
      gifCount: 2,
      enableCollisions: true
    };

    const gifLayer = new GifLayer(config);

    // Установка рендерера
    const mockRenderer = { flakes: [{ x: 100, y: 100 }] };
    gifLayer.setMainRenderer(mockRenderer);
    expect(gifLayer.mainRenderer).toBe(mockRenderer);

    // Очистка через null
    gifLayer.setMainRenderer(null);
    expect(gifLayer.mainRenderer).toBe(null);
  });

  it('should combine GIF and external flakes during animation', async () => {
    const config = {
      snowmax: 5,
      snowminsize: 20,
      snowmaxsize: 40,
      sinkspeed: 1.0,
      gifUrls: ['https://example.com/snow.gif'],
      gifCount: 3,
      enableCollisions: true
    };

    const gifLayer = new GifLayer(config);
    await gifLayer.start();

    const mockRenderer = {
      flakes: [
        { x: 300, y: 300, baseX: 300, size: 20, velocityX: 0, velocityY: 0, collisionSize: 20, phase: 0 },
        { x: 400, y: 400, baseX: 400, size: 25, velocityX: 0, velocityY: 0, collisionSize: 25, phase: 0 }
      ]
    };

    gifLayer.setMainRenderer(mockRenderer);

    // Проверяем, что оба массива существуют и не пусты
    expect(gifLayer.flakes.length).toBeGreaterThan(0);
    expect(gifLayer.mainRenderer.flakes.length).toBe(2);

    // Общее количество снежинок
    const totalFlakes = gifLayer.flakes.length + gifLayer.mainRenderer.flakes.length;
    expect(totalFlakes).toBeGreaterThanOrEqual(5);

    gifLayer.stop();
  });
});
