import React, { useState, useEffect } from 'react';
import { performAnalysis, AnalysisReport } from '../services/analysis';
import { db, QuarterlyAeMonitor } from '../services/db';
import { Activity, Calculator, BarChart3, Plus, Trash2, ToggleRight, ToggleLeft, Download, Check, Save, AlertTriangle, AlertCircle } from 'lucide-react';

export const MonitorMode = React.memo(({
  masterResult, setMasterResult,
  savedProducts,
  selectedProductId, setSelectedProductId,
  setDbUpdateTrigger,
  setActiveMode
}: any) => {
  const [selYear, setSelYear] = useState(new Date().getFullYear().toString());
  const [selQ, setSelQ] = useState('Q1');
  const quarter = `${selYear}${selQ}`;
  
  const [salesVolume, setSalesVolume] = useState<string>('');
  const [dailyDosage, setDailyDosage] = useState<string>('');
  const [exposureUnit, setExposureUnit] = useState('季');
  const [exposureVal, setExposureVal] = useState<string>('');

  const [inputCounts, setInputCounts] = useState<{term: string, count: string}[]>([{term: '', count: ''}]);
  const [analysisReport, setAnalysisReport] = useState<AnalysisReport | null>(null);
  const [showAllTerms, setShowAllTerms] = useState(false);
  const [monitorSaveStatus, setMonitorSaveStatus] = useState<'idle' | 'saved'>('idle');

  useEffect(() => {
    const sales = parseFloat(salesVolume);
    const dosage = parseFloat(dailyDosage);
    
    if (!isNaN(sales) && !isNaN(dosage) && dosage > 0) {
      let days = 1;
      switch (exposureUnit) {
        case '年': days = 365; break;
        case '季': days = 90; break;
        case '月': days = 30; break;
        case '日': days = 1; break;
        default: days = 1;
      }
      const calculatedExposure = sales / (dosage * days);
      setExposureVal(calculatedExposure.toFixed(2));
    } else {
      setExposureVal('');
    }
  }, [salesVolume, dailyDosage, exposureUnit]);

  useEffect(() => {
    if (analysisReport && masterResult) {
      runAnalysis();
    }
  }, [showAllTerms]);

  const handleLoadProduct = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const pid = e.target.value;
    setSelectedProductId(pid);
    if (pid) {
      const analysisFormat = db.getMasterForAnalysis(pid);
      setMasterResult(analysisFormat);
      setAnalysisReport(null);
      setMonitorSaveStatus('idle');
    } else {
      setMasterResult(null);
    }
  };

  const handleAddRow = () => setInputCounts([...inputCounts, { term: '', count: '' }]);
  const handleRemoveRow = (idx: number) => setInputCounts(inputCounts.filter((_, i) => i !== idx));

  const handleInputChange = (idx: number, field: 'term' | 'count', value: string) => {
    const newRows = [...inputCounts];
    newRows[idx] = { ...newRows[idx], [field]: value };
    setInputCounts(newRows);
  };

  const handleQuickAddTerm = (term: string) => {
    const lastRow = inputCounts[inputCounts.length - 1];
    if (!lastRow.term && !lastRow.count) {
      handleInputChange(inputCounts.length - 1, 'term', term);
    } else {
      setInputCounts([...inputCounts, { term, count: '' }]);
    }
  };

  const runAnalysis = () => {
    if (!masterResult) {
      alert("請先載入產品或產生主檔");
      return;
    }
    const val = parseFloat(exposureVal);
    
    if (!exposureVal || isNaN(val) || val <= 0) {
      alert("⚠️ 注意：尚未產生有效的暴露量！\n\n請完整填寫「銷售數量」與「每日使用量」，系統將自動計算分母。");
      return;
    }

    const validCounts = inputCounts
      .filter(r => r.term.trim() !== '') 
      .map(r => ({
        term: r.term,
        count: parseInt(r.count, 10) || 0
      }));

    const report = performAnalysis(masterResult, {
      quarter,
      exposure_value: val,
      exposure_unit: exposureUnit,
      ae_counts: validCounts
    }, {
      includeAllMasterTerms: showAllTerms
    });

    setAnalysisReport(report);
    setMonitorSaveStatus('idle');
  };

  const handleExportCSV = () => {
    if (!analysisReport) return;

    const BOM = "\uFEFF"; 
    const headers = ["判定 (Status)", "AE Term", "SOC", "仿單頻率 (Label Freq)", "本季案例數 (Count)", "發生率 (Rate %)", "仿單門檻 (Threshold %)"];
    
    const rows = analysisReport.rows.map(row => {
      let statusText = 'Normal';
      if (row.status === 'unexpected') statusText = 'Unexpected';
      if (row.status === 'alert') statusText = 'Alert';
      if (row.status === 'warning') statusText = 'Warning';

      return [
        statusText,
        `"${row.ae_term.replace(/"/g, '""')}"`,
        `"${row.soc.replace(/"/g, '""')}"`,
        `"${row.frequency_category.replace(/"/g, '""')}"`,
        row.count,
        row.incidence_rate_pct.toFixed(4),
        row.threshold_pct
      ].join(",");
    });

    const csvContent = BOM + headers.join(",") + "\n" + rows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `PV_Analysis_Report_${quarter}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    db.addLog('EXPORT', 'MONITOR', `Exported CSV Analysis Report for ${quarter} (Rows: ${analysisReport.rows.length})`);
    setDbUpdateTrigger((prev: number) => prev + 1);
  };

  const handleSaveAnalysis = () => {
    if (!analysisReport || !selectedProductId) {
      alert("需選擇產品並執行分析後才能儲存");
      return;
    }

    const records: QuarterlyAeMonitor[] = [];
    const now = new Date().toISOString();

    if (analysisReport.rows.length === 0) {
      const id = Date.now().toString(36) + Math.random().toString(36).substring(2);
      records.push({
        id,
        product_id: selectedProductId,
        quarter: quarter,
        exposure_value: parseFloat(exposureVal),
        exposure_unit: exposureUnit,
        ae_term: "本季無不良反應 (No Adverse Events)",
        count: 0,
        rate_pct: 0,
        threshold_pct: 0,
        status: 'normal',
        generated_at: now
      });
    } else {
      analysisReport.rows.forEach(row => {
        let status: 'normal' | 'yellow' | 'red' = 'normal';
        if (row.status === 'alert') status = 'red';
        if (row.status === 'warning') status = 'yellow';
        if (row.status === 'unexpected') status = 'red';
        
        const id = Date.now().toString(36) + Math.random().toString(36).substring(2);

        records.push({
          id,
          product_id: selectedProductId,
          quarter: quarter,
          exposure_value: parseFloat(exposureVal),
          exposure_unit: exposureUnit,
          ae_term: row.ae_term,
          count: row.count,
          rate_pct: row.incidence_rate_pct,
          threshold_pct: row.threshold_pct,
          status: status,
          generated_at: now
        });
      });
    }

    if (records.length > 0) {
       db.saveQuarterlyAeMonitors(records);
       setDbUpdateTrigger((prev: number) => prev + 1);
    }
    
    setMonitorSaveStatus('saved');
  };

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-500 space-y-6">
      <div className="bg-white/90 backdrop-blur-sm p-4 rounded-xl shadow-sm border border-slate-200 flex flex-wrap gap-4 items-center justify-between">
          <div className="flex items-center gap-2 w-full md:w-auto">
            <label className="text-sm font-semibold text-slate-700">選擇產品主檔：</label>
            <select 
              value={selectedProductId} 
              onChange={handleLoadProduct}
              className="flex-1 md:w-64 px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-brand-500 outline-none"
            >
              <option value="">-- 請選擇產品 --</option>
              {savedProducts.map((p: any) => (
                <option key={p.product_id} value={p.product_id}>{p.product_name} ({p.label_version_date})</option>
              ))}
            </select>
          </div>
          
          {!selectedProductId && !masterResult && (
            <button onClick={() => setActiveMode('generator')} className="text-sm text-brand-600 underline">沒有產品？前往新增</button>
          )}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Activity size={18} className="text-brand-600" />
              本季暴露量設定 (自動計算)
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase">季度名稱</label>
                <div className="flex gap-2">
                  <select
                    value={selYear}
                    onChange={(e) => setSelYear(e.target.value)}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-brand-500 outline-none text-sm bg-white"
                  >
                    {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 4 + i).map(y => (
                      <option key={y} value={y}>{y}年</option>
                    ))}
                  </select>
                  <select
                    value={selQ}
                    onChange={(e) => setSelQ(e.target.value)}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-brand-500 outline-none text-sm bg-white"
                  >
                    <option value="Q1">Q1 (第一季)</option>
                    <option value="Q2">Q2 (第二季)</option>
                    <option value="Q3">Q3 (第三季)</option>
                    <option value="Q4">Q4 (第四季)</option>
                  </select>
                </div>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">銷售數量 (Sales Volume)</label>
                  <input 
                    type="number" 
                    value={salesVolume} 
                    onChange={e => setSalesVolume(e.target.value)} 
                    className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-brand-500 outline-none text-sm font-mono" 
                    placeholder="例如: 402192" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">每日使用量 (Daily Dosage)</label>
                  <input 
                    type="number" 
                    value={dailyDosage} 
                    onChange={e => setDailyDosage(e.target.value)} 
                    className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-brand-500 outline-none text-sm font-mono" 
                    placeholder="例如: 1" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">暴露量單位 (Time Unit)</label>
                  <select 
                    value={exposureUnit} 
                    onChange={e => setExposureUnit(e.target.value)} 
                    className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-brand-500 outline-none text-sm bg-white"
                  >
                    <option value="年">年 (365天)</option>
                    <option value="季">季 (90天)</option>
                    <option value="月">月 (30天)</option>
                    <option value="日">日 (1天)</option>
                  </select>
                </div>
              </div>

              <div className="bg-brand-50 p-3 rounded-lg border border-brand-200">
                <label className="block text-xs font-bold text-brand-800 mb-1 uppercase flex items-center gap-1">
                  <Calculator size={12} /> 自動計算之暴露量 (分母)
                </label>
                <input 
                  type="text" 
                  readOnly
                  value={exposureVal} 
                  className="w-full px-3 py-2 bg-white border border-brand-200 rounded text-brand-700 font-bold font-mono text-lg text-right outline-none cursor-not-allowed" 
                  placeholder="..." 
                />
                <div className="text-[10px] text-brand-600 mt-1 text-right">
                  公式: 銷售量 / (每日用量 × 天數)
                </div>
              </div>
            </div>
          </div>

          {masterResult && (
            <div className="bg-slate-50/90 rounded-xl border border-slate-200 p-4 max-h-[400px] overflow-hidden flex flex-col">
              <h4 className="font-semibold text-xs text-slate-500 uppercase mb-3">主檔可用 AE Term 參考</h4>
              <div className="flex-1 overflow-y-auto space-y-1 pr-2">
                {masterResult.ae_master.map((item: any, i: number) => (
                    <button 
                    key={i} 
                    onClick={() => handleQuickAddTerm(item.ae_terms_split[0])}
                    className="text-left w-full text-xs px-2 py-1.5 bg-white border border-slate-200 rounded hover:border-brand-400 hover:text-brand-700 truncate transition-colors"
                    title={item.ae_terms_split.join(', ')}
                    >
                      + {item.ae_terms_split.join(' / ')}
                    </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-slate-900 flex items-center gap-2">
                  <BarChart3 size={18} className="text-brand-600" />
                  AE 案例數輸入
                </h3>
                <button onClick={handleAddRow} className="text-xs flex items-center gap-1 bg-brand-50 text-brand-700 px-3 py-1.5 rounded hover:bg-brand-100 transition-colors font-medium">
                  <Plus size={14} /> 新增列
                </button>
            </div>
            
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
              {inputCounts.map((row, idx) => (
                <div key={idx} className="flex gap-3 items-center">
                  <div className="flex-1">
                    <input 
                      type="text" 
                      value={row.term} 
                      onChange={(e) => handleInputChange(idx, 'term', e.target.value)}
                      placeholder="輸入 AE Term (建議點選左側參考清單)"
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-brand-500 outline-none"
                    />
                  </div>
                  <div className="w-24">
                    <input 
                      type="number" 
                      min="0"
                      value={row.count} 
                      onChange={(e) => handleInputChange(idx, 'count', e.target.value)}
                      placeholder="Count"
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm text-center focus:ring-1 focus:ring-brand-500 outline-none"
                    />
                  </div>
                  <button onClick={() => handleRemoveRow(idx)} className="text-slate-400 hover:text-red-500 transition-colors p-1">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {inputCounts.length === 0 && <div className="text-center text-slate-400 text-sm py-4">請新增案例輸入</div>}
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 flex justify-end">
              <button 
                onClick={runAnalysis}
                disabled={!masterResult}
                className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg shadow-lg shadow-brand-200 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                <Activity size={18} />
                執行訊號分析
              </button>
            </div>
          </div>

          {analysisReport && (
              <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden animate-in fade-in slide-in-from-bottom-8">
                <div className="px-6 py-4 bg-slate-900 text-white flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <h3 className="font-bold text-lg">分析報表 ({quarter})</h3>
                    <div className="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700">
                      <button
                        onClick={() => setShowAllTerms(!showAllTerms)}
                        className={`flex items-center gap-2 px-3 py-1 text-xs font-medium rounded transition-all ${
                          showAllTerms ? 'bg-brand-500 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {showAllTerms ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                        顯示所有主檔項目
                      </button>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="text-xs text-slate-400">
                      Exposure: {exposureVal} {exposureUnit}
                    </div>
                    <button 
                    onClick={handleExportCSV}
                    className="text-xs px-3 py-1.5 rounded font-medium flex items-center gap-1 transition-colors bg-white text-slate-700 hover:bg-slate-100 border border-slate-200"
                  >
                    <Download size={14}/>
                    匯出 CSV
                  </button>
                    {selectedProductId && (
                      <button 
                        onClick={handleSaveAnalysis}
                        disabled={monitorSaveStatus === 'saved'}
                        className={`text-xs px-3 py-1.5 rounded font-medium flex items-center gap-1 transition-colors ${monitorSaveStatus === 'saved' ? 'bg-green-500 text-white' : 'bg-white text-slate-900 hover:bg-slate-100'}`}
                      >
                        {monitorSaveStatus === 'saved' ? <Check size={14}/> : <Save size={14}/>}
                        {monitorSaveStatus === 'saved' ? '已存入' : '儲存報表'}
                      </button>
                    )}
                  </div>
                </div>
                
                <div className="p-6">
                  {/* Summary Cards */}
                  <div className="grid grid-cols-4 gap-4 mb-6">
                    <div className="bg-rose-100 border border-rose-200 p-4 rounded-lg">
                      <div className="text-rose-700 text-xs font-bold uppercase mb-1 flex items-center gap-1">
                        <AlertTriangle size={14} /> 未預期 AE
                      </div>
                      <div className="text-2xl font-bold text-rose-900">{analysisReport.unexpected.length}</div>
                    </div>
                    <div className="bg-red-50 border border-red-100 p-4 rounded-lg">
                      <div className="text-red-600 text-xs font-bold uppercase mb-1">⚠️ 發生率異常</div>
                      <div className="text-2xl font-bold text-slate-900">{analysisReport.alerts.length}</div>
                    </div>
                    <div className="bg-yellow-50 border border-yellow-100 p-4 rounded-lg">
                      <div className="text-yellow-600 text-xs font-bold uppercase mb-1">⚠️ 關注提醒</div>
                      <div className="text-2xl font-bold text-slate-900">{analysisReport.rows.filter(r => r.status === 'warning').length}</div>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg">
                      <div className="text-slate-500 text-xs font-bold uppercase mb-1">正常 / 無訊號</div>
                      <div className="text-2xl font-bold text-slate-900">{analysisReport.rows.filter(r => r.status === 'normal').length}</div>
                    </div>
                  </div>

                  {/* Table */}
                  <div className="overflow-x-auto border rounded-lg border-slate-200 max-h-[600px]">
                    <table className="w-full text-sm text-left relative">
                      <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                        <tr>
                          <th className="px-4 py-3">判定</th>
                          <th className="px-4 py-3">AE Term</th>
                          <th className="px-4 py-3">SOC / 仿單頻率</th>
                          <th className="px-4 py-3 text-right">本季 Count</th>
                          <th className="px-4 py-3 text-right">本季 Rate (%)</th>
                          <th className="px-4 py-3 text-right">仿單門檻 (%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {analysisReport.rows.length === 0 ? (
                          <tr><td colSpan={6} className="px-4 py-4 text-center text-slate-400">本季無不良反應案例</td></tr>
                        ) : analysisReport.rows.map((row, idx) => (
                          <tr key={idx} className={
                            row.status === 'unexpected' ? 'bg-rose-50' :
                            row.status === 'alert' ? 'bg-red-50' : 
                            row.status === 'warning' ? 'bg-yellow-50' : 
                            'hover:bg-slate-50'
                          }>
                            <td className="px-4 py-3">
                              {row.status === 'unexpected' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-rose-600 text-white shadow-sm"><AlertTriangle size={12}/> 未預期 (Unexpected)</span>}
                              {row.status === 'alert' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-red-200 text-red-800">⚠️ 異常</span>}
                              {row.status === 'warning' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-yellow-200 text-yellow-800">⚠️ 提醒</span>}
                              {row.status === 'normal' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">正常</span>}
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-900">{row.ae_term}</td>
                            <td className="px-4 py-3 text-slate-500 text-xs">
                              {row.status === 'unexpected' ? (
                                <span className="text-rose-600 italic">未登載於主檔</span>
                              ) : (
                                <>
                                  <div className="truncate max-w-[150px]" title={row.soc}>{row.soc}</div>
                                  <div>{row.frequency_category}</div>
                                </>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-mono">{row.count}</td>
                            <td className={`px-4 py-3 text-right font-mono font-bold ${
                              row.status === 'unexpected' ? 'text-rose-700' :
                              row.status === 'alert' ? 'text-red-600' : 
                              'text-slate-700'
                            }`}>
                              {row.incidence_rate_pct.toFixed(4)}%
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-slate-500">
                              {row.threshold_pct > 0 ? `${row.threshold_pct}%` : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
          )}
        </div>
      </div>
    </div>
  );
});
