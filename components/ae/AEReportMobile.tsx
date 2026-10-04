// 業務端「不良反應通報」手機介面。
//
// 設計取捨：
//  • 分 6 步驟而非一頁到底 —— 完整 CIOMS 欄位在手機上是一頁 40 個輸入框，捲到一半就會放棄。
//    拆步驟後每屏只問一件事，且進度條讓人知道還剩多少。
//  • 每次輸入都寫草稿（debounce 600ms）—— 業務在客戶端被打斷是常態，回來要能接著填。
//  • error 阻擋送出、warning 不阻擋 —— 藥物警戒寧可收到不完整的個案，也不要因為表單太嚴格而漏報。
//  • 送出失敗自動進 outbox —— 見 services/ae/aeApi.ts 的說明。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AEReport, AEEvent, AEDrug, SeriousnessCriterion,
  emptyAEReport, emptyEvent, emptyDrug, newId, nextCaseNumber,
  checkMinimumCriteria, validateAEReport, assessSeriousness, computeCompleteness,
  SERIOUSNESS_CRITERIA, OUTCOME_OPTIONS, ROUTE_OPTIONS, REPORT_SOURCE_OPTIONS,
  YES_NO_UNK_OPTIONS, ACTION_TAKEN_OPTIONS, SEX_OPTIONS, AGE_UNIT_OPTIONS, COUNTRY_OPTIONS,
  MAH_SERIOUS_REPORT_DAYS, autoNarrative,
} from '../../services/ae/aeReport';
import {
  submitAEReport, flushOutbox, outboxCount, compressImage, attachmentSrc,
  listAECases, profileToReporterFields, MAX_ATTACHMENTS,
} from '../../services/ae/aeApi';
import type { AEProfile } from '../../services/ae/aeApi';
import { classifyFormSubmission, finalizeFormSubmission, DraftAutosaveCoordinator } from '../../services/ae/aeSubmission';
import { loadValue, saveValue, removeValue, AE_DRAFT_KEY } from '../../services/ae/storage';
import { useLang, useT } from '../../i18n/LangContext';
import { useTheme } from '../../theme/ThemeContext';
import { Field, TextInput, TextArea, ChipGroup, CheckGroup, Card, Badge, Option } from './ui';
import { caseStatusTone } from './caseStatus';
import {
  ChevronLeft as ChevronLeftIcon, ChevronRight as ChevronRightIcon, Send as PaperAirplaneIcon,
  Plus as PlusIcon, Trash2 as TrashIcon, CircleCheck as CheckCircleIcon,
  TriangleAlert as ExclamationTriangleIcon, CloudUpload as CloudArrowUpIcon, Camera as CameraIcon,
  ShieldAlert as ShieldExclamationIcon, RefreshCw as ArrowPathIcon,
  ClipboardList as ClipboardDocumentListIcon, X as XMarkIcon,
} from 'lucide-react';

const todayIso = () => new Date().toISOString().slice(0, 10);

const STEP_KEYS = ['ae.step.reporter', 'ae.step.patient', 'ae.step.event', 'ae.step.drug', 'ae.step.history', 'ae.step.review'] as const;

const PREGNANCY_OPTIONS: readonly Option[] = [
  { value: 'no', zh: '否 / 不適用', en: 'No / N/A' },
  { value: 'yes', zh: '是', en: 'Yes' },
  { value: 'unknown', zh: '不明', en: 'Unknown' },
];

const AUTOPSY_OPTIONS: readonly Option[] = [
  { value: 'yes', zh: '有解剖', en: 'Autopsy done' },
  { value: 'no', zh: '未解剖', en: 'No autopsy' },
  { value: 'unknown', zh: '不明', en: 'Unknown' },
];

