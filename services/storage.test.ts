import { describe, it, expect } from 'vitest';
import { migrateLocalStorageToKV, type MigrationDeps } from './storage';

// In-memory localStorage + key-value store so the migration is testable in the
// default `node` vitest environment (no fake-indexeddb, no new packages).
function makeHarness(seedLS: Record<string, string> = {}) {
  const ls = new Map<string, string>(Object.entries(seedLS));
  const kv = new Map<string, unknown>();
  let flag = false;
  const deps: Required<MigrationDeps> = {
    getItem: (k) => (ls.has(k) ? (ls.get(k) as string) : null),
    kvGet: async (k) => (kv.has(k) ? kv.get(k) : undefined),
    kvSet: async (k, v) => {
      kv.set(k, v);
    },
    hasFlag: () => flag,
    setFlag: () => {
      flag = true;
    },
  };
  return { ls, kv, deps, isFlag: () => flag };
}

const KEYS = ['pv_db_products', 'pv_db_system_logs', 'pv_settings_ai'];

describe('migrateLocalStorageToKV', () => {
  it('把 localStorage 值解析後複製進 kv store，設旗標，回報遷移的鍵', async () => {
    const h = makeHarness({
      pv_db_products: JSON.stringify([{ product_id: 'p1' }]),
      pv_settings_ai: JSON.stringify({ provider: 'gemini', model: 'x' }),
      // pv_db_system_logs absent → skipped
    });
    const migrated = await migrateLocalStorageToKV(KEYS, h.deps);

    expect(migrated.sort()).toEqual(['pv_db_products', 'pv_settings_ai']);
    // Parsed (structured), not the raw JSON string.
    expect(h.kv.get('pv_db_products')).toEqual([{ product_id: 'p1' }]);
    expect(h.kv.get('pv_settings_ai')).toEqual({ provider: 'gemini', model: 'x' });
    expect(h.isFlag()).toBe(true);
  });

  it('原 localStorage 資料保留不刪（可回退）', async () => {
    const raw = JSON.stringify([{ product_id: 'p1' }]);
    const h = makeHarness({ pv_db_products: raw });
    await migrateLocalStorageToKV(KEYS, h.deps);
    expect(h.ls.get('pv_db_products')).toBe(raw);
  });

  it('旗標已設 → 完全跳過（不重複遷移）', async () => {
    const h = makeHarness({ pv_db_products: JSON.stringify([1]) });
    h.deps.hasFlag = () => true;
    const migrated = await migrateLocalStorageToKV(KEYS, h.deps);
    expect(migrated).toEqual([]);
    expect(h.kv.size).toBe(0);
  });

  it('kv 已有該鍵 → 不覆蓋', async () => {
    const h = makeHarness({ pv_db_products: JSON.stringify([{ product_id: 'fromLS' }]) });
    h.kv.set('pv_db_products', [{ product_id: 'existing' }]);
    const migrated = await migrateLocalStorageToKV(KEYS, h.deps);
    expect(migrated).toEqual([]); // nothing copied
    expect(h.kv.get('pv_db_products')).toEqual([{ product_id: 'existing' }]);
    expect(h.isFlag()).toBe(true);
  });

  it('非 JSON 的 localStorage 值跳過，不中斷其他鍵', async () => {
    const h = makeHarness({
      pv_db_products: 'not-json{',
      pv_settings_ai: JSON.stringify({ provider: 'gemini' }),
    });
    const migrated = await migrateLocalStorageToKV(KEYS, h.deps);
    expect(migrated).toEqual(['pv_settings_ai']);
    expect(h.kv.has('pv_db_products')).toBe(false);
  });

  it('全部鍵在 localStorage 皆不存在 → 遷移空集但仍設旗標', async () => {
    const h = makeHarness();
    const migrated = await migrateLocalStorageToKV(KEYS, h.deps);
    expect(migrated).toEqual([]);
    expect(h.isFlag()).toBe(true);
  });
});
