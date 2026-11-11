import { normalizePhysicsDelta } from './time-step.js';

const PIXELS_PER_METER = 4;
const MIN_POSITIVE = 0.0001;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const SHAPES = {
  compact: { area: 0.85, massDensity: 1.3, compactness: 0.82, dragRange: [0.7, 1.0] },
  regular: { area: 1, massDensity: 1, compactness: 0.55, dragRange: [1.0, 1.4] },
  lacy: { area: 1.2, massDensity: 0.75, compactness: 0.28, dragRange: [1.4, 2.0] }
};

function resolveShapeName(flake, config, fluffiness) {
  const override = flake.snowShape
    ?? flake.snowShapeOverride
    ?? config.snowShapeOverrides?.[flake._snowflakeIndex];
  if (override === 'auto') return getAutomaticShape(fluffiness);
  if (Object.hasOwn(SHAPES, override)) return override;
  if (Object.hasOwn(SHAPES, config.snowShape)) return config.snowShape;
  return getAutomaticShape(fluffiness);
}

function getAutomaticShape(fluffiness) {
  if (fluffiness < 0.25) return 'compact';
  if (fluffiness < 0.65) return 'regular';
  return 'lacy';
}

function configureFlake(flake, shapeName, fluffiness) {
  const shape = SHAPES[shapeName];
  const sizeRatio = Math.max(0.1, (Number(flake.size) || 20) / 20);
  flake._massVariation ??= 0.9 + Math.random() * 0.2;
  const mass = Math.max(
    MIN_POSITIVE,
    sizeRatio ** 3 * shape.massDensity * (1 - fluffiness * 0.4) * flake._massVariation
  );
  const area = sizeRatio ** 2 * shape.area * (1 + fluffiness * 0.25);
  const compactness = clamp(shape.compactness * (1 - fluffiness * 0.55), 0.05, 1);

  flake.mass = mass;
  flake.area = area;
  flake.compactness = compactness;
  flake.perimeter = Math.sqrt((4 * Math.PI * area) / compactness);
  flake.dragCoefficient = shape.dragRange[0]
    + (shape.dragRange[1] - shape.dragRange[0]) * fluffiness;
  flake._dragAreaMassRatio = 0.5 * flake.dragCoefficient * area / (mass * PIXELS_PER_METER);
  flake._turbulenceScaleFactor = 12 * Math.sqrt(area / mass);
  flake.resolvedSnowShape = shapeName;
  flake.effectiveFluffiness = fluffiness;
  flake._physicsShapeName = shapeName;
  flake._physicsFluffiness = fluffiness;
  flake._physicsSizeRatio = sizeRatio;
}

/**
 * Advance one flake using quadratic drag relative to the moving air.
 * Positions remain the renderer's responsibility; velocity units are CSS px/s.
 */
