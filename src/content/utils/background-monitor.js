/**
 * Модуль для мониторинга фона страницы и автоматической регулировки свечения
 */

import { parseCssColor, computeLuminance } from './color-utils.js';

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Получает эффективный цвет фона страницы
 * @returns {{r: number, g: number, b: number, a: number}} RGB цвет фона
 */
export function getEffectiveBackgroundColor() {
  const candidates = [document.documentElement, document.body];
  const background = { r: 1, g: 1, b: 1, a: 1 };
  for (const el of candidates) {
    if (!el) continue;
    const styles = getComputedStyle(el);
    const parsed = parseCssColor(styles.backgroundColor);
    if (!parsed || parsed.a <= 0) continue;
    background.r = parsed.r * parsed.a + background.r * (1 - parsed.a);
    background.g = parsed.g * parsed.a + background.g * (1 - parsed.a);
    background.b = parsed.b * parsed.a + background.b * (1 - parsed.a);
  }
  return background;
}

function getBackgroundSignature() {
  const { r, g, b } = getEffectiveBackgroundColor();
  return `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`;
}

/**
 * Класс для мониторинга изменений фона страницы
 */
export class BackgroundMonitor {
  /**
   * @param {Function} onBackgroundChange
   * @param {{pollIntervalMs?: number}} [options] Polling catches stylesheet swaps and CSS
   *   transitions that do not touch html/body attributes; 0 disables it.
   */
  constructor(onBackgroundChange, options = {}) {
    this.onBackgroundChange = onBackgroundChange;
    this.observer = null;
    this.colorSchemeMedia = null;
    const interval = Number(options.pollIntervalMs ?? 1000);
    this.pollIntervalMs = Number.isFinite(interval) && interval > 0 ? Math.max(100, interval) : 0;
    this.pollTimer = null;
    this.lastSignature = '';
    this.handleTransitionEnd = (event) => {
      if (event.target === document.documentElement || event.target === document.body) {
        this.checkForChange();
      }
    };
  }

  /** Notifies the listener only when the composited background actually changed. */
  checkForChange() {
    const signature = getBackgroundSignature();
    if (signature === this.lastSignature) return false;
    this.lastSignature = signature;
    this.onBackgroundChange?.();
    return true;
  }

  /**
   * Запускает мониторинг фона
   */
  start() {
    this.stop();
    this.lastSignature = getBackgroundSignature();

    // Наблюдаем за изменениями атрибутов class и style
    if (typeof MutationObserver === 'function') {
      const observer = new MutationObserver(this.onBackgroundChange);
      [document.body, document.documentElement].forEach((el) => {
        if (!el) return;
        observer.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
      });
      this.observer = observer;
    }

    // Следим за изменением цветовой схемы (светлая/темная)
    if (typeof window !== 'undefined' && window.matchMedia) {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      media.addEventListener('change', this.onBackgroundChange);
      this.colorSchemeMedia = media;
    }

    document.addEventListener('transitionend', this.handleTransitionEnd, true);
    if (this.pollIntervalMs) {
      this.pollTimer = setInterval(() => {
        if (!document.hidden) this.checkForChange();
      }, this.pollIntervalMs);
    }
  }

  /**
   * Останавливает мониторинг
   */
  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.colorSchemeMedia && this.onBackgroundChange) {
      this.colorSchemeMedia.removeEventListener('change', this.onBackgroundChange);
      this.colorSchemeMedia = null;
    }
    document.removeEventListener('transitionend', this.handleTransitionEnd, true);
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Вычисляет нужную силу свечения на основе фона
   * @param {number} minStrength - Минимальная сила glow даже на светлом фоне
   * @param {number} maxStrength - Максимальная сила glow на темном фоне
   * @returns {number} Сила свечения от minStrength до maxStrength
   */
  calculateGlowStrength(minStrength = 0.42, maxStrength = 1) {
    const bg = getEffectiveBackgroundColor();
    const luminance = computeLuminance(bg);
    const minValue = clamp01(minStrength);
    const maxValue = clamp01(Math.max(minValue, maxStrength));
    const lightnessFactor = smoothstep(0.2, 0.95, luminance);
    return maxValue + (minValue - maxValue) * lightnessFactor;
  }
}
