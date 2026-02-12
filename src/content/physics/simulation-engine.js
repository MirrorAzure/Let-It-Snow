/**
 * Движок симуляции для WebGPU рендерера
 */

export class SimulationEngine {
  constructor(config = {}) {
    this.glyphCount = 0;
    this.sentenceCount = 0;
    this.sentenceCursor = 0;
    this.sentenceQueue = [];
  }

  /**
   * Инициализация движка симуляции
   */
  initialize(instances, atlasManager) {
    this.instances = instances;
    this.atlasManager = atlasManager;
    this.glyphCount = atlasManager.glyphAtlas.count || 0;
    this.sentenceCount = atlasManager.sentenceAtlas.count || 0;
  }

  /**
   * Обновить симуляцию для всех снежинок
   * @param {number} delta - Время с последнего кадра в секундах
   * @param {Float32Array} instanceData - Буфер данных снежинок
   * @param {object} mouseHandler - Обработчик мыши
   * @param {object} collisionHandler - Обработчик коллизий
   * @returns {boolean} true если данные изменились
   */
  updateSimulation(delta, instanceData, mouseHandler, collisionHandler) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const strideFloats = 14;
    let hasChanges = false;

    this.instances.forEach((flake, idx) => {
      // Применяем физику взаимодействия с мышью
      if (mouseHandler && !flake.isSkipped) {
        mouseHandler.applyMouseEffect(flake, delta);
      }

      // Применяем импульс к позиции
      flake.x += (flake.velocityX ?? 0) * delta;
      flake.y += (flake.velocityY ?? 0) * delta;
      
      // Затухание импульса (0.95 = 95% сохраняется каждую секунду)
      const damping = Math.pow(0.95, delta * 60);
      flake.velocityX = (flake.velocityX ?? 0) * damping;
      flake.velocityY = (flake.velocityY ?? 0) * damping;
      flake.rotationSpeed = (flake.rotationSpeed ?? 0) * damping;

      flake.phase = (flake.phase ?? 0) + (flake.freq ?? 0) * delta;
      
      // Собственное вращение снежинки
      const swayRotation = Math.cos(flake.phase) * (flake.freq ?? 0) * 0.5;
      flake.rotationSpeed = (flake.rotationSpeed ?? 0) + swayRotation * delta;
      
      flake.rotation = (flake.rotation ?? 0) + (flake.rotationSpeed ?? 0) * delta;
      flake.y += (flake.fallSpeed ?? 0) * delta;

      // Сброс позиции если снежинка вышла за экран
      if (flake.y - flake.size > height) {
        flake.y = -flake.size;
        flake.x = Math.random() * width;
        flake.phase = Math.random() * Math.PI * 2;
        flake.rotation = Math.random() * Math.PI * 2;
        flake.rotationSpeed = 0;
        flake.velocityX = 0;
        flake.velocityY = 0;

        if (flake.isSentence && this.sentenceCount > 0) {
          flake.sentenceIndex = this._nextSentenceIndex(this.sentenceCount);
          flake.glyphIndex = this.glyphCount + flake.sentenceIndex;
        }
      }

      // Запись данных в буфер
      const base = idx * strideFloats;
      instanceData[base + 0] = flake.x;
      instanceData[base + 1] = flake.y;
      instanceData[base + 2] = flake.size;
      instanceData[base + 3] = flake.fallSpeed;
      instanceData[base + 4] = flake.phase;
      instanceData[base + 5] = flake.freq;
      instanceData[base + 6] = flake.sway;
      instanceData[base + 7] = flake.rotation;
      instanceData[base + 8] = flake.rotationSpeed;
      instanceData[base + 9] = flake.color.r;
      instanceData[base + 10] = flake.color.g;
      instanceData[base + 11] = flake.color.b;
      instanceData[base + 12] = flake.glyphIndex;
      
      const monoFlag = this._getMonotoneFlag(flake.glyphIndex);
      instanceData[base + 13] = monoFlag;
      
      hasChanges = true;
    });
    
    // Обрабатываем коллизии между снежинками
    if (collisionHandler) {
      collisionHandler.handleCollisions(this.instances);
    }
    
    return hasChanges;
  }

  /**
   * Получить флаг монотонности для индекса глифа
   * @private
   */
  _getMonotoneFlag(glyphIndex) {
    if (!this.atlasManager) return 0;
    const monotoneFlags = this.atlasManager.getMonotoneFlags();
    return monotoneFlags?.[glyphIndex] ? 1 : 0;
  }

  /**
   * Получить следующий индекс предложения
   * @private
   */
  _nextSentenceIndex(sentenceCount) {
    if (!sentenceCount) return 0;
    const index = this.sentenceCursor % sentenceCount;
    this.sentenceCursor = (this.sentenceCursor + 1) % sentenceCount;
    return index;
  }

  /**
   * Перезагрузить конфигурацию
   */
  updateConfig(config) {
    if (config.sentenceQueue) {
      this.sentenceQueue = config.sentenceQueue;
    }
  }

  /**
   * Очистка
   */
  cleanup() {
    this.instances = [];
    this.sentenceQueue = [];
    this.sentenceCursor = 0;
  }
}
