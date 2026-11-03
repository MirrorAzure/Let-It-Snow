/*
 * Minimal chrome.* stub so the built popup (dist/chrome) renders outside the extension
 * for store screenshots. Injected before any page script; only active under /ext/.
 * __STORE_MESSAGES and __STORE_MANIFEST are prepended by build-store-assets.js.
 */
(() => {
  if (!location.pathname.startsWith('/ext/')) return;

  const params = new URLSearchParams(location.search);
  const lang = params.get('lang') === 'ru' ? 'ru' : 'en';
  const messages = __STORE_MESSAGES[lang] || {};
  const fallbackMessages = __STORE_MESSAGES.en || {};
  document.documentElement.lang = lang;

  let seed = {};
  try {
    seed = (window.parent && window.parent.__storeSeed) || {};
  } catch {
    seed = {};
  }

  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const event = () => ({ addListener() {}, removeListener() {}, hasListener: () => false });
  const reply = (value) => (...args) => {
    const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
    if (callback) {
      setTimeout(() => callback(clone(value)), 0);
      return undefined;
    }
    return Promise.resolve(clone(value));
  };

  const storageArea = (initial) => {
    const data = clone(initial) || {};
    const pick = (keys) => {
      if (keys == null) return clone(data);
      const list = typeof keys === 'string' ? [keys] : keys;
      const out = {};
      if (Array.isArray(list)) {
        list.forEach((key) => {
          if (key in data) out[key] = clone(data[key]);
        });
      } else {
        Object.keys(list).forEach((key) => {
          out[key] = key in data ? clone(data[key]) : list[key];
        });
      }
      return out;
    };
    const done = (callback, value) => {
      if (callback) {
        setTimeout(() => callback(value), 0);
        return undefined;
      }
      return Promise.resolve(value);
    };
    return {
      get: (keys, callback) => (typeof keys === 'function' ? done(keys, pick(null)) : done(callback, pick(keys))),
      set: (items, callback) => {
        Object.assign(data, clone(items));
        return done(callback);
      },
      remove: (keys, callback) => {
        (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete data[key]);
        return done(callback);
      },
      clear: (callback) => {
        Object.keys(data).forEach((key) => delete data[key]);
        return done(callback);
      },
      onChanged: event()
    };
  };

  const getMessage = (key, substitutions) => {
    const entry = messages[key] || fallbackMessages[key];
    if (!entry || typeof entry.message !== 'string') return '';
    const subs = substitutions == null ? [] : [].concat(substitutions).map(String);
    let text = entry.message;
    if (entry.placeholders) {
      text = text.replace(/\$([A-Za-z0-9_@]+)\$/g, (match, name) => {
        const placeholder = entry.placeholders[name.toLowerCase()];
        return placeholder ? placeholder.content : match;
      });
    }
    return text.replace(/\$(\d)/g, (_, index) => subs[Number(index) - 1] ?? '');
  };

  window.chrome = {
    runtime: {
      id: 'store-preview',
      lastError: undefined,
      getManifest: () => clone(__STORE_MANIFEST),
      getURL: (path) => `/ext/${String(path).replace(/^\//, '')}`,
      sendMessage: reply({ ok: true }),
      connect: () => ({ postMessage() {}, disconnect() {}, onMessage: event(), onDisconnect: event() }),
      onMessage: event(),
      onInstalled: event()
    },
    storage: {
      sync: storageArea(seed),
      local: storageArea({}),
      session: storageArea({}),
      onChanged: event()
    },
    i18n: {
      getMessage,
      getUILanguage: () => lang
    },
    tabs: {
      query: reply([{ id: 1, windowId: 1, active: true, url: 'https://example.com/', title: 'Example' }]),
      sendMessage: reply({ ok: true }),
      create: reply({ id: 2 }),
      onUpdated: event(),
      onActivated: event()
    },
    scripting: { executeScript: reply([]) },
    permissions: { contains: reply(true), request: reply(true) }
  };
})();
