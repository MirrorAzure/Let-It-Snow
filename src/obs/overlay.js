/**
 * Let It Snow — OBS Browser Source overlay.
 *
 * Прозрачная страница со снегопадом, управляемая через локальный relay
 * (scripts/snow-relay.js). Добавьте в OBS «Браузер» с URL вида:
 *
 *   http://127.0.0.1:8787/obs/?snowmax=120&renderer=auto#token=<TOKEN>
 *
 * Токен передаётся во фрагменте (#token=...), который не отправляется на сервер
 * и не попадает в Referer.
 */

import { SnowWebGPUController } from '../content/snow-controller.js';
import { SnowCommandRuntime } from '../content/command-runtime.js';
import {
  DEFAULT_RELAY_URL,
  LIMITS,
  validateCommand,
  sanitizeStartConfig,
  isLoopbackWebSocketUrl,
  isValidToken
} from '../api/command-protocol.js';

const OBS_OVERLAY_ID = 'let-it-snow-obs-overlay';
const PING_INTERVAL_MS = 20000;
const MAX_BACKOFF_MS = 15000;

const splitList = (value) => (value ? value.split(',').map((item) => item.trim()).filter(Boolean) : undefined);

/**
 * Читает базовую конфигурацию из query-параметров (только безопасное подмножество).
 */
export function parseOverlayOptions(locationLike = window.location) {
  const query = new URLSearchParams(locationLike.search || '');
  const hash = new URLSearchParams(String(locationLike.hash || '').replace(/^#/, ''));
  const config = sanitizeStartConfig({
    snowmax: query.get('snowmax') ?? undefined,
    sinkspeed: query.get('speed') ?? query.get('sinkspeed') ?? undefined,
    snowminsize: query.get('minsize') ?? undefined,
    snowmaxsize: query.get('maxsize') ?? undefined,
    colors: splitList(query.get('colors')),
    symbols: splitList(query.get('symbols')),
    glyphMode: query.get('glyphMode') ?? undefined,
    rendererMode: query.get('renderer') ?? undefined,
    windEnabled: query.has('wind') ? query.get('wind') === '1' : undefined,
    windDirection: query.get('windDirection') ?? undefined,
    windStrength: query.get('windStrength') ?? undefined
  });

  let relayUrl = query.get('relay');
  if (!relayUrl) {
    relayUrl = /^https?:$/.test(locationLike.protocol)
      ? `ws://${locationLike.host}/ws`
      : DEFAULT_RELAY_URL;
  }

  return {
    config,
    token: hash.get('token') || '',
    relayUrl,
    name: (query.get('name') || 'OBS').replace(/[^\w .()-]/g, '').slice(0, 64),
    startSnow: query.get('snow') !== '0',
    showStatus: query.get('status') !== '0'
  };
}

class OverlayRelayClient {
  constructor({ url, token, name, onCommand, onState }) {
    this.url = url;
    this.token = token;
    this.name = name;
    this.onCommand = onCommand;
    this.onState = onState;
    this.socket = null;
    this.backoffMs = 1000;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.stopped = false;
  }

  connect() {
    if (this.stopped) return;
    this.onState('connecting');
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'auth', token: this.token, client: { kind: 'obs', name: this.name } }));
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string' || event.data.length > LIMITS.maxPayloadBytes) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message?.type === 'auth_ok') {
        this.backoffMs = 1000;
        this.onState('connected');
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
        }, PING_INTERVAL_MS);
        return;
      }
      if (message?.type === 'command') {
        const validation = validateCommand({ command: message.command, params: message.params, id: message.id });
        if (validation.ok) this.onCommand(validation.command);
      }
    };

    socket.onclose = (event) => {
      clearInterval(this.pingTimer);
      if (this.socket !== socket) return;
      this.socket = null;
      if (event.code === 4401 || event.code === 4403) {
        this.onState(event.code === 4401 ? 'unauthorized' : 'forbidden');
        return;
      }
      this.onState('disconnected');
      if (this.stopped) return;
      this.reconnectTimer = setTimeout(() => this.connect(), this.backoffMs);
      this.backoffMs = Math.min(MAX_BACKOFF_MS, this.backoffMs * 2);
    };
  }

  stop() {
    this.stopped = true;
    clearInterval(this.pingTimer);
    clearTimeout(this.reconnectTimer);
    this.socket?.close(1000, 'bye');
    this.socket = null;
  }
}

function bootstrap() {
  const options = parseOverlayOptions();
  const statusEl = document.getElementById('lis-obs-status');
  let hideTimer = null;

  const setStatus = (text, { sticky = false } = {}) => {
    if (!statusEl || !options.showStatus) return;
    clearTimeout(hideTimer);
    statusEl.textContent = `❄ ${text}`;
    statusEl.hidden = false;
    if (!sticky) hideTimer = setTimeout(() => { statusEl.hidden = true; }, 3000);
  };

  let mainController = null;

  const stopMain = () => {
    mainController?.destroy();
    mainController = null;
  };

  const startMain = async (config) => {
    stopMain();
    const next = new SnowWebGPUController(config, { overlayId: OBS_OVERLAY_ID, mouseInteraction: false });
    mainController = next;
    await next.start();
    syncPause();
  };

  const runtime = new SnowCommandRuntime({
    getMainController: () => mainController,
    startMain,
    stopMain,
    resolveStartConfig: (overrides) => ({ ...options.config, ...overrides }),
    allowBackgroundGifFetch: false
  });

  const visibility = { visible: true, active: true };
  const syncPause = () => {
    const shouldRun = visibility.visible && visibility.active && !document.hidden;
    if (shouldRun) {
      runtime.resumeAll();
    } else {
      runtime.pauseAll();
    }
  };
  window.addEventListener('obsSourceVisibleChanged', (event) => {
    visibility.visible = event?.detail?.visible !== false;
    syncPause();
  });
  window.addEventListener('obsSourceActiveChanged', (event) => {
    visibility.active = event?.detail?.active !== false;
    syncPause();
  });
  document.addEventListener('visibilitychange', syncPause);
  syncPause();

  if (options.startSnow) {
    startMain({ ...options.config }).catch((err) => console.error('[Let It Snow OBS]', err));
  }

  if (!options.token) {
    setStatus('Relay token missing: add #token=… to the URL', { sticky: true });
    return;
  }
  if (!isValidToken(options.token)) {
    setStatus('Invalid relay token', { sticky: true });
    return;
  }
  if (!isLoopbackWebSocketUrl(options.relayUrl)) {
    setStatus('Relay URL must be ws://127.0.0.1 / localhost', { sticky: true });
    return;
  }

  const client = new OverlayRelayClient({
    url: options.relayUrl,
    token: options.token,
    name: options.name,
    onCommand: (command) => {
      runtime.execute(command, { source: 'relay' }).catch((err) => console.error('[Let It Snow OBS]', err));
    },
    onState: (state) => {
      if (state === 'connected') setStatus('Connected to relay');
      else if (state === 'unauthorized') setStatus('Relay rejected the token', { sticky: true });
      else if (state === 'forbidden') setStatus('Relay rejected this origin', { sticky: true });
      else setStatus('Connecting to relay…', { sticky: true });
    }
  });
  client.connect();

  window.addEventListener('beforeunload', () => {
    client.stop();
    runtime.destroy();
    stopMain();
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__LET_IT_SNOW_OBS_TEST__) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
}
