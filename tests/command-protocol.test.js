import { describe, it, expect } from 'vitest';
import {
  validateCommand,
  sanitizeImageUrl,
  sanitizeSymbols,
  isPrivateHostname,
  isLoopbackWebSocketUrl,
  isValidToken,
  generateToken,
  parseOriginList,
  isOriginAllowed,
  createRateLimiter,
  timingSafeEqualStrings,
  LIMITS
} from '../src/api/command-protocol.js';

describe('command protocol', () => {
  it('rejects unknown commands and malformed payloads', () => {
    expect(validateCommand(null).ok).toBe(false);
    expect(validateCommand([]).ok).toBe(false);
    expect(validateCommand({ command: 'eval' }).ok).toBe(false);
    expect(validateCommand({ command: '__proto__' }).ok).toBe(false);
    expect(validateCommand({ command: 'burst', params: [] }).ok).toBe(false);
    expect(validateCommand({ command: 'burst', id: '<script>' }).ok).toBe(false);
    expect(validateCommand({ type: 'auth', command: 'stop' }).ok).toBe(false);
  });

  it('clamps burst parameters and drops unknown fields', () => {
    const result = validateCommand({
      command: 'burst',
      id: 'req-1',
      params: { count: 1e9, durationMs: -5, speed: 'fast', colors: ['#FFF', 'red', 'url(x)'], extra: 1 }
    });
    expect(result.ok).toBe(true);
    expect(result.command).toEqual({
      command: 'burst',
      id: 'req-1',
      params: {
        count: LIMITS.maxBurstCount,
        durationMs: LIMITS.minDurationMs,
        speed: 1.6,
        symbols: [],
        colors: ['#fff'],
        entry: 'instant'
      }
    });
  });

  it('supports permanent and timed wind', () => {
    expect(validateCommand({ command: 'wind', params: { durationMs: 0 } }).command.params.durationMs).toBe(0);
    expect(validateCommand({ command: 'wind', params: { durationMs: '0' } }).command.params.durationMs).toBe(0);
    for (const durationMs of [false, '']) {
      expect(validateCommand({ command: 'wind', params: { durationMs } }).command.params.durationMs).toBe(8000);
    }
    const wind = validateCommand({ command: 'wind', params: { direction: 'up', strength: 10 } }).command.params;
    expect(wind).toMatchObject({ direction: 'random', strength: 3, enabled: true, durationMs: 8000 });
  });

  it('requires symbols for glyphs and sanitizes them', () => {
    expect(validateCommand({ command: 'glyphs', params: {} }).ok).toBe(false);
    expect(sanitizeSymbols(['❄', '❄', '\u202Eabc', 'x'.repeat(40), 5, '🎄'])).toEqual(['❄', 'abc', '🎄']);
    const glyphs = validateCommand({ command: 'glyphs', params: { symbols: '⭐', glyphMode: 'emoji' } });
    expect(glyphs.command.params).toMatchObject({ symbols: ['⭐'], glyphMode: 'emoji' });
  });

  it('allows only public https or data:image GIF urls', () => {
    expect(sanitizeImageUrl('https://media.example.com/a.gif')).toBe('https://media.example.com/a.gif');
    expect(sanitizeImageUrl('data:image/gif;base64,R0lGODlhAQABAAAAACw=')).toBeTruthy();
    for (const bad of [
      'http://example.com/a.gif',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'https://127.0.0.1/a.gif',
      'https://localhost/a.gif',
      'https://192.168.1.10/a.gif',
      'https://[::1]/a.gif',
      'https://[fe90::1]/a.gif',
      'https://[febf::1]/a.gif',
      'https://[fec0::1]/a.gif',
      'https://[ff02::1]/a.gif',
      'https://2130706433/a.gif',
      'https://user:pass@example.com/a.gif',
      'https://example.com:8443/a.gif',
      'data:text/html;base64,PHNjcmlwdD4=',
      'chrome-extension://abc/x.gif'
    ]) {
      expect(sanitizeImageUrl(bad), bad).toBeNull();
    }
    expect(validateCommand({ command: 'gif', params: { urls: ['http://x.com/a.gif'] } }).ok).toBe(false);
  });

  it('detects private hostnames', () => {
    expect(isPrivateHostname('10.0.0.1')).toBe(true);
    expect(isPrivateHostname('172.20.1.1')).toBe(true);
    expect(isPrivateHostname('printer.local')).toBe(true);
    expect(isPrivateHostname('intranet')).toBe(true);
    expect(isPrivateHostname('[fe90::1]')).toBe(true);
    expect(isPrivateHostname('[ff02::1]')).toBe(true);
    expect(isPrivateHostname('[2606:4700:4700::1111]')).toBe(false);
    expect(isPrivateHostname('8.8.8.8')).toBe(false);
    expect(isPrivateHostname('giphy.com')).toBe(false);
  });

  it('sanitizes start config', () => {
    const result = validateCommand({
      command: 'start',
      params: { config: { snowmax: 5000, rendererMode: 'webgpu', symbols: ['✦'], gifUrls: ['https://x'] } }
    });
    expect(result.command.params.config).toEqual({ snowmax: 320, snowletters: ['✦'], snowglyphmodes: ['text'] });
  });

  it('preserves validated start glyph modes across relay and content-script validation', () => {
    const original = validateCommand({
      command: 'start',
      params: { config: { symbols: ['🎉', '✨'], glyphMode: 'emoji', rendererMode: '3d' } }
    });
    const relayed = validateCommand(original.command);
    const delivered = validateCommand(relayed.command);

    expect(delivered.command).toEqual(original.command);
    expect(delivered.command.params.config.snowglyphmodes).toEqual(['emoji', 'emoji']);
  });

  it('keeps per-symbol modes aligned when start symbols are sanitized', () => {
    const result = validateCommand({
      command: 'start',
      params: {
        config: {
          snowletters: ['', '❄', '❄', '✨', 'x'.repeat(40)],
          snowglyphmodes: ['emoji', 'text', 'emoji', 'emoji', 'invalid']
        }
      }
    });
    expect(result.command.params.config).toEqual({
      snowletters: ['❄', '✨'],
      snowglyphmodes: ['text', 'emoji']
    });
    expect(validateCommand(result.command).command).toEqual(result.command);
  });

  it('accepts only loopback websocket relays', () => {
    expect(isLoopbackWebSocketUrl('ws://127.0.0.1:8787/ws')).toBe(true);
    expect(isLoopbackWebSocketUrl('ws://localhost:8787/ws')).toBe(true);
    expect(isLoopbackWebSocketUrl('ws://[::1]:8787/ws')).toBe(true);
    expect(isLoopbackWebSocketUrl('ws://example.com/ws')).toBe(false);
    expect(isLoopbackWebSocketUrl('ws://127.0.0.1.evil.com/ws')).toBe(false);
    expect(isLoopbackWebSocketUrl('http://127.0.0.1:8787/ws')).toBe(false);
  });

  it('validates and generates tokens', () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(isValidToken(token)).toBe(true);
    expect(isValidToken('short')).toBe(false);
    expect(isValidToken('a'.repeat(30) + ' ')).toBe(false);
    expect(timingSafeEqualStrings(token, token)).toBe(true);
    expect(timingSafeEqualStrings(token.slice(1), token)).toBe(false);
  });

  it('parses explicit origin allowlists without wildcards', () => {
    expect(parseOriginList('https://a.com, http://localhost:3000/\n*  https://b.com/path null')).toEqual([
      'https://a.com',
      'http://localhost:3000'
    ]);
    expect(isOriginAllowed('https://a.com', ['https://a.com'])).toBe(true);
    expect(isOriginAllowed('null', ['null'])).toBe(false);
    expect(isOriginAllowed('https://evil.com', ['https://a.com'])).toBe(false);
  });

  it('rate limits with a sliding window', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 2, intervalMs: 1000, now: () => now });
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);
    now = 1001;
    expect(limiter.tryConsume()).toBe(true);
  });
});