const AEReportMobile: React.FC<{
  /** 通報者個人檔案；表單第一步據此自動帶入，業務不必每次重打六個欄位 */
  profile?: AEProfile;
  /** 開啟建檔畫面修改個人資料 */
  onEditProfile?: () => void;
}> = ({ profile, onEditProfile }) => {
  // t 在此放寬為 string 鍵：檢核碼 (ae.issue.*) 是資料驅動的動態鍵，無法用字面型別表達。
  // 對應的存在性由 tests/aeReport.test.ts 逐一驗證，型別安全不是被丟掉而是移到測試層。
  const t = useT() as (k: string) => string;
  const { lang, setLang } = useLang();
  const { theme, toggle } = useTheme();

  const [report, setReport] = useState<AEReport>(() => emptyAEReport(todayIso()));
  const [step, setStep] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [draftState, setDraftState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ caseNumber: string; channel: string } | null>(null);
  const [attachError, setAttachError] = useState('');
  // submitError 僅在需要使用者留意時設定；submitErrorKind 決定標題語意，
  // 避免「遠端已送達但清稿失敗」被誤顯示成「未確認送達」而導致使用者誤重送。
  const [submitError, setSubmitError] = useState('');
  const [submitErrorKind, setSubmitErrorKind] = useState<'unconfirmed' | 'draftClearFailed' | ''>('');
  // debounce autosave 與送出／清稿之間的競態協調器（見 services/aeSubmission.ts
  // 的 DraftAutosaveCoordinator）：用單一 instance 取代原本散落的
  // generation/timer/write 三個 ref，行為與抽出前相同，但邏輯可被獨立動態測試。
  const draftCoordinatorRef = useRef<DraftAutosaveCoordinator>();
  if (!draftCoordinatorRef.current) draftCoordinatorRef.current = new DraftAutosaveCoordinator(600);
  const draftCoordinator = draftCoordinatorRef.current;
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pending, setPending] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── 草稿還原 ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const draft = await loadValue<AEReport>(AE_DRAFT_KEY);
      if (cancelled) return;
      // 個人檔案永遠覆蓋通報者欄位，連還原的草稿也一樣：這幾個欄位的真實來源是
      // 檔案，草稿裡的是它的快照。使用者剛改過檔案卻看到舊草稿的舊電話，
      // 只會讓人以為改了沒生效。
      // 認姓名而非物件本身：身分查詢失敗時拿到的是一份空白檔案（見 Root.tsx），
      // 用它覆蓋等於每次重整都把使用者剛打的通報者欄位清空。
      const fromProfile = profile?.displayName ? profileToReporterFields(profile) : null;
      if (draft && draft.id) {
        setReport(fromProfile ? { ...draft, ...fromProfile } : draft);
        setRestoredDraft(true);
      } else if (fromProfile) {
        setReport(r => ({ ...r, ...fromProfile }));
      }
      setPending(await outboxCount());
      setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── 草稿自動儲存（debounce）────────────────────────────
  useEffect(() => {
    if (!hydrated || done) return;
    setDraftState('saving');
    draftCoordinator.scheduleSave(
      () => saveValue(AE_DRAFT_KEY, { ...report, updatedAt: new Date().toISOString() }),
      outcome => setDraftState(outcome === 'saved' ? 'saved' : 'idle'),
    );
    return () => draftCoordinator.cancelScheduled();
  }, [report, hydrated, done, draftCoordinator]);

  // ── 連線狀態與 outbox 補送 ────────────────────────────
  useEffect(() => {
    const onOnline = async () => {
      setOnline(true);
      const { remaining } = await flushOutbox();
      setPending(remaining);
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const patch = useCallback((p: Partial<AEReport>) => setReport(r => ({ ...r, ...p })), []);

  const patchEvent = useCallback((id: string, p: Partial<AEEvent>) => {
    setReport(r => ({ ...r, events: r.events.map(e => (e.id === id ? { ...e, ...p } : e)) }));
  }, []);

  const patchDrug = useCallback((id: string, p: Partial<AEDrug>) => {
    setReport(r => ({ ...r, drugs: r.drugs.map(d => (d.id === id ? { ...d, ...p } : d)) }));
  }, []);

  const issues = useMemo(() => validateAEReport(report, todayIso()), [report]);
  const errors = useMemo(() => issues.filter(i => i.level === 'error'), [issues]);
  const warnings = useMemo(() => issues.filter(i => i.level === 'warning'), [issues]);
  const minCriteria = useMemo(() => checkMinimumCriteria(report), [report]);
  const seriousness = useMemo(() => assessSeriousness(report), [report]);
  const completeness = useMemo(() => computeCompleteness(report), [report]);

  const stepErrors = (s: number) => errors.filter(i => i.step === s);

  const goStep = (s: number) => {
    setStep(Math.max(0, Math.min(STEP_KEYS.length - 1, s)));
    setShowErrors(false);
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const next = () => {
    if (stepErrors(step).length) { setShowErrors(true); return; }
    goStep(step + 1);
  };

  // ── 附件 ──────────────────────────────────────────────
  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setAttachError('');
    const room = MAX_ATTACHMENTS - report.attachments.length;
    for (const file of Array.from(files).slice(0, Math.max(0, room))) {
      try {
        const { dataUrl, size, mime } = await compressImage(file);
        setReport(r => ({
          ...r,
          attachments: [...r.attachments, {
            id: newId('at'), name: file.name, mime, size, dataUrl,
            addedAt: new Date().toISOString(),
          }],
        }));
      } catch (e: any) {
        setAttachError(e?.message === 'FILE_TOO_LARGE' ? t('ae.attach.tooLarge') : t('ae.attach.failed'));
      }
    }
  };

  // ── 送出 ──────────────────────────────────────────────
  const submit = async () => {
    if (errors.length) { setShowErrors(true); return; }
    setSubmitting(true);
    setSubmitError('');
    setSubmitErrorKind('');
    try {
      const now = new Date().toISOString();
      const finalReport: AEReport = {
        ...report,
        // ⚠️ 已知缺口（沿用 PV-Link 遠端模式的行為）：手機看不到其他人的個案，這裡等於每次都從
        // 空清單起算，所有業務送出的個案號都會是 PV-<年>-0001；後端也不重編、不檢查唯一。
        // 要改成由 Worker 在建檔時配號，見 docs/ae-integration-plan.md 的已知缺口。
        caseNumber: report.caseNumber || nextCaseNumber([], todayIso()),
        status: 'submitted',
        reportDate: report.reportDate || todayIso(),
        narrative: report.narrative || autoNarrative(report, todayIso()),
        updatedAt: now,
        auditTrail: [...(report.auditTrail || []), {
          at: now,
          actor: report.reporterName || 'field-reporter',
          action: 'submit',
          detail: `完整度 ${completeness}%，${seriousness.serious ? '嚴重' : '非嚴重'}`,
        }],
      };
      const res = await submitAEReport(finalReport);
      const outcome = classifyFormSubmission(res);
      setPending(await outboxCount());
      if (outcome.mayClearDraft) {
        // 讓舊 debounce 排程／飛行中的寫入先失效並落地，再刪除；
        // 失敗也不能把唯一草稿丟掉。
        try {
          await draftCoordinator.invalidateAndSettle();
          await finalizeFormSubmission(res, () => removeValue(AE_DRAFT_KEY));
        } catch {
          // 遠端或佇列已成功保存另一份副本，只是清除原草稿失敗：
          // 誠實提示「已保存但未清稿」，不得顯示「未確認送達」誤導使用者重送。
          setSubmitError(t('ae.submit.draftClearFailed'));
          setSubmitErrorKind('draftClearFailed');
          return;
        }
        setDone({ caseNumber: finalReport.caseNumber, channel: res.channel });
      } else {
        // outbox 的 IndexedDB 與 localStorage 都失敗時，保留目前表單／draft，
        // 不導向 Done，也不以 queued 或 remote 名義宣稱送達。
        setSubmitError(res.message || t('ae.submit.unconfirmed'));
        setSubmitErrorKind('unconfirmed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const removeCurrentDraft = async () => {
    await draftCoordinator.invalidateAndSettle();
    await removeValue(AE_DRAFT_KEY);
  };

  const startNew = async () => {
    await removeCurrentDraft();
    setReport(emptyAEReport(todayIso()));
    setDone(null);
    setSubmitError('');
    setSubmitErrorKind('');
    setStep(0);
    setRestoredDraft(false);
  };

  const discardDraft = async () => {
    await removeCurrentDraft();
    setReport(emptyAEReport(todayIso()));
    setSubmitError('');
    setSubmitErrorKind('');
    setRestoredDraft(false);
    setStep(0);
  };

  // ─────────────────────────────────────────────────────
  if (showHistory) return <MyReportsScreen onClose={() => setShowHistory(false)} t={t} />;
  if (done) return <DoneScreen done={done} onNew={startNew} t={t} />;

  return (
    <div className="min-h-[100dvh] flex flex-col font-sans text-slate-900 dark:text-slate-100 bg-canvas">
      {/* 背景：與後台同一套水彩語言，但強度降低，避免手機上干擾閱讀 */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute -top-[15%] -left-[20%] w-[70%] h-[40%] bg-brand-200/30 dark:bg-brand-500/15 rounded-full blur-[100px]" />
        <div className="absolute top-[45%] -right-[25%] w-[70%] h-[40%] bg-danger-200/30 dark:bg-danger-500/10 rounded-full blur-[100px]" />
      </div>

      {/* 頂部：標題 + 進度。sticky 讓使用者隨時知道自己在第幾步 */}
      <header className="sticky top-0 z-30 bg-white/92 dark:bg-slate-900/92 backdrop-blur-xl border-b border-white/60 dark:border-white/10">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-base font-black tracking-tight truncate">{t('ae.mobile.title')}</h1>
            <p className="text-xs font-bold text-muted">
              {t('ae.mobile.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {!online && <Badge tone="caution">{t('ae.offline.badge')}</Badge>}
            {pending > 0 && <Badge tone="danger">{pending} {t('ae.outbox.pending')}</Badge>}
            <button onClick={() => setShowHistory(true)} aria-label={t('ae.mobile.myReports')}
              className="w-10 h-10 rounded-xl bg-white/60 dark:bg-white/10 border border-white/60 dark:border-white/10 flex items-center justify-center">
              <ClipboardDocumentListIcon className="w-5 h-5" />
            </button>
            <button onClick={toggle} aria-label={t('header.themeToggle')}
              className="w-10 h-10 rounded-xl bg-white/60 dark:bg-white/10 border border-white/60 dark:border-white/10 text-sm">
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              className="w-10 h-10 rounded-xl bg-white/60 dark:bg-white/10 border border-white/60 dark:border-white/10 text-xs font-bold">
              {lang === 'zh' ? 'EN' : '中'}
            </button>
          </div>
        </div>

        <div className="px-4 pb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-brand-700 dark:text-brand-300">
              {step + 1}/{STEP_KEYS.length}　{t(STEP_KEYS[step] as any)}
            </span>
            <span className="text-xs font-bold text-muted flex items-center gap-1">
              {draftState === 'saving' ? t('ae.draft.saving') : draftState === 'saved' ? `✓ ${t('ae.draft.saved')}` : ''}
            </span>
          </div>
          <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-brand-600 transition-all duration-300"
              style={{ width: `${((step + 1) / STEP_KEYS.length) * 100}%` }} />
          </div>
        </div>
      </header>

      {restoredDraft && step === 0 && (
        <div className="mx-4 mt-3 px-4 py-3 rounded-2xl bg-caution-50 dark:bg-caution-500/10 border border-caution-300 dark:border-caution-500/30 flex items-center justify-between gap-3">
          <span className="text-xs font-bold text-caution-900 dark:text-caution-200">{t('ae.draft.restored')}</span>
          <button onClick={discardDraft} className="text-xs font-bold text-caution-900 dark:text-caution-200 underline shrink-0 min-h-[44px] px-2">
            {t('ae.draft.discard')}
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 pb-40 space-y-4">
        {submitError && (
          <div role="alert" className="px-4 py-3 rounded-2xl bg-danger-50 dark:bg-danger-500/10 border-2 border-danger-300 dark:border-danger-500/40 space-y-1">
            <p className="text-xs font-bold text-danger-800 dark:text-danger-300 flex items-center gap-1.5">
              <ExclamationTriangleIcon className="w-4 h-4" />
              {submitErrorKind === 'draftClearFailed' ? t('ae.submit.draftClearFailed') : t('ae.submit.unconfirmed')}
            </p>
            <p className="text-xs font-bold text-danger-700 dark:text-danger-300">{submitError}</p>
          </div>
        )}
        {/* role=alert：按下一步被攔下時，螢幕閱讀器使用者看不到紅色區塊出現，
            沒有這個就只知道「頁面沒動」卻不知道為什麼。 */}
        {showErrors && stepErrors(step).length > 0 && (
          <div role="alert" className="px-4 py-3 rounded-2xl bg-danger-50 dark:bg-danger-500/10 border-2 border-danger-300 dark:border-danger-500/40 space-y-1">
            <p className="text-xs font-bold text-danger-800 dark:text-danger-300 flex items-center gap-1.5">
              <ExclamationTriangleIcon className="w-4 h-4" />{t('ae.review.blockers')}
            </p>
            {stepErrors(step).map((i, k) => (
              <p key={k} className="text-xs font-bold text-danger-700 dark:text-danger-300 pl-5">
                • {t(`ae.issue.${i.code}` as any)}{i.detail ? `（${i.detail}）` : ''}
              </p>
            ))}
          </div>
        )}

        {step === 0 && <StepReporter report={report} patch={patch} t={t} lang={lang}
          hasProfile={Boolean(profile?.displayName)} onEditProfile={onEditProfile} />}
        {step === 1 && <StepPatient report={report} patch={patch} t={t} lang={lang} />}
        {step === 2 && <StepEvents report={report} patch={patch} patchEvent={patchEvent} setReport={setReport} t={t} lang={lang} />}
        {step === 3 && <StepDrugs report={report} patchDrug={patchDrug} setReport={setReport} t={t} lang={lang} suspect />}
        {step === 4 && <StepHistory report={report} patch={patch} patchDrug={patchDrug} setReport={setReport} t={t} lang={lang} />}
        {step === 5 && (
          <StepReview
            report={report} patch={patch} t={t} lang={lang}
            minCriteria={minCriteria} errors={errors} warnings={warnings}
            seriousness={seriousness} completeness={completeness}
            attachError={attachError} onPickFiles={onPickFiles}
            onRemoveAttachment={id => setReport(r => ({ ...r, attachments: r.attachments.filter(a => a.id !== id) }))}
            onGoStep={goStep}
          />
        )}
      </div>

      {/* 底部操作列：固定於視窗底，含 iOS 安全區內距，拇指可及 */}
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white/85 dark:bg-slate-900/85 backdrop-blur-xl border-t border-white/60 dark:border-white/10 px-4 py-3"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="max-w-lg mx-auto flex gap-3">
          <button onClick={() => goStep(step - 1)} disabled={step === 0}
            className="min-h-[52px] px-5 rounded-2xl font-black text-sm border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 disabled:opacity-40 flex items-center gap-1">
            <ChevronLeftIcon className="w-5 h-5" />{t('ae.nav.prev')}
          </button>
          {step < STEP_KEYS.length - 1 ? (
            <button onClick={next}
              className="flex-1 min-h-[52px] rounded-2xl bg-brand-600 text-white font-black text-sm shadow-lg flex items-center justify-center gap-1 active:bg-brand-700">
              {t('ae.nav.next')}<ChevronRightIcon className="w-5 h-5" />
            </button>
          ) : (
            <button onClick={submit} disabled={submitting} aria-busy={submitting}
              className="flex-1 min-h-[52px] rounded-2xl bg-success-700 text-white font-black text-sm shadow-lg flex items-center justify-center gap-2 active:bg-success-800 disabled:opacity-60">
              {submitting
                ? <><ArrowPathIcon className="w-5 h-5 animate-spin" />{t('ae.nav.submitting')}</>
                : <><PaperAirplaneIcon className="w-5 h-5" />{t('ae.nav.submit')}</>}
            </button>
          )}
        </div>
      </nav>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// 各步驟
// ─────────────────────────────────────────────────────────────

type StepProps = {
  report: AEReport;
  patch: (p: Partial<AEReport>) => void;
  t: (k: any) => string;
  lang: 'zh' | 'en';
};

const SectionCard: React.FC<{ title: string; children: React.ReactNode; note?: string }> = ({ title, children, note }) => (
  <Card className="p-5 space-y-4">
    <div>
      <h2 className="text-sm font-black tracking-tight">{title}</h2>
      {note && <p className="text-xs text-muted mt-1 leading-relaxed">{note}</p>}
    </div>
    {children}
  </Card>
);

/**
 * 通報者那一段：有個人檔案時收成一張摘要卡，沒有時退回原本的六個輸入框。
 *
 * 為什麼有檔案就不給直接編輯：這幾個欄位的真實來源是個人檔案。若在表單裡也能改，
 * 兩邊會分岔——這一份通報寫著新電話、檔案裡還是舊的，下一份又變回舊的。
 * 要改就改檔案，一次改完所有未來的通報。
 *
 * 真的要替別人通報時，用下面的「原始通報者」區塊（CIOMS 26 的醫療專業人員），
 * 那才是這個表格裡代人通報的正確位置。
 */
const ReporterSelfSection: React.FC<{
  report: AEReport;
  patch: (p: Partial<AEReport>) => void;
  t: (k: any) => string;
  hasProfile: boolean;
  onEditProfile?: () => void;
}> = ({ report, patch, t, hasProfile, onEditProfile }) => {
  if (!hasProfile) {
    return (
      <SectionCard title={t('ae.section.reporterSelf')}>
        <Field label={t('ae.f.reporterName')} required tag="CIOMS 26">
          <TextInput value={report.reporterName} autoComplete="name"
            onChange={e => patch({ reporterName: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('ae.f.reporterEmployeeId')}>
            <TextInput value={report.reporterEmployeeId} inputMode="text"
              onChange={e => patch({ reporterEmployeeId: e.target.value })} />
          </Field>
          <Field label={t('ae.f.reporterTerritory')}>
            <TextInput value={report.reporterTerritory}
              onChange={e => patch({ reporterTerritory: e.target.value })} />
          </Field>
        </div>
        <Field label={t('ae.f.reporterPhone')} required>
          <TextInput type="tel" inputMode="tel" autoComplete="tel" value={report.reporterPhone}
            onChange={e => patch({ reporterPhone: e.target.value })} />
        </Field>
        <Field label={t('ae.f.reporterEmail')}>
          <TextInput type="email" inputMode="email" autoComplete="email" value={report.reporterEmail}
            onChange={e => patch({ reporterEmail: e.target.value })} />
        </Field>
        <Field label={t('ae.f.reporterOrg')} tag="CIOMS 24a">
          <TextInput value={report.reporterOrg} onChange={e => patch({ reporterOrg: e.target.value })} />
        </Field>
      </SectionCard>
    );
  }

  const line2 = [report.reporterEmployeeId, report.reporterTerritory].filter(Boolean).join('　·　');
  const line3 = [report.reporterPhone, report.reporterEmail].filter(Boolean).join('　·　');

  return (
    <SectionCard title={t('ae.section.reporterSelf')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="font-black text-sm truncate">{report.reporterName || '—'}</p>
          {line2 && <p className="text-xs font-bold text-muted truncate">{line2}</p>}
          {line3 && <p className="text-xs font-bold text-slate-600 dark:text-slate-300 truncate">{line3}</p>}
          {report.reporterOrg && (
            <p className="text-xs font-bold text-muted truncate">{report.reporterOrg}</p>
          )}
        </div>
        {onEditProfile && (
          <button type="button" onClick={onEditProfile}
            className="shrink-0 min-h-[44px] px-3 rounded-xl border-2 border-slate-300 dark:border-slate-600 text-xs font-bold">
            {t('ae.profile.edit')}
          </button>
        )}
      </div>
      <p className="text-xs font-bold text-muted leading-relaxed">
        {t('ae.profile.autofillNote')}
      </p>
    </SectionCard>
  );
};

const StepReporter: React.FC<StepProps & { hasProfile: boolean; onEditProfile?: () => void }> = ({
  report, patch, t, lang, hasProfile, onEditProfile,
}) => (
  <>
    <ReporterSelfSection report={report} patch={patch} t={t}
      hasProfile={hasProfile} onEditProfile={onEditProfile} />

    <SectionCard title={t('ae.section.awareness')}>
      <Field label={t('ae.f.awarenessDate')} required tag="CIOMS 24c" hint={t('ae.f.awarenessHint')}>
        <TextInput type="date" value={report.awarenessDate} max={todayIso()}
          onChange={e => patch({ awarenessDate: e.target.value })} />
      </Field>
      <Field label={t('ae.f.reportSource')} required tag="CIOMS 24d">
        <ChipGroup options={REPORT_SOURCE_OPTIONS} value={report.reportSource} lang={lang} cols={1}
          onChange={v => patch({ reportSource: v })} />
      </Field>
      {/*
        來源端獲知日只對「轉手來的個案」有意義：主管機關轉知與文獻，都是別人先知道、
        再流到我們手上。業務自己在客戶端遇到的個案沒有這個中間層，多一個欄位只是雜訊，
        所以依來源條件顯示而非永遠顯示。
      */}
      {(report.reportSource === 'regulatory' || report.reportSource === 'literature') && (
        <Field label={t('ae.f.sourceAwarenessDate')} hint={t('ae.f.sourceAwarenessHint')}>
          <TextInput type="date" value={report.sourceAwarenessDate} max={todayIso()}
            onChange={e => patch({ sourceAwarenessDate: e.target.value })} />
        </Field>
      )}
      {/* 國別預設台灣，境內通報一次也不用點；境外個案（原廠轉知、國外文獻）才需要改。 */}
      <Field label={t('ae.f.country')} required tag="CIOMS 1a" hint={t('ae.f.countryHint')}>
        <ChipGroup options={COUNTRY_OPTIONS} value={report.country} lang={lang} clearable={false}
          onChange={v => patch({ country: v })} />
      </Field>
      {report.country === 'other' && (
        <Field label={t('ae.f.countryOther')} required>
          <TextInput value={report.countryOther} placeholder={t('ae.f.countryOtherPlaceholder')}
            onChange={e => patch({ countryOther: e.target.value })} />
        </Field>
      )}
    </SectionCard>

    <SectionCard title={t('ae.section.primaryReporter')} note={t('ae.section.primaryReporterNote')}>
      <Field label={t('ae.f.primaryReporterName')}>
        <TextInput value={report.primaryReporterName}
          onChange={e => patch({ primaryReporterName: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('ae.f.primaryReporterProfession')}>
          <TextInput value={report.primaryReporterProfession}
            onChange={e => patch({ primaryReporterProfession: e.target.value })} />
        </Field>
        <Field label={t('ae.f.primaryReporterOrg')}>
          <TextInput value={report.primaryReporterOrg}
            onChange={e => patch({ primaryReporterOrg: e.target.value })} />
        </Field>
      </div>
      <Field label={t('ae.f.primaryReporterContact')}>
        <TextInput type="tel" inputMode="tel" value={report.primaryReporterContact}
          onChange={e => patch({ primaryReporterContact: e.target.value })} />
      </Field>
      <button type="button" onClick={() => patch({ primaryReporterConsentFollowUp: !report.primaryReporterConsentFollowUp })}
        className={`w-full min-h-[48px] px-4 rounded-2xl text-sm font-black border-2 flex items-center gap-3 text-left ${
          report.primaryReporterConsentFollowUp
            ? 'bg-success-700 text-white border-success-700'
            : 'bg-white/70 dark:bg-slate-800/70 border-slate-300 dark:border-slate-600'
        }`}>
        <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-xs ${
          report.primaryReporterConsentFollowUp ? 'bg-white/25 border-white' : 'border-slate-400'
        }`}>{report.primaryReporterConsentFollowUp ? '✓' : ''}</span>
        {t('ae.f.consentFollowUp')}
      </button>
    </SectionCard>
  </>
);

const StepPatient: React.FC<StepProps> = ({ report, patch, t, lang }) => (
  <>
    <SectionCard title={t('ae.section.patientId')} note={t('ae.f.patientInitialsHint')}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('ae.f.patientInitials')} tag="CIOMS 1">
          <TextInput value={report.patientInitials} placeholder="W.M."
            onChange={e => patch({ patientInitials: e.target.value })} />
        </Field>
        <Field label={t('ae.f.patientId')}>
          <TextInput value={report.patientId} onChange={e => patch({ patientId: e.target.value })} />
        </Field>
      </div>
      <Field label={t('ae.f.patientSex')} required tag="CIOMS 3">
        <ChipGroup options={SEX_OPTIONS} value={report.patientSex} lang={lang}
          onChange={v => patch({ patientSex: v })} />
      </Field>
      <Field label={t('ae.f.patientBirthDate')} tag="CIOMS 2">
        <TextInput type="date" value={report.patientBirthDate} max={todayIso()}
          onChange={e => patch({ patientBirthDate: e.target.value })} />
      </Field>
      <Field label={t('ae.f.patientAge')} tag="CIOMS 2a">
        <div className="flex gap-2">
          <TextInput type="number" inputMode="numeric" min={0} max={130} value={report.patientAgeValue}
            className="flex-1" onChange={e => patch({ patientAgeValue: e.target.value })} />
          <div className="w-[46%]">
            <ChipGroup options={AGE_UNIT_OPTIONS} value={report.patientAgeUnit} lang={lang} clearable={false}
              onChange={v => patch({ patientAgeUnit: v })} />
          </div>
        </div>
      </Field>
    </SectionCard>

    <SectionCard title={t('ae.section.patientPhysio')}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('ae.f.patientWeight')} tag="E2B D.3">
          <TextInput type="number" inputMode="decimal" step="0.1" value={report.patientWeightKg}
            onChange={e => patch({ patientWeightKg: e.target.value })} />
        </Field>
        <Field label={t('ae.f.patientHeight')} tag="E2B D.4">
          <TextInput type="number" inputMode="numeric" value={report.patientHeightCm}
            onChange={e => patch({ patientHeightCm: e.target.value })} />
        </Field>
      </div>
      <Field label={t('ae.f.pregnancy')}>
        <ChipGroup options={PREGNANCY_OPTIONS} value={report.pregnancy} lang={lang}
          onChange={v => patch({ pregnancy: v })} />
      </Field>
      {report.pregnancy === 'yes' && (
        <Field label={t('ae.f.lmp')} tag="CIOMS 23">
          <TextInput type="date" value={report.lastMenstrualPeriod} max={todayIso()}
            onChange={e => patch({ lastMenstrualPeriod: e.target.value })} />
        </Field>
      )}
    </SectionCard>
  </>
);

const StepEvents: React.FC<StepProps & {
  patchEvent: (id: string, p: Partial<AEEvent>) => void;
  setReport: React.Dispatch<React.SetStateAction<AEReport>>;
}> = ({ report, patch, patchEvent, setReport, t, lang }) => {
  const anyDeath = report.events.some(e => e.seriousnessCriteria.includes('death'));
  return (
    <>
      {report.events.map((ev, idx) => (
        <SectionCard key={ev.id} title={`${t('ae.event.index')} ${idx + 1}`}>
          <Field label={t('ae.f.eventVerbatim')} required tag="CIOMS 7+13" hint={t('ae.f.eventVerbatimHint')}>
            <TextArea rows={3} value={ev.verbatim} placeholder={t('ae.f.eventVerbatimPlaceholder')}
              onChange={e => patchEvent(ev.id, { verbatim: e.target.value })} />
          </Field>
          {/* 日期欄在手機上直排、≥640px 才並排：390px 寬並排時每格只剩約 150px，
              年份會被截成「09/19/202」；iPhone 中文顯示「2026年9月19日」更長。
              字級不能為了塞進去而縮小——輸入框小於 16px 時 iOS 會自動放大整頁。
              下方用藥起訖、批號／效期同理。 */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('ae.f.onsetDate')} required tag="CIOMS 4-6">
              <TextInput type="date" value={ev.onsetDate} max={todayIso()}
                onChange={e => patchEvent(ev.id, { onsetDate: e.target.value })} />
            </Field>
            <Field label={t('ae.f.endDate')}>
              <TextInput type="date" value={ev.endDate} max={todayIso()}
                onChange={e => patchEvent(ev.id, { endDate: e.target.value })} />
            </Field>
          </div>
          <Field label={t('ae.f.outcome')} tag="E2B E.i.7">
            <ChipGroup options={OUTCOME_OPTIONS} value={ev.outcome} lang={lang}
              onChange={v => patchEvent(ev.id, { outcome: v })} />
          </Field>
          <Field label={t('ae.f.seriousness')} tag="CIOMS I" hint={t('ae.f.seriousnessHint')}>
            <CheckGroup options={SERIOUSNESS_CRITERIA as unknown as readonly Option[]} tone="danger" lang={lang}
              values={ev.seriousnessCriteria}
              onChange={v => patchEvent(ev.id, { seriousnessCriteria: v as SeriousnessCriterion[] })} />
          </Field>
          {report.events.length > 1 && (
            <button type="button"
              onClick={() => setReport(r => ({ ...r, events: r.events.filter(e => e.id !== ev.id) }))}
              className="min-h-[44px] w-full rounded-2xl border-2 border-danger-300 dark:border-danger-500/40 text-danger-700 dark:text-danger-300 text-xs font-bold flex items-center justify-center gap-1.5">
              <TrashIcon className="w-4 h-4" />{t('ae.event.remove')}
            </button>
          )}
        </SectionCard>
      ))}

      <button type="button" onClick={() => setReport(r => ({ ...r, events: [...r.events, emptyEvent()] }))}
        className="w-full min-h-[52px] rounded-2xl border-2 border-dashed border-brand-400 dark:border-brand-500/50 text-brand-700 dark:text-brand-300 font-black text-sm flex items-center justify-center gap-2">
        <PlusIcon className="w-5 h-5" />{t('ae.event.add')}
      </button>

      {anyDeath && (
        <SectionCard title={t('ae.section.death')}>
          <Field label={t('ae.f.deathDate')} required>
            <TextInput type="date" value={report.deathDate} max={todayIso()}
              onChange={e => patch({ deathDate: e.target.value })} />
          </Field>
          <Field label={t('ae.f.causeOfDeath')}>
            <TextInput value={report.causeOfDeath} onChange={e => patch({ causeOfDeath: e.target.value })} />
          </Field>
          <Field label={t('ae.f.autopsy')}>
            <ChipGroup options={AUTOPSY_OPTIONS} value={report.autopsyDone} lang={lang}
              onChange={v => patch({ autopsyDone: v })} />
          </Field>
        </SectionCard>
      )}

      <SectionCard title={t('ae.section.lab')}>
        <Field label={t('ae.f.labData')} tag="CIOMS 13">
          <TextArea rows={3} value={report.labData} placeholder={t('ae.f.labDataPlaceholder')}
            onChange={e => patch({ labData: e.target.value })} />
        </Field>
      </SectionCard>
    </>
  );
};

/** 藥品區塊。suspect=true 時為第 II 節懷疑藥品；否則為第 III 節併用藥品。 */
const DrugCard: React.FC<{
  drug: AEDrug; index: number; removable: boolean;
  patchDrug: (id: string, p: Partial<AEDrug>) => void;
  onRemove: () => void;
  t: (k: any) => string; lang: 'zh' | 'en';
}> = ({ drug, index, removable, patchDrug, onRemove, t, lang }) => (
  <SectionCard title={`${drug.isSuspect ? t('ae.drug.suspect') : t('ae.f.concomitant')} ${index + 1}`}>
    <Field label={t('ae.f.brandName')} required={drug.isSuspect} tag="CIOMS 14">
      <TextInput value={drug.brandName} onChange={e => patchDrug(drug.id, { brandName: e.target.value })} />
    </Field>
    <Field label={t('ae.f.activeIngredient')}>
      <TextInput value={drug.activeIngredient} onChange={e => patchDrug(drug.id, { activeIngredient: e.target.value })} />
    </Field>
    {drug.isSuspect && (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('ae.f.lotNumber')} hint={t('ae.f.lotHint')}>
          <TextInput value={drug.lotNumber} onChange={e => patchDrug(drug.id, { lotNumber: e.target.value })} />
        </Field>
        <Field label={t('ae.f.expiryDate')}>
          <TextInput type="month" value={drug.expiryDate} onChange={e => patchDrug(drug.id, { expiryDate: e.target.value })} />
        </Field>
      </div>
    )}
    <div className="grid grid-cols-2 gap-3">
      <Field label={t('ae.f.dailyDose')} tag="CIOMS 15">
        <TextInput value={drug.dailyDose} placeholder="e.g. 500 mg BID"
          onChange={e => patchDrug(drug.id, { dailyDose: e.target.value })} />
      </Field>
      <Field label={t('ae.f.indication')} tag="CIOMS 17">
        <TextInput value={drug.indication} onChange={e => patchDrug(drug.id, { indication: e.target.value })} />
      </Field>
    </div>
    <Field label={t('ae.f.route')} tag="CIOMS 16">
      <ChipGroup options={ROUTE_OPTIONS} value={drug.route} lang={lang}
        onChange={v => patchDrug(drug.id, { route: v })} />
    </Field>
    {drug.route === 'other' && (
      <Field label={t('ae.f.routeOther')}>
        <TextInput value={drug.routeOther} onChange={e => patchDrug(drug.id, { routeOther: e.target.value })} />
      </Field>
    )}
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t('ae.f.therapyStart')} tag="CIOMS 18">
        <TextInput type="date" value={drug.therapyStart} max={todayIso()}
          onChange={e => patchDrug(drug.id, { therapyStart: e.target.value })} />
      </Field>
      <Field label={t('ae.f.therapyEnd')}>
        <TextInput type="date" value={drug.therapyEnd} max={todayIso()}
          onChange={e => patchDrug(drug.id, { therapyEnd: e.target.value })} />
      </Field>
    </div>
    {drug.isSuspect && (
      <>
        <Field label={t('ae.f.dechallenge')} tag="CIOMS 20">
          <ChipGroup options={YES_NO_UNK_OPTIONS} value={drug.dechallenge} lang={lang}
            onChange={v => patchDrug(drug.id, { dechallenge: v as any })} />
        </Field>
        <Field label={t('ae.f.rechallenge')} tag="CIOMS 21">
          <ChipGroup options={YES_NO_UNK_OPTIONS} value={drug.rechallenge} lang={lang}
            onChange={v => patchDrug(drug.id, { rechallenge: v as any })} />
        </Field>
        <Field label={t('ae.f.actionTaken')} tag="E2B G.k.8">
          <ChipGroup options={ACTION_TAKEN_OPTIONS} value={drug.actionTaken} lang={lang}
            onChange={v => patchDrug(drug.id, { actionTaken: v })} />
        </Field>
        <Field label={t('ae.f.licenseNo')}>
          <TextInput value={drug.licenseNo} placeholder="衛部藥輸字第 000000 號"
            onChange={e => patchDrug(drug.id, { licenseNo: e.target.value })} />
        </Field>
      </>
    )}
    {removable && (
      <button type="button" onClick={onRemove}
        className="min-h-[44px] w-full rounded-2xl border-2 border-danger-300 dark:border-danger-500/40 text-danger-700 dark:text-danger-300 text-xs font-bold flex items-center justify-center gap-1.5">
        <TrashIcon className="w-4 h-4" />{t('ae.drug.remove')}
      </button>
    )}
  </SectionCard>
);

const StepDrugs: React.FC<Omit<StepProps, 'patch'> & {
  patchDrug: (id: string, p: Partial<AEDrug>) => void;
  setReport: React.Dispatch<React.SetStateAction<AEReport>>;
  suspect: boolean;
}> = ({ report, patchDrug, setReport, t, lang }) => {
  const suspects = report.drugs.filter(d => d.isSuspect);
  return (
    <>
      {suspects.map((d, i) => (
        <DrugCard key={d.id} drug={d} index={i} removable={suspects.length > 1}
          patchDrug={patchDrug} t={t} lang={lang}
          onRemove={() => setReport(r => ({ ...r, drugs: r.drugs.filter(x => x.id !== d.id) }))} />
      ))}
      <button type="button" onClick={() => setReport(r => ({ ...r, drugs: [...r.drugs, emptyDrug(true)] }))}
        className="w-full min-h-[52px] rounded-2xl border-2 border-dashed border-brand-400 dark:border-brand-500/50 text-brand-700 dark:text-brand-300 font-black text-sm flex items-center justify-center gap-2">
        <PlusIcon className="w-5 h-5" />{t('ae.drug.addSuspect')}
      </button>
    </>
  );
};

const StepHistory: React.FC<StepProps & {
  patchDrug: (id: string, p: Partial<AEDrug>) => void;
  setReport: React.Dispatch<React.SetStateAction<AEReport>>;
}> = ({ report, patch, patchDrug, setReport, t, lang }) => {
  const concomitant = report.drugs.filter(d => !d.isSuspect);
  return (
    <>
      <SectionCard title={t('ae.section.concomitant')} note={t('ae.section.concomitantNote')}>
        {concomitant.length === 0 && (
          <p className="text-xs text-muted">{t('ae.section.concomitantEmpty')}</p>
        )}
      </SectionCard>

      {concomitant.map((d, i) => (
        <DrugCard key={d.id} drug={d} index={i} removable
          patchDrug={patchDrug} t={t} lang={lang}
          onRemove={() => setReport(r => ({ ...r, drugs: r.drugs.filter(x => x.id !== d.id) }))} />
      ))}

      <button type="button" onClick={() => setReport(r => ({ ...r, drugs: [...r.drugs, emptyDrug(false)] }))}
        className="w-full min-h-[52px] rounded-2xl border-2 border-dashed border-slate-400 dark:border-slate-500 text-slate-600 dark:text-slate-300 font-black text-sm flex items-center justify-center gap-2">
        <PlusIcon className="w-5 h-5" />{t('ae.drug.addConcomitant')}
      </button>

      <SectionCard title={t('ae.section.history')}>
        <Field label={t('ae.f.medicalHistory')} tag="CIOMS 23" hint={t('ae.f.medicalHistoryHint')}>
          <TextArea rows={3} value={report.medicalHistory}
            onChange={e => patch({ medicalHistory: e.target.value })} />
        </Field>
        <Field label={t('ae.f.allergies')}>
          <TextArea rows={2} value={report.allergies}
            onChange={e => patch({ allergies: e.target.value })} />
        </Field>
        <Field label={t('ae.f.narrative')} tag="E2B H.1" hint={t('ae.f.narrativeHint')}>
          <TextArea rows={4} value={report.narrative}
            onChange={e => patch({ narrative: e.target.value })} />
        </Field>
      </SectionCard>
    </>
  );
};

const StepReview: React.FC<StepProps & {
  minCriteria: ReturnType<typeof checkMinimumCriteria>;
  errors: ReturnType<typeof validateAEReport>;
  warnings: ReturnType<typeof validateAEReport>;
  seriousness: ReturnType<typeof assessSeriousness>;
  completeness: number;
  attachError: string;
  onPickFiles: (f: FileList | null) => void;
  onRemoveAttachment: (id: string) => void;
  onGoStep: (s: number) => void;
}> = ({ report, t, lang, minCriteria, errors, warnings, seriousness, completeness,
  attachError, onPickFiles, onRemoveAttachment, onGoStep }) => {
  const criteriaRows: { key: string; ok: boolean }[] = [
    { key: 'ae.min.patient', ok: minCriteria.identifiablePatient },
    { key: 'ae.min.reporter', ok: minCriteria.identifiableReporter },
    { key: 'ae.min.product', ok: minCriteria.suspectProduct },
    { key: 'ae.min.event', ok: minCriteria.adverseEvent },
  ];
  return (
    <>
      <SectionCard title={t('ae.f.attachments')} note={t('ae.attach.limit')}>
        <label className="w-full min-h-[56px] rounded-2xl border-2 border-dashed border-brand-400 dark:border-brand-500/50 text-brand-700 dark:text-brand-300 font-black text-sm flex items-center justify-center gap-2 cursor-pointer">
          <CameraIcon className="w-5 h-5" />{t('ae.attach.add')}
          <input type="file" accept="image/*,application/pdf" multiple capture="environment"
            className="hidden" onChange={e => { onPickFiles(e.target.files); e.currentTarget.value = ''; }} />
        </label>
        {attachError && <p className="text-xs font-bold text-danger-700 dark:text-danger-300">{attachError}</p>}
        {report.attachments.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {report.attachments.map(a => (
              <div key={a.id} className="relative aspect-square rounded-xl overflow-hidden border-2 border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800">
                {a.mime.startsWith('image/')
                  ? <img src={attachmentSrc(a)} alt={a.name} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-xs font-bold p-1 text-center break-all">{a.name}</div>}
                <button type="button" onClick={() => onRemoveAttachment(a.id)}
                  className="absolute top-1 right-1 w-8 h-8 rounded-full bg-danger-600 text-white flex items-center justify-center shadow">
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title={t('ae.review.minCriteria')}>
        <div className="space-y-2">
          {criteriaRows.map(c => (
            <div key={c.key} className="flex items-center gap-2 text-sm font-bold">
              {c.ok
                ? <CheckCircleIcon className="w-5 h-5 text-success-700 dark:text-success-300 shrink-0" />
                : <ShieldExclamationIcon className="w-5 h-5 text-danger-700 dark:text-danger-300 shrink-0" />}
              <span className={c.ok ? '' : 'text-danger-700 dark:text-danger-300'}>{t(c.key)}</span>
            </div>
          ))}
        </div>
        <div className="pt-2">
          <div className="flex justify-between text-xs font-bold mb-1">
            <span>{t('ae.review.completeness')}</span><span className="tabular-nums">{completeness}%</span>
          </div>
          <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div className={`h-full transition-all ${completeness >= 70 ? 'bg-success-500' : completeness >= 40 ? 'bg-caution-500' : 'bg-danger-500'}`}
              style={{ width: `${completeness}%` }} />
          </div>
        </div>
      </SectionCard>

      <div className={`px-5 py-4 rounded-3xl border-2 ${
        seriousness.serious
          ? 'bg-danger-50 dark:bg-danger-500/10 border-danger-300 dark:border-danger-500/40'
          : 'bg-slate-50 dark:bg-slate-800/50 border-slate-300 dark:border-slate-600'
      }`}>
        <p className={`text-sm font-black flex items-center gap-2 ${seriousness.serious ? 'text-danger-800 dark:text-danger-300' : ''}`}>
          {seriousness.serious ? <ExclamationTriangleIcon className="w-5 h-5" /> : <CheckCircleIcon className="w-5 h-5" />}
          {seriousness.serious ? t('ae.review.serious') : t('ae.review.nonSerious')}
        </p>
        {seriousness.serious && (
          <p className="text-xs font-bold text-danger-700 dark:text-danger-300 mt-1.5 leading-relaxed">
            {t('ae.review.seriousHint').replace('{days}', String(MAH_SERIOUS_REPORT_DAYS))}
          </p>
        )}
      </div>

      {errors.length > 0 && (
        <SectionCard title={t('ae.review.blockers')}>
          <div className="space-y-2">
            {errors.map((i, k) => (
              <button key={k} type="button" onClick={() => onGoStep(i.step ?? 0)}
                className="w-full text-left min-h-[44px] px-3 py-2 rounded-xl bg-danger-50 dark:bg-danger-500/10 border border-danger-300 dark:border-danger-500/40 text-xs font-bold text-danger-800 dark:text-danger-300">
                • {t(`ae.issue.${i.code}`)}{i.detail ? `（${i.detail}）` : ''}
              </button>
            ))}
          </div>
        </SectionCard>
      )}

      {warnings.length > 0 && (
        <SectionCard title={t('ae.review.warnings')}>
          <div className="space-y-1.5">
            {warnings.map((i, k) => (
              <button key={k} type="button" onClick={() => onGoStep(i.step ?? 0)}
                className="w-full text-left min-h-[40px] px-3 py-2 rounded-xl bg-caution-50 dark:bg-caution-500/10 border border-caution-300 dark:border-caution-500/30 text-xs font-bold text-caution-900 dark:text-caution-200">
                • {t(`ae.issue.${i.code}`)}{i.detail ? `（${i.detail}）` : ''}
              </button>
            ))}
          </div>
        </SectionCard>
      )}

      <p className="text-xs text-muted leading-relaxed px-2 pb-2">
        {t('ae.review.privacy')}
      </p>
    </>
  );
};

/**
 * 「我的通報紀錄」——業務查看自己送出的個案。
 *
 * 清單由後端過濾：Worker 依 Access JWT 的身分只回傳 submitted_by 是本人的個案，
 * 前端沒有、也不需要有「篩掉別人資料」的邏輯。前端做篩選等於把別人的病人資料
 * 先下載到這支手機上再假裝看不到。
 *
 * 刻意唯讀：個案送出後的判定、編碼、送件都是藥安人員的職責，
 * 通報者這一端能改，稽核上就說不清楚哪一版才是原始通報內容。
 */
const MyReportsScreen: React.FC<{ onClose: () => void; t: (k: any) => string }> = ({ onClose, t }) => {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [cases, setCases] = useState<AEReport[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listAECases();
        if (cancelled) return;
        setCases(list);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-[100dvh] flex flex-col font-sans text-slate-900 dark:text-slate-100 bg-canvas">
      <header className="sticky top-0 z-30 bg-white/92 dark:bg-slate-900/92 backdrop-blur-xl border-b border-white/60 dark:border-white/10">
        <div className="px-4 py-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-base font-black tracking-tight truncate">{t('ae.mobile.myReports')}</h1>
            <p className="text-xs font-bold text-muted">
              {t('ae.mobile.myReportsHint')}
            </p>
          </div>
          <button onClick={onClose} aria-label={t('ae.mobile.backToForm')}
            className="w-11 h-11 shrink-0 rounded-xl bg-white/60 dark:bg-white/10 border border-white/60 dark:border-white/10 flex items-center justify-center">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        {state === 'loading' && (
          <p role="status" className="text-sm font-bold text-muted flex items-center gap-2 py-8 justify-center">
            <ArrowPathIcon className="w-5 h-5 animate-spin" />{t('ae.mobile.myReportsLoading')}
          </p>
        )}

        {state === 'error' && (
          <div role="alert" className="px-4 py-3 rounded-2xl bg-danger-50 dark:bg-danger-500/10 border-2 border-danger-300 dark:border-danger-500/40">
            <p className="text-xs font-bold text-danger-800 dark:text-danger-300 flex items-center gap-1.5">
              <ExclamationTriangleIcon className="w-4 h-4" />{t('ae.mobile.myReportsError')}
            </p>
          </div>
        )}

        {state === 'ready' && cases.length === 0 && (
          <p className="text-sm font-bold text-muted text-center py-10">
            {t('ae.mobile.myReportsEmpty')}
          </p>
        )}

        {state === 'ready' && cases.map(c => {
          const drug = c.drugs?.find(d => d.isSuspect) || c.drugs?.[0];
          const serious = assessSeriousness(c).serious;
          return (
            <Card key={c.id} className="p-4 space-y-1.5">
              {/* 個案編號是業務辨認「哪一件」的唯一依據，不能被截斷：原本 truncate 加上
                  徽章 shrink-0，英文的長狀態字會把編號擠成「PV-2…」。改由徽章換行。 */}
              <div className="flex items-start justify-between gap-2">
                <span className="font-black text-sm whitespace-nowrap shrink-0 leading-6">{c.caseNumber || '—'}</span>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {serious && <Badge tone="danger">{t('ae.console.serious')}</Badge>}
                  <Badge tone={caseStatusTone(c.status)}>{t(`ae.status.${c.status}`)}</Badge>
                </div>
              </div>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                {c.events?.map(e => e.verbatim).filter(Boolean).join('、') || '—'}
              </p>
              <p className="text-xs font-bold text-muted">
                {drug?.brandName || drug?.activeIngredient || '—'}
                {/* 日期整段不斷行：窄螢幕上原本會被拆成「2026-」「09-30」 */}
                {c.awarenessDate && <>　·　{t('ae.f.awarenessDate')} <span className="whitespace-nowrap tabular-nums">{c.awarenessDate}</span></>}
              </p>
            </Card>
          );
        })}

        {state === 'ready' && cases.length > 0 && (
          <p className="text-xs font-bold text-muted pt-2 leading-relaxed">
            {t('ae.mobile.myReportsReadOnly')}
          </p>
        )}
      </div>
    </div>
  );
};

const DoneScreen: React.FC<{ done: { caseNumber: string; channel: string }; onNew: () => void; t: (k: any) => string }> = ({ done, onNew, t }) => {
  const queued = done.channel === 'outbox';
  const conflicted = done.channel === 'outbox_conflict';

  // 送出成功時整頁被置換掉，原本有焦點的送出鍵隨之消失，焦點掉回 document.body：
  // 螢幕閱讀器不會唸任何東西，鍵盤使用者下一次 Tab 得從頁首重新走。把焦點移到
  // 標題，狀態才會被唸出來，Tab 也從這裡繼續。這是一筆已經開始跑 15 日時鐘的
  // 通報，使用者必須確定它到底送出了沒有。
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => { headingRef.current?.focus(); }, []);

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-6 px-6 bg-canvas text-slate-900 dark:text-slate-100">
      <div className={`w-20 h-20 rounded-3xl flex items-center justify-center ${queued || conflicted ? 'bg-caution-700' : 'bg-success-700'} text-white shadow-xl`}>
        {queued || conflicted ? <CloudArrowUpIcon className="w-10 h-10" /> : <CheckCircleIcon className="w-10 h-10" />}
      </div>
      <div role="status" className="text-center space-y-2">
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-black tracking-tight">{t('ae.done.title')}</h2>
        <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
          {conflicted ? t('ae.submit.conflict') : queued ? t('ae.submit.queued') : t('ae.submit.okRemote')}
        </p>
        <p className="text-xs font-bold text-brand-700 dark:text-brand-300">
          {t('ae.done.caseNo')}: {done.caseNumber}
        </p>
      </div>
      <button onClick={onNew}
        className="min-h-[52px] px-8 rounded-2xl bg-brand-600 text-white font-black text-sm shadow-lg">
        {t('ae.submit.newReport')}
      </button>
    </div>
  );
};

export default AEReportMobile;
