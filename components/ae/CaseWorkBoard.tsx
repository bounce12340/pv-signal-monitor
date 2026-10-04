// PV 內部工作台：個案的工作狀態、負責人、內部到期日、補件與聯絡紀錄。
//
// 版面原則（這個元件是藥安人員每天要看的畫面）：
//   • 一列一個個案，欄位對齊閱讀。原本每個個案是一顆按鈕，文字是
//     「AE-0012 · 進行中 · alice · 2026-10-01 · 逾期」這種五段串接，
//     得逐字解析才知道哪段是什麼；改成有表頭的表格，讀屏也能對應欄名。
//   • 一個畫面只有一個主要動作（儲存工作）。原本所有按鈕共用同一個實心
//     indigo 樣式——範圍切換、重新整理、每一列個案、新增補件、儲存全長得
//     一樣，看不出哪個會改資料。
//   • 內部工作逾期用 caution，不用 danger。後台左側的法規時鐘用 danger 表示
//     「法定期限已過」，那是會被裁罰的事；內部工作逾期是提醒，不是法規
//     違規。兩者用同一個紅色，等於在同一個畫面上把「該注意」和「已違規」
//     畫成一樣——藥安人員會分不清是哪一個時鐘過期了。danger 只留給法規與錯誤。
//   • 所有時間都以產品工作時區 Asia/Taipei 顯示，與到期判定一致。
//
// 從 PV-Link 搬入。與原版的差異：拿掉本機試用模式；新增 openRequest，讓個案頁的「內部工作」
// 按鈕能直接打開某個個案的工作編輯器（原本只能從工作台列表打開，而工作台只列出已有工作、
// 且到期日在範圍內的個案——新個案因此永遠建不了第一筆工作）。
import React, { useEffect, useId, useRef, useState } from 'react';
import { RefreshCw as ArrowPathIcon, Plus as PlusIcon } from 'lucide-react';
import type { AEReport } from '../../services/ae/aeReport';
import {
  CaseWork, WorkInput, WorkResult, getCaseWork, saveCaseWork, workUsers, getWorkbench,
  getNotifications, readNotifications, Workbench, InAppNotification, formatTaipeiDateTime,
} from '../../services/ae/caseWork';
import { useT } from '../../i18n/LangContext';
import type { TransKey } from '../../i18n/translations';
import { Field, TextInput, TextArea, SelectInput, Badge, Tone } from './ui';

// 選項與翻譯鍵的對照表用 `satisfies Record<…, TransKey>` 寫死，讓 TypeScript
// 檢查每個鍵都存在。原本是 t(`work.${s}`) 動態組字串，型別系統看不到——
// 補件狀態的 'cancelled' 就因此對應到一個不存在的鍵，畫面上直接印出
// 「work.cancelled」字樣，一直沒被發現。
const SCOPES = ['today', 'week', 'overdue'] as const;
type Scope = typeof SCOPES[number];
const SCOPE_KEY = { today: 'work.today', week: 'work.week', overdue: 'work.overdue' } as const satisfies Record<Scope, TransKey>;

const WORK_STATUSES = ['todo', 'in-progress', 'waiting', 'completed', 'cancelled'] as const;
type Status = typeof WORK_STATUSES[number];
const STATUS_KEY = {
  todo: 'work.status.todo', 'in-progress': 'work.status.in-progress', waiting: 'work.status.waiting',
  completed: 'work.status.completed', cancelled: 'work.status.cancelled',
} as const satisfies Record<Status, TransKey>;
// waiting 用 caution：卡在外部回覆、需要有人去追，是「該注意」而不是「出事了」。
const STATUS_TONE = { todo: 'neutral', 'in-progress': 'brand', waiting: 'caution', completed: 'success', cancelled: 'neutral' } as const satisfies Record<Status, Tone>;

const ITEM_STATUSES = ['pending', 'received', 'cancelled'] as const;
const ITEM_STATUS_KEY = { pending: 'work.pending', received: 'work.received', cancelled: 'work.cancelled' } as const satisfies Record<typeof ITEM_STATUSES[number], TransKey>;

