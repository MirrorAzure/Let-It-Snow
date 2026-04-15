import { configureGlyphTextContext, drawGlyphToCell } from './glyph-utils.js';

function roundUpToStep(value, step = 16) {
  return Math.ceil(value / step) * step;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createProbeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function findAlphaBounds(data, width, height, threshold = 8) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const alpha = data[rowOffset + x * 4 + 3];
      if (alpha < threshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

function buildBinaryMask(data, width, height, threshold = 96) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    const maskOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      const alpha = data[rowOffset + x * 4 + 3];
      mask[maskOffset + x] = alpha >= threshold ? 1 : 0;
    }
  }
  return mask;
}

function countEdgeTransitions(mask, width, height, bounds) {
  if (!bounds) return 0;
  let transitions = 0;

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    let prev = mask[y * width + bounds.minX];
    for (let x = bounds.minX + 1; x <= bounds.maxX; x += 1) {
      const current = mask[y * width + x];
      if (current !== prev) transitions += 1;
      prev = current;
    }
  }

  for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
    let prev = mask[bounds.minY * width + x];
    for (let y = bounds.minY + 1; y <= bounds.maxY; y += 1) {
      const current = mask[y * width + x];
      if (current !== prev) transitions += 1;
      prev = current;
    }
  }

  return transitions;
}

function countInteriorHoles(mask, width, height, bounds) {
  if (!bounds) return 0;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let holeCount = 0;

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const startIndex = y * width + x;
      if (visited[startIndex] || mask[startIndex] === 1) continue;

      let head = 0;
      let tail = 0;
      let touchesBorder = false;
      visited[startIndex] = 1;
      queue[tail++] = startIndex;

      while (head < tail) {
        const index = queue[head++];
        const currentX = index % width;
        const currentY = Math.floor(index / width);

        if (
          currentX === bounds.minX ||
          currentX === bounds.maxX ||
          currentY === bounds.minY ||
          currentY === bounds.maxY
        ) {
          touchesBorder = true;
        }

        const neighbors = [
          index - 1,
          index + 1,
          index - width,
          index + width
        ];

        for (let i = 0; i < neighbors.length; i += 1) {
          const nextIndex = neighbors[i];
          if (nextIndex < 0 || nextIndex >= mask.length) continue;
          const nextX = nextIndex % width;
          const nextY = Math.floor(nextIndex / width);
          if (
            nextX < bounds.minX || nextX > bounds.maxX ||
            nextY < bounds.minY || nextY > bounds.maxY ||
            visited[nextIndex] || mask[nextIndex] === 1
          ) {
            continue;
          }
          visited[nextIndex] = 1;
          queue[tail++] = nextIndex;
        }
      }

      if (!touchesBorder) {
        holeCount += 1;
      }
    }
  }

  return holeCount;
}

function computeMinimumStrokeWidth(mask, width, height, bounds) {
  if (!bounds) return 0;

  let minRun = Infinity;

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    let currentRun = 0;
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const filled = mask[y * width + x] === 1;
      if (filled) {
        currentRun += 1;
      } else if (currentRun > 0) {
        minRun = Math.min(minRun, currentRun);
        currentRun = 0;
      }
    }
    if (currentRun > 0) {
      minRun = Math.min(minRun, currentRun);
    }
  }

  for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
    let currentRun = 0;
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      const filled = mask[y * width + x] === 1;
      if (filled) {
        currentRun += 1;
      } else if (currentRun > 0) {
        minRun = Math.min(minRun, currentRun);
        currentRun = 0;
      }
    }
    if (currentRun > 0) {
      minRun = Math.min(minRun, currentRun);
    }
  }

  return Number.isFinite(minRun) ? minRun : 0;
}

