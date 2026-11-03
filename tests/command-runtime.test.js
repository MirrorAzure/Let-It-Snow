import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SnowCommandRuntime } from '../src/content/command-runtime.js';
import { validateCommand } from '../src/api/command-protocol.js';

const cmd = (raw) => {
  const result = validateCommand(raw);
  if (!result.ok) throw new Error(result.error);
  return result.command;
};

const createFakeController = () => {
  const created = [];
  const factory = (config, options) => {
    const controller = {
      config,
      options,
      start: vi.fn(async () => {}),
      destroy: vi.fn(),
      fadeOutAndDestroy: vi.fn(),
      applyWindOverride: vi.fn(),
      pauseAnimations: vi.fn(),
      resumeAnimations: vi.fn()
    };
    created.push(controller);
    return controller;
  };
  return { created, factory };
};

describe('SnowCommandRuntime', () => {
  let main;
  let fake;
  let runtime;

  beforeEach(() => {
    vi.useFakeTimers();
    main = { config: { rendererMode: 'auto', snowcolor: ['#abcdef'] }, applyWindOverride: vi.fn() };
    fake = createFakeController();
    runtime = new SnowCommandRuntime({
      getMainController: () => main,
      startMain: vi.fn(async () => {}),
      stopMain: vi.fn(),
      createController: fake.factory
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates an instant burst layer that enters from the top and expires with a fade', async () => {
    const result = await runtime.execute(cmd({ command: 'burst', params: { count: 300, durationMs: 2000 } }));
    expect(result.ok).toBe(true);
    const [layer] = fake.created;
    expect(layer.config).toMatchObject({ snowmax: 300, canvas2dInitialActiveFlakes: 300, snowcolor: ['#abcdef'] });
    expect(layer.config.initialTimeOffsetSeconds).toBe(0);
    expect(layer.config.initialSpawnSpanRatio).toBeGreaterThan(0);
    expect(layer.config.initialSpawnSpanRatio).toBeLessThan(1);
    expect(layer.options.overlayId).not.toBe('let-it-snow-webgpu-canvas');
    vi.advanceTimersByTime(2000);
    expect(layer.fadeOutAndDestroy).toHaveBeenCalled();
    expect(runtime.effectCount).toBe(0);
  });

  it('caps the number of simultaneous effect layers', async () => {
    for (let i = 0; i < 6; i++) {
      await runtime.execute(cmd({ command: 'glyphs', params: { symbols: ['★'] } }));
    }
    expect(runtime.effectCount).toBe(4);
    expect(fake.created[0].destroy).toHaveBeenCalled();
    expect(fake.created[1].destroy).toHaveBeenCalled();
  });

  it('applies and reverts wind overrides on all layers', async () => {
    await runtime.execute(cmd({ command: 'glyphs', params: { symbols: ['★'] } }));
    await runtime.execute(cmd({ command: 'wind', params: { direction: 'right', strength: 2.5, durationMs: 1000 } }));
    expect(main.applyWindOverride).toHaveBeenLastCalledWith(expect.objectContaining({ direction: 'right', strength: 2.5 }));
    expect(fake.created[0].applyWindOverride).toHaveBeenLastCalledWith(expect.objectContaining({ direction: 'right' }));
    vi.advanceTimersByTime(1000);
    expect(main.applyWindOverride).toHaveBeenLastCalledWith(null);
  });

  it('disables privileged background GIF fetch for page-originated commands', async () => {
    const gif = cmd({ command: 'gif', params: { urls: ['https://media.example.com/a.gif'] } });
    await runtime.execute(gif, { source: 'page' });
    await runtime.execute(gif, { source: 'extension' });
    expect(fake.created[0].config.useBackgroundGifFetch).toBe(false);
    expect(fake.created[0].options.renderSnow).toBe(false);
    expect(fake.created[1].config.useBackgroundGifFetch).toBe(true);
  });

  it('stop clears effects and stops main snow', async () => {
    await runtime.execute(cmd({ command: 'burst' }));
    await runtime.execute(cmd({ command: 'stop' }));
    expect(runtime.effectCount).toBe(0);
    expect(runtime.stopMain).toHaveBeenCalled();
  });
});
