// Pure overview logic for the dashboard landing page: per-product latest
// monitoring status, current-quarter to-do state, and rising-trend flags.

import type { Product, MonitorBatch, QuarterlyAeMonitor } from './db';
import { buildTrends } from './trends';

/** e.g. 2026-07-08 → "2026Q3", matching how the app labels quarters. */
export function currentQuarter(d: Date = new Date()): string {
  return `${d.getFullYear()}Q${Math.floor(d.getMonth() / 3) + 1}`;
}

export interface ProductOverview {
  product: Product;
  // Most recent saved report batch, or null if never monitored.
  latestBatch: MonitorBatch | null;
  // True when a report for `quarter` has been saved.
  doneInQuarter: boolean;
  // Terms whose rate rose for >= 2 consecutive quarters.
  flaggedTerms: string[];
}

export function buildOverview(
  products: Product[],
  batches: MonitorBatch[],
  records: QuarterlyAeMonitor[],
  quarter: string
): ProductOverview[] {
  const overviews = products.map((product): ProductOverview => {
    const own = batches.filter((b) => b.product_id === product.product_id);
    const latestBatch = own.reduce<MonitorBatch | null>(
      (acc, b) => (!acc || b.generated_at > acc.generated_at ? b : acc),
      null
    );
    const flaggedTerms = buildTrends(
      records.filter((r) => r.product_id === product.product_id)
    )
      .filter((s) => s.flagged)
      .map((s) => s.term);

    return {
      product,
      latestBatch,
      doneInQuarter: own.some((b) => b.quarter === quarter),
      flaggedTerms,
    };
  });

  // Products needing attention first: this quarter's to-dos, then trend
  // flags, then name for stability.
  overviews.sort((a, b) => {
    if (a.doneInQuarter !== b.doneInQuarter) return a.doneInQuarter ? 1 : -1;
    if (a.flaggedTerms.length !== b.flaggedTerms.length) {
      return b.flaggedTerms.length - a.flaggedTerms.length;
    }
    return a.product.product_name.localeCompare(b.product.product_name);
  });
  return overviews;
}
