// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRelayServer, loadOrCreateTokenFile, tokensEqual } from '../scripts/snow-relay.js';
import { validateCommand } from '../src/api/command-protocol.js';

const TOKEN = 'test-token-0123456789abcdef0123456789';
let relay = null;

const startRelay = async (extra = {}) => {
  relay = createRelayServer({ token: TOKEN, port: 0, ...extra });
  const port = await relay.listen();
  return port;
};

const openClient = (port, { token = TOKEN, kind = 'extension', headers } = {}) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, headers ? { headers } : undefined);
    const messages = [];
    const waiters = [];
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      messages.push(message);
      waiters.splice(0).forEach((fn) => fn());
    };
    ws.onerror = () => reject(new Error('ws error'));
    ws.onclose = (event) => {
      ws.closeCode = event.code;
      waiters.splice(0).forEach((fn) => fn());
    };
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token, client: { kind, name: 'test' } }));
      resolve({
        ws,
        messages,
        next(type, timeoutMs = 2000) {
          return new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error(`timeout waiting for ${type}`)), timeoutMs);
            const check = () => {
              const index = messages.findIndex((m) => m.type === type);
              if (index !== -1) {
                clearTimeout(timer);
                res(messages.splice(index, 1)[0]);
              } else if (ws.readyState >= 2) {
                clearTimeout(timer);
                res(null);
              } else {
                waiters.push(check);
              }
            };
            check();
          });
        }
      });
    };
  });

const post = (port, body, { token = TOKEN, headers = {} } = {}) =>
  fetch(`http://127.0.0.1:${port}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });

afterEach(async () => {
  await relay?.close();
  relay = null;
});

describe('snow relay', () => {
  it('refuses weak tokens and non-loopback hosts', () => {
    expect(() => createRelayServer({ token: 'short' })).toThrow();
    expect(() => createRelayServer({ token: TOKEN, host: '0.0.0.0' })).toThrow();
  });

  it('compares tokens safely', () => {
    expect(tokensEqual(TOKEN, TOKEN)).toBe(true);
    expect(tokensEqual(`${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokensEqual(undefined, TOKEN)).toBe(false);
  });

  it('serves health without leaking details', async () => {
    const port = await startRelay();
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await response.json()).toEqual({ ok: true, service: 'let-it-snow-relay' });
  });

  it('delivers authorized HTTP commands to authenticated clients after validation', async () => {
    const port = await startRelay();
    const client = await openClient(port);
    expect(await client.next('auth_ok')).toMatchObject({ type: 'auth_ok' });

    const response = await post(port, { command: 'burst', params: { count: 99999, evil: true }, id: 'a1' });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ ok: true, delivered: 1, id: 'a1' });

    const command = await client.next('command');
    expect(command.command).toBe('burst');
    expect(command.params.count).toBe(600);
    expect(command.params.evil).toBeUndefined();
    client.ws.close();
  });

  it('retains emoji glyph modes when a start command is validated again after delivery', async () => {
    const port = await startRelay();
    const client = await openClient(port);
    await client.next('auth_ok');

    const response = await post(port, {
      command: 'start',
      params: { config: { symbols: ['🎉', '✨'], glyphMode: 'emoji', rendererMode: '3d' } }
    });
    expect(response.status).toBe(202);
    const received = await client.next('command');
    const validated = validateCommand(received);
    expect(validated.ok).toBe(true);
    expect(validated.command.params.config.snowglyphmodes).toEqual(['emoji', 'emoji']);
    client.ws.close();
  });

  it('rejects bad tokens, invalid commands, wrong content type and foreign origins', async () => {
    const port = await startRelay();
    expect((await post(port, { command: 'stop' }, { token: 'wrong-token-wrong-token-wrong' })).status).toBe(401);
    expect((await post(port, { command: 'rm -rf' })).status).toBe(400);
    expect((await post(port, { command: 'stop' }, { headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
    expect((await post(port, { command: 'stop' }, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await post(port, 'x'.repeat(40 * 1024))).status).toBe(413);
  });

  it('closes websocket clients with an invalid token', async () => {
    const port = await startRelay();
    const client = await openClient(port, { token: 'nope-nope-nope-nope-nope-nope' });
    expect(await client.next('auth_ok')).toBeNull();
    expect(client.ws.closeCode).toBe(4401);
  });

  it('relays commands between clients without echoing to the sender', async () => {
    const port = await startRelay();
    const a = await openClient(port);
    const b = await openClient(port, { kind: 'obs' });
    await a.next('auth_ok');
    await b.next('auth_ok');

    a.ws.send(JSON.stringify({ type: 'command', command: 'wind', params: { strength: 50, direction: 'left' } }));
    const received = await b.next('command');
    expect(received).toMatchObject({ command: 'wind', from: 'extension' });
    expect(received.params.strength).toBe(3);
    await expect(a.next('command', 300)).rejects.toThrow('timeout');
    a.ws.close();
    b.ws.close();
  });

  it('rejects DNS-rebinding style Host headers', async () => {
    const port = await startRelay();
    const http = await import('node:http');
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/health', headers: { Host: `evil.example:${port}` } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(421);
  });

  it('blocks path traversal for the OBS overlay', async () => {
    const port = await startRelay();
    const response = await fetch(`http://127.0.0.1:${port}/obs/..%2f..%2fpackage.json`);
    expect([403, 404]).toContain(response.status);
  });

  it('serves the embedded overlay from memory for the standalone build', async () => {
    const staticFiles = new Map([
      ['index.html', Buffer.from('<!doctype html><title>embedded</title>')],
      ['overlay.js', Buffer.from('console.log(1)')]
    ]);
    const port = await startRelay({ staticFiles });
    const index = await fetch(`http://127.0.0.1:${port}/obs/`);
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('embedded');
    const script = await fetch(`http://127.0.0.1:${port}/obs/overlay.js`);
    expect(script.headers.get('content-type')).toMatch(/javascript/);
    expect((await fetch(`http://127.0.0.1:${port}/obs/missing.js`)).status).toBe(404);
    expect([403, 404]).toContain((await fetch(`http://127.0.0.1:${port}/obs/..%2findex.html`)).status);
  });

  it('creates a private token file once and reuses it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lis-relay-'));
    try {
      const file = path.join(dir, 'nested', 'relay-token.txt');
      const first = loadOrCreateTokenFile(file);
      expect(first.created).toBe(true);
      expect(first.token).toMatch(/^[0-9a-f]{64}$/);
      expect(readFileSync(file, 'utf8').trim()).toBe(first.token);
      const second = loadOrCreateTokenFile(file);
      expect(second).toEqual({ token: first.token, created: false });
      writeFileSync(file, 'weak');
      const regenerated = loadOrCreateTokenFile(file);
      expect(regenerated.created).toBe(true);
      expect(regenerated.token).not.toBe(first.token);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
