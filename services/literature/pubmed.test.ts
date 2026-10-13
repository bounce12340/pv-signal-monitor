import { describe, it, expect } from 'vitest';
import { buildPubMedQuery, describeSearchOutcome, parseTermList, resolveMonth } from './pubmed';

describe('buildPubMedQuery', () => {
  it('wraps a single ingredient in a parenthesised phrase group', () => {
    expect(buildPubMedQuery({ ingredients: ['Fenofibrate'], aeTerms: [], exclusions: [] })).toBe(
      '(("Fenofibrate"))'
    );
  });

  it('OR-joins multiple ingredients', () => {
    expect(
      buildPubMedQuery({ ingredients: ['Fenofibrate', 'Simvastatin'], aeTerms: [], exclusions: [] })
    ).toBe('(("Fenofibrate") OR ("Simvastatin"))');
  });

  it('AND-appends an OR group of AE terms, quoting plain terms', () => {
    expect(
      buildPubMedQuery({ ingredients: ['Drug'], aeTerms: ['adverse event', 'toxicity'], exclusions: [] })
    ).toBe('(("Drug")) AND ("adverse event" OR "toxicity")');
  });

  it('passes through terms containing a wildcard or explicit quote unquoted', () => {
    expect(
      buildPubMedQuery({ ingredients: ['Drug'], aeTerms: ['pharmacovigilance*'], exclusions: [] })
    ).toBe('(("Drug")) AND (pharmacovigilance*)');
  });

  it('NOT-chains exclusions after the AE clause', () => {
    expect(
      buildPubMedQuery({ ingredients: ['Drug'], aeTerms: ['AE'], exclusions: ['animal-only', 'review*'] })
    ).toBe('(("Drug")) AND ("AE") NOT ("animal-only") NOT (review*)');
  });

  it('omits the AE clause entirely when no AE terms are given', () => {
    expect(buildPubMedQuery({ ingredients: ['Drug'], aeTerms: [], exclusions: ['animal-only'] })).toBe(
      '(("Drug")) NOT ("animal-only")'
    );
  });
});

describe('resolveMonth', () => {
  it('數字月份補零並過濾越界值', () => {
    expect(resolveMonth('7')).toBe('07');
    expect(resolveMonth('12')).toBe('12');
    expect(resolveMonth('0')).toBe('');
    expect(resolveMonth('13')).toBe('');
  });

  it('英文月份（縮寫與全名）', () => {
    expect(resolveMonth('Jul')).toBe('07');
    expect(resolveMonth('July')).toBe('07');
    expect(resolveMonth('DEC')).toBe('12');
  });

  it('季節映射到首月（北半球）', () => {
    expect(resolveMonth('Spring')).toBe('04');
    expect(resolveMonth('Summer')).toBe('07');
    expect(resolveMonth('Fall')).toBe('10');
    expect(resolveMonth('Autumn')).toBe('10');
    expect(resolveMonth('Winter')).toBe('01');
  });

  it('月份/季節範圍取第一段', () => {
    expect(resolveMonth('Jul-Aug')).toBe('07');
    expect(resolveMonth('Jan-Feb')).toBe('01');
    expect(resolveMonth('Nov-Dec')).toBe('11');
  });

  it('無法判定時回空字串', () => {
    expect(resolveMonth('')).toBe('');
    expect(resolveMonth(undefined)).toBe('');
    expect(resolveMonth('n/a')).toBe('');
  });
});

describe('parseTermList', () => {
  it('splits on ASCII and full-width commas, the ideographic comma, semicolons and newlines', () => {
    expect(parseTermList('Pravastatin, Fenofibrate')).toEqual(['Pravastatin', 'Fenofibrate']);
    expect(parseTermList('Pravastatin，Fenofibrate、Diltiazem')).toEqual(['Pravastatin', 'Fenofibrate', 'Diltiazem']);
    expect(parseTermList('Trospium; Pilocarpine；Theophylline\nPravastatin')).toEqual([
      'Trospium', 'Pilocarpine', 'Theophylline', 'Pravastatin',
    ]);
  });

  it('drops empty entries and surrounding whitespace', () => {
    expect(parseTermList(' , Fenofibrate ,, ， ')).toEqual(['Fenofibrate']);
    expect(parseTermList('')).toEqual([]);
  });

  it('keeps a multi-word term, its wildcard and its quotes intact', () => {
    expect(parseTermList('"adverse event*", pharmacovigilance*、Adverse drug reactions')).toEqual([
      '"adverse event*"', 'pharmacovigilance*', 'Adverse drug reactions',
    ]);
  });
});

