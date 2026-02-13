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
    
    // Параметры ветра
    this.windEnabled = config.windEnabled ?? false;
    this.windDirection = config.windDirection ?? 'left';
    this.windStrength = config.windStrength ?? 0.5;
    this.windGustFrequency = config.windGustFrequency ?? 3;
    this.windTime = 0;
    this.currentWindForce = 0;
    this.prevWindMagnitude = 0; // Для плавной интерполяции величины ветра
    this.currentWindLift = 0; // Вертикальная составляющая ветра
    this.lastWindLogged = false;
    
    console.log('🌬️ Fallback2DRenderer initialized with wind config:', {
      windEnabled: this.windEnabled,
      windDirection: this.windDirection,
      windStrength: this.windStrength,
      windGustFrequency: this.windGustFrequency
    });
  }

  /**
   * Найти безопасную позицию спауна, чтобы снежинка не пересекалась с существующими
   * @private
   */
  _findSafeSpawnX(newSize) {
    const width = window.innerWidth;
    const minCollisionDistance = newSize; // Минимальное расстояние для избежания перекрытия
    const attempts = 20; // Количество попыток найти безопасное место
    
    for (let attempt = 0; attempt < attempts; attempt++) {
      const x = Math.random() * width;
      let isSafe = true;
      
      // Проверяем расстояние до всех существующих снежинок
      if (this.flakes && this.flakes.length > 0) {
        for (const flake of this.flakes) {
          if (!flake) continue;
          
          const dx = x - (flake.baseX ?? flake.x);
          // Проверяем только по X, так как по Y они находятся выше экрана
          const minDistance = minCollisionDistance + (flake.collisionSize ?? flake.size ?? 20);
          
          if (Math.abs(dx) < minDistance * 0.5) {
            isSafe = false;
            break;
          }
        }
      }
      
      if (isSafe) return x;
    }
    
    // Если не удалось найти за 20 попыток, возвращаем случайную позицию
    return Math.random() * width;
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
    this.flakes = []; // Инициализируем как пустой массив для безопасного спауна
    
    for (let idx = 0; idx < Math.max(1, snowmax); idx++) {
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
      
      // Размер коллизии точно соответствует фактическому размеру отрисованного глифа
      // Это гарантирует физически точные столкновения
      const collisionSize = size;
      
      const speed = sinkspeed * (size / 20) * 20;
      const color = snowcolor[idx % snowcolor.length];
      
      // Используем функцию поиска безопасной позиции спауна
      const x = this._findSafeSpawnX(size);
      
      this.flakes.push({
        x,
        baseX: x,
        y: -size - Math.random() * window.innerHeight,
        size,
        collisionSize,
        speed,
        sway: 10 + Math.random() * 25,
        phase: Math.random() * Math.PI * 2,
        freq: 0.8 + Math.random() * 1.4,
        color,
        char: textItem,
        isSentence,
        rotationSpeed: 0,
        velocityX: 0,
        velocityY: 0,
        isGrabbed: false
      });
    }

    return true;
  }

  /**
   * Обработка коллизий между снежинками с использованием CollisionHandler
   */
  handleCollisions() {
    if (!this.collisionHandler || !this.enableCollisions) return;
    
    // Вызываем обработчик коллизий с предиктивной проверкой (0.016 ≈ 60 FPS)
    this.collisionHandler.handleCollisions(this.flakes, 0.016);
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

      // Обновляем параметры ветра (каждый кадр с фиксированным delta=0.016)
      if (this.windEnabled) {
        this.windTime += 0.016;
        
        // Генерируем многослойный турбулентный ветер, более плавный и естественный
        // Используем суперпозицию волн разных частот для имитации атмосферной турбулентности
        
        // Основной цикл (низкая частота - долгосрочные изменения направления)
        // Используем smoothstep-подобную функцию вместо острого синуса для плавности
        const baseFreq = this.windGustFrequency * 0.5;
        const baseTime = (this.windTime / (20 / baseFreq)) % 1.0; // Период колебания
        const baseWind = Math.sin(baseTime * Math.PI) * 0.6; // Плавный синус (0 -> 1 -> 0)
        
        // Среднечастотные порывы (волны среднего размера)
        // Более мягкие переходы для естественного вида
        const midFreq = this.windGustFrequency;
        const midTime = (this.windTime / (10 / midFreq)) % 1.0;
        const midWind = Math.sin(midTime * Math.PI * 2) * Math.cos(this.windTime * 0.3) * 0.25;
        
        // Мелкая турбулентность (быстрые колебания, но затухающие)
        // Используем несколько фаз для создания естественного шума
        const highFreq1 = Math.sin(this.windTime * 1.7) * Math.exp(-0.1 * (this.windTime % 5)) * 0.06;
        const highFreq2 = Math.sin(this.windTime * 2.9 + Math.cos(this.windTime)) * 0.04;
        const highFreq3 = Math.sin(this.windTime * 4.1) * Math.sin(this.windTime * 0.7) * 0.02;
        const turbulence = highFreq1 + highFreq2 + highFreq3;
        
        // Комбинируем все слои для естественного ветра
        let windMagnitude = baseWind + midWind + turbulence;
        windMagnitude = Math.max(-1, Math.min(1, windMagnitude));
        
        // Плавно интерполируем windForce для более естественного вида
        // Предыдущее значение: this.prevWindForce (инициализируем если не существует)
        if (this.prevWindForce === undefined) {
          this.prevWindForce = 0;
        }
        
        // Рассчитываем вертикальную составляющую ветра (лифт при сильных порывах)
        // Сильные горизонтальные ветры могут поднимать снежинки
        const windLift = Math.abs(windMagnitude) * 0.3; // До 30% силы ветра поднимает вверх при макс ветре
        this.currentWindLift = windLift * this.windStrength;
        
        // Плавная интерполяция самого windMagnitude (до определения направления)
        // Это сохраняет естественные переходы знака для режима random
        if (this.prevWindMagnitude === undefined) {
          this.prevWindMagnitude = windMagnitude;
        }
        const windSmoothFactor = 0.15;
        windMagnitude = this.prevWindMagnitude * (1 - windSmoothFactor) + windMagnitude * windSmoothFactor;
        this.prevWindMagnitude = windMagnitude;
        
        // Определяем направление и рассчитываем силу ветра
        // Ветер должен всегда дуть в одном направлении (left/right) с переменной силой (турбулентностью)
        // А в режиме random - естественно менять направление
        if (this.windDirection === 'left') {
          // Всегда дует влево, но с переменной силой (турбулентностью)
          // Используем абсолютное значение windMagnitude для силы + минус для направления
          this.currentWindForce = -Math.abs(windMagnitude) * this.windStrength;
        } else if (this.windDirection === 'right') {
          // Всегда дует вправо, но с переменной силой (турбулентностью)
          this.currentWindForce = Math.abs(windMagnitude) * this.windStrength;
        } else {
          // 'random' - ветер естественно меняет направление через ноль
          // windMagnitude плавно проходит через 0, сохраняя свой строгий знак
          this.currentWindForce = windMagnitude * this.windStrength;
        }
        
        // Логирование ветра при первом изменении направления
        if (windMagnitude > 0.5 && !this.lastWindLogged) {
          console.log('🌬️ Wind is blowing with turbulence:', {
            direction: this.windDirection,
            strength: this.windStrength,
            force: this.currentWindForce.toFixed(2),
            turbulence: windMagnitude.toFixed(2)
          });
          this.lastWindLogged = true;
        } else if (windMagnitude <= 0.5) {
          this.lastWindLogged = false;
        }
      } else {
        this.currentWindForce = 0;
        this.currentWindLift = 0;
      }

      // ПЕРВЫЙ ПРОХОД: Обновляем физику и позиции для всех снежинок
      this.flakes.forEach((flake) => {
        // Вычисляем скорость движения мыши
        const mouseSpeed = Math.sqrt(this.mouseVelocityX * this.mouseVelocityX + this.mouseVelocityY * this.mouseVelocityY);
        const isMouseFast = mouseSpeed > this.mouseDragThreshold;
        
        // Применяем физику взаимодействия с мышью
        const dx = flake.x - this.mouseX;
        const dy = flake.y - this.mouseY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (!this.mousePressed && flake.isGrabbed) {
          flake.isGrabbed = false;
          flake.swayLimit = 1.0;
        }
        
        if (distance < this.mouseRadius) {
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
            const force = influence * this.mouseForce;
            const safeDistance = Math.max(distance, 0.0001);
            const nx = dx / safeDistance;
            const ny = dy / safeDistance;
            const verticalBias = ny < 0 ? 0.35 : 1.0;
            const accel = force * 0.016;
            flake.velocityX += nx * accel;
            flake.velocityY += ny * accel * verticalBias;
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
            // Сохраняем смещение снежинки от мыши (если это первый захват)
            if (!flake.isGrabbed) {
              flake.grabOffsetX = flake.x - this.mouseX;
              flake.grabOffsetY = flake.y - this.mouseY;
            }
            // Позиция снежинки следует за мышью с сохранением смещения
            flake.x = this.mouseX + (flake.grabOffsetX ?? 0);
            flake.y = this.mouseY + (flake.grabOffsetY ?? 0);
            flake.baseX = flake.x;
            // Обнуляем скорость при захвате
            flake.velocityX = 0;
            flake.velocityY = 0;
            flake.rotationSpeed = 0;
            // Отмечаем, что снежинка захвачена
            flake.isGrabbed = true;
            flake.swayLimit = 0;
          } else {
            // Если мышь отпущена, снимаем флаг захвата и очищаем смещение
            if (flake.isGrabbed) {
              flake.grabOffsetX = undefined;
              flake.grabOffsetY = undefined;
            }
            flake.isGrabbed = false;
            flake.swayLimit = 1.0;
          }
        }

        // Применяем импульс к позиции
        flake.baseX += flake.velocityX;
        flake.y += flake.velocityY;
        // Обновляем визуальную позицию (с покачиванием)
        flake.x = flake.baseX;

        if (!flake.isGrabbed) {
          flake.phase += flake.freq * 0.016;
          
          // Качание маятника: визуальный наклон вместо горизонтального смещения
          // Это вычисляется при рендеринге для применения к ротации
        }
        
        if (!flake.isGrabbed) {
          // Собственное независимое кручение снежинки
          flake.cumulativeSpin = (flake.cumulativeSpin || 0) + (flake.rotationSpeed || 0) * 0.016;
          flake.y += flake.fallSpeed * 0.016;
        }

        // Сброс позиции если вышла за экран
        if (flake.y - flake.size > height) {
          flake.y = -flake.size;
          // Используем функцию поиска безопасной позиции спауна
          const newX = this._findSafeSpawnX(flake.size);
          flake.x = newX;
          flake.baseX = newX;
          flake.phase = Math.random() * Math.PI * 2;
          flake.rotation = Math.random() * Math.PI * 2;
          flake.rotationSpeed = 0;
          flake.velocityX = 0;
          flake.velocityY = 0;
          if (flake.isSentence) {
            flake.char = this._nextSentence();
          }
        }
      });
      
      // Применяем ветер как горизонтальное ускорение (и вертикальный лифт)
      if ((this.currentWindForce !== 0 || this.currentWindLift !== 0)) {
        this.flakes.forEach((flake) => {
          if (!flake.isGrabbed) {
            // Площадь поперечного сечения пропорциональна размеру
            // Но учитываем массу: масса ~ size^3, поэтому используем sqrt(size) для балансировки
            // Это дает более реалистичное воздействие: маленькие объекты поддаются ветру сильнее
            const sizeRatio = Math.sqrt(flake.size / 20);
            
            // Горизонтальное воздействие ветра (как ускорение)
            if (this.currentWindForce !== 0) {
              // Сбалансированное воздействие ветра с учетом физики массы
              const windAccel = this.currentWindForce * sizeRatio * 8;
              flake.velocityX += windAccel * 0.016;
              
              // Раскачивание снежинки при ветре (имитация вращения от ветра)
              const spinForce = Math.abs(this.currentWindForce) * 2; // Чем сильнее ветер, тем быстрее вращение
              flake.rotationSpeed += (Math.random() - 0.5) * spinForce * 0.05;
            }
            
            // Вертикальное воздействие ветра (лифт - сильно влияет на маленькие снежинки)
            if (this.currentWindLift !== 0) {
              // Лифт сильнее влияет на маленькие снежинки (обратная пропорциональность массе)
              const liftAccel = -this.currentWindLift * sizeRatio * 25;
              flake.velocityY += liftAccel * 0.016;
            }
          }
        });
      }
      
      // КРИТИЧНЫЙ ШАГ: Обрабатываем коллизии между снежинками ДО рендеринга
      this.handleCollisions();
      
      // Применяем затухание ПОСЛЕ коллизий
      // Уменьшаем затухание (с 0.95 до 0.90) чтобы сохранить импульсы от коллизий дольше
      // Это гарантирует, что импульсы от коллизий будут быстро затухать
      this.flakes.forEach((flake) => {
        if (!flake.isGrabbed) {
          const damping = Math.pow(0.92, 0.016 * 60); // Затухание за 1 кадр на 60 FPS
          flake.velocityX *= damping;
          flake.velocityY *= damping;
          flake.rotationSpeed = (flake.rotationSpeed || 0) * damping;
        }
      });

      // Обрабатываем края экрана как порталы (wrapping)
      this.flakes.forEach((flake) => {
        const collisionRadius = (flake.collisionSize ?? flake.size ?? 20) * 0.5;
        const worldWidth = window.innerWidth;
        
        // Портальная система: снежинка, вышедшая за левый край, появляется справа и наоборот
        if (flake.x + collisionRadius < 0) {
          // Вышла за левый край - телепортируем на правую сторону
          flake.x = worldWidth + collisionRadius;
          flake.baseX = flake.x;
        } else if (flake.x - collisionRadius > worldWidth) {
          // Вышла за правый край - телепортируем на левую сторону
          flake.x = -collisionRadius;
          flake.baseX = flake.x;
        }
      });

      // ВТОРОЙ ПРОХОД: Рендерим каждую снежинку
      this.flakes.forEach((flake) => {
        // Позиция БЕЗ горизонтального смещения (качание теперь визуальное через ротацию)
        const x = flake.x * ratio;
        const y = flake.y * ratio;

        ctx.fillStyle = flake.color;
        ctx.save();
        ctx.translate(x, y);
        
        // Качание маятника: добавляем визуальный наклон к общей ротации
        const maxSwingAngle = 0.35; // ~20 градусов
        const swayLimit = flake.swayLimit ?? 1.0;
        const swingAngle = !flake.isGrabbed ? Math.sin(flake.phase) * maxSwingAngle * swayLimit : 0;
        const finalRotation = (flake.cumulativeSpin || 0) + swingAngle;
        ctx.rotate(finalRotation);

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
    // Отпускаем все захваченные снежинки
    if (this.flakes) {
      this.flakes.forEach(flake => {
        flake.isGrabbed = false;
      });
    }
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
