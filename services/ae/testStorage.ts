// Test-only in-memory stand-ins for localStorage and IndexedDB, so the AE
// storage contract runs in the default `node` vitest environment (no jsdom, no
// fake-indexeddb package). Implements just the calls services/storage.ts makes.

export function memoryLocalStorage(opts: { failWrites?: boolean } = {}) {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      if (opts.failWrites) throw new DOMException('quota exceeded', 'QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  };
}

export function memoryIndexedDB(opts: { abortWrites?: boolean } = {}) {
  const data = new Map<string, unknown>();
  const indexedDB = {
    open() {
      const req: any = {};
      req.result = {
        objectStoreNames: { contains: () => true },
        createObjectStore() {},
        transaction() {
          const tx: any = { error: null };
          const done = (apply: () => void) => queueMicrotask(() => {
            if (opts.abortWrites) { tx.onabort?.(); return; }
            apply();
            tx.oncomplete?.();
          });
          tx.objectStore = () => ({
            get(key: string) {
              const r: any = {};
              queueMicrotask(() => { r.result = structuredClone(data.get(key)); r.onsuccess?.(); });
              return r;
            },
            put(value: unknown, key: string) { done(() => data.set(key, structuredClone(value))); },
            delete(key: string) { done(() => data.delete(key)); },
          });
          return tx;
        },
      };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };
  return { data, indexedDB };
}
