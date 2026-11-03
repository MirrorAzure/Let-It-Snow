#!/usr/bin/env node
/**
 * Let It Snow — локальный relay для внешнего API, синхронизации браузеров и OBS.
 *
 * Без внешних зависимостей. Слушает ТОЛЬКО loopback (127.0.0.1 / ::1).
 *
 *   node scripts/snow-relay.js [--port 8787] [--host 127.0.0.1] [--token <token>]
 *                              [--allow-origin https://example.com] [--allow-file-origin]
 *
 * Токен: --token, переменная окружения SNOW_RELAY_TOKEN, иначе генерируется
 * случайный и печатается в консоль.
 *
 * Endpoints:
 *   GET  /health                  — проверка работоспособности (без токена, без деталей)
 *   POST /api/command             — команда (Authorization: Bearer <token>, JSON)
 *   WS   /ws                      — клиенты (расширения, OBS-оверлей); первое сообщение — auth
 *   GET  /obs/                    — OBS-оверлей (dist/obs, собирается `pnpm build:obs`)
 *
 * Защита:
 *   - проверка Host (защита от DNS rebinding) и Origin (белый список);
 *   - токен ≥ 24 символов, сравнение за постоянное время;
 *   - нет CORS-заголовков: обычные сайты не могут читать ответы и слать команды;
 *   - ограничения размера кадров/тел, частоты команд и числа клиентов;
 *   - каждая команда проходит validateCommand() перед рассылкой.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_RELAY_PORT,
  LIMITS,
  MIN_TOKEN_LENGTH,
  validateCommand,
  createRateLimiter,
  isValidToken,
  parseOriginList
} from '../src/api/command-protocol.js';

const __dirname = (() => {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
})();
const DEFAULT_STATIC_DIR = path.join(__dirname, '..', 'dist', 'obs');
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const AUTH_TIMEOUT_MS = 5000;
const MAX_CLIENTS = 32;
const IDLE_TIMEOUT_MS = 90000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store'
};

const OVERLAY_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: blob:",
  "connect-src 'self' ws://127.0.0.1:* ws://localhost:* https: data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest();

/** Сравнение токенов за постоянное время (через хеши одинаковой длины). */
export function tokensEqual(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  return crypto.timingSafeEqual(sha256(provided), sha256(expected));
}

