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
    sizeRatio * shape.massDensity * (1 - fluffiness * 0.4) * flake._massVariation
  );
  const area = sizeRatio ** 2 * shape.area * (1 + fluffiness * 0.25);
  const compactness = clamp(shape.compactness * (1 - fluffiness * 0.55), 0.05, 1);

  flake.mass = mass;
  flake.area = area;
  flake.compactness = compactness;
  flake.perimeter = Math.sqrt((4 * Math.PI * area) / compactness);
  flake.dragCoefficient = shape.dragRange[0]
    + (shape.dragRange[1] - shape.dragRange[0]) * fluffiness;
  flake.resolvedSnowShape = shapeName;
  flake.effectiveFluffiness = fluffiness;
  flake._physicsConfigKey = `${shapeName}:${fluffiness}:${sizeRatio}`;
}

/**
 * Advance one flake using quadratic drag relative to the moving air.
 * Positions remain the renderer's responsibility; velocity units are CSS px/s.
 */
export function stepSnowflakePhysics(flake, delta, config = {}, wind = {}) {
  if (!flake || !Number.isFinite(delta) || delta <= 0) return;

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
  const configKey = `${shapeName}:${fluffiness}:${sizeRatio}`;
  if (flake._physicsConfigKey !== configKey) configureFlake(flake, shapeName, fluffiness);
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
  const turbulenceScale = turbulenceStrength * 12 * Math.sqrt(flake.area / mass);
  const airVelocityX = (Number(wind.x) || 0)
    + gustVelocity
    + Math.sin(windTime * 2.7 + phaseX) * turbulenceScale;
  const updraft = windEnabled
    ? Math.max(0, Number(config.updraftStrength) || 0) * PIXELS_PER_METER
    : 0;
  const airVelocityY = (Number(wind.y) || 0)
    - updraft
    + Math.cos(windTime * 2.1 + phaseY) * turbulenceScale * 0.6;
  flake.turbulenceOffset = {
    x: Math.sin(windTime * 2.7 + phaseX) * turbulenceScale,
    y: Math.cos(windTime * 2.1 + phaseY) * turbulenceScale * 0.6
  };

  const velocityX = Number(flake.velocityX) || 0;
  const externalVelocityY = Number(flake.velocityY) || 0;
  const currentVelocityY = flake._physicsInitialized
    ? (Number(flake.fallSpeed) || 0) + externalVelocityY
    : externalVelocityY;
  const relativeX = velocityX - airVelocityX;
  const relativeY = currentVelocityY - airVelocityY;
  const relativeSpeed = Math.hypot(relativeX, relativeY);
  const drag = 0.5 * airDensity * flake.dragCoefficient * flake.area
    / (mass * PIXELS_PER_METER);
  const safeDelta = Math.min(delta, 0.05);
  const gravityAdjustedRelativeY = relativeY + gravity * PIXELS_PER_METER * safeDelta;
  const dragFactor = 1 / (
    1 + drag * Math.hypot(relativeX, gravityAdjustedRelativeY) * safeDelta
  );
  let nextVelocityX = airVelocityX + relativeX * dragFactor;
  let nextVelocityY = airVelocityY + gravityAdjustedRelativeY * dragFactor;

  nextVelocityX = clamp(nextVelocityX, -900, 900);
  nextVelocityY = clamp(nextVelocityY, -900, 900);

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
  flake.relativeVelocity = {
    x: relativeX,
    y: relativeY,
    magnitude: relativeSpeed
  };
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
    || (mode !== 'blower' && mode !== 'suction')) return false;

  const dx = flake.x - x;
  const dy = flake.y - y;
  const distance = Math.hypot(dx, dy);
  if (distance >= radius) return false;

  const influence = 1 - distance / radius;
  const impulse = Math.min(600, strength * Math.max(0, duration) * influence * 0.5);
  const angle = distance > 0 ? Math.atan2(dy, dx) : Math.random() * Math.PI * 2;
  const direction = mode === 'suction' ? -1 : 1;
  flake.velocityX = (Number.isFinite(flake.velocityX) ? flake.velocityX : 0)
    + Math.cos(angle) * impulse * direction;
  flake.velocityY = (Number.isFinite(flake.velocityY) ? flake.velocityY : 0)
    + Math.sin(angle) * impulse * direction
    - (mode === 'blower' ? impulse * 2 : 0);
  return true;
}
