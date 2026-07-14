import { describe, it, expect } from 'vitest';
import { buildCIOMS, ciomsToText } from './cioms';

describe('buildCIOMS / ciomsToText', () => {
  const record = {
    pmid: '999',
    title: 'Fenofibrate-induced rhabdomyolysis: a case report',
    journal: 'J Clin Pharm',
    dp: '2026-03-01',
    authors: ['Chen'],
    original_search_term: 'Fenofibrate',
    conclusion_zh: '應監測 CPK。',
    pv_data: {
      product: '藥品A',
      ingredient: 'Fenofibrate',
      ae_verbatim: 'severe muscle pain',
      meddra_pt_candidate: 'Rhabdomyolysis',
      meddra_confidence: 88,
      seriousness: 'Serious (hospitalization)',
      population: '65M',
      dosage_route: '200mg PO',
      tto: '3 weeks',
      outcome: 'Recovered',
      causality: 'Probable',
      completeness: 'Complete',
    },
  };
  it('映射關鍵 E2B 欄位', () => {
    const d = buildCIOMS(record, '2026-07-08T00:00:00.000Z');
    expect(d.e2b['E.i.2.1b (MedDRA PT)']).toBe('Rhabdomyolysis');
    expect(d.e2b['G.k.2.2 (Active substance)']).toBe('Fenofibrate');
    expect(d.meddraSoc).toContain('Musculoskeletal');
    expect(d.literatureReference).toContain('PMID: 999');
  });
  it('narrative 非空且含成分與事件', () => {
    const d = buildCIOMS(record, '');
    expect(d.narrative).toContain('Fenofibrate');
    expect(d.narrative.length).toBeGreaterThan(10);
  });
  it('缺 pv_data 時不拋錯，回 N/A 骨架', () => {
    const d = buildCIOMS({ title: 'x', pmid: '1' }, '');
    expect(d.suspectDrug).toBe('N/A');
    expect(ciomsToText(d)).toContain('CIOMS-I');
  });
});
