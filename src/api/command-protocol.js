/**
 * Протокол внешнего API Let It Snow (v1).
 *
 * Общий модуль для content script, background, OBS-оверлея и локального relay
 * (scripts/snow-relay.js). Все внешние команды проходят через validateCommand():
 * неизвестные поля отбрасываются, числа ограничиваются безопасными диапазонами,
 * строки/цвета/URL проверяются по белым спискам.
 */

export const API_PROTOCOL_VERSION = 1;
export const PAGE_API_TARGET = 'let-it-snow-api';
export const PAGE_API_RESPONSE_TARGET = 'let-it-snow-api-response';
export const DEFAULT_RELAY_PORT = 8787;
export const DEFAULT_RELAY_URL = `ws://127.0.0.1:${DEFAULT_RELAY_PORT}/ws`;
export const MIN_TOKEN_LENGTH = 24;
export const MAX_TOKEN_LENGTH = 256;

export const LIMITS = Object.freeze({
  maxPayloadBytes: 32 * 1024,
  maxDurationMs: 120000,
  minDurationMs: 500,
  maxBurstCount: 600,
  maxGlyphCount: 300,
  maxGifCount: 60,
  maxSymbols: 16,
  maxSymbolCodePoints: 16,
  maxColors: 12,
  maxGifUrls: 5,
  maxUrlLength: 2048,
  maxDataUrlLength: 512 * 1024,
  maxEffectLayers: 4,
  maxIdLength: 64
});

export const COMMANDS = Object.freeze([
  'ping',
  'start',
  'stop',
  'status',
  'pause',
  'resume',
  'update',
  'clearAccumulation',
  'burst',
  'wind',
  'glyphs',
  'gif',
  'clearEffects'
]);

const WIND_DIRECTIONS = new Set(['left', 'right', 'random']);
const ENTRY_MODES = new Set(['instant', 'top']);
const GLYPH_MODES = new Set(['text', 'emoji']);
const RENDERER_MODES = new Set(['auto', '3d']);
const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const ID_RE = /^[A-Za-z0-9_.:-]+$/;
const DATA_IMAGE_RE = /^data:image\/(?:gif|png|webp|apng);base64,[A-Za-z0-9+/=\s]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const clampNumber = (value, min, max, fallback) => {
  if (value === undefined || value === null || value === '' || typeof value === 'boolean') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

const clampInt = (value, min, max, fallback) => Math.round(clampNumber(value, min, max, fallback));

const toArray = (value) => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.slice(0, 64) : [value];
};

/**
 * Очищает пользовательский символ/глиф: только строка, без управляющих символов,
 * ограниченная длина в code points.
 */
export function sanitizeSymbol(value) {
  if (typeof value !== 'string' || value.length > 256) return null;
  const cleaned = value.replace(CONTROL_CHARS_RE, '').trim();
  if (!cleaned) return null;
  if (Array.from(cleaned).length > LIMITS.maxSymbolCodePoints) return null;
  return cleaned;
}

export function sanitizeSymbols(value) {
  const result = [];
  for (const item of toArray(value)) {
    const symbol = sanitizeSymbol(item);
    if (symbol && !result.includes(symbol)) result.push(symbol);
    if (result.length >= LIMITS.maxSymbols) break;
  }
  return result;
}

export function sanitizeColors(value) {
  const result = [];
  for (const item of toArray(value)) {
    if (typeof item !== 'string') continue;
    const color = item.trim().toLowerCase();
    if (COLOR_RE.test(color) && !result.includes(color)) result.push(color);
    if (result.length >= LIMITS.maxColors) break;
  }
  return result;
}

/**
 * Грубая защита от SSRF: запрет loopback/private/link-local адресов и локальных имён.
 */
export function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;
  if (host.includes(':')) {
    return host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd')
      || /^fe[89a-f]/.test(host) || host.startsWith('ff')
      || host.startsWith('::ffff:') || host.startsWith('64:ff9b');
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  // Числовые/шестнадцатеричные формы IPv4 (например, 2130706433 или 0x7f.1) не принимаем.
  if (/^[0-9.]+$/.test(host) || /^0x/i.test(host)) return true;
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa')
    || !host.includes('.');
}

/**
 * Разрешены только https: на публичных хостах и data:image/* (base64). http:, blob:,
 * file:, javascript:, chrome-extension: и т.п. запрещены, чтобы внешняя команда
 * не могла заставить расширение обращаться к локальной сети или внутренним ресурсам.
 */
export function sanitizeImageUrl(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url) return null;
  if (url.startsWith('data:')) {
    if (url.length > LIMITS.maxDataUrlLength) return null;
    return DATA_IMAGE_RE.test(url) ? url : null;
  }
  if (url.length > LIMITS.maxUrlLength) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port && parsed.port !== '443') return null;
  if (isPrivateHostname(parsed.hostname)) return null;
  return parsed.href;
}

export function sanitizeImageUrls(value) {
  const result = [];
  for (const item of toArray(value)) {
    const url = sanitizeImageUrl(item);
    if (url && !result.includes(url)) result.push(url);
    if (result.length >= LIMITS.maxGifUrls) break;
  }
  return result;
}

