import React, { useState, useEffect } from 'react';
import { AppMode } from '../../types';
import type { PVRecord } from '../../services/literature/types';
import { buildPubMedQuery, performPubMedSearch } from '../../services/literature/pubmed';
import { PVLLMService } from '../../services/literature/llmService';
import { DB_KEY, PENDING_KEY, loadRecordsSync, saveRecords } from '../../services/literature/storage';
import { db } from '../../services/db';
import { settings } from '../../services/settings';
import { Search, Loader2, AlertCircle, Sparkles } from 'lucide-react';

const llm = new PVLLMService();

interface LiteratureSearchModeProps {
  setActiveMode: (m: AppMode) => void;
  setDbUpdateTrigger: React.Dispatch<React.SetStateAction<number>>;
}

// Comma-separated free-text field -> trimmed, non-empty terms.
const parseList = (s: string): string[] => s.split(',').map((t) => t.trim()).filter(Boolean);

export const LiteratureSearchMode = React.memo(({ setActiveMode, setDbUpdateTrigger }: LiteratureSearchModeProps) => {
  // Search criteria persist across rounds and sessions (services/settings.ts);
  // only the target ingredient is typed fresh each round.
  const persisted = settings.getLitSearch();
  const [ingredientsText, setIngredientsText] = useState('');
  const [aeTermsText, setAeTermsText] = useState(persisted.aeTerms);
  const [exclusionsText, setExclusionsText] = useState(persisted.exclusions);
  const [dateFrom, setDateFrom] = useState(persisted.dateFrom);
  const [dateTo, setDateTo] = useState(persisted.dateTo);
  const [maxResults, setMaxResults] = useState(persisted.maxResults);

  useEffect(() => {
    settings.saveLitSearch({
      aeTerms: aeTermsText,
      exclusions: exclusionsText,
      dateFrom,
      dateTo,
      maxResults,
    });
  }, [aeTermsText, exclusionsText, dateFrom, dateTo, maxResults]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const handleRun = async () => {
    const ingredients = parseList(ingredientsText);
    if (ingredients.length === 0) {
      setError('請輸入至少一個目標成分');
      return;
    }
    const aeTerms = parseList(aeTermsText);
    const exclusions = parseList(exclusionsText);
    const ingredientLabel = ingredients.join(', ');
    const query = buildPubMedQuery({ ingredients, aeTerms, exclusions });

    setIsProcessing(true);
    setError(null);
    setResultMsg(null);
    try {
      setProgress({ label: '檢索 PubMed 中...', done: 0, total: 0 });
      const raw = await performPubMedSearch(query, ingredientLabel, { from: dateFrom, to: dateTo }, maxResults);

      const master = loadRecordsSync<PVRecord>(DB_KEY);
      const existingPending = loadRecordsSync<PVRecord>(PENDING_KEY);
      const rawRecords: PVRecord[] = raw.map((r: any) => ({
        id: r.pmid || `tmp-${Math.random()}`,
        source: 'pubmed',
        pmid: r.pmid,
        title: r.title,
        journal: r.journal,
        dp: r.date,
        abstract: r.summary,
        primary_link: r.url,
        quality_flags: ['PRO_VERIFIED'],
        relevance_score: 0,
        relevance_reason: '',
        is_excluded: false,
        original_search_term: ingredientLabel,
      }));
      // 排除已在正式庫的文獻；已在待核閱清單者也不重複加入（保留使用者尚未核閱的舊項目）。
      const freshRecords = rawRecords.filter(
        (r) => !master.some((m) => m.pmid === r.pmid) && !existingPending.some((p) => p.pmid === r.pmid)
      );

      if (freshRecords.length === 0) {
        setResultMsg(`找到 ${raw.length} 筆，扣除已存在（正式庫/待核閱）後無新文獻需要核閱。`);
        db.addLog('CREATE', 'LITERATURE', `PubMed 檢索：成分 ${ingredientLabel}，找到 ${raw.length} 筆，無新文獻`);
        return;
      }

      const total = freshRecords.length;
      let scoreDone = 0;
      let sumDone = 0;
      const bump = () =>
        setProgress({ label: 'AI 評分與摘要中...', done: scoreDone + sumDone, total: total * 2 });
      bump();
      const [scores, summaries] = await Promise.all([
        llm.scoreRelevance(freshRecords, 'zh', (d) => { scoreDone = d; bump(); }),
        llm.generateSummaries(freshRecords, 'zh', (d) => { sumDone = d; bump(); }),
      ]);

      const finalized: PVRecord[] = freshRecords.map((m) => {
        const s = scores.find((sc: any) => String(sc.pmid) === String(m.pmid));
        const sum = summaries.find((su: any) => String(su.pmid) === String(m.pmid));
        return {
          ...m,
          relevance_score: s?.score ?? 50,
          relevance_reason: s?.reason || '',
          summary_zh: sum?.summary_zh || m.abstract,
          conclusion_zh: sum?.conclusion_zh || '',
        };
      });

      const newPending = [...existingPending, ...finalized];
      saveRecords(PENDING_KEY, newPending);
      db.addLog(
        'CREATE', 'LITERATURE',
        `PubMed 檢索：成分 ${ingredientLabel}，找到 ${raw.length} 筆，新增待核閱 ${finalized.length} 筆`
      );
      setDbUpdateTrigger((prev) => prev + 1);
      setResultMsg(`找到 ${raw.length} 筆，新增 ${finalized.length} 筆至待核閱清單，前往核閱頁。`);
      setActiveMode('litReview');
    } catch (e) {
      setError(e instanceof Error ? e.message : '檢索或 AI 處理發生未知錯誤');
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
      <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg shadow-slate-200/50 border border-white/50 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-600">
            <Search size={20} />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-900">文獻檢索設定</h2>
            <p className="text-slate-500 text-sm">透過 PubMed E-utilities 檢索目標成分之不良事件文獻，AI 評分並摘要後送入待核閱清單。筆數、起訖日、關鍵字與排除詞會自動保存，每輪只需輸入新的目標成分。</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">目標成分（逗號分隔）</label>
            <input
              type="text"
              value={ingredientsText}
              onChange={(e) => setIngredientsText(e.target.value)}
              placeholder="例如：Fenofibrate, Simvastatin"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">最多取回筆數</label>
            <input
              type="number"
              min={10}
              max={500}
              step={10}
              value={maxResults}
              onChange={(e) => setMaxResults(Math.max(10, Math.min(500, Number(e.target.value) || 100)))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none text-sm font-mono"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">監測起日</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">監測迄日</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none text-sm"
            />
          </div>
          <div className="space-y-2 lg:col-span-2">
            <label className="block text-sm font-medium text-slate-700">AE 關鍵字（逗號分隔，支援萬用字元 *）</label>
            <input
              type="text"
              value={aeTermsText}
              onChange={(e) => setAeTermsText(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none text-sm"
            />
          </div>
          <div className="space-y-2 lg:col-span-2">
            <label className="block text-sm font-medium text-slate-700">排除詞（逗號分隔）</label>
            <input
              type="text"
              value={exclusionsText}
              onChange={(e) => setExclusionsText(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none text-sm"
            />
          </div>
        </div>

        {progress && (
          <div className="mt-6 flex items-center gap-3">
            <span className="text-xs font-semibold text-brand-700 whitespace-nowrap">{progress.label}</span>
            <div className="flex-1 h-2 bg-brand-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-600 transition-all duration-300"
                style={{ width: progress.total > 0 ? `${Math.round((progress.done / progress.total) * 100)}%` : '100%' }}
              />
            </div>
            {progress.total > 0 && (
              <span className="text-xs font-mono text-brand-600 whitespace-nowrap">{progress.done}/{progress.total}</span>
            )}
          </div>
        )}

        <button
          onClick={handleRun}
          disabled={isProcessing}
          className="mt-6 w-full py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-medium shadow-lg shadow-brand-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
          {isProcessing ? '執行中...' : '執行檢索與 AI 評分'}
        </button>

        {error && (
          <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm flex items-center gap-2">
            <AlertCircle size={16} />{error}
          </div>
        )}
        {resultMsg && !error && (
          <div className="mt-4 p-3 bg-green-50 text-green-700 rounded-lg text-sm">{resultMsg}</div>
        )}
      </div>
    </div>
  );
});
