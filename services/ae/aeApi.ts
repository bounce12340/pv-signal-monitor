// AE 個案的資料通道（送出、讀取、更新、刪除）與附件處理。從 PV-Link 的 services/aeApi.ts 搬入。
//
// 一律走同源 Worker 的 /api/ae-reports（見 worker/index.ts、worker/ae/）。身分由瀏覽器自動帶上的
// Cloudflare Access cookie 決定，前端不持有任何憑證。
//
// 與 PV-Link 的差異：
//   • 沒有「本機模式」。PV-Link 以 VITE_AE_API_ENDPOINT 是否設定切換遠端／本機；本 repo 的 CI 部署
//     不帶這個變數，照搬會讓正式站靜默跑在本機模式——業務送出的個案只存在自己手機，畫面卻顯示已保存。
//   • 不送 X-PV-Token：這裡的 Worker 不檢查它，而且前端 bundle 不放任何憑證。
//
// 送出失敗（斷網、5xx、Access 登入逾時被轉址）一律進 outbox 佇列，恢復連線後由 flushOutbox 補送。
//
// ⚠️ 業務在外面跑客戶，訊號不穩是常態。「送出失敗就把資料丟掉」是這類表單最常見也最致命的缺陷，
//    所以送出路徑上的每一個失敗分支都必須落地到 outbox，不得只顯示錯誤訊息。

import type { AEReport } from './aeReport';
import { loadValue, saveValue, AE_OUTBOX_KEY } from './storage';

/** 收案 API 的集合端點（同源）。caseWork.ts 的內部工作 API 也掛在它底下。 */
export const AE_API_BASE = '/api/ae-reports';
const ME_ENDPOINT = '/api/me';

export type SubmitChannel = 'remote' | 'outbox' | 'outbox_conflict' | 'unconfirmed';

export interface SubmitResult {
  ok: boolean;
  channel: SubmitChannel;
  message?: string;
}

class ApiError extends Error {
  status: number;
  constructor(status: number) { super(`HTTP ${status}`); this.status = status; }
}

/**
 * 呼叫後端。credentials: 'same-origin' 是預設值，此處明寫以表明對 Access cookie 的依賴。
 * 非 2xx 一律拋 ApiError，讓呼叫端依 status 分流（409 衝突、其餘進 outbox）。
 */
async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new ApiError(res.status);
  return res;
}

const callApi = (path: string, init?: RequestInit) => request(`${AE_API_BASE}${path}`, init);

async function postRemote(report: AEReport): Promise<void> {
  const res = await callApi('', { method: 'POST', body: JSON.stringify(report) });
  const data = await res.json();
  if (!Number.isSafeInteger(data?.version) || data.version < 0) throw new Error('invalid server version');
  report.version = data.version;
}

async function enqueueOutbox(report: AEReport): Promise<void> {
  const queue = ((await loadValue<AEReport[]>(AE_OUTBOX_KEY)) || []).filter(r => r?.id !== report.id);
  queue.push(report);
  await saveValue(AE_OUTBOX_KEY, queue);
}

/** 送出一筆個案。任何失敗都會落到 outbox，回傳 channel 讓 UI 誠實告知使用者實際去向。 */
export async function submitAEReport(report: AEReport): Promise<SubmitResult> {
  try {
    await postRemote(report);
    return { ok: true, channel: 'remote' };
  } catch (e: any) {
    if (e?.status === 409) {
      try {
        await enqueueOutbox({ ...report, outboxConflict: true } as AEReport);
        return { ok: false, channel: 'outbox_conflict', message: '版本衝突；已保留草稿，需重新載入後處理' };
      } catch (e2: any) {
        return { ok: false, channel: 'unconfirmed', message: `衝突草稿無法保存：${e2?.message || String(e2)}` };
      }
    }
    try {
      await enqueueOutbox(report);
      return { ok: false, channel: 'outbox', message: e?.message || String(e) };
    } catch (e2: any) {
      // outbox 也寫不進去（儲存空間滿）：這是唯一真正會遺失資料的情況，必須讓使用者知道
      return { ok: false, channel: 'unconfirmed', message: `佇列寫入失敗：${e2?.message || String(e2)}` };
    }
  }
}

