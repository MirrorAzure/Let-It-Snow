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
  const candidates = [document.body, document.documentElement];
  for (const el of candidates) {
    if (!el) continue;
    const styles = getComputedStyle(el);
    const parsed = parseCssColor(styles.backgroundColor);
    if (parsed && parsed.a > 0) {
      return parsed;
    }
  }
  // Белый по умолчанию
  return { r: 1, g: 1, b: 1, a: 1 };
}

/**
 * Класс для мониторинга изменений фона страницы
 */
export class BackgroundMonitor {
  constructor(onBackgroundChange) {
    this.onBackgroundChange = onBackgroundChange;
    this.observer = null;
    this.colorSchemeMedia = null;
  }

  /**
   * Запускает мониторинг фона
   */
  start() {
    this.stop();

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
