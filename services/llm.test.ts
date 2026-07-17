import { describe, it, expect } from 'vitest';
import { parseJsonLoose, reconcile, resolveLlm, mapLimit, parseModelList } from './llm';
import { DEFAULT_AI_SETTINGS, type AiSettings } from './settings';

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

describe('resolveLlm (3 沿用來源)', () => {
  const make = (o: Partial<AiSettings>): AiSettings => ({ ...DEFAULT_AI_SETTINGS, ...o });

  it('gemini + 金鑰 → BYO gemini', () => {
    const r = resolveLlm(make({ provider: 'gemini', apiKey: 'AIza-x', model: 'gemini-x' }));
    expect(r).toMatchObject({ mode: 'gemini', apiKey: 'AIza-x', model: 'gemini-x', platform: false });
  });

  it('gemini 但無金鑰 → 退回平台預設 /llm', () => {
    const r = resolveLlm(make({ provider: 'gemini', apiKey: '' }));
    expect(r).toMatchObject({ mode: 'openai', baseUrl: '/llm', apiKey: '', platform: true });
  });

  it('openai-compatible + baseUrl → BYO openai', () => {
    const r = resolveLlm(
      make({ provider: 'openai-compatible', apiKey: 'sk-1', baseUrl: 'https://x.ai/v1/', model: 'm' })
    );
    // trailing slash trimmed
    expect(r).toMatchObject({ mode: 'openai', baseUrl: 'https://x.ai/v1', apiKey: 'sk-1', platform: false });
  });

  it('openai-compatible 但無 baseUrl → 退回平台預設 /llm（無金鑰、同源）', () => {
    const r = resolveLlm(make({ provider: 'openai-compatible', apiKey: '', baseUrl: '' }));
    expect(r).toMatchObject({ mode: 'openai', baseUrl: '/llm', apiKey: '', platform: true });
  });

  it('gemini 無金鑰退回平台時，殘留的 gemini 模型名不得外漏', () => {
    const r = resolveLlm(make({ provider: 'gemini', apiKey: '', model: 'gemini-3.5-flash' }));
    expect(r).toMatchObject({ platform: true, model: '' });
  });

  it('openai-compatible 無 baseUrl 但填了模型 → 平台代理沿用該模型', () => {
    const r = resolveLlm(
      make({ provider: 'openai-compatible', apiKey: '', baseUrl: '', model: 'qwen3.5:397b' })
    );
    expect(r).toMatchObject({ platform: true, baseUrl: '/llm', model: 'qwen3.5:397b' });
  });
});

describe('parseModelList', () => {
  it('抽出 id 並排序', () => {
    const json = { data: [{ id: 'zeta' }, { id: 'alpha' }, { id: 'mid' }] };
    expect(parseModelList(json)).toEqual(['alpha', 'mid', 'zeta']);
  });
  it('容忍缺 id 或非字串的項目', () => {
    const json = { data: [{ id: 'ok' }, { id: 42 }, {}, null] };
    expect(parseModelList(json)).toEqual(['ok']);
  });
  it('非預期形狀回空陣列', () => {
    expect(parseModelList(null)).toEqual([]);
    expect(parseModelList({})).toEqual([]);
    expect(parseModelList({ data: 'nope' })).toEqual([]);
  });
});

describe('mapLimit', () => {
  it('保留輸入順序且受併發上限約束', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});
