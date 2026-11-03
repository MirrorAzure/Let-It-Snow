import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const setupChrome = (localSettings) => {
  global.chrome = {
    runtime: {
      id: 'self-extension-id',
      onMessage: { addListener: vi.fn() }
    },
    storage: {
      local: {
        get: vi.fn(async () => ({ ...localSettings })),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {})
      },
      sync: { get: vi.fn(async () => ({ autoStart: false })) },
      onChanged: { addListener: vi.fn() }
    }
  };
};

const sendPageCommand = (data) => {
  window.dispatchEvent(new MessageEvent('message', {
    data: { target: 'let-it-snow-api', ...data },
    origin: window.location.origin,
    source: window
  }));
};

const responses = (postSpy) => postSpy.mock.calls
  .map(([payload]) => payload)
  .filter((payload) => payload?.target === 'let-it-snow-api-response');

describe('page API gating', () => {
  let postSpy;

  beforeEach(() => {
    vi.resetModules();
    postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  });

  afterEach(() => {
    postSpy.mockRestore();
    delete global.chrome;
  });

  it('is disabled by default', async () => {
    setupChrome({});
    await import('../src/content/index.js');
    await flush();

    sendPageCommand({ command: 'ping', id: 'p1' });
    await flush();

    const [response] = responses(postSpy).filter((r) => r.id === 'p1');
    expect(response).toMatchObject({ ok: false, error: 'page_api_disabled', id: 'p1' });
  });

  it('rejects pages whose origin is not in the allowlist', async () => {
    setupChrome({ pageApiEnabled: true, pageApiOrigins: ['https://other.example'] });
    await import('../src/content/index.js');
    await flush();

    sendPageCommand({ command: 'ping', id: 'p2' });
    await flush();

    const [response] = responses(postSpy).filter((r) => r.id === 'p2');
    expect(response).toMatchObject({ ok: false, error: 'page_api_disabled' });
  });

  it('executes validated commands for allowed origins and replies to own origin only', async () => {
    setupChrome({ pageApiEnabled: true, pageApiOrigins: [window.location.origin] });
    await import('../src/content/index.js');
    await flush();

    sendPageCommand({ command: 'ping', id: 'p3' });
    await flush();
    sendPageCommand({ command: 'eval', id: 'p4' });
    await flush();

    // Слушатели из предыдущих импортов модуля остаются на общем window jsdom.
    const all = responses(postSpy);
    expect(all.filter((r) => r.id === 'p3').some((r) => r.ok === true && r.pong === true)).toBe(true);
    expect(all.filter((r) => r.id === 'p4').every((r) => r.ok === false)).toBe(true);
    expect(all.some((r) => r.id === 'p4' && r.error === 'unknown_command')).toBe(true);
    const replyCall = postSpy.mock.calls.find(([payload]) => payload?.id === 'p3' && payload.ok);
    expect(replyCall[1]).toBe(window.location.origin);
  });

  it('ignores messages from other windows', async () => {
    setupChrome({ pageApiEnabled: true, pageApiOrigins: [window.location.origin] });
    await import('../src/content/index.js');
    await flush();

    window.dispatchEvent(new MessageEvent('message', {
      data: { target: 'let-it-snow-api', command: 'ping', id: 'p5' },
      origin: 'https://evil.example',
      source: null
    }));
    await flush();
    expect(responses(postSpy).find((r) => r.id === 'p5')).toBeUndefined();
  });

  it('rejects runtime snowCommand messages from other extensions', async () => {
    setupChrome({});
    await import('../src/content/index.js');
    const handler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const respond = vi.fn();
    handler({ action: 'snowCommand', command: { command: 'ping' } }, { id: 'someone-else' }, respond);
    expect(respond).toHaveBeenCalledWith({ ok: false, error: 'forbidden' });

    const respondOwn = vi.fn();
    const keepOpen = handler({ action: 'snowCommand', command: { command: 'ping' } }, { id: 'self-extension-id' }, respondOwn);
    expect(keepOpen).toBe(true);
    await flush();
    expect(respondOwn).toHaveBeenCalledWith(expect.objectContaining({ ok: true, pong: true }));
  });
});
