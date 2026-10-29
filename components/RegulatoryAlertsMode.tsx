import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Landmark, RefreshCw, XCircle } from 'lucide-react';
import {
  RegAlert, RegAlertsData, RegSourceStatus, ReviewStatus,
  loadRegAlerts, refreshRegSource, saveReview, saveWatchlist,
} from '../services/regulatory/api';
import { formatWatchlistText, matchAlert, mentionsSuspension, parseWatchlistText } from '../services/regulatory/match';

// 主管機關安全性公告：Worker 每小時輪流抓官方來源（worker/regfeeds/），這頁依監測成分比對、
// 讓 PV 人員逐筆核閱。核閱者與時間由伺服器從 Access JWT 記錄，只能新增不能改。

const COUNTRY: Record<string, string> = {
  US: '美國', GB: '英國', EU: '歐盟', JP: '日本', DE: '德國', FR: '法國', TW: '台灣',
  CH: '瑞士', CA: '加拿大', AU: '澳洲', BE: '比利時', SE: '瑞典',
};

const REVIEW: Record<ReviewStatus, { label: string; cls: string }> = {
  not_relevant: { label: '不相關', cls: 'bg-slate-100 text-slate-700' },
  assessed: { label: '已評估', cls: 'bg-green-100 text-green-800' },
  action: { label: '需後續行動', cls: 'bg-rose-100 text-rose-800' },
};

const STALE_MS = 24 * 3_600_000;

const fmt = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Feed links are third-party input; only http(s) ever becomes an href.
const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : undefined);

function sourceHealth(s: RegSourceStatus, now: number): { label: string; cls: string } {
  if (!s.last_success) return { label: s.last_error ? '抓取失敗' : '尚未抓取', cls: 'text-rose-700' };
  if (s.last_error) return { label: '最近一次失敗', cls: 'text-rose-700' };
  if (now - Date.parse(s.last_success) > STALE_MS) return { label: '逾 24 小時未更新', cls: 'text-amber-700' };
  return { label: '正常', cls: 'text-green-700' };
}

