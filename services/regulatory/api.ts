// 主管機關安全性公告的資料通道（同源 Worker 的 /api/reg-alerts，見 worker/regfeeds/）。
// 身分由瀏覽器帶上的 Cloudflare Access cookie 決定；核閱者、成分清單修改者都由伺服器
// 從已驗證的 JWT 取得，前端不送也不能送身分。

export const REG_API = '/api/reg-alerts';

export type ReviewStatus = 'not_relevant' | 'assessed' | 'action';

export interface RegReview { status: ReviewStatus; note: string; actor: string; at: string }

export interface RegAlert {
  id: string;
  source: string;
  title: string;
  url: string;
  /** 主管機關標示的日期（YYYY-MM-DD），沒有則 null。 */
  published: string | null;
  summary: string;
  substances: string;
  /** 本系統第一次取得這則公告的時間（ISO 8601）。 */
  first_seen: string;
  review: RegReview | null;
}

export interface RegSourceStatus {
  id: string;
  name: string;
  country: string;
  homepage: string;
  note: string;
  last_attempt: string | null;
  last_success: string | null;
  last_error: string | null;
  last_count: number | null;
}

export interface WatchItem { ingredient: string; synonyms: string[] }

export interface Watchlist { items: WatchItem[]; updated_by: string | null; updated_at: string | null }

export interface RegAlertsData {
  since: string;
  sources: RegSourceStatus[];
  uncovered: { country: string; name: string; reason: string }[];
  alerts: RegAlert[];
  watchlist: Watchlist;
}

export interface RefreshResult { source: string; ok: boolean; count: number; error?: string }

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${REG_API}${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON (e.g. an Access login redirect) */ }
  if (!res.ok) {
    const reason = body?.error || (res.status === 403 ? '需要 PV 權限' : `HTTP ${res.status}`);
    throw new Error(reason);
  }
  if (body === null) throw new Error('伺服器回應不是 JSON（可能是登入逾時，請重新整理）');
  return body as T;
}

export const loadRegAlerts = (days: number) => call<RegAlertsData>(`?days=${encodeURIComponent(days)}`);

export const saveReview = (alertId: string, status: ReviewStatus, note: string) =>
  call<{ review: RegReview }>('/review', { method: 'POST', body: JSON.stringify({ alertId, status, note }) }).then((r) => r.review);

export const saveWatchlist = (items: WatchItem[]) =>
  call<{ watchlist: Watchlist }>('/watchlist', { method: 'PUT', body: JSON.stringify({ items }) }).then((r) => r.watchlist);

export const refreshRegSource = (source: string) =>
  call<RefreshResult>('/refresh', { method: 'POST', body: JSON.stringify({ source }) });
