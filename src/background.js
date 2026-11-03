/**
 * Background service worker для Let It Snow extension.
 *
 * 1. FETCH_GIF — загрузка GIF с origin расширения (обход CORS страницы) для
 *    URL, которые пользователь сам указал в настройках. Только http(s) и image/*.
 * 2. DISPATCH_SNOW_COMMAND / SYNC_SNOW_ACTION — доставка команд внешнего API и
 *    синхронизация запуска/остановки между вкладками и окнами браузера.
 *    Принимаются только от страниц самого расширения (popup), не от вкладок.
 * 3. Клиент локального relay (scripts/snow-relay.js) по WebSocket на loopback —
 *    синхронизация нескольких браузеров и управление извне (OBS, Stream Deck, curl).
 */

import {
  DEFAULT_RELAY_URL,
  LIMITS,
  validateCommand,
  isLoopbackWebSocketUrl,
  isValidToken,
  sanitizeStartConfig
} from './api/command-protocol.js';

const MAX_GIF_BYTES = 15 * 1024 * 1024;
const RELAY_ALARM = 'let-it-snow-relay-keepalive';
const RELAY_PING_INTERVAL_MS = 20000;
const RELAY_MAX_BACKOFF_MS = 30000;
const SYNC_SETTINGS_KEYS = ['syncAllWindows', 'relayEnabled', 'relayUrl', 'relayToken', 'relayClientName'];

const isExtensionPageSender = (sender) =>
  Boolean(sender) && !sender.tab && sender.id === chrome.runtime.id;

// ---------------------------------------------------------------------------
// FETCH_GIF
// ---------------------------------------------------------------------------

const isFetchableGifUrl = (value) => {
  if (typeof value !== 'string' || value.length > LIMITS.maxUrlLength) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
  } catch {
    return false;
  }
};

