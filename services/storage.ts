// Unified storage backend for the whole app.
//
// IndexedDB is the single durable store (one database, one key-value object
// store). An in-memory cache mirrors it so the rest of the app can keep its
// synchronous read/write API (db.ts, settings.ts) — reads hit the cache, writes
// update the cache immediately and persist to IndexedDB in the background.
//
// initStorage() runs once at boot: it performs a one-time localStorage →
// IndexedDB migration (host db keys + settings) and then hydrates the cache
// from IndexedDB. The original localStorage values are left in place after
// migration so a user can roll back to the pre-IndexedDB build.
//
// When IndexedDB is unavailable (e.g. some private-browsing modes) every write
// falls back to localStorage under the same key, and synchronous reads fall
// back to a localStorage parse, so the app degrades to its previous behaviour.

const DB_NAME = 'pv-signal-monitor';
const DB_VERSION = 1;
const STORE = 'kv';

// Set once the one-time localStorage → IndexedDB migration has run.
export const MIGRATION_FLAG = 'pv_idb_migrated';

// In-memory mirror of the durable store; the synchronous API reads from here.
const cache = new Map<string, unknown>();

// --- low-level IndexedDB ---

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB 不可用'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export function idbGet<T>(key: string): Promise<T | undefined> {
  return openDB().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export function idbSet(key: string, value: unknown): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

// --- synchronous localStorage helpers (fallback + pre-hydration reads) ---

function lsGetParsed(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return undefined;
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// --- public synchronous API ---

/**
 * Synchronous read from the in-memory cache (populated by initStorage()).
 * Before init, or when IndexedDB is unavailable, falls back to a synchronous
 * localStorage parse (and caches the result).
 */
export function loadSync<T>(key: string): T | undefined {
  if (cache.has(key)) return cache.get(key) as T;
  const v = lsGetParsed(key);
  if (v !== undefined) {
    cache.set(key, v);
    return v as T;
  }
  return undefined;
}

/**
 * Update the cache immediately and persist to IndexedDB in the background.
 * On IndexedDB failure the value is written to localStorage under the same key
 * (degraded, but consistent with loadSync's fallback).
 */
export function save(key: string, value: unknown): void {
  cache.set(key, value);
  void persist(key, value);
}

async function persist(key: string, value: unknown): Promise<void> {
  try {
    await idbSet(key, value);
  } catch {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full / unavailable — cache still holds the value this session */
    }
  }
}

/** Async read used by the literature layer's async API; prefers the cache. */
export async function loadAsync<T>(key: string): Promise<T | undefined> {
  if (cache.has(key)) return cache.get(key) as T;
  try {
    const v = await idbGet<T>(key);
    if (v !== undefined) {
      cache.set(key, v);
      return v;
    }
    return undefined;
  } catch {
    return lsGetParsed(key) as T | undefined;
  }
}

// --- migration ---

export interface MigrationDeps {
  getItem?: (k: string) => string | null;
  kvGet?: (k: string) => Promise<unknown>;
  kvSet?: (k: string, v: unknown) => Promise<void>;
  hasFlag?: () => boolean;
  setFlag?: () => void;
}

/**
 * One-time copy of the given localStorage keys into the key-value store.
 * Idempotent: skips entirely once the flag is set, skips keys already present
 * in the store, and never deletes the localStorage source (rollback). Returns
 * the keys actually migrated. Dependencies are injectable for testing.
 */
export async function migrateLocalStorageToKV(
  keys: string[],
  deps: MigrationDeps = {}
): Promise<string[]> {
  const getItem = deps.getItem ?? ((k: string) => localStorage.getItem(k));
  const kvGet = deps.kvGet ?? idbGet;
  const kvSet = deps.kvSet ?? idbSet;
  const hasFlag = deps.hasFlag ?? (() => localStorage.getItem(MIGRATION_FLAG) === '1');
  const setFlag =
    deps.setFlag ??
    (() => {
      try {
        localStorage.setItem(MIGRATION_FLAG, '1');
      } catch {
        /* ignore */
      }
    });

  if (hasFlag()) return [];

  const migrated: string[] = [];
  for (const key of keys) {
    const raw = getItem(key);
    if (raw == null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // not JSON — leave it alone
    }
    // Never clobber data already living in the key-value store.
    const existing = await kvGet(key);
    if (existing !== undefined) continue;
    await kvSet(key, parsed);
    migrated.push(key);
  }
  setFlag();
  return migrated;
}

// --- boot ---

/**
 * Run the one-time migration for `migrateKeys`, then hydrate the cache from
 * IndexedDB for every key in `hydrateKeys`. Resilient: if IndexedDB is
 * unavailable the cache stays empty and the synchronous API falls back to
 * localStorage. Always resolves.
 */
export async function initStorage(hydrateKeys: string[], migrateKeys: string[]): Promise<void> {
  try {
    await migrateLocalStorageToKV(migrateKeys);
    const values = await Promise.all(hydrateKeys.map((k) => idbGet(k)));
    hydrateKeys.forEach((k, i) => {
      if (values[i] !== undefined) cache.set(k, values[i]);
    });
  } catch {
    // IndexedDB unavailable — loadSync will fall back to localStorage.
  }
}