export function analyzeGlyphComplexity(glyph, targetRenderSize = 24) {
  const probeSize = clamp(roundUpToStep(Math.max(192, targetRenderSize * 10), 32), 192, 768);
  const canvas = createProbeCanvas(probeSize);
  const ctx = canvas.getContext('2d');

  if (!ctx || typeof ctx.getImageData !== 'function' || typeof ctx.measureText !== 'function') {
    return {
      glyph,
      score: 1,
      holeCount: 0,
      transitionDensity: 0,
      coverage: 0.5,
      minStrokeRatio: 0.16
    };
  }

  ctx.clearRect(0, 0, probeSize, probeSize);
  ctx.fillStyle = '#fff';
  configureGlyphTextContext(ctx, probeSize, glyph);
  drawGlyphToCell(ctx, glyph, 0, probeSize, probeSize);

  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, probeSize, probeSize);
  } catch {
    return {
      glyph,
      score: 1,
      holeCount: 0,
      transitionDensity: 0.35,
      coverage: 0.5,
      minStrokeRatio: 0.16
    };
  }

  const bounds = findAlphaBounds(imageData.data, probeSize, probeSize);
  if (!bounds) {
    return {
      glyph,
      score: 1,
      holeCount: 0,
      transitionDensity: 0,
      coverage: 0,
      minStrokeRatio: 0
    };
  }

  const mask = buildBinaryMask(imageData.data, probeSize, probeSize, 72);
  const filledPixels = mask.reduce((sum, pixel) => sum + pixel, 0);
  const boundsArea = Math.max(1, bounds.width * bounds.height);
  const coverage = filledPixels / boundsArea;
  const transitions = countEdgeTransitions(mask, probeSize, probeSize, bounds);
  const holeCount = countInteriorHoles(mask, probeSize, probeSize, bounds);
  const minStrokeWidth = computeMinimumStrokeWidth(mask, probeSize, probeSize, bounds);
  const minStrokeRatio = minStrokeWidth / Math.max(1, Math.min(bounds.width, bounds.height));
  const perimeterScale = Math.max(1, (bounds.width + bounds.height) * 2);
  const transitionDensity = transitions / perimeterScale;
  const thinCoverageBoost = coverage < 0.33 ? 0.22 : 0;
  const thinStrokeBoost = clamp((0.16 - minStrokeRatio) * 3.4, 0, 0.9);
  const holeBoost = Math.min(4, holeCount) * 0.28;
  const transitionBoost = clamp(transitionDensity * 0.22, 0, 1.0);
  const score = 1 + thinCoverageBoost + thinStrokeBoost + holeBoost + transitionBoost;

  return {
    glyph,
    score,
    holeCount,
    transitionDensity,
    coverage,
    minStrokeRatio
  };
}

export function estimateGlyphAtlasCellSize({
  glyphs = [],
  targetRenderSize = 24,
  devicePixelRatio = 1,
  maxTextureDimension2D = 4096,
  sentenceCount = 0,
  minCellSize = 64,
  maxCellSize = 1024
} = {}) {
  const normalizedGlyphs = Array.isArray(glyphs) && glyphs.length > 0 ? glyphs : ['❄'];
  const normalizedTargetSize = Math.max(12, Number(targetRenderSize) || 24);
  const dpr = Math.max(1, Number(devicePixelRatio) || 1);
  const maxByGlyphAtlas = Math.floor(maxTextureDimension2D / Math.max(1, normalizedGlyphs.length));
  const maxBySentenceAtlas = Math.floor(maxTextureDimension2D / Math.max(2, sentenceCount || 1));
  const maxSafeCell = Math.max(minCellSize, Math.min(maxCellSize, maxByGlyphAtlas, maxBySentenceAtlas));

  const analyses = normalizedGlyphs.map((glyph) => analyzeGlyphComplexity(glyph, normalizedTargetSize));
  const peakScore = analyses.reduce((max, item) => Math.max(max, item.score), 1);
  const averageScore = analyses.reduce((sum, item) => sum + item.score, 0) / analyses.length;
  const minStrokeRatio = analyses.reduce((min, item) => Math.min(min, item.minStrokeRatio), 1);
  const hasInteriorHoles = analyses.some((item) => item.holeCount > 0);
  const qualityScore = Math.max(
    peakScore,
    averageScore * 1.12,
    hasInteriorHoles ? 1.55 : 1,
    minStrokeRatio < 0.08 ? 1.75 : 1
  );

  const baseScale = 5.4;
  const dprScale = Math.min(2.75, dpr);
  const baseSize = Math.max(160, normalizedTargetSize * baseScale, 112 * dprScale);
  const detailAdjustedSize = baseSize * qualityScore;

  return clamp(roundUpToStep(detailAdjustedSize, 16), minCellSize, maxSafeCell);
}

export function shouldUseSdfGlyphAtlas({
  glyphs = [],
  targetRenderSize = 24
} = {}) {
  const sourceGlyphs = Array.isArray(glyphs) && glyphs.length > 0 ? glyphs : ['❄'];
  const normalizedGlyphs = sourceGlyphs
    .map((entry) => {
      if (typeof entry === 'string') {
        const char = String(entry || '').trim();
        return char ? { char, mode: 'text' } : null;
      }

      if (entry && typeof entry === 'object') {
        const char = String(entry.char || entry.symbol || '').trim();
        if (!char) return null;
        return {
          char,
          mode: entry.mode === 'emoji' || entry.renderMode === 'emoji' ? 'emoji' : 'text'
        };
      }

      return null;
    })
    .filter(Boolean);

  const sdfCandidates = normalizedGlyphs
    .filter((entry) => entry.mode !== 'emoji')
    .map((entry) => entry.char);

  if (sdfCandidates.length === 0) {
    return false;
  }

  const analyses = sdfCandidates.map((glyph) => analyzeGlyphComplexity(glyph, targetRenderSize));

  return !analyses.some((item) => (
    item.holeCount > 0 ||
    item.minStrokeRatio < 0.085 ||
    item.transitionDensity > 0.72
  ));
}