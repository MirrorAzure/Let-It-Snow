/**
 * Вкладка «API» в popup: синхронизация окон, локальный relay, Page API и быстрые эффекты.
 *
 * Настройки API хранятся в chrome.storage.local (не синхронизируются через аккаунт),
 * т.к. содержат секретный токен relay и локальные разрешения.
 */

import { t } from './localization.js';
import {
  DEFAULT_RELAY_URL,
  generateToken,
  isLoopbackWebSocketUrl,
  isValidToken,
  parseOriginList
} from '../api/command-protocol.js';

export const API_SETTINGS_DEFAULTS = Object.freeze({
  syncAllWindows: false,
  relayEnabled: false,
  relayUrl: DEFAULT_RELAY_URL,
  relayToken: '',
  pageApiEnabled: false,
  pageApiOrigins: []
});

const QUICK_COMMANDS = {
  apiBurst: { command: 'burst', params: { count: 350, durationMs: 7000, entry: 'instant' } },
  apiStorm: { command: 'wind', params: { strength: 2.6, gustFrequency: 6, direction: 'random', durationMs: 10000 } },
  apiClearEffects: { command: 'clearEffects', params: {} }
};

const getLocalStorage = () => (typeof chrome !== 'undefined' ? chrome.storage?.local || null : null);

const sendRuntimeMessage = async (message) => {
  if (typeof chrome === 'undefined' || typeof chrome.runtime?.sendMessage !== 'function') return null;
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    console.warn('[Let It Snow] Failed to contact the background worker:', error);
    return null;
  }
};

/**
 * Сообщает background о запуске/остановке из popup, чтобы синхронизировать
 * остальные вкладки/окна и relay. Активная вкладка исключается — её popup обработал сам.
 */
export function requestSnowSync(snowAction, config, excludeTabId) {
  sendRuntimeMessage({
    type: 'SYNC_SNOW_ACTION',
    snowAction,
    config: config || null,
    excludeTabId: typeof excludeTabId === 'number' ? excludeTabId : undefined
  }).then((response) => {
    if (response && !response.ok) {
      console.warn('[Let It Snow] Snow synchronization failed:', response.error || 'unknown_error');
    }
  });
}

/**
 * Формирует ссылку для OBS Browser Source из адреса relay.
 */
export function buildObsUrl(relayUrl, token) {
  if (!isLoopbackWebSocketUrl(relayUrl)) return null;
  const url = new URL(relayUrl);
  const protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  return `${protocol}//${url.host}/obs/#token=${encodeURIComponent(token)}`;
}

const RELAY_STATE_KEYS = {
  disabled: 'relayStateDisabled',
  connecting: 'relayStateConnecting',
  connected: 'relayStateConnected',
  error: 'relayStateError'
};

