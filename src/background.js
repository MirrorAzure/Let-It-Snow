/**
 * Background service worker для Let It Snow extension.
 *
 * Content scripts работают в контексте страницы и подчиняются CORS-политике
 * этой страницы. Background service worker работает с origin расширения
 * (chrome-extension://...) и может загружать ресурсы с любых хостов,
 * на которые у расширения есть host_permissions, без CORS-ограничений.
 *
 * Этот воркер обрабатывает запрос FETCH_GIF от gif-layer.js,
 * загружает изображение и возвращает его как data URL.
 */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'FETCH_GIF') return false;

  const { url } = message;
  if (!url || typeof url !== 'string') {
    sendResponse({ success: false, error: 'Invalid URL' });
    return false;
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 8000);

  fetch(url, {
    cache: 'default',
    credentials: 'omit',
    signal: abortController.signal
  })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const mimeType = (response.headers.get('content-type') || 'image/gif')
        .split(';')[0]
        .trim();
      return response.arrayBuffer().then((buffer) => ({ buffer, mimeType }));
    })
    .then(({ buffer, mimeType }) => {
      clearTimeout(timeoutId);
      // Конвертируем ArrayBuffer в base64 чанками чтобы не переполнить стек вызовов
      const bytes = new Uint8Array(buffer);
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

  return true; // Держим канал открытым для асинхронного ответа
});
