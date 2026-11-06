import { createHistoryStore } from './history.js';

const INVALID_REQUEST = 'Invalid request.';
const UNAUTHORIZED = 'This action is not allowed from this page.';
const UNKNOWN_MESSAGE = 'Unknown request.';

function validMessage(message) {
  return message !== null && typeof message === 'object' && !Array.isArray(message)
    && Object.hasOwn(message, 'type') && typeof message.type === 'string';
}

function validWebURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function createBackgroundController({ runtime, storage }) {
  const history = createHistoryStore(storage);
  let queue = Promise.resolve();

  function enqueue(operation) {
    const result = queue.then(operation, operation);
    queue = result.catch(() => undefined);
    return result;
  }

  function authorized(type, sender) {
    if (type === 'CHECK_URL' || type === 'RECORD_URL') {
      return sender?.id === runtime.id && Number.isInteger(sender?.tab?.id)
        && validWebURL(sender?.url);
    }
    const management = ['GET_STATE', 'SET_ENABLED', 'CLEAR_HISTORY', 'DELETE_URL'];
    if (!management.includes(type) || sender?.id !== runtime.id) return false;
    const popupURL = runtime.getURL('popup.html');
    return sender.url === popupURL
      && (sender.tab === undefined || sender.tab?.url === popupURL);
  }

  async function handleMessage(message, sender) {
    if (!validMessage(message)) return { ok: false, error: INVALID_REQUEST };
    const { type } = message;
    if (!['CHECK_URL', 'RECORD_URL', 'GET_STATE', 'SET_ENABLED', 'CLEAR_HISTORY', 'DELETE_URL'].includes(type)) {
      return { ok: false, error: UNKNOWN_MESSAGE };
    }
    if (!authorized(type, sender)) return { ok: false, error: UNAUTHORIZED };
    if ((type === 'CHECK_URL' || type === 'RECORD_URL' || type === 'DELETE_URL')
      && typeof message.url !== 'string') return { ok: false, error: INVALID_REQUEST };
    if (type === 'SET_ENABLED' && typeof message.enabled !== 'boolean') {
      return { ok: false, error: INVALID_REQUEST };
    }

    return enqueue(async () => {
      try {
        switch (type) {
          case 'CHECK_URL': return { ok: true, ...await history.check(message.url) };
          case 'RECORD_URL': return { ok: true, ...await history.record(message.url) };
          case 'GET_STATE': return { ok: true, ...await history.getState() };
          case 'SET_ENABLED': return { ok: true, ...await history.setEnabled(message.enabled) };
          case 'CLEAR_HISTORY': return { ok: true, ...await history.clear() };
          case 'DELETE_URL': return { ok: true, ...await history.delete(message.url) };
          default: return { ok: false, error: UNKNOWN_MESSAGE };
        }
      } catch (error) {
        const messageText = typeof error?.message === 'string' ? error.message : '';
        return { ok: false, error: messageText || 'The request could not be completed.' };
      }
    });
  }

  return { handleMessage };
}

if (globalThis.chrome?.runtime?.onMessage && globalThis.chrome?.storage?.local) {
  const controller = createBackgroundController({
    runtime: globalThis.chrome.runtime,
    storage: globalThis.chrome.storage.local
  });
  globalThis.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    controller.handleMessage(message, sender).then(sendResponse, () => {
      sendResponse({ ok: false, error: 'The request could not be completed.' });
    });
    return true;
  });
}