describe('describeSearchOutcome', () => {
  const base = { total: 5, retrieved: 5, inLibrary: 0, inPending: 0, added: 5 };

  it('accounts for every retrieved record', () => {
    expect(describeSearchOutcome({ ...base, inLibrary: 1, inPending: 3, added: 1 })).toBe(
      'PubMed 共 5 筆；已在正式庫 1 筆（略過）；已在待核閱 3 筆（略過）；新增 1 筆至待核閱。'
    );
  });

  it('warns when the retrieval cap cut the result short', () => {
    expect(describeSearchOutcome({ ...base, total: 250, retrieved: 100, added: 100 })).toContain(
      '只取回前 100 筆'
    );
    expect(describeSearchOutcome(base)).not.toContain('只取回');
  });

  it('says so when nothing is new, and hints at the inputs when PubMed found nothing', () => {
    expect(describeSearchOutcome({ ...base, inPending: 5, added: 0 })).toContain('沒有新文獻需要核閱');
    expect(describeSearchOutcome({ total: 0, retrieved: 0, inLibrary: 0, inPending: 0, added: 0 })).toBe(
      'PubMed 共 0 筆；沒有新文獻需要核閱；請確認成分拼字、AE 關鍵字、排除詞與監測期間。'
    );
  });
});

describe('buildPubMedQuery with useMesh', () => {
  it('widens the AE condition with MeSH and adds each ingredient\'s adverse-effects subheading, human only', () => {
    expect(
      buildPubMedQuery({ ingredients: ['Drug A', 'Drug B'], aeTerms: ['"adverse event*"'], exclusions: ['animal-only'], useMesh: true })
    ).toBe(
      '(((("Drug A") OR ("Drug B")) AND ("adverse event*" OR ' +
        '"Drug-Related Side Effects and Adverse Reactions"[MeSH Terms] OR "Adverse Drug Reaction Reporting Systems"[MeSH Terms] OR ' +
        '"Pharmacovigilance"[MeSH Terms] OR "Product Surveillance, Postmarketing"[MeSH Terms]))' +
        ' OR (("Drug A/adverse effects"[MeSH Terms] OR "Drug B/adverse effects"[MeSH Terms])' +
        ' NOT ("animals"[MeSH Terms] NOT "humans"[MeSH Terms]))) NOT ("animal-only")'
    );
  });

  it('keeps the keyword-only query byte-for-byte when MeSH is off', () => {
    const input = { ingredients: ['Drug'], aeTerms: ['AE'], exclusions: ['x'] };
    expect(buildPubMedQuery({ ...input, useMesh: false })).toBe(buildPubMedQuery(input));
    expect(buildPubMedQuery(input)).toBe('(("Drug")) AND ("AE") NOT ("x")');
  });

  it('leaves an ingredient-only search (no AE terms) unrestricted even with MeSH on', () => {
    expect(buildPubMedQuery({ ingredients: ['Drug'], aeTerms: [], exclusions: [], useMesh: true })).toBe('(("Drug"))');
  });
});

describe('describeSearchOutcome notFound', () => {
  it('names the terms PubMed ignored', () => {
    expect(
      describeSearchOutcome({ total: 3, retrieved: 3, inLibrary: 0, inPending: 0, added: 3, notFound: ['"Trospium/adverse effects"[MeSH Terms]'] })
    ).toContain('PubMed 查無下列詞、已略過："Trospium/adverse effects"[MeSH Terms]');
  });
});
