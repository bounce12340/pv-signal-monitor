import { describe, it, expect } from 'vitest';
import { buildPubMedQuery, resolveMonth } from './pubmed';

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
