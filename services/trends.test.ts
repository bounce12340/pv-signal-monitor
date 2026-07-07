import { describe, it, expect } from 'vitest';
import { buildTrends } from './trends';
import type { QuarterlyAeMonitor } from './db';

const rec = (
  quarter: string, term: string, rate: number, generated_at = 't1'
): QuarterlyAeMonitor => ({
  id: `${quarter}-${term}-${generated_at}`,
  product_id: 'p1',
  quarter,
  exposure_value: 1000,
  exposure_unit: '季',
  ae_term: term,
  count: Math.round(rate * 10),
  rate_pct: rate,
  threshold_pct: 1,
  status: 'normal',
  generated_at,
});

describe('buildTrends', () => {
  it('依季度排序並建立各 AE 序列', () => {
    const s = buildTrends([
      rec('2026Q2', '腹瀉', 0.5),
      rec('2026Q1', '腹瀉', 0.3),
      rec('2026Q1', '頭痛', 0.2),
    ]);
    const diarrhea = s.find((x) => x.term === '腹瀉')!;
    expect(diarrhea.points.map((p) => p.quarter)).toEqual(['2026Q1', '2026Q2']);
    expect(s).toHaveLength(2);
  });

  it('同季重複儲存時只取最新 generated_at 的批次', () => {
    const s = buildTrends([
      rec('2026Q1', '腹瀉', 0.3, '2026-01-01T00:00:00Z'),
      rec('2026Q1', '腹瀉', 0.9, '2026-02-01T00:00:00Z'), // re-saved, wins
    ]);
    expect(s[0].points).toHaveLength(1);
    expect(s[0].points[0].rate_pct).toBe(0.9);
  });

  it('連續 2 季上升 → flagged', () => {
    const s = buildTrends([
      rec('2026Q1', '腹瀉', 0.1),
      rec('2026Q2', '腹瀉', 0.2),
      rec('2026Q3', '腹瀉', 0.3),
    ]);
    expect(s[0].risingStreak).toBe(2);
    expect(s[0].flagged).toBe(true);
  });

  it('只升 1 季或中斷 → 不 flag', () => {
    const one = buildTrends([rec('2026Q1', 'A', 0.1), rec('2026Q2', 'A', 0.2)]);
    expect(one[0].flagged).toBe(false);

    const broken = buildTrends([
      rec('2026Q1', 'A', 0.3),
      rec('2026Q2', 'A', 0.1),
      rec('2026Q3', 'A', 0.2),
    ]);
    expect(broken[0].risingStreak).toBe(1);
    expect(broken[0].flagged).toBe(false);
  });

  it('flagged 序列排最前', () => {
    const s = buildTrends([
      rec('2026Q1', '平穩高', 5), rec('2026Q2', '平穩高', 5),
      rec('2026Q1', '上升', 0.1), rec('2026Q2', '上升', 0.2), rec('2026Q3', '上升', 0.3),
    ]);
    expect(s[0].term).toBe('上升');
  });
});
