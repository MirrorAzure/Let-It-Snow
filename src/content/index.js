/**
 * Главный контроллер снегопада для Let It Snow extension
 * 
 * Этот модуль управляет созданием и отображением снежинок на веб-странице.
 * Поддерживает WebGPU для производительного рендеринга с автоматическим
 * fallback на Canvas 2D для браузеров без поддержки WebGPU.
 */


import { SnowWebGPUController, DEFAULT_CONFIG, normalizeSizeConfig } from './snow-controller.js';
import { getViewportBaseSize } from './utils/size-utils.js';
import { SnowCommandRuntime } from './command-runtime.js';
import {
  PAGE_API_TARGET,
  PAGE_API_RESPONSE_TARGET,
  LIMITS,
  validateCommand,
  sanitizeStartConfig,
  createRateLimiter,
  parseOriginList,
  isOriginAllowed
} from '../api/command-protocol.js';

// Константы
const PLAYGROUND_MESSAGE_TARGET = 'let-it-snow-playground';
const PLAYGROUND_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const SNOW_PROGRESS_STORAGE_KEY = 'snowProgressV1';
const MAX_INITIAL_OFFSET_SECONDS = 6 * 60 * 60;

const getSnowStorageArea = () => {
  if (typeof chrome === 'undefined' || !chrome.storage) return null;
  return chrome.storage.local || chrome.storage.sync || null;
};

const resolveInitialOffsetSeconds = async (reuseExistingProgress = true) => {
  const storage = getSnowStorageArea();
  if (!storage) return 0;

  const now = Date.now();

  try {
    const stored = await storage.get([SNOW_PROGRESS_STORAGE_KEY]);
    const progress = stored?.[SNOW_PROGRESS_STORAGE_KEY] || null;
    const savedStartedAt = Number(progress?.startedAt);
    const canReuseSavedStart =
      reuseExistingProgress && Number.isFinite(savedStartedAt) && savedStartedAt > 0;

    const startedAt = canReuseSavedStart ? savedStartedAt : now;

    await storage.set({
      [SNOW_PROGRESS_STORAGE_KEY]: {
        version: 1,
        startedAt,
        lastSeenAt: now
      }
    });

    const elapsed = Math.max(0, (now - startedAt) / 1000);
    return Math.min(MAX_INITIAL_OFFSET_SECONDS, elapsed);
  } catch (err) {
    console.warn('[Let It Snow] Failed to resolve snow progress offset:', err);
    return 0;
  }
};

const clearSnowProgress = async () => {
  const storage = getSnowStorageArea();
  if (!storage) return;
  try {
    await storage.remove(SNOW_PROGRESS_STORAGE_KEY);
  } catch (err) {
    console.warn('[Let It Snow] Failed to clear snow progress:', err);
  }
};

// Глобальный контроллер
let controller = null;
let controllerGeneration = 0;
let explicitSnowCommandReceived = false;

/**
 * Остановить снегопад
 */
function stopSnow(options = {}) {
  const { preserveProgress = false, explicit = true } = options;
  controllerGeneration++;
  if (explicit) explicitSnowCommandReceived = true;
  if (controller) {
    controller.destroy();
    controller = null;
  }

  if (!preserveProgress) {
    clearSnowProgress().catch(() => {});
  }
}

/**
 * Запустить снегопад с заданной конфигурацией
 * @param {Object} config - Конфигурация снегопада
 */
async function startSnow(config, options = {}) {
  // Keep progress metadata, but never restore particle positions inside the viewport.
  const { autoStart = false, reuseExistingProgress = autoStart } = options;
  if (!autoStart) explicitSnowCommandReceived = true;
  const generation = ++controllerGeneration;
  await resolveInitialOffsetSeconds(reuseExistingProgress);
  if (generation !== controllerGeneration || (autoStart && explicitSnowCommandReceived)) return;

  const runtimeConfig = normalizeSizeConfig({
    ...config,
    initialTimeOffsetSeconds: 0
  });

  if (controller) {
    controller.destroy();
    controller = null;
  }

  const nextController = new SnowWebGPUController(runtimeConfig);
  controller = nextController;
  try {
    await nextController.start();
    if (commandRuntime.isPaused || document.hidden) nextController.pauseAnimations();
  } catch (error) {
    if (controller === nextController) {
      nextController.destroy();
      controller = null;
    }
    throw error;
  }
  if (generation !== controllerGeneration && controller === nextController) {
    nextController.destroy();
    controller = null;
  }
}

function updateSnowPhysics(config) {
  if (!controller) return { ok: true, running: false };

  const sanitized = sanitizeStartConfig(config);
  const patch = {};
  for (const key of ['gravity', 'airDensity']) {
    if (Object.hasOwn(sanitized, key)) patch[key] = sanitized[key];
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'invalid_physics_config' };
  }

  controller.updateConfig(patch);
  return { ok: true, running: true, physics: patch };
}

/**
 * Загружает сохранённые настройки снегопада из chrome.storage.sync.
 * @param {Object} [overrides] - проверенные поля, перекрывающие сохранённые
 * @returns {Promise<{config: Object, autoStart: boolean}>}
 */
