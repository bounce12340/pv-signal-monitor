import React, { useState } from 'react';
import { FileText, X, Copy, Check, Download } from 'lucide-react';

interface CiomsModalProps {
  ciomsText: string | null;
  onClose: () => void;
}

// CIOMS-I / E2B(R3) draft viewer: copy-to-clipboard / download-as-txt for the
// offline, deterministic draft produced by services/literature/cioms.ts.
export const CiomsModal = ({ ciomsText, onClose }: CiomsModalProps) => {
  const [copied, setCopied] = useState(false);
  if (ciomsText === null) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(ciomsText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob(['﻿' + ciomsText], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `CIOMS_Draft_${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px] p-4 animate-in fade-in duration-300"
      onClick={onClose}
    >
      <div
        className="bg-white/95 backdrop-blur-sm rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col border border-white/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center text-white">
              <FileText size={16} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800">CIOMS-I / E2B 草稿</h3>
              <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wide">AI 輔助產生，需人工審閱後方可提交</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-full transition-colors">
            <X size={20} className="text-slate-500" />
          </button>
        </div>
        <pre className="flex-1 overflow-auto px-6 py-4 text-xs font-mono text-slate-700 whitespace-pre-wrap leading-relaxed bg-slate-50/50">
          {ciomsText}
        </pre>
        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
          <button
            onClick={handleCopy}
            className="flex-1 bg-brand-600 hover:bg-brand-700 text-white py-2.5 rounded-lg font-medium text-sm shadow-md flex items-center justify-center gap-2 transition-colors"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? '已複製' : '複製全文'}
          </button>
          <button
            onClick={handleDownload}
            className="flex-1 bg-slate-800 hover:bg-slate-900 text-white py-2.5 rounded-lg font-medium text-sm shadow-md flex items-center justify-center gap-2 transition-colors"
          >
            <Download size={16} /> 下載 .txt
          </button>
        </div>
      </div>
    </div>
  );
};