export const RegulatoryAlertsMode: React.FC = () => {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<RegAlertsData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<'matched' | 'all'>('matched');
  const [openOnly, setOpenOnly] = useState(true);
  const [watchText, setWatchText] = useState<string | null>(null); // non-null while editing
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await loadRegAlerts(days));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const watchlist = useMemo(() => data?.watchlist.items ?? [], [data]);
  const sourceName = useMemo(() => new Map((data?.sources ?? []).map((s) => [s.id, s])), [data]);

  const rows = useMemo(() => (data?.alerts ?? []).map((a) => ({
    alert: a,
    matched: matchAlert(a, watchlist),
    suspension: mentionsSuspension(a),
  })), [data, watchlist]);

  const visible = rows.filter((r) =>
    (scope === 'all' || watchlist.length === 0 || r.matched.length > 0) && (!openOnly || !r.alert.review));
  const openMatched = rows.filter((r) => r.matched.length > 0 && !r.alert.review).length;

  const review = async (a: RegAlert, status: ReviewStatus) => {
    setBusy(a.id);
    setMessage('');
    try {
      const saved = await saveReview(a.id, status, notes[a.id] ?? a.review?.note ?? '');
      setData((d) => d && { ...d, alerts: d.alerts.map((x) => (x.id === a.id ? { ...x, review: saved } : x)) });
    } catch (e) {
      setMessage(`核閱未儲存：${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const saveWatch = async () => {
    if (watchText === null) return;
    setBusy('watchlist');
    setMessage('');
    try {
      const saved = await saveWatchlist(parseWatchlistText(watchText));
      setData((d) => d && { ...d, watchlist: saved });
      setWatchText(null);
    } catch (e) {
      setMessage(`監測成分未儲存：${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const refresh = async (s: RegSourceStatus) => {
    setBusy(`refresh:${s.id}`);
    setMessage('');
    try {
      const r = await refreshRegSource(s.id);
      setMessage(r.ok ? `${s.name}：取得 ${r.count} 筆` : `${s.name} 抓取失敗：${r.error}`);
      await load();
    } catch (e) {
      setMessage(`${s.name}：${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const now = Date.now();

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Landmark size={22} className="text-primary" aria-hidden="true" /> 主管機關安全性公告
        </h2>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          系統每小時輪流抓取下列官方來源，存到伺服器後由 PV 人員逐筆核閱。依《藥品安全監視管理辦法》第 6 條第 1 項第 3 款，
          十大醫藥先進國家因不良反應暫停使用或下市者，應自知悉之日起三日內通報；「系統取得」時間即本系統可得知的時間。
          本頁不能取代 SOP 中的人工監視：未涵蓋的國家與抓取失敗的來源，仍須人工查看。
        </p>
        {message && <p role="status" className="mt-3 text-sm text-slate-800 bg-slate-100 rounded px-3 py-2">{message}</p>}
        {error && (
          <p role="alert" className="mt-3 text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded px-3 py-2">
            無法載入：{error}
          </p>
        )}
      </div>

      {data && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          <h3 className="font-bold text-slate-900 mb-3">來源狀態</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="source-table">
              <thead className="text-left text-slate-600 border-b border-slate-200">
                <tr><th className="py-2 pr-3">來源</th><th className="pr-3">國家</th><th className="pr-3">狀態</th><th className="pr-3">最後成功</th><th className="pr-3">筆數</th><th /></tr>
              </thead>
              <tbody>
                {data.sources.map((s) => {
                  const h = sourceHealth(s, now);
                  return (
                    <tr key={s.id} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-3">
                        <a href={safeHref(s.homepage)} target="_blank" rel="noopener noreferrer" className="font-medium text-slate-900 hover:underline">{s.name}</a>
                        <div className="text-xs text-slate-600">{s.note}</div>
                        {s.last_error && <div className="text-xs text-rose-700 mt-1">錯誤：{s.last_error}</div>}
                      </td>
                      <td className="pr-3 whitespace-nowrap">{COUNTRY[s.country] ?? s.country}</td>
                      <td className={`pr-3 whitespace-nowrap font-medium ${h.cls}`}>{h.label}</td>
                      <td className="pr-3 whitespace-nowrap text-slate-700">{fmt(s.last_success)}</td>
                      <td className="pr-3 text-slate-700">{s.last_count ?? '—'}</td>
                      <td className="text-right">
                        <button
                          onClick={() => refresh(s)}
                          disabled={busy !== null}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          aria-label={`立即更新 ${s.name}`}
                        >
                          <RefreshCw size={12} aria-hidden="true" className={busy === `refresh:${s.id}` ? 'animate-spin' : ''} /> 立即更新
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 text-sm bg-amber-50 border border-amber-200 rounded p-3 text-amber-900">
            <p className="font-medium">第 6 條十國中，以下未自動監測，須人工查看：</p>
            <ul className="mt-1 list-disc pl-5 space-y-0.5">
              {data.uncovered.map((u) => <li key={u.country}><span className="font-medium">{u.name}</span>：{u.reason}</li>)}
            </ul>
          </div>
        </div>
      )}

      {data && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold text-slate-900">監測成分（{watchlist.length}）</h3>
            {watchText === null && (
              <button onClick={() => setWatchText(formatWatchlistText(watchlist))} className="px-3 py-1.5 text-sm rounded border border-slate-300 text-slate-700 hover:bg-slate-50">
                編輯監測成分
              </button>
            )}
          </div>
          {watchText === null ? (
            <>
              {watchlist.length === 0
                ? <p className="mt-2 text-sm text-amber-800">尚未設定監測成分，下方列出全部公告。</p>
                : (
                  <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                    {watchlist.map((w) => (
                      <li key={w.ingredient} className="px-2 py-1 rounded bg-slate-100 text-slate-800">
                        {w.ingredient}{w.synonyms.length > 0 && <span className="text-slate-600">（{w.synonyms.join('、')}）</span>}
                      </li>
                    ))}
                  </ul>
                )}
              {data.watchlist.updated_by && (
                <p className="mt-2 text-xs text-slate-600">最後修改：{data.watchlist.updated_by}，{fmt(data.watchlist.updated_at)}</p>
              )}
            </>
          ) : (
            <div className="mt-3 space-y-2">
              <label htmlFor="watchlist-text" className="block text-sm text-slate-700">
                每行一個成分；同義詞放在「|」後面，用逗號或頓號分隔。各國公告用當地語言，請加上德文、法文拼法、日文片假名與中文名，以及鹽類或相關化合物。
              </label>
              <textarea
                id="watchlist-text"
                value={watchText}
                onChange={(e) => setWatchText(e.target.value)}
                rows={8}
                className="w-full border border-slate-300 rounded p-2 font-mono text-sm"
                placeholder={'theophylline | theophyllin, théophylline, aminophylline, テオフィリン, 茶鹼\npravastatin | pravastatine, プラバスタチン'}
              />
              <div className="flex gap-2">
                <button onClick={saveWatch} disabled={busy !== null} className="px-3 py-1.5 text-sm rounded bg-primary text-white hover:bg-primary-hover disabled:opacity-50">儲存監測成分</button>
                <button onClick={() => setWatchText(null)} className="px-3 py-1.5 text-sm rounded border border-slate-300 text-slate-700">取消</button>
              </div>
            </div>
          )}
        </div>
      )}

      {data && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
            <h3 className="font-bold text-slate-900 mr-auto">
              公告（符合成分且未核閱 <span data-testid="open-matched">{openMatched}</span> 筆）
            </h3>
            <label className="flex items-center gap-1 text-slate-700">
              範圍
              <select value={scope} onChange={(e) => setScope(e.target.value as 'matched' | 'all')} className="border border-slate-300 rounded px-2 py-1">
                <option value="matched">符合監測成分</option>
                <option value="all">全部</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-slate-700">
              <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> 只看未核閱
            </label>
            <label className="flex items-center gap-1 text-slate-700">
              期間
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="border border-slate-300 rounded px-2 py-1">
                {[30, 90, 180, 365, 730].map((d) => <option key={d} value={d}>近 {d} 天</option>)}
              </select>
            </label>
            <button onClick={load} disabled={loading} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw size={14} aria-hidden="true" className={loading ? 'animate-spin' : ''} /> 重新載入
            </button>
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-slate-600 py-6 text-center">
              {rows.length === 0 ? '這段期間還沒有抓到公告。' : '沒有符合條件的公告。'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100" data-testid="alert-list">
              {visible.map(({ alert: a, matched, suspension }) => {
                const src = sourceName.get(a.source);
                return (
                  <li key={a.id} className="py-4" data-alert-id={a.id}>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span className="font-medium text-slate-800">{a.published ?? '日期未標示'}</span>
                      <span>{src ? `${COUNTRY[src.country] ?? src.country}・${src.name}` : a.source}</span>
                      <span>系統取得 {fmt(a.first_seen)}</span>
                    </div>
                    <a href={safeHref(a.url)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-start gap-1 font-medium text-slate-900 hover:underline">
                      {a.title} <ExternalLink size={14} className="mt-1 shrink-0" aria-hidden="true" />
                    </a>
                    {a.summary && <p className="text-sm text-slate-700 mt-1">{a.summary}</p>}
                    <div className="flex flex-wrap gap-2 mt-2">
                      {matched.map((m) => <span key={m} className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">{m}</span>)}
                      {suspension && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-900">
                          <AlertTriangle size={12} aria-hidden="true" /> 含暫停／下市字樣：請評估是否須依第 6 條三日內通報
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {a.review ? (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${REVIEW[a.review.status]?.cls ?? ''}`}>
                          <CheckCircle2 size={12} aria-hidden="true" /> {REVIEW[a.review.status]?.label ?? a.review.status}
                          <span className="font-normal">・{a.review.actor}・{fmt(a.review.at)}{a.review.note && `・${a.review.note}`}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                          <XCircle size={12} aria-hidden="true" /> 未核閱
                        </span>
                      )}
                      <input
                        type="text"
                        value={notes[a.id] ?? a.review?.note ?? ''}
                        onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                        placeholder="核閱說明（「需後續行動」必填）"
                        aria-label={`核閱說明：${a.title}`}
                        className="flex-1 min-w-[12rem] border border-slate-300 rounded px-2 py-1 text-sm"
                      />
                      {(Object.keys(REVIEW) as ReviewStatus[]).map((st) => (
                        <button
                          key={st}
                          onClick={() => review(a, st)}
                          disabled={busy !== null}
                          aria-pressed={a.review?.status === st}
                          className="px-2 py-1 text-xs rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {REVIEW[st].label}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
