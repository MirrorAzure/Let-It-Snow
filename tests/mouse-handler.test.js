import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MouseHandler } from '../src/content/physics/mouse-handler.js';

describe('MouseHandler', () => {
  let mouseHandler;
  let config;

  beforeEach(() => {
    config = {
      mouseRadius: 100,
      mouseForce: 300,
      mouseImpulseStrength: 0.5,
      mouseDragThreshold: 500,
      mouseDragStrength: 0.8
    };
    mouseHandler = new MouseHandler(config);
  });

  it('initializes with correct config', () => {
    expect(mouseHandler.mouseRadius).toBe(100);
    expect(mouseHandler.mouseForce).toBe(300);
    expect(mouseHandler.mouseImpulseStrength).toBe(0.5);
    expect(mouseHandler.mouseDragThreshold).toBe(500);
    expect(mouseHandler.mouseDragStrength).toBe(0.8);
  });

  it('handles mouse down for explosion (button 0)', () => {
    const now = performance.now();
    mouseHandler.onMouseDown(500, 300, 0);

    expect(mouseHandler.mouseLeftPressed).toBe(true);
    expect(mouseHandler.mouseBurstMode).toBe('explode');
    expect(mouseHandler.mouseBurstEndTime).toBeGreaterThan(now);
    expect(mouseHandler.mouseX).toBe(500);
    expect(mouseHandler.mouseY).toBe(300);
  });

  it('handles mouse down for suction (button 2)', () => {
    const now = performance.now();
    mouseHandler.onMouseDown(600, 400, 2);

    expect(mouseHandler.mouseRightPressed).toBe(true);
    expect(mouseHandler.mouseBurstMode).toBe('suction');
    expect(mouseHandler.mouseBurstEndTime).toBeGreaterThan(now);
    expect(mouseHandler.mouseX).toBe(600);
    expect(mouseHandler.mouseY).toBe(400);
  });

  it('handles mouse up', () => {
    mouseHandler.mouseLeftPressed = true;
    mouseHandler.mouseRightPressed = true;

    mouseHandler.onMouseUp(0);
    expect(mouseHandler.mouseLeftPressed).toBe(false);

    mouseHandler.onMouseUp(2);
    expect(mouseHandler.mouseRightPressed).toBe(false);
  });

  it('handles mouse leave', () => {
    mouseHandler.mouseLeftPressed = true;
    mouseHandler.mouseRightPressed = true;
    mouseHandler.mouseBurstEndTime = performance.now() + 1000;
    mouseHandler.mouseBurstMode = 'explode';

    mouseHandler.onMouseLeave();

    expect(mouseHandler.mouseLeftPressed).toBe(false);
    expect(mouseHandler.mouseRightPressed).toBe(false);
    expect(mouseHandler.mouseBurstEndTime).toBe(0);
    expect(mouseHandler.mouseBurstMode).toBeNull();
    expect(mouseHandler.mouseX).toBe(-1000);
    expect(mouseHandler.mouseY).toBe(-1000);
  });

  it('updates mouse position and velocity', () => {
    mouseHandler.updateMousePosition(100, 200, 50, 75);

    expect(mouseHandler.mouseX).toBe(100);
    expect(mouseHandler.mouseY).toBe(200);
    expect(mouseHandler.mouseVelocityX).toBe(50);
    expect(mouseHandler.mouseVelocityY).toBe(75);
  });

  it('applies explosion force to flake during burst', () => {
    const flake = {
      x: 550,
      y: 350,
      velocityX: 0,
      velocityY: 0
    };

    mouseHandler.mouseX = 500;
    mouseHandler.mouseY = 300;
    mouseHandler.mouseBurstMode = 'explode';
    mouseHandler.mouseBurstEndTime = performance.now() + 100;

    mouseHandler.applyMouseEffect(flake, 0.016);

    // Flake should be pushed away (positive velocity in direction away from mouse)
    expect(flake.velocityX).toBeGreaterThan(0);
    expect(flake.velocityY).toBeGreaterThan(0);
  });

  it('applies suction force to flake during burst', () => {
    const flake = {
      x: 550,
      y: 350,
      velocityX: 0,
      velocityY: 0
    };

    mouseHandler.mouseX = 500;
    mouseHandler.mouseY = 300;
    mouseHandler.mouseBurstMode = 'suction';
    mouseHandler.mouseBurstEndTime = performance.now() + 100;

    mouseHandler.applyMouseEffect(flake, 0.016);

    // Flake should be pulled toward mouse (negative velocity in direction to mouse)
    expect(flake.velocityX).toBeLessThan(0);
    expect(flake.velocityY).toBeLessThan(0);
  });

  it('applies drag force when mouse moves fast', () => {
    const flake = {
      x: 520,
      y: 320,
      velocityX: 0,
      velocityY: 0
    };

    mouseHandler.mouseX = 500;
    mouseHandler.mouseY = 300;
    mouseHandler.mouseVelocityX = 600; // Fast movement
    mouseHandler.mouseVelocityY = 0;

    mouseHandler.applyMouseEffect(flake, 0.016);

    // Flake should be dragged in direction of mouse movement
    expect(flake.velocityX).toBeGreaterThan(0);
  });

  it('applies normal repulsion when mouse moves slowly', () => {
    const flake = {
      x: 550,
      y: 300,
      velocityX: 0,
      velocityY: 0
    };

    mouseHandler.mouseX = 500;
    mouseHandler.mouseY = 300;
    mouseHandler.mouseVelocityX = 50; // Slow movement
    mouseHandler.mouseVelocityY = 0;

    mouseHandler.applyMouseEffect(flake, 0.016);

    // Flake should be pushed away
    expect(flake.velocityX).toBeGreaterThan(0);
  });

  it('does not affect flake outside mouse radius', () => {
    const flake = {
      x: 1000,
      y: 1000,
      velocityX: 0,
      velocityY: 0
    };

    mouseHandler.mouseX = 500;
    mouseHandler.mouseY = 300;
    mouseHandler.mouseVelocityX = 100;
    mouseHandler.mouseVelocityY = 100;

    mouseHandler.applyMouseEffect(flake, 0.016);

    // Flake too far away, should not be affected
    expect(flake.velocityX).toBe(0);
    expect(flake.velocityY).toBe(0);
  });

  it('uses larger radius during burst', () => {
    const flake = {
      x: 800,
      y: 300,
      velocityX: 0,
      velocityY: 0
    };

    mouseHandler.mouseX = 500;
    mouseHandler.mouseY = 300;
    mouseHandler.mouseBurstMode = 'explode';
    mouseHandler.mouseBurstEndTime = performance.now() + 100;
    mouseHandler.mouseBurstRadiusMultiplier = 3.5;

    // Distance is 300px
    // Normal radius is 100px (too far)
    // Burst radius is 100 * 3.5 = 350px (within range)

    mouseHandler.applyMouseEffect(flake, 0.016);

    // Should be affected due to larger burst radius
    expect(flake.velocityX).toBeGreaterThan(0);
  });

  it('does not affect flake when no mouse activity', () => {
    const flake = {
      x: 550,
      y: 300,
      velocityX: 0,
      velocityY: 0
    };

    mouseHandler.mouseX = 500;
    mouseHandler.mouseY = 300;
    mouseHandler.mouseVelocityX = 0;
    mouseHandler.mouseVelocityY = 0;
    mouseHandler.mouseBurstEndTime = 0; // No burst

    mouseHandler.applyMouseEffect(flake, 0.016);

    // No mouse activity, no effect
    expect(flake.velocityX).toBe(0);
    expect(flake.velocityY).toBe(0);
  });

  it('releases grabbed flake when mouse buttons released', () => {
    const flake = {
      x: 550,
      y: 300,
      velocityX: 0,
      velocityY: 0,
      isGrabbed: true,
      swayLimit: 0.5
    };

    mouseHandler.mouseX = 500;
    mouseHandler.mouseY = 300;
    mouseHandler.mouseLeftPressed = false;
    mouseHandler.mouseRightPressed = false;
    mouseHandler.mouseVelocityX = 10;
    mouseHandler.mouseVelocityY = 10;

    mouseHandler.applyMouseEffect(flake, 0.016);

    expect(flake.isGrabbed).toBe(false);
    expect(flake.swayLimit).toBe(1.0);
  });

  it('updates config dynamically', () => {
    expect(mouseHandler.mouseRadius).toBe(100);

    mouseHandler.updateConfig({ mouseRadius: 200 });
    expect(mouseHandler.mouseRadius).toBe(200);

    mouseHandler.updateConfig({ mouseForce: 500 });
    expect(mouseHandler.mouseForce).toBe(500);
  });

  it('calculates burst factor correctly over time', () => {
    const flake = {
      x: 520,
      y: 300,
      velocityX: 0,
      velocityY: 0
    };

    mouseHandler.mouseX = 500;
    mouseHandler.mouseY = 300;
    mouseHandler.mouseBurstMode = 'explode';
    mouseHandler.mouseBurstDuration = 0.2; // 200ms

    // Start of burst
    const startTime = performance.now();
    mouseHandler.mouseBurstEndTime = startTime + 200;

    // Halfway through burst (100ms remaining)
    vi.spyOn(performance, 'now').mockReturnValue(startTime + 100);
    mouseHandler.applyMouseEffect(flake, 0.016);
    const velocityAtHalf = Math.abs(flake.velocityX);

    // Reset flake
    flake.velocityX = 0;
    flake.velocityY = 0;

    // Near end of burst (20ms remaining) - should be weaker
    vi.spyOn(performance, 'now').mockReturnValue(startTime + 180);
    mouseHandler.applyMouseEffect(flake, 0.016);
    const velocityNearEnd = Math.abs(flake.velocityX);

    // Force should be stronger at the beginning
    expect(velocityAtHalf).toBeGreaterThan(velocityNearEnd);
  });
});
