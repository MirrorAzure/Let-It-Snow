import { describe, expect, it } from 'vitest';
import { parseOverlaySnowConfig } from '../src/obs/overlay-options.js';

describe('OBS overlay snow options', () => {
  it('accepts gravity and initial spawn range from the URL', () => {
    const config = parseOverlaySnowConfig(new URLSearchParams(
      'gravity=20&initialSpawnSpanRatio=0.15&snowmax=170'
    ));

    expect(config.gravity).toBe(20);
    expect(config.initialSpawnSpanRatio).toBe(0.15);
    expect(config.snowmax).toBe(170);
  });

  it('clamps the spawn range and ignores invalid values', () => {
    expect(parseOverlaySnowConfig(new URLSearchParams('initialSpawnSpanRatio=9'))
      .initialSpawnSpanRatio).toBe(3);
    expect(parseOverlaySnowConfig(new URLSearchParams('initialSpawnSpanRatio=0'))
      .initialSpawnSpanRatio).toBeUndefined();
    expect(parseOverlaySnowConfig(new URLSearchParams('gravity=100')).gravity).toBe(20);
  });
});
