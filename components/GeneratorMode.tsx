import React, { useState } from 'react';
import { extractAEMaster, FileInput } from '../services/gemini';
import { db } from '../services/db';
import { FileText, Upload, Database, AlertCircle, Check, Save, Plus, Trash2, Edit2, FileType } from 'lucide-react';

export const GeneratorMode = React.memo(({
  masterResult, setMasterResult,
  currentExtractionProductId, setCurrentExtractionProductId,
  setSavedProducts,
  setSelectedProductId
}: any) => {
  const [textInput, setTextInput] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [fileDataUrl, setFileDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setFileDataUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleClearFile = (e: React.MouseEvent) => {
    e.preventDefault();
    setUploadedFile(null);
    setFileDataUrl(null);
  };

  const handleProcess = async () => {
    if (!textInput && !uploadedFile) {
      setError("請提供文字描述或上傳檔案");
      return;
    }

    setLoading(true);
    setError(null);
    setMasterResult(null);
    setCurrentExtractionProductId(null);
    setSaveStatus('idle');

    try {
      let fileInput: FileInput | undefined = undefined;
      if (uploadedFile && fileDataUrl) {
        const base64 = fileDataUrl.split(',')[1];
        fileInput = {
          data: base64,
          mimeType: uploadedFile.type
        };
      }

      const data = await extractAEMaster(textInput, fileInput);
      setMasterResult(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "發生錯誤，請檢查 API Key 或重試。");
    } finally {
      setLoading(false);
    }
  };

  const handleManualCreate = () => {
    setMasterResult({
      product_name: "New Product (Manual)",
      label_version_date: new Date().toISOString().split('T')[0],
      frequency_legend: "Manual Entry",
      ae_master: []
    });
    setError(null);
    setSaveStatus('idle');
    setCurrentExtractionProductId(null);
  };

  const handleResultChange = (index: number, field: string, value: any) => {
    if (!masterResult) return;
    const newAeMaster = [...masterResult.ae_master];
    
    if (field === 'ae_terms_split') {
      newAeMaster[index] = {
        ...newAeMaster[index],
        ae_terms_split: value.split(/[,，、;]+/).map((t: string) => t.trim()).filter((t: string) => t)
      };
    } else {
      newAeMaster[index] = { ...newAeMaster[index], [field]: value };
    }
    
    setMasterResult({ ...masterResult, ae_master: newAeMaster });
    setSaveStatus('idle');
  };

  const handleDeleteResultItem = (index: number) => {
    if (!masterResult) return;
    const newAeMaster = masterResult.ae_master.filter((_: any, i: number) => i !== index);
    setMasterResult({ ...masterResult, ae_master: newAeMaster });
    setSaveStatus('idle');
  };

  const handleAddResultItem = () => {
    if (!masterResult) return;
    const newItem = {
      soc: "",
      ae_term_raw: "",
      ae_terms_split: [],
      label_frequency_text: "",
      label_threshold_upper_pct: 0,
      mapping_rule_note: "Manual Entry"
    };
    setMasterResult({ 
      ...masterResult, 
      ae_master: [...(masterResult.ae_master || []), newItem] 
    });
    setSaveStatus('idle');
  };

  const handleSaveToDb = () => {
    if (!masterResult) return;
    try {
      const newId = db.saveExtractedMaster(masterResult, currentExtractionProductId || undefined);
      setCurrentExtractionProductId(newId);
      setSaveStatus('saved');
      setSavedProducts(db.getProducts());
      setSelectedProductId(newId);
    } catch (e) {
      console.error(e);
      alert("儲存失敗");
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
      <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg shadow-slate-200/50 border border-white/50 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-600">
            <FileText size={20} />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-900">仿單資料提取</h2>
            <p className="text-slate-500 text-sm">上傳仿單 PDF、圖片或貼上文字，自動轉換為標準 JSON 主檔</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Input Area */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">仿單文字 (Text)</label>
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                className="w-full h-32 p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none text-sm bg-white/50 focus:bg-white transition-colors"
                placeholder="貼上仿單內容..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">仿單檔案 (PDF / 圖片)</label>
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-4 hover:bg-slate-50 text-center cursor-pointer relative transition-colors bg-slate-50/30">
                <input 
                  type="file" 
                  accept="image/*,application/pdf" 
                  onChange={handleFileChange} 
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                />
                {uploadedFile ? (
                  <div className="relative flex flex-col items-center justify-center p-2">
                      {uploadedFile.type === 'application/pdf' ? (
                        <div className="flex flex-col items-center text-brand-600">
                          <FileType size={48} className="mb-2" />
                          <span className="text-sm font-medium text-slate-700 max-w-[200px] truncate">{uploadedFile.name}</span>
                          <span className="text-xs text-slate-400 uppercase">PDF Document</span>
                        </div>
                      ) : (
                        fileDataUrl && (
                          <>
                          <img src={fileDataUrl} alt="Preview" className="max-h-48 rounded shadow-sm border border-slate-200" />
                          <span className="text-xs text-slate-400 mt-2 max-w-[200px] truncate">{uploadedFile.name}</span>
                          </>
                        )
                      )}
                      <button 
                        onClick={handleClearFile} 
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1.5 shadow-md hover:bg-red-600 z-10"
                        title="移除檔案"
                      >
                        <Trash2 size={14} />
                      </button>
                  </div>
                ) : (
                  <div className="text-slate-400 py-6">
                    <Upload size={32} className="mx-auto mb-2 text-slate-300" />
                    <p className="text-sm font-medium text-slate-600">點擊上傳 PDF 或 圖片</p>
                    <p className="text-xs text-slate-400 mt-1">支援 .pdf, .jpg, .png</p>
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={handleProcess}
              disabled={loading}
              className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-medium shadow-lg shadow-brand-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Database size={18} />}
              {loading ? 'AI 解析中...' : '產生 AE Master'}
            </button>
            {error && (
              <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm flex flex-col gap-2">
                <div className="flex items-center gap-2"><AlertCircle size={16}/>{error}</div>
                <button 
                    onClick={handleManualCreate}
                    className="self-start text-xs bg-white border border-red-200 px-2 py-1 rounded shadow-sm hover:bg-red-50 transition-colors"
                >
                    無法解析？切換為手動建立
                </button>
              </div>
            )}
          </div>

          {/* Result Area - Now Editable */}
          <div className="flex flex-col h-full bg-slate-50/50 rounded-lg border border-slate-200 overflow-hidden min-h-[400px]">
            <div className="flex justify-between items-center px-4 py-2 border-b border-slate-200 bg-white/80 backdrop-blur-sm">
              <span className="font-semibold text-sm">解析結果 (可編輯)</span>
              <div className="flex gap-2">
                  {masterResult && (
                    <button 
                      onClick={handleSaveToDb}
                      disabled={saveStatus === 'saved'}
                      className={`px-3 py-1 text-xs rounded font-medium flex items-center gap-1 transition-colors ${saveStatus === 'saved' ? 'bg-green-100 text-green-700' : 'bg-brand-600 text-white hover:bg-brand-700'}`}
                    >
                      {saveStatus === 'saved' ? <Check size={14}/> : <Save size={14}/>}
                      {saveStatus === 'saved' ? '已儲存' : (currentExtractionProductId ? '儲存更新' : '存入資料庫')}
                    </button>
                  )}
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 relative">
              {!masterResult ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300">
                  <Database size={40} className="mb-2 opacity-20" />
                  <p className="text-sm mb-4">尚無資料</p>
                  <button 
                      onClick={handleManualCreate}
                      className="px-4 py-2 bg-white border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 hover:text-brand-600 shadow-sm transition-all flex items-center gap-2"
                  >
                      <Edit2 size={16} />
                      手動建立空白主檔
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2 text-xs bg-white p-3 rounded border border-slate-200">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 whitespace-nowrap">Product:</span>
                        <input 
                          value={masterResult.product_name || ''} 
                          onChange={(e) => setMasterResult({...masterResult, product_name: e.target.value})}
                          className="w-full text-xs border-b border-slate-200 focus:border-brand-500 outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 whitespace-nowrap">Ver:</span>
                        <input 
                          value={masterResult.label_version_date || ''} 
                          onChange={(e) => setMasterResult({...masterResult, label_version_date: e.target.value})}
                          className="w-full text-xs border-b border-slate-200 focus:border-brand-500 outline-none"
                        />
                      </div>
                  </div>

                  {/* List Header */}
                  <div className="grid grid-cols-12 gap-2 px-2 text-xs font-semibold text-slate-500">
                      <div className="col-span-3">SOC / Freq</div>
                      <div className="col-span-6">AE Terms (以逗號分隔)</div>
                      <div className="col-span-2 text-right">門檻%</div>
                      <div className="col-span-1"></div>
                  </div>

                  <div className="space-y-2">
                      {masterResult.ae_master?.map((item: any, idx: number) => (
                        <div key={idx} className="bg-white p-3 rounded border border-slate-200 hover:border-brand-300 transition-colors group">
                          <div className="grid grid-cols-12 gap-3 items-start">
                            {/* Column 1: SOC & Frequency */}
                            <div className="col-span-3 space-y-2">
                              <input 
                                value={item.soc} 
                                onChange={(e) => handleResultChange(idx, 'soc', e.target.value)}
                                placeholder="SOC"
                                className="w-full text-xs px-2 py-1 border border-slate-200 rounded focus:ring-1 focus:ring-brand-500 outline-none"
                              />
                              <input 
                                value={item.label_frequency_text} 
                                onChange={(e) => handleResultChange(idx, 'label_frequency_text', e.target.value)}
                                placeholder="常見/罕見..."
                                className="w-full text-xs px-2 py-1 border border-slate-200 rounded focus:ring-1 focus:ring-brand-500 outline-none"
                              />
                            </div>
                            
                            {/* Column 2: Terms (Joined) */}
                            <div className="col-span-6">
                              <textarea 
                                value={item.ae_terms_split.join(', ')} 
                                onChange={(e) => handleResultChange(idx, 'ae_terms_split', e.target.value)}
                                placeholder="AE1, AE2..."
                                rows={3}
                                className="w-full text-sm px-2 py-1 border border-slate-200 rounded focus:ring-1 focus:ring-brand-500 outline-none resize-none"
                              />
                            </div>

                            {/* Column 3: Threshold & Action */}
                            <div className="col-span-3 flex flex-col items-end gap-2">
                              <div className="flex items-center gap-1 w-full">
                                <input 
                                  type="number"
                                  step="0.01" 
                                  value={item.label_threshold_upper_pct} 
                                  onChange={(e) => handleResultChange(idx, 'label_threshold_upper_pct', parseFloat(e.target.value))}
                                  className="w-full text-right text-sm font-mono font-bold text-brand-600 px-2 py-1 border border-slate-200 rounded focus:ring-1 focus:ring-brand-500 outline-none"
                                />
                                <span className="text-xs text-slate-400">%</span>
                              </div>
                              <button 
                                onClick={() => handleDeleteResultItem(idx)}
                                className="text-slate-300 hover:text-red-500 transition-colors p-1"
                                title="刪除此列"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                  
                  <button 
                    onClick={handleAddResultItem}
                    className="w-full py-2 border-2 border-dashed border-slate-300 rounded text-slate-500 text-xs font-medium hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50 transition-all flex items-center justify-center gap-1"
                  >
                    <Plus size={14} /> 新增提取項目
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
