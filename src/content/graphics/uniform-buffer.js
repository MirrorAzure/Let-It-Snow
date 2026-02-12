/**
 * Управление Uniform буфером для WebGPU рендерера
 */

export class UniformBufferManager {
  constructor(device) {
    this.device = device;
    this.uniformArray = new Float32Array(8);
    this.uniformArray[5] = 1; // glow enabled by default
    this.buffer = null;
    this.needsUpdate = true;
  }

  /**
   * Инициализация uniform буфера
   */
  initialize() {
    this.buffer = this.device.createBuffer({
      size: this.uniformArray.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.needsUpdate = true;
  }

  /**
   * Обновить размер canvas
   */
  setCanvasSize(width, height) {
    if (this.uniformArray[0] === width && this.uniformArray[1] === height) {
      return false;
    }
    this.uniformArray[0] = width;
    this.uniformArray[1] = height;
    this.needsUpdate = true;
    return true;
  }

  /**
   * Обновить параметры глифов
   */
  setGlyphParams(count, size, isMonotone) {
    const monotoneValue = isMonotone ? 1.0 : 0.0;
    if (this.uniformArray[2] !== count || 
        this.uniformArray[3] !== size || 
        this.uniformArray[4] !== monotoneValue) {
      this.uniformArray[2] = count;
      this.uniformArray[3] = size;
      this.uniformArray[4] = monotoneValue;
      this.needsUpdate = true;
      return true;
    }
    return false;
  }

  /**
   * Обновить параметры предложений
   */
  setSentenceParams(count, size) {
    if (this.uniformArray[6] !== count || this.uniformArray[7] !== size) {
      this.uniformArray[6] = count;
      this.uniformArray[7] = size;
      this.needsUpdate = true;
      return true;
    }
    return false;
  }

  /**
   * Обновить состояние свечения
   */
  setGlowStrength(strength) {
    if (this.uniformArray[5] === strength) {
      return false;
    }
    this.uniformArray[5] = strength;
    this.needsUpdate = true;
    return true;
  }

  /**
   * Записать буфер в GPU если требуется
   */
  flush() {
    if (!this.needsUpdate || !this.buffer) return;
    this.device.queue.writeBuffer(this.buffer, 0, this.uniformArray);
    this.needsUpdate = false;
  }

  /**
   * Получить значение по индексу
   */
  getValue(index) {
    return this.uniformArray[index];
  }

  /**
   * Очистка ресурсов
   */
  cleanup() {
    if (this.buffer) {
      this.buffer.destroy();
      this.buffer = null;
    }
  }
}