const sanitizeDuration = (value, fallback, { allowPermanent = false } = {}) => {
  const numericZero = value === 0
    || (typeof value === 'string' && value.trim() !== '' && Number(value) === 0);
  if (allowPermanent && numericZero) return 0;
  return clampInt(value, LIMITS.minDurationMs, LIMITS.maxDurationMs, fallback);
};

const sanitizeEntry = (value, fallback) => (ENTRY_MODES.has(value) ? value : fallback);

/**
 * Безопасное подмножество настроек для команды start.
 */
export function sanitizeStartConfig(raw) {
  if (!isPlainObject(raw)) return {};
  const config = {};
  if (raw.snowmax !== undefined) config.snowmax = clampInt(raw.snowmax, 1, 320, 80);
  if (raw.sinkspeed !== undefined) config.sinkspeed = clampNumber(raw.sinkspeed, 0.1, 3, 0.4);
  if (raw.snowminsize !== undefined) config.snowminsize = clampNumber(raw.snowminsize, 2, 10, 2);
  if (raw.snowmaxsize !== undefined) config.snowmaxsize = clampNumber(raw.snowmaxsize, 2.1, 10, 4);
  const colors = sanitizeColors(raw.colors ?? raw.snowcolor);
  if (colors.length) config.snowcolor = colors;
  const rawSymbols = raw.symbols ?? raw.snowletters;
  const symbols = sanitizeSymbols(rawSymbols);
  if (symbols.length) {
    config.snowletters = symbols;
    const modesBySymbol = new Map();
    if (Array.isArray(raw.snowglyphmodes)) {
      toArray(rawSymbols).forEach((value, index) => {
        const symbol = sanitizeSymbol(value);
        const mode = raw.snowglyphmodes[index];
        if (symbol && !modesBySymbol.has(symbol)) {
          modesBySymbol.set(symbol, GLYPH_MODES.has(mode) ? mode : 'text');
        }
      });
    }
    const mode = GLYPH_MODES.has(raw.glyphMode) ? raw.glyphMode : null;
    config.snowglyphmodes = symbols.map((symbol) => mode || modesBySymbol.get(symbol) || 'text');
  }
  if (RENDERER_MODES.has(raw.rendererMode)) config.rendererMode = raw.rendererMode;
  if (raw.windEnabled !== undefined) config.windEnabled = raw.windEnabled === true;
  if (raw.accumulationEnabled !== undefined) config.accumulationEnabled = raw.accumulationEnabled === true;
  if (raw.mouseRadius !== undefined) config.mouseRadius = clampNumber(raw.mouseRadius, 0, 300, 100);
  if (WIND_DIRECTIONS.has(raw.windDirection)) config.windDirection = raw.windDirection;
  if (raw.windStrength !== undefined) config.windStrength = clampNumber(raw.windStrength, 0, 3, 0.5);
  if (raw.windGustFrequency !== undefined) {
    config.windGustFrequency = clampNumber(raw.windGustFrequency, 0.5, 10, 3);
  }
  return config;
}

const PARAM_SANITIZERS = {
  ping: () => ({ ok: true, params: {} }),
  status: () => ({ ok: true, params: {} }),
  pause: () => ({ ok: true, params: {} }),
  resume: () => ({ ok: true, params: {} }),
  clearAccumulation: () => ({ ok: true, params: {} }),
  update: (raw) => {
    const config = sanitizeStartConfig(raw.config);
    const liveKeys = new Set([
      'sinkspeed', 'mouseRadius', 'accumulationEnabled',
      'windEnabled', 'windDirection', 'windStrength', 'windGustFrequency'
    ]);
    for (const key of Object.keys(config)) {
      if (!liveKeys.has(key)) delete config[key];
    }
    return Object.keys(config).length
      ? { ok: true, params: { config } }
      : { ok: false, error: 'live_config_required' };
  },
  stop: () => ({ ok: true, params: {} }),
  clearEffects: () => ({ ok: true, params: {} }),
  start: (raw) => ({ ok: true, params: { config: sanitizeStartConfig(raw.config) } }),
  burst: (raw) => {
    const hasOrigin = raw.x !== undefined || raw.y !== undefined;
    if (hasOrigin && (typeof raw.x !== 'number' || typeof raw.y !== 'number'
      || !Number.isFinite(raw.x) || !Number.isFinite(raw.y))) {
      return { ok: false, error: 'invalid_coordinates' };
    }
    return {
      ok: true,
      params: {
        count: clampInt(raw.count, 1, LIMITS.maxBurstCount, 250),
        durationMs: sanitizeDuration(raw.durationMs, 6000),
        speed: clampNumber(raw.speed, 0.1, 6, 1.6),
        symbols: sanitizeSymbols(raw.symbols),
        glyphMode: GLYPH_MODES.has(raw.glyphMode) ? raw.glyphMode : 'text',
        colors: sanitizeColors(raw.colors),
        entry: sanitizeEntry(raw.entry, 'instant'),
        ...(hasOrigin ? {
          x: clampNumber(raw.x, 0, 100000, 0),
          y: clampNumber(raw.y, 0, 100000, 0)
        } : {})
      }
    };
  },
  wind: (raw) => ({
    ok: true,
    params: {
      enabled: raw.enabled !== false,
      direction: WIND_DIRECTIONS.has(raw.direction) ? raw.direction : 'random',
      strength: clampNumber(raw.strength, 0, 3, 1.6),
      gustFrequency: clampNumber(raw.gustFrequency, 0.5, 10, 5),
      durationMs: sanitizeDuration(raw.durationMs, 8000, { allowPermanent: true })
    }
  }),
  glyphs: (raw) => {
    const symbols = sanitizeSymbols(raw.symbols);
    if (!symbols.length) return { ok: false, error: 'symbols_required' };
    return {
      ok: true,
      params: {
        symbols,
        glyphMode: GLYPH_MODES.has(raw.glyphMode) ? raw.glyphMode : 'text',
        colors: sanitizeColors(raw.colors),
        count: clampInt(raw.count, 1, LIMITS.maxGlyphCount, 60),
        durationMs: sanitizeDuration(raw.durationMs, 10000),
        speed: clampNumber(raw.speed, 0.1, 6, 0.8),
        entry: sanitizeEntry(raw.entry, 'top')
      }
    };
  },
  gif: (raw) => {
    const urls = sanitizeImageUrls(raw.urls ?? raw.url);
    if (!urls.length) return { ok: false, error: 'valid_https_urls_required' };
    return {
      ok: true,
      params: {
        urls,
        count: clampInt(raw.count, 1, LIMITS.maxGifCount, 12),
        durationMs: sanitizeDuration(raw.durationMs, 10000),
        speed: clampNumber(raw.speed, 0.1, 6, 0.8),
        entry: sanitizeEntry(raw.entry, 'top')
      }
    };
  }
};

