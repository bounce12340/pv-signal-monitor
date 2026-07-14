import { describe, it, expect } from 'vitest';
import { lookupMeddra } from './meddra';

describe('lookupMeddra', () => {
  it('精確命中 PT', () => {
    const r = lookupMeddra('Rhabdomyolysis');
    expect(r.matched).toBe(true);
    expect(r.soc).toContain('Musculoskeletal');
  });
  it('大小寫與空白不敏感', () => {
    expect(lookupMeddra('  rhabdomyolysis ').matched).toBe(true);
  });
  it('命中中文同義詞', () => {
    const r = lookupMeddra('橫紋肌溶解');
    expect(r.matched).toBe(true);
    expect(r.pt).toBe('Rhabdomyolysis');
  });
  it('命中英文同義詞 (cpk increased)', () => {
    expect(lookupMeddra('CPK increased').pt).toBe('Blood creatine phosphokinase increased');
  });
  it('未收錄詞回 matched=false 且保留原字串', () => {
    const r = lookupMeddra('some novel unlisted event xyz');
    expect(r.matched).toBe(false);
    expect(r.pt).toBe('some novel unlisted event xyz');
    expect(r.soc).toBeNull();
  });
  it('空字串安全處理', () => {
    expect(lookupMeddra('').matched).toBe(false);
    expect(lookupMeddra(null).matched).toBe(false);
  });
  it('寬鬆比對：候選片語包含已知 PT 時命中（單向）', () => {
    const r = lookupMeddra('severe rhabdomyolysis reported in patient');
    expect(r.matched).toBe(true);
    expect(r.pt).toBe('Rhabdomyolysis');
  });
  it('寬鬆比對：泛詞 "increased" 不應反向誤命中最長詞條 (review #3)', () => {
    expect(lookupMeddra('increased').matched).toBe(false);
  });
});
