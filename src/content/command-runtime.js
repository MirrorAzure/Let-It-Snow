/**
 * Исполнитель команд внешнего API.
 *
 * Эффекты (burst / glyphs / gif) создаются как отдельные временные слои поверх
 * основного снегопада, поэтому основной снег не перезапускается. Ветер
 * переопределяется на всех слоях сразу и восстанавливается по таймеру.
 * Команды должны быть заранее проверены через validateCommand().
 */

import { LIMITS } from '../api/command-protocol.js';
import { SnowWebGPUController, DEFAULT_CONFIG } from './snow-controller.js';

const EFFECT_OVERLAY_PREFIX = 'let-it-snow-effect-';
// `instant` packs every flake into a narrow band above the viewport so the whole
// burst enters from the top at once instead of trickling in over a full screen height.
const INSTANT_ENTRY_SPAWN_SPAN_RATIO = 0.35;
const FADE_OUT_MS = 700;

let layerSequence = 0;

const pickVisualBase = (config = {}) => ({
  snowminsize: config.snowminsize ?? DEFAULT_CONFIG.snowminsize,
  snowmaxsize: config.snowmaxsize ?? DEFAULT_CONFIG.snowmaxsize,
  snowcolor: Array.isArray(config.snowcolor) && config.snowcolor.length
    ? config.snowcolor
    : DEFAULT_CONFIG.snowcolor,
  snowletters: Array.isArray(config.snowletters) && config.snowletters.length
    ? config.snowletters
    : DEFAULT_CONFIG.snowletters,
  snowglyphmodes: Array.isArray(config.snowglyphmodes) ? config.snowglyphmodes : ['text'],
  rendererMode: config.rendererMode ?? 'auto',
  snow3dThickness: config.snow3dThickness ?? DEFAULT_CONFIG.snow3dThickness,
  minGlowStrength: config.minGlowStrength ?? DEFAULT_CONFIG.minGlowStrength,
  mouseRadius: config.mouseRadius ?? DEFAULT_CONFIG.mouseRadius,
  windEnabled: Boolean(config.windEnabled),
  windDirection: config.windDirection ?? DEFAULT_CONFIG.windDirection,
  windStrength: config.windStrength ?? DEFAULT_CONFIG.windStrength,
  windGustFrequency: config.windGustFrequency ?? DEFAULT_CONFIG.windGustFrequency
});

export class SnowCommandRuntime {
  /**
   * @param {Object} hooks
   * @param {() => SnowWebGPUController|null} hooks.getMainController
   * @param {(config: Object) => Promise<void>} hooks.startMain
   * @param {() => void} hooks.stopMain
   * @param {(overrides: Object) => Promise<Object>|Object} [hooks.resolveStartConfig]
   * @param {(config: Object, options: Object) => SnowWebGPUController} [hooks.createController]
   * @param {boolean} [hooks.allowBackgroundGifFetch=true]
   */
  constructor(hooks = {}) {
    this.getMainController = hooks.getMainController || (() => null);
    this.startMain = hooks.startMain || (async () => {});
    this.stopMain = hooks.stopMain || (() => {});
    this.resolveStartConfig = hooks.resolveStartConfig || ((overrides) => ({ ...overrides }));
    this.createController = hooks.createController
      || ((config, options) => new SnowWebGPUController(config, options));
    this.allowBackgroundGifFetch = hooks.allowBackgroundGifFetch !== false;
    this.layers = [];
    this.windOverride = null;
    this.windTimer = null;
    this.isPaused = false;
  }

  get effectCount() {
    return this.layers.length;
  }

  /**
   * @param {{command: string, params: Object, id?: string|null}} command - проверенная команда
   * @param {{source?: string}} [context]
   */
  async execute(command, context = {}) {
    const source = context.source || 'extension';
    const params = command?.params || {};
    switch (command?.command) {
      case 'ping':
        return { ok: true, pong: true, effects: this.layers.length, running: Boolean(this.getMainController()) };
      case 'start': {
        const config = await this.resolveStartConfig(params.config || {});
        await this.startMain(config);
        this._applyWindToAll();
        return { ok: true };
      }
      case 'stop':
        this.clearEffects();
        this.stopMain();
        return { ok: true };
      case 'clearEffects':
        this.clearEffects();
        return { ok: true };
      case 'wind':
        this.setWind(params);
        return { ok: true };
      case 'burst':
        return this._addLayer(this._buildSnowLayerConfig({
          count: params.count,
          speed: params.speed,
          symbols: params.symbols,
          colors: params.colors,
          entry: params.entry
        }), params.durationMs, { source });
      case 'glyphs':
        return this._addLayer(this._buildSnowLayerConfig({
          count: params.count,
          speed: params.speed,
          symbols: params.symbols,
          glyphMode: params.glyphMode,
          colors: params.colors,
          entry: params.entry
        }), params.durationMs, { source });
      case 'gif':
        return this._addLayer(this._buildGifLayerConfig(params, source), params.durationMs, {
          source,
          renderSnow: false
        });
      default:
        return { ok: false, error: 'unknown_command' };
    }
  }

  _baseConfig() {
    return pickVisualBase(this.getMainController()?.config || DEFAULT_CONFIG);
  }

