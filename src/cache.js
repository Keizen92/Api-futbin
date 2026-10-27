export function createTtlCache({ maxEntries = 400 } = {}) {
  const store = new Map();
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  function get(key) {
    const entry = store.get(key);
    if (!entry) {
      misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      misses += 1;
      return undefined;
    }
    hits += 1;
    store.delete(key);
    store.set(key, entry);
    return {
      value: entry.value,
      storedAt: entry.storedAt,
      expiresAt: entry.expiresAt,
    };
  }

  function peek(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    return {
      value: entry.value,
      storedAt: entry.storedAt,
      expiresAt: entry.expiresAt,
    };
  }

  function set(key, value, ttlMs) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;
    if (store.has(key)) store.delete(key);
    while (store.size >= maxEntries) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
      evictions += 1;
    }
    const now = Date.now();
    store.set(key, { value, storedAt: now, expiresAt: now + ttlMs });
  }

  function clear() {
    store.clear();
  }

  function stats() {
    const total = hits + misses;
    return {
      size: store.size,
      maxEntries,
      hits,
      misses,
      evictions,
      hitRate: total === 0 ? 0 : Number((hits / total).toFixed(3)),
    };
  }

  return { get, peek, set, clear, stats };
}