async function loadStoredSnowConfig(overrides = {}) {
  let stored = {};
  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    stored = (await chrome.storage.sync.get([
      'autoStart',
      'snowmax',
      'sinkspeed',
      'snowminsize',
      'snowmaxsize',
      'snowFluffiness',
      'snowShape',
      'gravity',
      'airDensity',
      'colors',
      'symbols',
      'symbolModes',
      'sentences',
      'sentenceCount',
      'gifs',
      'gifCount',
      'rendererMode',
      'snow3dThickness',
      'mouseRadius',
      'windEnabled',
      'windDirection',
      'windStrength',
      'windGustFrequency',
      'windGustStrength',
      'turbulenceStrength',
      'updraftStrength'
    ])) || {};
  }

  const sizeConfig = normalizeSizeConfig({
    snowminsize: overrides.snowminsize ?? stored.snowminsize,
    snowmaxsize: overrides.snowmaxsize ?? stored.snowmaxsize
  });
  const config = {
    snowmax: stored.snowmax || 80,
    sinkspeed: stored.sinkspeed || 0.4,
    snowFluffiness: stored.snowFluffiness ?? DEFAULT_CONFIG.snowFluffiness,
    snowShape: stored.snowShape || DEFAULT_CONFIG.snowShape,
    gravity: stored.gravity ?? DEFAULT_CONFIG.gravity,
    airDensity: stored.airDensity ?? DEFAULT_CONFIG.airDensity,
    snowcolor: stored.colors || ['#ffffff'],
    snowletters: stored.symbols || ['❄'],
    snowglyphmodes: stored.symbolModes || ['text'],
    snowsentences: stored.sentences || [],
    sentenceCount: stored.sentenceCount || 0,
    gifUrls: stored.gifs || [],
    gifCount: stored.gifCount || 0,
    rendererMode: stored.rendererMode === '3d' ? '3d' : 'auto',
    snow3dThickness: stored.snow3dThickness ?? DEFAULT_CONFIG.snow3dThickness,
    mouseRadius: stored.mouseRadius || 100,
    windEnabled: stored.windEnabled || false,
    windDirection: stored.windDirection || 'left',
    windStrength: stored.windStrength ?? 0.5,
    windGustFrequency: stored.windGustFrequency ?? 3,
    windGustStrength: stored.windGustStrength ?? DEFAULT_CONFIG.windGustStrength,
    turbulenceStrength: stored.turbulenceStrength ?? DEFAULT_CONFIG.turbulenceStrength,
    updraftStrength: stored.updraftStrength ?? DEFAULT_CONFIG.updraftStrength,
    ...overrides,
    snowminsize: sizeConfig.snowminsize,
    snowmaxsize: sizeConfig.snowmaxsize
  };
  return { config, autoStart: Boolean(stored.autoStart) };
}

// Исполнитель команд внешнего API (эффекты поверх основного снега)
const commandRuntime = new SnowCommandRuntime({
  getMainController: () => controller,
  startMain: (config) => startSnow(config),
  stopMain: () => stopSnow(),
  resolveStartConfig: async (overrides) => (await loadStoredSnowConfig(overrides)).config
});

/**
 * Выполняет внешнюю команду после повторной проверки.
 * @param {unknown} rawCommand
 * @param {{source: string}} context
 */
async function runSnowCommand(rawCommand, context) {
  const validation = validateCommand(rawCommand);
  if (!validation.ok) return { ok: false, error: validation.error };
  try {
    const result = await commandRuntime.execute(validation.command, context);
    return { ...result, id: validation.command.id };
  } catch (err) {
    console.error('[Let It Snow] Command failed:', err);
    return { ok: false, error: err?.message || 'command_failed', id: validation.command.id };
  }
}

/**
 * Безопасная отправка postMessage только в собственный origin страницы.
 * @param {Object} payload - Данные для отправки
 */
const safePostMessage = (payload) => {
  if (typeof window === 'undefined') return;
  if (typeof window.postMessage !== 'function') return;
  const targetOrigin = window.location?.origin && window.location.origin !== 'null'
    ? window.location.origin
    : '*';
  window.postMessage(payload, targetOrigin);
};

const isPlaygroundHost = () => PLAYGROUND_HOSTNAMES.has(String(window.location?.hostname || '').toLowerCase());

/**
 * Обработчик сообщений для playground режима (только localhost)
 * @param {MessageEvent} event - Событие сообщения
 */
const handlePlaygroundMessage = (event) => {
  const { action, config } = event.data || {};

  if (action === 'startSnow') {
    startSnow(config || {}).catch((err) => console.error(err));
    return;
  }

  if (action === 'stopSnow') {
    stopSnow();
    return;
  }

  if (action === 'ping') {
    safePostMessage({ target: PLAYGROUND_MESSAGE_TARGET, action: 'pong' });
  }
};

// --- Page API: window.postMessage({ target: 'let-it-snow-api', command, params, id }) ---
// Выключен по умолчанию; разрешается только для origin из явного списка в настройках.
const pageApiState = {
  enabled: false,
  origins: [],
  limiter: createRateLimiter({ max: 20, intervalMs: 10000 })
};