const parseArgs = (argv) => {
  const args = { allowOrigins: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--port') args.port = Number(next());
    else if (arg === '--host') args.host = next();
    else if (arg === '--token') args.token = next();
    else if (arg === '--allow-origin') args.allowOrigins.push(next());
    else if (arg === '--allow-file-origin') args.allowFileOrigin = true;
    else if (arg === '--static-dir') args.staticDir = next();
    else if (arg === '--token-file') args.tokenFile = next();
    else if (arg === '--pid-file') args.pidFile = next();
    else if (arg === '--parent-pid') args.parentPid = Number(next());
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--version' || arg === '-v') args.version = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
};

// ---------------------------------------------------------------------------
// Минимальная реализация WebSocket (RFC 6455), только текстовые кадры
// ---------------------------------------------------------------------------

const encodeFrame = (opcode, payload = Buffer.alloc(0)) => {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
};

class WsConnection {
  constructor(socket, { onText, onClose, maxPayload }) {
    this.socket = socket;
    this.onText = onText;
    this.onClose = onClose;
    this.maxPayload = maxPayload;
    this.buffer = Buffer.alloc(0);
    this.fragments = null;
    this.closed = false;
    socket.setNoDelay(true);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => this._finalize());
    socket.on('error', () => this._finalize());
  }

  sendJson(data) {
    this.sendText(JSON.stringify(data));
  }

  sendText(text) {
    if (this.closed) return;
    this.socket.write(encodeFrame(0x1, Buffer.from(text, 'utf8')));
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    const reasonBuffer = Buffer.from(String(reason).slice(0, 100), 'utf8');
    const payload = Buffer.alloc(2 + reasonBuffer.length);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);
    try {
      this.socket.write(encodeFrame(0x8, payload));
    } catch {
      // ignore
    }
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 1000).unref?.();
    this._finalize();
  }

  _finalize() {
    if (this.closed) return;
    this.closed = true;
    this.onClose?.();
  }

  _onData(chunk) {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > this.maxPayload * 2 + 14) {
      this.close(1009, 'too large');
      return;
    }

    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;

      if ((first & 0x70) !== 0 || !masked) {
        this.close(1002, 'protocol error');
        return;
      }
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const big = this.buffer.readBigUInt64BE(2);
        if (big > BigInt(this.maxPayload)) {
          this.close(1009, 'too large');
          return;
        }
        length = Number(big);
        offset = 10;
      }
      if (length > this.maxPayload) {
        this.close(1009, 'too large');
        return;
      }
      if (this.buffer.length < offset + 4 + length) return;

      const mask = this.buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(this.buffer.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buffer = this.buffer.subarray(offset + 4 + length);

      if (opcode === 0x8) {
        this.close(1000, '');
        return;
      }
      if (opcode === 0x9) {
        this.socket.write(encodeFrame(0xa, payload));
        continue;
      }
      if (opcode === 0xa) continue;

      if (opcode === 0x1 || (opcode === 0x0 && this.fragments)) {
        const parts = opcode === 0x0 ? [...this.fragments, payload] : [payload];
        const total = parts.reduce((sum, part) => sum + part.length, 0);
        if (total > this.maxPayload) {
          this.close(1009, 'too large');
          return;
        }
        if (!fin) {
          this.fragments = parts;
          continue;
        }
        this.fragments = null;
        this.onText?.(Buffer.concat(parts).toString('utf8'));
        continue;
      }

      // Бинарные и неизвестные кадры не поддерживаются.
      this.close(1003, 'unsupported');
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Relay server
// ---------------------------------------------------------------------------

/**
 * @param {Object} options
 * @param {string} options.token
 * @param {number} [options.port]
 * @param {string} [options.host]
 * @param {string[]} [options.allowOrigins]
 * @param {boolean} [options.allowFileOrigin]
 * @param {string} [options.staticDir]
 * @param {(msg: string) => void} [options.log]
 */
export function createRelayServer(options) {
  const token = options.token;
  if (!isValidToken(token)) {
    throw new Error(`Relay token must be ${MIN_TOKEN_LENGTH}+ characters [A-Za-z0-9_-.~+/=]`);
  }
  const host = options.host || '127.0.0.1';
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error('Relay can only listen on a loopback address (127.0.0.1, ::1, localhost)');
  }
  const staticDir = options.staticDir || DEFAULT_STATIC_DIR;
  const staticFiles = options.staticFiles instanceof Map ? options.staticFiles : null;
  const extraOrigins = parseOriginList(options.allowOrigins || []);
  const log = options.log || (() => {});
  const clients = new Map();
  const httpLimiter = createRateLimiter({ max: 60, intervalMs: 10000 });
  let listeningPort = options.port ?? DEFAULT_RELAY_PORT;
  let clientSeq = 0;

  const isAllowedHost = (hostHeader) => {
    if (typeof hostHeader !== 'string') return false;
    const match = hostHeader.toLowerCase().match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
    if (!match) return false;
    const hostname = match[1].replace(/^\[|\]$/g, '');
    const port = match[2] ? Number(match[2]) : 80;
    return LOOPBACK_HOSTS.has(hostname) && port === listeningPort;
  };

  const isAllowedOrigin = (origin) => {
    if (origin === undefined) return true; // не браузерный клиент (curl, скрипты, Stream Deck)
    if (origin === 'null') return Boolean(options.allowFileOrigin);
    if (/^(chrome-extension|moz-extension|extension):\/\/[A-Za-z0-9-]+$/.test(origin)) return true;
    const own = [`http://127.0.0.1:${listeningPort}`, `http://localhost:${listeningPort}`, `http://[::1]:${listeningPort}`];
    return own.includes(origin) || extraOrigins.includes(origin);
  };

  const authenticatedClients = () => [...clients.values()].filter((client) => client.authenticated);

  const broadcastPeers = () => {
    const peers = authenticatedClients().length;
    authenticatedClients().forEach((client) => client.ws.sendJson({ type: 'peers', peers }));
  };

  const broadcastCommand = (command, fromClient = null) => {
    let delivered = 0;
    const message = {
      type: 'command',
      command: command.command,
      params: command.params,
      id: command.id,
      from: fromClient ? fromClient.kind : 'http'
    };
    for (const client of authenticatedClients()) {
      if (client === fromClient) continue;
      client.ws.sendJson(message);
      delivered++;
    }
    return delivered;
  };

  const sendJsonResponse = (res, status, body, extraHeaders = {}) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      ...extraHeaders
    });
    res.end(payload);
  };

  const serveStatic = (req, res, pathname) => {
    let relative = pathname.replace(/^\/obs\/?/, '') || 'index.html';
    try {
      relative = decodeURIComponent(relative);
    } catch {
      sendJsonResponse(res, 400, { ok: false, error: 'bad_path' });
      return;
    }
    const filePath = path.resolve(staticDir, relative);
    const root = path.resolve(staticDir) + path.sep;
    if (!filePath.startsWith(root) || relative.includes('\0')) {
      sendJsonResponse(res, 403, { ok: false, error: 'forbidden' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    if (!MIME_TYPES[ext]) {
      sendJsonResponse(res, 404, { ok: false, error: 'not_found' });
      return;
    }
    const send = (err, data) => {
      if (err) {
        const hint = relative === 'index.html' ? 'overlay_not_built_run_pnpm_build_obs' : 'not_found';
        sendJsonResponse(res, 404, { ok: false, error: hint });
        return;
      }
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': MIME_TYPES[ext],
        'Content-Length': data.length,
        ...(ext === '.html' ? { 'Content-Security-Policy': OVERLAY_CSP, 'X-Frame-Options': 'DENY' } : {})
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    };
    if (staticFiles) {
      // Embedded overlay (standalone build): keys are POSIX paths relative to the overlay root.
      const key = path.relative(path.resolve(staticDir), filePath).split(path.sep).join('/');
      const data = staticFiles.get(key);
      send(data ? null : new Error('not_found'), data);
      return;
    }
    fs.readFile(filePath, send);
  };

  const readBody = (req) => new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > LIMITS.maxPayloadBytes) {
      reject(Object.assign(new Error('payload_too_large'), { status: 413 }));
      return;
    }
    let size = 0;
    let failed = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > LIMITS.maxPayloadBytes) {
        failed = true;
        chunks.length = 0;
        reject(Object.assign(new Error('payload_too_large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });

  const handleCommandRequest = async (req, res) => {
    const authHeader = req.headers.authorization || '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!tokensEqual(provided, token)) {
      sendJsonResponse(res, 401, { ok: false, error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
      return;
    }
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      sendJsonResponse(res, 415, { ok: false, error: 'content_type_must_be_json' });
      return;
    }
    if (!httpLimiter.tryConsume()) {
      sendJsonResponse(res, 429, { ok: false, error: 'rate_limited' });
      return;
    }
    let raw;
    try {
      raw = JSON.parse(await readBody(req));
    } catch (err) {
      const extra = err?.status === 413 ? { Connection: 'close' } : {};
      sendJsonResponse(res, err?.status || 400, { ok: false, error: err?.status ? err.message : 'invalid_json' }, extra);
      if (err?.status === 413) res.on('finish', () => req.destroy());
      return;
    }
    const validation = validateCommand(raw);
    if (!validation.ok) {
      sendJsonResponse(res, 400, { ok: false, error: validation.error });
      return;
    }
    const delivered = broadcastCommand(validation.command);
    log(`[relay] http → ${validation.command.command} (delivered: ${delivered})`);
    sendJsonResponse(res, 202, { ok: true, delivered, id: validation.command.id });
  };

  const server = http.createServer((req, res) => {
    if (!isAllowedHost(req.headers.host)) {
      sendJsonResponse(res, 421, { ok: false, error: 'invalid_host' });
      return;
    }
    if (!isAllowedOrigin(req.headers.origin)) {
      sendJsonResponse(res, 403, { ok: false, error: 'forbidden_origin' });
      return;
    }

    const { pathname } = new URL(req.url, 'http://relay.invalid');

    if (pathname === '/health' && (req.method === 'GET' || req.method === 'HEAD')) {
      sendJsonResponse(res, 200, { ok: true, service: 'let-it-snow-relay' });
      return;
    }
    if (pathname === '/api/command') {
      if (req.method !== 'POST') {
        sendJsonResponse(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: 'POST' });
        return;
      }
      handleCommandRequest(req, res).catch(() => {
        if (!res.headersSent) sendJsonResponse(res, 500, { ok: false, error: 'internal_error' });
      });
      return;
    }
    if (pathname === '/obs') {
      res.writeHead(308, { ...SECURITY_HEADERS, Location: '/obs/' });
      res.end();
      return;
    }
    if (pathname.startsWith('/obs/') && (req.method === 'GET' || req.method === 'HEAD')) {
      serveStatic(req, res, pathname);
      return;
    }
    sendJsonResponse(res, 404, { ok: false, error: 'not_found' });
  });

  server.on('upgrade', (req, socket) => {
    const reject = (status, text) => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    let pathname = '';
    try {
      pathname = new URL(req.url, 'http://relay.invalid').pathname;
    } catch {
      // ignore
    }
    if (pathname !== '/ws') return reject(404, 'Not Found');
    if (!isAllowedHost(req.headers.host)) return reject(421, 'Misdirected Request');
    if (!isAllowedOrigin(req.headers.origin)) return reject(403, 'Forbidden');
    if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket') return reject(400, 'Bad Request');
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key)) return reject(400, 'Bad Request');
    if (clients.size >= MAX_CLIENTS) return reject(503, 'Service Unavailable');

    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      ''
    ].join('\r\n'));

    const client = {
      id: `c${++clientSeq}-${crypto.randomBytes(4).toString('hex')}`,
      authenticated: false,
      kind: 'unknown',
      name: '',
      limiter: createRateLimiter({ max: 30, intervalMs: 10000 }),
      ws: null,
      lastSeen: Date.now()
    };

    const authTimer = setTimeout(() => {
      if (!client.authenticated) client.ws.close(4401, 'auth timeout');
    }, AUTH_TIMEOUT_MS);
    authTimer.unref?.();

    client.ws = new WsConnection(socket, {
      maxPayload: LIMITS.maxPayloadBytes,
      onClose: () => {
        clearTimeout(authTimer);
        const wasAuthenticated = client.authenticated;
        clients.delete(client.id);
        if (wasAuthenticated) {
          log(`[relay] disconnected ${client.kind} "${client.name}" (${client.id})`);
          broadcastPeers();
        }
      },
      onText: (text) => {
        client.lastSeen = Date.now();
        let message;
        try {
          message = JSON.parse(text);
        } catch {
          client.ws.sendJson({ type: 'error', error: 'invalid_json' });
          return;
        }
        if (!message || typeof message !== 'object') return;

        if (!client.authenticated) {
          if (message.type !== 'auth' || !tokensEqual(message.token, token)) {
            client.ws.close(4401, 'unauthorized');
            return;
          }
          clearTimeout(authTimer);
          client.authenticated = true;
          const kind = String(message.client?.kind || 'client');
          client.kind = ['extension', 'obs', 'client'].includes(kind) ? kind : 'client';
          client.name = String(message.client?.name || '').replace(/[^\w .()/-]/g, '').slice(0, 64);
          const peers = authenticatedClients().length;
          client.ws.sendJson({ type: 'auth_ok', clientId: client.id, peers });
          log(`[relay] connected ${client.kind} "${client.name}" (${client.id})`);
          broadcastPeers();
          return;
        }

        if (message.type === 'ping') {
          client.ws.sendJson({ type: 'pong' });
          return;
        }
        if (message.type === 'command') {
          if (!client.limiter.tryConsume()) {
            client.ws.sendJson({ type: 'error', error: 'rate_limited' });
            return;
          }
          const validation = validateCommand(message);
          if (!validation.ok) {
            client.ws.sendJson({ type: 'error', error: validation.error });
            return;
          }
          const delivered = broadcastCommand(validation.command, client);
          log(`[relay] ${client.kind} → ${validation.command.command} (delivered: ${delivered})`);
          return;
        }
        client.ws.sendJson({ type: 'error', error: 'unknown_type' });
      }
    });
    clients.set(client.id, client);
  });

  const idleTimer = setInterval(() => {
    const now = Date.now();
    for (const client of clients.values()) {
      if (now - client.lastSeen > IDLE_TIMEOUT_MS) client.ws.close(4408, 'idle');
    }
  }, 15000);
  idleTimer.unref?.();

  return {
    server,
    clients,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port ?? DEFAULT_RELAY_PORT, host, () => {
          server.off('error', reject);
          listeningPort = server.address().port;
          resolve(listeningPort);
        });
      });
    },
    get port() {
      return listeningPort;
    },
    broadcastCommand,
    close() {
      clearInterval(idleTimer);
      for (const client of clients.values()) client.ws.close(1001, 'server shutdown');
      return new Promise((resolve) => server.close(() => resolve()));
    }
  };
}

