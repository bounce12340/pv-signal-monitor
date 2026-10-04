// 後台「不良反應個案收案處理台」。
//
// 這一頁回答的問題是：業務把個案丟進來之後，藥安人員到底要做哪些事？
// 流程固定為七道關卡，UI 依序排列，每道都留下稽核紀錄：
//   1. 收案登錄   —— 產生個案編號、鎖定首次獲知日（Day 0，法定時鐘起點）
//   2. 效度判定   —— ICSR 四要素是否齊備；不齊備者列為待補件而非直接退件
//   3. 重複偵測   —— 同一事件常由業務／客服／醫院三路湧入，重複送件會污染訊號分子
//   4. 嚴重性判定 —— 決定是否觸發 15 日快速通報
//   5. 醫學編碼   —— verbatim → MedDRA PT/SOC，並評估因果關係與預期性
//   6. 送件       —— 產出 CIOMS-I / E2B(R3)，登錄主管機關回執
//   7. 結案與訊號 —— 併入成分 × PT 訊號聚合
//
// ⚠️ 本頁的判定結果僅供內部作業，實際送件仍須由合格藥安人員覆核。
//
// 從 PV-Link 搬入。與原版的差異：拿掉本機模式（遠端／本機切換參數與本機刪除分支）；個案頁新增「內部工作」
// 按鈕，直接打開該個案的工作編輯器（修正新個案建不了第一筆內部工作）；個案編號由 Worker 配發。
// 資料載入與儲存在 AEIntakePage，這個元件只管畫面。

import React, { useMemo, useState } from 'react';
import CaseWorkBoard, { type WorkOpenRequest } from './CaseWorkBoard';
import {
  AEReport, AEAuditEntry,
  assessSeriousness, checkMinimumCriteria, computeCompleteness, computeRegulatoryClock,
  validateAEReport, findDuplicates, aeToCIOMSText, aeToE2B, aeReportsToCSV,
  autoNarrative, patientAgeText, optionLabel, withAudit,
  createFollowUp, followUpsOf, countryText, isForeignCase,
  AE_CASE_STATUS_FLOW, AECaseStatus,
  SERIOUSNESS_CRITERIA, OUTCOME_OPTIONS, SEX_OPTIONS, REPORT_SOURCE_OPTIONS,
  CAUSALITY_OPTIONS, EXPECTEDNESS_OPTIONS, ROUTE_OPTIONS, YES_NO_UNK_OPTIONS,
  MAH_SERIOUS_REPORT_DAYS,
} from '../../services/ae/aeReport';
import { attachmentSrc } from '../../services/ae/aeApi';
import { lookupMeddra } from '../../services/literature/meddra';
import { useLang, useT } from '../../i18n/LangContext';
import { Badge, Card, Field, TextInput, TextArea, ChipGroup, Option } from './ui';
import { CASE_STATUS_TONE } from './caseStatus';
import { caseAuditActionLabel, caseAuditDetailLabel } from './caseAudit';
import { formatTaipeiDateTime } from '../../services/ae/taipeiTime';
import {
  Download as ArrowDownTrayIcon, Clipboard as ClipboardDocumentIcon, Check as CheckIcon, FileText as DocumentTextIcon,
  TriangleAlert as ExclamationTriangleIcon, Trash2 as TrashIcon, Link as LinkIcon, Smartphone as DevicePhoneMobileIcon,
  Search as MagnifyingGlassIcon, Sparkles as SparklesIcon, X as XMarkIcon, ShieldAlert as ShieldExclamationIcon,
  Clock as ClockIcon, Inbox as InboxIcon, Copy as DocumentDuplicateIcon, Undo2 as ArrowUturnLeftIcon,
  ListTodo as ListTodoIcon,
} from 'lucide-react';

const todayIso = () => new Date().toISOString().slice(0, 10);

type Filter = 'all' | 'serious' | 'overdue' | 'due_soon' | 'follow_up' | 'unresolved';

