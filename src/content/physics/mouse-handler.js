/**
 * Обработчик взаимодействия анимации с движением мыши
 * Используется как WebGPU так и 2D renderers
 */

export class MouseHandler {
  constructor(config = {}) {
    this.mouseX = -1000;
    this.mouseY = -1000;
    this.mouseVelocityX = 0;
    this.mouseVelocityY = 0;
    this.mousePressed = false;
    this.mouseRadius = config.mouseRadius ?? 100;
    this.mouseForce = config.mouseForce ?? 300;
    this.mouseImpulseStrength = config.mouseImpulseStrength ?? 0.5;
    this.mouseDragThreshold = config.mouseDragThreshold ?? 500;
    this.mouseDragStrength = config.mouseDragStrength ?? 0.8;
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

  /**
   * Применить эффект мыши к снежинке
   * @param {object} flake - Объект снежинки
   * @param {number} delta - Время в секундах
   */
  applyMouseEffect(flake, delta = 0.016) {
    const dx = flake.x - this.mouseX;
    const dy = flake.y - this.mouseY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (!this.mousePressed && flake.isGrabbed) {
      flake.isGrabbed = false;
      flake.swayLimit = 1.0;
    }

    if (distance >= this.mouseRadius) return;

    const influence = 1 - distance / this.mouseRadius;
    const mouseSpeed = Math.sqrt(
      this.mouseVelocityX * this.mouseVelocityX + 
      this.mouseVelocityY * this.mouseVelocityY
    );
    const isMouseFast = mouseSpeed > this.mouseDragThreshold;

    if (isMouseFast) {
      // Эффект воздушного потока при быстром движении мыши
      const mouseVelMag = Math.max(0.001, mouseSpeed);
      const mouseDirX = this.mouseVelocityX / mouseVelMag;
      const mouseDirY = this.mouseVelocityY / mouseVelMag;
      
      const dragForce = influence * this.mouseDragStrength * (mouseSpeed / 1000);
      flake.velocityX = (flake.velocityX ?? 0) + mouseDirX * dragForce * delta * 1000;
      flake.velocityY = (flake.velocityY ?? 0) + mouseDirY * dragForce * delta * 1000;
    } else {
      // Обычное отталкивание при медленном движении
      const force = influence * this.mouseForce;
      const safeDistance = Math.max(distance, 0.0001);
      const nx = dx / safeDistance;
      const ny = dy / safeDistance;
      const verticalBias = ny < 0 ? 0.35 : 1.0;
      const accel = force * (delta || 0.016);
      
      flake.velocityX = (flake.velocityX ?? 0) + nx * accel;
      flake.velocityY = (flake.velocityY ?? 0) + ny * accel * verticalBias;
    }
    
    // Передаем импульс от движения мыши
    const impulseStrength = influence * this.mouseImpulseStrength;
    flake.velocityX = (flake.velocityX ?? 0) + this.mouseVelocityX * impulseStrength * (delta || 0.016);
    flake.velocityY = (flake.velocityY ?? 0) + this.mouseVelocityY * impulseStrength * (delta || 0.016);
    
    // Вращение снежинки при движении мыши рядом
    const cross = dx * this.mouseVelocityY - dy * this.mouseVelocityX;
    const rotationDirection = Math.sign(cross) || 0;
    const rotationForce = influence * mouseSpeed * 0.01 * rotationDirection;
    
    if (flake.rotationSpeed !== undefined) {
      flake.rotationSpeed = (flake.rotationSpeed ?? 0) + rotationForce * (delta || 0.016);
    }
    
    // При зажатии кнопки мыши - захватываем снежинку
    if (this.mousePressed && distance < this.mouseRadius * 0.5) {
      flake.x = this.mouseX;
      flake.y = this.mouseY;
      flake.velocityX = 0;
      flake.velocityY = 0;
      flake.rotationSpeed = 0;
      flake.isGrabbed = true;
      flake.swayLimit = 0;
    } else if (!this.mousePressed) {
      flake.isGrabbed = false;
      flake.swayLimit = 1.0;
    }
  }

  /**
   * Обновить параметры взаимодействия с мышью
   */
  updateConfig(config) {
    if (config.mouseRadius !== undefined) this.mouseRadius = config.mouseRadius;
    if (config.mouseForce !== undefined) this.mouseForce = config.mouseForce;
    if (config.mouseImpulseStrength !== undefined) this.mouseImpulseStrength = config.mouseImpulseStrength;
    if (config.mouseDragThreshold !== undefined) this.mouseDragThreshold = config.mouseDragThreshold;
    if (config.mouseDragStrength !== undefined) this.mouseDragStrength = config.mouseDragStrength;
  }
}
