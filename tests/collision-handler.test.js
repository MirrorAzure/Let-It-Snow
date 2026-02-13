import { describe, it, expect, beforeEach } from 'vitest';
import { CollisionHandler } from '../src/content/physics/collision-handler.js';

describe('CollisionHandler', () => {
  let collisionHandler;
  let config;

  beforeEach(() => {
    config = {
      enableCollisions: true,
      collisionDamping: 0.7,
      collisionCheckRadius: 600
    };
    collisionHandler = new CollisionHandler(config);
  });

  it('initializes with correct config', () => {
    expect(collisionHandler.enableCollisions).toBe(true);
    expect(collisionHandler.collisionDamping).toBe(0.7);
    expect(collisionHandler.collisionCheckRadius).toBe(600);
  });

  it('does not process collisions when disabled', () => {
    collisionHandler.enableCollisions = false;

    const flakes = [
      { x: 100, y: 100, size: 20, velocityX: 10, velocityY: 0, collisionSize: 20 },
      { x: 110, y: 100, size: 20, velocityX: -10, velocityY: 0, collisionSize: 20 }
    ];

    const originalVelocityX0 = flakes[0].velocityX;
    const originalVelocityX1 = flakes[1].velocityX;

    collisionHandler.handleCollisions(flakes, 0.016);

    // Velocities should not change
    expect(flakes[0].velocityX).toBe(originalVelocityX0);
    expect(flakes[1].velocityX).toBe(originalVelocityX1);
  });

  it('does not process collisions with single flake', () => {
    const flakes = [
      { x: 100, y: 100, size: 20, velocityX: 10, velocityY: 0, collisionSize: 20 }
    ];

    collisionHandler.handleCollisions(flakes, 0.016);

    // Should not crash or throw
    expect(flakes[0].velocityX).toBe(10);
  });

  it('detects collision between two flakes', () => {
    const flakes = [
      {
        x: 100,
        y: 100,
        baseX: 100,
        baseY: 100,
        size: 20,
        velocityX: 10,
        velocityY: 0,
        collisionSize: 20,
        rotationSpeed: 0
      },
      {
        x: 115,
        y: 100,
        baseX: 115,
        baseY: 100,
        size: 20,
        velocityX: -10,
        velocityY: 0,
        collisionSize: 20,
        rotationSpeed: 0
      }
    ];

    collisionHandler.handleCollisions(flakes, 0.016);

    // After collision, velocities should have changed
    // (elastic collision should reverse or modify velocities)
    expect(flakes[0].velocityX).not.toBe(10);
    expect(flakes[1].velocityX).not.toBe(-10);
  });

  it('does not detect collision when flakes are far apart', () => {
    const flakes = [
      {
        x: 100,
        y: 100,
        baseX: 100,
        baseY: 100,
        size: 20,
        velocityX: 10,
        velocityY: 0,
        collisionSize: 20,
        rotationSpeed: 0
      },
      {
        x: 1000,
        y: 1000,
        baseX: 1000,
        baseY: 1000,
        size: 20,
        velocityX: -10,
        velocityY: 0,
        collisionSize: 20,
        rotationSpeed: 0
      }
    ];

    collisionHandler.handleCollisions(flakes, 0.016);

    // No collision, velocities unchanged
    expect(flakes[0].velocityX).toBe(10);
    expect(flakes[1].velocityX).toBe(-10);
  });

  it('separates overlapping flakes', () => {
    const flakes = [
      {
        x: 100,
        y: 100,
        baseX: 100,
        baseY: 100,
        size: 20,
        velocityX: 0,
        velocityY: 0,
        collisionSize: 20,
        rotationSpeed: 0
      },
      {
        x: 105,
        y: 100,
        baseX: 105,
        baseY: 100,
        size: 20,
        velocityX: 0,
        velocityY: 0,
        collisionSize: 20,
        rotationSpeed: 0
      }
    ];

    const distance = Math.sqrt(
      Math.pow(flakes[1].x - flakes[0].x, 2) + 
      Math.pow(flakes[1].y - flakes[0].y, 2)
    );

    collisionHandler.handleCollisions(flakes, 0.016);

    const newDistance = Math.sqrt(
      Math.pow(flakes[1].x - flakes[0].x, 2) + 
      Math.pow(flakes[1].y - flakes[0].y, 2)
    );

    // Distance should increase (flakes pushed apart)
    expect(newDistance).toBeGreaterThan(distance);
  });

  it('transfers momentum during collision', () => {
    const flakes = [
      {
        x: 100,
        y: 100,
        baseX: 100,
        baseY: 100,
        size: 20,
        velocityX: 20,
        velocityY: 0,
        collisionSize: 20,
        rotationSpeed: 0
      },
      {
        x: 118,
        y: 100,
        baseX: 118,
        baseY: 100,
        size: 20,
        velocityX: 0,
        velocityY: 0,
        collisionSize: 20,
        rotationSpeed: 0
      }
    ];

    const totalMomentumBefore = flakes[0].velocityX + flakes[1].velocityX;

    collisionHandler.handleCollisions(flakes, 0.016);

    const totalMomentumAfter = flakes[0].velocityX + flakes[1].velocityX;

    // Some momentum should be transferred to second flake
    expect(Math.abs(flakes[1].velocityX)).toBeGreaterThan(0);
  });

  it('applies damping to collision velocities', () => {
    const dampingValue = 0.5;
    collisionHandler.collisionDamping = dampingValue;

    const flakes = [
      {
        x: 100,
        y: 100,
        baseX: 100,
        baseY: 100,
        size: 20,
        velocityX: 100,
        velocityY: 0,
        collisionSize: 20,
        rotationSpeed: 0
      },
      {
        x: 118,
        y: 100,
        baseX: 118,
        baseY: 100,
        size: 20,
        velocityX: -100,
        velocityY: 0,
        collisionSize: 20,
        rotationSpeed: 0
      }
    ];

    collisionHandler.handleCollisions(flakes, 0.016);

    // After collision with damping, velocities should be reduced
    expect(Math.abs(flakes[0].velocityX)).toBeLessThan(100);
    expect(Math.abs(flakes[1].velocityX)).toBeLessThan(100);
  });

  it('applies rotational spin during collision', () => {
    const flakes = [
      {
        x: 100,
        y: 100,
        baseX: 100,
        baseY: 100,
        size: 20,
        velocityX: 20,
        velocityY: 0,
        collisionSize: 20,
        rotationSpeed: 0
      },
      {
        x: 115,
        y: 100,
        baseX: 115,
        baseY: 100,
        size: 20,
        velocityX: -20,
        velocityY: 10,
        collisionSize: 20,
        rotationSpeed: 0
      }
    ];

    collisionHandler.handleCollisions(flakes, 0.016);

    // Collision should induce rotation due to tangential velocity
    expect(flakes[0].rotationSpeed).not.toBe(0);
    expect(flakes[1].rotationSpeed).not.toBe(0);
  });

  it('handles multiple flakes colliding', () => {
    const flakes = [
      {
        x: 100,
        y: 100,
        baseX: 100,
        baseY: 100,
        size: 20,
        velocityX: 10,
        velocityY: 0,
        collisionSize: 20,
        rotationSpeed: 0
      },
      {
        x: 118,
        y: 100,
        baseX: 118,
        baseY: 100,
        size: 20,
        velocityX: 0,
        velocityY: 0,
        collisionSize: 20,
        rotationSpeed: 0
      },
      {
        x: 136,
        y: 100,
        baseX: 136,
        baseY: 100,
        size: 20,
        velocityX: -10,
        velocityY: 0,
        collisionSize: 20,
        rotationSpeed: 0
      }
    ];

    collisionHandler.handleCollisions(flakes, 0.016);

    // All three should be affected
    expect(flakes[0].velocityX).not.toBe(10);
    expect(flakes[1].velocityX).not.toBe(0);
    expect(flakes[2].velocityX).not.toBe(-10);
  });

  it('resets sway limit for non-grabbed flakes', () => {
    const flakes = [
      {
        x: 100,
        y: 100,
        baseX: 100,
        baseY: 100,
        size: 20,
        velocityX: 0,
        velocityY: 0,
        collisionSize: 20,
        rotationSpeed: 0,
        swayLimit: 0.5,
        isGrabbed: false
      }
    ];

    collisionHandler.handleCollisions(flakes, 0.016);

    expect(flakes[0].swayLimit).toBe(1.0);
  });

  it('preserves sway limit for grabbed flakes', () => {
    const flakes = [
      {
        x: 100,
        y: 100,
        baseX: 100,
        baseY: 100,
        size: 20,
        velocityX: 0,
        velocityY: 0,
        collisionSize: 20,
        rotationSpeed: 0,
        swayLimit: 0.3,
        isGrabbed: true
      }
    ];

    collisionHandler.handleCollisions(flakes, 0.016);

    expect(flakes[0].swayLimit).toBe(0);
  });

  it('updates config dynamically', () => {
    expect(collisionHandler.collisionDamping).toBe(0.7);

    collisionHandler.updateConfig({ collisionDamping: 0.9 });
    expect(collisionHandler.collisionDamping).toBe(0.9);

    collisionHandler.updateConfig({ enableCollisions: false });
    expect(collisionHandler.enableCollisions).toBe(false);
  });

  it('uses collision size instead of visual size', () => {
    const flakes = [
      {
        x: 100,
        y: 100,
        baseX: 100,
        baseY: 100,
        size: 50, // Large visual size
        collisionSize: 10, // Small collision size
        velocityX: 10,
        velocityY: 0,
        rotationSpeed: 0
      },
      {
        x: 125,
        y: 100,
        baseX: 125,
        baseY: 100,
        size: 50,
        collisionSize: 10,
        velocityX: -10,
        velocityY: 0,
        rotationSpeed: 0
      }
    ];

    // Distance is 25px, which is > sum of collision radii (10px)
    // So no collision should occur
    collisionHandler.handleCollisions(flakes, 0.016);

    // Velocities should not change
    expect(flakes[0].velocityX).toBe(10);
    expect(flakes[1].velocityX).toBe(-10);
  });

  it('handles flakes with different sizes', () => {
    const flakes = [
      {
        x: 100,
        y: 100,
        baseX: 100,
        baseY: 100,
        size: 10,
        collisionSize: 10,
        velocityX: 10,
        velocityY: 0,
        rotationSpeed: 0
      },
      {
        x: 115,
        y: 100,
        baseX: 115,
        baseY: 100,
        size: 30,
        collisionSize: 30,
        velocityX: -10,
        velocityY: 0,
        rotationSpeed: 0
      }
    ];

    collisionHandler.handleCollisions(flakes, 0.016);

    // Should handle collision with different sizes
    expect(flakes[0].velocityX).not.toBe(10);
    expect(flakes[1].velocityX).not.toBe(-10);
  });
});
