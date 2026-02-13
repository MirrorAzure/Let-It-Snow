/**
 * Обработчик физических коллизий между снежинками
 * Используется как WebGPU так и 2D renderers
 * 
 * Особенности:
 * - Точные коллизии по размеру глифов (основаны на collisionSize)
 * - Упругие столкновения с супер-упругим коэффициентом восстановления
 * - Предиктивная проверка для предотвращения прохождения сквозь друг друга
 * - Поддержка взаимодействия с мышью и захватывания снежинок
 * - Оптимизация через радиус проверки коллизий
 */

export class CollisionHandler {
  constructor(config = {}) {
    this.enableCollisions = config.enableCollisions ?? true;
    this.collisionDamping = config.collisionDamping ?? 0.7;
    // Увеличиваем радиус проверки коллизий для обнаружения даже при большом покачивании
    this.collisionCheckRadius = config.collisionCheckRadius ?? 600;
    this.swayImpulseTransfer = config.swayImpulseTransfer ?? 0.3; // Коэффициент передачи импульса при раскачивании
    this.debugCollisions = config.debugCollisions ?? false; // Флаг для вывода дебаг информации при столкновениях
  }

  /**
   * Проверка и обработка коллизий между снежинками с учетом раскачивания
   * 
   * Алгоритм:
   * 1. Проверяет расстояние между всеми парами снежинок в пределах radius
   * 2. Рассчитывает minimum distance на основе collisionSize каждой снежинки
   * 3. Применяет импульс упругого столкновения
   * 4. Разводит перекрывающиеся снежинки
   * 5. Корректирует amplituda колебаний при необходимости
   * 
   * @param {Array} flakes - Массив объектов снежинок с позициями и скоростями
   * @param {number} delta - Время до следующего кадра в секундах
   */
  handleCollisions(flakes, delta = 0.016) {
    if (!this.enableCollisions || !flakes || flakes.length < 2) return;

    // Сбрасываем ограничения покачивания перед новой проверкой
    flakes.forEach(flake => {
      flake.swayLimit = flake.isGrabbed ? 0 : 1.0; // 1.0 = без ограничений
    });

    // Оптимизация: проверяем только близкие пары
    for (let i = 0; i < flakes.length; i++) {
      const flakeA = flakes[i];
      
      // Проверяем только снежинки в радиусе collisionCheckRadius
      for (let j = i + 1; j < flakes.length; j++) {
        const flakeB = flakes[j];
        
        // КРИТИЧНО: Используем продолжительную позицию, которая совпадает с визуальным положением при рендеринге
        // Теперь качание реализовано через ротацию (визуальный наклон), а не горизонтальное смещение
        const baseXA = flakeA.baseX ?? flakeA.x;
        const baseXB = flakeB.baseX ?? flakeB.x;
        
        // Рассчитываем визуальное смещение от наклона (качания маятника)
        const maxSwingAngle = 0.35; // максимальный наклон в радианах (~20 градусов)
        const swingAngleA = flakeA.isGrabbed ? 0 : Math.sin(flakeA.phase ?? 0) * maxSwingAngle * ((flakeA.swayLimit ?? 1.0));
        const swingAngleB = flakeB.isGrabbed ? 0 : Math.sin(flakeB.phase ?? 0) * maxSwingAngle * ((flakeB.swayLimit ?? 1.0));
        
        // Видимое горизонтальное смещение при наклоне снежинки: sin(angle) * (size/2)
        const swayFromRotationA = Math.sin(swingAngleA) * (flakeA.size ?? 20) * 0.5;
        const swayFromRotationB = Math.sin(swingAngleB) * (flakeB.size ?? 20) * 0.5;
        
        const dx = (baseXB + swayFromRotationB) - (baseXA + swayFromRotationA);
        const dy = flakeB.y - flakeA.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Пропускаем, если снежинки слишком далеко
        if (distance > this.collisionCheckRadius) continue;
        
        // Используем collisionSize для проверки коллизий (соответствует визуальному размеру)
        const minDistance = this._getMinCollisionDistance(flakeA, flakeB);
        
        // Добавляем запас на амплитуду качания обеих снежинок
        // Это предотвращает просачивание при наклоне с большой амплитудой
        const maxSwayFromRotationA = Math.abs(Math.sin(maxSwingAngle)) * (flakeA.size ?? 20) * 0.5;
        const maxSwayFromRotationB = Math.abs(Math.sin(maxSwingAngle)) * (flakeB.size ?? 20) * 0.5;
        const swayBuffer = Math.max(0, maxSwayFromRotationA + maxSwayFromRotationB) * 0.5;
        
        // Если снежинки пересекаются
        // Простейшая предикция, чтобы уменьшить прохождения сквозь друг друга
        const safeDistance = Math.max(distance, 0.0001);
        const nx = dx / safeDistance;
        const ny = dy / safeDistance;
        const dvx = (flakeB.velocityX ?? 0) - (flakeA.velocityX ?? 0);
        const dvy = (flakeB.velocityY ?? 0) - (flakeA.velocityY ?? 0);
        const dvn = dvx * nx + dvy * ny;
        const predictivePadding = Math.max(0, -dvn) * delta;

        const effectiveMinDistance = minDistance + predictivePadding + swayBuffer;
        if (distance < effectiveMinDistance) {
          this._resolveCollision(flakeA, flakeB, dx, dy, distance, effectiveMinDistance, 0, 0, delta);
        }
      }
    }
  }