const applyPageApiSettings = (settings = {}) => {
  pageApiState.enabled = settings.pageApiEnabled === true;
  pageApiState.origins = parseOriginList(settings.pageApiOrigins || []);
};

const loadPageApiSettings = async () => {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  try {
    applyPageApiSettings(await chrome.storage.local.get(['pageApiEnabled', 'pageApiOrigins']));
  } catch (err) {
    console.warn('[Let It Snow] Failed to load page API settings:', err);
  }
};

const isPageApiAllowed = () => pageApiState.enabled
  && isOriginAllowed(window.location?.origin, pageApiState.origins);

const estimatePayloadSize = (data) => {
  try {
    return JSON.stringify(data).length;
  } catch {
    return Infinity;
  }
};

const handlePageApiMessage = async (event) => {
  const data = event.data;
  const id = typeof data?.id === 'string' && data.id.length <= LIMITS.maxIdLength ? data.id : null;
  const reply = (result) => safePostMessage({ ...result, target: PAGE_API_RESPONSE_TARGET, id });

  if (!isPageApiAllowed()) {
    // Не раскрываем детали: страница узнаёт лишь, что API недоступен.
    reply({ ok: false, error: 'page_api_disabled' });
    return;
  }
  if (estimatePayloadSize(data) > LIMITS.maxPayloadBytes) {
    reply({ ok: false, error: 'payload_too_large' });
    return;
  }
  if (!pageApiState.limiter.tryConsume()) {
    reply({ ok: false, error: 'rate_limited' });
    return;
  }

  const { target: _target, ...rawCommand } = data;
  reply(await runSnowCommand(rawCommand, { source: 'page' }));
};

const handleWindowMessage = (event) => {
  if (event.source !== window) return;
  if (event.origin && window.location?.origin && event.origin !== window.location.origin) return;
  const target = event.data?.target;

  if (target === PAGE_API_TARGET) {
    handlePageApiMessage(event).catch((err) => console.error(err));
    return;
  }

  if (target === PLAYGROUND_MESSAGE_TARGET && isPlaygroundHost()) {
    handlePlaygroundMessage(event);
  }
};

window.addEventListener('message', handleWindowMessage);
if (isPlaygroundHost()) {
  safePostMessage({ target: PLAYGROUND_MESSAGE_TARGET, action: 'ready' });
}
loadPageApiSettings();
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!changes.pageApiEnabled && !changes.pageApiOrigins) return;
    loadPageApiSettings();
  });
}

// Chrome/Firefox extension messaging
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const respond = typeof sendResponse === 'function' ? sendResponse : () => {};
    try {
      if (message?.action === 'snowCommand') {
        // Команды принимаются только от самого расширения (background/popup).
        if (sender?.id && chrome.runtime.id && sender.id !== chrome.runtime.id) {
          respond({ ok: false, error: 'forbidden' });
          return;
        }
        runSnowCommand(message.command, { source: message.source === 'relay' ? 'relay' : 'extension' })
          .then(respond)
          .catch((err) => respond({ ok: false, error: err?.message || 'command_failed' }));
        return true;
      }

      if (message.action === 'startSnow') {
        startSnow(message.config || {}).catch((err) => console.error(err));
        respond({ ok: true });
        return;
      }

      // Live preview from the popup: only refresh a snowfall that is already running.
      if (message.action === 'previewSnow') {
        if (!controller) {
          respond({ ok: true, running: false });
          return;
        }
        startSnow(message.config || {}, { reuseExistingProgress: true }).catch((err) => console.error(err));
        respond({ ok: true, running: true });
        return;
      }

      if (message.action === 'updateSnowPhysics') {
        respond(updateSnowPhysics(message.config));
        return;
      }

      if (message.action === 'stopSnow') {
        stopSnow();
        respond({ ok: true });
        return;
      }

      if (message.action === 'getViewportBaseSize') {
        respond({ ok: true, viewportBaseSize: getViewportBaseSize() });
        return;
      }

      respond({ ok: false, reason: 'unknown_action' });
    } catch (err) {
      console.error(err);
      respond({ ok: false, error: err?.message || 'unknown_error' });
    }
  });
}

// Очистка при закрытии страницы
window.addEventListener('beforeunload', () => {
  commandRuntime.destroy();
  stopSnow({ preserveProgress: true });
});

// Пауза/возобновление при смене вкладки
const handleVisibilityChange = () => {
  if (document.hidden) {
    commandRuntime.pauseAll();
  } else {
    commandRuntime.resumeAll();
  }
};

document.addEventListener('visibilitychange', handleVisibilityChange);
handleVisibilityChange();

// Автозапуск если включен в настройках
(async () => {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const { config, autoStart } = await loadStoredSnowConfig();
      if (autoStart && !explicitSnowCommandReceived) {
        startSnow(config, { autoStart: true }).catch((err) => console.error(err));
      }
    }
  } catch (err) {
    console.error('Error checking auto-start setting:', err);
  }
})();

// Экспорт для playground и тестирования
export { SnowWebGPUController, startSnow, stopSnow, updateSnowPhysics, runSnowCommand, commandRuntime, loadStoredSnowConfig };