const printHelp = (command) => {
  console.log(`Let It Snow relay

Usage: ${command} [options]

  --port <n>             Port (default ${DEFAULT_RELAY_PORT})
  --host <addr>          Loopback address: 127.0.0.1 (default), ::1, localhost
  --token <token>        Shared secret (or env SNOW_RELAY_TOKEN)
  --token-file <path>    Read the token from a file; create it with a random token if missing
  --allow-origin <url>   Extra allowed browser origin (repeatable)
  --allow-file-origin    Allow Origin "null" (overlay opened from file://)
  --static-dir <dir>     OBS overlay directory (default dist/obs)
  --pid-file <path>      Write the process id to a file (removed on exit)
  --parent-pid <pid>     Exit automatically when this process (e.g. OBS) exits
  --quiet                Less logging
  --version              Print the version
`);
};

/**
 * Reads a persisted token or creates one (owner-only permissions where supported).
 * @returns {{ token: string, created: boolean }}
 */
export function loadOrCreateTokenFile(filePath) {
  try {
    const existing = fs.readFileSync(filePath, 'utf8').trim();
    if (isValidToken(existing)) return { token: existing, created: false };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const token = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  return { token, created: true };
}

const isProcessAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

/**
 * CLI entry shared by `node scripts/snow-relay.js` and the standalone executable.
 * @param {string[]} argv
 * @param {{ staticFiles?: Map<string, Buffer>, defaultTokenFile?: string, version?: string, command?: string }} [runtime]
 */
export function runRelayCli(argv, runtime = {}) {
  const args = parseArgs(argv);
  const command = runtime.command || 'node scripts/snow-relay.js';
  if (args.help) {
    printHelp(command);
    return null;
  }
  if (args.version) {
    console.log(runtime.version || 'dev');
    return null;
  }

  const tokenFile = args.tokenFile || (!args.token && !process.env.SNOW_RELAY_TOKEN ? runtime.defaultTokenFile : undefined);
  let token = args.token || process.env.SNOW_RELAY_TOKEN;
  let tokenNote = '';
  if (!token && tokenFile) {
    try {
      const loaded = loadOrCreateTokenFile(tokenFile);
      token = loaded.token;
      tokenNote = ` (${loaded.created ? 'generated and saved to' : 'loaded from'} ${tokenFile})`;
    } catch (err) {
      console.error(`✗ Cannot use token file ${tokenFile}: ${err.message}`);
      process.exitCode = 1;
      return null;
    }
  }
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    tokenNote = ' (generated, keep it secret)';
  }

  let relay;
  try {
    relay = createRelayServer({
      token,
      port: Number.isInteger(args.port) ? args.port : DEFAULT_RELAY_PORT,
      host: args.host,
      allowOrigins: args.allowOrigins,
      allowFileOrigin: args.allowFileOrigin,
      staticDir: args.staticDir,
      staticFiles: args.staticDir ? undefined : runtime.staticFiles,
      log: args.quiet ? () => {} : (msg) => console.log(msg)
    });
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exitCode = 1;
    return null;
  }

  const cleanupPidFile = () => {
    if (!args.pidFile) return;
    try {
      if (fs.readFileSync(args.pidFile, 'utf8').trim() === String(process.pid)) fs.unlinkSync(args.pidFile);
    } catch {
      // already removed
    }
  };

  let shuttingDown = false;
  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    cleanupPidFile();
    relay.close().then(() => process.exit(code));
    setTimeout(() => process.exit(code), 2000).unref();
  };

  relay.listen().then((port) => {
    if (args.pidFile) {
      fs.mkdirSync(path.dirname(path.resolve(args.pidFile)), { recursive: true });
      fs.writeFileSync(args.pidFile, String(process.pid), 'utf8');
    }
    const host = args.host && args.host !== 'localhost' ? args.host : '127.0.0.1';
    const base = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
    console.log('❄  Let It Snow relay is running');
    console.log(`   WebSocket:   ${base.replace('http', 'ws')}/ws`);
    console.log(`   HTTP API:    POST ${base}/api/command`);
    console.log(`   OBS overlay: ${base}/obs/#token=${token}`);
    console.log(`   Token${tokenNote}: ${token}`);
    const overlayAvailable = !args.staticDir && runtime.staticFiles
      ? runtime.staticFiles.has('index.html')
      : fs.existsSync(path.join(args.staticDir || DEFAULT_STATIC_DIR, 'index.html'));
    if (!overlayAvailable) {
      console.log('   ⚠ OBS overlay is not built yet: run `pnpm build:obs`');
    }
    console.log('   Press Ctrl+C to stop.');
  }).catch((err) => {
    console.error(`✗ Failed to start relay: ${err.message}`);
    process.exitCode = 1;
    relay.close();
  });

  if (Number.isInteger(args.parentPid) && args.parentPid > 0) {
    const watchdog = setInterval(() => {
      if (!isProcessAlive(args.parentPid)) {
        console.log('[relay] parent process exited, stopping');
        shutdown(0);
      }
    }, 2000);
    watchdog.unref();
  }

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('SIGHUP', () => shutdown(0));
  process.on('exit', cleanupPidFile);
  return relay;
}

const isMain = (() => {
  // The standalone build bundles this module; its own entry point starts the CLI.
  if (typeof __RELAY_EMBEDDED__ !== 'undefined' && __RELAY_EMBEDDED__) return false;
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  runRelayCli(process.argv.slice(2));
}
