import React, { useState, useMemo } from 'react';
import { AppMode } from '../../types';
import type { PVRecord } from '../../services/literature/types';
import { PVLLMService } from '../../services/literature/llmService';
import { DB_KEY, loadRecordsSync, saveRecords } from '../../services/literature/storage';
import { db } from '../../services/db';
import { BookOpen, Search as SearchIcon, Sparkles, Download, Trash2, Filter } from 'lucide-react';

const llm = new PVLLMService();

// CSV field escaping: quote-wrap + double internal quotes; guard against
// formula injection when opened in Excel (leading = + - @ tab/cr).
const csvCell = (v: any) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

interface LiteratureLibraryModeProps {
  setActiveMode: (m: AppMode) => void;
  setSelectedRecordId: (id: string | null) => void;
  setDbUpdateTrigger: React.Dispatch<React.SetStateAction<number>>;
}

// Browse/filter/export the literature library (master_db) and batch-run
// structured PV extraction over records that don't have it yet.
export const LiteratureLibraryMode = React.memo(({
  setActiveMode, setSelectedRecordId, setDbUpdateTrigger,
}: LiteratureLibraryModeProps) => {
  const [master, setMaster] = useState<PVRecord[]>(() => loadRecordsSync<PVRecord>(DB_KEY));
  const [filter, setFilter] = useState({ keyword: '', from: '', to: '' });
  const [batchInfo, setBatchInfo] = useState<{ done: number; total: number } | null>(null);

  const filtered = useMemo(() => {
    const kw = filter.keyword.toLowerCase();
    const fromDate = filter.from ? new Date(filter.from) : null;
    const toDate = filter.to ? new Date(filter.to) : null;
    return master.filter((r) => {
      const recordDate = r.dp ? new Date(r.dp) : null;
      if (fromDate && !(recordDate && recordDate >= fromDate)) return false;
      if (toDate && !(recordDate && recordDate <= toDate)) return false;
      if (!kw) return true;
      const pool = [
        r.pmid || '', r.title || '', r.original_search_term || '',
        r.pv_data?.ingredient || '', r.pv_data?.product || '',
        r.journal || '', r.summary_zh || '', r.conclusion_zh || '',
      ].join(' ').toLowerCase();
      return pool.includes(kw);
    });
  }, [master, filter]);

  const unextractedCount = master.filter((r) => !r.pv_data && !r.is_excluded).length;

  const handleBatchExtract = async () => {
    const todo = master.filter((r) => !r.pv_data && !r.is_excluded);
    if (todo.length === 0) { alert('正式庫所有文獻皆已完成結構化抽取'); return; }
    setBatchInfo({ done: 0, total: todo.length });
    try {
      const results = await llm.extractPVDataBatch(todo, 'zh', (done, total) => setBatchInfo({ done, total }));
      const byId = new Map(results.map((x) => [x.id, x.pv_data]));
      const updated = master.map((r) => {
        const data = byId.get(r.id);
        if (!data) return r;
        return { ...r, pv_data: { ...data, ingredient: data.ingredient && data.ingredient !== 'N/A' ? data.ingredient : r.original_search_term } };
      });
      setMaster(updated);
      saveRecords(DB_KEY, updated);
      db.addLog('ANALYSIS', 'LITERATURE', `批次結構化抽取：${results.length} 筆`);
      setDbUpdateTrigger((prev) => prev + 1);
    } finally {
      setBatchInfo(null);
    }
  };

  const handleDelete = (e: React.MouseEvent, id: string, pmid?: string) => {
    e.stopPropagation();
    if (!confirm(`確定要從正式庫移除此篇文獻嗎？(PMID: ${pmid ?? id})`)) return;
    const updated = master.filter((r) => r.id !== id);
    setMaster(updated);
    saveRecords(DB_KEY, updated);
    db.addLog('DELETE', 'LITERATURE', `從正式庫移除文獻：PMID ${pmid ?? id}`);
    setDbUpdateTrigger((prev) => prev + 1);
  };

  const handleExport = (scope: 'all' | 'filtered') => {
    const data = scope === 'all' ? master : filtered;
    const headers = ['PMID', 'Title', 'Journal', 'PubDate', 'SearchTerm', 'AI_Ingredient', 'RelevanceScore', 'MedDRA_PT', 'Seriousness', 'Causality', 'Conclusion_ZH', 'Summary_ZH'];
    const rows = data.map((r) => [
      r.pmid, r.title, r.journal, r.dp, r.original_search_term,
      r.pv_data?.ingredient, r.relevance_score, r.pv_data?.meddra_pt_candidate,
      r.pv_data?.seriousness, r.pv_data?.causality, r.conclusion_zh, r.summary_zh,
    ].map(csvCell));
    const csv = '﻿' + [headers.map(csvCell), ...rows].map((row) => row.join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `PV_Literature_DB_${scope}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    db.addLog('EXPORT', 'LITERATURE', `匯出文獻庫 CSV (${scope})：${data.length} 筆`);
    setDbUpdateTrigger((prev) => prev + 1);
  };

  const openInReview = (id: string) => {
    setSelectedRecordId(id);
    setActiveMode('litReview');
  };

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-500 space-y-6">
      <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="bg-brand-100 p-2 rounded-full text-brand-600"><BookOpen size={22} /></div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">文獻庫</h2>
              <p className="text-slate-500 text-xs">共 {master.length} 筆，篩選後 {filtered.length} 筆</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleBatchExtract}
              disabled={!!batchInfo}
              className="text-xs px-3 py-2 rounded font-medium flex items-center gap-1.5 bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-50 transition-colors"
            >
              <Sparkles size={14} className={batchInfo ? 'animate-pulse' : ''} />
              {batchInfo ? `抽取中 ${batchInfo.done}/${batchInfo.total}` : `批次結構化抽取 (${unextractedCount})`}
            </button>
            <button onClick={() => handleExport('filtered')} className="text-xs px-3 py-2 rounded font-medium flex items-center gap-1.5 bg-green-50 text-green-700 hover:bg-green-100 transition-colors">
              <Download size={14} /> 匯出篩選 ({filtered.length})
            </button>
            <button onClick={() => handleExport('all')} className="text-xs px-3 py-2 rounded font-medium flex items-center gap-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors">
              <Download size={14} /> 匯出全部 ({master.length})
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4">
          <div className="flex-1 min-w-[220px] relative">
            <SearchIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text" value={filter.keyword} onChange={(e) => setFilter({ ...filter, keyword: e.target.value })}
              placeholder="關鍵字：標題、成分、PMID、期刊..."
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
            />
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Filter size={14} className="text-slate-400" />
            <input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} className="px-2 py-1.5 border border-slate-300 rounded text-xs" />
            <span className="text-slate-400">~</span>
            <input type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} className="px-2 py-1.5 border border-slate-300 rounded text-xs" />
          </div>
          <button onClick={() => setFilter({ keyword: '', from: '', to: '' })} className="text-xs text-slate-400 hover:text-brand-600">清除</button>
        </div>

        <div className="overflow-x-auto border rounded-lg border-slate-200 max-h-[560px] overflow-y-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3">PMID</th>
                <th className="px-4 py-3">文獻詳情</th>
                <th className="px-4 py-3">期刊 / 日期</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">尚無文獻，請至「文獻檢索」執行搜尋後於「核閱」頁入庫</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => openInReview(r.id)}>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400 align-top">{r.pmid}</td>
                  <td className="px-4 py-3 max-w-md align-top">
                    <div className="font-medium text-slate-800 line-clamp-2">{r.title}</div>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <span className="bg-brand-50 text-brand-700 px-1.5 py-0.5 rounded text-[10px] font-medium">搜尋詞：{r.original_search_term}</span>
                      {r.pv_data?.ingredient && r.pv_data.ingredient !== r.original_search_term && (
                        <span className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded text-[10px] font-medium">AI 判定成分：{r.pv_data.ingredient}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="text-xs text-slate-500 italic">{r.journal}</div>
                    <div className="text-[10px] font-mono text-brand-500">{r.dp}</div>
                  </td>
                  <td className="px-4 py-3 text-right align-top">
                    <button onClick={(e) => handleDelete(e, r.id, r.pmid)} className="text-slate-300 hover:text-red-500 p-1.5 rounded-full hover:bg-red-50 transition-colors" title="從正式庫移除">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});
