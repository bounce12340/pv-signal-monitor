import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryIndexedDB, memoryLocalStorage } from './testStorage';

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

const load = () => import('./storage');

describe('AE durable storage', () => {
  it('falls back to localStorage when IndexedDB is unavailable', async () => {
    const ls = memoryLocalStorage();
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('localStorage', ls);
    const { saveValue, loadValue, AE_OUTBOX_KEY } = await load();
    await saveValue(AE_OUTBOX_KEY, [{ id: 'case1' }]);
    expect(JSON.parse(ls.getItem(AE_OUTBOX_KEY)!)).toEqual([{ id: 'case1' }]);
    expect(await loadValue(AE_OUTBOX_KEY)).toEqual([{ id: 'case1' }]);
  });

  it('rejects when both IndexedDB and localStorage fail, instead of pretending it saved', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('localStorage', memoryLocalStorage({ failWrites: true }));
    const { saveValue, AE_OUTBOX_KEY } = await load();
    await expect(saveValue(AE_OUTBOX_KEY, [])).rejects.toThrow('quota');
  });

  it('settles an aborted IndexedDB write by falling back, instead of hanging', async () => {
    const ls = memoryLocalStorage();
    vi.stubGlobal('indexedDB', memoryIndexedDB({ abortWrites: true }).indexedDB);
    vi.stubGlobal('localStorage', ls);
    const { saveValue, AE_OUTBOX_KEY } = await load();
    await saveValue(AE_OUTBOX_KEY, [{ id: 'aborted' }]);
    expect(JSON.parse(ls.getItem(AE_OUTBOX_KEY)!)).toEqual([{ id: 'aborted' }]);
  });

  it('writes to IndexedDB and drops an older localStorage fallback copy', async () => {
    const ls = memoryLocalStorage();
    const idb = memoryIndexedDB();
    ls.setItem('ae_outbox', JSON.stringify([{ id: 'stale' }]));
    vi.stubGlobal('indexedDB', idb.indexedDB);
    vi.stubGlobal('localStorage', ls);
    const { saveValue, loadValue, AE_OUTBOX_KEY } = await load();
    await saveValue(AE_OUTBOX_KEY, [{ id: 'fresh' }]);
    expect(idb.data.get(AE_OUTBOX_KEY)).toEqual([{ id: 'fresh' }]);
    expect(ls.getItem(AE_OUTBOX_KEY)).toBeNull();
    expect(await loadValue(AE_OUTBOX_KEY)).toEqual([{ id: 'fresh' }]);
  });

  it('reads a localStorage fallback copy when IndexedDB works but has nothing', async () => {
    const ls = memoryLocalStorage();
    ls.setItem('ae_draft', JSON.stringify({ id: 'draft-from-fallback' }));
    vi.stubGlobal('indexedDB', memoryIndexedDB().indexedDB);
    vi.stubGlobal('localStorage', ls);
    const { loadValue, AE_DRAFT_KEY } = await load();
    expect(await loadValue(AE_DRAFT_KEY)).toEqual({ id: 'draft-from-fallback' });
  });

  it('removes a key from both stores', async () => {
    const ls = memoryLocalStorage();
    const idb = memoryIndexedDB();
    idb.data.set('ae_draft', { id: 'd' });
    ls.setItem('ae_draft', JSON.stringify({ id: 'd' }));
    vi.stubGlobal('indexedDB', idb.indexedDB);
    vi.stubGlobal('localStorage', ls);
    const { removeValue, loadValue, AE_DRAFT_KEY } = await load();
    await removeValue(AE_DRAFT_KEY);
    expect(idb.data.has(AE_DRAFT_KEY)).toBe(false);
    expect(await loadValue(AE_DRAFT_KEY)).toBeUndefined();
  });

  it('reads storage on every call, so another tab\'s queued report is not lost to a stale cache', async () => {
    const idb = memoryIndexedDB();
    vi.stubGlobal('indexedDB', idb.indexedDB);
    vi.stubGlobal('localStorage', memoryLocalStorage());
    const { saveValue, loadValue, AE_OUTBOX_KEY } = await load();
    await saveValue(AE_OUTBOX_KEY, [{ id: 'a' }]);
    idb.data.set(AE_OUTBOX_KEY, [{ id: 'a' }, { id: 'b-from-other-tab' }]);
    expect(await loadValue(AE_OUTBOX_KEY)).toEqual([{ id: 'a' }, { id: 'b-from-other-tab' }]);
  });
});

describe('AE keys stay out of the D1 sync snapshot', () => {
  it('are in no boot hydrate/migrate key list and not in db.exportAll', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('localStorage', memoryLocalStorage());
    const { AE_OUTBOX_KEY, AE_DRAFT_KEY } = await load();
    const { db, DB_KEY_LIST } = await import('../db');
    const { SETTINGS_KEY_LIST } = await import('../settings');
    const { LITERATURE_KEY_LIST } = await import('../literature/storage');
    const lists = [...DB_KEY_LIST, ...SETTINGS_KEY_LIST, ...LITERATURE_KEY_LIST];
    for (const key of [AE_OUTBOX_KEY, AE_DRAFT_KEY]) {
      expect(lists).not.toContain(key);
      expect(Object.keys(db.exportAll())).not.toContain(key);
    }
  });
});
