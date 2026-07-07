import React, { useState, useRef } from 'react';
import { db, Product, LabelAeMaster, MonitorBatch, QuarterlyAeMonitor } from '../services/db';
import { Database, FolderOpen, Eye, Trash2, History, List, Calculator, Activity, Download, Upload, TrendingUp, Layers } from 'lucide-react';
import { DetailModal } from './DetailModal';
import { TrendView } from './TrendView';
import { MasterVersion, diffMasters } from '../services/versions';

interface LibraryModeProps {
  savedProducts: Product[];
  setSavedProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  monitorBatches: MonitorBatch[];
  setDbUpdateTrigger: React.Dispatch<React.SetStateAction<number>>;
  currentExtractionProductId: string | null;
  setCurrentExtractionProductId: (id: string | null) => void;
}

export const LibraryMode = React.memo(({
  savedProducts, setSavedProducts,
  monitorBatches,
  setDbUpdateTrigger,
  currentExtractionProductId, setCurrentExtractionProductId
}: LibraryModeProps) => {
  const [viewingProduct, setViewingProduct] = useState<{product: Product, masters: LabelAeMaster[]} | null>(null);
  const [viewingBatch, setViewingBatch] = useState<{batch: MonitorBatch, records: QuarterlyAeMonitor[]} | null>(null);
  const [viewingTrend, setViewingTrend] = useState<{product: Product, records: QuarterlyAeMonitor[]} | null>(null);
  const [viewingVersions, setViewingVersions] = useState<{product: Product, versions: MasterVersion[], currentRows: LabelAeMaster[]} | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleViewTrend = (product: Product) => {
    setViewingTrend({ product, records: db.getQuarterlyAeMonitors(product.product_id) });
  };

  const handleViewVersions = (product: Product) => {
    setSelectedVersionId('');
    setViewingVersions({
      product,
      versions: db.getMasterVersions(product.product_id),
      currentRows: db.getLabelAeMasters(product.product_id),
    });
  };

  const handleExportBackup = () => {
    const backup = db.exportAll();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `PV_Backup_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    db.addLog('EXPORT', 'SYSTEM', `Exported full backup (products: ${backup.products.length})`);
    setDbUpdateTrigger((prev) => prev + 1);
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // Allow re-selecting the same file
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = Array.isArray(data?.products) ? data.products.length : 0;
      if (!confirm(
        `匯入備份將「完全覆蓋」現有全部資料！\n\n` +
        `目前資料庫：${savedProducts.length} 個產品\n備份檔內含：${incoming} 個產品\n\n確定要匯入嗎？`
      )) return;
      const result = db.importAll(data);
      setSavedProducts(db.getProducts());
      setCurrentExtractionProductId(null);
      setDbUpdateTrigger((prev) => prev + 1);
      alert(`匯入完成：產品 ${result.products} 份、主檔 ${result.masters} 列、監測紀錄 ${result.monitors} 列。`);
    } catch (err) {
      alert(err instanceof Error ? err.message : '匯入失敗：檔案無法解析。');
    }
  };

  const handleViewProduct = (product: Product) => {
    const masters = db.getLabelAeMasters(product.product_id);
    setViewingProduct({ product, masters });
  };

  const handleViewBatch = (batch: MonitorBatch) => {
    const records = db.getMonitorRecordsByBatch(batch.generated_at);
    setViewingBatch({ batch, records });
  };

  const handleDeleteBatch = (batch: MonitorBatch) => {
     if(confirm(`確定要刪除 ${batch.quarter} 的這份監測報告嗎？`)) {
       db.deleteMonitorBatch(batch.generated_at);
       setDbUpdateTrigger((prev) => prev + 1);
     }
  };

  const handleDeleteProduct = (pid: string) => {
    if(confirm('確定要刪除此產品及其所有相關資料嗎？此動作將被記錄在稽核日誌中。')) {
      db.deleteProduct(pid);
      setSavedProducts(db.getProducts());
      if (currentExtractionProductId === pid) {
        setCurrentExtractionProductId(null);
      }
      setDbUpdateTrigger((prev) => prev + 1);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-500 space-y-6">
      <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-brand-100 p-2 rounded-full text-brand-600">
              <Database size={24} />
            </div>
            <h2 className="text-xl font-bold text-slate-900">資料庫檢視</h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleExportBackup}
              className="text-xs px-3 py-2 rounded font-medium flex items-center gap-1.5 bg-brand-50 text-brand-700 hover:bg-brand-100 transition-colors"
              title="下載全部資料的 JSON 備份檔"
            >
              <Download size={14} /> 匯出備份
            </button>
            <button
              onClick={() => importInputRef.current?.click()}
              className="text-xs px-3 py-2 rounded font-medium flex items-center gap-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
              title="從 JSON 備份檔還原（覆蓋現有資料）"
            >
              <Upload size={14} /> 匯入備份
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportBackup}
              className="hidden"
            />
          </div>
        </div>

        <div className="space-y-8">
          {/* Products Section */}
          <section>
            <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2 border-b pb-2 border-slate-100">
              <FolderOpen size={18} />
              產品主檔 (Products)
            </h3>
            <div className="overflow-x-auto border rounded-lg border-slate-200">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-600 font-semibold">
                  <tr>
                    <th className="px-4 py-2">Product Name</th>
                    <th className="px-4 py-2">Version Date</th>
                    <th className="px-4 py-2">ID</th>
                    <th className="px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {savedProducts.map((p) => (
                    <tr key={p.product_id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium">{p.product_name}</td>
                      <td className="px-4 py-3 text-slate-500">{p.label_version_date}</td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-400">{p.product_id}</td>
                      <td className="px-4 py-3 text-right flex justify-end gap-2">
                        <button
                          onClick={() => handleViewProduct(p)}
                          className="text-brand-600 bg-brand-50 hover:bg-brand-100 p-1.5 rounded transition-colors"
                          title="檢視詳細主檔"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={() => handleViewTrend(p)}
                          className="text-emerald-600 bg-emerald-50 hover:bg-emerald-100 p-1.5 rounded transition-colors"
                          title="跨季趨勢分析"
                        >
                          <TrendingUp size={16} />
                        </button>
                        <button
                          onClick={() => handleViewVersions(p)}
                          className="text-violet-600 bg-violet-50 hover:bg-violet-100 p-1.5 rounded transition-colors"
                          title="主檔版本歷史與差異比較"
                        >
                          <Layers size={16} />
                        </button>
                        <button 
                          onClick={() => handleDeleteProduct(p.product_id)} 
                          className="text-red-500 hover:bg-red-50 p-1.5 rounded transition-colors"
                          title="刪除"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {savedProducts.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-4 text-center text-slate-400">尚無產品資料</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Monitor History Section */}
          <section>
            <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2 border-b pb-2 border-slate-100">
              <History size={18} />
              監測報告紀錄 (Report History)
            </h3>
            <div className="overflow-x-auto border rounded-lg border-slate-200">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-600 font-semibold">
                  <tr>
                    <th className="px-4 py-2">Report Date</th>
                    <th className="px-4 py-2">Product</th>
                    <th className="px-4 py-2">Quarter</th>
                    <th className="px-4 py-2 text-center">Stats (Count / Alerts)</th>
                    <th className="px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {monitorBatches.map((batch) => {
                    const product = savedProducts.find((p) => p.product_id === batch.product_id);
                    return (
                      <tr key={batch.generated_at} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-xs text-slate-500">
                            <div className="font-medium text-slate-700">{new Date(batch.generated_at).toLocaleDateString()}</div>
                            <div className="text-[10px]">{new Date(batch.generated_at).toLocaleTimeString()}</div>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-700">
                            {product ? product.product_name : <span className="text-slate-400 italic">Unknown ({batch.product_id})</span>}
                        </td>
                        <td className="px-4 py-3">
                            <span className="px-2 py-0.5 bg-slate-100 rounded text-xs font-semibold">{batch.quarter}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-2 text-xs">
                              <span className="text-slate-600" title="Total Items">{batch.record_count} items</span>
                              <span className="text-slate-300">|</span>
                              {batch.alert_count > 0 ? (
                                <span className="text-red-600 font-bold flex items-center gap-0.5">⚠️ {batch.alert_count} Alerts</span>
                              ) : (
                                <span className="text-green-600 flex items-center gap-0.5">✅ OK</span>
                              )}
                            </div>
                        </td>
                        <td className="px-4 py-3 text-right flex justify-end gap-2">
                          <button 
                            onClick={() => handleViewBatch(batch)}
                            className="text-brand-600 bg-brand-50 hover:bg-brand-100 p-1.5 rounded transition-colors"
                            title="檢視報表內容"
                          >
                            <List size={16} />
                          </button>
                          <button 
                            onClick={() => handleDeleteBatch(batch)}
                            className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded transition-colors"
                            title="刪除此份報表"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {monitorBatches.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400 flex flex-col items-center gap-2">
                        <div className="p-3 bg-slate-50 rounded-full"><History size={24} className="opacity-20"/></div>
                        尚無監測紀錄
                      </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      {/* Product Details Modal */}
      <DetailModal 
        isOpen={!!viewingProduct} 
        onClose={() => setViewingProduct(null)}
        title={viewingProduct ? `Product Master: ${viewingProduct.product.product_name}` : ''}
      >
        {viewingProduct && (
          <div className="space-y-4">
              <div className="flex gap-4 text-sm text-slate-500 mb-4 bg-white p-3 rounded border border-slate-200">
                <div><strong>ID:</strong> {viewingProduct.product.product_id}</div>
                <div><strong>Version Date:</strong> {viewingProduct.product.label_version_date}</div>
                <div><strong>Total AE Terms:</strong> {viewingProduct.masters.length}</div>
              </div>
              
              <table className="w-full text-sm text-left border-collapse">
                <thead className="bg-slate-100 text-slate-700 text-xs uppercase sticky top-0">
                  <tr>
                    <th className="px-3 py-2 border-b">SOC</th>
                    <th className="px-3 py-2 border-b">AE Term</th>
                    <th className="px-3 py-2 border-b">Freq Text</th>
                    <th className="px-3 py-2 border-b text-right">Threshold %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {viewingProduct.masters.map(m => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-xs text-slate-500">{m.soc}</td>
                      <td className="px-3 py-2 font-medium">{m.ae_term}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{m.label_freq_text}</td>
                      <td className="px-3 py-2 text-right font-mono">{m.threshold_upper_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
          </div>
        )}
      </DetailModal>

      {/* Master Version History Modal */}
      <DetailModal
        isOpen={!!viewingVersions}
        onClose={() => setViewingVersions(null)}
        title={viewingVersions ? `主檔版本歷史：${viewingVersions.product.product_name}` : ''}
      >
        {viewingVersions && (() => {
          const { versions, currentRows } = viewingVersions;
          const selected = versions.find((v) => v.version_id === selectedVersionId);
          const diff = selected ? diffMasters(selected.rows, currentRows) : null;
          return (
            <div className="space-y-4">
              <div className="text-sm text-slate-500 bg-white p-3 rounded border border-slate-200">
                現行主檔共 <strong>{currentRows.length}</strong> 列。
                每次「儲存更新」時，舊版主檔會自動封存於此（共 {versions.length} 個歷史版本）。
              </div>

              {versions.length === 0 ? (
                <div className="text-center text-slate-400 text-sm py-8">
                  尚無封存版本。之後在「AE 主檔生成」對此產品執行「儲存更新」時，舊版會自動封存。
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">選擇要與現行版本比較的歷史版本</label>
                    <select
                      value={selectedVersionId}
                      onChange={(e) => setSelectedVersionId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-brand-500 outline-none bg-white"
                    >
                      <option value="">-- 請選擇歷史版本 --</option>
                      {versions.map((v) => (
                        <option key={v.version_id} value={v.version_id}>
                          {new Date(v.archived_at).toLocaleString()}（{v.rows.length} 列，仿單日期 {v.label_version_date || '未填'}）
                        </option>
                      ))}
                    </select>
                  </div>

                  {diff && (
                    <div className="space-y-3">
                      <div className="flex gap-3 text-xs">
                        <span className="px-2 py-1 rounded bg-green-50 text-green-700 border border-green-200 font-medium">新增 {diff.added.length}</span>
                        <span className="px-2 py-1 rounded bg-red-50 text-red-700 border border-red-200 font-medium">移除 {diff.removed.length}</span>
                        <span className="px-2 py-1 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">門檻變動 {diff.changed.length}</span>
                        <span className="px-2 py-1 rounded bg-slate-50 text-slate-500 border border-slate-200">未變 {diff.unchanged}</span>
                      </div>

                      {diff.added.length > 0 && (
                        <div className="border border-green-200 rounded-lg overflow-hidden">
                          <div className="bg-green-50 px-3 py-1.5 text-xs font-bold text-green-800">新增項目（現行版本才有）</div>
                          <table className="w-full text-xs">
                            <tbody className="divide-y divide-slate-100">
                              {diff.added.map((e) => (
                                <tr key={e.term}><td className="px-3 py-1.5 font-medium">{e.term}</td><td className="px-3 py-1.5 text-slate-500">{e.soc}</td><td className="px-3 py-1.5 text-right font-mono">{e.threshold}%</td></tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {diff.removed.length > 0 && (
                        <div className="border border-red-200 rounded-lg overflow-hidden">
                          <div className="bg-red-50 px-3 py-1.5 text-xs font-bold text-red-800">移除項目（僅舊版有）</div>
                          <table className="w-full text-xs">
                            <tbody className="divide-y divide-slate-100">
                              {diff.removed.map((e) => (
                                <tr key={e.term}><td className="px-3 py-1.5 font-medium">{e.term}</td><td className="px-3 py-1.5 text-slate-500">{e.soc}</td><td className="px-3 py-1.5 text-right font-mono">{e.threshold}%</td></tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {diff.changed.length > 0 && (
                        <div className="border border-amber-200 rounded-lg overflow-hidden">
                          <div className="bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800">門檻變動</div>
                          <table className="w-full text-xs">
                            <tbody className="divide-y divide-slate-100">
                              {diff.changed.map((e) => (
                                <tr key={e.term}>
                                  <td className="px-3 py-1.5 font-medium">{e.term}</td>
                                  <td className="px-3 py-1.5 text-slate-500">{e.soc}</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{e.from}% → <strong>{e.to}%</strong></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0 && (
                        <div className="text-center text-slate-400 text-sm py-4">此版本與現行主檔內容相同。</div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()}
      </DetailModal>

      {/* Trend Analysis Modal */}
      <DetailModal
        isOpen={!!viewingTrend}
        onClose={() => setViewingTrend(null)}
        title={viewingTrend ? `跨季趨勢分析：${viewingTrend.product.product_name}` : ''}
      >
        {viewingTrend && <TrendView records={viewingTrend.records} />}
      </DetailModal>

      {/* Batch Report Modal */}
      <DetailModal 
        isOpen={!!viewingBatch} 
        onClose={() => setViewingBatch(null)}
        title={viewingBatch ? (
          <div className="flex items-center gap-2">
            <span className="bg-slate-100 px-2 py-1 rounded text-sm font-mono">{viewingBatch.batch.quarter}</span>
            <span>監測報告內容</span>
            <span className="text-xs font-normal text-slate-500 ml-2">({new Date(viewingBatch.batch.generated_at).toLocaleString()})</span>
          </div>
        ) : ''}
      >
        {viewingBatch && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4 text-sm text-slate-500 mb-4 bg-white p-4 rounded border border-slate-200 shadow-sm">
                <div className="flex items-center gap-1"><Database size={14}/> <strong>Product ID:</strong> {viewingBatch.batch.product_id}</div>
                <div className="flex items-center gap-1"><Calculator size={14}/> <strong>Exposure:</strong> {viewingBatch.batch.exposure_value} {viewingBatch.batch.exposure_unit}</div>
                <div className="flex items-center gap-1"><Activity size={14}/> <strong>Total Cases Checked:</strong> {viewingBatch.records.length}</div>
              </div>

              <table className="w-full text-sm text-left border-collapse">
                <thead className="bg-slate-100 text-slate-700 text-xs uppercase sticky top-0">
                  <tr>
                    <th className="px-3 py-2 border-b">AE Term</th>
                    <th className="px-3 py-2 border-b text-right">Count</th>
                    <th className="px-3 py-2 border-b text-right">Rate %</th>
                    <th className="px-3 py-2 border-b text-right">Threshold %</th>
                    <th className="px-3 py-2 border-b text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {viewingBatch.records.map(r => (
                    <tr key={r.id} className={`hover:bg-slate-50 ${r.status === 'red' ? 'bg-red-50' : r.status === 'yellow' ? 'bg-yellow-50' : ''}`}>
                      <td className="px-3 py-2 font-medium">
                        {r.ae_term}
                        {r.serious && (
                          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200" title="含嚴重案例">S</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{r.count}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-slate-700">{r.rate_pct.toFixed(4)}%</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-400">{r.threshold_pct}%</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                          r.status === 'red' ? 'bg-red-200 text-red-800' : 
                          r.status === 'yellow' ? 'bg-yellow-200 text-yellow-800' : 
                          'bg-green-100 text-green-800'
                        }`}>
                          {r.status.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
          </div>
        )}
      </DetailModal>
    </div>
  );
});