  _windConfig(base) {
    if (!this.windOverride) return {};
    return {
      windEnabled: this.windOverride.enabled,
      windDirection: this.windOverride.direction,
      windStrength: this.windOverride.strength,
      windGustFrequency: this.windOverride.gustFrequency
    };
  }

  _buildSnowLayerConfig({ count, speed, symbols, glyphMode, colors, entry }) {
    const base = this._baseConfig();
    const hasSymbols = Array.isArray(symbols) && symbols.length > 0;
    const letters = hasSymbols ? symbols : base.snowletters;
    const instant = entry === 'instant';
    const rendererMode = base.rendererMode === '3d' && count <= 320 ? '3d' : 'auto';
    return {
      ...base,
      ...this._windConfig(base),
      rendererMode,
      snowmax: count,
      sinkspeed: speed,
      snowletters: letters,
      snowglyphmodes: hasSymbols
        ? letters.map(() => glyphMode || 'text')
        : base.snowglyphmodes,
      snowcolor: Array.isArray(colors) && colors.length ? colors : base.snowcolor,
      snowsentences: [],
      sentenceCount: 0,
      gifUrls: [],
      gifCount: 0,
      initialTimeOffsetSeconds: 0,
      initialSpawnSpanRatio: instant ? INSTANT_ENTRY_SPAWN_SPAN_RATIO : undefined,
      canvas2dInitialActiveFlakes: count,
      canvas2dMaxRespawnsPerSecond: Math.max(90, count),
      canvas2dMaxRespawnBurst: Math.max(16, Math.ceil(count / 4))
    };
  }

  _buildGifLayerConfig(params, source) {
    const base = this._baseConfig();
    return {
      ...base,
      ...this._windConfig(base),
      snowmax: 1,
      sinkspeed: params.speed,
      snowsentences: [],
      sentenceCount: 0,
      gifUrls: params.urls,
      gifCount: params.count,
      gifInitialVisibleRatio: params.entry === 'instant' ? 1 : 0.35,
      initialTimeOffsetSeconds: 0,
      initialSpawnSpanRatio: params.entry === 'instant' ? INSTANT_ENTRY_SPAWN_SPAN_RATIO : undefined,
      // Команды со страницы не используют привилегированную загрузку через background:
      // GIF загружается с правами самой страницы (её CORS/CSP).
      useBackgroundGifFetch: this.allowBackgroundGifFetch && source !== 'page'
    };
  }

  async _addLayer(config, durationMs, { source, renderSnow = true } = {}) {
    while (this.layers.length >= LIMITS.maxEffectLayers) {
      this._removeLayer(this.layers[0], { fade: false });
    }

    const id = `${EFFECT_OVERLAY_PREFIX}${++layerSequence}`;
    const controller = this.createController(config, {
      overlayId: id,
      gifLayerId: `${id}-gif`,
      renderSnow,
      mouseInteraction: true,
      windSource: () => this.getMainController()?.renderer || null
    });
    const layer = { id, controller, timer: null, source };
    this.layers.push(layer);

    try {
      await controller.start();
    } catch (error) {
      this._removeLayer(layer, { fade: false });
      return { ok: false, error: error?.message || 'effect_start_failed' };
    }

    if (!this.layers.includes(layer)) return { ok: false, error: 'effect_cancelled' };
    if (this.windOverride) controller.applyWindOverride?.(this.windOverride);
    if (this.isPaused) controller.pauseAnimations?.();

    layer.timer = setTimeout(() => this._removeLayer(layer, { fade: true }), durationMs);
    return { ok: true, effectId: id };
  }

  _removeLayer(layer, { fade = true } = {}) {
    const index = this.layers.indexOf(layer);
    if (index === -1) return;
    this.layers.splice(index, 1);
    if (layer.timer) clearTimeout(layer.timer);
    if (fade && typeof layer.controller.fadeOutAndDestroy === 'function') {
      layer.controller.fadeOutAndDestroy(FADE_OUT_MS);
    } else {
      layer.controller.destroy();
    }
  }

  clearEffects() {
    [...this.layers].forEach((layer) => this._removeLayer(layer, { fade: false }));
    this.setWind(null);
  }

  /**
   * @param {{enabled: boolean, direction: string, strength: number, gustFrequency: number, durationMs: number}|null} params
   */
  setWind(params) {
    if (this.windTimer) {
      clearTimeout(this.windTimer);
      this.windTimer = null;
    }
    this.windOverride = params
      ? {
          enabled: params.enabled !== false,
          direction: params.direction,
          strength: params.strength,
          gustFrequency: params.gustFrequency
        }
      : null;
    this._applyWindToAll();
    if (params && params.durationMs > 0) {
      this.windTimer = setTimeout(() => this.setWind(null), params.durationMs);
    }
  }

  _applyWindToAll() {
    this.getMainController()?.applyWindOverride?.(this.windOverride);
    this.layers.forEach((layer) => layer.controller.applyWindOverride?.(this.windOverride));
  }

  pauseAll() {
    this.isPaused = true;
    this.layers.forEach((layer) => layer.controller.pauseAnimations?.());
  }

  resumeAll() {
    this.isPaused = false;
    this.layers.forEach((layer) => layer.controller.resumeAnimations?.());
  }

  destroy() {
    this.clearEffects();
  }
}
