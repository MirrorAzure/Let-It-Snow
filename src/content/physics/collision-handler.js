/**
 * Обработчик физических коллизий между снежинками
 * Используется как WebGPU так и 2D renderers
 */

export class CollisionHandler {
  constructor(config = {}) {
    this.enableCollisions = config.enableCollisions ?? true;
    this.collisionDamping = config.collisionDamping ?? 0.7;
    this.collisionCheckRadius = config.collisionCheckRadius ?? 200;
  }

  /**
   * Проверка и обработка коллизий между снежинками
   * @param {Array} flakes - Массив объектов снежинок с позициями и скоростями
   */
  handleCollisions(flakes) {
    if (!this.enableCollisions || !flakes || flakes.length < 2) return;

    // Оптимизация: проверяем только близкие пары
    for (let i = 0; i < flakes.length; i++) {
      const flakeA = flakes[i];
      
      // Проверяем только снежинки в радиусе collisionCheckRadius
      for (let j = i + 1; j < flakes.length; j++) {
        const flakeB = flakes[j];
        
        const dx = flakeB.x - flakeA.x;
        const dy = flakeB.y - flakeA.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Пропускаем, если снежинки слишком далеко
        if (distance > this.collisionCheckRadius) continue;
        
        // Используем collisionSize для проверки коллизий (соответствует визуальному размеру)
        const minDistance = this._getMinCollisionDistance(flakeA, flakeB);
        
        // Если снежинки пересекаются
        if (distance < minDistance && distance > 0) {
          this._resolveCollision(flakeA, flakeB, dx, dy, distance, minDistance);
        }
      }
    }
  }

  /**
   * Получить минимальную дистанцию для коллизии между двумя снежинками
   * @private
   */
  _getMinCollisionDistance(flakeA, flakeB) {
    const sizeA = flakeA.collisionSize ?? flakeA.size ?? 20;
    const sizeB = flakeB.collisionSize ?? flakeB.size ?? 20;
    return (sizeA + sizeB) * 0.5;
  }

  /**
   * Разрешение коллизии между двумя снежинками
   * @private
   */
  _resolveCollision(flakeA, flakeB, dx, dy, distance, minDistance) {
    // Нормализованный вектор между снежинками
    const nx = dx / distance;
    const ny = dy / distance;
    
    // Относительная скорость
    const dvx = (flakeB.velocityX ?? 0) - (flakeA.velocityX ?? 0);
    const dvy = (flakeB.velocityY ?? 0) - (flakeA.velocityY ?? 0);
    
    // Скорость сближения
    const dvn = dvx * nx + dvy * ny;
    
    // Если снежинки уже расходятся, не обрабатываем коллизию
    if (dvn > 0) return;
    
    // Импульс столкновения (упрощенная физика для равных масс)
    const impulse = dvn * this.collisionDamping;
    
    // Применяем импульс к обеим снежинкам
    if (flakeA.velocityX !== undefined) {
      flakeA.velocityX += nx * impulse;
      flakeA.velocityY += ny * impulse;
    }
    
    if (flakeB.velocityX !== undefined) {
      flakeB.velocityX -= nx * impulse;
      flakeB.velocityY -= ny * impulse;
    }
    
    // Разводим снежинки, чтобы они не застревали друг в друге
    const overlap = minDistance - distance;
    const separationX = nx * overlap * 0.5;
    const separationY = ny * overlap * 0.5;
    
    flakeA.x -= separationX;
    flakeA.y -= separationY;
    flakeB.x += separationX;
    flakeB.y += separationY;
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
  }
}