export function stepSnowflakePhysics(flake, delta, config = {}, wind = {}) {
  delta = normalizePhysicsDelta(delta);
  if (!flake || delta <= 0) return;

  const flakeFluffiness = Number(flake.snowFluffiness);
  const configuredFluffiness = Number(config.snowFluffiness);
  const fluffiness = clamp(
    Number.isFinite(flakeFluffiness)
      ? flakeFluffiness
      : Number.isFinite(configuredFluffiness) ? configuredFluffiness : 0.3,
    0,
    1
  );
  const shapeName = resolveShapeName(flake, config, fluffiness);
  const sizeRatio = Math.max(0.1, (Number(flake.size) || 20) / 20);
  if (flake._physicsShapeName !== shapeName
    || flake._physicsFluffiness !== fluffiness
    || flake._physicsSizeRatio !== sizeRatio) {
    configureFlake(flake, shapeName, fluffiness);
  }
  const mass = flake.mass;

  const gravityValue = Number(config.gravity);
  const gravity = Math.max(0, Number.isFinite(gravityValue) ? gravityValue : 9.81);
  const airDensity = Math.max(MIN_POSITIVE, Number(config.airDensity) || 1.2);
  const windEnabled = wind.enabled ?? config.windEnabled === true;
  const windStrength = windEnabled ? Math.max(0, Number(config.windStrength) || 0) : 0;
  const windGustStrength = windEnabled ? clamp(Number(config.windGustStrength) || 0, 0, 1) : 0;
  const turbulenceStrength = windEnabled ? clamp(Number(config.turbulenceStrength) || 0, 0, 1) : 0;
  const windTime = Number(wind.time) || 0;
  flake._turbulencePhaseX ??= Math.random() * Math.PI * 2;
  flake._turbulencePhaseY ??= Math.random() * Math.PI * 2;
  const phaseX = flake._turbulencePhaseX;
  const phaseY = flake._turbulencePhaseY;

  const windDirection = wind.x < 0 || config.windDirection === 'left' ? -1 : 1;
  const gustVelocity = Math.sin(
    windTime * (2 * Math.PI / Math.max(0.5, Number(config.windGustFrequency) || 3)) + phaseX
  ) * windGustStrength * windStrength * 20 * windDirection;
  const turbulenceScale = turbulenceStrength * flake._turbulenceScaleFactor;
  const turbulenceOffsetX = turbulenceScale
    ? Math.sin(windTime * 2.7 + phaseX) * turbulenceScale
    : 0;
  const turbulenceOffsetY = turbulenceScale
    ? Math.cos(windTime * 2.1 + phaseY) * turbulenceScale * 0.6
    : 0;
  const airVelocityX = (windEnabled ? Number(wind.x) || 0 : 0)
    + gustVelocity
    + turbulenceOffsetX;
  const updraft = windEnabled
    ? Math.max(0, Number(config.updraftStrength) || 0) * PIXELS_PER_METER
    : 0;
  const airVelocityY = (windEnabled ? Number(wind.y) || 0 : 0)
    - updraft
    + turbulenceOffsetY;
  const turbulenceOffset = flake.turbulenceOffset ?? (flake.turbulenceOffset = {});
  turbulenceOffset.x = turbulenceOffsetX;
  turbulenceOffset.y = turbulenceOffsetY;

  const velocityX = Number(flake.velocityX) || 0;
  const externalVelocityY = Number(flake.velocityY) || 0;
  const currentVelocityY = flake._physicsInitialized
    ? (Number(flake.fallSpeed) || 0) + externalVelocityY
    : externalVelocityY;
  const relativeX = velocityX - airVelocityX;
  const relativeY = currentVelocityY - airVelocityY;
  const drag = airDensity * flake._dragAreaMassRatio;
  const gravityAdjustedRelativeY = relativeY + gravity * PIXELS_PER_METER * delta;
  const dragFactor = 1 / (
    1 + drag * Math.hypot(relativeX, gravityAdjustedRelativeY) * delta
  );
  let nextVelocityX = airVelocityX + relativeX * dragFactor;
  let nextVelocityY = airVelocityY + gravityAdjustedRelativeY * dragFactor;

  nextVelocityX = clamp(nextVelocityX, -900, 900);
  nextVelocityY = clamp(nextVelocityY, -900, 900);

  const nextRelativeX = nextVelocityX - airVelocityX;
  const nextRelativeY = nextVelocityY - airVelocityY;
  const relativeVelocity = flake.relativeVelocity ?? (flake.relativeVelocity = {});
  relativeVelocity.x = nextRelativeX;
  relativeVelocity.y = nextRelativeY;
  relativeVelocity.magnitude = Math.hypot(nextRelativeX, nextRelativeY);

  const terminalVelocity = PIXELS_PER_METER
    * Math.sqrt((2 * mass * gravity) / (airDensity * flake.dragCoefficient * flake.area));
  flake.velocityX = nextVelocityX;
  flake.verticalVelocity = nextVelocityY;
  flake.fallSpeed = nextVelocityY - externalVelocityY;
  flake.gravity = gravity;
  flake.airDensity = airDensity;
  flake.windGustStrength = windGustStrength;
  flake.turbulenceStrength = turbulenceStrength;
  flake.terminalVelocity = terminalVelocity;
  flake.windX = airVelocityX;
  flake.windVerticalSpeed = airVelocityY;
  flake.windSpeed = Math.hypot(airVelocityX, airVelocityY);
  flake._physicsInitialized = true;
}

export function getWindVelocity(config, currentWindForce = 0, currentWindLift = 0, enabled = config.windEnabled) {
  if (!enabled) return { x: 0, y: 0 };
  return {
    x: currentWindForce * 60,
    y: -currentWindLift * 40
  };
}

export function applyAirBurstImpulse(flake, x, y, radius, mode, strength, duration = 0.2) {
  if (!flake || !Number.isFinite(flake.x) || !Number.isFinite(flake.y)
    || !Number.isFinite(x) || !Number.isFinite(y)
    || !Number.isFinite(radius) || radius <= 0
    || !Number.isFinite(strength) || strength <= 0
    || !Number.isFinite(duration) || duration < 0
    || (mode !== 'blower' && mode !== 'explode' && mode !== 'suction')) return false;

  const dx = flake.x - x;
  const dy = flake.y - y;
  const distance = Math.hypot(dx, dy);
  if (distance >= radius) return false;

  const influence = 1 - distance / radius;
  const impulse = Math.min(600, strength * Math.max(0, duration) * influence * 0.5);
  const angle = distance > 0 ? 0 : Math.random() * Math.PI * 2;
  const directionX = distance > 0 ? dx / distance : Math.cos(angle);
  const directionY = distance > 0 ? dy / distance : Math.sin(angle);
  const direction = mode === 'suction' ? -1 : 1;
  flake.velocityX = (Number.isFinite(flake.velocityX) ? flake.velocityX : 0)
    + directionX * impulse * direction;
  flake.velocityY = (Number.isFinite(flake.velocityY) ? flake.velocityY : 0)
    + directionY * impulse * direction
    - (mode === 'blower' ? impulse * 2 : 0);
  return true;
}
