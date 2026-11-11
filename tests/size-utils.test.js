import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeGlyphSizePercentRange, resolveInitialViewportX, resolveInitialViewportY } from '../src/content/utils/size-utils.js';

describe('size-utils normalization', () => {
  const originalGetElementById = document.getElementById;

  beforeEach(() => {
    vi.spyOn(document, 'getElementById').mockImplementation(() => null);
  });

  afterEach(() => {
    document.getElementById = originalGetElementById;
    vi.restoreAllMocks();
  });

  it('keeps configured percent range within 2-10 as percents', () => {
    const result = normalizeGlyphSizePercentRange(7.2, 9.6, 1000);

    expect(result).toEqual({
      minPercent: 7.2,
      maxPercent: 9.6
    });
  });

  it('keeps the upper boundary 10 as percent and does not coerce to minimum', () => {
    const result = normalizeGlyphSizePercentRange(10, 10, 1000);

    expect(result.minPercent).toBe(10);
    expect(result.maxPercent).toBe(10);
  });

  it('converts legacy pixel-sized values above 10 to percent', () => {
    const result = normalizeGlyphSizePercentRange(24, 48, 1200);

    expect(result).toEqual({
      minPercent: 2,
      maxPercent: 4
    });
  });

  it('stratifies a viewport-filled population across every vertical band', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const positions = Array.from({ length: 120 }, (_, index) => resolveInitialViewportY(index, 120, 800));
    const bands = Array.from({ length: 4 }, (_, band) =>
      positions.filter((y) => y >= band * 200 && y < (band + 1) * 200).length);
    expect(bands).toEqual([30, 30, 30, 30]);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const count = positions.filter((y, index) => {
          const x = resolveInitialViewportX(index, 120, 1200);
          return y >= row * 200 && y < (row + 1) * 200 && x >= col * 300 && x < (col + 1) * 300;
        }).length;
        expect(count).toBeGreaterThanOrEqual(6);
      }
    }
  });
});
