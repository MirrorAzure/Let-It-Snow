// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MAX_GIF_BYTES = 15 * 1024 * 1024;
const ONE_MIB = 1024 * 1024;

describe('background worker and popup messaging', () => {
  let handler;
  let chrome;

  beforeEach(async () => {
    vi.resetModules();
    chrome = {
      runtime: {
        id: 'test-extension',
        onMessage: { addListener: vi.fn() }
      },
      storage: {
        local: { get: vi.fn().mockResolvedValue({ relayEnabled: false }) },
        onChanged: { addListener: vi.fn() }
      }
    };
    vi.stubGlobal('chrome', chrome);
    await import('../src/background.js');
    handler = chrome.runtime.onMessage.addListener.mock.calls[0][0];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function fetchGif(url = 'https://media.example.com/snow.gif') {
    return new Promise((resolve, reject) => {
      let responded = false;
      const keepAlive = handler(
        { type: 'FETCH_GIF', url },
        { id: 'test-extension', tab: { id: 1 } },
        (response) => {
          responded = true;
          resolve(response);
        }
      );
      if (!keepAlive && !responded) reject(new Error('GIF request was not accepted'));
    });
  }

  async function connectRelay() {
    const sockets = [];
    class FakeWebSocket {
      constructor(url) {
        this.url = url;
        this.send = vi.fn();
        this.close = vi.fn();
        sockets.push(this);
      }
    }
    vi.stubGlobal('WebSocket', FakeWebSocket);
    chrome.storage.local.get.mockResolvedValue({
      relayEnabled: true,
      relayUrl: 'ws://127.0.0.1:8787/ws',
      relayToken: 'x'.repeat(32)
    });
    const onChanged = chrome.storage.onChanged.addListener.mock.calls[0][0];
    onChanged({ relayEnabled: {} }, 'local');
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    return sockets;
  }

  function sendExtensionMessage(message) {
    return new Promise((resolve, reject) => {
      const keepAlive = handler(message, { id: 'test-extension' }, resolve);
      if (!keepAlive) reject(new Error('Extension message was not accepted'));
    });
  }

  it('accepts an image exactly at the streaming size limit', async () => {
    let remaining = 15;
    const chunk = new Uint8Array(ONE_MIB);
    const body = new ReadableStream({
      pull(controller) {
        if (remaining-- > 0) controller.enqueue(chunk);
        else controller.close();
      }
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
      headers: { 'content-type': 'image/gif' }
    })));

    const result = await fetchGif();

    expect(result.success).toBe(true);
    expect(result.dataUrl).toHaveLength('data:image/gif;base64,'.length + 4 * Math.ceil(MAX_GIF_BYTES / 3));
    expect(result.dataUrl.startsWith('data:image/gif;base64,')).toBe(true);
  });

  it('cancels a response whose declared size exceeds the limit', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
      headers: {
        'content-type': 'image/gif',
        'content-length': String(MAX_GIF_BYTES + 1)
      }
    })));

    const result = await fetchGif();

    expect(result).toEqual({ success: false, error: 'Image is too large' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('stops reading an oversized response even without a content length', async () => {
    let pulls = 0;
    const cancel = vi.fn();
    const chunk = new Uint8Array(ONE_MIB);
    const body = new ReadableStream({
      pull(controller) {
        pulls++;
        if (pulls <= 50) controller.enqueue(chunk);
        else controller.close();
      },
      cancel
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
      headers: { 'content-type': 'image/gif' }
    })));

    const result = await fetchGif();

    expect(result).toEqual({ success: false, error: 'Image is too large' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(pulls).toBeLessThan(18);
  });

  it('reports an empty image response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {
      headers: { 'content-type': 'image/gif' }
    })));

    await expect(fetchGif()).resolves.toEqual({
      success: false,
      error: 'Empty image response'
    });
  });

  it('rejects a response with a non-image content type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not an image', {
      headers: { 'content-type': 'text/html' }
    })));

    await expect(fetchGif()).resolves.toEqual({
      success: false,
      error: 'Not an image'
    });
  });

  it('reports an invalid GIF URL without starting a fetch', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(fetchGif('not a URL')).resolves.toEqual({
      success: false,
      error: 'Invalid URL'
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a relay command that cannot be delivered to tabs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    chrome.tabs = { query: vi.fn().mockRejectedValue(new Error('tabs unavailable')) };
    const [socket] = await connectRelay();
    socket.onmessage({ data: JSON.stringify({ type: 'auth_ok', clientId: 'c1', peers: 1 }) });
    try {
      socket.onmessage({ data: JSON.stringify({ type: 'command', command: 'burst' }) });
      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledWith(
          '[Let It Snow] Failed to deliver a relay command:',
          expect.any(Error)
        );
      });
      const status = await sendExtensionMessage({ type: 'GET_RELAY_STATUS' });
      expect(status.lastError).toBe('tab_delivery_failed');

      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
      chrome.tabs.sendMessage = vi.fn().mockResolvedValue({ ok: true });
      socket.onmessage({ data: JSON.stringify({ type: 'command', command: 'burst' }) });
      await vi.waitFor(async () => {
        expect((await sendExtensionMessage({ type: 'GET_RELAY_STATUS' })).lastError).toBeNull();
      });
    } finally {
      socket.onclose({ code: 4401 });
    }
  });

  it('reports a failed relay send without claiming it was relayed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    chrome.tabs = { query: vi.fn().mockResolvedValue([]), sendMessage: vi.fn() };
    const [socket] = await connectRelay();
    socket.onmessage({ data: JSON.stringify({ type: 'auth_ok', clientId: 'c1', peers: 1 }) });
    socket.send.mockImplementation(() => { throw new Error('socket unavailable'); });
    try {
      const result = await sendExtensionMessage({
        type: 'DISPATCH_SNOW_COMMAND',
        command: { command: 'wind' }
      });
      expect(result).toMatchObject({
        ok: false, error: 'relay_send_failed', delivered: 0, relayed: false
      });
      expect(warn).toHaveBeenCalledWith(
        '[Let It Snow] Failed to send a relay command:',
        expect.any(Error)
      );
      expect((await sendExtensionMessage({ type: 'GET_RELAY_STATUS' })).lastError)
        .toBe('relay_send_failed');

      socket.send.mockReset();
      const retry = await sendExtensionMessage({
        type: 'DISPATCH_SNOW_COMMAND',
        command: { command: 'wind' }
      });
      expect(retry).toMatchObject({ ok: true, relayed: true });
      expect((await sendExtensionMessage({ type: 'GET_RELAY_STATUS' })).lastError).toBeNull();
    } finally {
      socket.onclose({ code: 4401 });
    }
  });

  it('reports a reconnect failure and retries with backoff', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sockets = await connectRelay();
    vi.useFakeTimers();
    try {
      chrome.storage.local.get.mockRejectedValueOnce(new Error('storage unavailable'));
      sockets[0].onclose({ code: 1006 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(warn).toHaveBeenCalledWith(
        '[Let It Snow] Failed to reconnect to the relay:',
        expect.any(Error)
      );
      expect((await sendExtensionMessage({ type: 'GET_RELAY_STATUS' })).state).toBe('error');
      await vi.advanceTimersByTimeAsync(2000);
      expect(sockets).toHaveLength(2);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('reports commands without any eligible destination', async () => {
    chrome.tabs = { query: vi.fn().mockResolvedValue([]), sendMessage: vi.fn() };

    await expect(sendExtensionMessage({
      type: 'DISPATCH_SNOW_COMMAND',
      command: { command: 'burst' }
    })).resolves.toMatchObject({
      ok: false, error: 'no_targets', delivered: 0, relayed: false
    });
  });

  it('reports a disconnected relay even if the command reached a local tab', async () => {
    chrome.storage.local.get.mockResolvedValue({
      relayEnabled: true,
      relayUrl: 'ws://127.0.0.1:8787/ws',
      relayToken: 'x'.repeat(32)
    });
    chrome.tabs = {
      query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]),
      sendMessage: vi.fn().mockResolvedValue({ ok: true })
    };

    await expect(sendExtensionMessage({
      type: 'DISPATCH_SNOW_COMMAND',
      command: { command: 'burst' }
    })).resolves.toMatchObject({
      ok: false, error: 'relay_not_connected', delivered: 1, relayed: false
    });
  });

  it('does not publish to a still-open relay after it is disabled in settings', async () => {
    chrome.tabs = { query: vi.fn().mockResolvedValue([{ id: 1 }]), sendMessage: vi.fn().mockResolvedValue({ ok: true }) };
    const [socket] = await connectRelay();
    socket.onmessage({ data: JSON.stringify({ type: 'auth_ok', clientId: 'c1', peers: 1 }) });
    chrome.storage.local.get.mockResolvedValue({ relayEnabled: false });
    try {
      const result = await sendExtensionMessage({
        type: 'DISPATCH_SNOW_COMMAND',
        command: { command: 'burst' }
      });
      expect(result).toMatchObject({ ok: true, delivered: 1, relayed: false });
      expect(socket.send).not.toHaveBeenCalled();
    } finally {
      socket.onclose({ code: 4401 });
    }
  });

  it('reports failures to contact the background worker from the popup', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    chrome.runtime.sendMessage = vi.fn().mockRejectedValue(new Error('worker unavailable'));
    const { requestSnowSync } = await import('../src/popup/api-panel.js');

    requestSnowSync('startSnow', {}, 1);

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        '[Let It Snow] Failed to contact the background worker:',
        expect.any(Error)
      );
    });
  });

  it('reports synchronization errors returned to the popup', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      ok: false, error: 'relay_not_connected', delivered: 1
    });
    const { requestSnowSync } = await import('../src/popup/api-panel.js');

    requestSnowSync('startSnow', {}, 1);

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        '[Let It Snow] Snow synchronization failed:', 'relay_not_connected'
      );
    });
  });
});
