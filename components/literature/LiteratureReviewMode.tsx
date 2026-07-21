import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AppMode } from '../../types';
import type { PVRecord } from '../../services/literature/types';
import { PVLLMService } from '../../services/literature/llmService';
import { buildCIOMS, ciomsToText } from '../../services/literature/cioms';
import { lookupMeddra } from '../../services/literature/meddra';
import { DB_KEY, PENDING_KEY, loadRecordsSync, saveRecords } from '../../services/literature/storage';
import { db } from '../../services/db';
import { CiomsModal } from './CiomsModal';
import {
  ClipboardCheck, Inbox, ExternalLink, Sparkles, RefreshCw, Copy, Check,
  FileText, Undo2, PackagePlus, Loader2,
} from 'lucide-react';

const llm = new PVLLMService();

const scoreBadgeClass = (score: number) =>
  score >= 70 ? 'bg-green-100 text-green-700 border-green-300' :
  score >= 40 ? 'bg-amber-100 text-amber-700 border-amber-300' :
  'bg-slate-100 text-slate-500 border-slate-300';

interface LiteratureReviewModeProps {
  selectedRecordId: string | null;
  setSelectedRecordId: (id: string | null) => void;
  setActiveMode: (m: AppMode) => void;
  setDbUpdateTrigger: React.Dispatch<React.SetStateAction<number>>;
}

