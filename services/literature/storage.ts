// IndexedDB 儲存層：取代 localStorage。
// localStorage 上限約 5MB，含摘要的文獻很快就會爆；IndexedDB 可存數千筆。
// 同時保存「正式庫」與「待核閱清單」，重新整理頁面不遺失（#3 + #7）。
// 首次載入時自動從舊的 localStorage(PV_AUDITOR_MASTER_DB) 一次性遷移。

const DB_NAME = 'pv-link';
const DB_VERSION = 1;
const STORE = 'kv';
const LEGACY_LS_KEY = 'PV_AUDITOR_MASTER_DB';

export const DB_KEY = 'master_db';
export const PENDING_KEY = 'pending_review';

// localStorage 退路（IndexedDB 不可用時）用的鍵。正式庫沿用舊 legacy 鍵，
// 讓「讀」與「寫」用同一個鍵，否則重載會讀不到剛寫的資料而遺失（見 review #1）。
const lsKey = (key: string) => (key === DB_KEY ? LEGACY_LS_KEY : `pv_${key}`);

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

function idbGet<T>(key: string): Promise<T | undefined> {
  return openDB().then(db => new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function idbSet(key: string, value: any): Promise<void> {
  return openDB().then(db => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

/** 讀取指定鍵的文獻陣列；讀不到時對正式庫嘗試從舊 localStorage 遷移。失敗一律回空陣列（不讓 App 掛掉）。 */
export async function loadRecords(key: string): Promise<any[]> {
  try {
    const v = await idbGet<any[]>(key);
    if (Array.isArray(v)) return v;
  } catch {
    // IndexedDB 不可用（如某些隱私模式）：退回 localStorage 讀取（與 saveRecords 用同一個鍵）
    try {
      const ls = localStorage.getItem(lsKey(key));
      if (ls) { const p = JSON.parse(ls); if (Array.isArray(p)) return p; }
    } catch { /* ignore */ }
    return [];
  }
  // IndexedDB 可用但無資料：正式庫做一次性 localStorage → IndexedDB 遷移
  if (key === DB_KEY) {
    try {
      const legacy = localStorage.getItem(LEGACY_LS_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        if (Array.isArray(parsed) && parsed.length) {
          await idbSet(key, parsed);
          return parsed;
        }
      }
    } catch { /* ignore */ }
  }
  return [];
}

/** 寫入指定鍵的文獻陣列；IndexedDB 失敗時退回 localStorage。任何失敗都不阻斷 UI。 */
export async function saveRecords(key: string, records: any[]): Promise<void> {
  try {
    await idbSet(key, records);
  } catch {
    try { localStorage.setItem(lsKey(key), JSON.stringify(records)); } catch { /* 儲存滿了也不擋 UI */ }
  }
}