export async function initApiPanel() {
  const root = document.getElementById('subtab-api');
  const storage = getLocalStorage();
  if (!root || !storage) return;

  const el = {
    syncAllWindows: document.getElementById('syncAllWindows'),
    relayEnabled: document.getElementById('relayEnabled'),
    relayUrl: document.getElementById('relayUrl'),
    relayToken: document.getElementById('relayToken'),
    relayGenerateToken: document.getElementById('relayGenerateToken'),
    relayCopyObsUrl: document.getElementById('relayCopyObsUrl'),
    relayStatus: document.getElementById('relayStatus'),
    pageApiEnabled: document.getElementById('pageApiEnabled'),
    pageApiOrigins: document.getElementById('pageApiOrigins'),
    actionStatus: document.getElementById('apiActionStatus')
  };

  const stored = { ...API_SETTINGS_DEFAULTS, ...(await storage.get(Object.keys(API_SETTINGS_DEFAULTS))) };
  el.syncAllWindows.checked = stored.syncAllWindows === true;
  el.relayEnabled.checked = stored.relayEnabled === true;
  el.relayUrl.value = stored.relayUrl || DEFAULT_RELAY_URL;
  el.relayToken.value = stored.relayToken || '';
  el.pageApiEnabled.checked = stored.pageApiEnabled === true;
  el.pageApiOrigins.value = parseOriginList(stored.pageApiOrigins).join('\n');

  const showActionStatus = (text, isError = false) => {
    el.actionStatus.textContent = text;
    el.actionStatus.classList.toggle('api-status-error', isError);
  };

  const save = (patch) => storage.set(patch);

  el.syncAllWindows.addEventListener('change', () => save({ syncAllWindows: el.syncAllWindows.checked }));

  el.pageApiEnabled.addEventListener('change', () => save({ pageApiEnabled: el.pageApiEnabled.checked }));
  el.pageApiOrigins.addEventListener('change', () => {
    const origins = parseOriginList(el.pageApiOrigins.value);
    el.pageApiOrigins.value = origins.join('\n');
    save({ pageApiOrigins: origins });
  });

  const saveRelay = () => {
    const relayUrl = el.relayUrl.value.trim() || DEFAULT_RELAY_URL;
    const relayToken = el.relayToken.value.trim();
    const urlValid = isLoopbackWebSocketUrl(relayUrl);
    const tokenValid = !relayToken || isValidToken(relayToken);
    el.relayUrl.classList.toggle('input-invalid', !urlValid);
    el.relayToken.classList.toggle('input-invalid', !tokenValid);
    if (!urlValid || !tokenValid) return;
    save({ relayUrl, relayToken, relayEnabled: el.relayEnabled.checked });
  };

  el.relayEnabled.addEventListener('change', saveRelay);
  el.relayUrl.addEventListener('change', saveRelay);
  el.relayToken.addEventListener('change', saveRelay);

  el.relayGenerateToken.addEventListener('click', () => {
    el.relayToken.value = generateToken();
    el.relayToken.type = 'text';
    saveRelay();
    showActionStatus(t('relayTokenGenerated'));
  });

  el.relayCopyObsUrl.addEventListener('click', async () => {
    const token = el.relayToken.value.trim();
    const obsUrl = isValidToken(token) ? buildObsUrl(el.relayUrl.value.trim() || DEFAULT_RELAY_URL, token) : null;
    if (!obsUrl) {
      showActionStatus(t('relayObsUrlUnavailable'), true);
      return;
    }
    try {
      await navigator.clipboard.writeText(obsUrl);
      showActionStatus(t('relayObsUrlCopied'));
    } catch {
      showActionStatus(obsUrl);
    }
  });

  Object.entries(QUICK_COMMANDS).forEach(([id, command]) => {
    document.getElementById(id)?.addEventListener('click', async () => {
      const response = await sendRuntimeMessage({ type: 'DISPATCH_SNOW_COMMAND', command });
      if (response?.ok) {
        const parts = [t('apiCommandSent').replace('{count}', String(response.delivered ?? 0))];
        if (response.relayed) parts.push(t('apiCommandRelayed'));
        showActionStatus(parts.join(' '));
      } else {
        const partial = Number.isFinite(response?.delivered) && response.delivered > 0
          ? ` ${t('apiCommandSent').replace('{count}', String(response.delivered))}`
          : '';
        showActionStatus(`${t('apiCommandFailed')} ${response?.error || ''}${partial}`.trim(), true);
      }
    });
  });

  const refreshRelayStatus = async () => {
    const status = await sendRuntimeMessage({ type: 'GET_RELAY_STATUS' });
    if (!status?.ok) {
      el.relayStatus.textContent = '—';
      return;
    }
    let text = t(RELAY_STATE_KEYS[status.state] || 'relayStateError');
    if (status.state === 'connected') text += ` · ${t('relayPeers').replace('{count}', String(status.peers ?? 0))}`;
    const hasError = status.state !== 'disabled' && Boolean(status.lastError);
    if (hasError) text += ` (${status.lastError})`;
    el.relayStatus.textContent = text;
    el.relayStatus.dataset.state = hasError ? 'error' : status.state;
  };

  refreshRelayStatus();
  const statusTimer = setInterval(refreshRelayStatus, 1500);
  window.addEventListener('unload', () => clearInterval(statusTimer));
}
