/**
 * Утилиты для работы с цветами
 */

/**
 * Конвертирует HEX цвет в RGB с компонентами от 0 до 1
 * @param {string} hex - HEX цвет (#ffffff)
 * @returns {{r: number, g: number, b: number}} RGB объект
 */
export function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized, 16);
  const r = ((bigint >> 16) & 255) / 255;
  const g = ((bigint >> 8) & 255) / 255;
  const b = (bigint & 255) / 255;
  return { r, g, b };
}

/**
 * Парсит CSS цвет (rgb, rgba, hex) в объект с компонентами
 * @param {string} value - CSS цвет
 * @returns {{r: number, g: number, b: number, a: number} | null}
 */
export function parseCssColor(value) {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'transparent') return null;

  // Парсинг rgb/rgba
  const rgbMatch = trimmed.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map((v) => v.trim());
    const r = Math.min(255, Math.max(0, parseFloat(parts[0])));
    const g = Math.min(255, Math.max(0, parseFloat(parts[1])));
    const b = Math.min(255, Math.max(0, parseFloat(parts[2])));
    const a = parts[3] !== undefined ? Math.min(1, Math.max(0, parseFloat(parts[3]))) : 1;
    return { r: r / 255, g: g / 255, b: b / 255, a };
  }

  // Парсинг HEX
  if (trimmed.startsWith('#')) {
    let hex = trimmed.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map((ch) => ch + ch).join('') + 'ff';
    } else if (hex.length === 4) {
      hex = hex.split('').map((ch) => ch + ch).join('');
    } else if (hex.length === 6) {
      hex = `${hex}ff`;
    } else if (hex.length !== 8) {
      return null;
    }

    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const a = parseInt(hex.slice(6, 8), 16) / 255;
    return { r, g, b, a };
  }

  return null;
}

/**
 * Вычисляет относительную яркость цвета (luminance) по стандарту WCAG
 * @param {{r: number, g: number, b: number}} color - RGB цвет (0-1)
 * @returns {number} Яркость от 0 до 1
 */
export function computeLuminance(color) {
  const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const r = srgbToLinear(color.r);
  const g = srgbToLinear(color.g);
  const b = srgbToLinear(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