  /**
   * Получить минимальную дистанцию для коллизии между двумя снежинками
   * Размер коллизии рассчитывается точно по размеру глифа
   * @private
   */
  _getMinCollisionDistance(flakeA, flakeB) {
    // Размер коллизии основан на фактическом размере отображения
    // collisionSize содержит точный размер визуального глифа в пикселях
    const getSizeWithGlyph = (flake) => {
      // Используем collisionSize как точный размер отображаемого элемента
      const baseSize = flake.collisionSize ?? flake.size ?? 20;
      // Коллизии точно соответствуют размеру визуального элемента
      // без искажений из-за разных размеров атласа
      return baseSize;
    };
    
    const sizeA = getSizeWithGlyph(flakeA);
    const sizeB = getSizeWithGlyph(flakeB);
    
    // Возвращаем сумму радиусов (расстояние между центрами при касании)
    // Возвращаем точное значение суммы радиусов для правильного разделения
    const sumSize = sizeA + sizeB;
    return sumSize * 0.5; // Точное расстояние касания без уменьшения
  }

  /**
   * Разрешение коллизии между двумя снежинками
   * @private
   */
  _resolveCollision(flakeA, flakeB, dx, dy, distance, minDistance, swayA, swayB, delta) {
    const safeDistance = Math.max(distance, 0.0001);

    // DEBUG: Логирование столкновения
    if (this.debugCollisions) {
      const flakeAId = flakeA.id ?? flakeA.glyph ?? 'unknown-A';
      const flakeBId = flakeB.id ?? flakeB.glyph ?? 'unknown-B';
      const collisionX = (flakeA.x + flakeB.x) / 2;
      const collisionY = (flakeA.y + flakeB.y) / 2;
      
      console.log(
        `%c⚡ СТОЛКНОВЕНИЕ СНЕЖИНОК`,
        'color: #ff6b6b; font-weight: bold; font-size: 12px;',
        {
          'Снежинка A': {
            id: flakeAId,
            позиция: {x: Math.round(flakeA.x), y: Math.round(flakeA.y)},
            скорость: {vx: Math.round(flakeA.velocityX * 100) / 100, vy: Math.round(flakeA.velocityY * 100) / 100},
            размер: Math.round(flakeA.collisionSize ?? flakeA.size ?? 20)
          },
          'Снежинка B': {
            id: flakeBId,
            позиция: {x: Math.round(flakeB.x), y: Math.round(flakeB.y)},
            скорость: {vx: Math.round(flakeB.velocityX * 100) / 100, vy: Math.round(flakeB.velocityY * 100) / 100},
            размер: Math.round(flakeB.collisionSize ?? flakeB.size ?? 20)
          },
          'ТОЧКА СТОЛКНОВЕНИЯ': {
            x: Math.round(collisionX),
            y: Math.round(collisionY)
          },
          'СТАТИСТИКА': {
            'Расстояние': Math.round(distance * 100) / 100,
            'Минимум дистанции': Math.round(minDistance * 100) / 100,
            'Перекрытие': Math.round((minDistance - distance) * 100) / 100
          }
        }
      );
    }
    // Нормализованный вектор между снежинками
    let nx = dx / safeDistance;
    let ny = dy / safeDistance;
    if (nx === 0 && ny === 0) {
      nx = 1;
      ny = 0;
    }
    
    // Относительная скорость
    const dvx = (flakeB.velocityX ?? 0) - (flakeA.velocityX ?? 0);
    const dvy = (flakeB.velocityY ?? 0) - (flakeA.velocityY ?? 0);
    
    // Скорость сближения
    const dvn = dvx * nx + dvy * ny;
    
    // Импульс столкновения (упрощенная физика для равных масс)
    // Применяем упругое столкновение с коэффициентом восстановления
    if (dvn < 0) {
      const oldVelAx = flakeA.velocityX;
      const oldVelAy = flakeA.velocityY;
      const oldVelBx = flakeB.velocityX;
      const oldVelBy = flakeB.velocityY;
      
      // Коэффициент восстановления (elasticity) для упругого столкновения
      // Использование 0.95-1.05 обеспечивает контролируемый отскок без взрыва
      const restitution = 0.95;
      // Для равных масс импульс делится поровну
      const mass = 1.0;
      const impulse = -(1 + restitution) * dvn / (2 * mass);
      
      // Масштаб импульса для контролируемого отскока
      // 1.1 означает небольшое усиление без взрывного эффекта
      const impulseScale = 1.1;
      
      // Ограничиваем максимальный импульс чтобы избежать взрывных столкновений
      const maxImpulse = 3.0;
      const clampedImpulse = Math.max(-maxImpulse, Math.min(maxImpulse, impulse * impulseScale));
      flakeA.velocityX -= clampedImpulse * nx;
      flakeA.velocityY -= clampedImpulse * ny;
      flakeB.velocityX += clampedImpulse * nx;
      flakeB.velocityY += clampedImpulse * ny;
      
      // DEBUG: Логирование изменения скорости после столкновения
      if (this.debugCollisions) {
        const newVelAx = flakeA.velocityX;
        const newVelAy = flakeA.velocityY;
        const newVelBx = flakeB.velocityX;
        const newVelBy = flakeB.velocityY;
        
        console.log(
          `%c  ➜ Результат столкновения:`,
          'color: #4dabf7; font-size: 11px;',
          {
            'Снежинка A': {
              скорость_до: {vx: Math.round(oldVelAx * 100) / 100, vy: Math.round(oldVelAy * 100) / 100},
              скорость_после: {vx: Math.round(newVelAx * 100) / 100, vy: Math.round(newVelAy * 100) / 100}
            },
            'Снежинка B': {
              скорость_до: {vx: Math.round(oldVelBx * 100) / 100, vy: Math.round(oldVelBy * 100) / 100},
              скорость_после: {vx: Math.round(newVelBx * 100) / 100, vy: Math.round(newVelBy * 100) / 100}
            },
            'Параметры': {
              импульс: Math.round(impulse * 100) / 100,
              коэффициент_восстановления: restitution
            }
          }
        );
      }
    }
    
    // Вычисляем скорости раскачивания (производная синуса)
    if (!flakeA.isGrabbed && !flakeB.isGrabbed && delta > 0 && distance > minDistance * 0.8) {
      const swayVelocityA = Math.cos(flakeA.phase ?? 0) * (flakeA.freq ?? 0) * (flakeA.sway ?? 0);
      const swayVelocityB = Math.cos(flakeB.phase ?? 0) * (flakeB.freq ?? 0) * (flakeB.sway ?? 0);
      
      // Относительная скорость раскачивания
      const relativeSwayVelocity = swayVelocityB - swayVelocityA;
      
      // Передаем импульс от раскачивания, если снежинки сближаются при раскачивании
      const swayImpulseRaw = relativeSwayVelocity * nx * this.swayImpulseTransfer;
      const swayImpulse = Math.max(-0.5, Math.min(0.5, swayImpulseRaw));
      if (swayImpulse < 0) { // Сближаются
        flakeA.velocityX -= swayImpulse * nx;
        flakeB.velocityX += swayImpulse * nx;
      }
    }
    
    // Разводим снежинки, чтобы они не застревали друг в друге
    const overlap = minDistance - safeDistance;
    if (overlap > 0) {
      const slop = minDistance * 0.01; // Допуск для разделения
      const percent = 1.0; // Полное разделение (50/50)
      const correctionMag = Math.max(overlap - slop, 0) / (safeDistance + 0.0001);
      // Умеренная коррекция разделения для предотвращения взрывов
      // 1.8 обеспечивает достаточное разделение без чрезмерной силы
      const amplifiedCorrectionMag = correctionMag * 1.8;
      const correctionX = nx * amplifiedCorrectionMag * percent;
      const correctionY = ny * amplifiedCorrectionMag * percent;
      
      // DEBUG: Логирование разделения
      if (this.debugCollisions) {
        console.log(
          `%c  ↔ Разделение снежинок:`,
          'color: #51cf66; font-size: 11px;',
          {
            'Перекрытие': Math.round(overlap * 100) / 100,
            'Коррекция': {x: Math.round(correctionX * 100) / 100, y: Math.round(correctionY * 100) / 100},
            'Направление': {nx: Math.round(nx * 100) / 100, ny: Math.round(ny * 100) / 100}
          }
        );
      }
      
      const applyToFlake = (flake, sx, sy) => {
        if (flake.baseX !== undefined) {
          flake.baseX += sx;
          flake.x = flake.baseX;
        } else {
          flake.x += sx;
        }
        flake.y += sy;
      };

      if (!flakeA.isGrabbed && !flakeB.isGrabbed) {
        applyToFlake(flakeA, -correctionX * 0.5, -correctionY * 0.5);
        applyToFlake(flakeB, correctionX * 0.5, correctionY * 0.5);
      } else if (!flakeA.isGrabbed && flakeB.isGrabbed) {
        applyToFlake(flakeA, -correctionX, -correctionY);
      } else if (flakeA.isGrabbed && !flakeB.isGrabbed) {
        applyToFlake(flakeB, correctionX, correctionY);
      }
    }
  }

