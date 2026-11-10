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
    main = {
      config: { rendererMode: 'auto', snowcolor: ['#abcdef'] },
      applyWindOverride: vi.fn(), pauseAnimations: vi.fn(), resumeAnimations: vi.fn(),
      updateConfig: vi.fn(), clearAccumulation: vi.fn(), getState: vi.fn(() => ({ settled: 2 }))
    };
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

  it('keeps a finite burst alive beyond durationMs until its last particle exits', async () => {
    const result = await runtime.execute(cmd({ command: 'burst', params: { count: 300, durationMs: 2000 } }));
    expect(result.ok).toBe(true);
    const [layer] = fake.created;
    expect(layer.config).toMatchObject({
      snowmax: 300, canvas2dInitialActiveFlakes: 300, snowcolor: ['#abcdef'], finiteParticles: true
    });
    expect(layer.config.initialTimeOffsetSeconds).toBe(0);
    expect(layer.config.initialSpawnSpanRatio).toBeGreaterThan(0);
    expect(layer.config.initialSpawnSpanRatio).toBeLessThan(1);
    expect(layer.options.overlayId).not.toBe('let-it-snow-webgpu-canvas');
    vi.advanceTimersByTime(2000);
    expect(layer.fadeOutAndDestroy).not.toHaveBeenCalled();
    expect(layer.destroy).not.toHaveBeenCalled();
    expect(runtime.effectCount).toBe(1);
    layer.options.onComplete();
    expect(layer.destroy).toHaveBeenCalledOnce();
    expect(runtime.effectCount).toBe(0);
  });

  it('rejects excess layers without removing particles already on screen', async () => {
    for (let i = 0; i < 4; i++) {
      await runtime.execute(cmd({ command: 'glyphs', params: { symbols: ['★'] } }));
    }
    expect(await runtime.execute(cmd({ command: 'burst' })))
      .toEqual({ ok: false, error: 'effect_limit_reached' });
    expect(runtime.effectCount).toBe(4);
    expect(fake.created).toHaveLength(4);
    fake.created.forEach((controller) => expect(controller.destroy).not.toHaveBeenCalled());
  });

  it('passes a coordinate burst and the chosen emoji mode to the renderer config', async () => {
    await runtime.execute(cmd({
      command: 'burst', params: { x: 120, y: 240, symbols: ['🎉'], glyphMode: 'emoji' }
    }));
    expect(fake.created[0].config).toMatchObject({
      burstOrigin: { x: 120, y: 240 }, snowletters: ['🎉'], snowglyphmodes: ['emoji'],
      finiteParticles: true, enableCollisions: false
    });
  });

  it('preserves explicit API pause across visibility changes and new effects', async () => {
    await runtime.execute(cmd({ command: 'pause' }));
    runtime.pauseAll();
    runtime.resumeAll();
    expect(main.resumeAnimations).not.toHaveBeenCalled();
    await runtime.execute(cmd({ command: 'burst' }));
    expect(fake.created[0].pauseAnimations).toHaveBeenCalledOnce();
    expect((await runtime.execute(cmd({ command: 'status' }))).paused).toBe(true);
    await runtime.execute(cmd({ command: 'resume' }));
    expect(main.resumeAnimations).toHaveBeenCalledOnce();
    expect(fake.created[0].resumeAnimations).toHaveBeenCalledOnce();
    runtime.pauseAll();
    await runtime.execute(cmd({ command: 'resume' }));
    expect(runtime.isPaused).toBe(true);
  });

  it('updates live settings and reports status without restarting the main controller', async () => {
    await runtime.execute(cmd({ command: 'update', params: { config: { gravity: 8.5, accumulationEnabled: false } } }));
    expect(main.updateConfig).toHaveBeenCalledWith({ gravity: 8.5, accumulationEnabled: false });
    expect(runtime.startMain).not.toHaveBeenCalled();
    expect(await runtime.execute(cmd({ command: 'status' }))).toMatchObject({
      ok: true, running: true, main: { settled: 2 }, effects: []
    });
    await runtime.execute(cmd({ command: 'clearAccumulation' }));
    expect(main.clearAccumulation).toHaveBeenCalledOnce();
    main = null;
    expect(await runtime.execute(cmd({ command: 'update', params: { config: { gravity: 8.5 } } })))
      .toEqual({ ok: false, error: 'not_running' });
  });

  it('still expires GIF-only layers on their duration', async () => {
    await runtime.execute(cmd({
      command: 'gif', params: { urls: ['https://media.example.com/a.gif'], durationMs: 1000 }
    }));
    vi.advanceTimersByTime(1000);
    expect(fake.created[0].fadeOutAndDestroy).toHaveBeenCalledOnce();
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
