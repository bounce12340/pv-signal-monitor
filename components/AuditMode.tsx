import React from 'react';
import { ShieldCheck, ScrollText } from 'lucide-react';

export const AuditMode = React.memo(({ systemLogs }: any) => {
  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-500 space-y-6">
      <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
            <div className="bg-amber-100 p-2 rounded-full text-amber-600">
              <ShieldCheck size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">稽核日誌 (Audit Trail)</h2>
              <p className="text-slate-500 text-sm">GVP 規範要求之系統操作紀錄，僅供檢視，不可修改。</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-slate-50 border border-slate-200 rounded text-xs text-slate-500">
            <ScrollText size={14}/>
            Total Logs: {systemLogs.length}
          </div>
        </div>

        <div className="overflow-hidden border rounded-lg border-slate-200">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 w-48">Timestamp</th>
                <th className="px-4 py-3 w-32">Action</th>
                <th className="px-4 py-3 w-32">Module</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 w-32">User</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {systemLogs.map((log: any) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${
                        log.action_type === 'CREATE' ? 'bg-green-50 text-green-700 border-green-200' :
                        log.action_type === 'UPDATE' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        log.action_type === 'DELETE' ? 'bg-red-50 text-red-700 border-red-200' :
                        log.action_type === 'EXPORT' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                        'bg-slate-100 text-slate-700 border-slate-200'
                      }`}>
                        {log.action_type}
                      </span>
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-slate-600">
                      {log.module}
                  </td>
                  <td className="px-4 py-3 text-slate-800">
                      {log.description}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                      {log.user}
                  </td>
                </tr>
              ))}
              {systemLogs.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">尚無系統日誌</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});