/**
 * 讀出所有個案（後端依角色過濾：rep 只看得到自己送的）。
 * 失敗時直接拋錯、不回空陣列——空清單會讓藥安人員以為沒有新個案。
 */
export async function listAECases(): Promise<AEReport[]> {
  const res = await callApi('');
  const data = await res.json();
  return Array.isArray(data?.cases) ? data.cases : [];
}

/**
 * 新增或更新個案（後台判定、追蹤報告建立都走這裡）。
 *
 * `create` 決定用哪個動詞：追蹤報告是在後台產生的**新**個案，後端還沒有這一筆，
 * PATCH 會回 404。反過來，更新既有個案不用 POST，是為了保留 PATCH 對「個案不存在
 * （例如已被別人軟刪除）」回 404 的守門作用——靜默建回一筆已刪除的個案更糟。
 */
export async function saveAECase(report: AEReport, opts: { create?: boolean } = {}): Promise<AEReport> {
  if (opts.create) {
    const saved = await callApi('', { method: 'POST', body: JSON.stringify(report) });
    return (await saved.json()).case || { ...report, version: 0 };
  }
  const saved = await callApi(`/${encodeURIComponent(report.id)}`, { method: 'PATCH', body: JSON.stringify(report) });
  return (await saved.json()).case || { ...report, version: Number(report.version || 0) + 1 };
}

/** 刪除個案。後端是**軟刪除**：個案從收件匣消失，但資料列與稽核軌跡都留著。 */
export async function deleteAECase(id: string, reason = ''): Promise<void> {
  await callApi(`/${encodeURIComponent(id)}?reason=${encodeURIComponent(reason)}`, { method: 'DELETE' });
}

// ── 身分與角色 ────────────────────────────────────────────────────────

export type AERole = 'rep' | 'pv';

/**
 * 通報者個人檔案：CIOMS 表格裡「誰通報的」那一段，對同一位業務每次都一樣。
 * 首次登入建檔一次，之後通報表單自動帶入，不必每次重打六個欄位。
 */
export interface AEProfile {
  displayName: string;
  employeeId: string;
  phone: string;
  contactEmail: string;
  org: string;
  territory: string;
}

export interface AEIdentity {
  email: string;
  role: AERole;
  profile: AEProfile;
  /** 姓名與電話是否都有——這兩項正是通報驗證對通報者的硬性要求 */
  profileComplete: boolean;
}

function toProfile(raw: any): AEProfile {
  return {
    displayName: String(raw?.displayName || ''),
    employeeId: String(raw?.employeeId || ''),
    phone: String(raw?.phone || ''),
    contactEmail: String(raw?.contactEmail || ''),
    org: String(raw?.org || ''),
    territory: String(raw?.territory || ''),
  };
}

/** 角色只認後端明確回的 'pv'；其餘（含缺欄位、拼錯）一律當 rep，寧可少給權限。 */
function toIdentity(data: any): AEIdentity {
  return {
    email: String(data?.email || ''),
    role: data?.role === 'pv' ? 'pv' : 'rep',
    profile: toProfile(data?.profile),
    profileComplete: Boolean(data?.profileComplete),
  };
}

/**
 * 取得目前登入者的身分、角色與個人檔案（向 `/api/me` 問）。
 *
 * ⚠️ 角色**只用來決定畫面顯示什麼**，個人檔案**只用來預先填好表格**。
 * 真正的守門在 Worker，而「誰送的」永遠取自 Access JWT——
 * 使用者把檔案裡的姓名改成同事的名字，也動不了稽核軌跡裡的身分。
 */
export async function fetchIdentity(): Promise<AEIdentity> {
  const res = await request(ME_ENDPOINT);
  return toIdentity(await res.json());
}

