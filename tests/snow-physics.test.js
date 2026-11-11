import { describe, expect, it } from 'vitest';
import {
  applyAirBurstImpulse,
  applyMouseFieldForce,
  stepSnowflakePhysics
} from '../src/content/physics/snow-physics.js';
import {
  advancePhysicsClock,
  createPhysicsClock,
  FIXED_PHYSICS_STEP,
  normalizePhysicsDelta
} from '../src/content/physics/time-step.js';
import { WebGPURenderer } from '../src/content/webgpu-renderer.js';

const config = {
  gravity: 9.81,
  airDensity: 1.2,
  snowFluffiness: 0,
  snowShape: 'regular',
  windEnabled: false,
  windStrength: 0.5,
  windGustStrength: 0,
  turbulenceStrength: 0,
  updraftStrength: 0
};

const makeFlake = (size = 20) => ({
  size,
  velocityX: 0,
  velocityY: 0,
  fallSpeed: 0
});

describe('snowflake physics', () => {
  it('normalizes invalid and stalled frame deltas consistently', () => {
    expect(normalizePhysicsDelta(1)).toBe(0.05);
    expect(normalizePhysicsDelta(1 / 60)).toBeCloseTo(1 / 60);
    expect(normalizePhysicsDelta(-1)).toBe(0);
    expect(normalizePhysicsDelta(Number.NaN)).toBe(0);
  });

  it('keeps the complete vertical speed canonical under aerodynamic drag', () => {
    const flake = { ...makeFlake(), velocityX: 100, velocityY: 100 };
    const noGravity = { ...config, gravity: 0 };

    for (let frame = 0; frame < 60; frame++) {
      stepSnowflakePhysics(flake, 1 / 60, noGravity);
      expect(flake.velocityX).toBeGreaterThan(0);
      expect(flake.velocityY).toBeGreaterThan(0);
      expect(flake.fallSpeed).toBe(0);
      expect(flake.verticalVelocity).toBe(flake.velocityY);
    }
  });

  it('keeps symmetric diagonal velocity moving forward through the WebGPU update loop', () => {
    const renderer = new WebGPURenderer(null, {
      gravity: 0,
      airDensity: 1.2,
      enableCollisions: false,
      windEnabled: false,
      mouseRadius: 0
    });
    renderer.viewportWidth = 1000;
    renderer.viewportHeight = 1000;
    const flake = {
      x: 100, y: 100, size: 20, collisionSize: 20, fallSpeed: 0,
      velocityX: 300, velocityY: 300, velocityZ: 0, phase: 0, freq: 0,
      sway: 0, rotationSpeed: 0, cumulativeSpin: 0, glyphIndex: 0,
      color: { r: 1, g: 1, b: 1 }
    };
    renderer.instances = [flake];
    renderer.instanceData = new Float32Array(14);

    for (let frame = 0; frame < 10; frame++) renderer.updateSimulation(0.05);

    expect(flake.x).toBeGreaterThan(100);
    expect(flake.y).toBeGreaterThan(100);
    expect(flake.velocityX).toBeGreaterThan(0);
    expect(flake.velocityY).toBeGreaterThan(0);
    expect(flake.x - 100).toBeCloseTo(flake.y - 100, 1);
  });

  it('applies held pointer fields by simulation time and has no suction singularity at center', () => {
    const flake = { x: 50, y: 0, velocityX: 0, velocityY: 0 };
    applyMouseFieldForce(flake, 0, 0, 100, 'suction', 100, 1 / 60);
    expect(flake.velocityX).toBeLessThan(0);

    const approachingCenter = { x: 1, y: 0, velocityX: -100, velocityY: 0 };
    applyMouseFieldForce(approachingCenter, 0, 0, 100, 'suction', 100, 1 / 60);
    expect(approachingCenter.velocityX).toBeGreaterThan(-100);

    const atCenter = { x: 0, y: 0, velocityX: 0, velocityY: 0 };
    expect(applyMouseFieldForce(atCenter, 0, 0, 100, 'suction', 100, 1 / 60)).toBe(true);
    expect(atCenter.velocityX).toBe(0);
    expect(atCenter.velocityY).toBe(0);
  });

  it('advances equal simulated time at supported frame rates and caps backlog', () => {
    for (const fps of [10, 20, 30, 60, 120]) {
      const clock = createPhysicsClock();
      let updates = 0;
      for (let frame = 0; frame < fps; frame++) {
        advancePhysicsClock(clock, 1 / fps, () => updates++);
      }
      expect(updates * FIXED_PHYSICS_STEP).toBeCloseTo(1, 8);
      expect(clock.droppedTime).toBe(0);
    }

    const clock = createPhysicsClock();
    let updates = 0;
    advancePhysicsClock(clock, 0.5, () => updates++);
    expect(updates).toBe(8);
    expect(clock.droppedTime).toBeGreaterThan(0);
    expect(clock.accumulator).toBeLessThan(FIXED_PHYSICS_STEP);
  });

  it('calculates physical properties and approaches terminal speed over time', () => {
    const flake = { ...makeFlake(), x: 100, y: 100 };

    for (let frame = 0; frame < 600; frame++) {
      stepSnowflakePhysics(flake, 1 / 60, config);
    }

    expect(flake.mass).toBeCloseTo(1, 0);
    expect(flake.area).toBe(1);
    expect(flake.perimeter).toBeGreaterThan(0);
    expect(flake.compactness).toBeGreaterThan(0);
    expect(flake.dragCoefficient).toBeGreaterThan(0);
    expect(flake.verticalVelocity).toBeGreaterThan(0);
    expect(flake.verticalVelocity).toBeCloseTo(flake.terminalVelocity, 0);
    expect(flake.relativeVelocity.magnitude).toBeGreaterThan(0);
  });

  it('scales mass with volume and makes larger flakes fall faster', () => {
    const lightFlake = { ...makeFlake(), _massVariation: 1 };
    const largeFlake = { ...makeFlake(40), _massVariation: 1 };
    const lacyFlake = { ...makeFlake(), _massVariation: 1 };
    const lacyConfig = { ...config, snowShape: 'lacy' };

    stepSnowflakePhysics(lightFlake, 1 / 60, config);
    stepSnowflakePhysics(largeFlake, 1 / 60, config);
    stepSnowflakePhysics(lacyFlake, 1 / 60, lacyConfig);

    expect(largeFlake.mass).toBeGreaterThan(lightFlake.mass);
    expect(largeFlake.mass / lightFlake.mass).toBeCloseTo(8, 5);
    expect(largeFlake.area / lightFlake.area).toBeCloseTo(4, 5);
    expect(largeFlake.terminalVelocity).toBeGreaterThan(lightFlake.terminalVelocity);
    expect(lightFlake.terminalVelocity).toBeGreaterThan(lacyFlake.terminalVelocity);
    expect(lacyFlake.dragCoefficient).toBeGreaterThan(lightFlake.dragCoefficient);
  });

  it('keeps representative terminal speeds within the documented visual-model ranges', () => {
    const cases = [
      { size: 20, snowShape: 'regular', snowFluffiness: 0, range: [16, 16.4] },
      { size: 40, snowShape: 'regular', snowFluffiness: 0, range: [22.7, 23.1] },
      { size: 20, snowShape: 'lacy', snowFluffiness: 1, range: [6.1, 6.5] }
    ];

    for (const { size, snowShape, snowFluffiness, range } of cases) {
      const flake = { ...makeFlake(size), _massVariation: 1 };
      stepSnowflakePhysics(flake, 1 / 60, { ...config, snowShape, snowFluffiness });

      expect(flake.terminalVelocity).toBeGreaterThanOrEqual(range[0]);
      expect(flake.terminalVelocity).toBeLessThanOrEqual(range[1]);
    }
  });

  it('derives shape from fluffiness and honors per-flake shape overrides', () => {
    const automaticConfig = { ...config, snowShape: 'auto' };
    const compactFlake = makeFlake();
    const regularFlake = { ...makeFlake(), snowFluffiness: 0.5 };
    const lacyFlake = { ...makeFlake(), _snowflakeIndex: 2 };
    const overriddenFlake = { ...makeFlake(), snowShape: 'lacy' };

    stepSnowflakePhysics(compactFlake, 1 / 60, automaticConfig);
    stepSnowflakePhysics(regularFlake, 1 / 60, automaticConfig);
    stepSnowflakePhysics(lacyFlake, 1 / 60, {
      ...automaticConfig,
      snowShapeOverrides: [null, null, 'lacy']
    });
    stepSnowflakePhysics(overriddenFlake, 1 / 60, { ...automaticConfig, snowShape: 'compact' });

    expect(compactFlake.resolvedSnowShape).toBe('compact');
    expect(regularFlake.resolvedSnowShape).toBe('regular');
    expect(lacyFlake.resolvedSnowShape).toBe('lacy');
    expect(overriddenFlake.resolvedSnowShape).toBe('lacy');
    expect(compactFlake.dragCoefficient).toBeGreaterThanOrEqual(0.7);
    expect(compactFlake.dragCoefficient).toBeLessThanOrEqual(1);
    expect(regularFlake.dragCoefficient).toBeGreaterThanOrEqual(1);
    expect(regularFlake.dragCoefficient).toBeLessThanOrEqual(1.4);
    expect(lacyFlake.dragCoefficient).toBeGreaterThanOrEqual(1.4);
    expect(lacyFlake.dragCoefficient).toBeLessThanOrEqual(2);
  });

  it('derives mass and area again when the flake size changes', () => {
    const flake = makeFlake(20);
    stepSnowflakePhysics(flake, 1 / 60, config);
    const initialMass = flake.mass;
    const initialArea = flake.area;

    flake.size = 40;
    stepSnowflakePhysics(flake, 1 / 60, config);

    expect(flake.mass).toBeGreaterThan(initialMass);
    expect(flake.area).toBeCloseTo(initialArea * 4);
    expect(flake.perimeter).toBeGreaterThan(0);
  });

  it('updates terminal velocity when gravity or air density changes', () => {
    const flake = makeFlake();
    stepSnowflakePhysics(flake, 1 / 60, config);
    const initialTerminalVelocity = flake.terminalVelocity;

    stepSnowflakePhysics(flake, 1 / 60, { ...config, gravity: 20 });
    const highGravityVelocity = flake.terminalVelocity;
    stepSnowflakePhysics(flake, 1 / 60, { ...config, airDensity: 2 });

    expect(highGravityVelocity).toBeGreaterThan(initialTerminalVelocity);
    expect(flake.terminalVelocity).toBeLessThan(initialTerminalVelocity);
  });

  it('reports the post-step relative velocity and reuses per-flake diagnostic objects', () => {
    const flake = makeFlake();
    const wind = { enabled: true, x: 40, y: -10, time: 0 };
    const configWithWind = { ...config, windEnabled: true };

    stepSnowflakePhysics(flake, 1 / 60, configWithWind, wind);
    const relativeVelocity = flake.relativeVelocity;
    const turbulenceOffset = flake.turbulenceOffset;

    expect(relativeVelocity.x).toBeCloseTo(flake.velocityX - flake.windX);
    expect(relativeVelocity.y).toBeCloseTo(flake.verticalVelocity - flake.windVerticalSpeed);
    expect(relativeVelocity.magnitude).toBeCloseTo(Math.hypot(relativeVelocity.x, relativeVelocity.y));

    wind.time += 1 / 60;
    stepSnowflakePhysics(flake, 1 / 60, configWithWind, wind);

    expect(flake.relativeVelocity).toBe(relativeVelocity);
    expect(flake.turbulenceOffset).toBe(turbulenceOffset);
    expect(relativeVelocity.x).toBeCloseTo(flake.velocityX - flake.windX);
    expect(relativeVelocity.y).toBeCloseTo(flake.verticalVelocity - flake.windVerticalSpeed);
  });

  it('accelerates gradually into the direction of moving air', () => {
    const flake = { ...makeFlake(), x: 100, y: 100 };
    const windy = { ...config, windEnabled: true };

    stepSnowflakePhysics(flake, 1 / 60, windy, { x: -40, y: 0, time: 0 });

    expect(flake.velocityX).toBeLessThan(0);
    expect(flake.x).toBe(100);
    expect(flake.y).toBe(100);
    expect(flake.windX).toBeLessThan(0);
    expect(flake.relativeVelocity.magnitude).toBeGreaterThan(0);
  });

  it('ignores air velocity when wind is disabled', () => {
    const flake = { ...makeFlake(), x: 100, y: 100 };

    stepSnowflakePhysics(flake, 1 / 60, config, { x: 200, y: -100, enabled: false });

    expect(flake.windX).toBe(0);
    expect(flake.windVerticalSpeed).toBe(0);
  });

  it('preserves upward momentum against gravity when no updraft is configured', () => {
    const flake = { ...makeFlake(4), velocityY: -120, y: 100 };
    const initialY = flake.y;

    stepSnowflakePhysics(flake, 1 / 60, config);
    flake.y += (flake.fallSpeed + flake.velocityY) / 60;

    expect(flake.verticalVelocity).toBeLessThan(0);
    expect(flake.y).toBeLessThan(initialY);
  });

  it('allows a light flake to rise in a strong updraft', () => {
    const flake = makeFlake(10);
    const updraftConfig = {
      ...config,
      windEnabled: true,
      updraftStrength: 30
    };

    for (let frame = 0; frame < 600; frame++) {
      stepSnowflakePhysics(flake, 1 / 60, updraftConfig);
    }

    expect(flake.verticalVelocity).toBeLessThan(0);
    expect(flake.fallSpeed + flake.velocityY).toBeCloseTo(flake.verticalVelocity);
  });

  it('lifts the smallest flakes in a strong updraft', () => {
    const flake = makeFlake(2);
    const updraftConfig = { ...config, windEnabled: true, updraftStrength: 30 };

    for (let frame = 0; frame < 600; frame++) {
      stepSnowflakePhysics(flake, 1 / 60, updraftConfig);
    }

    expect(flake.verticalVelocity).toBeLessThan(0);
    expect(flake.fallSpeed + flake.velocityY).toBeCloseTo(flake.verticalVelocity);
    expect(flake.windVerticalSpeed).toBe(-120);
  });

  it('keeps an outward mouse plume rising after aerodynamic drag', () => {
    const flake = { ...makeFlake(4), x: 160, y: 140 };
    const mouse = { x: 100, y: 100 };
    const delta = 1 / 60;
    const radius = 350;

    for (let frame = 0; frame < 60; frame++) {
      const dx = flake.x - mouse.x;
      const dy = flake.y - mouse.y;
      const distance = Math.hypot(dx, dy);
      const influence = 1 - distance / radius;
      const acceleration = influence * 3000;
      flake.velocityX += (dx / distance) * acceleration * delta;
      flake.velocityY += (dy / distance - 4) * acceleration * delta;
      stepSnowflakePhysics(flake, delta, config);
      flake.x += flake.velocityX * delta;
      flake.y += (flake.fallSpeed + flake.velocityY) * delta;
    }

    expect(flake.y).toBeLessThan(140);
  });

  it('applies one outward/upward impulse or inward suction impulse', () => {
    const blowerFlake = { ...makeFlake(), x: 120, y: 100 };
    const suctionFlake = { ...makeFlake(), x: 120, y: 100 };

    expect(applyAirBurstImpulse(blowerFlake, 100, 100, 100, 'blower', 3000)).toBe(true);
    expect(applyAirBurstImpulse(suctionFlake, 100, 100, 100, 'suction', 3000)).toBe(true);

    expect(blowerFlake.velocityX).toBeGreaterThan(0);
    expect(blowerFlake.velocityY).toBeLessThan(0);
    expect(suctionFlake.velocityX).toBeLessThan(0);
    expect(applyAirBurstImpulse(blowerFlake, 100, 100, 10, 'blower', 3000)).toBe(false);
  });

  it('applies an explosion impulse radially in every direction without an upward bias', () => {
    const flakes = [
      { ...makeFlake(), x: 120, y: 100 },
      { ...makeFlake(), x: 80, y: 100 },
      { ...makeFlake(), x: 100, y: 120 },
      { ...makeFlake(), x: 100, y: 80 }
    ];

    for (const flake of flakes) {
      expect(applyAirBurstImpulse(flake, 100, 100, 100, 'explode', 3000)).toBe(true);
    }

    expect(flakes[0].velocityX).toBeGreaterThan(0);
    expect(flakes[0].velocityY).toBe(0);
    expect(flakes[1].velocityX).toBeLessThan(0);
    expect(flakes[1].velocityY).toBe(0);
    expect(flakes[2].velocityY).toBeGreaterThan(0);
    expect(flakes[2].velocityX).toBe(0);
    expect(flakes[3].velocityY).toBeLessThan(0);
    expect(flakes[3].velocityX).toBe(0);
  });
});
