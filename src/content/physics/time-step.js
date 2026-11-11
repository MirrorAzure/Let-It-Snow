export const MAX_PHYSICS_DELTA = 0.05;
export const FIXED_PHYSICS_STEP = 1 / 60;
export const MAX_PHYSICS_SUBSTEPS = 8;

export function createPhysicsClock() {
  return { accumulator: 0, droppedTime: 0 };
}

export function advancePhysicsClock(clock, elapsed, update) {
  if (!clock || !Number.isFinite(elapsed) || elapsed <= 0 || typeof update !== 'function') return 0;

  clock.accumulator += elapsed;
  const availableSteps = Math.floor(
    (clock.accumulator + FIXED_PHYSICS_STEP * 1e-9) / FIXED_PHYSICS_STEP
  );
  const steps = Math.min(availableSteps, MAX_PHYSICS_SUBSTEPS);
  if (availableSteps > MAX_PHYSICS_SUBSTEPS) {
    const droppedSteps = availableSteps - MAX_PHYSICS_SUBSTEPS;
    const droppedTime = droppedSteps * FIXED_PHYSICS_STEP;
    clock.accumulator -= droppedTime;
    clock.droppedTime += droppedTime;
  }

  for (let index = 0; index < steps; index++) {
    update(FIXED_PHYSICS_STEP, index, steps);
    clock.accumulator -= FIXED_PHYSICS_STEP;
  }
  if (clock.accumulator < FIXED_PHYSICS_STEP * 1e-9) clock.accumulator = 0;
  return steps;
}

export function normalizePhysicsDelta(delta) {
  return Number.isFinite(delta)
    ? Math.max(0, Math.min(MAX_PHYSICS_DELTA, delta))
    : 0;
}
