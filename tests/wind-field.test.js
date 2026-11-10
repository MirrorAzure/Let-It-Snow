import { describe, expect, it } from 'vitest';
import { stepWindState } from '../src/content/physics/wind-field.js';
import { getWindVelocity, stepSnowflakePhysics } from '../src/content/physics/snow-physics.js';

const stepWind = (state, delta, strength = 3) => stepWindState({
  enabled: true,
  delta,
  windTime: state.windTime,
  windDirection: 'right',
  windDirectionPhase: 0,
  windStrength: strength,
  windGustFrequency: 3,
  windVortexStrength: 0.35,
  prevWindForce: state.prevWindForce,
  prevWindLift: state.prevWindLift,
  prevWindVortex: state.prevWindVortex
});

const zeroWindState = () => ({
  windTime: 0,
  prevWindForce: 0,
  prevWindLift: 0,
  prevWindVortex: 0
});

describe('wind field', () => {
  it('updates wind response consistently across frame rates', () => {
    const simulate = (hz) => {
      let state = zeroWindState();
      for (let frame = 0; frame < hz * 2; frame++) {
        state = stepWind(state, 1 / hz, 1.5);
      }
      return state;
    };

    const at30Hz = simulate(30);
    const at60Hz = simulate(60);
    const at120Hz = simulate(120);

    expect(at30Hz.currentWindForce).toBeCloseTo(at60Hz.currentWindForce, 1);
    expect(at60Hz.currentWindForce).toBeCloseTo(at120Hz.currentWindForce, 1);
    expect(at30Hz.currentWindLift).toBeCloseTo(at60Hz.currentWindLift, 1);
    expect(at60Hz.currentWindLift).toBeCloseTo(at120Hz.currentWindLift, 1);
  });

  it('generates lift from strong wind without requiring a separate updraft setting', () => {
    const config = {
      gravity: 9.81,
      airDensity: 1.2,
      snowFluffiness: 0.3,
      snowShape: 'auto',
      windEnabled: true,
      windStrength: 3,
      windGustStrength: 1,
      turbulenceStrength: 0,
      windGustFrequency: 3,
      updraftStrength: 0
    };
    const flake = { size: 4, velocityX: 0, velocityY: 0, fallSpeed: 0, y: 100 };
    let state = zeroWindState();

    for (let frame = 0; frame < 60 * 10; frame++) {
      state = stepWind(state, 1 / 60);
      const airflow = getWindVelocity(
        config, state.currentWindForce, state.currentWindLift, true
      );
      stepSnowflakePhysics(flake, 1 / 60, config, {
        ...airflow,
        enabled: true,
        time: state.windTime
      });
      flake.y += (flake.fallSpeed + flake.velocityY) / 60;
    }

    expect(state.currentWindLift).toBeGreaterThan(0.5);
    expect(flake.verticalVelocity).toBeLessThan(0);
    expect(flake.y).toBeLessThan(100);
  });

  it('clears wind and lift immediately when disabled', () => {
    const state = stepWindState({
      enabled: false,
      delta: 1 / 60,
      windTime: 1,
      windDirection: 'right',
      windDirectionPhase: 0,
      windStrength: 3,
      windGustFrequency: 3,
      windVortexStrength: 0.35,
      prevWindForce: 1,
      prevWindLift: 1,
      prevWindVortex: 1
    });

    expect(state.currentWindForce).toBe(0);
    expect(state.currentWindLift).toBe(0);
    expect(state.currentWindVortex).toBe(0);
  });
});
