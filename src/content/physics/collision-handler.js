import { normalizePhysicsDelta } from './time-step.js';

/**
 * Обработчик физических коллизий между снежинками
 * Используется как WebGPU так и 2D renderers
 * 
 * Особенности:
 * - Точные коллизии по размеру глифов (основаны на collisionSize)
 * - Столкновения с учетом массы и коэффициента восстановления
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
    this.collisionCheckRadiusSq = this.collisionCheckRadius * this.collisionCheckRadius;
    this.minSpatialCellSize = config.minSpatialCellSize ?? 48;
    this.maxSpatialCellSize = config.maxSpatialCellSize ?? this.collisionCheckRadius;
    this._spatialGrid = new Map();
    this._spatialCellSize = this.minSpatialCellSize;
    this.swayImpulseTransfer = config.swayImpulseTransfer ?? 0.3; // Коэффициент передачи импульса при раскачивании
    this.debugCollisions = config.debugCollisions ?? false; // Флаг для вывода дебаг информации при столкновениях
  }

  _cellKey(cx, cy) {
    return `${cx},${cy}`;
  }

  _bucketFlake(grid, index, x, y, invCellSize) {
    const cx = Math.floor(x * invCellSize);
    const cy = Math.floor(y * invCellSize);
    const key = this._cellKey(cx, cy);
    const bucket = grid.get(key);
    if (bucket) {
      bucket.push(index);
    } else {
      grid.set(key, [index]);
    }
  }

  _getCollisionCenterX(flake) {
    return flake.x;
  }

  _processPair(flakes, i, j, delta) {
    const flakeA = flakes[i];
    const flakeB = flakes[j];

    const centerXA = this._getCollisionCenterX(flakeA);
    const centerXB = this._getCollisionCenterX(flakeB);
    const dy = flakeB.y - flakeA.y;

    const dx = centerXB - centerXA;
    const distSq = dx * dx + dy * dy;
    if (distSq > this.collisionCheckRadiusSq) return;

    const distance = Math.sqrt(distSq);
    const minDistance = (flakeA._collisionRadius ?? (flakeA.collisionSize ?? flakeA.size ?? 20) * 0.5)
                      + (flakeB._collisionRadius ?? (flakeB.collisionSize ?? flakeB.size ?? 20) * 0.5);
    const swayBuffer = ((flakeA._swayBuffer ?? 0) + (flakeB._swayBuffer ?? 0)) * 0.5;

    const safeDistance = Math.max(distance, 0.0001);
    const nx = dx / safeDistance;
    const ny = dy / safeDistance;
    const velocityYA = (flakeA.velocityY ?? 0) + (flakeA.fallSpeed ?? 0);
    const velocityYB = (flakeB.velocityY ?? 0) + (flakeB.fallSpeed ?? 0);
    const dvx = (flakeB.velocityX ?? 0) - (flakeA.velocityX ?? 0);
    const dvy = velocityYB - velocityYA;
    const dvn = dvx * nx + dvy * ny;
    const predictivePadding = Math.max(0, -dvn) * Math.max(0, delta);

    const contactDistance = minDistance + swayBuffer;
    if (distance < contactDistance + predictivePadding) {
      this._resolveCollision(flakeA, flakeB, dx, dy, distance, contactDistance, 0, 0, delta);
    }
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
    if (!this.enableCollisions || !flakes) return;
    delta = normalizePhysicsDelta(delta);

    // Сбрасываем ограничения покачивания перед новой проверкой
    let maxCollisionRadius = 0;
    let maxSwayBuffer = 0;
    let maxVelocity = 0;
    for (let i = 0; i < flakes.length; i++) {
      const flake = flakes[i];
      if (flake.isFinished || flake.isSettled || flake.isAwaitingRespawn) continue;
      flake.swayLimit = flake.isGrabbed ? 0 : 1.0;

      const radius = flake._collisionRadius ?? (flake.collisionSize ?? flake.size ?? 20) * 0.5;
      const swayBuffer = flake._swayBuffer ?? Math.sin(0.35) * (flake.size ?? 20) * 0.5;
      const velocityMag = Math.hypot(
        flake.velocityX ?? 0,
        (flake.velocityY ?? 0) + (flake.fallSpeed ?? 0)
      );

      if (radius > maxCollisionRadius) maxCollisionRadius = radius;
      if (swayBuffer > maxSwayBuffer) maxSwayBuffer = swayBuffer;
      if (velocityMag > maxVelocity) maxVelocity = velocityMag;
    }

    // Если меньше 2 снежинок, коллизий не будет, но swayLimit уже сброшен
    if (flakes.length < 2) return;

    const maxInteractionDistance = Math.min(
      this.collisionCheckRadius,
      Math.max(
        this.minSpatialCellSize,
        maxCollisionRadius * 2 + maxSwayBuffer + 2 * maxVelocity * Math.max(0, delta)
      )
    );
    const cellSize = Math.max(this.minSpatialCellSize, Math.min(this.maxSpatialCellSize, maxInteractionDistance));
    this._spatialCellSize = cellSize;

    const grid = this._spatialGrid;
    grid.clear();
    const invCellSize = 1 / cellSize;

    for (let i = 0; i < flakes.length; i++) {
      const flake = flakes[i];
      if (flake.isFinished || flake.isSettled || flake.isAwaitingRespawn) continue;
      this._bucketFlake(grid, i, this._getCollisionCenterX(flake), flake.y, invCellSize);
    }

    const neighbors = [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1]
    ];

    for (const [key, indices] of grid.entries()) {
      for (let i = 0; i < indices.length; i++) {
        for (let j = i + 1; j < indices.length; j++) {
          this._processPair(flakes, indices[i], indices[j], delta);
        }
      }

      const split = key.split(',');
      const cx = Number(split[0]);
      const cy = Number(split[1]);

      for (let n = 0; n < neighbors.length; n++) {
        const nx = cx + neighbors[n][0];
        const ny = cy + neighbors[n][1];
        const neighborBucket = grid.get(this._cellKey(nx, ny));
        if (!neighborBucket) continue;

        for (let i = 0; i < indices.length; i++) {
          const a = indices[i];
          for (let j = 0; j < neighborBucket.length; j++) {
            this._processPair(flakes, a, neighborBucket[j], delta);
          }
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
    const dvy = ((flakeB.velocityY ?? 0) + (flakeB.fallSpeed ?? 0))
      - ((flakeA.velocityY ?? 0) + (flakeA.fallSpeed ?? 0));
    
    // Скорость сближения
    const dvn = dvx * nx + dvy * ny;
    
    const massA = Number.isFinite(flakeA.mass) && flakeA.mass > 0 ? flakeA.mass : 1;
    const massB = Number.isFinite(flakeB.mass) && flakeB.mass > 0 ? flakeB.mass : 1;
    const inverseMassA = flakeA.isGrabbed ? 0 : 1 / massA;
    const inverseMassB = flakeB.isGrabbed ? 0 : 1 / massB;
    const inverseMassSum = inverseMassA + inverseMassB;

    if (dvn < 0 && inverseMassSum > 0) {
      const oldVelAx = flakeA.velocityX;
      const oldVelAy = flakeA.velocityY;
      const oldVelBx = flakeB.velocityX;
      const oldVelBy = flakeB.velocityY;
      
      const restitution = 0.95 * Math.max(0, Math.min(1, this.collisionDamping));
      const impulse = -(1 + restitution) * dvn / inverseMassSum;

      if (inverseMassA > 0) {
        flakeA.velocityX -= impulse * inverseMassA * nx;
        flakeA.velocityY -= impulse * inverseMassA * ny;
      }
      if (inverseMassB > 0) {
        flakeB.velocityX += impulse * inverseMassB * nx;
        flakeB.velocityY += impulse * inverseMassB * ny;
      }
      
      // Применяем вращательный момент при столкновении
      // Тангенциальный вектор (перпендикулярный к линии столкновения)
      const tx = -ny;
      const ty = nx;
      
      // Тангенциальная компонента относительной скорости
      const dvt = dvx * tx + dvy * ty;
      
      // Вращательный момент пропорционален тангенциальной скорости
      // Применяем вращение только при значительном столкновении:
      // - Тангенциальная скорость > 5.0 пикселей/сек
      // - Скорость сближения достаточна (dvn < -5.0) - исключаем статический контакт и расхождение
      // Это предотвращает накопление вращения от:
      // 1. Слабых касаний соседних снежинок
      // 2. Постоянного контакта при качании
      // 3. Циклических микро-столкновений
      if (Math.abs(dvt) > 5.0 && dvn < -5.0) {
        const rotationImpulse = dvt * 0.01;
        
        // Дополнительная проверка: игнорируем совсем слабые импульсы
        if (Math.abs(rotationImpulse) > 0.001) {
          // Ограничиваем максимальную скорость вращения для предотвращения накопления
          const maxRotationSpeed = 2.0; // радиан/сек
          
          // Применяем вращение к обеим снежинкам в противоположных направлениях
          if (!flakeA.isGrabbed && flakeA.rotationSpeed !== undefined) {
            const newRotationA = flakeA.rotationSpeed + rotationImpulse;
            flakeA.rotationSpeed = Math.max(-maxRotationSpeed, Math.min(maxRotationSpeed, newRotationA));
          }
          if (!flakeB.isGrabbed && flakeB.rotationSpeed !== undefined) {
            const newRotationB = flakeB.rotationSpeed - rotationImpulse;
            flakeB.rotationSpeed = Math.max(-maxRotationSpeed, Math.min(maxRotationSpeed, newRotationB));
          }
        }
      }
      
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
      const correctionMag = Math.max(overlap - slop, 0) * 0.4;
      const correctionX = nx * correctionMag;
      const correctionY = ny * correctionMag;
      
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
        flake.x += sx;
        if (flake.baseX !== undefined) {
          flake.baseX = flake.x;
        }
        flake.y += sy;
      };

      const inverseMassA = flakeA.isGrabbed ? 0
        : 1 / (Number.isFinite(flakeA.mass) && flakeA.mass > 0 ? flakeA.mass : 1);
      const inverseMassB = flakeB.isGrabbed ? 0
        : 1 / (Number.isFinite(flakeB.mass) && flakeB.mass > 0 ? flakeB.mass : 1);
      const inverseMassSum = inverseMassA + inverseMassB;
      if (inverseMassSum > 0) {
        applyToFlake(flakeA, -correctionX * inverseMassA / inverseMassSum,
          -correctionY * inverseMassA / inverseMassSum);
        applyToFlake(flakeB, correctionX * inverseMassB / inverseMassSum,
          correctionY * inverseMassB / inverseMassSum);
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
      this.collisionCheckRadiusSq = this.collisionCheckRadius * this.collisionCheckRadius;
      this.maxSpatialCellSize = this.collisionCheckRadius;
    }
    if (config.swayImpulseTransfer !== undefined) {
      this.swayImpulseTransfer = config.swayImpulseTransfer;
    }
    if (config.debugCollisions !== undefined) {
      this.debugCollisions = config.debugCollisions;
    }
  }
}
