import { describe, it, expect, vi, afterEach } from 'vitest';

import { createSdfGlyphAtlas } from '../src/content/utils/glyph-utils.js';

describe('createSdfGlyphAtlas', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves original alpha coverage in RGB channels for fine-detail reconstruction', () => {
    const originalCreateElement = document.createElement.bind(document);
    const sourceAlpha = [0, 64, 128, 255];
    const sourceData = new Uint8ClampedArray([
      0, 0, 0, sourceAlpha[0],
      0, 0, 0, sourceAlpha[1],
      0, 0, 0, sourceAlpha[2],
      0, 0, 0, sourceAlpha[3]
    ]);

    const sourceCanvas = {
      width: 2,
      height: 2,
      getContext: vi.fn().mockReturnValue({
        getImageData: vi.fn().mockReturnValue({ data: sourceData })
      })
    };

    let writtenImage = null;
    const sdfCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({
        createImageData: vi.fn((width, height) => ({
          width,
          height,
          data: new Uint8ClampedArray(width * height * 4)
        })),
        putImageData: vi.fn((imageData) => {
          writtenImage = imageData;
        })
      })
    };

    vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
      if (tagName === 'canvas') {
        return sdfCanvas;
      }
      return originalCreateElement(tagName);
    });

    const result = createSdfGlyphAtlas(sourceCanvas, 2, 1);

    expect(result).toBe(sdfCanvas);
    expect(writtenImage).not.toBeNull();

    const writtenData = Array.from(writtenImage.data);
    expect(writtenData[0]).toBe(sourceAlpha[0]);
    expect(writtenData[1]).toBe(sourceAlpha[0]);
    expect(writtenData[2]).toBe(sourceAlpha[0]);
    expect(writtenData[4]).toBe(sourceAlpha[1]);
    expect(writtenData[5]).toBe(sourceAlpha[1]);
    expect(writtenData[6]).toBe(sourceAlpha[1]);
    expect(writtenData[8]).toBe(sourceAlpha[2]);
    expect(writtenData[9]).toBe(sourceAlpha[2]);
    expect(writtenData[10]).toBe(sourceAlpha[2]);
    expect(writtenData[12]).toBe(sourceAlpha[3]);
    expect(writtenData[13]).toBe(sourceAlpha[3]);
    expect(writtenData[14]).toBe(sourceAlpha[3]);
    expect(writtenData[3]).toBeGreaterThanOrEqual(0);
    expect(writtenData[15]).toBeLessThanOrEqual(255);
  });
});