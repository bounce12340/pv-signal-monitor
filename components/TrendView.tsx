import React, { useMemo, useState } from 'react';
import { QuarterlyAeMonitor } from '../services/db';
import { buildTrends, sortQuarters, TrendSeries } from '../services/trends';
import { TrendingUp } from 'lucide-react';

// Validated categorical palette (light mode) — fixed slot order, never cycled.
// Source: dataviz reference palette; aqua/yellow rely on the table view +
// direct labels for contrast relief.
const SERIES_COLORS = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948'];
const MAX_VISIBLE = SERIES_COLORS.length;

const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', baseline: '#c3c2b7' };

interface TrendViewProps {
  records: QuarterlyAeMonitor[];
}

export const TrendView = ({ records }: TrendViewProps) => {
  const trends = useMemo(() => buildTrends(records), [records]);

  // Slot pool: color follows the term while it stays selected — toggling other
  // terms never repaints survivors.
  const [slots, setSlots] = useState<Map<string, number>>(() => {
    const m = new Map<string, number>();
    trends.slice(0, Math.min(4, MAX_VISIBLE)).forEach((s, i) => m.set(s.term, i));
    return m;
  });

  const toggleTerm = (term: string) => {
    setSlots((prev) => {
      const next = new Map(prev);
      if (next.has(term)) {
        next.delete(term);
      } else {
        const used = new Set(next.values());
        let free = -1;
        for (let i = 0; i < MAX_VISIBLE; i++) {
          if (!used.has(i)) { free = i; break; }
        }
        if (free === -1) return prev; // pool full — ignore
        next.set(term, free);
      }
      return next;
    });
  };

  const visible: TrendSeries[] = trends.filter((s) => slots.has(s.term));
  const quarters = useMemo(
    () => sortQuarters([...new Set(visible.flatMap((s) => s.points.map((p) => p.quarter)))]),
    [visible]
  );

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // --- Layout ---
  const W = 720, H = 300;
  const M = { l: 52, r: 116, t: 16, b: 30 };
  const plotW = W - M.l - M.r;
  const plotH = H - M.t - M.b;

  const singleThreshold =
    visible.length === 1 && visible[0].points.length > 0
      ? visible[0].points[visible[0].points.length - 1].threshold_pct
      : null;

  const yMaxRaw = Math.max(
    0.0001,
    ...visible.flatMap((s) => s.points.map((p) => p.rate_pct)),
    singleThreshold ?? 0
  );
  const yMax = yMaxRaw * 1.15;
  const yTicks = 4;

  const x = (qi: number) =>
    M.l + (quarters.length <= 1 ? plotW / 2 : (qi * plotW) / (quarters.length - 1));
  const y = (rate: number) => M.t + plotH - (rate / yMax) * plotH;

  const seriesPath = (s: TrendSeries) =>
    s.points
      .filter((p) => quarters.includes(p.quarter))
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(quarters.indexOf(p.quarter)).toFixed(1)},${y(p.rate_pct).toFixed(1)}`)
      .join(' ');

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (quarters.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0, bestD = Infinity;
    quarters.forEach((_, i) => {
      const d = Math.abs(x(i) - px);
      if (d < bestD) { bestD = d; best = i; }
    });
    setHoverIdx(best);
  };

  if (trends.length === 0) {
    return (
      <div className="text-center text-slate-400 text-sm py-10">
        此產品尚無已儲存的監測報表，無法繪製趨勢。
      </div>
    );
  }

  const fmtPct = (v: number) => `${v.toFixed(v >= 1 ? 2 : 4)}%`;

  return (
    <div className="space-y-4">
      {/* Flagged summary */}
      {trends.some((s) => s.flagged) && (
        <div className="flex flex-wrap gap-2">
          {trends.filter((s) => s.flagged).map((s) => (
            <span
              key={s.term}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold border"
              style={{ backgroundColor: '#fdf0ea', borderColor: '#ec835a', color: '#9a3d17' }}
            >
              <TrendingUp size={12} /> {s.term}：連續 {s.risingStreak} 季上升
            </span>
          ))}
        </div>
      )}

      {/* Chart */}
      <div className="relative bg-white rounded-lg border border-slate-200 p-2">
        {quarters.length < 2 ? (
          <div className="text-center text-slate-400 text-sm py-10">
            所選項目至少需要 2 個季度的資料才能顯示趨勢線。
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto"
            onMouseMove={handleMove}
            onMouseLeave={() => setHoverIdx(null)}
            role="img"
            aria-label="各不良反應逐季發生率趨勢圖"
          >
            {/* Gridlines + y labels */}
            {Array.from({ length: yTicks + 1 }, (_, i) => {
              const v = (yMax / yTicks) * i;
              return (
                <g key={i}>
                  <line x1={M.l} x2={M.l + plotW} y1={y(v)} y2={y(v)} stroke={INK.grid} strokeWidth={1} />
                  <text x={M.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill={INK.muted}>
                    {fmtPct(v)}
                  </text>
                </g>
              );
            })}
            {/* Baseline */}
            <line x1={M.l} x2={M.l + plotW} y1={M.t + plotH} y2={M.t + plotH} stroke={INK.baseline} strokeWidth={1} />
            {/* X labels */}
            {quarters.map((q, i) => (
              <text key={q} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={INK.muted}>
                {q}
              </text>
            ))}

            {/* Threshold reference (single series only) */}
            {singleThreshold !== null && singleThreshold > 0 && singleThreshold <= yMax && (
              <g>
                <line
                  x1={M.l} x2={M.l + plotW}
                  y1={y(singleThreshold)} y2={y(singleThreshold)}
                  stroke={INK.muted} strokeWidth={1.5} strokeDasharray="6 4"
                />
                <text x={M.l + plotW + 6} y={y(singleThreshold) + 4} fontSize={11} fill={INK.secondary}>
                  仿單門檻 {singleThreshold}%
                </text>
              </g>
            )}

            {/* Crosshair */}
            {hoverIdx !== null && (
              <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={M.t} y2={M.t + plotH} stroke={INK.baseline} strokeWidth={1} />
            )}

            {/* Series */}
            {visible.map((s) => {
              const color = SERIES_COLORS[slots.get(s.term)!];
              const pts = s.points.filter((p) => quarters.includes(p.quarter));
              const last = pts[pts.length - 1];
              return (
                <g key={s.term}>
                  <path d={seriesPath(s)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
                  {pts.map((p) => (
                    <circle
                      key={p.quarter}
                      cx={x(quarters.indexOf(p.quarter))}
                      cy={y(p.rate_pct)}
                      r={hoverIdx !== null && quarters[hoverIdx] === p.quarter ? 5 : 4}
                      fill={color}
                      stroke="#ffffff"
                      strokeWidth={2}
                    />
                  ))}
                  {/* Direct labels at line end when few series */}
                  {visible.length <= 4 && last && (
                    <g>
                      <rect
                        x={M.l + plotW + 6}
                        y={y(last.rate_pct) - 4}
                        width={8} height={8} rx={2}
                        fill={color}
                      />
                      <text
                        x={M.l + plotW + 18}
                        y={y(last.rate_pct) + 4}
                        fontSize={11}
                        fill={INK.secondary}
                      >
                        {s.term.length > 8 ? s.term.slice(0, 8) + '…' : s.term}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {/* Tooltip */}
        {hoverIdx !== null && quarters.length >= 2 && (
          <div
            className="absolute z-10 bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs pointer-events-none"
            style={{
              left: `${(x(hoverIdx) / W) * 100}%`,
              top: 8,
              transform: x(hoverIdx) > W * 0.6 ? 'translateX(-105%)' : 'translateX(8px)',
            }}
          >
            <div className="font-bold mb-1" style={{ color: INK.primary }}>{quarters[hoverIdx]}</div>
            {visible.map((s) => {
              const p = s.points.find((pt) => pt.quarter === quarters[hoverIdx]);
              if (!p) return null;
              return (
                <div key={s.term} className="flex items-center gap-2 whitespace-nowrap">
                  <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: SERIES_COLORS[slots.get(s.term)!] }} />
                  <span style={{ color: INK.secondary }}>{s.term}</span>
                  <span className="font-mono font-semibold ml-auto" style={{ color: INK.primary }}>
                    {fmtPct(p.rate_pct)} ({p.count} 例)
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend / series selector */}
      <div className="flex flex-wrap gap-2">
        {trends.map((s) => {
          const selected = slots.has(s.term);
          const color = selected ? SERIES_COLORS[slots.get(s.term)!] : undefined;
          return (
            <button
              key={s.term}
              onClick={() => toggleTerm(s.term)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${
                selected
                  ? 'bg-white border-slate-300 text-slate-800 font-medium shadow-sm'
                  : 'bg-slate-50 border-slate-200 text-slate-400 hover:text-slate-600'
              }`}
              title={selected ? '點擊隱藏' : slots.size >= MAX_VISIBLE ? `最多同時顯示 ${MAX_VISIBLE} 條` : '點擊顯示'}
            >
              <span
                className="w-2.5 h-2.5 rounded-sm inline-block border border-slate-200"
                style={{ backgroundColor: color ?? 'transparent' }}
              />
              {s.term}
              {s.flagged && <TrendingUp size={12} className="text-orange-600" />}
            </button>
          );
        })}
      </div>

      {/* Data table (accessibility relief + exact values) */}
      {visible.length > 0 && quarters.length > 0 && (
        <div className="overflow-x-auto border rounded-lg border-slate-200">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-600 font-semibold">
              <tr>
                <th className="px-3 py-2">AE Term</th>
                {quarters.map((q) => (
                  <th key={q} className="px-3 py-2 text-right font-mono">{q}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((s) => (
                <tr key={s.term} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-800">
                    <span className="w-2 h-2 rounded-sm inline-block mr-1.5" style={{ backgroundColor: SERIES_COLORS[slots.get(s.term)!] }} />
                    {s.term}
                  </td>
                  {quarters.map((q) => {
                    const p = s.points.find((pt) => pt.quarter === q);
                    return (
                      <td key={q} className="px-3 py-2 text-right font-mono text-slate-600">
                        {p ? fmtPct(p.rate_pct) : '–'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
