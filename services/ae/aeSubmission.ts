// AE 表單送出結果的本機保全契約。從 PV-Link 的 services/aeSubmission.ts 搬入
// （去掉了本 repo 沒有的「本機模式」local / local_saved）。
//
// SubmitResult.ok 只表示遠端已確認送達。outbox / outbox_conflict 是已耐久保存、
// 但尚未遠端送達的本機工作項；unconfirmed 則表示連 outbox 都無法確認保存，
// 表單不可清空或導向完成畫面。

import type { SubmitResult } from './aeApi';

export type FormSubmissionState =
  | 'remote_delivered'
  | 'queued_pending'
  | 'queued_conflict'
  | 'unconfirmed';

export interface FormSubmissionOutcome {
  state: FormSubmissionState;
  /** 已有另一份耐久副本時才可清除表單草稿。 */
  mayClearDraft: boolean;
}

/**
 * 將 aeApi 的 SubmitResult.channel 對應到表單可呈現的保全狀態。
 *
 * 契約：
 *   remote            → 遠端已確認送達，可清稿。
 *   outbox             → 已耐久保存於待送佇列（queue 成功 ≠ remote delivery），可清稿。
 *   outbox_conflict    → 409 衝突已耐久保存並停止自動重送，可清稿（草稿已有另一份耐久副本）。
 *   unconfirmed        → 連 outbox 都無法確認保存，唯一草稿不得清除，也不得宣稱任何形式的成功。
 *
 * 此函式刻意不把 queued 當作 remote delivered，也不依 ok 欄位以外的訊號猜測成功。
 */
export function classifyFormSubmission(result: SubmitResult): FormSubmissionOutcome {
  switch (result.channel) {
    case 'remote':
      return { state: 'remote_delivered', mayClearDraft: true };
    case 'outbox':
      return { state: 'queued_pending', mayClearDraft: true };
    case 'outbox_conflict':
      return { state: 'queued_conflict', mayClearDraft: true };
    case 'unconfirmed':
    default:
      // 未知 channel 一律視為未確認保存：安全預設是保留草稿，絕不誤刪唯一副本。
      return { state: 'unconfirmed', mayClearDraft: false };
  }
}

/**
 * 送出結果落地為 UI 動作：只有 classifyFormSubmission 判定可清稿時才呼叫 removeDraft。
 * removeDraft 失敗會原樣往外拋——呼叫端必須誠實提示「已送出但清稿失敗」，
 * 不得吞錯視為成功、也不得因此誤導使用者重送。
 */
export async function finalizeFormSubmission(
  result: SubmitResult,
  removeDraft: () => Promise<void>,
): Promise<FormSubmissionOutcome> {
  const outcome = classifyFormSubmission(result);
  if (outcome.mayClearDraft) await removeDraft();
  return outcome;
}

/**
 * 表單自動保存草稿（debounce）與「送出／清稿」之間的競態協調器。
 *
 * 這是從 AEReportMobile 元件直接抽出的真實協調邏輯（非替代演算法）：元件的
 * useRef(generation)/useRef(timer)/useRef(pendingWrite) 三件事在此收斂成一個
 * 可獨立以真實 setTimeout／Promise 動態測試的最小單元，元件改為持有此類別的
 * 一個 instance 並委派呼叫，行為與抽出前逐位元相同。
 *
 * 要處理的競態：
 *   1. debounce 計時器已排程但尚未觸發時使用者按下送出 → 送出流程刪除草稿後，
 *      這個「舊」計時器觸發時絕不能把剛刪除的草稿重新寫回（延後 autosave 重建已送 draft）。
 *   2. debounce 的非同步寫入已經在飛行中（write promise 尚未 resolve）時使用者按下
 *      送出 → 必須等這次寫入落地（無論成功或失敗）才能真正呼叫刪除，
 *      否則刪除可能先於寫入完成，寫入完成後又把草稿寫回（刪新 draft 被舊寫入蓋回）。
 *   3. 使用者連續按兩次送出（雙 submit）→ 第二次呼叫 invalidateAndSettle 時
 *      generation 已經被第一次呼叫遞增過，任何仍在飛行、屬於更舊世代的寫入
 *      結果一律被忽略，不會覆蓋已完成的清稿。
 */
export class DraftAutosaveCoordinator {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(private readonly debounceMs = 600) {}

  /** 目前世代編號；供呼叫端在 write 完成回呼中比對是否仍為最新排程。 */
  get currentGeneration(): number {
    return this.generation;
  }

  /**
   * 排程一次 debounce 草稿寫入。saveDraft 只有在計時器觸發、且觸發當下世代仍與
   * 排程時相同（未被 invalidateAndSettle 搶先作廢）才會真正呼叫。
   */
  scheduleSave(
    saveDraft: () => Promise<void>,
    onSettled?: (outcome: 'saved' | 'failed') => void,
  ): void {
    const generation = this.generation;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      // 觸發當下再次核對世代：涵蓋「計時器已進入事件佇列、但 invalidateAndSettle
      // 剛好在同一個 tick 搶先遞增世代」的極端時序，避免舊排程仍落地寫入。
      if (generation !== this.generation) return;
      const write = saveDraft();
      this.pendingWrite = write;
      write
        .then(() => { if (generation === this.generation) onSettled?.('saved'); })
        .catch(() => { if (generation === this.generation) onSettled?.('failed'); });
    }, this.debounceMs);
  }

  /**
   * 只取消尚未觸發的排程計時器，不遞增世代、不等待飛行中的寫入。
   * 用於一般 effect cleanup（每次 report 變更時取消上一次的 debounce 排程）——
   * 這與 invalidateAndSettle 的差異是它不需要「讓飛行中的寫入也失效」的語意，
   * 因為此處只是把還沒開始的計時器換成新的一個，並非要清除草稿。
   */
  cancelScheduled(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  /**
   * 在真正刪除草稿之前呼叫：遞增世代（讓任何舊排程／飛行中的寫入失效）、
   * 取消尚未觸發的計時器、並等待任何仍在飛行的寫入落地（無論成功或失敗）。
   * 回傳後，呼叫端才可以安全地執行實際的 removeDraft。
   */
  async invalidateAndSettle(): Promise<void> {
    this.generation++;
    this.cancelScheduled();
    await this.pendingWrite.catch(() => undefined);
  }
}
