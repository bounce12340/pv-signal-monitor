import { describe, it, expect } from 'vitest';
import { aggregateSignals } from './signals';

describe('aggregateSignals', () => {
  const rec = (pmid: string, ingredient: string, pt: string, serious = false) => ({
    pmid,
    original_search_term: ingredient,
    pv_data: { ingredient, meddra_pt_candidate: pt, seriousness: serious ? 'Serious, hospitalization' : 'Non-serious' },
  });
  it('相同成分×PT 併為同一組並計數', () => {
    const rep = aggregateSignals([
      rec('1', 'Fenofibrate', 'Rhabdomyolysis', true),
      rec('2', 'Fenofibrate', 'Rhabdomyolysis', false),
      rec('3', 'Fenofibrate', 'Myalgia'),
    ]);
    const rhabdo = rep.groups.find(g => g.pt === 'Rhabdomyolysis');
    expect(rhabdo?.count).toBe(2);
    expect(rhabdo?.seriousCount).toBe(1);
    expect(rhabdo?.pmids).toEqual(['1', '2']);
  });
  it('依中文/英文同義詞標準化後合併 (橫紋肌溶解 → Rhabdomyolysis)', () => {
    const rep = aggregateSignals([
      rec('1', 'Fenofibrate', 'Rhabdomyolysis'),
      rec('2', 'Fenofibrate', '橫紋肌溶解'),
    ]);
    expect(rep.groups).toHaveLength(1);
    expect(rep.groups[0].count).toBe(2);
  });
  it('無 pv_data 的文獻計入 skipped', () => {
    const rep = aggregateSignals([
      rec('1', 'Fenofibrate', 'Rhabdomyolysis'),
      { pmid: '2', original_search_term: 'X' },
    ]);
    expect(rep.skipped).toBe(1);
    expect(rep.analysedRecords).toBe(1);
  });
  it('seriousness 含否定語意 (not hospitalized) 不計為嚴重 (review #2)', () => {
    const rep = aggregateSignals([
      { pmid: '1', original_search_term: 'A', pv_data: { ingredient: 'A', meddra_pt_candidate: 'Myalgia', seriousness: 'not hospitalized' } },
    ]);
    expect(rep.groups[0].seriousCount).toBe(0);
  });
  it('依 count 由多到少排序', () => {
    const rep = aggregateSignals([
      rec('1', 'A', 'Myalgia'),
      rec('2', 'B', 'Rhabdomyolysis'),
      rec('3', 'B', 'Rhabdomyolysis'),
    ]);
    expect(rep.groups[0].count).toBeGreaterThanOrEqual(rep.groups[1].count);
  });
});