/** 儲存自己的個人檔案。後端只接受白名單欄位，角色改不了。 */
export async function saveProfile(profile: AEProfile): Promise<AEIdentity> {
  const res = await request(ME_ENDPOINT, {
    method: 'PUT',
    body: JSON.stringify({
      display_name: profile.displayName,
      employee_id: profile.employeeId,
      phone: profile.phone,
      contact_email: profile.contactEmail,
      org: profile.org,
      territory: profile.territory,
    }),
  });
  return toIdentity(await res.json());
}

/** 個人檔案 → 通報單裡的通報者欄位。表單第一步據此自動帶入。 */
export function profileToReporterFields(p: AEProfile) {
  return {
    reporterName: p.displayName,
    reporterEmployeeId: p.employeeId,
    reporterPhone: p.phone,
    reporterEmail: p.contactEmail,
    reporterOrg: p.org,
    reporterTerritory: p.territory,
  };
}

/** 附件的顯示來源：尚未上傳的是 dataURL，已上傳的是後端的附件網址；其餘一律不顯示。 */
export function attachmentSrc(a: { dataUrl?: string; url?: string }): string {
  const data = a?.dataUrl;
  if (data && /^data:image\/(?:jpeg|png);base64,/i.test(data)) return data;
  const url = a?.url || '';
  return /^\/api\/ae-reports\/[A-Za-z0-9_-]+\/attachments\/[A-Za-z0-9_-]+$/.test(url) ? url : '';
}

export async function outboxCount(): Promise<number> {
  return ((await loadValue<AEReport[]>(AE_OUTBOX_KEY)) || []).length;
}

/** 補送 outbox。逐筆送出，成功才移除；任何一筆失敗即停止並保留其餘，避免順序錯亂。 */
export async function flushOutbox(): Promise<{ sent: number; remaining: number; conflicts: number }> {
  const queue = (await loadValue<AEReport[]>(AE_OUTBOX_KEY)) || [];
  let sent = 0;
  while (queue.length) {
    const item = queue[0];
    if ((item as any).outboxConflict) break;
    try {
      await postRemote(item);
      queue.shift();
      sent++;
    } catch (e: any) {
      // Conflict is durable, visible state—not a transient transport failure.
      // Leave the payload untouched for reconciliation and stop ordered replay.
      if (e?.status === 409) (item as any).outboxConflict = true;
      break;
    }
  }
  await saveValue(AE_OUTBOX_KEY, queue);
  return { sent, remaining: queue.length, conflicts: queue.filter(item => (item as any).outboxConflict).length };
}

// ─────────────────────────────────────────────────────────────
// 附件：手機拍照壓縮
// ─────────────────────────────────────────────────────────────

export const MAX_ATTACHMENT_BYTES = 1_500_000;
export const MAX_ATTACHMENTS = 6;

/**
 * 手機直出照片動輒 4–8MB，直接塞進 IndexedDB 會拖垮送出與同步。
 * 這裡在瀏覽器端縮到長邊 maxEdge 並以 JPEG 重新編碼；藥盒批號、檢驗單數字在 1600px 下仍可辨讀。
 * 非圖片檔（PDF 等）原樣讀取，只做大小上限檢查。
 */
export function compressImage(file: File, maxEdge = 1600, quality = 0.72): Promise<{ dataUrl: string; size: number; mime: string }> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        if (file.size > MAX_ATTACHMENT_BYTES * 4) { reject(new Error('FILE_TOO_LARGE')); return; }
        resolve({ dataUrl, size: file.size, mime: file.type || 'application/octet-stream' });
      };
      reader.onerror = () => reject(reader.error || new Error('READ_FAILED'));
      reader.readAsDataURL(file);
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('CANVAS_UNAVAILABLE')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      // 仍過大時再降一階畫質，避免單張照片就吃掉整個儲存配額
      if (dataUrl.length * 0.75 > MAX_ATTACHMENT_BYTES) {
        dataUrl = canvas.toDataURL('image/jpeg', 0.5);
      }
      resolve({ dataUrl, size: Math.round(dataUrl.length * 0.75), mime: 'image/jpeg' });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('DECODE_FAILED')); };
    img.src = url;
  });
}
