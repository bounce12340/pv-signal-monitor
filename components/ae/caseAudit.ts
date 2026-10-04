// 個案稽核軌跡的顯示：動作代碼 → 文字、部分 detail 代碼 → 文字。
//
// 稽核軌跡原本把資料庫裡的代碼原樣印出（「status：triage」「meddra_autocode」），
// 查核時得自己翻譯。這裡只改「顯示」，資料庫存的仍是代碼——代碼才是穩定、
// 可比對的稽核紀錄。未知的代碼照原文顯示：寧可露出代碼，也不能翻成一個
// 看似合理但錯的字。
import type { TransKey } from '../../i18n/translations';
import { AE_CASE_STATUSES, CAUSALITY_OPTIONS, EXPECTEDNESS_OPTIONS } from '../../services/ae/aeReport';
import { pickLabel } from './ui';

export const CASE_AUDIT_ACTION_KEY = {
  submit: 'ae.audit.submit',
  received: 'ae.audit.received',
  status: 'ae.audit.status',
  validity_confirm: 'ae.audit.validity_confirm',
  mark_duplicate: 'ae.audit.mark_duplicate',
  seriousness_override: 'ae.audit.seriousness_override',
  meddra_autocode: 'ae.audit.meddra_autocode',
  expectedness: 'ae.audit.expectedness',
  causality: 'ae.audit.causality',
  awareness_date_changed: 'ae.audit.awareness_date_changed',
  significant_new_info: 'ae.audit.significant_new_info',
  follow_up_requested: 'ae.audit.follow_up_requested',
  follow_up_created: 'ae.audit.follow_up_created',
  transmitted_to_mah: 'ae.audit.transmitted_to_mah',
  submitted_to_authority: 'ae.audit.submitted_to_authority',
  closed: 'ae.audit.closed',
  toggle_invalid: 'ae.audit.toggle_invalid',
  soft_deleted: 'ae.audit.soft_deleted',
} as const satisfies Record<string, TransKey>;

type T = (k: TransKey) => string;
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function caseAuditActionLabel(action: string, t: T): string {
  return has(CASE_AUDIT_ACTION_KEY, action) ? t(CASE_AUDIT_ACTION_KEY[action as keyof typeof CASE_AUDIT_ACTION_KEY]) : action;
}

const SERIOUSNESS_OVERRIDE_KEY = {
  serious: 'ae.console.forceSerious', non_serious: 'ae.console.forceNonSerious', auto: 'ae.console.useAuto',
} as const satisfies Record<string, TransKey>;

/**
 * detail 多半是自由文字（日期、個案編號、刪除理由），原樣顯示；
 * 只有確定是代碼的幾種動作才翻譯，且只翻已知值。
 */
export function caseAuditDetailLabel(action: string, detail: string | undefined, t: T, lang: 'zh' | 'en'): string {
  if (!detail) return '';
  switch (action) {
    case 'status':
      return (AE_CASE_STATUSES as readonly string[]).includes(detail) ? t(`ae.status.${detail}` as TransKey) : detail;
    case 'expectedness': {
      const o = EXPECTEDNESS_OPTIONS.find(x => x.value === detail);
      return o ? pickLabel(o, lang) : detail;
    }
    case 'causality': {
      const o = CAUSALITY_OPTIONS.find(x => x.value === detail);
      return o ? pickLabel(o, lang) : detail;
    }
    case 'seriousness_override':
      return has(SERIOUSNESS_OVERRIDE_KEY, detail) ? t(SERIOUSNESS_OVERRIDE_KEY[detail as keyof typeof SERIOUSNESS_OVERRIDE_KEY]) : detail;
    case 'significant_new_info':
      return detail === 'true' ? t('ae.audit.yes') : detail === 'false' ? t('ae.audit.no') : detail;
    default:
      return detail;
  }
}
