import { describe, it, expect } from 'vitest';
import { currentQuarter, buildOverview } from './dashboard';
import type { Product, MonitorBatch, QuarterlyAeMonitor } from './db';

const product = (id: string, name: string): Product => ({
  product_id: id,
  product_name: name,
  label_version_date: '2026-01-01',
});

const batch = (pid: string, quarter: string, at: string): MonitorBatch => ({
  generated_at: at,
  product_id: pid,
  quarter,
  exposure_value: 1000,
  exposure_unit: 'patients',
  record_count: 1,
  alert_count: 0,
  unexpected_count: 0,
});

const rec = (
  pid: string, quarter: string, term: string, rate: number, at: string
): QuarterlyAeMonitor => ({
  product_id: pid,
  quarter,
  exposure_value: 1000,
  exposure_unit: 'patients',
  ae_term: term,
  count: Math.round(rate * 10),
  rate_pct: rate,
  threshold_pct: 10,
  status: 'normal',
  generated_at: at,
});

describe('currentQuarter', () => {
  it('maps months to quarters', () => {
    expect(currentQuarter(new Date('2026-07-08'))).toBe('2026Q3');
    expect(currentQuarter(new Date('2026-01-01'))).toBe('2026Q1');
    expect(currentQuarter(new Date('2026-12-31'))).toBe('2026Q4');
  });
});

describe('buildOverview', () => {
  it('marks current-quarter completion and picks the latest batch', () => {
    const products = [product('a', 'Alpha'), product('b', 'Beta')];
    const batches = [
      batch('a', '2026Q2', '2026-04-01T00:00:00Z'),
      batch('a', '2026Q3', '2026-07-05T00:00:00Z'),
      batch('b', '2026Q2', '2026-04-02T00:00:00Z'),
    ];
    const out = buildOverview(products, batches, [], '2026Q3');

    // Beta (pending this quarter) sorts before Alpha (done).
    expect(out.map((o) => o.product.product_id)).toEqual(['b', 'a']);
    expect(out[0].doneInQuarter).toBe(false);
    expect(out[1].doneInQuarter).toBe(true);
    expect(out[1].latestBatch?.quarter).toBe('2026Q3');
  });

  it('surfaces rising-trend terms per product', () => {
    const products = [product('a', 'Alpha')];
    const records = [
      rec('a', '2026Q1', '頭痛', 1.0, 't1'),
      rec('a', '2026Q2', '頭痛', 2.0, 't2'),
      rec('a', '2026Q3', '頭痛', 3.0, 't3'),
      rec('a', '2026Q1', '噁心', 2.0, 't1'),
      rec('a', '2026Q2', '噁心', 1.0, 't2'),
    ];
    const out = buildOverview(products, [], records, '2026Q4');
    expect(out[0].flaggedTerms).toEqual(['頭痛']);
    expect(out[0].latestBatch).toBeNull();
  });
});
