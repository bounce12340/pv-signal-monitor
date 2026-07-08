import { describe, it, expect } from 'vitest';
import { poissonRateCI95, formatCI } from './stats';

// Reference values: Garwood exact 95% CI for a Poisson count
// (e.g. Ulm 1990 / standard epidemiology tables):
//   k=0 → [0, 3.689], k=1 → [0.0253, 5.572], k=2 → [0.242, 7.225],
//   k=5 → [1.623, 11.668], k=10 → [4.795, 18.390]
describe('poissonRateCI95', () => {
  const cases: Array<[number, number, number]> = [
    [0, 0, 3.689],
    [1, 0.0253, 5.572],
    [2, 0.242, 7.225],
    [5, 1.623, 11.668],
    [10, 4.795, 18.39],
  ];

  it.each(cases)('k=%i matches Garwood table', (k, lower, upper) => {
    // exposure 100 → CI in % equals the count CI directly
    const ci = poissonRateCI95(k, 100);
    expect(ci).not.toBeNull();
    expect(ci!.lowerPct).toBeCloseTo(lower, 2);
    expect(ci!.upperPct).toBeCloseTo(upper, 2);
  });

  it('scales with exposure', () => {
    const ci = poissonRateCI95(1, 1000);
    expect(ci!.upperPct).toBeCloseTo(0.5572, 3);
  });

  it('rejects unusable exposure', () => {
    expect(poissonRateCI95(1, 0)).toBeNull();
    expect(poissonRateCI95(1, NaN)).toBeNull();
  });

  it('formats compactly', () => {
    expect(formatCI(poissonRateCI95(1, 100))).toBe('0.03–5.6%');
    expect(formatCI(null)).toBe('—');
  });
});