const METHODS = ['phone', 'email', 'visit', 'other'] as const;
const METHOD_KEY = { phone: 'work.phone', email: 'work.email', visit: 'work.visit', other: 'work.other' } as const satisfies Record<typeof METHODS[number], TransKey>;

// 對應 caseWorkModel.transitionFor 產生的四種稽核動作。未知代碼照原文顯示：
// 稽核紀錄寧可露出原始代碼，也不能被翻成一個看似合理但錯的字。
const AUDIT_ACTION_KEY = {
  work_saved: 'work.action.work_saved', work_completed: 'work.action.work_completed',
  work_cancelled: 'work.action.work_cancelled', work_reopened: 'work.action.work_reopened',
} as const satisfies Record<string, TransKey>;
const auditActionLabel = (code: string, t: (k: TransKey) => string) =>
  Object.prototype.hasOwnProperty.call(AUDIT_ACTION_KEY, code) ? t(AUDIT_ACTION_KEY[code as keyof typeof AUDIT_ACTION_KEY]) : code;

const isStatus = (s: string): s is Status => (WORK_STATUSES as readonly string[]).includes(s);

const btnBase = 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:cursor-not-allowed';
const btnPrimary = `${btnBase} bg-brand-600 text-white hover:bg-brand-700 aria-disabled:hover:bg-brand-600`;
const btnGhost = `${btnBase} border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800`;
const segBase = 'min-h-[44px] px-4 rounded-lg text-sm font-bold';
// 選取狀態必須一眼看得出來：原本選取與未選取共用同一個 class，aria-pressed
// 正確但畫面上完全分不出目前在看哪個範圍。
const segOn = `${segBase} bg-brand-600 text-white`;
const segOff = `${segBase} text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700`;

type MessageTone = 'info' | 'success' | 'error';
const MESSAGE_TONE: Record<MessageTone, string> = {
  info: 'bg-caution-50 text-caution-900 border-caution-300 dark:bg-caution-500/10 dark:text-caution-200 dark:border-caution-500/40',
  success: 'bg-success-50 text-success-900 border-success-300 dark:bg-success-500/10 dark:text-success-200 dark:border-success-500/40',
  error: 'bg-danger-50 text-danger-900 border-danger-300 dark:bg-danger-500/10 dark:text-danger-200 dark:border-danger-500/40',
};

const taipeiToday = () => { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const get = (type: string) => parts.find(part => part.type === type)?.value; return `${get('year')}-${get('month')}-${get('day')}`; };

/** 外部要求打開某個個案的工作編輯器。seq 每次遞增，同一個個案按第二次也會再觸發。 */
export type WorkOpenRequest = { caseId: string; seq: number };

