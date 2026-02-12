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
    
    // Параметры взаимодействия с мышью
    this.mouseX = -1000;
    this.mouseY = -1000;
    this.mouseVelocityX = 0;
    this.mouseVelocityY = 0;
    this.mousePressed = false;
    this.mouseRadius = 100;
    this.mouseForce = 300;
    this.mouseImpulseStrength = 0.5;
    this.mouseDragThreshold = 500; // Порог скорости для эффекта затягивания
    this.mouseDragStrength = 0.8; // Сила затягивания в поток
    
    // Параметры коллизий между снежинками
    this.enableCollisions = true; // Включить коллизии
    this.collisionDamping = 0.7; // Коэффициент упругости столкновений (0-1)
    this.collisionCheckRadius = 200; // Радиус проверки коллизий для оптимизации
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
      
      // Размер коллизии соответствует фактическому размеру отрисованного содержимого
      // Для снежинок (глифов) используем размер как есть
      // Для предложений используем меньший размер, соответствующий размеру текста
      const collisionSize = isSentence 
        ? Math.max(snowminsize, 20) + Math.random() * 15  // Меньший размер для коллизии текста
        : size;  // Для глифов используем основной размер
      
      const speed = sinkspeed * (size / 20) * 20;
      const color = snowcolor[idx % snowcolor.length];
      
      return {
        x: Math.random() * window.innerWidth,
        y: -size - Math.random() * window.innerHeight,
        size,
        collisionSize,  // Отдельный размер для проверки коллизий
        speed,
        sway: 10 + Math.random() * 25,
        phase: Math.random() * Math.PI * 2,
        freq: 0.8 + Math.random() * 1.4,
        color,
        char: textItem,
        isSentence,
        rotationSpeed: 0,
        velocityX: 0,
        velocityY: 0
      };
    });

    return true;
  }

  /**
   * Проверка и обработка коллизий между снежинками
   */
  handleCollisions() {
    if (!this.enableCollisions || this.flakes.length < 2) return;

    // Оптимизация: проверяем только близкие пары
    for (let i = 0; i < this.flakes.length; i++) {
      const flakeA = this.flakes[i];
      
      // Проверяем только снежинки в радиусе collisionCheckRadius
      for (let j = i + 1; j < this.flakes.length; j++) {
        const flakeB = this.flakes[j];
        
        const dx = flakeB.x - flakeA.x;
        const dy = flakeB.y - flakeA.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Пропускаем, если снежинки слишком далеко
        if (distance > this.collisionCheckRadius) continue;
        
        // Используем collisionSize для проверки коллизий (соответствует визуальному размеру)
        const minDistance = (flakeA.collisionSize + flakeB.collisionSize) * 0.5;
        
        // Если снежинки пересекаются
        if (distance < minDistance && distance > 0) {
          // Нормализованный вектор между снежинками
          const nx = dx / distance;
          const ny = dy / distance;
          
          // Относительная скорость
          const dvx = flakeB.velocityX - flakeA.velocityX;
          const dvy = flakeB.velocityY - flakeA.velocityY;
          
          // Скорость сближения
          const dvn = dvx * nx + dvy * ny;
          
          // Если снежинки уже расходятся, не обрабатываем коллизию
          if (dvn > 0) continue;
          
          // Импульс столкновения (упрощенная физика для равных масс)
          const impulse = dvn * this.collisionDamping;
          
          // Применяем импульс к обеим снежинкам
          flakeA.velocityX += nx * impulse;
          flakeA.velocityY += ny * impulse;
          flakeB.velocityX -= nx * impulse;
          flakeB.velocityY -= ny * impulse;
          
          // Разводим снежинки, чтобы они не застревали друг в друге
          const overlap = minDistance - distance;
          const separationX = nx * overlap * 0.5;
          const separationY = ny * overlap * 0.5;
          
          flakeA.x -= separationX;
          flakeA.y -= separationY;
          flakeB.x += separationX;
          flakeB.y += separationY;
        }
      }
    }
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
        // Вычисляем скорость движения мыши
        const mouseSpeed = Math.sqrt(this.mouseVelocityX * this.mouseVelocityX + this.mouseVelocityY * this.mouseVelocityY);
        const isMouseFast = mouseSpeed > this.mouseDragThreshold;
        
        // Применяем физику взаимодействия с мышью
        const dx = flake.x - this.mouseX;
        const dy = flake.y - this.mouseY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < this.mouseRadius && distance > 0) {
          const influence = 1 - distance / this.mouseRadius;
          
          // Если мышь движется быстро - создаем эффект воздушного потока
          if (isMouseFast) {
            // Нормализуем вектор скорости мыши
            const mouseVelMag = Math.sqrt(this.mouseVelocityX * this.mouseVelocityX + this.mouseVelocityY * this.mouseVelocityY);
            if (mouseVelMag > 0) {
              const mouseDirX = this.mouseVelocityX / mouseVelMag;
              const mouseDirY = this.mouseVelocityY / mouseVelMag;
              
              // Притягиваем снежинку в сторону движения мыши
              const dragForce = influence * this.mouseDragStrength * (mouseSpeed / 1000);
              flake.velocityX += mouseDirX * dragForce * 16;
              flake.velocityY += mouseDirY * dragForce * 16;
            }
          } else {
            // Обычное отталкивание при медленном движении
            const force = influence * this.mouseForce * 0.016;
            const angle = Math.atan2(dy, dx);
            flake.x += Math.cos(angle) * force;
            flake.y += Math.sin(angle) * force;
          }
          
          // Передаем импульс от движения мыши
          const impulseStrength = influence * this.mouseImpulseStrength;
          flake.velocityX += this.mouseVelocityX * impulseStrength * 0.016;
          flake.velocityY += this.mouseVelocityY * impulseStrength * 0.016;
          
          // Вращение снежинки при движении мыши рядом
          // Направление вращения зависит от того, с какой стороны пролетела мышка
          const mouseSpeed = Math.sqrt(this.mouseVelocityX * this.mouseVelocityX + this.mouseVelocityY * this.mouseVelocityY);
          const cross = dx * this.mouseVelocityY - dy * this.mouseVelocityX;
          const rotationDirection = Math.sign(cross); // +1 или -1
          const rotationForce = influence * mouseSpeed * 0.01 * rotationDirection;
          flake.rotationSpeed = (flake.rotationSpeed || 0) + rotationForce * 0.016;
          
          // При зажатии кнопки мыши - захватываем снежинку
          if (this.mousePressed && distance < this.mouseRadius * 0.5) {
            // Позиция снежинки следует за мышью
            flake.x = this.mouseX;
            flake.y = this.mouseY;
            // Обнуляем скорость при захвате
            flake.velocityX = 0;
            flake.velocityY = 0;
          }
        }

        // Применяем импульс к позиции
        flake.x += flake.velocityX;
        flake.y += flake.velocityY;
        
        // Затухание импульса
        flake.velocityX *= 0.95;
        flake.velocityY *= 0.95;
        flake.rotationSpeed = (flake.rotationSpeed || 0) * 0.95;

        flake.phase += flake.freq * 0.016;
        
        // Добавляем собственное вращение снежинки в зависимости от направления качания
        // Когда снежинка качается в одну сторону, она вращается в эту же сторону
        const swayRotation = Math.cos(flake.phase) * flake.freq * 0.5;
        flake.rotationSpeed = (flake.rotationSpeed || 0) + swayRotation * 0.016;
        
        flake.y += flake.speed * 0.016;

        const x = (flake.x + Math.sin(flake.phase) * flake.sway) * ratio;
        const y = flake.y * ratio;

        // Сброс позиции если вышла за экран
        if (y - flake.size * ratio > height) {
          flake.y = -flake.size;
          flake.x = Math.random() * window.innerWidth;
          flake.rotationSpeed = 0;
          flake.velocityX = 0;
          flake.velocityY = 0;
          if (flake.isSentence) {
            flake.char = this._nextSentence();
          }
        }

        ctx.fillStyle = flake.color;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.sin(flake.phase) * 0.2 + (flake.rotationSpeed || 0));

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

      // Обрабатываем коллизии между снежинками
      this.handleCollisions();

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

  /**
   * Обновление позиции мыши
   * @param {number} x - X координата
   * @param {number} y - Y координата
   * @param {number} vx - Скорость по X
   * @param {number} vy - Скорость по Y
   */
  updateMousePosition(x, y, vx = 0, vy = 0) {
    this.mouseX = x;
    this.mouseY = y;
    this.mouseVelocityX = vx;
    this.mouseVelocityY = vy;
  }

  /**
   * Обработчик нажатия кнопки мыши
   * @param {number} x - X координата
   * @param {number} y - Y координата
   */
  onMouseDown(x, y) {
    this.mousePressed = true;
    this.mouseX = x;
    this.mouseY = y;
  }

  /**
   * Обработчик отпускания кнопки мыши
   */
  onMouseUp() {
    this.mousePressed = false;
  }

  /**
   * Обработчик выхода мыши за пределы canvas
   */
  onMouseLeave() {
    this.mousePressed = false;
    this.mouseX = -1000;
    this.mouseY = -1000;
    this.mouseVelocityX = 0;
    this.mouseVelocityY = 0;
  }
}
