export const DEFAULT_MIN_GLOW_STRENGTH = 0.42;

export function resolveMinGlowStrength(value) {
  const strength = Number(value);
  if (!Number.isFinite(strength)) return DEFAULT_MIN_GLOW_STRENGTH;
  return Math.max(0, Math.min(1, strength));
}
