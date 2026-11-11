import { describe, expect, it, vi } from 'vitest';
import {
  ThreeDSnowRenderer,
  createGlyphGeometry,
  resolveGlowColor,
  resolveGlowWhiten,
  resolveGlyphAppearance,
  resolveGlowPulse,
  resolveGlowFlicker,
  resolveInitialFlakeY
} from '../src/content/three-d-renderer.js';
import { applyMouseFieldForce } from '../src/content/physics/snow-physics.js';

describe('ThreeDSnowRenderer', () => {
  it('never produces a dark glow color, even for dark flakes', () => {
    for (const color of ['#000000', '#1a237e', '#ff0000', '#ffffff']) {
      const [r, g, b] = resolveGlowColor(color);
      expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeGreaterThanOrEqual(0.719);
      [r, g, b].forEach((channel) => {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      });
    }
    resolveGlowColor('#ffffff').forEach((channel) => expect(channel).toBeCloseTo(1));
    const [r, , b] = resolveGlowColor('#3060ff');
    expect(b).toBeGreaterThan(r);
  });

  it('rejects invalid glow color channels instead of silently turning them white', () => {
    expect(() => resolveGlowColor({ isColor: true, r: NaN, g: 0, b: 0 }))
      .toThrow('3D glow color channels must be finite.');
  });

  it('whitens the glow completely on light backgrounds and keeps colors on dark ones', () => {
    expect(resolveGlowWhiten(1)).toBe(0);
    expect(resolveGlowWhiten(0)).toBe(1);
    expect(resolveGlowWhiten(0.5)).toBe(0.5);
  });

  it('reports an invalid background darkness before using a safe white glow', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(resolveGlowWhiten(NaN)).toBe(1);
      expect(warn).toHaveBeenCalledWith(
        '[Let It Snow] Invalid background darkness; using white glow.'
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('adapts the glow color to the background independently of minimum glow strength', () => {
    const renderer = new ThreeDSnowRenderer(null, { minGlowStrength: 1 });
    renderer.glowPass = { setGlowState: vi.fn() };
    renderer.backgroundMonitor = {
      calculateGlowStrength: vi.fn((minimum) => (minimum === 0 ? 0 : 1))
    };

    renderer.updateGlowState();

    expect(renderer.backgroundMonitor.calculateGlowStrength).toHaveBeenCalledWith(1);
    expect(renderer.backgroundMonitor.calculateGlowStrength).toHaveBeenCalledWith(0, 1);
    expect(renderer.glowPass.setGlowState).toHaveBeenCalledWith(1, 1, expect.objectContaining({
      r: expect.any(Number), g: expect.any(Number), b: expect.any(Number)
    }));
  });

  it('pulses smoothly without harsh flashes or switching the glow off', () => {
    expect(resolveGlowPulse(-Math.PI / 2)).toBeCloseTo(0.72);
    expect(resolveGlowPulse(Math.PI / 2)).toBeCloseTo(1);
    expect(resolveGlowPulse(0)).toBeGreaterThan(resolveGlowPulse(-Math.PI / 2));
    expect(resolveGlowPulse(0)).toBeLessThan(resolveGlowPulse(Math.PI / 2));
  });

  it('creates an extruded glyph geometry with the configured cross-section depth', () => {
    const geometry = createGlyphGeometry(
      new Uint8Array([
        0, 1, 0,
        1, 1, 1,
        0, 1, 0
      ]),
      3,
      3,
      0.12
    );
    const positions = geometry.getAttribute('position').array;
    const depthValues = Array.from(positions).filter((_, index) => index % 3 === 2);

    expect(Math.max(...depthValues) - Math.min(...depthValues)).toBeCloseTo(0.12);
    expect(geometry.getAttribute('normal')).toBeDefined();
    geometry.dispose();
  });

  it('rasterizes text and emoji masks at the higher glyph detail resolution', () => {
    const data = new Uint8ClampedArray(280 * 280 * 4);
    data[(140 * 280 + 140) * 4 + 3] = 255;
    const contexts = [];
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      const context = {
        clearRect: vi.fn(), fillText: vi.fn(), getImageData: vi.fn(() => ({ data })),
        measureText: vi.fn(() => ({ width: 100 }))
      };
      contexts.push(context);
      return context;
    });
    try {
      const renderer = new ThreeDSnowRenderer(null);
      for (const [glyph, mode] of [['❄', 'text'], ['🎄', 'emoji']]) {
        const shape = renderer._createGlyphMask(glyph, mode);
        const context = contexts.at(-1);
        expect(shape.unit).toBe(192);
        expect(shape.mask.reduce((sum, pixel) => sum + pixel, 0)).toBe(1);
        expect(context.font).toContain('192px');
        expect(context.fillText).toHaveBeenCalledWith(glyph, 140, 140, 272);
      }
    } finally {
      getContext.mockRestore();
    }
  });

  it('selects configured glyphs, modes, and palette colors per flake', () => {
    expect(resolveGlyphAppearance({
      snowletters: ['❄', '✦'],
      snowglyphmodes: ['text', 'emoji'],
      snowcolor: ['#ff0000', '#00ff00']
    }, 1)).toEqual({
      glyph: '✦',
      glyphMode: 'emoji',
      color: '#00ff00',
      isSentence: false
    });
  });

  it('keeps configured sentence flakes in the 3D glyph stream', () => {
    expect(resolveGlyphAppearance({
      snowmax: 4,
      snowletters: ['❄'],
      snowsentences: ['Happy winter'],
      sentenceCount: 1
    }, 3)).toMatchObject({
      glyph: 'Happy winter',
      isSentence: true
    });
  });

  it('projects objects at greater depth to a larger scale', () => {
    const renderer = new ThreeDSnowRenderer(null);
    renderer.viewportHeight = 1000;

    expect(renderer._worldScaleAtDepth(10)).toBeLessThan(renderer._worldScaleAtDepth(-10));
  });

  it('separates flakes with coincident centers without producing invalid positions', () => {
    const renderer = new ThreeDSnowRenderer(null);
    renderer.viewportWidth = 100;
    renderer.viewportHeight = 100;
    renderer.flakes = [
      { x: 50, y: 50, z: 0, size: 2, velocityX: 0, velocityY: 0, velocityZ: 0 },
      { x: 50, y: 50, z: 0, size: 2, velocityX: 0, velocityY: 0, velocityZ: 0 }
    ];
    const positions = [
      { x: 0, y: 0, z: 0, scale: 1 },
      { x: 0, y: 0, z: 0, scale: 1 }
    ];

    renderer._resolveCollisions(positions);

    expect(positions[0].x).toBeLessThan(positions[1].x);
    expect(renderer.flakes.every((flake) => Number.isFinite(flake.x) && Number.isFinite(flake.y))).toBe(true);
  });

  it('preserves world-space momentum for unequal masses during a 3D collision', () => {
    const renderer = new ThreeDSnowRenderer(null);
    renderer.viewportWidth = 100;
    renderer.viewportHeight = 100;
    renderer.flakes = [
      { x: 50, y: 50, z: 0, size: 20, mass: 1, velocityX: 10, velocityY: 0, velocityZ: 0 },
      { x: 65, y: 50, z: 0, size: 20, mass: 8, velocityX: -10, velocityY: 0, velocityZ: 0 }
    ];
    const positions = [
      { x: 0, y: 0, z: 0, scale: 1 },
      { x: 15, y: 0, z: 0, scale: 1 }
    ];
    const momentumBefore = renderer.flakes.reduce((sum, flake) => sum + flake.mass * flake.velocityX, 0);

    renderer._resolveCollisions(positions);

    const momentumAfter = renderer.flakes.reduce((sum, flake) => sum + flake.mass * flake.velocityX, 0);
    expect(momentumAfter).toBeCloseTo(momentumBefore, 8);
    expect(renderer.flakes[0].velocityX).toBeLessThan(renderer.flakes[1].velocityX);
  });

  it.each([
    {
      name: 'head-on',
      previous: [{ x: -10, y: 0, z: 0, scale: 1 }, { x: 10, y: 0, z: 0, scale: 1 }],
      current: [{ x: 10, y: 0, z: 0, scale: 1 }, { x: -10, y: 0, z: 0, scale: 1 }],
      velocities: [[1200, 0, 0], [-1200, 0, 0]]
    },
    {
      name: 'glancing',
      previous: [{ x: -10, y: 0, z: 0, scale: 1 }, { x: 0, y: 11.5, z: 0, scale: 1 }],
      current: [{ x: 10, y: 0, z: 0, scale: 1 }, { x: 0, y: -8.5, z: 0, scale: 1 }],
      velocities: [[1200, 0, 0], [0, 1200, 0]]
    }
  ])('detects a fast $name impact when the flakes no longer overlap', ({ previous, current, velocities }) => {
    const renderer = new ThreeDSnowRenderer(null);
    renderer.viewportWidth = 100;
    renderer.viewportHeight = 100;
    renderer.flakes = velocities.map(([velocityX, velocityY, velocityZ]) => ({
      x: 50, y: 50, z: 0, size: 2, mass: 1, velocityX, velocityY, velocityZ
    }));

    renderer._resolveCollisions(current, previous, 1 / 60);

    expect(renderer.flakes[0].velocityX !== velocities[0][0]
      || renderer.flakes[0].velocityY !== velocities[0][1]
      || renderer.flakes[0].velocityZ !== velocities[0][2]).toBe(true);
    expect(renderer.flakes[1].velocityX !== velocities[1][0]
      || renderer.flakes[1].velocityY !== velocities[1][1]
      || renderer.flakes[1].velocityZ !== velocities[1][2]).toBe(true);
  });

  it('keeps grabbed flakes kinematic during a swept impact', () => {
    const renderer = new ThreeDSnowRenderer(null);
    renderer.viewportWidth = 100;
    renderer.viewportHeight = 100;
    renderer.flakes = [
      { x: 50, y: 50, z: 0, size: 2, mass: 1, velocityX: 1200, velocityY: 0, velocityZ: 0 },
      { x: 50, y: 50, z: 0, size: 2, mass: 1, isGrabbed: true, velocityX: 0, velocityY: 0, velocityZ: 0 }
    ];

    renderer._resolveCollisions(
      [{ x: 10, y: 0, z: 0, scale: 1 }, { x: 0, y: 0, z: 0, scale: 1 }],
      [{ x: -10, y: 0, z: 0, scale: 1 }, { x: 0, y: 0, z: 0, scale: 1 }],
      1 / 60
    );

    expect(renderer.flakes[0].velocityX).toBeLessThan(0);
    expect(renderer.flakes[1].velocityX).toBe(0);
    expect(renderer.flakes[1].y).toBe(50);
  });

  it('does not sweep collision paths across viewport wraps', () => {
    const renderer = new ThreeDSnowRenderer(null);
    renderer.config = { gravity: 0 };
    renderer.viewportWidth = 100;
    renderer.viewportHeight = 100;
    renderer.flakes = [
      {
        x: -1.9, y: 50, z: 0, size: 2,
        velocityX: -900, velocityY: 0, velocityZ: 0,
        rotationX: 0, rotationY: 0, rotationZ: 0,
        rotationSpeedX: 0, rotationSpeedY: 0, rotationSpeedZ: 0
      },
      {
        x: 50, y: 50, z: 0, size: 2,
        velocityX: 0, velocityY: 0, velocityZ: 0,
        rotationX: 0, rotationY: 0, rotationZ: 0,
        rotationSpeedX: 0, rotationSpeedY: 0, rotationSpeedZ: 0
      }
    ];

    renderer._updateInstances(1 / 60);

    expect(renderer.flakes[0].x).toBeGreaterThan(100);
    expect(renderer.flakes[1].velocityX).toBe(0);
    expect(renderer.flakes[1].velocityY).toBe(0);
  });

  it('uses full vertical velocity and leaves a grabbed 3D support kinematic', () => {
    const renderer = new ThreeDSnowRenderer(null);
    renderer.viewportWidth = 100;
    renderer.viewportHeight = 100;
    renderer.flakes = [
      { x: 50, y: 50, z: 0, size: 20, mass: 1, velocityX: 0, velocityY: 100, velocityZ: 0 },
      { x: 50, y: 65, z: 0, size: 20, mass: 1, velocityX: 0, velocityY: 0, velocityZ: 0 }
    ];
    renderer._resolveCollisions([
      { x: 0, y: 0, z: 0, scale: 1 },
      { x: 0, y: -15, z: 0, scale: 1 }
    ]);

    expect(renderer.flakes[0].velocityY).toBeCloseTo(22.5);
    expect(renderer.flakes[1].velocityY).toBeCloseTo(77.5);
    expect(renderer.flakes[0].velocityY + renderer.flakes[1].velocityY).toBeCloseTo(100);

    renderer.flakes = [
      { x: 50, y: 50, z: 0, size: 20, mass: 1, isGrabbed: true, velocityX: 0, velocityY: 0, velocityZ: 0 },
      { x: 65, y: 50, z: 0, size: 20, mass: 1, velocityX: -10, velocityY: 0, velocityZ: 0 }
    ];
    renderer._resolveCollisions([
      { x: 0, y: 0, z: 0, scale: 1 },
      { x: 15, y: 0, z: 0, scale: 1 }
    ]);

    expect(renderer.flakes[0].velocityX).toBe(0);
    expect(renderer.flakes[1].velocityX).toBeGreaterThan(0);
  });

  it('attenuates projected pointer forces with 3D depth', () => {
    const renderer = new ThreeDSnowRenderer(null, { mouseRadius: 100, mouseForce: 300 });
    renderer.mouseX = 0;
    renderer.mouseY = 0;
    renderer.mouseRightPressed = true;
    const near = { x: 50, y: 0, z: 0, velocityX: 0, velocityY: 0, velocityZ: 0 };
    const far = { x: 50, y: 0, z: 1000, velocityX: 0, velocityY: 0, velocityZ: 0 };

    renderer._applyMouseForce(near, 1 / 60);
    renderer._applyMouseForce(far, 1 / 60);

    expect(near.velocityX).toBeLessThan(0);
    expect(far.velocityX).toBeLessThan(0);
    expect(Math.abs(near.velocityX)).toBeGreaterThan(Math.abs(far.velocityX));
  });

  it.each(['blower', 'suction'])('matches the shared held %s force at the 3D screen plane', (mode) => {
    const renderer = new ThreeDSnowRenderer(null, { mouseRadius: 100, mouseForce: 300 });
    renderer.mouseX = 0;
    renderer.mouseY = 0;
    renderer.mouseLeftPressed = mode === 'blower';
    renderer.mouseRightPressed = mode === 'suction';
    const actual = { x: 50, y: 0, z: 0, velocityX: 0, velocityY: 0, velocityZ: 0 };
    const expected = { ...actual };
    applyMouseFieldForce(expected, 0, 0, 350, mode, 3000, 1 / 60);

    renderer._applyMouseForce(actual, 1 / 60);

    expect(actual.velocityX).toBeCloseTo(expected.velocityX);
    expect(actual.velocityY).toBeCloseTo(expected.velocityY);
    expect(actual.velocityZ).toBe(0);
  });

  it('attenuates the one-shot explosion with 3D depth', () => {
    const renderer = new ThreeDSnowRenderer(null, { mouseRadius: 100, mouseForce: 300 });
    const near = { x: 50, y: 0, z: 0, size: 20, velocityX: 0, velocityY: 0 };
    const far = { x: 50, y: 0, z: 1000, size: 20, velocityX: 0, velocityY: 0 };
    renderer.flakes = [near, far];

    renderer.onMouseDown(0, 0, 0);

    expect(near.velocityX).toBeGreaterThan(0);
    expect(far.velocityX).toBeGreaterThan(0);
    expect(near.velocityX).toBeGreaterThan(far.velocityX);
  });

  it('twinkles the glow per flake within the configured flicker depth', () => {
    const flake = { twinkleSpeedA: 2.3, twinkleSpeedB: 6.1, twinklePhaseA: 0.4, twinklePhaseB: 1.7 };
    const samples = Array.from({ length: 400 }, (_, index) => resolveGlowFlicker(index * 0.05, flake, 0.5));

    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0.5);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1);
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.25);
    expect(resolveGlowFlicker(1, flake, 0)).toBe(1);
    expect(resolveGlowFlicker(1, {}, 0.5)).toBe(1);
  });

  it('starts snowfall above the viewport and fast-forwards only with an offset', () => {
    for (let i = 0; i < 50; i++) {
      const y = resolveInitialFlakeY(20, 800, 100, 0);
      expect(y).toBeLessThanOrEqual(-20);
      expect(y).toBeGreaterThanOrEqual(-820);
      const resumed = resolveInitialFlakeY(20, 800, 100, 30);
      expect(resumed).toBeGreaterThanOrEqual(-20);
      expect(resumed).toBeLessThanOrEqual(820);
      const instant = resolveInitialFlakeY(20, 800, 100, 0, 0.35);
      expect(instant).toBeLessThanOrEqual(-20);
      expect(instant).toBeGreaterThanOrEqual(-20 - 800 * 0.35);
    }
  });

  it('merges extruded faces and keeps texture coordinates inside the glyph image', () => {
    const geometry = createGlyphGeometry(new Uint8Array(9).fill(1), 3, 3, 0.1);
    expect(geometry.getAttribute('position').count).toBe(36);
    const uvs = Array.from(geometry.getAttribute('uv').array);
    expect(uvs.length).toBe(72);
    uvs.forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });
    geometry.dispose();
  });

  it('sizes glyph geometry in font units so 3D flakes match the configured size', () => {
    // A 44 px ink box rendered at an 88 px font is half of the flake size, as in Canvas 2D.
    const geometry = createGlyphGeometry(new Uint8Array(44 * 44).fill(1), 44, 44, 0.1, 88, 88, -22, -22);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    expect(box.max.x - box.min.x).toBeCloseTo(0.5);
    expect(box.max.y - box.min.y).toBeCloseTo(0.5);
    expect(box.max.x + box.min.x).toBeCloseTo(0);
    geometry.dispose();
  });

  it('eases the glow toward a new background instead of switching abruptly', () => {
    const renderer = new ThreeDSnowRenderer(null);
    renderer.glowPass = { setGlowState: vi.fn() };
    renderer.glowCurrent = { strength: 1, whiten: 0, r: 0, g: 0, b: 0 };
    renderer.glowTarget = { strength: 0.4, whiten: 1, r: 1, g: 1, b: 1 };

    renderer._stepGlowState(0.05);
    expect(renderer.glowCurrent.whiten).toBeGreaterThan(0);
    expect(renderer.glowCurrent.whiten).toBeLessThan(0.5);
    for (let i = 0; i < 200; i++) renderer._stepGlowState(0.05);
    expect(renderer.glowCurrent).toEqual(renderer.glowTarget);
    expect(renderer.glowPass.setGlowState).toHaveBeenLastCalledWith(0.4, 1, renderer.glowCurrent);
  });
});
