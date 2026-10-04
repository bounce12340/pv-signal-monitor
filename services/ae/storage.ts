// AE（不良反應通報）在本機保存的資料：離線送出佇列與表單草稿。
// services/storage.ts 的 durable API 的薄包裝——寫入失敗會拋錯，不會被吞掉。
//
// ⚠️ 這兩個鍵刻意**不**列入任何 *_KEY_LIST，也不進 db.exportAll：
//   • 它們是「這支手機」的狀態。outbox 若隨 D1 同步快照複製到別的裝置，
//     每台裝置都會補送一次，同一個個案就會重複建檔。
//   • 內容是病人資料。AE 資料只能存在 AE_DB，不能跟著同步快照進 sync 用的 DB。

import { loadDurable, removeDurable, saveDurable } from '../storage';

/** 離線送出佇列：送不出去的個案暫存在這裡，恢復連線後由 flushOutbox 補送。 */
export const AE_OUTBOX_KEY = 'ae_outbox';
/** 通報表單的本機草稿（單筆，尚未送出）。 */
export const AE_DRAFT_KEY = 'ae_draft';

export const loadValue = <T>(key: string): Promise<T | undefined> => loadDurable<T>(key);
export const saveValue = (key: string, value: unknown): Promise<void> => saveDurable(key, value);
export const removeValue = (key: string): Promise<void> => removeDurable(key);
