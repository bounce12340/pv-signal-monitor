import React, { useMemo } from 'react';
import { db, Product, MonitorBatch } from '../services/db';
import { currentQuarter, buildOverview } from '../services/dashboard';
import { AppMode } from '../types';
import {
  LayoutDashboard, AlertTriangle, TrendingUp, CalendarClock,
  CheckCircle2, ArrowRight, FileText, ClipboardCheck,
} from 'lucide-react';

interface DashboardModeProps {
  savedProducts: Product[];
  monitorBatches: MonitorBatch[];
  setSelectedProductId: (id: string) => void;
  setActiveMode: (mode: AppMode) => void;
  pendingLitCount: number;
}

export const DashboardMode = ({
  savedProducts, monitorBatches, setSelectedProductId, setActiveMode, pendingLitCount,
}: DashboardModeProps) => {
  const quarter = currentQuarter();
  const overviews = useMemo(
    () => buildOverview(savedProducts, monitorBatches, db.getQuarterlyAeMonitors(), quarter),
    [savedProducts, monitorBatches, quarter]
  );
  const pending = overviews.filter((o) => !o.doneInQuarter);
  const doneCount = overviews.length - pending.length;

  const goMonitor = (productId: string) => {
    setSelectedProductId(productId);
    setActiveMode('monitor');
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
      {/* Quarter progress header */}
      <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-lg shadow-slate-200/50 border border-white/50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-600">
            <LayoutDashboard size={20} />
          </div>
          <div>
            <h2 className="font-bold text-lg text-slate-900">監測總覽</h2>
            <p className="text-slate-500 text-sm">
              本季 <span className="font-mono font-semibold">{quarter}</span> 監測進度：
              {savedProducts.length === 0
                ? '尚無產品主檔'
                : `${doneCount} / ${overviews.length} 個產品已完成`}
            </p>
          </div>
        </div>

        {savedProducts.length === 0 ? (
          <button
            onClick={() => setActiveMode('generator')}
            className="text-sm text-brand-600 underline flex items-center gap-1"
          >
            <FileText size={14} /> 先到「AE 主檔生成」建立第一個產品
          </button>
        ) : pending.length > 0 ? (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-start gap-2">
            <CalendarClock size={16} className="mt-0.5 shrink-0" />
            <div>
              <span className="font-semibold">本季尚未監測：</span>
              {pending.map((o, i) => (
                <React.Fragment key={o.product.product_id}>
                  {i > 0 && '、'}
                  <button
                    onClick={() => goMonitor(o.product.product_id)}
                    className="underline decoration-dotted hover:text-amber-900 font-medium"
                  >
                    {o.product.product_name}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800 flex items-center gap-2">
            <CheckCircle2 size={16} /> 本季所有產品皆已完成監測。
          </div>
        )}
      </div>

      {/* Literature review to-do reminder */}
      {pendingLitCount > 0 && (
        <button
          onClick={() => setActiveMode('litReview')}
          className="w-full text-left p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex items-center gap-3 hover:bg-amber-100 transition-colors"
        >
          <ClipboardCheck size={18} className="shrink-0" />
          <span>
            文獻待核閱：<span className="font-bold">{pendingLitCount}</span> 篇尚未核閱，點此前往「文獻核閱」處理。
          </span>
        </button>
      )}

      {/* Product cards */}
      {overviews.length > 0 && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {overviews.map((o) => (
            <div
              key={o.product.product_id}
              className={`bg-white/90 backdrop-blur-sm rounded-xl border p-4 shadow-sm space-y-3 ${
                !o.doneInQuarter ? 'border-amber-300' :
                o.flaggedTerms.length > 0 ? 'border-orange-200' : 'border-slate-200'
              }`}
            >
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-900 truncate" title={o.product.product_name}>
                    {o.product.product_name}
                  </h3>
                  <p className="text-xs text-slate-400">仿單版本 {o.product.label_version_date || '—'}</p>
                </div>
                {o.doneInQuarter ? (
                  <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-green-100 text-green-700">
                    <CheckCircle2 size={12} /> 本季已監測
                  </span>
                ) : (
                  <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-700">
                    <CalendarClock size={12} /> 本季待辦
                  </span>
                )}
              </div>

              {o.latestBatch ? (
                <div className="text-xs text-slate-500 space-y-1">
                  <div>
                    最近報告：<span className="font-mono">{o.latestBatch.quarter}</span>
                    <span className="text-slate-400">
                      {' '}({new Date(o.latestBatch.generated_at).toLocaleDateString()})
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span>{o.latestBatch.record_count} 項</span>
                    {o.latestBatch.alert_count > 0 && (
                      <span className="text-red-600 font-semibold">⚠ {o.latestBatch.alert_count} Alert</span>
                    )}
                    {o.latestBatch.unexpected_count > 0 && (
                      <span className="text-rose-600 font-semibold flex items-center gap-0.5">
                        <AlertTriangle size={11} /> {o.latestBatch.unexpected_count} 未預期
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">尚未有監測報告</p>
              )}

              {o.flaggedTerms.length > 0 && (
                <div
                  className="text-xs bg-orange-50 border border-orange-200 rounded px-2 py-1.5 text-orange-700 flex items-start gap-1.5"
                  title="發生率連續 2 季以上上升"
                >
                  <TrendingUp size={13} className="mt-0.5 shrink-0" />
                  <span className="truncate">連續上升：{o.flaggedTerms.join('、')}</span>
                </div>
              )}

              <button
                onClick={() => goMonitor(o.product.product_id)}
                className="w-full py-1.5 text-xs font-medium rounded-lg border border-brand-200 text-brand-700 hover:bg-brand-50 transition-colors flex items-center justify-center gap-1"
              >
                前往監測 <ArrowRight size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