  /**
   * Предиктивная проверка коллизий при качании маятника
   * Проверяет, не столкнутся ли снежинки в следующем кадре при раскачивании
   * @private
   */
  _checkSwayCollision(flakeA, flakeB, delta) {
    if (flakeA.isGrabbed || flakeB.isGrabbed) return;
    
    // Предсказываем фазы в следующем кадре
    const nextPhaseA = (flakeA.phase ?? 0) + (flakeA.freq ?? 0) * delta;
    const nextPhaseB = (flakeB.phase ?? 0) + (flakeB.freq ?? 0) * delta;
    
    // Рассчитываем угол качания в следующем кадре
    const maxSwingAngle = 0.35;
    const nextSwingAngleA = Math.sin(nextPhaseA) * maxSwingAngle * (flakeA.swayLimit ?? 1.0);
    const nextSwingAngleB = Math.sin(nextPhaseB) * maxSwingAngle * (flakeB.swayLimit ?? 1.0);
    
    // Визуальное смещение от наклона
    const nextSwayFromRotationA = Math.sin(nextSwingAngleA) * (flakeA.size ?? 20) * 0.5;
    const nextSwayFromRotationB = Math.sin(nextSwingAngleB) * (flakeB.size ?? 20) * 0.5;
    
    // Предсказываем позиции
    const nextVisualXA = flakeA.x + nextSwayFromRotationA;
    const nextVisualXB = flakeB.x + nextSwayFromRotationB;
    
    const nextDx = nextVisualXB - nextVisualXA;
    const nextDy = flakeB.y - flakeA.y; // Y не меняется за такой короткий промежуток
    const nextDistance = Math.sqrt(nextDx * nextDx + nextDy * nextDy);
    
    const minDistance = this._getMinCollisionDistance(flakeA, flakeB);
    
    // Если предсказывается коллизия
    if (nextDistance < minDistance) {
      // Вычисляем текущее расстояние
      const currentSwingAngleA = Math.sin(flakeA.phase ?? 0) * maxSwingAngle * (flakeA.swayLimit ?? 1.0);
      const currentSwingAngleB = Math.sin(flakeB.phase ?? 0) * maxSwingAngle * (flakeB.swayLimit ?? 1.0);
      const currentSwayFromRotationA = Math.sin(currentSwingAngleA) * (flakeA.size ?? 20) * 0.5;
      const currentSwayFromRotationB = Math.sin(currentSwingAngleB) * (flakeB.size ?? 20) * 0.5;
      const currentDx = (flakeB.x + currentSwayFromRotationB) - (flakeA.x + currentSwayFromRotationA);
      const currentDy = flakeB.y - flakeA.y;
      const currentDistance = Math.sqrt(currentDx * currentDx + currentDy * currentDy);
      
      // Ограничиваем амплитуду раскачивания, чтобы предотвратить коллизию
      if (currentDistance > minDistance) {
        // Вычисляем коэффициент ограничения
        const swingDeltaA = nextSwayFromRotationA - currentSwayFromRotationA;
        const swingDeltaB = nextSwayFromRotationB - currentSwayFromRotationB;
        const safeSwayLimit = (currentDistance - minDistance) / (Math.abs(swingDeltaA) + Math.abs(swingDeltaB) + 0.1);
        const clampedLimit = Math.max(0.3, Math.min(1.0, safeSwayLimit)); // Минимум 30% амплитуды
        
        // Применяем ограничение к обеим снежинкам
        flakeA.swayLimit = Math.min(flakeA.swayLimit ?? 1.0, clampedLimit);
        flakeB.swayLimit = Math.min(flakeB.swayLimit ?? 1.0, clampedLimit);
      }
    }
  }

  /**
   * Обновить параметры коллизий
   */
  updateConfig(config) {
    if (config.enableCollisions !== undefined) {
      this.enableCollisions = config.enableCollisions;
    }
    if (config.collisionDamping !== undefined) {
      this.collisionDamping = config.collisionDamping;
    }
    if (config.collisionCheckRadius !== undefined) {
      this.collisionCheckRadius = config.collisionCheckRadius;
    }
    if (config.swayImpulseTransfer !== undefined) {
      this.swayImpulseTransfer = config.swayImpulseTransfer;
    }
    if (config.debugCollisions !== undefined) {
      this.debugCollisions = config.debugCollisions;
    }
  }
}