async function readGifBytes(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_GIF_BYTES) {
    await response.body?.cancel();
    throw new Error('Image is too large');
  }
  if (!response.body) throw new Error('Empty image response');

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_GIF_BYTES) {
        await reader.cancel();
        throw new Error('Image is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new Error('Empty image response');

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function handleFetchGif(message, sendResponse) {
  const { url } = message;
  if (!isFetchableGifUrl(url)) {
    sendResponse({ success: false, error: 'Invalid URL' });
    return false;
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 8000);

  fetch(url, {
    cache: 'default',
    credentials: 'omit',
    redirect: 'follow',
    signal: abortController.signal
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const mimeType = (response.headers.get('content-type') || 'image/gif')
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (!mimeType.startsWith('image/')) throw new Error('Not an image');
      return { bytes: await readGifBytes(response), mimeType };
    })
    .then(({ bytes, mimeType }) => {
      clearTimeout(timeoutId);
      // Конвертируем байты в base64 чанками чтобы не переполнить стек вызовов
      const chunkSize = 8192;
      let binary = '';
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(
          null,
          bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
        );
      }
      sendResponse({
        success: true,
        dataUrl: `data:${mimeType};base64,${btoa(binary)}`
      });
    })
    .catch((err) => {
      clearTimeout(timeoutId);
      sendResponse({ success: false, error: err?.message || 'Fetch failed' });
    });

  return true;
}

// ---------------------------------------------------------------------------
// Доставка команд во вкладки
// ---------------------------------------------------------------------------

const getSyncSettings = async () => {
  const stored = await chrome.storage.local.get(SYNC_SETTINGS_KEYS);
  return {
    syncAllWindows: stored.syncAllWindows === true,
    relayEnabled: stored.relayEnabled === true,
    relayUrl: typeof stored.relayUrl === 'string' && stored.relayUrl ? stored.relayUrl : DEFAULT_RELAY_URL,
    relayToken: typeof stored.relayToken === 'string' ? stored.relayToken : '',
    relayClientName: typeof stored.relayClientName === 'string' ? stored.relayClientName.slice(0, 64) : ''
  };
};

const isScriptableTab = (tab) => {
  if (!tab || typeof tab.id !== 'number' || tab.id < 0) return false;
  if (typeof tab.url !== 'string') return true;
  return /^(https?|file):/i.test(tab.url);
};

const getTargetTabs = async (scope) => {
  const tabs = scope === 'all'
    ? await chrome.tabs.query({})
    : await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs.filter(isScriptableTab);
};

const sendToTabs = async (tabs, message) => {
  const results = await Promise.allSettled(
    tabs.map((tab) => chrome.tabs.sendMessage(tab.id, message))
  );
  return results.filter((result) => result.status === 'fulfilled' && result.value?.ok !== false).length;
};

/**
 * @param {{command: string, params: Object, id: string|null}} command - проверенная команда
 * @param {{scope: 'active'|'all', source: string}} options
 */
const deliverCommandToTabs = async (command, { scope, source }) => {
  const tabs = await getTargetTabs(scope);
  return sendToTabs(tabs, { action: 'snowCommand', command, source });
};

const SNOW_ACTIONS = new Set(['startSnow', 'stopSnow']);

const getRelayPublishError = (enabled, relayed) => {
  if (!enabled || relayed) return null;
  return relayClient.state === 'connected' ? 'relay_send_failed' : 'relay_not_connected';
};

/**
 * Синхронизация запуска/остановки из popup на остальные вкладки и в relay.
 */
async function handleSyncSnowAction(message) {
  const { snowAction, config, excludeTabId } = message;
  if (!SNOW_ACTIONS.has(snowAction)) return { ok: false, error: 'invalid_action' };
  const settings = await getSyncSettings();
  let delivered = 0;

  if (settings.syncAllWindows) {
    const tabs = (await getTargetTabs('all')).filter((tab) => tab.id !== excludeTabId);
    const payload = snowAction === 'startSnow'
      ? { action: 'startSnow', config: config && typeof config === 'object' ? config : {} }
      : { action: 'stopSnow' };
    delivered = await sendToTabs(tabs, payload);
  }

  const relayCommand = snowAction === 'startSnow'
    ? { command: 'start', params: { config: sanitizeStartConfig(config) }, id: null }
    : { command: 'stop', params: {}, id: null };
  const relayed = settings.relayEnabled && relayClient.publish(relayCommand);
  const error = getRelayPublishError(settings.relayEnabled, relayed);
  if (error) return { ok: false, error, delivered, relayed };
  return { ok: true, delivered, relayed };
}

async function handleDispatchCommand(message) {
  const validation = validateCommand(message.command);
  if (!validation.ok) return { ok: false, error: validation.error };
  const settings = await getSyncSettings();
  const scope = message.scope === 'all' || settings.syncAllWindows ? 'all' : 'active';
  const delivered = await deliverCommandToTabs(validation.command, { scope, source: 'extension' });
  const relayed = settings.relayEnabled && relayClient.publish(validation.command);
  const error = getRelayPublishError(settings.relayEnabled, relayed)
    || (!delivered && !relayed ? 'no_targets' : null);
  if (error) return { ok: false, error, delivered, relayed };
  return { ok: true, delivered, relayed };
}

// ---------------------------------------------------------------------------
// Relay client
// ---------------------------------------------------------------------------

const relayClient = {
  socket: null,
  state: 'disabled',
  lastError: null,
  clientId: null,
  peers: 0,
  backoffMs: 1000,
  reconnectTimer: null,
  pingTimer: null,
  settingsKey: '',

  status() {
    return {
      state: this.state,
      lastError: this.lastError,
      clientId: this.clientId,
      peers: this.peers
    };
  },

  publish(command) {
    if (this.state !== 'connected' || !this.socket) return false;
    try {
      this.socket.send(JSON.stringify({ type: 'command', ...command }));
      if (this.lastError === 'relay_send_failed') this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = 'relay_send_failed';
      console.warn('[Let It Snow] Failed to send a relay command:', error);
      return false;
    }
  },

  disconnect(nextState = 'disabled') {
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      try {
        socket.close(1000, 'closing');
      } catch {
        // ignore
      }
    }
    this.state = nextState;
    this.clientId = null;
    this.peers = 0;
  },

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const delay = this.backoffMs;
    this.backoffMs = Math.min(RELAY_MAX_BACKOFF_MS, this.backoffMs * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensure().catch((error) => {
        this.state = 'error';
        this.lastError = error?.message || 'relay_failed';
        console.warn('[Let It Snow] Failed to reconnect to the relay:', error);
        this.scheduleReconnect();
      });
    }, delay);
  },

  async ensure({ force = false } = {}) {
    const settings = await getSyncSettings();
    const key = `${settings.relayEnabled}|${settings.relayUrl}|${settings.relayToken}|${settings.relayClientName}`;
    if (force || key !== this.settingsKey) {
      this.settingsKey = key;
      this.disconnect(settings.relayEnabled ? 'connecting' : 'disabled');
      this.backoffMs = 1000;
    }

    if (!settings.relayEnabled) {
      this.disconnect('disabled');
      return;
    }
    if (!isLoopbackWebSocketUrl(settings.relayUrl)) {
      this.disconnect('error');
      this.lastError = 'relay_url_must_be_loopback';
      return;
    }
    if (!isValidToken(settings.relayToken)) {
      this.disconnect('error');
      this.lastError = 'invalid_token';
      return;
    }
    if (this.socket) return;

    this.connect(settings);
  },

  connect(settings) {
    this.state = 'connecting';
    let socket;
    try {
      socket = new WebSocket(settings.relayUrl);
    } catch (err) {
      this.state = 'error';
      this.lastError = err?.message || 'connect_failed';
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: 'auth',
        token: settings.relayToken,
        client: {
          kind: 'extension',
          name: settings.relayClientName || navigator.userAgent.match(/(Firefox|Edg|Chrome)\/[\d.]+/)?.[0] || 'browser'
        }
      }));
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string' || event.data.length > LIMITS.maxPayloadBytes) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      this.handleMessage(message);
    };

    socket.onerror = () => {
      this.lastError = 'connection_error';
    };

    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.clientId = null;
      this.peers = 0;
      if (event.code === 4401 || event.code === 4403) {
        this.state = 'error';
        this.lastError = event.code === 4401 ? 'unauthorized' : 'forbidden_origin';
        return;
      }
      this.state = 'connecting';
      this.scheduleReconnect();
    };
  },

  handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    switch (message.type) {
      case 'auth_ok':
        this.state = 'connected';
        this.lastError = null;
        this.backoffMs = 1000;
        this.clientId = typeof message.clientId === 'string' ? message.clientId.slice(0, 64) : null;
        this.peers = Number.isFinite(message.peers) ? message.peers : 0;
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          try {
            this.socket?.send(JSON.stringify({ type: 'ping' }));
          } catch {
            // ignore
          }
        }, RELAY_PING_INTERVAL_MS);
        break;
      case 'peers':
        if (Number.isFinite(message.peers)) this.peers = message.peers;
        break;
      case 'command': {
        if (this.state !== 'connected') return;
        const validation = validateCommand({
          command: message.command,
          params: message.params,
          id: message.id
        });
        if (!validation.ok) return;
        deliverCommandToTabs(validation.command, { scope: 'all', source: 'relay' })
          .then(() => {
            if (this.lastError === 'tab_delivery_failed') this.lastError = null;
          })
          .catch((error) => {
            this.lastError = 'tab_delivery_failed';
            console.warn('[Let It Snow] Failed to deliver a relay command:', error);
          });
        break;
      }
      case 'error':
        this.lastError = typeof message.error === 'string' ? message.error.slice(0, 64) : 'relay_error';
        break;
      default:
        break;
    }
  }
};

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  if (message.type === 'FETCH_GIF') {
    return handleFetchGif(message, sendResponse);
  }

  const privileged = {
    DISPATCH_SNOW_COMMAND: handleDispatchCommand,
    SYNC_SNOW_ACTION: handleSyncSnowAction,
    GET_RELAY_STATUS: async () => ({ ok: true, ...relayClient.status() }),
    RELAY_RECONNECT: async () => {
      await relayClient.ensure({ force: true });
      return { ok: true, ...relayClient.status() };
    }
  };

  const handler = privileged[message.type];
  if (!handler) return false;

  // Управляющие сообщения принимаются только от страниц расширения (popup).
  if (!isExtensionPageSender(sender)) {
    sendResponse({ ok: false, error: 'forbidden' });
    return false;
  }

  handler(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err?.message || 'failed' }));
  return true;
});

// ---------------------------------------------------------------------------
// Жизненный цикл relay
// ---------------------------------------------------------------------------

const ensureRelaySoon = () => {
  relayClient.ensure().catch((err) => {
    relayClient.state = 'error';
    relayClient.lastError = err?.message || 'relay_failed';
    console.warn('[Let It Snow] Failed to update the relay connection:', err);
  });
};

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (SYNC_SETTINGS_KEYS.some((key) => key in changes)) ensureRelaySoon();
});

if (chrome.alarms) {
  chrome.alarms.create(RELAY_ALARM, { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RELAY_ALARM) ensureRelaySoon();
  });
}

chrome.runtime.onStartup?.addListener(ensureRelaySoon);
chrome.runtime.onInstalled?.addListener(ensureRelaySoon);
ensureRelaySoon();
