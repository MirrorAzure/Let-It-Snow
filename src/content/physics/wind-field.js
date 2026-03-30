const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const hash01 = (value) => {
  const x = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export function stepWindState({
  enabled,
  delta,
  windTime,
  windDirection,
  windDirectionPhase,
  windStrength,
  windGustFrequency,
  windVortexStrength,
  prevWindForce,
  prevWindLift,
  prevWindVortex,
  highFreq3Scale = 0.02,
  windSmoothFactor = 0.05
}) {
  if (!enabled) {
    return {
      windTime,
      currentWindForce: 0,
      currentWindLift: 0,
      currentWindVortex: 0,
      prevWindForce: 0,
      prevWindLift: 0,
      prevWindVortex: 0,
      gustIntensity: 0
    };
  }

  const nextWindTime = windTime + delta;
  const baseFreq = Math.max(0.1, windGustFrequency * 0.5);
  const baseTime = (nextWindTime / (20 / baseFreq)) % 1.0;
  const baseWind = Math.sin(baseTime * Math.PI) * 0.6;

  const midFreq = windGustFrequency;
  const midTime = (nextWindTime / (10 / midFreq)) % 1.0;
  const midWind = Math.sin(midTime * Math.PI * 2) * Math.cos(nextWindTime * 0.3) * 0.25;

  const highFreq1 = Math.sin(nextWindTime * 1.7) * Math.exp(-0.1 * (nextWindTime % 5)) * 0.06;
  const highFreq2 = Math.sin(nextWindTime * 2.9 + Math.cos(nextWindTime)) * 0.04;
  const highFreq3 = Math.sin(nextWindTime * 4.1) * Math.sin(nextWindTime * 0.7) * highFreq3Scale;
  const turbulence = highFreq1 + highFreq2 + highFreq3;

  const gust = clamp(baseWind + midWind + turbulence, -1, 1);
  const gustIntensity = Math.min(1, Math.abs(gust));

  let directionFactor = 1;
  if (windDirection === 'left') {
    directionFactor = -1;
  } else if (windDirection === 'right') {
    directionFactor = 1;
  } else {
    const dirTime = nextWindTime * 0.12 + windDirectionPhase;
    const dirNoise = Math.sin(dirTime) + Math.sin(dirTime * 0.23 + Math.cos(nextWindTime * 0.05)) * 0.35;
    directionFactor = clamp(dirNoise, -1, 1);
  }

  const targetWindForce = directionFactor * gustIntensity * windStrength;
  const targetWindLift = gustIntensity * 0.3 * windStrength;
  const targetWindVortex = gustIntensity * windStrength * windVortexStrength;

  const currentWindForce = prevWindForce * (1 - windSmoothFactor) + targetWindForce * windSmoothFactor;
  const currentWindLift = prevWindLift * (1 - windSmoothFactor) + targetWindLift * windSmoothFactor;
  const currentWindVortex = prevWindVortex * (1 - windSmoothFactor) + targetWindVortex * windSmoothFactor;

  return {
    windTime: nextWindTime,
    currentWindForce,
    currentWindLift,
    currentWindVortex,
    prevWindForce: currentWindForce,
    prevWindLift: currentWindLift,
    prevWindVortex: currentWindVortex,
    gustIntensity
  };
}

export function createWindVortexField(width, height, windTime, seed = 0) {
  const phase1 = hash01(seed + 1) * Math.PI * 2;
  const phase2 = hash01(seed + 2) * Math.PI * 2;
  const phase3 = hash01(seed + 3) * Math.PI * 2;
  const phase4 = hash01(seed + 4) * Math.PI * 2;
  const anchor1X = 0.2 + hash01(seed + 5) * 0.2;
  const anchor1Y = 0.2 + hash01(seed + 6) * 0.2;
  const anchor2X = 0.6 + hash01(seed + 7) * 0.2;
  const anchor2Y = 0.55 + hash01(seed + 8) * 0.25;
  const amp1X = 0.12 + hash01(seed + 9) * 0.09;
  const amp1Y = 0.10 + hash01(seed + 10) * 0.08;
  const amp2X = 0.10 + hash01(seed + 11) * 0.08;
  const amp2Y = 0.11 + hash01(seed + 12) * 0.08;

  const vortexRadius = Math.max(120, Math.min(width, height) * 0.22);
  const vortexRadiusSq = vortexRadius * vortexRadius;
  const vortex1X = width * (anchor1X + amp1X * Math.sin(windTime * 0.17 + phase1));
  const vortex1Y = height * (anchor1Y + amp1Y * Math.cos(windTime * 0.23 + phase2));
  const vortex2X = width * (anchor2X + amp2X * Math.cos(windTime * 0.13 + phase3));
  const vortex2Y = height * (anchor2Y + amp2Y * Math.sin(windTime * 0.19 + phase4));

  return {
    vortexRadiusSq,
    centers: [
      { x: vortex1X, y: vortex1Y, direction: 1 },
      { x: vortex2X, y: vortex2Y, direction: -1 }
    ]
  };
}

export function applyVortexWindImpulse(flake, delta, vortexAccel, vortexField) {
  const { vortexRadiusSq, centers } = vortexField;

  for (let i = 0; i < centers.length; i++) {
    const center = centers[i];
    const dx = flake.x - center.x;
    const dy = flake.y - center.y;
    const distSq = dx * dx + dy * dy;
    const falloff = Math.exp(-distSq / (vortexRadiusSq * 1.8));
    if (falloff < 0.001) continue;

    const norm = 1 / Math.sqrt(distSq + vortexRadiusSq * 0.35);
    const tangentX = -dy * norm * center.direction;
    const tangentY = dx * norm * center.direction;
    flake.velocityX += tangentX * vortexAccel * falloff * delta;
    flake.velocityY += tangentY * vortexAccel * falloff * delta;
  }
}