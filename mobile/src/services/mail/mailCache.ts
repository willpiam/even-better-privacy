/** Bounded, memory-only cache. Decrypted EBP content is never stored here. */
export function createMailCache<T>(
  maxEntries: number,
  maxChars: number,
  ttlMs: number,
) {
  const entries = new Map<string, {value: T; size: number; expires: number}>();
  const pending = new Map<string, Promise<T>>();
  let chars = 0;
  let generation = 0;
  function remove(key: string) {
    const entry = entries.get(key);
    if (entry) chars -= entry.size;
    entries.delete(key);
  }
  function get(key: string): T | undefined {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) {
      remove(key);
      return undefined;
    }
    entries.delete(key);
    entries.set(key, entry);
    return entry.value;
  }
  return {
    get,
    async load(
      key: string,
      fetcher: () => Promise<T>,
      refresh = false,
    ): Promise<T> {
      const cached = get(key);
      if (!refresh && cached !== undefined) return cached;
      const existing = pending.get(key);
      if (existing) return existing;
      const started = generation;
      const request = Promise.resolve()
        .then(() => {
          if (started !== generation)
            throw new Error('Mail session changed; reload to continue');
          return fetcher();
        })
        .then(value => {
          if (started !== generation)
            throw new Error('Mail session changed; reload to continue');
          const size = JSON.stringify(value).length;
          remove(key);
          if (size <= maxChars) {
            entries.set(key, {value, size, expires: Date.now() + ttlMs});
            chars += size;
            while (entries.size > maxEntries || chars > maxChars)
              remove(entries.keys().next().value!);
          }
          return value;
        })
        .finally(() => {
          if (pending.get(key) === request) pending.delete(key);
        });
      pending.set(key, request);
      return request;
    },
    clear() {
      generation++;
      entries.clear();
      pending.clear();
      chars = 0;
    },
  };
}

const listeners = new Set<() => void>();
const caches = new Set<{clear: () => void}>();
export function registerMailCache(cache: {clear: () => void}) {
  caches.add(cache);
}
export function onMailCacheCleared(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function clearMailDataCache(): void {
  for (const cache of caches) cache.clear();
  for (const listener of listeners) listener();
}
