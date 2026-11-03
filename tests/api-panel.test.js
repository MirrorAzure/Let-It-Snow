import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initApiPanel } from '../src/popup/api-panel.js';

describe('API popup actions', () => {
  let commandResponse;

  beforeEach(async () => {
    document.body.innerHTML = `
      <div id="subtab-api">
        <input id="syncAllWindows" type="checkbox">
        <input id="relayEnabled" type="checkbox">
        <input id="relayUrl">
        <input id="relayToken">
        <button id="relayGenerateToken"></button>
        <button id="relayCopyObsUrl"></button>
        <div id="relayStatus"></div>
        <input id="pageApiEnabled" type="checkbox">
        <textarea id="pageApiOrigins"></textarea>
        <div id="apiActionStatus"></div>
        <button id="apiBurst"></button>
        <button id="apiStorm"></button>
        <button id="apiClearEffects"></button>
      </div>
    `;
    const messages = {
      apiCommandFailed: 'Command failed:',
      apiCommandSent: 'Delivered to {count} tabs.',
      apiCommandRelayed: 'Sent to relay.'
    };
    vi.stubGlobal('chrome', {
      i18n: { getMessage: (key) => messages[key] || key },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ relayEnabled: true }),
          set: vi.fn().mockResolvedValue(undefined)
        }
      },
      runtime: {
        sendMessage: vi.fn(async (message) => message.type === 'GET_RELAY_STATUS'
          ? { ok: true, state: 'connected', peers: 1 }
          : commandResponse)
      }
    });
    await initApiPanel();
  });

  afterEach(() => {
    window.dispatchEvent(new Event('unload'));
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows an error and the number of tabs reached after a partial relay failure', async () => {
    commandResponse = { ok: false, error: 'relay_send_failed', delivered: 1, relayed: false };

    document.getElementById('apiBurst').click();

    const status = document.getElementById('apiActionStatus');
    await vi.waitFor(() => expect(status.textContent).toContain('relay_send_failed'));
    expect(status.textContent).toContain('Delivered to 1 tabs.');
    expect(status.classList.contains('api-status-error')).toBe(true);
  });

  it('reports successful delivery to tabs and the relay', async () => {
    commandResponse = { ok: true, delivered: 2, relayed: true };

    document.getElementById('apiStorm').click();

    const status = document.getElementById('apiActionStatus');
    await vi.waitFor(() => expect(status.textContent).toContain('Sent to relay.'));
    expect(status.textContent).toContain('Delivered to 2 tabs.');
    expect(status.classList.contains('api-status-error')).toBe(false);
  });

  it('displays delivery errors even when the relay remains connected', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({
      ok: true, state: 'connected', peers: 1, lastError: 'tab_delivery_failed'
    });

    await initApiPanel();

    await vi.waitFor(() => {
      expect(document.getElementById('relayStatus').textContent).toContain('tab_delivery_failed');
    });
    expect(document.getElementById('relayStatus').dataset.state).toBe('error');
  });
});
