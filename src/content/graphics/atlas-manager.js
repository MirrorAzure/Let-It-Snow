/**
 * Управление Атласами текстур для WebGPU рендерера
 */

import { createGlyphAtlas, createSentenceAtlas } from '../utils/glyph-utils.js';

export class AtlasManager {
  constructor(device, size = 64) {
    this.device = device;
    this.size = size;
    
    this.glyphAtlas = {
      texture: null,
      sampler: null,
      size: size,
      count: 1,
      monotoneFlags: [true],
      isMonotone: true,
      canvas: null
    };
    
    this.sentenceAtlas = {
      texture: null,
      sampler: null,
      size: size,
      count: 0,
      monotoneFlags: [],
      isMonotone: false,
      canvas: null
    };
  }

  /**
   * Инициализация атласов из конфигурации
   */
  async initialize(config) {
    const glyphs = this._extractGlyphs(config);
    const sentences = config.snowsentences && config.snowsentences.length > 0 
      ? config.snowsentences 
      : null;

    // Создание атласа глифов
    const glyphResult = await createGlyphAtlas(glyphs, this.size);
    this.glyphAtlas.count = glyphResult.glyphCount;
    this.glyphAtlas.monotoneFlags = glyphResult.glyphMonotoneFlags;
    this.glyphAtlas.isMonotone = glyphResult.isMonotone;
    this.glyphAtlas.canvas = glyphResult.canvas;
    await this._createAtlasTexture(this.glyphAtlas, 'glyph');

    // Создание атласа предложений (если есть)
    if (sentences) {
      const sentenceResult = await createSentenceAtlas(sentences, this.size);
      this.sentenceAtlas.count = sentenceResult.sentenceCount;
      this.sentenceAtlas.monotoneFlags = new Array(sentenceResult.sentenceCount).fill(true);
      this.sentenceAtlas.isMonotone = true;
      this.sentenceAtlas.canvas = sentenceResult.canvas;
      await this._createAtlasTexture(this.sentenceAtlas, 'sentence');
    } else {
      this.sentenceAtlas.canvas = null;
      this.sentenceAtlas.count = 0;
      this.sentenceAtlas.monotoneFlags = [];
      await this._createAtlasTexture(this.sentenceAtlas, 'sentence');
    }
  }

  /**
   * Извлечение глифов из конфигурации
   * @private
   */
  _extractGlyphs(config) {
    const hasGlyphs = config.snowletters && config.snowletters.length > 0;
    const useDefaultGlyph = !hasGlyphs && (!config.snowsentences || config.snowsentences.length === 0);
    
    if (hasGlyphs) return config.snowletters;
    if (useDefaultGlyph) return ['❄'];
    return [];
  }

  /**
   * Создание текстуры атласа
   * @private
   */
  async _createAtlasTexture(atlas, type) {
    const sourceCanvas = atlas.canvas || this._createFallbackCanvas();
    const bitmap = await createImageBitmap(sourceCanvas);

    if (atlas.texture) {
      atlas.texture.destroy();
    }

    const width = sourceCanvas.width;
    const height = sourceCanvas.height;

    atlas.texture = this.device.createTexture({
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
      label: `${type}Atlas`
    });

    this.device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: atlas.texture },
      { width, height }
    );

    atlas.sampler = this.device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      label: `${type}Sampler`
    });

    bitmap.close();
  }

  /**
   * Создание резервного прозрачного canvas 1x1
   * @private
   */
  _createFallbackCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, 1, 1);
    return canvas;
  }

  /**
   * Получить индекс глифа в атласе
   */
  getGlyphCount() {
    return this.glyphAtlas.count + this.sentenceAtlas.count;
  }

  /**
   * Получить все флаги монотонности
   */
  getMonotoneFlags() {
    return [
      ...this.glyphAtlas.monotoneFlags,
      ...this.sentenceAtlas.monotoneFlags
    ];
  }

  /**
   * Получить информацию об атласе для индекса глифа
   */
  getAtlasForGlyph(glyphIndex) {
    if (glyphIndex < this.glyphAtlas.count) {
      return {
        atlas: this.glyphAtlas,
        localIndex: glyphIndex,
        type: 'glyph'
      };
    } else {
      return {
        atlas: this.sentenceAtlas,
        localIndex: glyphIndex - this.glyphAtlas.count,
        type: 'sentence'
      };
    }
  }

  /**
   * Получить информацию об атласах
   */
  getInfo() {
    return {
      glyphs: {
        count: this.glyphAtlas.count,
        isMonotone: this.glyphAtlas.isMonotone,
        hasTexture: !!this.glyphAtlas.texture
      },
      sentences: {
        count: this.sentenceAtlas.count,
        isMonotone: this.sentenceAtlas.isMonotone,
        hasTexture: !!this.sentenceAtlas.texture
      },
      total: this.glyphAtlas.count + this.sentenceAtlas.count
    };
  }

  /**
   * Очистка ресурсов
   */
  cleanup() {
    if (this.glyphAtlas.texture) {
      this.glyphAtlas.texture.destroy();
      this.glyphAtlas.texture = null;
    }
    if (this.sentenceAtlas.texture) {
      this.sentenceAtlas.texture.destroy();
      this.sentenceAtlas.texture = null;
    }
    this.glyphAtlas.sampler = null;
    this.sentenceAtlas.sampler = null;
  }
}
