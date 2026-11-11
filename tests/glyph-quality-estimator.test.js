import { describe, it, expect, vi, afterEach } from 'vitest';

import * as glyphQualityEstimator from '../src/content/utils/glyph-quality-estimator.js';

describe('shouldUseSdfGlyphAtlas', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores emoji entries when deciding whether to enable SDF glyphs', () => {
    const originalCreateElement = document.createElement.bind(document);
    let currentGlyph = '❄';

    vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
      if (tagName !== 'canvas') {
        return originalCreateElement(tagName);
      }

      return {
        width: 0,
        height: 0,
        getContext: vi.fn().mockReturnValue({
          clearRect: vi.fn(),
          measureText: vi.fn().mockReturnValue({
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: 100,
            actualBoundingBoxAscent: 100,
            actualBoundingBoxDescent: 0,
            width: 100
          }),
          fillText: vi.fn((glyph) => {
            currentGlyph = glyph;
          }),
          getImageData: vi.fn((x, y, width, height) => {
            const data = new Uint8ClampedArray(width * height * 4);

            if (currentGlyph === '🌸') {
              for (let row = 0; row < height; row += 1) {
                for (let col = 0; col < width; col += 1) {
                  if ((row + col) % 3 === 0) {
                    const idx = (row * width + col) * 4;
                    data[idx + 3] = 255;
                  }
                }
              }
              return { data };
            }

            const startX = Math.floor(width * 0.25);
            const endX = Math.floor(width * 0.75);
            const startY = Math.floor(height * 0.25);
            const endY = Math.floor(height * 0.75);
            for (let row = startY; row < endY; row += 1) {
              for (let col = startX; col < endX; col += 1) {
                const idx = (row * width + col) * 4;
                data[idx + 3] = 255;
              }
            }
            return { data };
          })
        })
      };
    });

    const result = glyphQualityEstimator.shouldUseSdfGlyphAtlas({
      glyphs: [
        { char: 'A', mode: 'text' },
        { char: '🌸', mode: 'emoji' }
      ],
      targetRenderSize: 24
    });

    expect(result).toBe(true);
  });
});

describe('estimateGlyphAtlasCellSize', () => {
  it('allows larger glyph atlases for large rendered snowflakes', () => {
    const size = glyphQualityEstimator.estimateGlyphAtlasCellSize({
      glyphs: ['❄'],
      targetRenderSize: 400,
      maxTextureDimension2D: 4096
    });

    expect(size).toBeGreaterThan(1024);
    expect(size).toBeLessThanOrEqual(2048);
  });

  it('keeps glyph cells within the texture dimension available per glyph', () => {
    const size = glyphQualityEstimator.estimateGlyphAtlasCellSize({
      glyphs: ['❄', '✦', '✧', '❅'],
      targetRenderSize: 400,
      maxTextureDimension2D: 2048
    });

    expect(size * 4).toBeLessThanOrEqual(2048);
  });
});