const AEIntakeConsole: React.FC<{
  cases: AEReport[];
  /** 存單一個案；由呼叫端送到後端，成功才更新畫面 */
  onSaveCase: (report: AEReport) => void | Promise<void>;
  /** 刪除個案；後端為軟刪除，reason 會寫進稽核軌跡 */
  onDeleteCase: (id: string, reason?: string) => void | Promise<void>;
  /** 目前操作者，只用於樂觀顯示；稽核軌跡的 actor 一律由後端以 Access JWT 覆寫 */
  actor?: string;
}> = ({ cases, onSaveCase, onDeleteCase, actor = 'pv-officer' }) => {
  // 同 AEReportMobile：ae.status.* / ae.console.dupReason.* 為動態鍵，改由單元測試把關。
  const t = useT() as (k: string) => string;
  const { lang } = useLang();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [keyword, setKeyword] = useState('');
  const [ciomsText, setCiomsText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [workRequest, setWorkRequest] = useState<WorkOpenRequest | undefined>();

  const today = todayIso();

  const enriched = useMemo(() => cases.map(c => ({
    report: c,
    clock: computeRegulatoryClock(c, today),
    serious: assessSeriousness(c).serious,
    completeness: computeCompleteness(c),
    valid: checkMinimumCriteria(c).valid,
  })), [cases, today]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return enriched.filter(({ report: r, clock, serious }) => {
      if (filter === 'serious' && !serious) return false;
      if (filter === 'overdue' && !clock.overdue) return false;
      if (filter === 'due_soon' && !(clock.daysRemaining !== null && !clock.submitted && clock.daysRemaining >= 0 && clock.daysRemaining <= 5)) return false;
      if (filter === 'follow_up' && r.status !== 'follow_up') return false;
      if (filter === 'unresolved' && (r.status === 'closed' || r.status === 'invalid')) return false;
      if (!kw) return true;
      const hay = [
        r.caseNumber, r.patientInitials, r.reporterName, r.primaryReporterName,
        ...r.events.map(e => `${e.verbatim} ${e.meddraPt || ''}`),
        ...r.drugs.map(d => `${d.brandName} ${d.activeIngredient} ${d.lotNumber}`),
      ].join(' ').toLowerCase();
      return hay.includes(kw);
    }).sort((a, b) => {
      // 排序原則：逾期 > 剩餘天數少 > 新進案。時限壓力決定處理順序，不是先進先出。
      if (a.clock.overdue !== b.clock.overdue) return a.clock.overdue ? -1 : 1;
      const ad = a.clock.daysRemaining ?? 9999;
      const bd = b.clock.daysRemaining ?? 9999;
      if (ad !== bd) return ad - bd;
      return (b.report.createdAt || '').localeCompare(a.report.createdAt || '');
    });
  }, [enriched, filter, keyword]);

  const selected = cases.find(c => c.id === selectedId) || null;

  const counts = useMemo(() => ({
    all: enriched.length,
    serious: enriched.filter(e => e.serious).length,
    overdue: enriched.filter(e => e.clock.overdue).length,
    followUp: enriched.filter(e => e.report.status === 'follow_up').length,
  }), [enriched]);

  // 改一件事就存一件事：整陣列覆寫在遠端模式下會把所有個案重送一次，
  // 既浪費頻寬也會讓稽核軌跡出現一堆沒有實質變更的寫入。
  const updateCase = (id: string, mutate: (r: AEReport) => AEReport, audit?: Omit<AEAuditEntry, 'at' | 'actor'>) => {
    const current = cases.find(c => c.id === id);
    if (!current) return;
    let next = mutate(current);
    next = { ...next, updatedAt: new Date().toISOString() };
    if (audit) next = withAudit(next, { at: new Date().toISOString(), actor, ...audit });
    void onSaveCase(next);
  };

  const removeCase = (id: string) => {
    if (!window.confirm(t('ae.console.deleteConfirmRemote'))) return;
    // 軟刪除：個案留在資料庫、只標記 deleted_at，理由寫進稽核軌跡。
    // GxP 下「刪除」本來就不該是真的消失。
    const answer = window.prompt(t('ae.console.deleteReason'));
    if (answer === null) return; // 取消
    void onDeleteCase(id, answer.trim());
    if (selectedId === id) setSelectedId(null);
  };

  const exportCsv = () => {
    const blob = new Blob([aeReportsToCSV(cases, today)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AE_Cases_${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reportUrl = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}#/report` : '#/report';

  return (
    <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
      {/* ── 收件匣 ─────────────────────────────────── */}
      <div className="lg:w-[380px] shrink-0 flex flex-col border-b lg:border-b-0 lg:border-r border-white/40 dark:border-white/10 overflow-hidden max-h-[45vh] lg:max-h-none">
        <div className="p-4 space-y-3 border-b border-white/40 dark:border-white/10">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-black tracking-tight flex items-center gap-2">
              <InboxIcon className="w-5 h-5" />{t('ae.console.inbox')}
              <span className="text-xs text-muted">({counts.all})</span>
            </h2>
            <div className="flex gap-1.5">
              <a href={reportUrl} target="_blank" rel="noreferrer" title={t('ae.console.openForm')}
                className="w-10 h-10 rounded-xl bg-brand-600 text-white flex items-center justify-center shadow">
                <DevicePhoneMobileIcon className="w-5 h-5" />
              </a>
              <button title={t('ae.console.copyLink')}
                onClick={() => { navigator.clipboard?.writeText(reportUrl); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1600); }}
                className="w-10 h-10 rounded-xl bg-white/60 dark:bg-white/10 border border-white/60 dark:border-white/10 flex items-center justify-center">
                {linkCopied ? <CheckIcon className="w-5 h-5 text-success-700 dark:text-success-300" /> : <LinkIcon className="w-5 h-5" />}
              </button>
              <button title={t('ae.console.exportCsv')} onClick={exportCsv} disabled={!cases.length}
                className="w-10 h-10 rounded-xl bg-white/60 dark:bg-white/10 border border-white/60 dark:border-white/10 flex items-center justify-center disabled:opacity-40">
                <ArrowDownTrayIcon className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="relative">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={keyword} onChange={e => setKeyword(e.target.value)}
              placeholder={t('ae.console.searchPlaceholder')}
              className="w-full min-h-[44px] pl-9 pr-3 py-2 text-sm font-bold rounded-2xl bg-white/70 dark:bg-slate-800/70 border-2 border-slate-300 dark:border-slate-600 focus:border-brand-600" />
          </div>

          {/* 換行而不是橫向捲動：原本最後一顆「嚴重」被切掉一半，看不出那一列可以滑 */}
          <div className="flex flex-wrap gap-1.5">
            {([
              ['all', t('ae.console.filterAll'), counts.all],
              ['unresolved', t('ae.console.filterOpen'), null],
              ['overdue', t('ae.console.overdue'), counts.overdue],
              ['due_soon', t('ae.console.dueSoon'), null],
              ['serious', t('ae.console.serious'), counts.serious],
              ['follow_up', t('ae.status.follow_up'), counts.followUp],
            ] as [Filter, string, number | null][]).map(([f, labelText, n]) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`min-h-[36px] px-3 rounded-xl text-xs font-bold border-2 transition-all ${
                  filter === f
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white/60 dark:bg-white/10 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'
                }`}>
                {labelText}{n !== null && n > 0 ? ` ${n}` : ''}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {!filtered.length && (
            <div className="text-center py-10 px-4 space-y-2">
              <InboxIcon className="w-10 h-10 mx-auto text-muted" />
              <p className="text-sm font-black text-muted">{t('ae.console.empty')}</p>
              <p className="text-xs text-muted">{t('ae.console.emptyHint')}</p>
            </div>
          )}
          {filtered.map(({ report: r, clock, serious, completeness, valid }) => (
            <button key={r.id} onClick={() => setSelectedId(r.id)}
              className={`w-full text-left p-3.5 rounded-2xl border-2 transition-all ${
                selectedId === r.id
                  ? 'bg-brand-50 dark:bg-brand-500/15 border-brand-500'
                  : 'bg-white/60 dark:bg-white/[0.06] border-white/60 dark:border-white/10 hover:border-brand-300'
              }`}>
              {/* 個案編號是識別碼，不能斷行；徽章放不下時改由徽章換行（英文的狀態字較長） */}
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <span className="text-xs font-bold tabular-nums whitespace-nowrap shrink-0 leading-6">{r.caseNumber || r.id.slice(0, 12)}</span>
                <div className="flex gap-1 flex-wrap justify-end">
                  {isForeignCase(r) && <Badge tone="brand">{countryText(r, lang)}</Badge>}
                  {r.reportType === 'follow_up' && <Badge tone="brand">F/U</Badge>}
                  {serious && <Badge tone="danger">{t('ae.console.serious')}</Badge>}
                  <Badge tone={CASE_STATUS_TONE[r.status]}>{t(`ae.status.${r.status}` as any)}</Badge>
                </div>
              </div>
              <p className="text-sm font-bold line-clamp-2 mb-2">
                {r.events.map(e => e.verbatim).filter(Boolean).join('、') || t('ae.console.noEvent')}
              </p>
              <div className="flex items-center justify-between gap-2 text-xs font-bold text-muted">
                <span className="truncate">
                  {r.drugs.filter(d => d.isSuspect).map(d => d.brandName || d.activeIngredient).filter(Boolean).join(', ') || '—'}
                </span>
                {clock.dueDate && (
                  <span className={`shrink-0 tabular-nums flex items-center gap-1 ${
                    clock.overdue ? 'text-danger-700 dark:text-danger-300'
                      : (clock.daysRemaining ?? 99) <= 5 ? 'text-caution-800 dark:text-caution-300' : ''
                  }`}>
                    <ClockIcon className="w-3.5 h-3.5" />
                    {clock.submitted ? '✓' : `${clock.daysRemaining}${t('ae.console.days')}`}
                  </span>
                )}
              </div>
              <div className="mt-2 h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div className={`h-full ${!valid ? 'bg-danger-500' : completeness >= 70 ? 'bg-success-500' : 'bg-caution-500'}`}
                  style={{ width: `${completeness}%` }} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── 個案處理面板 ────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <CaseWorkBoard cases={cases} openRequest={workRequest} />
        {!selected
          ? <div className="h-full flex flex-col items-center justify-center gap-3 text-muted p-10">
              <DocumentTextIcon className="w-12 h-12" />
              <p className="text-sm font-black">{t('ae.console.selectCase')}</p>
            </div>
          : <CaseDetail
              key={selected.id}
              report={selected}
              allCases={cases}
              today={today}
              t={t}
              lang={lang}
              onUpdate={(m, a) => updateCase(selected.id, m, a)}
              onDelete={() => removeCase(selected.id)}
              onShowCioms={setCiomsText}
              onCreateFollowUp={() => {
                const fu = createFollowUp(selected, cases, today, actor);
                void Promise.resolve(onSaveCase(fu)).then(() => setSelectedId(fu.id));
              }}
              onSelectCase={setSelectedId}
              onOpenWork={() => setWorkRequest(prev => ({ caseId: selected.id, seq: (prev?.seq ?? 0) + 1 }))}
            />}
      </div>

      {ciomsText !== null && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setCiomsText(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl border border-white/20"
            onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-black text-lg">{t('ae.console.ciomsTitle')}</h3>
                <p className="text-xs font-bold text-caution-800 dark:text-caution-300 flex items-center gap-1 mt-0.5">
                  <ExclamationTriangleIcon className="w-4 h-4" />{t('ae.console.ciomsNotice')}
                </p>
              </div>
              <button onClick={() => setCiomsText(null)} className="w-10 h-10 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-5 text-xs leading-relaxed font-mono whitespace-pre-wrap">{ciomsText}</pre>
            <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex gap-2">
              <button onClick={() => { navigator.clipboard?.writeText(ciomsText); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
                className="flex-1 min-h-[44px] rounded-2xl bg-brand-600 text-white text-sm font-black flex items-center justify-center gap-2">
                {copied ? <CheckIcon className="w-5 h-5" /> : <ClipboardDocumentIcon className="w-5 h-5" />}
                {copied ? t('common.copied') : t('review.copyFullText')}
              </button>
              <button onClick={() => {
                  const blob = new Blob([ciomsText], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = `CIOMS_${today}.txt`; a.click();
                  URL.revokeObjectURL(url);
                }}
                className="min-h-[44px] px-5 rounded-2xl border-2 border-slate-300 dark:border-slate-600 text-sm font-black flex items-center gap-2">
                <ArrowDownTrayIcon className="w-5 h-5" />{t('review.downloadTxt')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// 個案詳情 / 處理面板
// ─────────────────────────────────────────────────────────────

const Panel: React.FC<{ step: number; title: string; children: React.ReactNode; tone?: string }> = ({ step, title, children }) => (
  <Card className="p-5 space-y-4">
    <div className="flex items-center gap-3">
      <span className="w-7 h-7 shrink-0 rounded-xl bg-brand-600 text-white text-xs font-bold flex items-center justify-center">{step}</span>
      <h3 className="text-sm font-black tracking-tight">{title}</h3>
    </div>
    {children}
  </Card>
);

/**
 * Email 只在 @ 後面給一個換行點。原本只有 break-words，欄寬放不下整個地址時
 * 會在任意字母斷開（「…uicgroup.com.t」「w」）；在 @ 後斷成「帳號@」「網域」才讀得懂。
 * 網域本身仍放不下時，break-words 照樣兜底。
 */
const withEmailBreak = (v: React.ReactNode): React.ReactNode =>
  typeof v === 'string' && /\S@\S/.test(v)
    ? v.split(/(?<=@)/).flatMap((part, i) => (i ? [<wbr key={i} />, part] : [part]))
    : v;

const KV: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
  <div className="flex gap-2 text-xs py-1 border-b border-slate-200/60 dark:border-slate-700/60 last:border-0">
    <span className="w-32 shrink-0 font-black text-muted">{k}</span>
    <span className="font-bold break-words min-w-0">{withEmailBreak(v) || '—'}</span>
  </div>
);

const CaseDetail: React.FC<{
  report: AEReport;
  allCases: AEReport[];
  today: string;
  t: (k: any) => string;
  lang: 'zh' | 'en';
  onUpdate: (mutate: (r: AEReport) => AEReport, audit?: Omit<AEAuditEntry, 'at' | 'actor'>) => void;
  onDelete: () => void;
  onShowCioms: (text: string) => void;
  onCreateFollowUp: () => void;
  onSelectCase: (id: string) => void;
  onOpenWork: () => void;
}> = ({ report, allCases, today, t, lang, onUpdate, onDelete, onShowCioms, onCreateFollowUp, onSelectCase, onOpenWork }) => {
  const clock = computeRegulatoryClock(report, today);
  const seriousness = assessSeriousness(report);
  const minCriteria = checkMinimumCriteria(report);
  const completeness = computeCompleteness(report);
  const issues = validateAEReport(report, today);
  const gaps = issues.filter(i => i.level === 'warning');
  const blockers = issues.filter(i => i.level === 'error');
  const duplicates = useMemo(() => findDuplicates(report, allCases), [report, allCases]);
  const suspects = report.drugs.filter(d => d.isSuspect);
  const concomitant = report.drugs.filter(d => !d.isSuspect);
  const followUps = useMemo(() => followUpsOf(report, allCases), [report, allCases]);
  const parent = report.followUpOfId ? allCases.find(c => c.id === report.followUpOfId) : undefined;
  const [showE2b, setShowE2b] = useState(false);

  const patchTriage = (p: Partial<AEReport['triage']>, action: string, detail?: string) =>
    onUpdate(r => ({ ...r, triage: { ...r.triage, ...p } }), { action, detail });

  /** 用種子詞典把 verbatim 對到 MedDRA PT/SOC。未命中時保留原詞並標記待人工編碼。 */
  const autoCode = () => {
    onUpdate(r => ({
      ...r,
      events: r.events.map(e => {
        const look = lookupMeddra(e.meddraPt || e.verbatim);
        return { ...e, meddraPt: look.matched ? look.pt : (e.meddraPt || e.verbatim), meddraSoc: look.soc || '', meddraVerified: look.matched };
      }),
      status: r.status === 'submitted' || r.status === 'triage' ? 'coded' : r.status,
    }), { action: 'meddra_autocode' });
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-4xl">
      {/* 標頭 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-black tracking-tight">{report.caseNumber || report.id.slice(0, 12)}</h2>
            <Badge tone={CASE_STATUS_TONE[report.status]}>{t(`ae.status.${report.status}`)}</Badge>
            {seriousness.serious && <Badge tone="danger">{t('ae.console.serious')}</Badge>}
            {report.reportType === 'follow_up' && <Badge tone="brand">{t('ae.console.followUpReport')}</Badge>}
            {isForeignCase(report) && (
              <Badge tone="brand">🌐 {t('ae.console.foreignCase')}：{countryText(report, lang)}</Badge>
            )}
          </div>
          <p className="text-xs font-bold text-muted mt-1">
            {t('ae.console.receivedFrom')}: {report.reporterName || '—'}
            {report.reporterTerritory ? `｜${report.reporterTerritory}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onShowCioms(aeToCIOMSText(report, today))}
            className="min-h-[44px] px-4 rounded-2xl bg-brand-600 text-white text-xs font-bold flex items-center gap-2 shadow">
            <DocumentTextIcon className="w-4 h-4" />{t('ae.console.cioms')}
          </button>
          <button onClick={onCreateFollowUp} title={t('ae.console.createFollowUpHint')}
            className="min-h-[44px] px-4 rounded-2xl border-2 border-brand-400 text-brand-700 dark:text-brand-300 text-xs font-bold flex items-center gap-2">
            <DocumentDuplicateIcon className="w-4 h-4" />{t('ae.console.createFollowUp')}
          </button>
          {/* 工作台只列出已有工作、且內部到期日落在範圍內的個案；新個案只能從這裡建立第一筆內部工作。 */}
          <button onClick={onOpenWork} title={t('ae.console.openWorkHint')}
            className="min-h-[44px] px-4 rounded-2xl border-2 border-brand-400 text-brand-700 dark:text-brand-300 text-xs font-bold flex items-center gap-2">
            <ListTodoIcon className="w-4 h-4" />{t('ae.console.openWork')}
          </button>
          <button onClick={onDelete} title={t('ae.console.deleteCase')}
            className="w-11 h-11 rounded-2xl border-2 border-danger-300 dark:border-danger-500/40 text-danger-700 dark:text-danger-300 flex items-center justify-center">
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 1. 法定時鐘 —— 放在最上方，因為它是唯一有法律後果的欄位 */}
      <div className={`p-5 rounded-3xl border-2 ${
        clock.overdue ? 'bg-danger-50 dark:bg-danger-500/10 border-danger-400'
          : clock.dueDate && !clock.submitted && (clock.daysRemaining ?? 99) <= 5 ? 'bg-caution-50 dark:bg-caution-500/10 border-caution-400'
          : 'bg-white/60 dark:bg-white/[0.07] border-white/60 dark:border-white/10'
      }`}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs font-bold text-muted">{t('ae.console.day0')}</p>
            <p className="text-lg font-black tabular-nums">{clock.day0 || '—'}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-muted">{t('ae.console.due')}</p>
            <p className="text-lg font-black tabular-nums">{clock.dueDate || t('ae.console.psurOnly')}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-muted">{t('ae.console.daysLeft')}</p>
            <p className={`text-lg font-black tabular-nums ${clock.overdue ? 'text-danger-700 dark:text-danger-300' : ''}`}>
              {clock.submitted ? t('ae.console.submitted') : clock.daysRemaining === null ? '—' : `${clock.daysRemaining} ${t('ae.console.days')}`}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold text-muted">{t('ae.review.completeness')}</p>
            <p className="text-lg font-black tabular-nums">{completeness}%</p>
          </div>
        </div>
        <p className="text-xs font-bold mt-3 text-slate-600 dark:text-slate-300">
          {t(`ae.console.basis.${clock.basis}`).replace('{days}', String(MAH_SERIOUS_REPORT_DAYS))}
        </p>
      </div>

      {/* 追蹤鏈：只在這個個案確實有上下游時才出現，避免對單純的初始報告製造雜訊 */}
      {(parent || followUps.length > 0 || report.reportType === 'follow_up') && (
        <Card className="p-5 space-y-4">
          <h3 className="text-sm font-black tracking-tight flex items-center gap-2">
            <DocumentDuplicateIcon className="w-4 h-4" />{t('ae.console.followUpChain')}
          </h3>

          {parent && (
            <button onClick={() => onSelectCase(parent.id)}
              className="w-full text-left min-h-[44px] px-4 py-2.5 rounded-2xl border-2 border-slate-300 dark:border-slate-600 text-xs font-bold flex items-center gap-2 hover:border-brand-400">
              <ArrowUturnLeftIcon className="w-4 h-4 shrink-0" />
              {t('ae.console.parentCase')}：{parent.caseNumber || parent.id.slice(0, 12)}
            </button>
          )}

          {report.reportType === 'follow_up' && (
            <>
              <button type="button"
                onClick={() => onUpdate(
                  r => ({ ...r, hasSignificantNewInfo: !r.hasSignificantNewInfo }),
                  { action: 'significant_new_info', detail: report.hasSignificantNewInfo ? 'false' : 'true' },
                )}
                className={`w-full min-h-[48px] px-4 rounded-2xl text-xs font-black border-2 flex items-center gap-3 text-left ${
                  report.hasSignificantNewInfo
                    ? 'bg-danger-600 text-white border-danger-600'
                    : 'bg-white/70 dark:bg-slate-800/70 border-slate-300 dark:border-slate-600'
                }`}>
                <span className={`w-5 h-5 shrink-0 rounded-md border-2 flex items-center justify-center ${
                  report.hasSignificantNewInfo ? 'bg-white/25 border-white' : 'border-slate-400'
                }`}>{report.hasSignificantNewInfo ? '✓' : ''}</span>
                {t('ae.console.significantNewInfo')}
              </button>
              <p className="text-xs text-muted leading-relaxed">
                {t('ae.console.significantNewInfoHint').replace('{days}', String(MAH_SERIOUS_REPORT_DAYS))}
              </p>
            </>
          )}

          {followUps.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-bold text-muted">
                {t('ae.console.childFollowUps')}（{followUps.length}）
              </p>
              {followUps.map(f => {
                const fc = computeRegulatoryClock(f, today);
                return (
                  <button key={f.id} onClick={() => onSelectCase(f.id)}
                    className="w-full text-left min-h-[44px] px-4 py-2.5 rounded-2xl border border-slate-300 dark:border-slate-600 text-xs font-bold flex items-center justify-between gap-2 hover:border-brand-400">
                    <span className="font-black">{f.caseNumber}</span>
                    <span className="text-muted tabular-nums shrink-0">
                      {f.awarenessDate}
                      {fc.dueDate ? `　→ ${fc.dueDate}` : `　${t('ae.console.noExpedited')}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* 2. 效度判定 */}
      <Panel step={1} title={t('ae.console.validity')}>
        <div className="grid grid-cols-2 gap-2">
          {([
            ['ae.min.patient', minCriteria.identifiablePatient],
            ['ae.min.reporter', minCriteria.identifiableReporter],
            ['ae.min.product', minCriteria.suspectProduct],
            ['ae.min.event', minCriteria.adverseEvent],
          ] as [string, boolean][]).map(([k, ok]) => (
            <div key={k} className={`px-3 py-2.5 rounded-xl text-xs font-black flex items-center gap-2 border ${
              ok ? 'bg-success-50 dark:bg-success-500/10 border-success-300 dark:border-success-500/30 text-success-800 dark:text-success-300'
                 : 'bg-danger-50 dark:bg-danger-500/10 border-danger-300 dark:border-danger-500/30 text-danger-800 dark:text-danger-300'
            }`}>
              {ok ? <CheckIcon className="w-4 h-4" /> : <ShieldExclamationIcon className="w-4 h-4" />}
              {t(k)}
            </div>
          ))}
        </div>
        {blockers.length > 0 && (
          <div className="text-xs font-bold text-danger-700 dark:text-danger-300 space-y-1">
            {blockers.map((b, i) => <p key={i}>• {t(`ae.issue.${b.code}`)}{b.detail ? `（${b.detail}）` : ''}</p>)}
          </div>
        )}
        {/*
          Day 0 與來源端獲知日並列，是為了讓覆核者一眼看見兩者不同。
          轉知個案的時鐘算錯，幾乎都是把來源端日期填進 Day 0 造成的；
          兩個欄位擺在一起、旁邊寫明哪一個決定時鐘，比任何說明文件有效。
        */}
        <div className="grid md:grid-cols-2 gap-4">
          <Field label={t('ae.f.awarenessDate')} required tag="CIOMS 24c" hint={t('ae.console.day0Hint')}>
            <TextInput type="date" value={report.awarenessDate} max={today}
              className="!text-sm !min-h-[44px]"
              onChange={e => onUpdate(
                r => ({ ...r, awarenessDate: e.target.value }),
                { action: 'awareness_date_changed', detail: e.target.value || '已清除' },
              )} />
          </Field>
          <Field label={t('ae.f.sourceAwarenessDate')} hint={t('ae.f.sourceAwarenessHint')}>
            <TextInput type="date" value={report.sourceAwarenessDate} max={today}
              className="!text-sm !min-h-[44px]"
              onChange={e => onUpdate(r => ({ ...r, sourceAwarenessDate: e.target.value }))} />
          </Field>
        </div>

        <button onClick={() => patchTriage({ validityConfirmed: !report.triage.validityConfirmed }, 'validity_confirm')}
          className={`min-h-[44px] px-4 rounded-2xl text-xs font-black border-2 ${
            report.triage.validityConfirmed
              ? 'bg-success-700 text-white border-success-700'
              : 'border-slate-300 dark:border-slate-600'
          }`}>
          {report.triage.validityConfirmed ? `✓ ${t('ae.console.validityConfirmed')}` : t('ae.console.confirmValidity')}
        </button>
      </Panel>

      {/* 3. 重複偵測 */}
      <Panel step={2} title={t('ae.console.duplicates')}>
        {!duplicates.length
          ? <p className="text-xs font-bold text-success-700 dark:text-success-300">✓ {t('ae.console.noDuplicates')}</p>
          : <div className="space-y-2">
              {duplicates.map(d => (
                <div key={d.id} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-caution-50 dark:bg-caution-500/10 border border-caution-300 dark:border-caution-500/30">
                  <div className="min-w-0">
                    <p className="text-xs font-bold">{d.caseNumber}</p>
                    <p className="text-xs font-bold text-caution-800 dark:text-caution-300">
                      {t('ae.console.similarity')} {d.score}%｜{d.reasons.map(r => t(`ae.console.dupReason.${r}`)).join('、')}
                    </p>
                  </div>
                  <button onClick={() => patchTriage({ duplicateOfId: report.triage.duplicateOfId === d.id ? '' : d.id }, 'mark_duplicate', d.caseNumber)}
                    className={`shrink-0 min-h-[36px] px-3 rounded-xl text-xs font-bold border-2 ${
                      report.triage.duplicateOfId === d.id ? 'bg-danger-600 text-white border-danger-600' : 'border-caution-400 text-caution-800 dark:text-caution-300'
                    }`}>
                    {report.triage.duplicateOfId === d.id ? t('ae.console.markedDuplicate') : t('ae.console.markDuplicate')}
                  </button>
                </div>
              ))}
            </div>}
      </Panel>

      {/* 4. 嚴重性 */}
      <Panel step={3} title={t('ae.console.seriousnessAssessment')}>
        <div className="flex flex-wrap gap-1.5">
          {SERIOUSNESS_CRITERIA.map(c => (
            <Badge key={c.value} tone={seriousness.criteria.includes(c.value) ? 'danger' : 'neutral'}>
              {seriousness.criteria.includes(c.value) ? '✓ ' : ''}{lang === 'en' ? c.en : c.zh}
            </Badge>
          ))}
        </div>
        <Field label={t('ae.console.seriousOverride')}>
          <ChipGroup lang={lang} clearable={false} value={report.triage.seriousnessOverride}
            options={[
              { value: '', zh: t('ae.console.useAuto'), en: t('ae.console.useAuto') },
              { value: 'serious', zh: t('ae.console.forceSerious'), en: t('ae.console.forceSerious') },
              { value: 'non_serious', zh: t('ae.console.forceNonSerious'), en: t('ae.console.forceNonSerious') },
            ] as Option[]}
            onChange={v => patchTriage({ seriousnessOverride: v as any }, 'seriousness_override', v || 'auto')} />
        </Field>
        {seriousness.overridden && (
          <p className="text-xs font-bold text-caution-800 dark:text-caution-300 flex items-center gap-1">
            <ExclamationTriangleIcon className="w-4 h-4" />{t('ae.console.overrideWarning')}
          </p>
        )}
      </Panel>

      {/* 5. 醫學編碼與評估 */}
      <Panel step={4} title={t('ae.console.coding')}>
        <button onClick={autoCode}
          className="min-h-[44px] px-4 rounded-2xl bg-brand-600 text-white text-xs font-bold flex items-center gap-2">
          <SparklesIcon className="w-4 h-4" />{t('ae.console.autoCode')}
        </button>
        <div className="space-y-2">
          {report.events.map((e, i) => (
            <div key={e.id} className="p-3 rounded-2xl bg-white/60 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2">
              <p className="text-xs font-bold">{i + 1}. {e.verbatim || '—'}</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="MedDRA PT">
                  <TextInput value={e.meddraPt || ''} className="!text-sm !min-h-[40px] !py-2"
                    onChange={ev => onUpdate(r => ({ ...r, events: r.events.map(x => x.id === e.id ? { ...x, meddraPt: ev.target.value } : x) }))} />
                </Field>
                <Field label="MedDRA SOC">
                  <TextInput value={e.meddraSoc || ''} className="!text-sm !min-h-[40px] !py-2"
                    onChange={ev => onUpdate(r => ({ ...r, events: r.events.map(x => x.id === e.id ? { ...x, meddraSoc: ev.target.value } : x) }))} />
                </Field>
              </div>
              <div className="flex gap-1.5">
                <Badge tone={e.meddraVerified ? 'success' : 'caution'}>
                  {e.meddraVerified ? t('common.dictVerified') : t('review.socNotInDict')}
                </Badge>
                {e.outcome && <Badge>{optionLabel(OUTCOME_OPTIONS, e.outcome, lang)}</Badge>}
              </div>
            </div>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <Field label={t('ae.console.expectedness')} hint={t('ae.console.expectednessHint')}>
            <ChipGroup options={EXPECTEDNESS_OPTIONS} value={report.triage.expectedness} lang={lang} cols={1} clearable={false}
              onChange={v => patchTriage({ expectedness: v }, 'expectedness', v)} />
          </Field>
          <Field label={t('ae.console.causality')}>
            <ChipGroup options={CAUSALITY_OPTIONS} value={report.triage.causality} lang={lang} cols={1}
              onChange={v => patchTriage({ causality: v }, 'causality', v)} />
          </Field>
        </div>
        {report.triage.expectedness === 'unlisted' && seriousness.serious && (
          <div className="px-4 py-3 rounded-2xl bg-danger-50 dark:bg-danger-500/10 border-2 border-danger-300 dark:border-danger-500/40">
            <p className="text-xs font-bold text-danger-800 dark:text-danger-300 flex items-center gap-1.5">
              <ExclamationTriangleIcon className="w-4 h-4" />{t('ae.console.susarWarning')}
            </p>
          </div>
        )}
      </Panel>

      {/* 6. 補件 */}
      <Panel step={5} title={t('ae.console.followUp')}>
        {!gaps.length
          ? <p className="text-xs font-bold text-success-700 dark:text-success-300">✓ {t('ae.console.noGaps')}</p>
          : <div className="space-y-1.5">
              {gaps.map((g, i) => (
                <p key={i} className="text-xs font-bold px-3 py-2 rounded-xl bg-caution-50 dark:bg-caution-500/10 border border-caution-300 dark:border-caution-500/30 text-caution-900 dark:text-caution-200">
                  • {t(`ae.issue.${g.code}`)}{g.detail ? `（${g.detail}）` : ''}
                </p>
              ))}
            </div>}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onUpdate(r => ({
              ...r, status: 'follow_up',
              triage: { ...r.triage, followUpRequestedAt: new Date().toISOString() },
            }), { action: 'follow_up_requested', detail: `${gaps.length} 項待補` })}
            className="min-h-[44px] px-4 rounded-2xl border-2 border-caution-400 text-caution-800 dark:text-caution-300 text-xs font-bold">
            {t('ae.console.requestFollowUp')}
          </button>
          <button onClick={() => {
              const subject = encodeURIComponent(`[藥物安全] 個案 ${report.caseNumber} 補件請求`);
              const body = encodeURIComponent(
                `${report.reporterName} 您好：\n\n個案 ${report.caseNumber}（${report.events.map(e => e.verbatim).filter(Boolean).join('、')}）尚缺下列資訊，煩請協助補齊：\n\n` +
                gaps.map(g => `• ${t(`ae.issue.${g.code}`)}${g.detail ? `（${g.detail}）` : ''}`).join('\n') +
                `\n\n本案首次獲知日為 ${report.awarenessDate}，${seriousness.serious ? `法定通報期限至 ${clock.dueDate}，` : ''}煩請盡速回覆。\n\n藥物安全監視部門`
              );
              window.location.href = `mailto:${report.reporterEmail || ''}?subject=${subject}&body=${body}`;
            }}
            disabled={!gaps.length}
            className="min-h-[44px] px-4 rounded-2xl border-2 border-slate-300 dark:border-slate-600 text-xs font-bold disabled:opacity-40">
            {t('ae.console.draftFollowUpMail')}
          </button>
        </div>
        {report.triage.followUpRequestedAt && (
          <p className="text-xs font-bold text-muted">
            {t('ae.console.followUpRequestedAt')}: {report.triage.followUpRequestedAt.slice(0, 16).replace('T', ' ')}
          </p>
        )}
      </Panel>

      {/* 7. 送件與結案 */}
      <Panel step={6} title={t('ae.console.submission')}>
        <div className="grid md:grid-cols-2 gap-4">
          <Field label={t('ae.console.assignee')}>
            <TextInput value={report.triage.assignee} className="!text-sm !min-h-[44px]"
              onChange={e => onUpdate(r => ({ ...r, triage: { ...r.triage, assignee: e.target.value } }))} />
          </Field>
          <Field label={t('ae.console.receiptNo')}>
            <TextInput value={report.triage.authorityReceiptNo} className="!text-sm !min-h-[44px]"
              onChange={e => onUpdate(r => ({ ...r, triage: { ...r.triage, authorityReceiptNo: e.target.value } }))} />
          </Field>
        </div>

        {/*
          轉報原廠與送主管機關是兩件不同的事，不是同一個送件動作的兩種說法。
          主管機關轉知的個案尤其明顯：TFDA 那邊已經有了，代理商真正要做的是轉報原廠。
          兩者各自留日期，才說得清哪一邊做了、哪一邊還沒。
        */}
        <div className="grid md:grid-cols-2 gap-4">
          <Field label={t('ae.console.transmittedToMahAt')} hint={t('ae.console.transmittedToMahHint')}>
            <TextInput type="date" value={report.triage.transmittedToMahAt} max={today}
              className="!text-sm !min-h-[44px]"
              onChange={e => onUpdate(
                r => ({ ...r, triage: { ...r.triage, transmittedToMahAt: e.target.value } }),
                { action: 'transmitted_to_mah', detail: e.target.value || '已清除' },
              )} />
          </Field>
          <Field label={t('ae.console.mahCaseNumber')}>
            <TextInput value={report.triage.mahCaseNumber} className="!text-sm !min-h-[44px]"
              onChange={e => onUpdate(r => ({ ...r, triage: { ...r.triage, mahCaseNumber: e.target.value } }))} />
          </Field>
        </div>
        <Field label={t('ae.console.notes')}>
          <TextArea rows={3} value={report.triage.notes} className="!text-sm"
            onChange={e => onUpdate(r => ({ ...r, triage: { ...r.triage, notes: e.target.value } }))} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onUpdate(r => ({
              ...r, status: 'reported',
              triage: { ...r.triage, submittedToAuthorityAt: new Date().toISOString() },
            }), { action: 'submitted_to_authority' })}
            disabled={!minCriteria.valid}
            className="min-h-[44px] px-4 rounded-2xl bg-success-700 text-white text-xs font-bold disabled:opacity-40">
            {t('ae.console.submitAuthority')}
          </button>
          <button onClick={() => onUpdate(r => ({ ...r, status: 'closed' }), { action: 'closed' })}
            className="min-h-[44px] px-4 rounded-2xl border-2 border-slate-300 dark:border-slate-600 text-xs font-bold">
            {t('ae.console.close')}
          </button>
          <button onClick={() => onUpdate(r => ({ ...r, status: r.status === 'invalid' ? 'triage' : 'invalid' }), { action: 'toggle_invalid' })}
            className="min-h-[44px] px-4 rounded-2xl border-2 border-danger-300 dark:border-danger-500/40 text-danger-700 dark:text-danger-300 text-xs font-bold">
            {report.status === 'invalid' ? t('ae.console.reopen') : t('ae.console.markInvalid')}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {AE_CASE_STATUS_FLOW.map(s => (
            <button key={s} onClick={() => onUpdate(r => ({ ...r, status: s }), { action: 'status', detail: s })}
              className={`min-h-[36px] px-3 rounded-xl text-xs font-bold border-2 ${
                report.status === s ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-300 dark:border-slate-600 text-muted'
              }`}>
              {t(`ae.status.${s}`)}
            </button>
          ))}
        </div>
      </Panel>

      {/* 個案內容全覽（唯讀） */}
      <Card className="p-5 space-y-4">
        <h3 className="text-sm font-black tracking-tight">{t('ae.console.caseContent')}</h3>
        <div className="grid md:grid-cols-2 gap-x-6">
          <div>
            <p className="text-xs font-bold text-muted mb-1">{t('ae.step.patient')}</p>
            <KV k={t('ae.f.patientInitials')} v={report.patientInitials} />
            <KV k={t('ae.f.patientSex')} v={optionLabel(SEX_OPTIONS, report.patientSex, lang)} />
            <KV k={t('ae.f.patientAge')} v={patientAgeText(report, today, lang)} />
            <KV k={t('ae.f.patientWeight')} v={report.patientWeightKg} />
            <KV k={t('ae.f.country')} v={`${countryText(report, lang)}${isForeignCase(report) ? `（${t('ae.console.foreignCase')}）` : ''}`} />
            <KV k={t('ae.f.medicalHistory')} v={report.medicalHistory} />
            <KV k={t('ae.f.allergies')} v={report.allergies} />
          </div>
          <div>
            <p className="text-xs font-bold text-muted mb-1">{t('ae.step.reporter')}</p>
            <KV k={t('ae.f.reportSource')} v={optionLabel(REPORT_SOURCE_OPTIONS, report.reportSource, lang)} />
            <KV k={t('ae.f.primaryReporterName')} v={report.primaryReporterName} />
            <KV k={t('ae.f.primaryReporterOrg')} v={report.primaryReporterOrg} />
            <KV k={t('ae.f.reporterPhone')} v={report.reporterPhone} />
            <KV k={t('ae.f.reporterEmail')} v={report.reporterEmail} />
            <KV k={t('ae.f.consentFollowUp')} v={report.primaryReporterConsentFollowUp ? '✓' : '—'} />
          </div>
        </div>

        <div>
          <p className="text-xs font-bold text-muted mb-1">{t('ae.drug.suspect')}</p>
          {suspects.map(d => (
            <div key={d.id} className="mb-2">
              <KV k={t('ae.f.brandName')} v={`${d.brandName}${d.activeIngredient ? `（${d.activeIngredient}）` : ''}`} />
              <KV k={t('ae.f.lotNumber')} v={d.lotNumber} />
              <KV k={t('ae.f.dailyDose')} v={`${d.dailyDose}｜${d.route === 'other' ? d.routeOther : optionLabel(ROUTE_OPTIONS, d.route, lang)}`} />
              <KV k={t('ae.f.indication')} v={d.indication} />
              <KV k={t('ae.f.therapyStart')} v={`${d.therapyStart || '—'} ~ ${d.therapyEnd || '—'}`} />
              <KV k={t('ae.f.dechallenge')} v={optionLabel(YES_NO_UNK_OPTIONS, d.dechallenge, lang)} />
              <KV k={t('ae.f.rechallenge')} v={optionLabel(YES_NO_UNK_OPTIONS, d.rechallenge, lang)} />
            </div>
          ))}
          {concomitant.length > 0 && (
            <KV k={t('ae.f.concomitant')} v={concomitant.map(d => d.brandName || d.activeIngredient).filter(Boolean).join('、')} />
          )}
        </div>

        <div>
          <p className="text-xs font-bold text-muted mb-1">{t('ae.f.narrative')}</p>
          <p className="text-xs leading-relaxed font-medium bg-slate-50 dark:bg-slate-800/60 p-3 rounded-2xl">
            {report.narrative || autoNarrative(report, today)}
          </p>
        </div>

        {report.attachments.length > 0 && (
          <div>
            <p className="text-xs font-bold text-muted mb-2">{t('ae.f.attachments')}</p>
            <div className="flex gap-2 flex-wrap">
              {report.attachments.map(a => (
                <a key={a.id} href={attachmentSrc(a)} target="_blank" rel="noreferrer"
                  className="w-24 h-24 rounded-xl overflow-hidden border-2 border-slate-300 dark:border-slate-600 block">
                  {a.mime.startsWith('image/')
                    ? <img src={attachmentSrc(a)} alt={a.name} className="w-full h-full object-cover" />
                    : <span className="w-full h-full flex items-center justify-center text-xs font-bold p-1 text-center break-all">{a.name}</span>}
                </a>
              ))}
            </div>
          </div>
        )}

        <button onClick={() => setShowE2b(v => !v)}
          className="min-h-[40px] px-4 rounded-2xl border-2 border-slate-300 dark:border-slate-600 text-xs font-bold">
          {showE2b ? t('ae.console.hideE2b') : t('ae.console.showE2b')}
        </button>
        {showE2b && (
          <div className="text-xs font-mono space-y-0.5 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-2xl max-h-72 overflow-y-auto">
            {Object.entries(aeToE2B(report, today)).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <span className="text-brand-600 dark:text-brand-300 shrink-0">{k}</span>
                <span className="break-words min-w-0">{v}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 稽核軌跡 */}
      <Card className="p-5 space-y-3">
        <h3 className="text-sm font-black tracking-tight">
          {t('ae.console.auditTrail')}
          <span className="ml-2 text-xs font-bold text-muted">（{t('ae.console.auditTz')}）</span>
        </h3>
        {!report.auditTrail?.length
          ? <p className="text-xs text-muted">—</p>
          : <div className="space-y-1.5">
              {[...report.auditTrail].reverse().map((a, i) => {
                // 時間原本是 a.at.slice(0, 16)：直接截 UTC 字串、沒標時區，比台北時間慢 8 小時，
                // 台北凌晨 0–8 點的事件連日期都錯。動作原本印代碼（status：triage）。
                // 資料庫存的仍是代碼；title 保留原始值，查核需要時滑過去就看得到。
                const detail = caseAuditDetailLabel(a.action, a.detail, t, lang);
                return (
                  <div key={i} title={`${a.at} ${a.action}${a.detail ? ` ${a.detail}` : ''}`}
                    className="text-xs flex gap-2 border-b border-slate-200/60 dark:border-slate-700/60 pb-1.5 last:border-0">
                    <span className="text-muted shrink-0 tabular-nums">{formatTaipeiDateTime(a.at)}</span>
                    <span className="font-black text-brand-600 dark:text-brand-300 shrink-0">{a.actor}</span>
                    <span className="break-words min-w-0">{caseAuditActionLabel(a.action, t)}{detail ? `：${detail}` : ''}</span>
                  </div>
                );
              })}
            </div>}
      </Card>
    </div>
  );
};

export default AEIntakeConsole;
