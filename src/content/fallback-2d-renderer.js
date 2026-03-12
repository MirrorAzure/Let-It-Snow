/**
 * 2D Canvas fallback рендерер для браузеров без WebGPU
 */

import { CollisionHandler } from './physics/collision-handler.js';

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
    this.mouseLeftPressed = false;
    this.mouseRightPressed = false;
    this.mouseRadius = config.mouseRadius ?? 100;
    this.mouseForce = config.mouseForce ?? 300;
    this.mouseImpulseStrength = config.mouseImpulseStrength ?? 0.5;
    this.mouseDragThreshold = config.mouseDragThreshold ?? 500; // Порог скорости для эффекта затягивания
    this.mouseDragStrength = config.mouseDragStrength ?? 1.0; // Сила затягивания в поток
    this.mouseBurstDuration = 0.2;
    this.mouseBurstRadiusMultiplier = 3.5;
    this.mouseBurstTimer = 0;
    this.mouseBurstMode = null;
    
    // Параметры коллизий между снежинками
    this.enableCollisions = config.enableCollisions ?? true; // Включить коллизии
    this.collisionDamping = 0.7; // Коэффициент упругости столкновений (0-1)
    this.collisionCheckRadius = 200; // Радиус проверки коллизий для оптимизации
    this.debugCollisions = config.debugCollisions ?? false; // Визуализация коллизий
    this.collisionHandler = new CollisionHandler({
      enableCollisions: this.enableCollisions,
      collisionDamping: this.collisionDamping,
      collisionCheckRadius: this.collisionCheckRadius,
      debugCollisions: this.debugCollisions
    });
    
    // Параметры ветра
    this.windEnabled = config.windEnabled ?? false;
    this.windDirection = config.windDirection ?? 'left';
    this.windStrength = config.windStrength ?? 0.5;
    this.windGustFrequency = config.windGustFrequency ?? 3;
    this.windTime = 0;
    this.currentWindForce = 0;
    this.currentWindLift = 0; // Вертикальная составляющая ветра
    this.prevWindForce = 0;
    this.prevWindLift = 0;
    this.windDirectionPhase = Math.random() * Math.PI * 2;
    this.lastWindLogged = false;
    
    console.log('🌬️ Fallback2DRenderer initialized with wind config:', {
      windEnabled: this.windEnabled,
      windDirection: this.windDirection,
      windStrength: this.windStrength,
      windGustFrequency: this.windGustFrequency
    });
  }

  /**
   * Возвращает стабильные размеры viewport в CSS-пикселях.
   * Некоторые сайты/режимы кратковременно отдают 0, поэтому используем несколько источников.
   * @private
   */
  _getViewportSize() {
    const vv = window.visualViewport;
    const width =
      window.innerWidth ||
      document.documentElement?.clientWidth ||
      document.body?.clientWidth ||
      vv?.width ||
      0;
    const height =
      window.innerHeight ||
      document.documentElement?.clientHeight ||
      document.body?.clientHeight ||
      vv?.height ||
      0;

    return {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height))
    };
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
      const initialRotation = Math.random() * Math.PI * 2; // Случайный начальный угол для разнообразия
      
      this.flakes.push({
        x,
        baseX: x,
        y: -size - Math.random() * window.innerHeight,
        size,
        collisionSize,
        fallSpeed: speed,
        sway: 10 + Math.random() * 25,
        phase: Math.random() * Math.PI * 2,
        freq: 0.8 + Math.random() * 1.4,
        color,
        char: textItem,
        isSentence,
        rotationSpeed: 0,
        cumulativeSpin: initialRotation,
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
    
    // Вызываем обработчик коллизий с предиктивной проверкой (0.03 ≈ 60 FPS)
    this.collisionHandler.handleCollisions(this.flakes, 0.03);
  }

  /**
   * Запускает рендеринг
   */
  start() {
    const ctx = this.ctx;
    const { snowminsize, snowmaxsize } = this.config;

    let lastFrameTime = performance.now();
    const draw = (now = performance.now()) => {
      const delta = Math.min((now - lastFrameTime) / 1000, 0.05);
      lastFrameTime = now;
      const ratio = window.devicePixelRatio || 1;
      const viewport = this._getViewportSize();
      const worldWidth = viewport.width;
      const worldHeight = viewport.height;
      const width = Math.floor(worldWidth * ratio);
      const height = Math.floor(worldHeight * ratio);

      // Обновляем размер canvas если изменился
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);

      // Обновляем параметры ветра
      if (this.windEnabled) {
        this.windTime += delta;

        // Реалистичный ветер: смесь долгих циклов, порывов и турбулентности
        const baseFreq = Math.max(0.1, this.windGustFrequency * 0.5);
        const baseTime = (this.windTime / (20 / baseFreq)) % 1.0;
        const baseWind = Math.sin(baseTime * Math.PI) * 0.6;

        const midFreq = this.windGustFrequency;
        const midTime = (this.windTime / (10 / midFreq)) % 1.0;
        const midWind = Math.sin(midTime * Math.PI * 2) * Math.cos(this.windTime * 0.3) * 0.25;

        const highFreq1 = Math.sin(this.windTime * 1.7) * Math.exp(-0.1 * (this.windTime % 5)) * 0.06;
        const highFreq2 = Math.sin(this.windTime * 2.9 + Math.cos(this.windTime)) * 0.04;
        const highFreq3 = Math.sin(this.windTime * 4.1) * Math.sin(this.windTime * 0.7) * 0.018; // значение 0.016 приводит к вращению
        const turbulence = highFreq1 + highFreq2 + highFreq3;

        let gust = baseWind + midWind + turbulence;
        gust = Math.max(-1, Math.min(1, gust));
        const gustIntensity = Math.min(1, Math.abs(gust));

        let directionFactor = 1;
        if (this.windDirection === 'left') {
          directionFactor = -1;
        } else if (this.windDirection === 'right') {
          directionFactor = 1;
        } else {
          const dirTime = this.windTime * 0.12 + this.windDirectionPhase;
          const dirNoise = Math.sin(dirTime) + Math.sin(dirTime * 0.23 + Math.cos(this.windTime * 0.05)) * 0.35;
          directionFactor = Math.max(-1, Math.min(1, dirNoise));
        }

        const targetWindForce = directionFactor * gustIntensity * this.windStrength;
        const targetWindLift = gustIntensity * 0.3 * this.windStrength;

        const windSmoothFactor = 0.05;
        this.currentWindForce = this.prevWindForce * (1 - windSmoothFactor) + targetWindForce * windSmoothFactor;
        this.currentWindLift = this.prevWindLift * (1 - windSmoothFactor) + targetWindLift * windSmoothFactor;
        this.prevWindForce = this.currentWindForce;
        this.prevWindLift = this.currentWindLift;

        if (gustIntensity > 0.5 && !this.lastWindLogged) {
          console.log('🌬️ Wind is blowing with turbulence:', {
            direction: this.windDirection,
            strength: this.windStrength,
            force: this.currentWindForce.toFixed(2),
            turbulence: gustIntensity.toFixed(2)
          });
          this.lastWindLogged = true;
        } else if (gustIntensity <= 0.5) {
          this.lastWindLogged = false;
        }
      } else {
        this.currentWindForce = 0;
        this.currentWindLift = 0;
        this.prevWindForce = 0;
        this.prevWindLift = 0;
      }

      if (this.mouseBurstTimer > 0) {
        this.mouseBurstTimer = Math.max(0, this.mouseBurstTimer - delta);
        if (this.mouseBurstTimer === 0) {
          this.mouseBurstMode = null;
        }
      }

      // ПЕРВЫЙ ПРОХОД: Обновляем физику и позиции для всех снежинок
      this.flakes.forEach((flake) => {
        // Вычисляем скорость движения мыши
        const mouseSpeed = Math.sqrt(this.mouseVelocityX * this.mouseVelocityX + this.mouseVelocityY * this.mouseVelocityY);
        const activityFactor = mouseSpeed > 0 ? 1 : 0;
        const burstActive = this.mouseBurstTimer > 0;
        const shouldApplyMouse = burstActive || activityFactor > 0;
        const isMouseFast = mouseSpeed > this.mouseDragThreshold;
        
        // Применяем физику взаимодействия с мышью
        const dx = flake.x - this.mouseX;
        const dy = flake.y - this.mouseY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (!this.mouseLeftPressed && !this.mouseRightPressed && flake.isGrabbed) {
          flake.isGrabbed = false;
          flake.swayLimit = 1.0;
        }
        
        if (distance < (this.mouseRadius * (burstActive ? this.mouseBurstRadiusMultiplier : 1)) && shouldApplyMouse) {
          const radius = this.mouseRadius * (burstActive ? this.mouseBurstRadiusMultiplier : 1);
          const influence = 1 - distance / radius;
          const burstFactor = burstActive ? Math.min(1, this.mouseBurstTimer / this.mouseBurstDuration) : 0;
          const activeInfluence = influence * Math.max(activityFactor, burstFactor);
          
          // Кратковременный взрыв/втягивание при клике
          if (burstActive && this.mouseBurstMode === 'explode') {
            const safeDistance = Math.max(distance, 0.0001);
            const nx = dx / safeDistance;
            const ny = dy / safeDistance;
            const burstAccel = activeInfluence * this.mouseForce * 10.0;
            flake.velocityX += nx * burstAccel * delta;
            flake.velocityY += ny * burstAccel * delta;
          } else if (burstActive && this.mouseBurstMode === 'suction') {
            const safeDistance = Math.max(distance, 0.0001);
            const nx = dx / safeDistance;
            const ny = dy / safeDistance;
            const pullAccel = activeInfluence * this.mouseForce * 10.0;
            flake.velocityX -= nx * pullAccel * delta;
            flake.velocityY -= ny * pullAccel * delta;
          } else if (isMouseFast) {
            // Нормализуем вектор скорости мыши
            const mouseVelMag = Math.sqrt(this.mouseVelocityX * this.mouseVelocityX + this.mouseVelocityY * this.mouseVelocityY);
            if (mouseVelMag > 0) {
              const mouseDirX = this.mouseVelocityX / mouseVelMag;
              const mouseDirY = this.mouseVelocityY / mouseVelMag;
              
              // Притягиваем снежинку в сторону движения мыши
              const dragForce = activeInfluence * this.mouseDragStrength * (mouseSpeed / 1000);
              flake.velocityX += mouseDirX * dragForce * delta * 1000;
              flake.velocityY += mouseDirY * dragForce * delta * 1000;
            }
          } else {
            // Обычное отталкивание при медленном движении
            const force = activeInfluence * this.mouseForce;
            const safeDistance = Math.max(distance, 0.0001);
            const nx = dx / safeDistance;
            const ny = dy / safeDistance;
            const verticalBias = ny < 0 ? 0.35 : 1.0;
            const accel = force * delta;
            flake.velocityX += nx * accel;
            flake.velocityY += ny * accel * verticalBias;
          }
          
          // Передаем импульс от движения мыши
          const impulseStrength = activeInfluence * this.mouseImpulseStrength;
          flake.velocityX += this.mouseVelocityX * impulseStrength * delta;
          flake.velocityY += this.mouseVelocityY * impulseStrength * delta;
          
          // Вращение снежинки при движении мыши рядом
          // Направление вращения зависит от того, с какой стороны пролетела мышка
          // mouseSpeed уже объявлена выше в этом forEach-коллбэке
          // Применяем вращение только если скорость мыши выше порога (> 10 пиксели/сек)
          // Это предотвращает вращение от дрожания мыши
          if (mouseSpeed > 10) {
            const cross = dx * this.mouseVelocityY - dy * this.mouseVelocityX;
            const rotationDirection = Math.sign(cross); // +1 или -1
            const rotationForce = activeInfluence * mouseSpeed * 0.01 * rotationDirection;
            flake.rotationSpeed = (flake.rotationSpeed || 0) + rotationForce * delta;
          }
          
          if (!this.mouseLeftPressed && !this.mouseRightPressed) {
            if (flake.isGrabbed) {
              flake.grabOffsetX = undefined;
              flake.grabOffsetY = undefined;
            }
            flake.isGrabbed = false;
            flake.swayLimit = 1.0;
          }
        }

        // Применяем импульс к позиции (скорость в px/сек, умножаем на delta)
        flake.baseX += flake.velocityX * delta;
        flake.y += flake.velocityY * delta;
        // Обновляем визуальную позицию (с покачиванием)
        flake.x = flake.baseX;

        if (!flake.isGrabbed) {
          flake.phase += flake.freq * delta;
          
          // Качание маятника: визуальный наклон вместо горизонтального смещения
          // Это вычисляется при рендеринге для применения к ротации
        }
        
        if (!flake.isGrabbed) {
          // Собственное независимое кручение снежинки
          flake.cumulativeSpin = (flake.cumulativeSpin || 0) + (flake.rotationSpeed || 0) * delta;
          flake.y += flake.fallSpeed * delta;
        }

        // Сброс позиции если вышла за экран
        if (flake.y - flake.size > worldHeight) {
          flake.y = -flake.size;
          // Используем функцию поиска безопасной позиции спауна
          const newX = this._findSafeSpawnX(flake.size);
          flake.x = newX;
          flake.baseX = newX;
          flake.phase = Math.random() * Math.PI * 2;
          const newRotation = Math.random() * Math.PI * 2; // Новый случайный угол (но скорость = 0)
          flake.rotation = newRotation;
          flake.cumulativeSpin = newRotation;
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
              const windAccel = this.currentWindForce * sizeRatio * 40;
              flake.velocityX += windAccel * delta;
            }
            
            // Вертикальное воздействие ветра (лифт - сильно влияет на маленькие снежинки)
            if (this.currentWindLift !== 0) {
              // Лифт сильнее влияет на маленькие снежинки (обратная пропорциональность массе)
              const liftAccel = -this.currentWindLift * sizeRatio * 70;
              flake.velocityY += liftAccel * delta;
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
          const damping = Math.pow(0.98, delta * 60);
          flake.velocityX *= damping;
          flake.velocityY *= damping;
          flake.rotationSpeed = (flake.rotationSpeed || 0) * damping;
          
          // Обнулить очень малые значения вращения, чтобы избежать численных погрешностей
          if (Math.abs(flake.rotationSpeed) < 0.0001) {
            flake.rotationSpeed = 0;
          }
        }
      });

      // Обрабатываем края экрана как порталы (wrapping)
      this.flakes.forEach((flake) => {
        const collisionRadius = (flake.collisionSize ?? flake.size ?? 20) * 0.5;
        const worldWidth = viewport.width;
        
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

      // DEBUG: Визуализация коллизий
      if (this.debugCollisions) {
        this.flakes.forEach((flake) => {
          const x = flake.x * ratio;
          const y = flake.y * ratio;
          const collisionRadius = (flake.collisionSize ?? flake.size ?? 20) * 0.5 * ratio;
          
          ctx.save();
          
          // Рисуем границу коллизии
          ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, collisionRadius, 0, Math.PI * 2);
          ctx.stroke();
          
          // Рисуем центр
          ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
          
          // Рисуем вектор скорости
          if (flake.velocityX || flake.velocityY) {
            const velScale = 0.5;
            ctx.strokeStyle = 'rgba(0, 255, 0, 0.7)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + flake.velocityX * velScale * ratio, y + flake.velocityY * velScale * ratio);
            ctx.stroke();
          }
          
          // Показываем rotationSpeed
          if (flake.rotationSpeed && Math.abs(flake.rotationSpeed) > 0.001) {
            ctx.fillStyle = 'rgba(255, 255, 0, 0.9)';
            ctx.font = '10px monospace';
            ctx.fillText(`ω: ${flake.rotationSpeed.toFixed(3)}`, x + collisionRadius + 5, y);
          }
          
          ctx.restore();
        });
      }

      this.frameRequest = requestAnimationFrame(draw);
    };

    this.drawCallback = draw;
    draw(performance.now());
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
  onMouseDown(x, y, button) {
    if (button === 0) {
      this.mouseLeftPressed = true;
      this.mouseBurstMode = 'explode';
      this.mouseBurstTimer = this.mouseBurstDuration;
    }
    if (button === 2) {
      this.mouseRightPressed = true;
      this.mouseBurstMode = 'suction';
      this.mouseBurstTimer = this.mouseBurstDuration;
    }
    this.mouseX = x;
    this.mouseY = y;
  }

  /**
   * Обработчик отпускания кнопки мыши
   */
  onMouseUp(button) {
    if (button === 0) this.mouseLeftPressed = false;
    if (button === 2) this.mouseRightPressed = false;
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
    this.mouseLeftPressed = false;
    this.mouseRightPressed = false;
    this.mouseBurstTimer = 0;
    this.mouseBurstMode = null;
    this.mouseX = -1000;
    this.mouseY = -1000;
    this.mouseVelocityX = 0;
    this.mouseVelocityY = 0;
  }
}
