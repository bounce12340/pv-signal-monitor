import { describe, it, expect } from 'vitest';
import { parseJsonLoose, reconcile } from './llmService';

describe('parseJsonLoose', () => {
  it('解析純 JSON', () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });
  it('去除 ```json 圍欄', () => {
    expect(parseJsonLoose('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });
  it('擷取前後雜訊中的 JSON', () => {
    expect(parseJsonLoose('好的，結果是 {"a":3} 以上')).toEqual({ a: 3 });
  });
  it('無法解析回 null', () => {
    expect(parseJsonLoose('completely not json')).toBeNull();
    expect(parseJsonLoose('')).toBeNull();
  });
});

describe('reconcile', () => {
  it('依 pmid 對映，缺漏以 fallback 補上', () => {
    const records = [{ pmid: '1' }, { pmid: '2' }];
    const results = [{ pmid: '1', score: 80 }];
    const out = reconcile(records, results, (r) => ({ pmid: r.pmid, score: 50 }));
    expect(out).toEqual([{ pmid: '1', score: 80 }, { pmid: '2', score: 50 }]);
  });
  it('容忍數字型 pmid 與字串型 pmid 混用', () => {
    const records = [{ pmid: '123' }];
    const results = [{ pmid: 123, score: 90 }];
    const out = reconcile(records, results, (r) => ({ pmid: r.pmid, score: 50 }));
    expect(out[0].score).toBe(90);
  });
  it('保證輸出筆數等於輸入筆數', () => {
    const records = [{ pmid: 'a' }, { pmid: 'b' }, { pmid: 'c' }];
    const out = reconcile(records, [], (r) => ({ pmid: r.pmid }));
    expect(out).toHaveLength(3);
  });
});