export default function CaseWorkBoard({ cases, openRequest }: { cases: AEReport[]; openRequest?: WorkOpenRequest }) {
  const t = useT();
  const uid = useId();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [records, setRecords] = useState<Record<string, WorkResult>>({}), [users, setUsers] = useState<string[]>([]), [board, setBoard] = useState<Workbench | null>(null), [scope, setScope] = useState<Scope>('today');
  const [notifications, setNotifications] = useState<InAppNotification[]>([]), [id, setId] = useState(''), [draft, setDraft] = useState<CaseWork | null>(null), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState(''), [tone, setTone] = useState<MessageTone>('info');

  const say = (text: string, nextTone: MessageTone = 'info') => { setMessage(text); setTone(nextTone); };
  const error = (e: any) => say(t(e.message === 'WORK_CONFLICT' ? 'work.conflict' : e.message === 'INVALID_WORK' || e.message === 'INVALID_CANCEL_REASON' || e.message === 'INVALID_TRANSITION' ? 'work.invalid' : 'work.error'), 'error');

  // keepMessage：儲存成功後會接著重新整理工作台。原本 refresh 成功時一律清空訊息，
  // 「已儲存」才剛設定就被清掉，使用者與讀屏都收不到儲存成功的確認。
  const refresh = async (nextScope = scope, { keepMessage = false } = {}) => { setBusy(true); try { const [options, b, n] = await Promise.all([workUsers(), getWorkbench(nextScope), getNotifications()]); setBoard(b); setNotifications(n.notifications); setUsers(options); setLoaded(true); if (!keepMessage) setMessage(''); } catch (e) { error(e); } finally { setBusy(false); } };
  useEffect(() => { refresh(); }, [scope]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  const edit = (patch: Partial<CaseWork>) => { setDraft({ ...draft!, ...patch }); setDirty(true); setMessage(''); };
  const open = async (next: string) => { if (dirty) { say(t('work.dirty')); return; } setBusy(true); try { const result = await getCaseWork(next); setRecords(v => ({ ...v, [next]: result })); setId(next); setDraft(structuredClone(result.work)); setMessage(''); } catch (e) { error(e); } finally { setBusy(false); } };
  const save = async () => { if (!draft) return; setBusy(true); try { const result = await saveCaseWork(id, draft as WorkInput); setRecords(v => ({ ...v, [id]: result })); setDraft(result.work); setDirty(false); say(t('work.saved'), 'success'); await refresh(scope, { keepMessage: true }); } catch (e) { error(e); } finally { setBusy(false); } };
  // 個案頁的「內部工作」：展開工作台、打開該個案的編輯器、捲到眼前。沒有工作紀錄的個案，
  // Worker 會回一份空白工作（version 0），存下去就是它的第一筆。
  useEffect(() => {
    if (!openRequest) return;
    if (detailsRef.current) detailsRef.current.open = true;
    open(openRequest.caseId).then(() => detailsRef.current?.scrollIntoView?.({ block: 'start' }));
  }, [openRequest?.seq]);
  const markRead = async () => { const ids = notifications.filter(n => !n.readAt).map(n => n.id); if (!ids.length) return; setBusy(true); try { await readNotifications(ids); setNotifications(v => v.map(n => ids.includes(n.id) ? { ...n, readAt: new Date().toISOString() } : n)); } catch (e) { error(e); } finally { setBusy(false); } };
  const displayed = board?.items || [];
  const unread = notifications.filter(n => !n.readAt).length;

  const statusLabel = (s: string) => { const v = s || 'todo'; return isStatus(v) ? t(STATUS_KEY[v]) : v; };
  const statusTone = (s: string) => { const v = s || 'todo'; return isStatus(v) ? STATUS_TONE[v] : 'neutral'; };
  // 編輯區標題顯示人看得懂的個案編號，而不是內部 id。
  const openCaseNumber = displayed.find((w: any) => w.caseId === id)?.caseNumber ?? cases.find(c => c.id === id)?.caseNumber ?? id;
  const audit = records[id]?.audit ?? [];
  const canSave = !!draft && !busy && dirty && !(draft.status === 'cancelled' && !draft.cancelReason?.trim());

  return (
    // 自帶文字色：表單控制項經 Tailwind preflight 是 color: inherit，若只靠 App 外層的
    // dark:text-slate-100，換個容器掛載時暗色下輸入值與標題會變成深字配深底。
    <details ref={detailsRef} className="m-3 rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/60 text-slate-900 dark:text-slate-100">
      <summary className="flex items-center gap-3 cursor-pointer px-4 py-3 text-sm font-bold text-slate-900 dark:text-slate-100">
        <span>{t('work.title')}</span>
        {unread > 0 && <Badge tone="brand">{unread} {t('work.unread')}</Badge>}
      </summary>

      <div className="px-4 pb-4 space-y-4">
        <p className="text-xs text-muted leading-relaxed">{t('work.note')}</p>

        {/* 這個區域必須一直存在（即使是空的）：live region 要先在 DOM 裡，內容變動時讀屏才會宣告。 */}
        <div role="status" aria-live="polite"
          className={message ? `text-sm font-bold leading-relaxed px-3 py-2 rounded-xl border ${MESSAGE_TONE[tone]}` : ''}>
          {message}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
            {SCOPES.map(s => (
              <button key={s} type="button" aria-pressed={scope === s} className={scope === s ? segOn : segOff}
                onClick={() => { if (!dirty) setScope(s); else say(t('work.dirty')); }}>
                {t(SCOPE_KEY[s])}
              </button>
            ))}
          </div>
          <button type="button" disabled={busy} className={btnGhost} onClick={() => refresh()}>
            <ArrowPathIcon className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />{t('work.reload')}
          </button>
        </div>

        {board && (
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
            <div className="flex gap-1.5"><dt>{t('work.timezone')}</dt><dd className="font-bold text-slate-700 dark:text-slate-200">{board.timezone}</dd></div>
            <div className="flex gap-1.5"><dt>{t(SCOPE_KEY[scope])}</dt><dd className="font-bold text-slate-700 dark:text-slate-200 tabular-nums">{board.from} – {board.to}</dd></div>
            {scope !== 'week' && <div className="flex gap-1.5"><dt>{t('work.week')}</dt><dd className="tabular-nums">{board.weekStart} – {board.weekEnd}</dd></div>}
          </dl>
        )}

        {!loaded
          ? <p role="status" className="text-sm text-muted py-4">{t('work.loading')}</p>
          : displayed.length === 0
            ? <p className="text-sm text-muted py-6 text-center">{t('work.empty')}</p>
            : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted border-b-2 border-slate-200 dark:border-slate-700">
                      <th scope="col" className="py-2 pr-4 font-bold">{t('ae.done.caseNo')}</th>
                      <th scope="col" className="py-2 pr-4 font-bold">{t('work.status')}</th>
                      <th scope="col" className="py-2 pr-4 font-bold">{t('work.owner')}</th>
                      <th scope="col" className="py-2 font-bold">{t('work.due')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayed.map((w: any) => {
                      const current = w.caseId === id;
                      return (
                        // 整列可點：個案編號的按鈕用 after: 偽元素撐滿整列。只有一顆真的按鈕，
                        // 讀屏與鍵盤看到的仍是「個案編號」這一個可操作元素，不會整列重複唸。
                        <tr key={w.caseId} className={`relative border-b border-slate-100 dark:border-slate-800 ${current ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}>
                          <td className="py-2.5 pr-4">
                            <button type="button" disabled={busy} aria-current={current ? 'true' : undefined} onClick={() => open(w.caseId)}
                              className="font-black tabular-nums whitespace-nowrap text-left text-brand-700 dark:text-brand-300 after:absolute after:inset-0">
                              {w.caseNumber}
                            </button>
                          </td>
                          <td className="py-2.5 pr-4"><Badge tone={statusTone(w.status)}>{statusLabel(w.status)}</Badge></td>
                          {/* 未分派是待處理狀態，不是可忽略的灰字。slate-500 在白底 4.7:1，但在選取列的 brand-50 上只剩 4.3:1，
                              未過 WCAG 1.4.3，所以用 slate-600。 */}
                          <td className={`py-2.5 pr-4 ${w.assignee ? 'text-slate-700 dark:text-slate-200' : 'text-muted'}`}>
                            {w.assignee || t('work.unassigned')}
                          </td>
                          <td className="py-2.5 tabular-nums whitespace-nowrap">
                            {w.workDueDate
                              ? <span className={w.overdue ? 'font-bold text-caution-800 dark:text-caution-300' : 'text-slate-700 dark:text-slate-200'}>{w.workDueDate}</span>
                              : <span className="text-muted">—</span>}
                            {w.overdue && <span className="ml-2"><Badge tone="caution">{t('work.overdue')}</Badge></span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

        <section aria-labelledby={`${uid}-notif`} className="rounded-xl border-2 border-slate-200 dark:border-slate-700 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id={`${uid}-notif`} className="text-sm font-bold flex items-center gap-2">
              {t('work.notifications')}
              {unread > 0 && <Badge tone="brand">{unread} {t('work.unread')}</Badge>}
            </h3>
            {notifications.length > 0 && (
              <button type="button" className={btnGhost} disabled={busy || !unread} onClick={markRead}>{t('work.markRead')}</button>
            )}
          </div>
          <p className="text-xs text-muted">{t('work.refreshOnly')}</p>
          {notifications.length > 0 && (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {notifications.slice(0, 10).map(n => (
                <li key={n.id} className={`flex items-center justify-between gap-3 py-2 text-sm ${n.readAt ? 'text-muted' : 'font-bold text-slate-900 dark:text-slate-100'}`}>
                  <span>{n.kind === 'work_due' ? t('work.dueNotice') : t('work.assignedNotice')}</span>
                  <span className="shrink-0 flex items-center gap-2 text-xs tabular-nums">
                    {formatTaipeiDateTime(n.createdAt)}
                    {n.readAt && <Badge tone="neutral">{t('work.read')}</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {draft && (
          <div className="border-t-2 border-slate-200 dark:border-slate-700 pt-4 space-y-5">
            <fieldset disabled={busy} aria-busy={busy} className="space-y-5 min-w-0">
              {/* legend 給整個編輯區一個可讀的名稱；float + w-full 讓它脫離 fieldset 邊框、當一般標題排版。 */}
              <legend className="float-left w-full flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1">
                <span className="text-base font-black tabular-nums">{openCaseNumber}</span>
                <span className="text-xs text-muted tabular-nums">v{draft.version}</span>
                {dirty && <Badge tone="caution">{t('work.unsaved')}</Badge>}
              </legend>
              <p className="clear-left text-xs text-muted leading-relaxed">{t('work.statusSeparate')}</p>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t('work.status')}>
                  <SelectInput value={draft.status} onChange={e => edit({ status: e.target.value as CaseWork['status'] })}>
                    {WORK_STATUSES.map(s => <option key={s} value={s}>{t(STATUS_KEY[s])}</option>)}
                  </SelectInput>
                </Field>
                <Field label={t('work.owner')}>
                  <SelectInput value={draft.assignee} onChange={e => edit({ assignee: e.target.value })}>
                    <option value="">{t('work.unassigned')}</option>
                    {[...new Set([...users, ...(draft.assignee ? [draft.assignee] : [])])].map(u => <option key={u}>{u}</option>)}
                  </SelectInput>
                </Field>
                <Field label={t('work.due')}>
                  <TextInput type="date" value={draft.workDueDate} onChange={e => edit({ workDueDate: e.target.value })} />
                </Field>
              </div>

              {draft.status === 'cancelled' && (
                <Field label={t('work.cancelReason')} required>
                  <TextArea required maxLength={500} rows={2} value={draft.cancelReason || ''} onChange={e => edit({ cancelReason: e.target.value })} />
                </Field>
              )}

              <Field label={t('work.next')}>
                <TextArea maxLength={1000} rows={2} value={draft.nextAction} onChange={e => edit({ nextAction: e.target.value })} />
              </Field>

              <section aria-labelledby={`${uid}-items`} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h4 id={`${uid}-items`} className="text-sm font-bold">{t('work.items')}</h4>
                  <button type="button" className={btnGhost} disabled={draft.items.length >= 50}
                    onClick={() => edit({ items: [...draft.items, { id: crypto.randomUUID(), title: '', status: 'pending' }] })}>
                    <PlusIcon className="w-4 h-4" />{t('work.addItem')}
                  </button>
                </div>
                {draft.items.map((item, i) => (
                  <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_10rem] gap-2">
                    <TextInput aria-label={`${t('work.itemTitle')} ${i + 1}`} maxLength={300} value={item.title}
                      onChange={e => edit({ items: draft.items.map((v, j) => j === i ? { ...v, title: e.target.value } : v) })} />
                    <SelectInput aria-label={`${t('work.itemStatus')} ${i + 1}`} value={item.status}
                      onChange={e => edit({ items: draft.items.map((v, j) => j === i ? { ...v, status: e.target.value } : v) })}>
                      {ITEM_STATUSES.map(s => <option key={s} value={s}>{t(ITEM_STATUS_KEY[s])}</option>)}
                    </SelectInput>
                  </div>
                ))}
              </section>

              <section aria-labelledby={`${uid}-contacts`} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h4 id={`${uid}-contacts`} className="text-sm font-bold">{t('work.contacts')}</h4>
                  <button type="button" className={btnGhost} disabled={draft.contacts.length >= 100}
                    onClick={() => edit({ contacts: [...draft.contacts, { id: crypto.randomUUID(), date: taipeiToday(), method: 'phone', result: '', nextFollowUp: '' }] })}>
                    <PlusIcon className="w-4 h-4" />{t('work.addContact')}
                  </button>
                </div>
                {draft.contacts.map((contact, i) => {
                  const set = (patch: Partial<typeof contact>) => edit({ contacts: draft.contacts.map((v, j) => j === i ? { ...v, ...patch } : v) });
                  return (
                    <div key={contact.id} className="rounded-xl border-2 border-slate-200 dark:border-slate-700 p-3 grid gap-3 sm:grid-cols-2">
                      <Field label={t('work.date')}><TextInput type="date" value={contact.date} onChange={e => set({ date: e.target.value })} /></Field>
                      <Field label={t('work.method')}>
                        <SelectInput value={contact.method} onChange={e => set({ method: e.target.value })}>
                          {METHODS.map(m => <option key={m} value={m}>{t(METHOD_KEY[m])}</option>)}
                        </SelectInput>
                      </Field>
                      <Field label={t('work.result')}><TextInput maxLength={1000} value={contact.result} onChange={e => set({ result: e.target.value })} /></Field>
                      <Field label={t('work.follow')}><TextInput type="date" value={contact.nextFollowUp} onChange={e => set({ nextFollowUp: e.target.value })} /></Field>
                    </div>
                  );
                })}
              </section>
            </fieldset>

            {/* 儲存列刻意放在 fieldset 外、用 aria-disabled 而不是 disabled。
                fieldset 在 busy 時整個停用；若儲存鈕在裡面，按下的瞬間它被停用，瀏覽器的
                focus fixup 會把焦點丟回 <body>，鍵盤使用者每存一次就被送回頁首。存完後
                dirty=false 又讓它停用，連「把焦點還回去」都做不到。aria-disabled 讓按鈕
                保持可聚焦、讀屏唸「無法使用」，實際的防呆由 onClick 的 canSave 負責。 */}
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={btnPrimary} aria-disabled={!canSave}
                onClick={() => { if (canSave) save(); }}>
                {t('work.save')}
              </button>
              {dirty && <span className="text-xs font-bold text-caution-800 dark:text-caution-300">{t('work.unsaved')}</span>}
            </div>

            {audit.length > 0 && (
              <section aria-labelledby={`${uid}-audit`} className="space-y-2">
                <h4 id={`${uid}-audit`} className="text-sm font-bold">{t('work.audit')}</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted border-b-2 border-slate-200 dark:border-slate-700">
                        <th scope="col" className="py-1.5 pr-4 font-bold">{t('work.auditVersion')}</th>
                        <th scope="col" className="py-1.5 pr-4 font-bold">{t('work.auditAt')} ({t('work.timezoneValue')})</th>
                        <th scope="col" className="py-1.5 pr-4 font-bold">{t('work.auditActor')}</th>
                        <th scope="col" className="py-1.5 font-bold">{t('work.auditAction')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.map(a => (
                        <tr key={a.version} className="border-b border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-200">
                          <td className="py-1.5 pr-4 tabular-nums">v{a.version}</td>
                          <td className="py-1.5 pr-4 tabular-nums whitespace-nowrap">{formatTaipeiDateTime(a.at)}</td>
                          <td className="py-1.5 pr-4 break-all">{a.actor}</td>
                          <td className="py-1.5">{auditActionLabel(a.action, t)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
