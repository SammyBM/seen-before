import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryStore, normalizeURL, INVALID_DATA, STORAGE_FAILURE } from '../history.js';

function memoryStorage(initial = {}) {
  let data = structuredClone(initial);
  return {
    async get(keys) {
      if (typeof keys === 'string') keys = [keys];
      return Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, structuredClone(data[key])]));
    },
    async set(values) { data = { ...data, ...structuredClone(values) }; },
    snapshot() { return structuredClone(data); }
  };
}

test('normalizes fragments while retaining queries and parser host/path distinctions', () => {
  assert.equal(normalizeURL('HTTPS://Example.COM/a?x=1#section'), 'https://example.com/a?x=1');
  assert.equal(normalizeURL('https://www.example.com'), 'https://www.example.com/');
  assert.equal(normalizeURL('https://example.com/'), 'https://example.com/');
});

test('rejects absent, malformed, unsupported, and credential-bearing URLs', () => {
  for (const value of [undefined, '', 'nope', 'file:///tmp/x', 'javascript:alert(1)', 'https://user:secret@example.com/']) {
    assert.throws(() => normalizeURL(value), TypeError);
  }
});

test('check creates once; repeats do not count until confirmed record', async () => {
  const storage = memoryStorage();
  let time = 100;
  const store = createHistoryStore(storage, () => time++);
  const first = await store.check('https://example.com/p#one');
  assert.equal(first.enabled, true);
  assert.equal(first.repeated, false);
  assert.equal(first.record.clickCount, 1);
  const repeat = await store.check('https://example.com/p#two');
  assert.equal(repeat.repeated, true);
  assert.equal(repeat.record.clickCount, 1);
  const recorded = await store.record('https://example.com/p');
  assert.equal(recorded.record.clickCount, 2);
  assert.equal(recorded.record.lastClickedAt, 101);
  assert.equal((await store.getState()).total, 1);
});

test('recording a new URL starts at one and persisted values survive store recreation', async () => {
  const storage = memoryStorage();
  await createHistoryStore(storage, () => 40).record('http://example.org');
  const reloaded = createHistoryStore(storage, () => 50);
  assert.deepEqual(await reloaded.getState(), {
    enabled: true,
    records: [{ url: 'http://example.org/', firstClickedAt: 40, lastClickedAt: 40, clickCount: 1 }],
    total: 1
  });
  assert.equal((await reloaded.check('http://example.org')).record.clickCount, 1);
});

test('disabled mode prevents checks and records; enablement is persisted', async () => {
  const storage = memoryStorage();
  const store = createHistoryStore(storage, () => 1);
  await store.setEnabled(false);
  assert.deepEqual(await store.check('https://example.com'), { enabled: false, repeated: false, record: null });
  assert.deepEqual(await store.record('https://example.com'), { enabled: false });
  assert.equal((await store.getState()).total, 0);
  await createHistoryStore(storage).setEnabled(true);
  assert.equal((await createHistoryStore(storage).getState()).enabled, true);
});

test('delete and clear report state and preserve enablement', async () => {
  const store = createHistoryStore(memoryStorage(), () => 5);
  await store.check('https://one.example');
  await store.check('https://two.example');
  assert.deepEqual(await store.delete('https://missing.example'), { deleted: false, total: 2 });
  assert.deepEqual(await store.delete('https://one.example'), { deleted: true, total: 1 });
  assert.deepEqual(await store.clear(), { total: 0 });
  assert.equal((await store.getState()).enabled, true);
  assert.equal((await store.getState()).total, 0);
});

test('malformed persisted records fail clearly without treating data as a prototype', async () => {
  const storage = memoryStorage(JSON.parse('{"history":{"records":{"__proto__":{"url":"__proto__"}}}}'));
  await assert.rejects(createHistoryStore(storage).getState(), error => error.message === INVALID_DATA);
  const unsupportedKeyStorage = memoryStorage({ history: { records: { 'file:///bad': { url: 'file:///bad', clickCount: 1, firstClickedAt: 1, lastClickedAt: 1 } } } });
  await assert.rejects(createHistoryStore(unsupportedKeyStorage).getState(), error => error.message === INVALID_DATA);
  const badRecordStorage = memoryStorage({ history: { records: { 'https://example.com/': { url: 'https://other.example/', clickCount: 1, firstClickedAt: 1, lastClickedAt: 1 } } } });
  await assert.rejects(createHistoryStore(badRecordStorage).getState(), error => error.message === INVALID_DATA);
});

test('clear repairs corrupt history and preserves a valid enabled setting', async () => {
  const storage = memoryStorage({ history: { records: { broken: null } }, enabled: false });
  const store = createHistoryStore(storage);
  await assert.rejects(store.getState(), error => error.message === INVALID_DATA);
  assert.deepEqual(await store.clear(), { total: 0 });
  assert.deepEqual(await store.getState(), { enabled: false, records: [], total: 0 });
});

test('invalid enabled storage data fails safely and clear resets it to the default', async () => {
  const storage = memoryStorage({ history: { records: {} }, enabled: 'yes' });
  const store = createHistoryStore(storage);
  await assert.rejects(store.getState(), error => error.message === INVALID_DATA);
  await store.clear();
  assert.equal((await store.getState()).enabled, true);
});

test('storage read and write failures become safe actionable errors', async () => {
  const readFailure = createHistoryStore({ async get() { throw new Error('private backend detail'); } });
  await assert.rejects(readFailure.getState(), error => error.message === STORAGE_FAILURE && !error.message.includes('private'));
  const writeFailure = createHistoryStore({ async get() { return {}; }, async set() { throw new Error('quota'); } });
  await assert.rejects(writeFailure.check('https://example.com'), error => error.message === STORAGE_FAILURE);
});
