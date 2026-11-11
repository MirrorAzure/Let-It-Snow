export const MAX_PHYSICS_DELTA = 0.05;

export function normalizePhysicsDelta(delta) {
  return Number.isFinite(delta)
    ? Math.max(0, Math.min(MAX_PHYSICS_DELTA, delta))
    : 0;
}
