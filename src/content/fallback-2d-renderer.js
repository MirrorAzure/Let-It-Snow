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
    this.sentenceQueue = [];
    this.sentenceCursor = 0;
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

    const { snowmax, snowminsize, snowmaxsize, sinkspeed, snowcolor, snowletters, snowsentences, sentenceCount } = this.config;

    const sizeRange = snowmaxsize - snowminsize;
    
    const hasGlyphs = snowletters && snowletters.length > 0;
    const hasSentences = snowsentences && snowsentences.length > 0;
    
    // Количество текстовых снежинок ограничено настройкой sentenceCount
    const maxSentenceInstances = hasSentences ? Math.min(sentenceCount || 0, snowmax) : 0;

    this.sentenceQueue = hasSentences ? snowsentences : [];
    this.sentenceCursor = 0;

    // Создаем снежинки - контролируемое количество предложений + глифы
    this.flakes = new Array(Math.max(1, snowmax)).fill(null).map((_, idx) => {
      // Выбираем между глифами и предложениями на основе sentenceCount
      let textItem;
      let isSentence = false;
      
      if (hasSentences && idx < maxSentenceInstances) {
        // Первые sentenceCount снежинок - это предложения
        textItem = this._nextSentence();
        isSentence = true;
      } else if (hasGlyphs) {
        // Остальные - глифы
        textItem = snowletters[(idx - maxSentenceInstances) % snowletters.length];
      } else {
        // Если нет глифов, используем дефолтный
        textItem = '❄';
      }
      
      // Предложения должны быть больше
      const size = isSentence 
        ? Math.max(snowmaxsize * 1.2, 60) + Math.random() * 20
        : snowminsize + Math.random() * sizeRange;
      const speed = sinkspeed * (size / 20) * 20;
      const color = snowcolor[idx % snowcolor.length];
      
      return {
        x: Math.random() * window.innerWidth,
        y: -size - Math.random() * window.innerHeight,
        size,
        speed,
        sway: 10 + Math.random() * 25,
        phase: Math.random() * Math.PI * 2,
        freq: 0.8 + Math.random() * 1.4,
        color,
        char: textItem,
        isSentence
      };
    });

    return true;
  }

  /**
   * Запускает рендеринг
   */
  start() {
    const ctx = this.ctx;
    const { snowminsize, snowmaxsize } = this.config;

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
          if (flake.isSentence) {
            flake.char = this._nextSentence();
          }
        }

        ctx.fillStyle = flake.color;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.sin(flake.phase) * 0.2);

        // Для предложений используем многострочный рендеринг
        if (flake.isSentence) {
          const fontSize = Math.max(10, flake.size * 0.3);
          ctx.font = `bold ${fontSize}px Arial, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          // Разбиваем предложение на строки
          const words = flake.char.split(' ');
          const lines = [];
          let currentLine = '';
          const maxWidth = flake.size * 2;

          words.forEach((word) => {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);
            
            if (metrics.width > maxWidth && currentLine) {
              lines.push(currentLine);
              currentLine = word;
            } else {
              currentLine = testLine;
            }
          });
          
          if (currentLine) {
            lines.push(currentLine);
          }

          // Рендерим строки
          const lineHeight = fontSize * 1.2;
          const totalHeight = lines.length * lineHeight;
          const startY = -totalHeight / 2 + lineHeight / 2;

          lines.forEach((line, i) => {
            const lineY = startY + i * lineHeight;
            ctx.fillText(line, 0, lineY);
          });
        } else {
          // Обычные символы
          ctx.font = `${Math.max(16, flake.size)}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(flake.char, 0, 0);
        }

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

  _nextSentence() {
    const count = this.sentenceQueue.length;
    if (!count) return '';
    const index = this.sentenceCursor % count;
    this.sentenceCursor = (this.sentenceCursor + 1) % count;
    return this.sentenceQueue[index];
  }
}
