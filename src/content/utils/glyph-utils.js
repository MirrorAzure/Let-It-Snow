/**
 * Утилиты для работы с глифами (символами снежинок)
 */

/**
 * Проверяет, является ли ячейка атласа монотонной (один цвет)
 * @param {Uint8ClampedArray} data - Массив пикселей ImageData
 * @param {number} atlasWidth - Ширина атласа
 * @param {number} startX - Начальная X координата ячейки
 * @param {number} startY - Начальная Y координата ячейки
 * @param {number} width - Ширина ячейки
 * @param {number} height - Высота ячейки
 * @returns {boolean} true если все непрозрачные пиксели одного цвета
 */
export function isCellMonotone(data, atlasWidth, startX, startY, width, height) {
  let firstColor = null;
  let foundNonTransparent = false;

  const tolerance = 5;

  // Находим первый непрозрачный пиксель в указанной ячейке
  for (let y = startY; y < startY + height; y += 1) {
    const rowStart = y * atlasWidth * 4;
    for (let x = startX; x < startX + width; x += 1) {
      const idx = rowStart + x * 4;
      const a = data[idx + 3];
      if (a > 0) {
        firstColor = [data[idx], data[idx + 1], data[idx + 2]];
        foundNonTransparent = true;
        break;
      }
    }
    if (foundNonTransparent) break;
  }

  if (!foundNonTransparent) return true;

  // Проверяем все остальные непрозрачные пиксели на расхождение цвета
  for (let y = startY; y < startY + height; y += 1) {
    const rowStart = y * atlasWidth * 4;
    for (let x = startX; x < startX + width; x += 1) {
      const idx = rowStart + x * 4;
      const a = data[idx + 3];
      if (a > 0) {
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        if (
          Math.abs(r - firstColor[0]) > tolerance ||
          Math.abs(g - firstColor[1]) > tolerance ||
          Math.abs(b - firstColor[2]) > tolerance
        ) {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Вычисляет флаги монотонности для каждого глифа в атласе
 * @param {ImageData} imageData - Данные изображения атласа
 * @param {number} atlasWidth - Ширина атласа
 * @param {number} atlasHeight - Высота атласа
 * @param {number} cellSize - Размер одной ячейки глифа
 * @param {number} glyphCount - Количество глифов
 * @returns {boolean[]} Массив флагов монотонности для каждого глифа
 */
export function computeGlyphMonotoneFlags(imageData, atlasWidth, atlasHeight, cellSize, glyphCount) {
  const data = imageData.data;
  if (!data?.length || atlasWidth <= 0 || atlasHeight <= 0) {
    return new Array(glyphCount).fill(false);
  }

  const flags = new Array(glyphCount).fill(true);

  for (let glyphIdx = 0; glyphIdx < glyphCount; glyphIdx += 1) {
    const startX = glyphIdx * cellSize;
    const startY = 0;
    flags[glyphIdx] = isCellMonotone(data, atlasWidth, startX, startY, cellSize, cellSize);
  }

  return flags;
}

/**
 * Создает атлас текстур из символов
 * @param {string[]} glyphs - Массив символов для рендера
 * @param {number} cellSize - Размер одной ячейки
 * @returns {Promise<{canvas: HTMLCanvasElement, glyphCount: number, isMonotone: boolean, glyphMonotoneFlags: boolean[]}>}
 */
export async function createGlyphAtlas(glyphs, cellSize) {
  const glyphCount = Math.max(1, glyphs.length);
  const width = cellSize * glyphCount;
  const height = cellSize;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for glyph atlas');

  // Очищаем и настраиваем контекст
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `bold ${Math.floor(cellSize * 0.7)}px serif`;

  // Рендерим каждый глиф по центру своей ячейки
  glyphs.forEach((g, i) => {
    const metrics = ctx.measureText(g);
    const left = metrics.actualBoundingBoxLeft || 0;
    const right = metrics.actualBoundingBoxRight || 0;
    const ascent = metrics.actualBoundingBoxAscent || 0;
    const descent = metrics.actualBoundingBoxDescent || 0;
    const centerX = i * cellSize + cellSize / 2;
    const centerY = height / 2;
    const x = centerX - (right - left) / 2;
    const y = centerY + (ascent - descent) / 2;
    ctx.fillText(g, x, y);
  });

  // Проверка монотонности по каждому глифу отдельно
  let glyphMonotoneFlags = new Array(glyphCount).fill(false);
  let isMonotone = false;
  try {
    const imageData = ctx.getImageData(0, 0, width, height);
    glyphMonotoneFlags = computeGlyphMonotoneFlags(imageData, width, height, cellSize, glyphCount);
    isMonotone = glyphMonotoneFlags.every(Boolean);
  } catch (e) {
    // getImageData может не поддерживаться в тестовом окружении
    glyphMonotoneFlags = new Array(glyphCount).fill(false);
    isMonotone = false;
  }

  return { canvas, glyphCount, isMonotone, glyphMonotoneFlags };
}