// Review the pending list (from the search tab), auto-extract structured PV
// data per selected record, generate a CIOMS draft, then import into the
// literature library or reject (discard) the record.
export const LiteratureReviewMode = React.memo(({
  selectedRecordId, setSelectedRecordId, setActiveMode, setDbUpdateTrigger,
}: LiteratureReviewModeProps) => {
  // Tab remounts on every switch, so a one-time sync load is always fresh.
  const [pending, setPending] = useState<PVRecord[]>(() => loadRecordsSync<PVRecord>(PENDING_KEY));
  const [master, setMaster] = useState<PVRecord[]>(() => loadRecordsSync<PVRecord>(DB_KEY));
  const [minScore, setMinScore] = useState(0);
  const [ciomsText, setCiomsText] = useState<string | null>(null);
  const [copiedConclusion, setCopiedConclusion] = useState(false);
  const [extractingSet, setExtractingSet] = useState<Set<string>>(new Set());
  const [regeneratingSet, setRegeneratingSet] = useState<Set<string>>(new Set());
  const extractingIds = useRef<Set<string>>(new Set());

  useEffect(() => setCopiedConclusion(false), [selectedRecordId]);

  const selectedRecord = useMemo(
    () => pending.find((r) => r.id === selectedRecordId) || master.find((r) => r.id === selectedRecordId),
    [pending, master, selectedRecordId]
  );

  const visiblePending = useMemo(
    () => pending.filter((r) => (r.relevance_score || 0) >= minScore).sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0)),
    [pending, minScore]
  );

  // Auto-extract structured PV data once per record when first selected.
  useEffect(() => {
    const rec = selectedRecord;
    if (!rec || rec.pv_data || extractingIds.current.has(rec.id)) return;
    extractingIds.current.add(rec.id);
    setExtractingSet((prev) => new Set(prev).add(rec.id));
    llm.extractPVData(rec, 'zh').then((data) => {
      const upd = (r: PVRecord): PVRecord =>
        r.id !== rec.id ? r : {
          ...r,
          pv_data: { ...data, ingredient: data.ingredient && data.ingredient !== 'N/A' ? data.ingredient : r.original_search_term },
        };
      setPending((prev) => { const n = prev.map(upd); saveRecords(PENDING_KEY, n); return n; });
      setMaster((prev) => { const n = prev.map(upd); saveRecords(DB_KEY, n); return n; });
    }).finally(() => {
      extractingIds.current.delete(rec.id);
      setExtractingSet((prev) => { const n = new Set(prev); n.delete(rec.id); return n; });
    });
  }, [selectedRecordId]);

  const handleRegenerate = async (rec: PVRecord) => {
    setRegeneratingSet((prev) => new Set(prev).add(rec.id));
    try {
      const [sum] = await llm.generateSummaries([rec], 'zh');
      const pv = await llm.extractPVData(rec, 'zh');
      const upd = (r: PVRecord): PVRecord =>
        r.id !== rec.id ? r : {
          ...r,
          summary_zh: sum?.summary_zh ?? r.summary_zh,
          conclusion_zh: sum?.conclusion_zh ?? r.conclusion_zh,
          pv_data: { ...pv, ingredient: pv.ingredient && pv.ingredient !== 'N/A' ? pv.ingredient : r.original_search_term },
        };
      setPending((prev) => { const n = prev.map(upd); saveRecords(PENDING_KEY, n); return n; });
      setMaster((prev) => { const n = prev.map(upd); saveRecords(DB_KEY, n); return n; });
    } finally {
      setRegeneratingSet((prev) => { const n = new Set(prev); n.delete(rec.id); return n; });
    }
  };

  const handleImport = (record: PVRecord) => {
    if (master.some((m) => m.pmid === record.pmid)) { alert('此文獻已存在於正式庫'); return; }
    const withFlag: PVRecord = { ...record, quality_flags: [...record.quality_flags, 'DB_COMMITTED'] };
    const newMaster = [...master, withFlag];
    const newPending = pending.filter((r) => r.pmid !== record.pmid);
    setMaster(newMaster); setPending(newPending);
    saveRecords(DB_KEY, newMaster); saveRecords(PENDING_KEY, newPending);
    setSelectedRecordId(null);
    db.addLog('CREATE', 'LITERATURE', `匯入文獻至正式庫：PMID ${record.pmid}`);
    setDbUpdateTrigger((prev) => prev + 1);
  };

  const handleReject = (record: PVRecord) => {
    if (!confirm(`確定要退回並移除此篇待核閱文獻嗎？(PMID: ${record.pmid})`)) return;
    const newPending = pending.filter((r) => r.id !== record.id);
    setPending(newPending);
    saveRecords(PENDING_KEY, newPending);
    if (selectedRecordId === record.id) setSelectedRecordId(null);
    db.addLog('DELETE', 'LITERATURE', `退回待核閱文獻：PMID ${record.pmid}`);
    setDbUpdateTrigger((prev) => prev + 1);
  };

  const handleCopyConclusion = (text: string | undefined) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedConclusion(true);
    setTimeout(() => setCopiedConclusion(false), 2000);
  };

  const openCioms = (record: PVRecord) => {
    const draft = buildCIOMS(record, new Date().toISOString());
    setCiomsText(ciomsToText(draft));
  };

  const meddra = selectedRecord?.pv_data ? lookupMeddra(selectedRecord.pv_data.meddra_pt_candidate) : null;
  const alreadyImported = selectedRecord ? master.some((m) => m.pmid === selectedRecord.pmid) : false;

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-500 grid lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2 bg-white/90 backdrop-blur-sm rounded-xl shadow-sm border border-slate-200 flex flex-col max-h-[80vh]">
        <div className="p-4 border-b border-slate-100 space-y-2">
          <h2 className="font-bold text-slate-900 flex items-center gap-2"><ClipboardCheck size={18} className="text-brand-600" /> 待核閱清單</h2>
          {pending.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-500 whitespace-nowrap">分數門檻 {minScore}</span>
              <input type="range" min={0} max={100} step={5} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="flex-1 accent-brand-600" />
              <span className="text-[11px] text-slate-400 whitespace-nowrap">{visiblePending.length}/{pending.length}</span>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {pending.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-300 py-12">
              <Inbox size={40} className="mb-2 opacity-40" />
              <p className="text-sm">尚無待核閱文獻，請先至「文獻檢索」執行搜尋</p>
            </div>
          ) : visiblePending.map((r) => (
            <div
              key={r.id}
              onClick={() => setSelectedRecordId(r.id)}
              className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedRecordId === r.id ? 'border-brand-500 bg-brand-50/60 shadow-sm' : 'border-slate-200 hover:border-brand-300 hover:bg-slate-50'}`}
            >
              <div className="flex justify-between items-center mb-1">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${scoreBadgeClass(r.relevance_score || 0)}`} title={r.relevance_reason}>
                  分數 {r.relevance_score ?? '—'}
                </span>
                <span className="text-[10px] text-slate-400">PMID:{r.pmid}</span>
              </div>
              <div className="text-[10px] text-brand-600 font-mono mb-0.5">{r.dp}</div>
              <h3 className="text-sm font-medium text-slate-800 line-clamp-2">{r.title}</h3>
            </div>
          ))}
        </div>
      </div>

      <div className="lg:col-span-3 bg-white/90 backdrop-blur-sm rounded-xl shadow-sm border border-slate-200 p-6 overflow-y-auto max-h-[80vh]">
        {!selectedRecord ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-300 py-20">
            <FileText size={48} className="mb-2 opacity-30" />
            <p className="text-sm">從左側清單選擇一篇文獻查看詳情</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <h2 className="text-lg font-bold text-slate-900 leading-snug">{selectedRecord.title}</h2>
              <button onClick={() => window.open(selectedRecord.primary_link, '_blank')} className="text-xs font-medium bg-slate-800 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:bg-slate-900">
                <ExternalLink size={13} /> 開啟原文連結
              </button>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wide flex items-center gap-1.5"><Sparkles size={13} /> 文獻結論</span>
                <button onClick={() => handleCopyConclusion(selectedRecord.conclusion_zh)} className="text-[11px] px-2 py-1 rounded bg-white/70 hover:bg-white text-amber-800 flex items-center gap-1">
                  {copiedConclusion ? <Check size={12} /> : <Copy size={12} />} {copiedConclusion ? '已複製' : '複製'}
                </button>
              </div>
              <p className="text-sm font-medium text-slate-800">{selectedRecord.conclusion_zh || '（AI 尚未產生結論）'}</p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">摘要</div>
              <p className="text-sm text-slate-700">{selectedRecord.summary_zh || '（AI 尚未產生摘要）'}</p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <div className="flex justify-between items-center mb-3">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">結構化 PV 數據</div>
                <div className="flex items-center gap-2">
                  {selectedRecord.pv_data?.completeness && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      selectedRecord.pv_data.completeness === 'Complete' ? 'bg-green-100 text-green-700 border-green-300' :
                      selectedRecord.pv_data.completeness === 'Partial' ? 'bg-amber-100 text-amber-700 border-amber-300' :
                      'bg-slate-100 text-slate-500 border-slate-300'
                    }`}>{selectedRecord.pv_data.completeness}</span>
                  )}
                  <button
                    onClick={() => handleRegenerate(selectedRecord)}
                    disabled={regeneratingSet.has(selectedRecord.id)}
                    className="text-[11px] px-2 py-1 rounded bg-brand-50 hover:bg-brand-100 text-brand-700 disabled:opacity-50 flex items-center gap-1"
                  >
                    <RefreshCw size={12} className={regeneratingSet.has(selectedRecord.id) ? 'animate-spin' : ''} /> 重新產生
                  </button>
                </div>
              </div>
              {extractingSet.has(selectedRecord.id) && !selectedRecord.pv_data ? (
                <p className="text-sm text-slate-400 italic flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> AI 抽取中...</p>
              ) : selectedRecord.pv_data ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                  {[
                    ['成分', selectedRecord.pv_data.ingredient],
                    ['產品', selectedRecord.pv_data.product],
                    ['不良反應原文', selectedRecord.pv_data.ae_verbatim],
                    ['MedDRA PT', selectedRecord.pv_data.meddra_pt_candidate ? `${selectedRecord.pv_data.meddra_pt_candidate}${meddra?.matched ? ' ✓詞典命中' : ' ·AI推論'}` : ''],
                    ['MedDRA SOC', meddra?.soc || '（未收錄於種子詞典）'],
                    ['嚴重性', selectedRecord.pv_data.seriousness],
                    ['因果關係', selectedRecord.pv_data.causality],
                    ['族群', selectedRecord.pv_data.population],
                    ['劑量/途徑', selectedRecord.pv_data.dosage_route],
                    ['發生時間', selectedRecord.pv_data.tto],
                    ['結果', selectedRecord.pv_data.outcome],
                  ].map(([label, value]) => (
                    <div key={label as string}>
                      <div className="text-[9px] font-bold text-slate-400 uppercase">{label}</div>
                      <div className="font-medium text-slate-700 break-words">{value || <span className="text-slate-300">—</span>}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400 italic">選取文獻後將自動抽取結構化數據</p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => openCioms(selectedRecord)}
                disabled={!selectedRecord.pv_data}
                className="flex-1 bg-slate-800 disabled:opacity-40 text-white py-3 rounded-lg font-medium text-sm shadow-md hover:bg-slate-900 flex items-center justify-center gap-2"
              >
                <FileText size={16} /> 產生 CIOMS 草稿
              </button>
              {!alreadyImported ? (
                <button onClick={() => handleImport(selectedRecord)} className="flex-1 bg-green-600 text-white py-3 rounded-lg font-medium text-sm shadow-md hover:bg-green-700 flex items-center justify-center gap-2">
                  <PackagePlus size={16} /> 確認入庫
                </button>
              ) : (
                <span className="flex-1 text-center py-3 text-sm font-medium text-green-700 bg-green-50 rounded-lg border border-green-200">已在正式庫中</span>
              )}
              {pending.some((p) => p.id === selectedRecord.id) && (
                <button onClick={() => handleReject(selectedRecord)} className="px-4 bg-white border border-slate-300 text-slate-600 py-3 rounded-lg font-medium text-sm hover:bg-slate-50 flex items-center justify-center gap-2">
                  <Undo2 size={16} /> 退回
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <CiomsModal ciomsText={ciomsText} onClose={() => setCiomsText(null)} />
    </div>
  );
});
