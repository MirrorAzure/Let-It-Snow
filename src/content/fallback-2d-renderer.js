/**
 * 2D Canvas fallback рендерер для браузеров без WebGPU
 */

/**
 * Класс для рендеринга снега через Canvas 2D API
 */
export class Fallback2DRenderer {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.ctx = null;
    this.flakes = [];
    this.frameRequest = null;
    this.drawCallback = null;
  }

  /**
   * Инициализация 2D контекста
   * @returns {boolean} true если успешно
   */
  init() {
    if (!this.canvas || typeof this.canvas.getContext !== 'function') return false;

    try {
      this.ctx = this.canvas.getContext('2d');
    } catch (err) {
      console.warn('2D context unavailable, skipping fallback.', err);
      return false;
    }

    if (!this.ctx) return false;

    const { snowmax, snowminsize, snowmaxsize, sinkspeed, snowcolor, snowletters } = this.config;

    const sizeRange = snowmaxsize - snowminsize;

    // Создаем снежинки
    this.flakes = new Array(Math.max(1, snowmax)).fill(null).map((_, idx) => {
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

    return true;
  }

  /**
   * Запускает рендеринг
   */
  start() {
    const ctx = this.ctx;
    const { snowminsize } = this.config;

    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.floor(window.innerWidth * ratio);
      const height = Math.floor(window.innerHeight * ratio);

      // Обновляем размер canvas если изменился
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);
      ctx.font = `${Math.max(16, snowminsize)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Рендерим каждую снежинку
      this.flakes.forEach((flake) => {
        flake.phase += flake.freq * 0.016;
        flake.y += flake.speed * 0.016;

        const x = (flake.x + Math.sin(flake.phase) * flake.sway) * ratio;
        const y = flake.y * ratio;

        // Сброс позиции если вышла за экран
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

      this.frameRequest = requestAnimationFrame(draw);
    };

    this.drawCallback = draw;
    draw();
  }

  /**
   * Останавливает рендеринг
   */
  stop() {
    if (this.frameRequest) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }
    this.drawCallback = null;
    this.flakes = [];
    this.ctx = null;
  }

  /**
   * Приостанавливает рендеринг
   */
  pause() {
    if (this.frameRequest) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }
  }

  /**
   * Возобновляет рендеринг
   */
  resume() {
    if (this.drawCallback) {
      this.frameRequest = requestAnimationFrame(this.drawCallback);
    }
  }
}
