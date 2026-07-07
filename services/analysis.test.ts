import { describe, it, expect } from 'vitest';
import { performAnalysis, AeMasterItem } from './analysis';

const master = (items: Partial<AeMasterItem>[]): { ae_master: AeMasterItem[] } => ({
  ae_master: items.map((i) => ({
    soc: 'Gastrointestinal disorders',
    ae_term_raw: 'x',
    ae_terms_split: ['x'],
    label_frequency_text: 'Common',
    label_threshold_upper_pct: 1.0,
    mapping_rule_note: '',
    ...i,
  })),
});

const input = (ae_counts: { term: string; count: number }[], exposure = 1000) => ({
  quarter: '2026Q1',
  exposure_value: exposure,
  exposure_unit: '季',
  ae_counts,
});

describe('performAnalysis — 判定規則', () => {
  it('比對到主檔且低於門檻緩衝 → normal', () => {
    const m = master([{ ae_terms_split: ['腹瀉'] }]);
    const r = performAnalysis(m, input([{ term: '腹瀉', count: 9 }])); // 0.9% < 0.95%
    expect(r.rows[0].status).toBe('normal');
    expect(r.rows[0].incidence_rate_pct).toBeCloseTo(0.9);
  });

  it('達門檻緩衝（1x − 0.05%）→ warning', () => {
    const m = master([{ ae_terms_split: ['腹瀉'] }]);
    const r = performAnalysis(m, input([{ term: '腹瀉', count: 10 }])); // 1.0% ≥ 0.95%
    expect(r.rows[0].status).toBe('warning');
  });

  it('達兩倍門檻緩衝（2x − 0.05%）→ alert', () => {
    const m = master([{ ae_terms_split: ['腹瀉'] }]);
    const r = performAnalysis(m, input([{ term: '腹瀉', count: 20 }])); // 2.0% ≥ 1.95%
    expect(r.rows[0].status).toBe('alert');
  });

  it('案例數 < 3 視為統計噪音 → normal（即使超標）', () => {
    const m = master([{ ae_terms_split: ['腹瀉'] }]);
    const r = performAnalysis(m, input([{ term: '腹瀉', count: 2 }], 10)); // 20%!
    expect(r.rows[0].status).toBe('normal');
  });

  it('未登載於主檔 → unexpected，rate 照算', () => {
    const m = master([{ ae_terms_split: ['腹瀉'] }]);
    const r = performAnalysis(m, input([{ term: '光敏感', count: 5 }]));
    expect(r.rows[0].status).toBe('unexpected');
    expect(r.rows[0].incidence_rate_pct).toBeCloseTo(0.5);
    expect(r.unmatched).toEqual(['光敏感']);
    expect(r.unexpected).toHaveLength(1);
  });

  it('比對忽略大小寫與多餘空白', () => {
    const m = master([{ ae_terms_split: ['Nausea Vomiting'] }]);
    const r = performAnalysis(m, input([{ term: '  nausea   vomiting ', count: 5 }]));
    expect(r.rows[0].status).not.toBe('unexpected');
    expect(r.rows[0].ae_term).toBe('Nausea Vomiting');
  });

  it('includeAllMasterTerms 回填未通報項目為 0 且不重複', () => {
    const m = master([
      { ae_terms_split: ['腹瀉'] },
      { ae_terms_split: ['頭痛', '頭暈'] },
    ]);
    const r = performAnalysis(m, input([{ term: '腹瀉', count: 5 }]), {
      includeAllMasterTerms: true,
    });
    expect(r.rows).toHaveLength(3);
    const zeroRows = r.rows.filter((row) => row.count === 0);
    expect(zeroRows.map((z) => z.ae_term).sort()).toEqual(['頭暈', '頭痛']);
    expect(zeroRows.every((z) => z.status === 'normal')).toBe(true);
  });

  it('排序：unexpected → alert → warning → normal，同級依 rate 降冪', () => {
    const m = master([
      { ae_terms_split: ['A'], label_threshold_upper_pct: 1.0 },
      { ae_terms_split: ['B'], label_threshold_upper_pct: 1.0 },
      { ae_terms_split: ['C'], label_threshold_upper_pct: 1.0 },
    ]);
    const r = performAnalysis(
      m,
      input([
        { term: 'C', count: 9 },   // normal
        { term: 'B', count: 10 },  // warning
        { term: 'A', count: 20 },  // alert
        { term: 'Z', count: 3 },   // unexpected
      ])
    );
    expect(r.rows.map((row) => row.status)).toEqual([
      'unexpected',
      'alert',
      'warning',
      'normal',
    ]);
  });
});
