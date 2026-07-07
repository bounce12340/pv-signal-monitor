import type { QuarterlyAeMonitor } from './db';

export interface TrendPoint {
  quarter: string;      // e.g. "2026Q1"
  rate_pct: number;
  count: number;
  status: QuarterlyAeMonitor['status'];
  threshold_pct: number;
}

export interface TrendSeries {
  term: string;
  points: TrendPoint[];       // sorted by quarter ascending
  // Number of consecutive quarter-over-quarter increases at the end of the series.
  risingStreak: number;
  // True when the rate rose for >= 2 consecutive quarters (3 data points).
  flagged: boolean;
  latestRate: number;
}

// Quarters sort correctly as strings only if zero-padded consistently
// ("2026Q1" < "2026Q2" < "2027Q1"), which matches how the app builds them.
export function sortQuarters(quarters: string[]): string[] {
  return [...quarters].sort();
}

// Build per-term trend series from raw monitor records.
// When the same product/quarter/term was saved multiple times (re-runs),
// only the batch with the latest generated_at wins.
export function buildTrends(records: QuarterlyAeMonitor[]): TrendSeries[] {
  // 1. Latest generated_at per quarter (a batch covers a whole quarter run)
  const latestBatchPerQuarter = new Map<string, string>();
  records.forEach((r) => {
    const cur = latestBatchPerQuarter.get(r.quarter);
    if (!cur || r.generated_at > cur) {
      latestBatchPerQuarter.set(r.quarter, r.generated_at);
    }
  });

  // 2. Group surviving records by term
  const byTerm = new Map<string, TrendPoint[]>();
  records.forEach((r) => {
    if (latestBatchPerQuarter.get(r.quarter) !== r.generated_at) return;
    if (!byTerm.has(r.ae_term)) byTerm.set(r.ae_term, []);
    byTerm.get(r.ae_term)!.push({
      quarter: r.quarter,
      rate_pct: r.rate_pct,
      count: r.count,
      status: r.status,
      threshold_pct: r.threshold_pct,
    });
  });

  // 3. Sort points, compute rising streaks
  const series: TrendSeries[] = [];
  byTerm.forEach((points, term) => {
    points.sort((a, b) => a.quarter.localeCompare(b.quarter));
    let streak = 0;
    for (let i = points.length - 1; i > 0; i--) {
      if (points[i].rate_pct > points[i - 1].rate_pct) streak++;
      else break;
    }
    series.push({
      term,
      points,
      risingStreak: streak,
      flagged: streak >= 2,
      latestRate: points[points.length - 1]?.rate_pct ?? 0,
    });
  });

  // Flagged first, then by latest rate descending, then name for stability
  series.sort((a, b) => {
    if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
    if (b.latestRate !== a.latestRate) return b.latestRate - a.latestRate;
    return a.term.localeCompare(b.term);
  });
  return series;
}
