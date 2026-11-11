import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParticleEnvironment } from '../src/content/physics/particle-environment.js';
import { SnowWebGPUController } from '../src/content/snow-controller.js';
import { WebGPURenderer } from '../src/content/webgpu-renderer.js';
import { Fallback2DRenderer } from '../src/content/fallback-2d-renderer.js';
import { ThreeDSnowRenderer } from '../src/content/three-d-renderer.js';

const makeFlake = (overrides = {}) => ({
  x: 120, baseX: 120, y: 170, size: 20, char: '❄', glyph: '❄', glyphIndex: 0,
  fallSpeed: 30, velocityX: 0, velocityY: 0, velocityZ: 0, z: 0,
  phase: 0, freq: 1, sway: 0, rotationSpeed: 0, cumulativeSpin: 0, color: { r: 1, g: 1, b: 1 },
  rotationX: 0, rotationY: 0, rotationZ: 0, rotationSpeedX: 0, rotationSpeedY: 0, rotationSpeedZ: 0,
  ...overrides
});

describe('DOM accumulation and finite particle lifecycle', () => {
  let environments;
  let figure;
  let rect;
  const create = (config = {}, complete = vi.fn()) => {
    const environment = new ParticleEnvironment(config, complete);
    environments.push(environment);
    return environment;
  };
  const land = (environment, flakes = [makeFlake()]) => {
    environment.beginFrame(1 / 60, flakes, 800, 600);
    flakes.forEach((flake) => { flake.y = 195; });
    environment.finishFrame();
    return flakes[0];
  };

  it('updates 3D wind before accumulation reads its current state', () => {
    const renderer = new ThreeDSnowRenderer(null, { enableCollisions: false });
    const order = [];
    renderer._stepWind = () => {
      order.push('wind');
      renderer.currentWindForce = 1;
    };
    renderer.environment = {
      beginFrame: () => order.push('accumulate'),
      finishFrame: vi.fn()
    };

    renderer._updateInstances(1 / 60);

    expect(order).toEqual(['wind', 'accumulate']);
  });

  it('updates WebGPU wind before accumulation reads its current state', () => {
    const renderer = new WebGPURenderer(null, {
      enableCollisions: false, windEnabled: true, windDirection: 'right',
      windStrength: 3, windGustFrequency: 3, windVortexStrength: 0.35
    });
    renderer.windTime = 2;
    let windAtFrameStart;
    renderer.environment = {
      beginFrame: (_delta, _flakes, _width, _height, wind) => {
        windAtFrameStart = wind.currentWindForce;
      },
      finishFrame: vi.fn()
    };

    renderer.updateSimulation(1 / 60);

    expect(windAtFrameStart).toBe(renderer.currentWindForce);
    expect(windAtFrameStart).not.toBe(0);
  });

  beforeEach(() => {
    environments = [];
    document.body.innerHTML = '<figure style="visibility:visible;opacity:1"></figure>';
    figure = document.querySelector('figure');
    rect = { left: 50, right: 750, top: 200, bottom: 400, width: 700, height: 200 };
    vi.spyOn(figure, 'getBoundingClientRect').mockImplementation(() => rect);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true, writable: true,
      value: vi.fn((x, y) => y >= rect.top && y <= rect.bottom ? figure : document.body)
    });
  });

  afterEach(() => {
    environments.forEach((environment) => environment.destroy());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete document.elementFromPoint;
    document.body.innerHTML = '';
  });

  it('lands emoji in one bounded row above a visible surface, not over its contents', () => {
    const environment = create();
    const flake = land(environment);
    expect(environment.surfaces.surfaces).toHaveLength(1);
    expect(flake.isSettled).toBe(true);
    expect(flake.y + flake.size / 2).toBe(198);
    expect(flake.velocityY).toBe(0);
    expect(environment.settled.size).toBe(1);
  });

  it('lands at the swept contact point when a diagonal fall ends outside the surface', () => {
    rect = { ...rect, right: 250, width: 200 };
    const environment = create();
    const flake = makeFlake({ x: 200, baseX: 200 });
    environment.beginFrame(0.05, [flake], 800, 600);
    flake.x = flake.baseX = 280;
    flake.y = 210;

    environment.finishFrame();

    expect(flake.isSettled).toBe(true);
    expect(flake.x).toBeCloseTo(236);
    expect(flake.baseX).toBe(flake.x);
    expect(flake.y).toBe(188);
  });

  it.each(['2d', 'webgpu', '3d'])('resolves diagonal landings in the actual %s update loop', (mode) => {
    rect = { ...rect, right: 250, width: 200 };
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const environment = create();
    const flake = makeFlake({ x: 200, baseX: 200, fallSpeed: 800, velocityX: 1600 });
    const Renderer = { '2d': Fallback2DRenderer, webgpu: WebGPURenderer, '3d': ThreeDSnowRenderer }[mode];
    const renderer = new Renderer(document.createElement('canvas'), {
      enableCollisions: false, windEnabled: false, mouseRadius: 0, maxFlakeSpeed: 2000
    });
    renderer.environment = environment;
    renderer.viewportWidth = 800;
    renderer.viewportHeight = 600;
    if (mode === 'webgpu') {
      renderer.instances = [flake];
      renderer.instanceData = new Float32Array(14);
      renderer.updateSimulation(0.05);
    } else {
      renderer.flakes = [flake];
      if (mode === '3d') {
        renderer._updateInstances(0.05);
      } else {
        renderer.ctx = {
          clearRect: vi.fn(), resetTransform: vi.fn(), setTransform: vi.fn(), fillText: vi.fn(),
          save: vi.fn(), restore: vi.fn(),
          measureText: vi.fn(() => ({ actualBoundingBoxLeft: 0, actualBoundingBoxRight: 20 }))
        };
        renderer.start();
        renderer.drawCallback(1050);
        renderer.stop();
      }
    }

    expect(flake.isSettled).toBe(true);
    expect(flake.x).toBeCloseTo(236);
    expect(flake.y).toBe(188);
  });

  it('lands on the first crossed surface rather than the first element in DOM order', () => {
    rect = { ...rect, bottom: 240, height: 40 };
    const lower = document.createElement('article');
    lower.style.cssText = 'visibility:visible;opacity:1';
    const lowerRect = { ...rect, top: 300, bottom: 400, height: 100 };
    lower.getBoundingClientRect = () => lowerRect;
    document.body.prepend(lower);
    document.elementFromPoint.mockImplementation((x, y) => {
      if (y >= rect.top && y <= rect.bottom) return figure;
      if (y >= lowerRect.top && y <= lowerRect.bottom) return lower;
      return document.body;
    });
    const environment = create();
    const flake = makeFlake();
    environment.beginFrame(0.05, [flake], 800, 600);
    flake.y = 340;

    environment.finishFrame();

    expect(flake.isSettled).toBe(true);
    expect(environment.settled.get(flake).element).toBe(figure);
    expect(flake.y).toBe(188);
  });

  it('does not tunnel through an earlier DOM surface to collide with a lower pile', () => {
    rect = { ...rect, bottom: 240, height: 40 };
    const lower = document.createElement('article');
    lower.style.cssText = 'visibility:visible;opacity:1';
    const lowerRect = { ...rect, top: 300, bottom: 400, height: 100 };
    lower.getBoundingClientRect = () => lowerRect;
    document.body.appendChild(lower);
    document.elementFromPoint.mockImplementation((x, y) => {
      if (y >= rect.top && y <= rect.bottom) return figure;
      if (y >= lowerRect.top && y <= lowerRect.bottom) return lower;
      return document.body;
    });
    const environment = create();
    const support = makeFlake({ y: 288 });
    environment.settle(support, { element: lower, ...lowerRect }, 288);
    const incoming = makeFlake();
    environment.beginFrame(0.05, [support, incoming], 800, 600);
    incoming.y = 340;

    environment.finishFrame();

    expect(incoming.isSettled).toBe(true);
    expect(environment.settled.get(incoming).element).toBe(figure);
    expect(incoming.y).toBe(188);
    expect(support.isSettled).toBe(true);
  });

  it('does not accumulate sentences, non-emoji, oversized particles, or rising particles', () => {
    const environment = create();
    for (const overrides of [
      { isSentence: true }, { char: 'text', glyph: 'text' }, { size: 49 }, { y: 196 }
    ]) {
      expect(land(environment, [makeFlake(overrides)]).isSettled).not.toBe(true);
    }
  });

  it('never covers links, controls, text, media, or an occluded surface', () => {
    const environment = create();
    for (const tag of ['a', 'button', 'input', 'p', 'h2', 'img', 'svg']) {
      const blocker = document.createElement(tag);
      document.body.appendChild(blocker);
      document.elementFromPoint.mockImplementation((x, y) => y < rect.top ? blocker : figure);
      expect(land(environment).isSettled).not.toBe(true);
      blocker.remove();
    }
    document.elementFromPoint.mockReturnValue(document.body);
    expect(land(environment).isSettled).not.toBe(true);
  });

  it('checks text range geometry in otherwise neutral containers', () => {
    const span = document.createElement('span');
    span.textContent = 'Important information';
    document.body.appendChild(span);
    const range = {
      selectNodeContents: vi.fn(),
      getClientRects: () => [{ left: 100, right: 180, top: 175, bottom: 195 }]
    };
    vi.spyOn(document, 'createRange').mockReturnValue(range);
    document.elementFromPoint.mockImplementation((x, y) => y < rect.top ? span : figure);
    expect(land(create()).isSettled).not.toBe(true);
    expect(range.selectNodeContents).toHaveBeenCalled();
  });

  it('lets a strong impact dislodge a flake in another layer without snapping to its coordinates', () => {
    const first = create();
    const second = create();
    const flake = land(first);
    const incoming = land(second, [makeFlake({ x: 124, y: 150, fallSpeed: 180 })]);
    expect(incoming.isSettled).toBe(true);
    expect(incoming.x).toBe(124);
    expect(flake.isSettled).toBe(false);
    expect(flake.hasShed).toBe(true);
    expect(flake.velocityY).toBeGreaterThan(0);
    expect(first.settled.size).toBe(0);
    expect(second.settled.size).toBe(1);
    expect(first.surfaces).toBe(second.surfaces);
  });

  it('lets a weak impact roll off and physically fall beside the existing flake without snapping', () => {
    const environment = create();
    const old = land(environment);
    const incoming = land(environment, [makeFlake({ x: 120, y: 150, fallSpeed: 30 })]);
    expect(old.isSettled).toBe(true);
    expect(incoming.isSettled).not.toBe(true);
    expect(Math.abs(incoming.x - 120)).toBeLessThan(1);
    expect(incoming.y).toBeLessThanOrEqual(166);
    expect(incoming.velocityX).not.toBe(0);
    for (let frame = 0; frame < 600 && !incoming.isSettled; frame++) {
      const previousX = incoming.x;
      environment.beginFrame(1 / 60, [incoming], 800, 600);
      incoming.x += incoming.velocityX / 60;
      incoming.y += (incoming.fallSpeed + incoming.velocityY) / 60;
      incoming.velocityY *= 0.98;
      environment.finishFrame();
      expect(Math.abs(incoming.x - previousX)).toBeLessThan(2);
    }
    expect(incoming.isSettled, JSON.stringify({
      x: incoming.x, y: incoming.y, vx: incoming.velocityX, vy: incoming.velocityY
    })).toBe(true);
    expect(Math.abs(incoming.x - old.x)).toBeGreaterThanOrEqual(22 - 0.001);
    expect(incoming.y).toBe(old.y);
    expect(environment.settled.size).toBe(2);
  });

  it('does not pull a flake onto the second row before it reaches that height', () => {
    rect = { ...rect, left: 80, right: 144, width: 64 };
    const environment = create();
    land(environment, [makeFlake({ x: 98 })]);
    land(environment, [makeFlake({ x: 121 })]);
    const incoming = makeFlake({ x: 98, y: 120 });
    environment.beginFrame(1 / 60, [incoming], 800, 600);
    incoming.y = 121;
    environment.finishFrame();
    expect(incoming.isSettled).not.toBe(true);
    expect(incoming.x).toBe(98);
    expect(incoming.y).toBe(121);
  });

  it.each([30, 60, 120])('settles between two supports without bouncing or jumping at %s FPS', (hz) => {
    const environment = create();
    const left = land(environment, [makeFlake({ x: 110 })]);
    const right = land(environment, [makeFlake({ x: 133 })]);
    const incoming = makeFlake({ x: 121.5, y: 145 });
    for (let frame = 0; frame < hz * 4 && !incoming.isSettled; frame++) {
      const { x, y } = incoming;
      environment.beginFrame(1 / hz, [left, right, incoming], 800, 600);
      if (!incoming.isSettled) {
        incoming.x += incoming.velocityX / hz;
        incoming.y += (incoming.fallSpeed + incoming.velocityY) / hz;
        incoming.velocityX *= Math.pow(0.98, 60 / hz);
        incoming.velocityY *= Math.pow(0.98, 60 / hz);
      }
      environment.finishFrame();
      expect(Math.hypot(incoming.x - x, incoming.y - y)).toBeLessThan(1.1);
      for (const support of [left, right]) {
        expect(Math.hypot(incoming.x - support.x, incoming.y - support.y)).toBeGreaterThanOrEqual(22 - 0.05);
      }
    }
    expect(incoming.isSettled).toBe(true);
    expect(incoming.x).toBeGreaterThan(left.x);
    expect(incoming.x).toBeLessThan(right.x);
  });

  it.each([
    [40, 40, 8, 44],
    [8, 40, 12, 30],
    [40, 8, 12, 30],
    [20, 20, 20, 40],
    [20, 20, 20, 43],
    [40, 40, 4, 44]
  ])('settles a %s/%s support pocket with a size %s flake and spacing %s', (leftSize, rightSize, size, spacing) => {
    for (const hz of [30, 60, 120]) {
      const environment = create();
      const left = land(environment, [makeFlake({ x: 110, size: leftSize })]);
      const right = land(environment, [makeFlake({ x: 110 + spacing, size: rightSize })]);
      expect(left.isSettled).toBe(true);
      expect(right.isSettled).toBe(true);
      const incoming = makeFlake({ x: 110 + spacing / 2, y: 120, size });
      for (let frame = 0; frame < hz * 8 && !incoming.isSettled && !incoming.hasShed; frame++) {
        environment.beginFrame(1 / hz, [left, right, incoming], 800, 600);
        if (!incoming.isSettled) {
          incoming.x += incoming.velocityX / hz;
          incoming.y += (incoming.fallSpeed + incoming.velocityY) / hz;
          incoming.velocityX *= Math.pow(0.98, 60 / hz);
          incoming.velocityY *= Math.pow(0.98, 60 / hz);
        }
        environment.finishFrame();
      }
      expect(incoming.isSettled, JSON.stringify({
        hz, x: incoming.x, y: incoming.y, vx: incoming.velocityX, vy: incoming.velocityY,
        contacts: environment.restingContacts.get(incoming)
      })).toBe(true);
      for (const support of [left, right]) {
        expect(Math.hypot(incoming.x - support.x, incoming.y - support.y))
          .toBeGreaterThanOrEqual((incoming.size + support.size) / 2 + 2 - 0.05);
      }
      environment.destroy();
    }
  });

  it.each([30, 60, 120])('settles asymmetric pockets under continued snowfall at %s FPS', (hz) => {
    for (const finiteParticles of [false, true]) {
      for (const fallSpeed of [30, 80]) {
        for (const spacing of [23, 35, 40, 43]) {
          for (const offset of [-3, 0, 3]) {
            const environment = create({ finiteParticles });
            const left = land(environment, [makeFlake({ x: 110, size: 20.13 })]);
            const right = land(environment, [makeFlake({ x: 110 + spacing, size: 20.23 })]);
            const incoming = makeFlake({ x: 110 + spacing / 2 + offset, y: 145, size: 20.17, fallSpeed });
            for (let frame = 0; frame < hz * 6 && !incoming.isSettled && !incoming.hasShed; frame++) {
              environment.beginFrame(1 / hz, [left, right, incoming], 800, 600);
              if (!incoming.isSettled) {
                incoming.x += incoming.velocityX / hz;
                incoming.y += (incoming.fallSpeed + incoming.velocityY) / hz;
                incoming.velocityX *= Math.pow(0.98, 60 / hz);
                incoming.velocityY *= Math.pow(0.98, 60 / hz);
              }
              environment.finishFrame();
            }
            expect(incoming.isSettled, JSON.stringify({
              hz, finiteParticles, fallSpeed, spacing, offset,
              x: incoming.x, y: incoming.y, contacts: environment.restingContacts.get(incoming)
            })).toBe(true);
            environment.destroy();
          }
        }
      }
    }
  });

  it('preserves the contact height when immediately settling at an angle', () => {
    rect = { ...rect, left: 80, right: 144, width: 64 };
    const environment = create();
    const support = land(environment, [makeFlake({ x: 98 })]);
    land(environment, [makeFlake({ x: 121 })]);
    const incoming = makeFlake({ x: 103, y: 160 });
    const height = support.y - Math.sqrt(22 ** 2 - 5 ** 2);
    environment.beginFrame(1 / 60, [incoming], 800, 600);
    incoming.y = height + 0.1;
    environment.finishFrame();
    expect(incoming.isSettled).toBe(true);
    expect(incoming.x).toBe(103);
    expect(incoming.y).toBeCloseTo(height, 6);
  });

  it.each([
    { size: 49 },
    { char: '*', glyph: '*' },
    { isSentence: true }
  ])('releases particles that cannot accumulate when trapped between supports: %j', (overrides) => {
    const environment = create();
    const left = land(environment, [makeFlake({ x: 110 })]);
    const right = land(environment, [makeFlake({ x: 133 })]);
    const incoming = makeFlake({ x: 121.5, y: 120, ...overrides });
    for (let frame = 0; frame < 360; frame++) {
      environment.beginFrame(1 / 60, [left, right, incoming], 800, 600);
      incoming.x += incoming.velocityX / 60;
      incoming.y += (incoming.fallSpeed + incoming.velocityY) / 60;
      incoming.velocityX *= 0.98;
      incoming.velocityY *= 0.98;
      environment.finishFrame();
    }
    expect(incoming.isSettled).not.toBe(true);
    expect(incoming.hasShed).toBe(true);
    expect(incoming.y).toBeGreaterThan(250);
    expect(left.isSettled).toBe(true);
    expect(right.isSettled).toBe(true);
  });

  it.each([30, 60, 120])('releases a pile contact outside the visible top at %s FPS', (hz) => {
    rect = { ...rect, top: 28 };
    const environment = create();
    const surface = { element: figure, ...rect };
    const left = makeFlake({ x: 110, y: 16 });
    const right = makeFlake({ x: 133, y: 16 });
    environment.settle(left, surface, 16);
    environment.settle(right, surface, 16);
    const incoming = makeFlake({ x: 121.5, y: -30 });
    for (let frame = 0; frame < hz * 4; frame++) {
      environment.beginFrame(1 / hz, [left, right, incoming], 800, 600);
      incoming.x += incoming.velocityX / hz;
      incoming.y += (incoming.fallSpeed + incoming.velocityY) / hz;
      incoming.velocityX *= Math.pow(0.98, 60 / hz);
      incoming.velocityY *= Math.pow(0.98, 60 / hz);
      environment.finishFrame();
      if (environment.contactsChanged && incoming.y - incoming.size / 2 < 0) {
        expect(incoming.hasShed).toBe(true);
      }
    }
    expect(incoming.isSettled).not.toBe(true);
    expect(incoming.hasShed).toBe(true);
    expect(incoming.y).toBeGreaterThan(100);
  });

  it('sheds an upper row moved above the viewport by a layout change', () => {
    const environment = create();
    const support = land(environment);
    const upper = makeFlake({ y: 166 });
    expect(environment.settle(upper, environment.settled.get(support), 166, support)).toBe(true);
    rect = { ...rect, top: 28 };
    environment.beginFrame(1 / 60, [support, upper], 800, 600);
    expect(support.isSettled).toBe(true);
    expect(upper.isSettled).toBe(false);
    expect(upper.hasShed).toBe(true);
  });

  it.each([30, 60, 120])('recognizes a two-support pocket despite alternating contacts at %s FPS', (hz) => {
    const environment = create();
    const left = land(environment, [makeFlake({ x: 110 })]);
    const right = land(environment, [makeFlake({ x: 133 })]);
    const incoming = makeFlake({ x: 121.5, fallSpeed: 0 });
    for (let frame = 0; frame < hz && !incoming.isSettled; frame++) {
      incoming.x = incoming.baseX = 121.5 + (frame % 2 ? 0.6 : -0.6);
      incoming.y = Math.min(...[left, right].map((support) =>
        support.y - Math.sqrt(22 ** 2 - (incoming.x - support.x) ** 2)));
      environment.beginFrame(1 / hz, [left, right, incoming], 800, 600);
      environment.finishFrame();
    }
    expect(incoming.isSettled).toBe(true);
    expect(environment.settled.get(incoming).supports).toEqual(expect.arrayContaining([left, right]));
    const position = { x: incoming.x, y: incoming.y };
    for (let frame = 0; frame < hz * 2; frame++) {
      environment.beginFrame(1 / hz, [left, right, incoming], 800, 600);
      environment.finishFrame();
      expect(incoming.isSettled).toBe(true);
      expect(incoming.x).toBe(position.x);
      expect(incoming.y).toBe(position.y);
    }
    const otherSupport = environment.settled.get(incoming).support === left ? right : left;
    environment.release(otherSupport);
    expect(incoming.isSettled).toBe(false);
  });

  it.each([Fallback2DRenderer, WebGPURenderer, ThreeDSnowRenderer].flatMap((Renderer) =>
    [23, 43].map((spacing) => [Renderer, spacing])))(
    'makes a falling fractional-sized flake part of the pile between neighbours in %s with spacing %s',
    (Renderer, spacing) => {
      for (const hz of [30, 60, 120]) {
        const environment = create();
        const left = land(environment, [makeFlake({ x: 110, size: 20.13 })]);
        const right = land(environment, [makeFlake({ x: 110 + spacing, size: 20.23 })]);
        const incoming = makeFlake({ x: 110 + spacing / 2, y: 145, size: 20.17 });
        const particles = [left, right, incoming];
        const renderer = new Renderer(document.createElement('canvas'), {
          windEnabled: false, enableCollisions: true, mouseRadius: 0
        });
        renderer.environment = environment;
        renderer.viewportWidth = 800;
        renderer.viewportHeight = 600;
        if (renderer instanceof WebGPURenderer) {
          renderer.instances = particles;
          renderer.instanceData = new Float32Array(42);
        } else renderer.flakes = particles;
        if (renderer instanceof Fallback2DRenderer) {
          renderer.ctx = {
            clearRect: vi.fn(), resetTransform: vi.fn(), setTransform: vi.fn(), fillText: vi.fn(),
            save: vi.fn(), restore: vi.fn(),
            measureText: vi.fn(() => ({ actualBoundingBoxLeft: 0, actualBoundingBoxRight: 20 }))
          };
          renderer.start();
        }
        let now = performance.now();
        for (let frame = 0; frame < hz * 4; frame++) {
          const previous = { x: incoming.x, y: incoming.y };
          if (renderer instanceof WebGPURenderer) renderer.updateSimulation(1 / hz);
          else if (renderer instanceof ThreeDSnowRenderer) renderer._updateInstances(1 / hz);
          else {
            now += 1000 / hz;
            renderer.drawCallback(now);
          }
          expect(Math.hypot(incoming.x - previous.x, incoming.y - previous.y)).toBeLessThan(1.2);
        }
        expect(incoming.isSettled).toBe(true);
        const supports = environment.settled.get(incoming).supports;
        expect(supports.length).toBeGreaterThanOrEqual(1);
        for (const other of [left, right]) {
          const gap = Math.hypot(incoming.x - other.x, incoming.y - other.y)
            - (incoming.size + other.size) / 2 - 2;
          expect(gap).toBeGreaterThanOrEqual(-0.05);
          if (gap <= 1) expect(supports).toContain(other);
        }
        expect(incoming.swayLimit).toBe(0);
        if (renderer instanceof Fallback2DRenderer) renderer.stop();
        environment.destroy();
      }
    }
  );

  it.each([Fallback2DRenderer, WebGPURenderer, ThreeDSnowRenderer])(
    'does not trap rejected or offscreen pile contacts in %s',
    (Renderer) => {
      for (const hz of [30, 60, 120]) {
        for (const scenario of ['oversized', 'text', 'top']) {
          rect = { ...rect, top: scenario === 'top' ? 28 : 200 };
          const environment = create({ finiteParticles: true });
          const surface = { element: figure, ...rect };
          const left = makeFlake({ x: 110, y: rect.top - 12 });
          const right = makeFlake({ x: 133, y: rect.top - 12 });
          environment.settle(left, surface, left.y);
          environment.settle(right, surface, right.y);
          const incoming = makeFlake({
            x: 121.5, y: rect.top - 80,
            ...(scenario === 'oversized' ? { size: 49 } : {}),
            ...(scenario === 'text' ? { char: '*', glyph: '*' } : {})
          });
          const particles = [left, right, incoming];
          const renderer = new Renderer(document.createElement('canvas'), {
            windEnabled: false, enableCollisions: true, mouseRadius: 0
          });
          renderer.environment = environment;
          renderer.viewportWidth = 800;
          renderer.viewportHeight = 600;
          if (renderer instanceof WebGPURenderer) {
            renderer.instances = particles;
            renderer.instanceData = new Float32Array(42);
          } else renderer.flakes = particles;
          if (renderer instanceof Fallback2DRenderer) {
            renderer.ctx = {
              clearRect: vi.fn(), resetTransform: vi.fn(), setTransform: vi.fn(), fillText: vi.fn(),
              save: vi.fn(), restore: vi.fn(),
              measureText: vi.fn(() => ({ actualBoundingBoxLeft: 0, actualBoundingBoxRight: 20 }))
            };
            renderer.start();
          }
          let now = performance.now();
          for (let frame = 0; frame < hz * 4; frame++) {
            if (renderer instanceof WebGPURenderer) renderer.updateSimulation(1 / hz);
            else if (renderer instanceof ThreeDSnowRenderer) renderer._updateInstances(1 / hz);
            else {
              now += 1000 / hz;
              renderer.drawCallback(now);
            }
          }
          expect(incoming.isSettled, scenario).not.toBe(true);
          expect(incoming.hasShed, scenario).toBe(true);
          expect(incoming.y, scenario).toBeGreaterThan(rect.top + 40);
          expect(left.isSettled).toBe(true);
          expect(right.isSettled).toBe(true);
          if (renderer instanceof Fallback2DRenderer) renderer.stop();
          environment.destroy();
        }
      }
    }
  );

  it('preserves the visible angle when a rotating flake lands', () => {
    const environment = create();
    const incoming = makeFlake({
      rotation: 1, cumulativeSpin: 2, _sinPhase: 0.6, swayLimit: 0.8,
      rotationX: 0.7, rotationY: 1.2, rotationZ: 2.3,
      rotationSpeedX: 1, rotationSpeedY: 2, rotationSpeedZ: 3
    });
    land(environment, [incoming]);
    expect(incoming.cumulativeSpin).toBeCloseTo(2 + 0.6 * 0.35 * 0.8);
    expect(incoming.rotationX).toBe(0.7);
    expect(incoming.rotationY).toBe(1.2);
    expect(incoming.rotationZ).toBe(2.3);
    expect(incoming.rotationSpeedX).toBe(0);
    expect(incoming.rotationSpeedY).toBe(0);
    expect(incoming.rotationSpeedZ).toBe(0);
  });

  it('does not teleport a released WebGPU flake to its last pile contact during airborne collisions', () => {
    const environment = create();
    const incoming = land(environment);
    environment.release(incoming);
    incoming.x = 200;
    incoming.y = 100;
    incoming.velocityX = incoming.velocityY = 0;
    const neighbour = makeFlake({ x: 125, y: 100 });
    const renderer = new WebGPURenderer(document.createElement('canvas'), { enableCollisions: true });
    renderer.environment = environment;
    renderer.viewportWidth = 800;
    renderer.viewportHeight = 600;
    renderer.instances = [incoming, neighbour];
    renderer.instanceData = new Float32Array(28);
    for (let frame = 0; frame < 60; frame++) {
      renderer.updateSimulation(1 / 60);
      expect(incoming.x).toBe(200);
      expect(neighbour.x).toBe(125);
    }
  });

  it('collides with the sides of settled flakes, including non-emoji particles', () => {
    const environment = create();
    const old = land(environment);
    const incoming = makeFlake({ x: 80, y: old.y, char: 'x', velocityX: 30 });
    environment.beginFrame(1 / 60, [incoming], 800, 600);
    incoming.x = 130;
    environment.finishFrame();
    expect(incoming.x).toBeLessThanOrEqual(98);
    expect(incoming.velocityX).toBeLessThan(0);
    expect(incoming.isSettled).not.toBe(true);
    expect(old.isSettled).toBe(true);
  });

  it('does not create an overlap with airborne particles when landing', () => {
    const environment = create();
    const incoming = makeFlake();
    const airborne = makeFlake({ x: 130, y: 188, hasShed: true });
    land(environment, [incoming, airborne]);
    expect(incoming.isSettled).not.toBe(true);
    expect(airborne.isSettled).not.toBe(true);
  });

  it.each([Fallback2DRenderer, WebGPURenderer, ThreeDSnowRenderer])(
    'processes settling before moving-particle collisions in %s',
    (Renderer) => {
      const environment = create();
      const old = land(environment);
      const incoming = makeFlake({ y: 165.5 });
      const neighbour = makeFlake({ x: 138, y: 166, hasShed: true });
      const renderer = new Renderer(document.createElement('canvas'), { enableCollisions: true });
      renderer.environment = environment;
      renderer.viewportWidth = 800;
      renderer.viewportHeight = 600;
      const particles = [old, incoming, neighbour];
      const finish = vi.spyOn(environment, 'finishFrame');
      const collision = renderer instanceof ThreeDSnowRenderer
        ? vi.spyOn(renderer, '_resolveCollisions')
        : vi.spyOn(renderer.collisionHandler, 'handleCollisions');
      if (renderer instanceof WebGPURenderer) {
        renderer.instances = particles;
        renderer.instanceData = new Float32Array(particles.length * 14);
        renderer.updateSimulation(0.05);
      } else if (renderer instanceof ThreeDSnowRenderer) {
        renderer.flakes = particles;
        renderer._updateInstances(0.05);
      } else {
        renderer.flakes = particles;
        renderer.ctx = {
          clearRect: vi.fn(), resetTransform: vi.fn(), setTransform: vi.fn(),
          fillText: vi.fn(), save: vi.fn(), restore: vi.fn(),
          measureText: vi.fn(() => ({ actualBoundingBoxLeft: 0, actualBoundingBoxRight: 20 }))
        };
        renderer.start();
        renderer.drawCallback(performance.now() + 50);
        renderer.stop();
      }
      expect(finish).toHaveBeenCalled();
      expect(collision).toHaveBeenCalled();
      expect(finish.mock.invocationCallOrder[0]).toBeLessThan(collision.mock.invocationCallOrder[0]);
      expect(incoming.isSettled).not.toBe(true);
      expect(old.isSettled).toBe(true);
      for (const flake of particles) {
        expect(Number.isFinite(flake.x)).toBe(true);
        expect(Number.isFinite(flake.y)).toBe(true);
      }
    }
  );

  it('uses speed, acceleration and relative size rather than contact alone', () => {
    const environment = create();
    const target = makeFlake();
    environment.delta = 0.02;
    const impact = (speed, previous, size = 20) => environment.canDislodge(makeFlake({
      fallSpeed: speed, previousImpactVelocity: previous, size
    }), target);
    expect(impact(99, 0)).toBe(false);
    expect(impact(159, 159)).toBe(false);
    expect(impact(160, 160)).toBe(true);
    expect(impact(120, 120)).toBe(false);
    expect(impact(120, 100)).toBe(true);
    expect(impact(180, 180, 10)).toBe(false);
    expect(impact(120, 120, 30)).toBe(true);
  });

  it('uses integrated particle velocity for impact speed regardless of renderer wind state', () => {
    const environment = create();
    const incoming = makeFlake({
      x: 100, y: 120, fallSpeed: 90, velocityX: 8, velocityY: 5
    });
    const wind = { instances: [incoming], windEnabled: true, currentWindForce: 3, currentWindLift: 2 };
    environment.beginFrame(0.02, [incoming], 800, 600, wind);

    expect(environment.impactVelocity(incoming)).toEqual({ x: 8, y: 95 });
  });

  it('requires sustained wind exposure independent of frame rate and ignores disabled wind', () => {
    for (const hz of [30, 60, 120]) {
      const environment = create();
      const flake = land(environment, [makeFlake({ x: 200 + hz })]);
      const wind = { windEnabled: false, currentWindForce: 3, currentWindLift: 0.9 };
      environment.beginFrame(1, [flake], 800, 600, wind);
      expect(flake.isSettled).toBe(true);
      wind.windEnabled = true;
      for (let frame = 0; frame < hz; frame++) {
        environment.beginFrame(1 / hz, [flake], 800, 600, wind);
      }
      expect(flake.isSettled).toBe(true);
      for (let frame = 0; frame < hz; frame++) {
        environment.beginFrame(1 / hz, [flake], 800, 600, wind);
      }
      expect(flake.isSettled).toBe(false);
      environment.destroy();
    }
  });

  it('forms a second row immediately but does not instantly attach to higher rows', () => {
    rect = { ...rect, left: 80, right: 144, width: 64 };
    const environment = create();
    const first = land(environment, [makeFlake({ x: 98 })]);
    const second = land(environment, [makeFlake({ x: 121 })]);
    const upper = land(environment, [makeFlake({ x: 98, y: 140 })]);
    expect(first.isSettled).toBe(true);
    expect(second.isSettled).toBe(true);
    expect(upper.isSettled).toBe(true);
    expect(upper.y).toBe(166);
    expect(environment.settled.get(upper).support).toBe(first);
    const upperSecond = land(environment, [makeFlake({ x: 121, y: 140 })]);
    expect(upperSecond.isSettled).toBe(true);
    const third = land(environment, [makeFlake({ x: 98, y: 100 })]);
    expect(third.isSettled).not.toBe(true);
    environment.release(first);
    expect(upper.isSettled).toBe(false);
    expect(second.isSettled).toBe(true);
  });

  it.each([30, 60, 120])('makes a flake blocked between upper-row supports part of the pile at %s FPS', (hz) => {
    const environment = create();
    const lowerLeft = land(environment, [makeFlake({ x: 110 })]);
    const lowerRight = land(environment, [makeFlake({ x: 133 })]);
    const left = makeFlake({ x: 110, y: 166 });
    const right = makeFlake({ x: 133, y: 166 });
    environment.settle(left, environment.settled.get(lowerLeft), 166, lowerLeft);
    environment.settle(right, environment.settled.get(lowerRight), 166, lowerRight);
    const incoming = makeFlake({ x: 121.5, y: 120 });
    const particles = [lowerLeft, lowerRight, left, right, incoming];
    for (let frame = 0; frame < hz * 5 && !incoming.isSettled; frame++) {
      const { x, y } = incoming;
      environment.beginFrame(1 / hz, particles, 800, 600);
      if (!incoming.isSettled) {
        incoming.x += incoming.velocityX / hz;
        incoming.y += (incoming.fallSpeed + incoming.velocityY) / hz;
        incoming.velocityX *= Math.pow(0.98, 60 / hz);
        incoming.velocityY *= Math.pow(0.98, 60 / hz);
      }
      environment.finishFrame();
      expect(Math.hypot(incoming.x - x, incoming.y - y)).toBeLessThan(1.1);
    }
    expect(incoming.isSettled).toBe(true);
    const placement = environment.settled.get(incoming);
    expect([left, right]).toContain(placement.support);
    const position = { x: incoming.x, y: incoming.y };
    for (let frame = 0; frame < hz * 2; frame++) {
      environment.beginFrame(1 / hz, particles, 800, 600);
      environment.finishFrame();
      expect(incoming.isSettled).toBe(true);
      expect(incoming.x).toBe(position.x);
      expect(incoming.y).toBe(position.y);
    }
    environment.release(placement.support);
    expect(incoming.isSettled).toBe(false);
  });

  it('recognizes stationary sloping contacts but never fixes unsupported or side-only flakes', () => {
    const environment = create();
    const support = land(environment);
    const contact = makeFlake({
      x: support.x + 18, y: support.y - Math.sqrt(22 ** 2 - 18 ** 2), fallSpeed: 0
    });
    const unsupported = makeFlake({ x: 300, y: 100, fallSpeed: 0 });
    const side = makeFlake({ x: support.x - 22, y: support.y, fallSpeed: 0, char: '❄' });
    for (let frame = 0; frame < 60; frame++) {
      environment.beginFrame(1 / 60, [contact, unsupported, side], 800, 600);
      environment.finishFrame();
    }
    expect(contact.isSettled).toBe(true);
    expect(environment.settled.get(contact).support).toBe(support);
    expect(unsupported.isSettled).not.toBe(true);
    expect(side.isSettled).not.toBe(true);
  });

  it('does not make a stalled upper-row contact part of the pile over information', () => {
    const environment = create();
    const lower = land(environment);
    const upper = makeFlake({ y: 166 });
    environment.settle(upper, environment.settled.get(lower), 166, lower);
    const text = document.createElement('p');
    document.body.appendChild(text);
    document.elementFromPoint.mockImplementation((x, y) => y < 150 ? text : y >= 200 ? figure : document.body);
    const incoming = makeFlake({ x: 128, y: 166 - Math.sqrt(22 ** 2 - 8 ** 2), fallSpeed: 0 });
    for (let frame = 0; frame < 60; frame++) {
      environment.beginFrame(1 / 60, [incoming], 800, 600);
      environment.finishFrame();
    }
    expect(incoming.isSettled).not.toBe(true);
    expect(environment.settled.has(incoming)).toBe(false);
  });

  it('keeps the density limit and visible top boundary when adding higher rows', () => {
    const environment = create();
    const support = land(environment);
    const placement = environment.settled.get(support);
    expect(environment.settle(makeFlake(), placement, 5, support)).toBe(false);
    for (let index = 0; index < 31; index++) {
      environment.surfaces.placements.set(makeFlake({ x: 300 + index }), placement);
    }
    expect(environment.settle(makeFlake({ y: 166 }), placement, 166, support)).toBe(false);
    expect(environment.surfaces.placements.size).toBe(32);
  });

  it('checks information above the second row before stacking', () => {
    rect = { ...rect, left: 80, right: 144, width: 64 };
    const environment = create();
    land(environment, [makeFlake({ x: 98 })]);
    land(environment, [makeFlake({ x: 121 })]);
    const text = document.createElement('p');
    document.body.appendChild(text);
    document.elementFromPoint.mockImplementation((x, y) => y < 177 ? text : y >= 200 ? figure : document.body);
    expect(land(environment, [makeFlake({ x: 98, y: 140 })]).isSettled).not.toBe(true);
  });

  it.each([30, 60, 120])('recognizes a stalled top contact as the second row at %s FPS', (hz) => {
    const environment = create();
    const support = land(environment);
    const incoming = makeFlake({ x: 128, y: 167.5, fallSpeed: 0, velocityX: 0 });
    const distance = 22;
    const restingY = support.y - Math.sqrt(distance ** 2 - 8 ** 2);
    for (let frame = 0; frame < hz && !incoming.isSettled; frame++) {
      incoming.x = incoming.baseX = 128;
      incoming.y = restingY - 0.01;
      environment.beginFrame(1 / hz, [incoming], 800, 600);
      if (!incoming.isSettled) incoming.y += 0.02;
      environment.finishFrame();
      if (frame < hz * 0.3) expect(incoming.isSettled).not.toBe(true);
    }
    expect(incoming.isSettled).toBe(true);
    expect(environment.settled.get(incoming).support).toBe(support);
    expect(incoming.x).toBeCloseTo(128);
    expect(incoming.y).toBeCloseTo(restingY - 0.01);
    for (let frame = 0; frame < hz * 2; frame++) {
      environment.beginFrame(1 / hz, [incoming], 800, 600);
      environment.finishFrame();
      expect(incoming.isSettled).toBe(true);
      expect(incoming.y).toBeCloseTo(restingY - 0.01);
    }
    environment.release(support);
    expect(incoming.isSettled).toBe(false);
  });

  it('resets resting detection when a flake loses contact instead of freezing it in mid-air', () => {
    const environment = create();
    const support = land(environment);
    const incoming = makeFlake();
    environment.delta = 0.1;
    for (let frame = 0; frame < 3; frame++) {
      environment.time += 0.1;
      expect(environment.isRestingOn(incoming, support, 120, 166)).toBe(false);
    }
    environment.time += 0.3;
    expect(environment.isRestingOn(incoming, support, 120, 166)).toBe(false);
    for (let frame = 0; frame < 10; frame++) {
      environment.time += 0.1;
      expect(environment.isRestingOn(incoming, support, 120 + frame * 2, 166)).toBe(false);
    }
  });

  it.each([
    [30, -0.12], [60, -0.12], [120, -0.12],
    [30, 0.12], [60, 0.12], [120, 0.12]
  ])('recognizes bounded contact jitter at %s FPS with %s px contact clearance', (hz, clearance) => {
    const environment = create();
    const support = land(environment);
    const incoming = makeFlake({ fallSpeed: 0 });
    for (let frame = 0; frame < hz && !incoming.isSettled; frame++) {
      incoming.x = incoming.baseX = 120 + (frame % 2 ? 0.12 : -0.12);
      incoming.y = support.y - 22 - clearance;
      environment.beginFrame(1 / hz, [support, incoming], 800, 600);
      environment.finishFrame();
    }
    expect(incoming.isSettled).toBe(true);
    expect(environment.settled.get(incoming).support).toBe(support);
    expect(incoming.y).toBeCloseTo(support.y - 22 - clearance);
  });

  it('lets shed particles fall through the pile instead of trapping particles forbidden to settle', () => {
    const environment = create();
    const support = land(environment);
    const incoming = makeFlake({ y: 160, hasShed: true, velocityY: 80 });
    for (let frame = 0; frame < 60; frame++) {
      environment.beginFrame(1 / 60, [support, incoming], 800, 600);
      incoming.y += (incoming.fallSpeed + incoming.velocityY) / 60;
      environment.finishFrame();
    }
    expect(incoming.y).toBeGreaterThan(250);
    expect(incoming.isSettled).not.toBe(true);
    expect(support.isSettled).toBe(true);
  });

  it('releases a stalled flake when the density limit prevents joining the pile', () => {
    const environment = create();
    const support = land(environment);
    const placement = environment.settled.get(support);
    for (let index = 0; index < 31; index++) {
      environment.surfaces.placements.set(makeFlake({ x: 60 + index * 22 }), placement);
    }
    const incoming = makeFlake({ y: support.y - 22, fallSpeed: 0 });
    for (let frame = 0; frame < 60 && !incoming.hasShed; frame++) {
      environment.beginFrame(1 / 60, [incoming], 800, 600);
      environment.finishFrame();
    }
    expect(incoming.hasShed).toBe(true);
    expect(incoming.isSettled).toBe(false);
    expect(incoming.velocityY).toBeGreaterThan(0);
    expect(environment.surfaces.placements.size).toBe(32);
  });

  it('does not fix a particle that keeps slowly rolling beyond the rest region', () => {
    const environment = create();
    const support = land(environment);
    const incoming = makeFlake({ fallSpeed: 0 });
    for (let frame = 0; frame < 60; frame++) {
      incoming.x = incoming.baseX = support.x + frame * 0.06;
      incoming.y = support.y - Math.sqrt(22 ** 2 - (incoming.x - support.x) ** 2);
      environment.beginFrame(1 / 60, [incoming], 800, 600);
      environment.finishFrame();
      expect(incoming.isSettled).not.toBe(true);
    }
  });

  it.each([Fallback2DRenderer, WebGPURenderer, ThreeDSnowRenderer])(
    'keeps fractional-sized upper-row flakes motionless across frames in %s',
    (Renderer) => {
      rect = { ...rect, left: 80, right: 144, width: 64 };
      const environment = create();
      const first = land(environment, [makeFlake({ x: 98, size: 20.13 })]);
      const second = land(environment, [makeFlake({ x: 122, size: 20.23 })]);
      const upper = land(environment, [makeFlake({
        x: 98, y: 130, size: 20.17, rotationSpeed: 3, cumulativeSpin: 2, phase: 1
      })]);
      expect(upper.isSettled).toBe(true);
      const renderer = new Renderer(document.createElement('canvas'), { enableCollisions: true });
      renderer.environment = environment;
      renderer.viewportWidth = 800;
      renderer.viewportHeight = 600;
      const particles = [first, second, upper];
      const initial = { x: upper.x, y: upper.y, rotation: upper.cumulativeSpin };
      if (renderer instanceof WebGPURenderer) {
        renderer.instances = particles;
        renderer.instanceData = new Float32Array(particles.length * 14);
      } else {
        renderer.flakes = particles;
      }
      if (renderer instanceof Fallback2DRenderer) {
        renderer.ctx = {
          clearRect: vi.fn(), resetTransform: vi.fn(), setTransform: vi.fn(), fillText: vi.fn(),
          save: vi.fn(), restore: vi.fn(),
          measureText: vi.fn(() => ({ actualBoundingBoxLeft: 0, actualBoundingBoxRight: 20 }))
        };
        renderer.start();
      }
      let now = performance.now();
      for (let frame = 0; frame < 180; frame++) {
        if (renderer instanceof WebGPURenderer) renderer.updateSimulation(1 / 60);
        else if (renderer instanceof ThreeDSnowRenderer) renderer._updateInstances(1 / 60);
        else {
          now += 1000 / 60;
          renderer.drawCallback(now);
        }
        expect(upper.isSettled).toBe(true);
        expect(upper.x).toBe(initial.x);
        expect(upper.y).toBe(initial.y);
        expect(upper.rotationSpeed).toBe(0);
        expect(upper.cumulativeSpin).toBe(initial.rotation);
        expect(upper.swayLimit).toBe(0);
      }
      environment.release(first);
      expect(upper.isSettled).toBe(false);
      expect(upper.swayLimit).toBe(1);
      if (renderer instanceof Fallback2DRenderer) renderer.stop();
    }
  );

  it('leaves settled flakes intact in weak wind but releases them under a sustained strong gust', () => {
    const environment = create();
    const flake = land(environment);
    const wind = { windEnabled: true, currentWindForce: 0.5, currentWindLift: 0.15, currentWindVortex: 0.1 };
    for (let i = 0; i < 600; i++) environment.beginFrame(1 / 60, [flake], 800, 600, wind);
    expect(flake.isSettled).toBe(true);
    wind.currentWindForce = -3;
    wind.currentWindLift = 0.9;
    wind.currentWindVortex = 0.7;
    environment.beginFrame(1 / 60, [flake], 800, 600, wind);
    expect(flake.isSettled).toBe(true);
    for (let i = 0; i < 180 && flake.isSettled; i++) {
      environment.beginFrame(1 / 60, [flake], 800, 600, wind);
    }
    expect(flake.isSettled).toBe(false);
    expect(flake.velocityX).toBeLessThan(0);
    expect(flake.velocityY).toBeLessThan(0);
  });

  it('limits total density across layers and prevents overlapping emoji', () => {
    const environment = create();
    const particles = Array.from({ length: 40 }, (_, i) => makeFlake({ x: 65 + i * 16, size: 8 }));
    land(environment, particles);
    expect(environment.settled.size).toBe(32);
  });

  it('sheds on nested scroll and suppresses immediate reattachment', () => {
    const environment = create();
    const flake = land(environment);
    figure.dispatchEvent(new Event('scroll'));
    environment.beginFrame(1 / 60, [flake], 800, 600);
    expect(flake.isSettled).toBe(false);
    expect(flake.hasShed).toBe(true);
    expect(flake.velocityY).toBeGreaterThan(0);
    expect(environment.settled.size).toBe(0);
    expect(land(environment).isSettled).not.toBe(true);
  });

  describe.each([Fallback2DRenderer, WebGPURenderer, ThreeDSnowRenderer])('%s pointer interaction', (Renderer) => {
    const setup = () => {
      const environment = create();
      const flake = land(environment);
      const renderer = new Renderer(null, { mouseRadius: 20 });
      renderer.environment = environment;
      return { environment, flake, renderer };
    };

    it('releases settled flakes on mouse movement and prevents reattachment', () => {
      const { environment, flake, renderer } = setup();
      renderer.updateMousePosition(flake.x - 25, flake.y, 100, 0);
      expect(flake.isSettled).toBe(false);
      expect(flake.hasShed).toBe(true);
      expect(flake.velocityY).toBeGreaterThan(0);
      expect(environment.surfaces.placements.size).toBe(0);
      expect(land(environment, [flake]).isSettled).toBe(false);
    });

    it('detects a fast sweep even when both endpoints miss the flake', () => {
      const { flake, renderer } = setup();
      renderer.updateMousePosition(50, flake.y, 100, 0);
      expect(flake.isSettled).toBe(true);
      renderer.updateMousePosition(200, flake.y, 2000, 0);
      expect(flake.isSettled).toBe(false);
    });

    it('does not release flakes for an idle or distant pointer, or disabled radius', () => {
      const { flake, renderer } = setup();
      renderer.updateMousePosition(flake.x, flake.y, 0, 0);
      expect(flake.isSettled).toBe(true);
      renderer.onMouseLeave();
      renderer.updateMousePosition(500, 500, 100, 0);
      expect(flake.isSettled).toBe(true);
      renderer.mouseRadius = 0;
      renderer.updateMousePosition(flake.x, flake.y, 100, 0);
      renderer.onMouseDown(flake.x, flake.y, 0);
      expect(flake.isSettled).toBe(true);
    });

    it.each([0, 2])('applies one click impulse to settled flakes (button %s)', (button) => {
      const { environment, flake, renderer } = setup();
      renderer.onMouseDown(flake.x - 20, flake.y, button);
      expect(flake.isSettled).toBe(false);
      expect(renderer.mouseBurstTimer).toBe(0);
      expect(renderer.mouseBurstMode).toBe(button === 0 ? 'explode' : 'suction');
      expect(environment.airBurst).toBeUndefined();
      if (button === 0) {
        expect(flake.velocityX).toBeGreaterThan(0);
      } else {
        expect(flake.velocityX).toBeLessThan(0);
      }
      const velocity = { x: flake.velocityX, y: flake.velocityY };
      renderer.onMouseUp(button);
      expect(flake.velocityX).toBe(velocity.x);
      expect(flake.velocityY).toBe(velocity.y);
    });

    it.each([0, 2])('does not repeat an airborne impulse while held (button %s)', (button) => {
      const { renderer } = setup();
      const flake = makeFlake({ x: 120, y: 170 });
      if (renderer.instances) renderer.instances = [flake];
      else renderer.flakes = [flake];

      renderer.onMouseDown(100, 170, button);
      const velocity = { x: flake.velocityX, y: flake.velocityY };
      expect(velocity.x).not.toBe(0);
      expect(renderer.mouseBurstTimer).toBe(0);

      for (let frame = 0; frame < 5; frame++) {
        renderer.updateMousePosition(100, 170, 0, 0);
      }

      expect(flake.velocityX).toBe(velocity.x);
      expect(flake.velocityY).toBe(velocity.y);
    });
  });

  it('never sheds on a timer and follows its support when the layout moves', () => {
    const environment = create();
    const flake = land(environment);
    for (let i = 0; i < 10; i++) {
      environment.beginFrame(60, [flake], 800, 600);
      environment.finishFrame();
      expect(flake.isSettled).toBe(true);
    }
    rect = { ...rect, top: 210, left: 60, right: 760 };
    environment.beginFrame(1, [flake], 800, 600);
    expect(flake.isSettled).toBe(true);
    expect(flake.x).toBe(130);
    expect(flake.y).toBe(198);
    window.dispatchEvent(new Event('resize'));
    environment.beginFrame(1, [flake], 800, 600);
    expect(flake.isSettled).toBe(true);
  });

  it('moves a cross-layer stack together regardless of renderer update order', () => {
    const lowerEnvironment = create();
    const upperEnvironment = create();
    const lower = land(lowerEnvironment);
    const upper = makeFlake({ y: 166 });
    expect(upperEnvironment.settle(upper, lowerEnvironment.settled.get(lower), 166, lower)).toBe(true);
    rect = { ...rect, left: 60, right: 760, top: 230, bottom: 430 };

    upperEnvironment.beginFrame(1 / 60, [upper], 800, 600);

    expect(lower.y).toBe(218);
    expect(upper.y).toBe(196);
    expect(upper.x).toBe(130);
    lowerEnvironment.beginFrame(1 / 60, [lower], 800, 600);
    expect(upper.y).toBe(196);
    expect(lower.y - upper.y).toBe(22);
  });

  it('releases an upper flake when its still-settled supports move apart', () => {
    rect = { ...rect, right: 120, width: 70 };
    const otherElement = document.createElement('figure');
    otherElement.style.cssText = 'visibility:visible;opacity:1';
    let otherRect = { ...rect, left: 120, right: 190 };
    otherElement.getBoundingClientRect = () => otherRect;
    document.body.appendChild(otherElement);
    const environment = create();
    const left = makeFlake({ x: 108, y: 188 });
    const right = makeFlake({ x: 132, y: 188 });
    environment.settle(left, { element: figure, ...rect }, 188);
    environment.settle(right, { element: otherElement, ...otherRect }, 188);
    const y = 188 - Math.sqrt(22 ** 2 - 12 ** 2);
    const upper = makeFlake({ y });
    environment.settle(upper, environment.settled.get(left), y, left, [left, right]);
    otherRect = { ...otherRect, left: 170, right: 240 };

    environment.beginFrame(1 / 60, [left, right, upper], 800, 600);

    expect(left.isSettled).toBe(true);
    expect(right.isSettled).toBe(true);
    expect(upper.isSettled).toBe(false);
    expect(upper.hasShed).toBe(true);
  });

  it('uploads settled WebGPU positions when their DOM support moves', () => {
    const environment = create();
    const flake = land(environment);
    const renderer = new WebGPURenderer(document.createElement('canvas'), { enableCollisions: false });
    renderer.environment = environment;
    renderer.viewportWidth = 800;
    renderer.viewportHeight = 600;
    renderer.instances = [flake];
    renderer.instanceData = new Float32Array(14);
    renderer.updateSimulation(1 / 60);
    renderer.instanceBufferNeedsUpdate = false;
    rect = { ...rect, left: 60, right: 760, top: 220, bottom: 420 };

    renderer.updateSimulation(1 / 60);

    expect(renderer.instanceData[0]).toBe(130);
    expect(renderer.instanceData[1]).toBe(208);
    expect(renderer.instanceBufferNeedsUpdate).toBe(true);
  });

  it('does not reupload unchanged fractional-sized WebGPU piles', () => {
    const environment = create();
    const flake = land(environment, [makeFlake({ size: 20.13 })]);
    const renderer = new WebGPURenderer(document.createElement('canvas'), { enableCollisions: false });
    renderer.environment = environment;
    renderer.viewportWidth = 800;
    renderer.viewportHeight = 600;
    renderer.instances = [flake];
    renderer.instanceData = new Float32Array(14);
    renderer.updateSimulation(1 / 60);
    renderer.instanceBufferNeedsUpdate = false;

    renderer.updateSimulation(1 / 60);

    expect(renderer.instanceBufferNeedsUpdate).toBe(false);
  });

  it.each(['transparent', 'transparent-parent', 'interactive'])(
    'sheds a pile when its surface becomes unsafe (%s)',
    (change) => {
      const environment = create();
      const flake = land(environment);
      if (change === 'transparent') {
        figure.style.opacity = '0';
      } else {
        const parent = document.createElement(change === 'interactive' ? 'a' : 'div');
        if (change === 'transparent-parent') parent.style.opacity = '0';
        figure.replaceWith(parent);
        parent.appendChild(figure);
      }

      environment.beginFrame(0.01, [flake], 800, 600);

      expect(flake.isSettled).toBe(false);
      expect(environment.settled.size).toBe(0);
    }
  );

  it('sheds flakes immediately when a resized surface no longer supports their full width', () => {
    const environment = create();
    const flake = land(environment);
    rect = { ...rect, right: 125, width: 75 };

    environment.beginFrame(0.01, [flake], 800, 600);

    expect(flake.isSettled).toBe(false);
    expect(flake.hasShed).toBe(true);
    expect(environment.settled.size).toBe(0);
  });

  it('releases particles if their DOM support is removed', () => {
    const environment = create();
    const flake = land(environment);
    figure.remove();
    environment.beginFrame(0.01, [flake], 800, 600);
    expect(flake.isSettled).toBe(false);
  });

  it('detects DOM additions on the next cached scan and releases listeners after the last user', () => {
    const first = create();
    const second = create();
    const shared = first.surfaces;
    const removeListener = vi.spyOn(window, 'removeEventListener');
    first.beginFrame(0, [], 800, 600);
    const nextScan = shared.nextScan;
    const article = document.createElement('article');
    article.style.cssText = 'visibility:visible;opacity:1';
    article.getBoundingClientRect = () => rect;
    document.body.appendChild(article);
    shared.refresh(nextScan - 1);
    expect(shared.surfaces).toHaveLength(1);
    shared.refresh(nextScan);
    expect(shared.surfaces).toHaveLength(2);
    first.setEnabled(false);
    expect(removeListener).not.toHaveBeenCalled();
    second.setEnabled(false);
    expect(removeListener).toHaveBeenCalledWith('scroll', shared.onScroll, true);
  });

  it('bounds DOM scans to 2000 elements and 80 eligible surfaces', () => {
    const environment = create();
    document.body.replaceChildren();
    for (let i = 0; i < 2000; i++) document.body.appendChild(document.createElement('span'));
    document.body.appendChild(figure);
    environment.beginFrame(0, [], 800, 600);
    expect(figure.getBoundingClientRect).not.toHaveBeenCalled();
    expect(environment.surfaces.surfaces).toHaveLength(0);

    document.body.replaceChildren();
    const measure = vi.fn(() => rect);
    for (let i = 0; i < 81; i++) {
      const surface = document.createElement('figure');
      surface.style.cssText = 'visibility:visible;opacity:1';
      surface.getBoundingClientRect = measure;
      document.body.appendChild(surface);
    }
    environment.surfaces.refresh(environment.surfaces.nextScan);
    expect(environment.surfaces.surfaces).toHaveLength(80);
    expect(measure).toHaveBeenCalledTimes(80);
  });

  it('clears or disables accumulation without deleting falling particles', () => {
    const environment = create();
    const flake = land(environment);
    environment.setEnabled(false);
    expect(flake.isSettled).toBe(false);
    expect(flake.isFinished).not.toBe(true);
    expect(environment.surfaces).toBeNull();
    expect(land(environment).isSettled).not.toBe(true);
  });

  it('spawns new particles at the requested screen point with radial impulses only once', () => {
    const environment = create({
      accumulationEnabled: false, finiteParticles: true, burstOrigin: { x: 1000, y: -5 }
    });
    const flake = makeFlake();
    environment.beginFrame(0.01, [flake], 800, 600);
    expect(flake.x).toBe(800);
    expect(flake.y).toBe(0);
    expect(Math.hypot(flake.velocityX, flake.velocityY)).toBeGreaterThanOrEqual(120);
    flake.x = 700;
    environment.beginFrame(0.01, [flake], 800, 600);
    expect(flake.x).toBe(700);
  });

  it('completes only after every finite particle has exited and never respawns it', async () => {
    const complete = vi.fn();
    const environment = create({ accumulationEnabled: false, finiteParticles: true }, complete);
    const particles = [makeFlake(), makeFlake()];
    environment.beginFrame(0.01, particles, 800, 600);
    expect(environment.retire(particles[0])).toBe(true);
    environment.finishFrame();
    await Promise.resolve();
    expect(complete).not.toHaveBeenCalled();
    environment.retire(particles[1]);
    environment.finishFrame();
    environment.finishFrame();
    await Promise.resolve();
    expect(complete).toHaveBeenCalledOnce();
    expect(particles.every((flake) => flake.isFinished)).toBe(true);
  });

  it('lets an explosion expand first, then guarantees descent in an updraft', () => {
    const environment = create({ accumulationEnabled: false, finiteParticles: true });
    const flake = makeFlake();
    environment.beginFrame(0.1, [flake], 800, 600);
    flake.y -= 10;
    environment.finishFrame();
    expect(flake.y).toBe(160);
    environment.beginFrame(2, [flake], 800, 600);
    flake.velocityY = -100;
    environment.beginFrame(1 / 60, [flake], 800, 600);
    flake.y += (flake.fallSpeed + flake.velocityY) / 60;
    environment.finishFrame();
    expect(flake.y).toBeGreaterThan(160);
    const resolvedY = flake.y + 10;
    flake.y = resolvedY;
    environment.finishFrame();
    expect(flake.y).toBe(resolvedY);
  });

  it.each(['webgpu', '3d', '2d'])('retires finite flakes in the actual %s update loop', async (mode) => {
    const config = { accumulationEnabled: false, finiteParticles: true, enableCollisions: false };
    const complete = vi.fn();
    const environment = create(config, complete);
    const canvas = document.createElement('canvas');
    const renderer = mode === 'webgpu' ? new WebGPURenderer(canvas, config)
      : mode === '3d' ? new ThreeDSnowRenderer(canvas, config) : new Fallback2DRenderer(canvas, config);
    renderer.environment = environment;
    renderer.viewportWidth = 800;
    renderer.viewportHeight = 600;
    const flake = makeFlake({ y: 10000 });
    if (mode === 'webgpu') {
      renderer.instances = [flake];
      renderer.instanceData = new Float32Array(14);
      renderer.updateSimulation(0.01);
      expect(renderer.instanceData[2]).toBe(0);
      renderer.updateSimulation(0.01);
    } else if (mode === '3d') {
      renderer.flakes = [flake];
      renderer._updateInstances(0.01);
      renderer._updateInstances(0.01);
    } else {
      renderer.flakes = [flake];
      renderer.ctx = {
        clearRect: vi.fn(), resetTransform: vi.fn(), setTransform: vi.fn(), fillText: vi.fn()
      };
      renderer.start();
      renderer.drawCallback(performance.now() + 16);
      renderer.stop();
    }
    expect(flake.isFinished).toBe(true);
    expect(flake.y).toBeGreaterThan(600);
    await Promise.resolve();
    expect(complete).toHaveBeenCalledOnce();
  });

  it.each(['webgpu', '3d', '2d'])('respawns above the screen without sweeping through a pile in %s', (mode) => {
    const environment = create();
    const support = land(environment);
    const config = { enableCollisions: false, windEnabled: false, mouseRadius: 0 };
    const canvas = document.createElement('canvas');
    const renderer = mode === 'webgpu' ? new WebGPURenderer(canvas, config)
      : mode === '3d' ? new ThreeDSnowRenderer(canvas, config) : new Fallback2DRenderer(canvas, config);
    renderer.environment = environment;
    renderer.viewportWidth = 800;
    renderer.viewportHeight = 600;
    vi.spyOn(Math, 'random').mockReturnValue(0.15);
    const incoming = makeFlake({ y: 625 });
    if (mode === 'webgpu') {
      renderer.instances = [support, incoming];
      renderer.instanceData = new Float32Array(28);
      renderer.updateSimulation(1 / 60);
    } else if (mode === '3d') {
      renderer.flakes = [support, incoming];
      renderer._updateInstances(1 / 60);
    } else {
      renderer.flakes = [support, incoming];
      vi.spyOn(renderer, '_getViewportSize').mockReturnValue({ width: 800, height: 600 });
      vi.spyOn(renderer, '_findSafeSpawnX').mockReturnValue(120);
      renderer.ctx = {
        clearRect: vi.fn(), resetTransform: vi.fn(), setTransform: vi.fn(), fillText: vi.fn()
      };
      renderer.start();
      renderer._respawnCredit = 10;
      renderer.drawCallback(performance.now() + 16);
      renderer.stop();
    }
    expect(incoming.x).toBe(120);
    expect(incoming.y).toBeLessThanOrEqual(-incoming.size);
    expect(incoming.isSettled).not.toBe(true);
    expect(incoming.previousSurfaceY).toBeLessThanOrEqual(-incoming.size);
    expect(Math.abs(incoming.previousSurfaceY - incoming.y)).toBeLessThan(1);
    expect(support.isSettled).toBe(true);
  });

  it('does not collide with piles along a 3D horizontal portal jump', () => {
    const environment = create();
    const support = land(environment);
    const renderer = new ThreeDSnowRenderer(document.createElement('canvas'), {
      enableCollisions: false, windEnabled: false, mouseRadius: 0
    });
    renderer.environment = environment;
    renderer.viewportWidth = 800;
    renderer.viewportHeight = 600;
    const incoming = makeFlake({ x: -21, y: support.y, fallSpeed: 0 });
    renderer.flakes = [support, incoming];
    renderer._updateInstances(1 / 60);
    expect(incoming.x).toBe(820);
    expect(incoming.previousSurfaceX).toBe(820);
    expect(incoming.isSettled).not.toBe(true);
    expect(support.isSettled).toBe(true);
  });

  it('updates live settings without replacing the renderer or resetting positions', () => {
    const controller = new SnowWebGPUController({ sinkspeed: 0.5 });
    const flake = makeFlake({ speed: 30 });
    controller.renderer = { flakes: [flake] };
    const renderer = controller.renderer;
    controller.updateConfig({ gravity: 12, mouseRadius: 0, windEnabled: true, windStrength: 2 });
    expect(controller.renderer).toBe(renderer);
    expect(controller.config.gravity).toBe(12);
    expect(flake.fallSpeed).toBe(30);
    expect(flake.speed).toBe(30);
    expect(flake.y).toBe(170);
    expect(renderer.mouseRadius).toBe(0);
    expect(renderer.windStrength).toBe(2);
  });

  it('changes live physical settings without editing calculated particle speed', () => {
    const controller = new SnowWebGPUController();
    const flake = makeFlake({ size: 20, fallSpeed: 0, speed: 0 });
    controller.renderer = { flakes: [flake] };

    controller.updateConfig({ gravity: 15, airDensity: 0.8 });

    expect(controller.config.gravity).toBe(15);
    expect(controller.config.airDensity).toBe(0.8);
    expect(flake.fallSpeed).toBe(0);
    expect(flake.speed).toBe(0);
    expect(Number.isFinite(flake.fallSpeed)).toBe(true);
  });
});
