import { describe, it, expect } from 'vitest';
import { buildPubMedQuery } from './pubmed';

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
