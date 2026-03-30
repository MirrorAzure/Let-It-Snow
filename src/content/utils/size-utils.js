/**
 * Utilities for converting configured glyph size percentages into viewport-relative pixels.
 */

const DEFAULT_MIN_SIZE_PERCENT = 2.0;
const DEFAULT_MAX_SIZE_PERCENT = 4.0;
const LEGACY_PIXEL_THRESHOLD = 6;
const MIN_PERCENT = 2;
const MAX_PERCENT = 10;
const MIN_PERCENT_GAP = 0.1;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function sanitizeViewportSide(value, fallback) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  return fallback;
}

export function getCanvasBaseSize() {
  const canvas = document.getElementById('let-it-snow-webgpu-canvas');
  if (canvas) {
    const rect = canvas.getBoundingClientRect();
    const width = Number(rect.width) || 0;
    const height = Number(rect.height) || 0;
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      return Math.max(1, Math.min(width, height));
    }
  }
  return null;
}

export function getViewportBaseSize() {
  // Сначала пробуем получить размер canvas'а
  const canvasBase = getCanvasBaseSize();
  if (canvasBase !== null) {
    return canvasBase;
  }

  // Fallback на viewport если canvas еще не создан
  const visualViewportWidth = Number(window?.visualViewport?.width);
  const visualViewportHeight = Number(window?.visualViewport?.height);
  const width = sanitizeViewportSide(
    visualViewportWidth,
    Number(window?.innerWidth) || Number(document?.documentElement?.clientWidth) || 1920
  );
  const height = sanitizeViewportSide(
    visualViewportHeight,
    Number(window?.innerHeight) || Number(document?.documentElement?.clientHeight) || 1080
  );

  return Math.max(1, Math.min(width, height));
}

function toPercentValue(value, fallbackPercent, baseSize) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallbackPercent;
  }

  const asPercent = numeric > LEGACY_PIXEL_THRESHOLD
    ? (numeric / baseSize) * 100
    : numeric;

  return clamp(asPercent, MIN_PERCENT, MAX_PERCENT);
}

export function normalizeGlyphSizePercentRange(rawMin, rawMax, viewportBaseSize = getViewportBaseSize()) {
  const minPercent = toPercentValue(rawMin, DEFAULT_MIN_SIZE_PERCENT, viewportBaseSize);
  const maxPercent = toPercentValue(rawMax, DEFAULT_MAX_SIZE_PERCENT, viewportBaseSize);

  if (maxPercent <= minPercent) {
    return {
      minPercent,
      maxPercent: clamp(minPercent + MIN_PERCENT_GAP, minPercent + MIN_PERCENT_GAP, MAX_PERCENT)
    };
  }

  return { minPercent, maxPercent };
}

export function resolveGlyphSizeRangePx(config = {}) {
  const viewportBaseSize = getViewportBaseSize();
  const { minPercent, maxPercent } = normalizeGlyphSizePercentRange(
    config.snowminsize,
    config.snowmaxsize,
    viewportBaseSize
  );

  return {
    minPercent,
    maxPercent,
    minPx: (minPercent / 100) * viewportBaseSize,
    maxPx: (maxPercent / 100) * viewportBaseSize,
    viewportBaseSize
  };
}
