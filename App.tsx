import React, { useState, useEffect } from 'react';
import { db, Product, MonitorBatch, SystemLog } from './services/db';
import { AppMode, ExtractedMaster } from './types';
import { FileText, Activity, Database, ShieldCheck, Settings, LayoutDashboard } from 'lucide-react';
import { DashboardMode } from './components/DashboardMode';
import { GeneratorMode } from './components/GeneratorMode';
import { MonitorMode } from './components/MonitorMode';
import { LibraryMode } from './components/LibraryMode';
import { AuditMode } from './components/AuditMode';
import { SettingsModal } from './components/SettingsModal';
import { SyncWidget } from './components/SyncWidget';

export default function App() {
  // Navigation State
  const [activeMode, setActiveMode] = useState<AppMode>('dashboard');

  // Shared State
  const [masterResult, setMasterResult] = useState<ExtractedMaster | null>(null);
  const [currentExtractionProductId, setCurrentExtractionProductId] = useState<string | null>(null);
  const [savedProducts, setSavedProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [monitorBatches, setMonitorBatches] = useState<MonitorBatch[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  
  // Trigger to force re-render of library view when DB changes
  const [dbUpdateTrigger, setDbUpdateTrigger] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Refresh products list
  useEffect(() => {
    setSavedProducts(db.getProducts());
    setSystemLogs(db.getLogs());
    setMonitorBatches(db.getMonitorBatches());
  }, [activeMode, dbUpdateTrigger]);

  return (
    <div 
      className="min-h-screen text-slate-800 font-sans selection:bg-brand-200 selection:text-brand-900"
      style={{
        backgroundColor: '#ffffff',
        backgroundImage: `
          radial-gradient(at 0% 0%, hsla(204,100%,86%,0.4) 0px, transparent 50%),
          radial-gradient(at 50% 0%, hsla(217,100%,90%,0.3) 0px, transparent 50%),
          radial-gradient(at 100% 0%, hsla(186,100%,84%,0.3) 0px, transparent 50%),
          radial-gradient(at 0% 50%, hsla(250,100%,94%,0.3) 0px, transparent 50%),
          radial-gradient(at 100% 50%, hsla(200,100%,88%,0.3) 0px, transparent 50%),
          radial-gradient(at 0% 100%, hsla(217,100%,92%,0.4) 0px, transparent 50%),
          radial-gradient(at 100% 100%, hsla(190,100%,90%,0.3) 0px, transparent 50%)
        `,
        backgroundAttachment: 'fixed',
        backgroundSize: 'cover'
      }}
    >
      {/* Top Navigation */}
      <nav className="bg-slate-900/90 backdrop-blur-md text-white shadow-md sticky top-0 z-50 border-b border-slate-700/50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-brand-500 p-2 rounded text-white shadow-lg shadow-brand-500/20">
              <Activity size={20} />
            </div>
            <span className="font-bold text-lg tracking-tight">PV 智慧監測平台</span>
          </div>
          <div className="flex gap-1 bg-slate-800/80 p-1 rounded-lg border border-slate-700">
            <button
              onClick={() => setActiveMode('dashboard')}
              className={`px-3 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${
                activeMode === 'dashboard' ? 'bg-brand-600 text-white shadow-lg shadow-brand-900/50' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              <LayoutDashboard size={16}/>
              總覽
            </button>
            <button
              onClick={() => setActiveMode('generator')}
              className={`px-3 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${
                activeMode === 'generator' ? 'bg-brand-600 text-white shadow-lg shadow-brand-900/50' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              <FileText size={16}/>
              1. AE 主檔生成
            </button>
            <button
              onClick={() => setActiveMode('monitor')}
              className={`px-3 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${
                activeMode === 'monitor' ? 'bg-brand-600 text-white shadow-lg shadow-brand-900/50' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              <Activity size={16}/>
              2. 訊號監測
            </button>
            <button
              onClick={() => setActiveMode('library')}
              className={`px-3 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${
                activeMode === 'library' ? 'bg-brand-600 text-white shadow-lg shadow-brand-900/50' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              <Database size={16}/>
              資料庫管理
            </button>
            <button
              onClick={() => setActiveMode('audit')}
              className={`px-3 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${
                activeMode === 'audit' ? 'bg-amber-600 text-white shadow-lg shadow-amber-900/50' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              <ShieldCheck size={16}/>
              稽核日誌
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="px-3 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2 text-slate-400 hover:text-white hover:bg-slate-700/50"
              title="系統設定（AI 金鑰、判定規則）"
            >
              <Settings size={16}/>
            </button>
            <SyncWidget
              refreshKey={`${activeMode}-${dbUpdateTrigger}`}
              onPulled={() => setDbUpdateTrigger((prev) => prev + 1)}
            />
          </div>
        </div>
      </nav>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <div className="max-w-6xl mx-auto p-4 md:p-8">
        {activeMode === 'dashboard' && (
          <DashboardMode
            savedProducts={savedProducts}
            monitorBatches={monitorBatches}
            setSelectedProductId={setSelectedProductId}
            setActiveMode={setActiveMode}
          />
        )}

        {activeMode === 'generator' && (
          <GeneratorMode 
            masterResult={masterResult} 
            setMasterResult={setMasterResult}
            currentExtractionProductId={currentExtractionProductId}
            setCurrentExtractionProductId={setCurrentExtractionProductId}
            setSavedProducts={setSavedProducts}
            setSelectedProductId={setSelectedProductId}
          />
        )}

        {activeMode === 'monitor' && (
          <MonitorMode 
            masterResult={masterResult}
            setMasterResult={setMasterResult}
            savedProducts={savedProducts}
            selectedProductId={selectedProductId}
            setSelectedProductId={setSelectedProductId}
            setDbUpdateTrigger={setDbUpdateTrigger}
            setActiveMode={setActiveMode}
          />
        )}

        {activeMode === 'library' && (
          <LibraryMode 
            savedProducts={savedProducts}
            setSavedProducts={setSavedProducts}
            monitorBatches={monitorBatches}
            setDbUpdateTrigger={setDbUpdateTrigger}
            currentExtractionProductId={currentExtractionProductId}
            setCurrentExtractionProductId={setCurrentExtractionProductId}
          />
        )}

        {activeMode === 'audit' && (
          <AuditMode systemLogs={systemLogs} />
        )}
      </div>

      <footer className="max-w-6xl mx-auto px-4 pb-6 text-center text-[11px] text-slate-400">
        PV 智慧監測平台 · build {__BUILD_INFO__}
      </footer>
    </div>
  );
}
