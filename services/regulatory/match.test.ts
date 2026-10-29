import { describe, expect, it } from 'vitest';
import { containsTerm, formatWatchlistText, matchAlert, mentionsSuspension, normalizeText, parseWatchlistText } from './match';

const alert = (title: string, summary = '', substances = '') => ({ title, summary, substances });
const watch = [
  { ingredient: 'theophylline', synonyms: ['theophyllin', 'théophylline', 'aminophylline', 'テオフィリン', '茶鹼'] },
  { ingredient: 'pravastatin', synonyms: ['プラバスタチン'] },
];

describe('normalizeText', () => {
  it('folds case, width and Latin accents but keeps Japanese voicing marks', () => {
    expect(normalizeText('ＴＨÉOPHYLLINE  Natrium')).toBe('theophylline natrium');
    expect(normalizeText('ジルチアゼム')).toBe('ジルチアゼム');
  });
});

describe('containsTerm', () => {
  it('aligns Latin terms on the start of a word, any ending', () => {
    expect(containsTerm('pravastatin sodium tablets', 'Pravastatin')).toBe(true);
    expect(containsTerm('theophylline-containing products', 'theophyllin')).toBe(true);
    expect(containsTerm('aminotheophylline', 'theophylline')).toBe(false);
    expect(containsTerm('含testostatin成分藥品', 'testostatin')).toBe(true);
  });
  it('matches CJK terms as substrings and ignores one-character terms', () => {
    expect(containsTerm('含茶鹼成分藥品安全資訊', '茶鹼')).toBe(true);
    expect(containsTerm('anything', 'a')).toBe(false);
  });
});

describe('matchAlert', () => {
  it.each([
    ['Theophyllin: Überprüfung', 'DE spelling via synonym'],
    ['Retrait de la théophylline', 'FR accents'],
    ['使用上の注意の改訂指示：テオフィリン', 'JP katakana'],
    ['含茶鹼成分藥品安全資訊風險溝通表', 'TW Chinese'],
    ['Aminophylline injection: update', 'salt listed as synonym'],
  ])('finds theophylline in %j (%s)', (title) => {
    expect(matchAlert(alert(title), watch)).toEqual(['theophylline']);
  });

  it('looks at summary and substances too, and can match several ingredients', () => {
    expect(matchAlert(alert('Statins and xanthines', 'Pravastatin and theophylline interaction', ''), watch)).toEqual(['theophylline', 'pravastatin']);
    expect(matchAlert(alert('使用上の注意の改訂指示：', '', 'プラバスタチンナトリウム'), watch)).toEqual(['pravastatin']);
  });

  it('returns nothing for an unrelated alert or an empty watchlist', () => {
    expect(matchAlert(alert('Examplumab: risk'), watch)).toEqual([]);
    expect(matchAlert(alert('Theophylline'), [])).toEqual([]);
  });
});

describe('mentionsSuspension', () => {
  it.each([
    'IXCHIQ vaccine: UK marketing authorisation withdrawn following safety review',
    'Examplumab: suspension of marketing authorisations',
    'Ruhen der Zulassung für Testostatin',
    '含testostatin成分藥品自即日起下市',
    'テストスタチン 販売中止のお知らせ',
  ])('flags %j', (title) => expect(mentionsSuspension(alert(title))).toBe(true));

  it('does not flag an ordinary label update', () => {
    expect(mentionsSuspension(alert('FDA adds Boxed Warning for Examplumab'))).toBe(false);
  });
});

describe('watchlist editor text', () => {
  it('parses one ingredient per line with synonyms after a bar', () => {
    expect(parseWatchlistText('theophylline | theophyllin，aminophylline、茶鹼\n\n  pravastatin  \nTheophylline | dup')).toEqual([
      { ingredient: 'theophylline', synonyms: ['theophyllin', 'aminophylline', '茶鹼'] },
      { ingredient: 'pravastatin', synonyms: [] },
    ]);
  });
  it('round-trips through the editor format', () => {
    const items = [{ ingredient: 'a', synonyms: ['b', 'c'] }, { ingredient: 'd', synonyms: [] }];
    expect(parseWatchlistText(formatWatchlistText(items))).toEqual(items);
  });
});
