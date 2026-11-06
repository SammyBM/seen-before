import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundController } from '../background.js';

function setup() {
  let data = {};
  const storage = {
    async get(keys) { return Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, structuredClone(data[key])])); },
    async set(values) { await new Promise(resolve => setTimeout(resolve, 1)); data = { ...data, ...structuredClone(values) }; }
  };
  const runtime = { id: 'ext-id', getURL: path => `chrome-extension://ext-id/${path}` };
  return { controller: createBackgroundController({ runtime, storage }), storage, runtime };
}

const contentSender = { id: 'ext-id', tab: { id: 9 }, url: 'https://page.example/frame' };
const popupSender = { id: 'ext-id', url: 'chrome-extension://ext-id/popup.html' };

test('concurrent first checks serialize into one first-seen record', async () => {
  const { controller } = setup();
  const results = await Promise.all(Array.from({ length: 12 }, () =>
    controller.handleMessage({ type: 'CHECK_URL', url: 'https://race.example/#x' }, contentSender)));
  assert.equal(results.filter(result => result.ok && result.repeated === false).length, 1);
  assert.equal(results.filter(result => result.ok && result.repeated === true).length, 11);
  const state = await controller.handleMessage({ type: 'GET_STATE' }, popupSender);
  assert.equal(state.total, 1);
});

test('only content sender can check and record; only popup can manage state', async () => {
  const { controller, runtime } = setup();
  assert.equal((await controller.handleMessage({ type: 'CHECK_URL', url: 'https://x.example' }, { ...contentSender, id: 'other' })).ok, false);
  assert.equal((await controller.handleMessage({ type: 'CHECK_URL', url: 'https://x.example' }, { ...contentSender, url: 'about:blank' })).ok, false);
  assert.equal((await controller.handleMessage({ type: 'GET_STATE' }, contentSender)).ok, false);
  assert.equal((await controller.handleMessage({ type: 'CLEAR_HISTORY' }, { ...popupSender, url: runtime.getURL('other.html') })).ok, false);
  assert.equal((await controller.handleMessage({ type: 'CLEAR_HISTORY' }, { ...popupSender, tab: { id: 1, url: runtime.getURL('other.html') } })).ok, false);
  assert.equal((await controller.handleMessage({ type: 'GET_STATE' }, { ...popupSender, tab: { id: 1, url: popupSender.url } })).ok, true);
});

test('valid popup actions persist and return JSON-friendly state', async () => {
  const { controller } = setup();
  assert.equal((await controller.handleMessage({ type: 'SET_ENABLED', enabled: false }, popupSender)).enabled, false);
  assert.deepEqual(await controller.handleMessage({ type: 'GET_STATE' }, popupSender), { ok: true, enabled: false, records: [], total: 0 });
  assert.equal((await controller.handleMessage({ type: 'RECORD_URL', url: 'https://x.example' }, contentSender)).enabled, false);
  assert.deepEqual(await controller.handleMessage({ type: 'CLEAR_HISTORY' }, popupSender), { ok: true, total: 0 });
});

test('malformed and unknown messages return safe failures', async () => {
  const { controller } = setup();
  assert.deepEqual(await controller.handleMessage(null, popupSender), { ok: false, error: 'Invalid request.' });
  assert.deepEqual(await controller.handleMessage({ type: 'NOT_A_MESSAGE' }, popupSender), { ok: false, error: 'Unknown request.' });
  assert.equal((await controller.handleMessage({ type: 'CHECK_URL', url: 10 }, contentSender)).ok, false);
  assert.equal((await controller.handleMessage({ type: 'SET_ENABLED', enabled: 'false' }, popupSender)).ok, false);
  assert.equal((await controller.handleMessage({ type: 'RECORD_URL', url: 'javascript:alert(1)' }, contentSender)).ok, false);
});

test('background converts storage exceptions to failure responses and queue remains usable', async () => {
  let fail = true;
  const storage = {
    async get(keys) { if (fail) throw new Error('private storage detail'); return {}; },
    async set() {}
  };
  const runtime = { id: 'ext-id', getURL: path => `chrome-extension://ext-id/${path}` };
  const controller = createBackgroundController({ runtime, storage });
  const error = await controller.handleMessage({ type: 'GET_STATE' }, popupSender);
  assert.equal(error.ok, false);
  assert.ok(!error.error.includes('private'));
  fail = false;
  assert.equal((await controller.handleMessage({ type: 'GET_STATE' }, popupSender)).ok, true);
});
