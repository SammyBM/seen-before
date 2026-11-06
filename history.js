const INVALID_DATA = 'Saved history is invalid. Clear history to continue.';
const STORAGE_FAILURE = 'History could not be saved. Free storage space and try again.';

export function normalizeURL(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('Enter a valid HTTP or HTTPS URL.');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError('Enter a valid HTTP or HTTPS URL.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new TypeError('Only HTTP or HTTPS URLs without credentials can be saved.');
  }
  parsed.hash = '';
  return parsed.href;
}

function safeRecord(record, key) {
  return record && typeof record === 'object' && !Array.isArray(record)
    && record.url === key
    && Number.isFinite(record.firstClickedAt)
    && Number.isFinite(record.lastClickedAt)
    && Number.isInteger(record.clickCount) && record.clickCount >= 1;
}

function readHistory(data) {
  const source = data.history;
  if (source === undefined) return Object.create(null);
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || !source.records || typeof source.records !== 'object' || Array.isArray(source.records)) {
    throw new Error(INVALID_DATA);
  }
  const records = Object.create(null);
  for (const key of Object.keys(source.records)) {
    let normalized;
    try { normalized = normalizeURL(key); } catch { throw new Error(INVALID_DATA); }
    const record = source.records[key];
    if (normalized !== key || !safeRecord(record, key)) throw new Error(INVALID_DATA);
    records[key] = { url: key, firstClickedAt: record.firstClickedAt,
      lastClickedAt: record.lastClickedAt, clickCount: record.clickCount };
  }
  return records;
}

function publicRecord(record) {
  return record ? { url: record.url, firstClickedAt: record.firstClickedAt,
    lastClickedAt: record.lastClickedAt, clickCount: record.clickCount } : null;
}

export function createHistoryStore(storage, now = () => Date.now()) {
  async function load() {
    let data;
    try { data = await storage.get(['history', 'enabled']); }
    catch { throw new Error(STORAGE_FAILURE); }
    if (!data || typeof data !== 'object') throw new Error(INVALID_DATA);
    if (data.enabled !== undefined && typeof data.enabled !== 'boolean') throw new Error(INVALID_DATA);
    return { records: readHistory(data), enabled: data.enabled === undefined ? true : data.enabled };
  }

  async function save(state) {
    try {
      const records = {};
      for (const key of Object.keys(state.records)) records[key] = publicRecord(state.records[key]);
      await storage.set({ history: { records }, enabled: state.enabled });
    } catch (error) {
      if (error?.message === INVALID_DATA || error?.message === STORAGE_FAILURE) throw error;
      throw new Error(STORAGE_FAILURE);
    }
  }

  return {
    async check(value) {
      const url = normalizeURL(value);
      const state = await load();
      if (!state.enabled) return { enabled: false, repeated: false, record: null };
      const previous = state.records[url];
      if (previous) return { enabled: true, repeated: true, record: publicRecord(previous) };
      const timestamp = now();
      const record = { url, firstClickedAt: timestamp, lastClickedAt: timestamp, clickCount: 1 };
      state.records[url] = record;
      await save(state);
      return { enabled: true, repeated: false, record: publicRecord(record) };
    },
    async record(value) {
      const url = normalizeURL(value);
      const state = await load();
      if (!state.enabled) return { enabled: false };
      const previous = state.records[url];
      const timestamp = now();
      state.records[url] = previous
        ? { ...previous, lastClickedAt: timestamp, clickCount: previous.clickCount + 1 }
        : { url, firstClickedAt: timestamp, lastClickedAt: timestamp, clickCount: 1 };
      await save(state);
      return { enabled: true, record: publicRecord(state.records[url]) };
    },
    async getState() {
      const state = await load();
      const records = Object.keys(state.records).map(key => publicRecord(state.records[key]));
      return { enabled: state.enabled, records, total: records.length };
    },
    async setEnabled(enabled) {
      if (typeof enabled !== 'boolean') throw new TypeError('Enabled must be true or false.');
      const state = await load();
      state.enabled = enabled;
      await save(state);
      return { enabled };
    },
    async clear() {
      let data;
      try { data = await storage.get(['history', 'enabled']); }
      catch { throw new Error(STORAGE_FAILURE); }
      const state = { records: Object.create(null), enabled: typeof data?.enabled === 'boolean' ? data.enabled : true };
      await save(state);
      return { total: 0 };
    },
    async delete(value) {
      const url = normalizeURL(value);
      const state = await load();
      const deleted = Object.hasOwn(state.records, url);
      if (deleted) {
        delete state.records[url];
        await save(state);
      }
      return { deleted, total: Object.keys(state.records).length };
    }
  };
}

export { INVALID_DATA, STORAGE_FAILURE };
