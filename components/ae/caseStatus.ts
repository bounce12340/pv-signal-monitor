// 個案狀態 → 徽章語意色。後台收案匣與業務端「我的通報紀錄」共用這一份。
//
// 原本後台有完整對照表，業務端卻把所有狀態寫死成 brand：同一件「待補件」在後台
// 是 caution（需要有人去追），在業務手機上卻跟「收案中」一樣是藍紫色——而待補件
// 正是業務最需要注意到的狀態，因為補件通常要他回頭去問醫師或藥師。
import type { AECaseStatus } from '../../services/ae/aeReport';
import type { Tone } from './ui';

export const CASE_STATUS_TONE: Record<AECaseStatus, Tone> = {
  draft: 'neutral', submitted: 'brand', triage: 'brand', follow_up: 'caution',
  coded: 'brand', ready: 'success', reported: 'success', closed: 'neutral', invalid: 'danger',
};

/** 伺服器回傳未知狀態時退回 neutral，不臆測語意。 */
export const caseStatusTone = (status: string): Tone =>
  Object.prototype.hasOwnProperty.call(CASE_STATUS_TONE, status) ? CASE_STATUS_TONE[status as AECaseStatus] : 'neutral';
