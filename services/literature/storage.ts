// Literature library persistence. Thin wrapper over the app's unified storage
// backend (services/storage.ts → IndexedDB with a localStorage fallback), so
// the literature "master database" and "pending review" list share the single
// store used by the rest of the app and ride along in the D1 sync snapshot.

import { loadAsync, save } from '../storage';

export const DB_KEY = 'master_db'; // 正式庫
export const PENDING_KEY = 'pending_review'; // 待核閱清單

// Hydrated (not migrated) at boot: these keys had no localStorage origin in the
// host app, but hydrating them lets the sync snapshot capture existing data.
export const LITERATURE_KEY_LIST: string[] = [DB_KEY, PENDING_KEY];

/** Read a literature record array; missing/invalid data yields []. */
export async function loadRecords(key: string): Promise<any[]> {
  const v = await loadAsync<any[]>(key);
  return Array.isArray(v) ? v : [];
}

/** Persist a literature record array (cache + IndexedDB, localStorage fallback). */
export async function saveRecords(key: string, records: any[]): Promise<void> {
  save(key, records);
}
