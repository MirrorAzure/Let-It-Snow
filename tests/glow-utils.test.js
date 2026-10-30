import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIN_GLOW_STRENGTH,
  resolveMinGlowStrength
} from '../src/content/utils/glow-utils.js';

describe('glow strength settings', () => {
  it('uses the same default minimum for both renderers', () => {
    expect(DEFAULT_MIN_GLOW_STRENGTH).toBe(0.42);
    expect(resolveMinGlowStrength(undefined)).toBe(DEFAULT_MIN_GLOW_STRENGTH);
  });

  it('preserves zero and clamps configured values to the supported range', () => {
    expect(resolveMinGlowStrength(0)).toBe(0);
    expect(resolveMinGlowStrength(-0.2)).toBe(0);
    expect(resolveMinGlowStrength(1.2)).toBe(1);
  });
});
