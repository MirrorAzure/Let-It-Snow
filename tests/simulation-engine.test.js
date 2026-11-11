import { describe, it, expect, vi } from 'vitest';
import { SimulationEngine } from '../src/content/physics/simulation-engine.js';
import { CollisionHandler } from '../src/content/physics/collision-handler.js';

describe('SimulationEngine', () => {
  it('writes collision-corrected positions to the instance buffer', () => {
    const flakes = [
      {
        x: 100,
        y: 100,
        size: 20,
        collisionSize: 20,
        fallSpeed: 0,
        phase: 0,
        freq: 0,
        sway: 0,
        rotation: 0,
        rotationSpeed: 0,
        velocityX: 0,
        velocityY: 0,
        color: { r: 1, g: 1, b: 1 },
        glyphIndex: 0
      },
      {
        x: 110,
        y: 100,
        size: 20,
        collisionSize: 20,
        fallSpeed: 0,
        phase: 0,
        freq: 0,
        sway: 0,
        rotation: 0,
        rotationSpeed: 0,
        velocityX: 0,
        velocityY: 0,
        color: { r: 1, g: 1, b: 1 },
        glyphIndex: 0
      }
    ];
    const engine = new SimulationEngine();
    engine.initialize(flakes, {
      glyphAtlas: { count: 1 },
      sentenceAtlas: { count: 0 },
      getMonotoneFlags: () => [false]
    });
    const instanceData = new Float32Array(flakes.length * 14);

    engine.updateSimulation(0, instanceData, null, new CollisionHandler());

    expect(instanceData[0]).toBeCloseTo(flakes[0].x);
    expect(instanceData[14]).toBeCloseTo(flakes[1].x);
    expect(instanceData[0]).not.toBe(100);
    expect(instanceData[14]).not.toBe(110);
  });

  it('reads monotone flags once per update for all flakes', () => {
    const flakes = [0, 1].map((glyphIndex) => ({
      x: 100 + glyphIndex * 30,
      y: 100,
      size: 20,
      fallSpeed: 0,
      phase: 0,
      freq: 0,
      sway: 0,
      rotation: 0,
      rotationSpeed: 0,
      velocityX: 0,
      velocityY: 0,
      color: { r: 1, g: 1, b: 1 },
      glyphIndex
    }));
    const getMonotoneFlags = vi.fn(() => [false, true]);
    const engine = new SimulationEngine();
    engine.initialize(flakes, {
      glyphAtlas: { count: 2 },
      sentenceAtlas: { count: 0 },
      getMonotoneFlags
    });
    const instanceData = new Float32Array(flakes.length * 14);

    engine.updateSimulation(0, instanceData);

    expect(getMonotoneFlags).toHaveBeenCalledTimes(1);
    expect(instanceData[13]).toBe(0);
    expect(instanceData[27]).toBe(1);
  });
});
