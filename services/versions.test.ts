import { describe, it, expect } from 'vitest';
import { diffMasters } from './versions';
import type { LabelAeMaster } from './db';

const row = (ae_term: string, threshold = 1, soc = 'GI'): LabelAeMaster => ({
  id: ae_term,
  product_id: 'p1',
  soc,
  ae_term,
  label_freq_text: 'Common',
  threshold_upper_pct: threshold,
  created_at: '2026-01-01',
});

describe('diffMasters', () => {
  it('偵測新增、移除、門檻變動與未變動數', () => {
    const oldRows = [row('腹瀉', 1), row('頭痛', 0.5), row('嘔吐', 2)];
    const newRows = [row('腹瀉', 1), row('頭痛', 1.5), row('皮疹', 0.1)];
    const d = diffMasters(oldRows, newRows);
    expect(d.added.map((a) => a.term)).toEqual(['皮疹']);
    expect(d.removed.map((r) => r.term)).toEqual(['嘔吐']);
    expect(d.changed).toEqual([{ term: '頭痛', soc: 'GI', from: 0.5, to: 1.5 }]);
    expect(d.unchanged).toBe(1);
  });

  it('詞彙比對忽略大小寫與空白', () => {
    const d = diffMasters([row('Nausea  Vomiting')], [row('nausea vomiting')]);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.unchanged).toBe(1);
  });

  it('完全相同 → 無差異', () => {
    const rows = [row('A'), row('B')];
    const d = diffMasters(rows, rows);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.changed).toHaveLength(0);
    expect(d.unchanged).toBe(2);
  });
});
