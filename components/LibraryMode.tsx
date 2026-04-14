import React, { useState } from 'react';
import { db, Product, LabelAeMaster, MonitorBatch, QuarterlyAeMonitor } from '../services/db';
import { Database, FolderOpen, Eye, Trash2, History, List, Calculator, Activity } from 'lucide-react';
import { DetailModal } from './DetailModal';

export const LibraryMode = React.memo(({
  savedProducts, setSavedProducts,
  monitorBatches,
  setDbUpdateTrigger,
  currentExtractionProductId, setCurrentExtractionProductId
}: any) => {
  const [viewingProduct, setViewingProduct] = useState<{product: Product, masters: LabelAeMaster[]} | null>(null);
  const [viewingBatch, setViewingBatch] = useState<{batch: MonitorBatch, records: QuarterlyAeMonitor[]} | null>(null);

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
       setDbUpdateTrigger((prev: number) => prev + 1);
     }
  };

  const handleDeleteProduct = (pid: string) => {
    if(confirm('確定要刪除此產品及其所有相關資料嗎？此動作將被記錄在稽核日誌中。')) {
      db.deleteProduct(pid);
      setSavedProducts(db.getProducts());
      if (currentExtractionProductId === pid) {
        setCurrentExtractionProductId(null);
      }
      setDbUpdateTrigger((prev: number) => prev + 1);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-500 space-y-6">
      <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-brand-100 p-2 rounded-full text-brand-600">
            <Database size={24} />
          </div>
          <h2 className="text-xl font-bold text-slate-900">資料庫檢視</h2>
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
                  {savedProducts.map((p: any) => (
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
                  {monitorBatches.map((batch: any) => {
                    const product = savedProducts.find((p: any) => p.product_id === batch.product_id);
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
                      <td className="px-3 py-2 font-medium">{r.ae_term}</td>
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