/**
 * Проверяет и нормализует внешнюю команду.
 * Принимает форму { command, params?, id? } (а также { type: 'command', ... }).
 * @returns {{ok: true, command: {command: string, params: Object, id: string|null}} | {ok: false, error: string}}
 */
export function validateCommand(raw) {
  if (!isPlainObject(raw)) return { ok: false, error: 'invalid_payload' };
  if (raw.type !== undefined && raw.type !== 'command') return { ok: false, error: 'invalid_type' };
  const name = raw.command;
  if (typeof name !== 'string' || !COMMANDS.includes(name)) {
    return { ok: false, error: 'unknown_command' };
  }
  const params = raw.params === undefined ? {} : raw.params;
  if (!isPlainObject(params)) return { ok: false, error: 'invalid_params' };

  let id = null;
  if (raw.id !== undefined && raw.id !== null) {
    if (typeof raw.id !== 'string' || raw.id.length > LIMITS.maxIdLength || !ID_RE.test(raw.id)) {
      return { ok: false, error: 'invalid_id' };
    }
    id = raw.id;
  }

  const result = PARAM_SANITIZERS[name](params);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, command: { command: name, params: result.params, id } };
}

/**
 * Скользящее окно для ограничения частоты команд.
 */
export function createRateLimiter({ max = 20, intervalMs = 10000, now = () => Date.now() } = {}) {
  const hits = [];
  return {
    tryConsume() {
      const current = now();
      while (hits.length && current - hits[0] >= intervalMs) hits.shift();
      if (hits.length >= max) return false;
      hits.push(current);
      return true;
    }
  };
}

/**
 * Разрешены только ws(s)-адреса на loopback-интерфейсе, чтобы расширение
 * не подключалось к удалённым серверам управления.
 */
export function isLoopbackWebSocketUrl(value) {
  if (typeof value !== 'string' || value.length > LIMITS.maxUrlLength) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

export function isValidToken(value) {
  return typeof value === 'string'
    && value.length >= MIN_TOKEN_LENGTH
    && value.length <= MAX_TOKEN_LENGTH
    && /^[A-Za-z0-9_\-.~+/=]+$/.test(value);
}

/**
 * Сравнение строк, время которого не зависит от позиции первого несовпадения.
 */
export function timingSafeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !b.length) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) {
    diff |= (a.charCodeAt(i % Math.max(1, a.length)) || 0) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function generateToken(bytes = 32) {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error('Secure random generator is unavailable');
  const buffer = new Uint8Array(bytes);
  cryptoApi.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Нормализует список разрешённых origin для Page API.
 * Принимаются только http(s) origin без пути/параметров; '*' и 'null' запрещены.
 */
export function parseOriginList(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(/[\s,]+/);
  const result = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().replace(/\/+$/, '');
    if (!trimmed || trimmed.includes('*')) continue;
    let url;
    try {
      url = new URL(trimmed);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') continue;
    if (!result.includes(url.origin)) result.push(url.origin);
    if (result.length >= 50) break;
  }
  return result;
}

export function isOriginAllowed(origin, allowedOrigins) {
  if (typeof origin !== 'string' || !origin || origin === 'null') return false;
  return Array.isArray(allowedOrigins) && allowedOrigins.includes(origin);
}
