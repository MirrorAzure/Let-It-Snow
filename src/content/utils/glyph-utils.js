/**
 * Утилиты для работы с глифами (символами снежинок) и длинными предложениями
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

/**
 * Создает атлас текстур из длинных предложений
 * @param {string[]} sentences - Массив предложений для рендера
 * @param {number} cellSize - Размер ячейки (ширина и высота)
 * @returns {Promise<{canvas: HTMLCanvasElement, sentenceCount: number, isMonotone: boolean}>}
 */
export async function createSentenceAtlas(sentences, cellSize = 64) {
  if (!sentences || sentences.length === 0) {
    return {
      canvas: null,
      sentenceCount: 0,
      isMonotone: false,
      sentenceWidths: []
    };
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for sentence atlas');

  const sentenceCount = sentences.length;
  // Размещаем предложения вертикально, каждое в своей ячейке
  // Делаем atlas шире для многострочного текста
  const width = cellSize * 2;
  const height = cellSize * sentenceCount;

  canvas.width = width;
  canvas.height = height;

  // Настраиваем контекст
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Используем меньший шрифт для многострочного текста
  const fontSize = Math.floor(cellSize * 0.25);
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;

  // Рендерим каждое предложение с автоматическим переносом
  sentences.forEach((sentence, i) => {
    const yBase = i * cellSize;
    const centerX = width / 2;
    const centerY = yBase + cellSize / 2;
    
    // Разбиваем предложение на слова для переноса
    const words = sentence.split(' ');
    const lines = [];
    let currentLine = '';
    const maxWidth = width * 0.85; // 85% ширины atlas

    words.forEach((word) => {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    });
    
    if (currentLine) {
      lines.push(currentLine);
    }

    // Рендерим строки с равномерным распределением
    const lineHeight = fontSize * 1.2;
    const totalTextHeight = lines.length * lineHeight;
    const startY = centerY - totalTextHeight / 2 + lineHeight / 2;

    lines.forEach((line, lineIdx) => {
      const y = startY + lineIdx * lineHeight;
      ctx.fillText(line, centerX, y);
    });
  });

  // Предложения монотонные (белые), к ним применяется цвет снежинки
  return {
    canvas,
    sentenceCount,
    isMonotone: true,
    totalWidth: width,
    totalHeight: height
  };
}

/**
 * Создает комбинированный атлас глифов и предложений
 * @param {string[]} glyphs - Массив символов
 * @param {string[]} sentences - Массив предложений
 * @param {number} cellSize - Размер ячейки
 * @returns {Promise<{canvas: HTMLCanvasElement, glyphCount: number, sentenceCount: number, totalCount: number, isMonotone: boolean, glyphMonotoneFlags: boolean[]}>}
 */
export async function createCombinedAtlas(glyphs, sentences, cellSize) {
  const hasGlyphs = glyphs && glyphs.length > 0;
  const hasSentences = sentences && sentences.length > 0;

  if (!hasGlyphs && !hasSentences) {
    // Если ничего нет, используем дефолтную снежинку
    return await createGlyphAtlas(['❄'], cellSize);
  }

  // Создаем атласы отдельно
  const glyphResult = hasGlyphs ? await createGlyphAtlas(glyphs, cellSize) : null;
  const sentenceResult = hasSentences ? await createSentenceAtlas(sentences, cellSize) : null;

  const glyphCount = glyphResult ? glyphResult.glyphCount : 0;
  const sentenceCount = sentenceResult ? sentenceResult.sentenceCount : 0;
  const totalCount = glyphCount + sentenceCount;

  if (!hasSentences) {
    // Только глифы
    return {
      canvas: glyphResult.canvas,
      glyphCount,
      sentenceCount: 0,
      totalCount,
      isMonotone: glyphResult.isMonotone,
      glyphMonotoneFlags: glyphResult.glyphMonotoneFlags
    };
  }

  if (!hasGlyphs) {
    // Только предложения
    return {
      canvas: sentenceResult.canvas,
      glyphCount: 0,
      sentenceCount,
      totalCount,
      isMonotone: false,
      glyphMonotoneFlags: new Array(sentenceCount).fill(false)
    };
  }

  // Комбинируем оба атласа
  const combinedCanvas = document.createElement('canvas');
  const glyphWidth = glyphResult.canvas.width;
  const sentenceWidth = sentenceResult.canvas.width;
  const maxWidth = Math.max(glyphWidth, sentenceWidth);
  const totalHeight = glyphResult.canvas.height + sentenceResult.canvas.height;

  combinedCanvas.width = maxWidth;
  combinedCanvas.height = totalHeight;

  const ctx = combinedCanvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for combined atlas');

  // Рисуем глифы сверху
  ctx.drawImage(glyphResult.canvas, 0, 0);
  
  // Рисуем предложения снизу
  ctx.drawImage(sentenceResult.canvas, 0, glyphResult.canvas.height);

  // Комбинируем флаги монотонности
  const glyphMonotoneFlags = [
    ...glyphResult.glyphMonotoneFlags,
    ...new Array(sentenceCount).fill(false)
  ];

  return {
    canvas: combinedCanvas,
    glyphCount,
    sentenceCount,
    totalCount,
    isMonotone: false,
    glyphMonotoneFlags
  };
}

/**
 * Разделяет текст на более мелкие части
 * @param {string} text - Текст для разделения
 * @param {number} chunkSize - Размер части
 * @returns {string[]} Массив частей
 */
export function splitTextIntoChunks(text, chunkSize) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Разделяет предложения на более мелкие объекты
 * @param {string} text - Текст для разделения
 * @param {number} maxLength - Максимальная длина предложения
 * @returns {string[]} Массив частей
 */
export function splitSentences(text, maxLength) {
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const result = [];

  sentences.forEach((sentence) => {
    if (sentence.length <= maxLength) {
      result.push(sentence);
      return;
    }

    const words = sentence.split(/\s+/).filter(Boolean);
    let current = '';

    words.forEach((word) => {
      if (!current) {
        if (word.length > maxLength) {
          result.push(...splitTextIntoChunks(word, maxLength));
        } else {
          current = word;
        }
        return;
      }

      const testLine = `${current} ${word}`;
      if (testLine.length > maxLength) {
        result.push(current);
        if (word.length > maxLength) {
          result.push(...splitTextIntoChunks(word, maxLength));
          current = '';
        } else {
          current = word;
        }
      } else {
        current = testLine;
      }
    });

    if (current) {
      result.push(current);
    }
  });

  return result;
}
