import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeGlyphSizePercentRange } from '../src/content/utils/size-utils.js';

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
});
