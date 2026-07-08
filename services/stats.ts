// Exact (Garwood) 95% confidence interval for a Poisson rate, so low-count
// judgements (and the minCaseCount noise floor) carry a defensible
// statistical statement in reports.
//
// Bounds for observed count k:
//   lower = chi2inv(0.025, 2k) / 2          (0 when k = 0)
//   upper = chi2inv(0.975, 2k + 2) / 2
// expressed as a percentage of the exposure denominator.

function lnGamma(x: number): number {
  // Lanczos approximation, |error| < 2e-10 for x > 0.
  const coef = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += coef[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

// Regularized lower incomplete gamma P(a, x).
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    // Series representation converges fast here.
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 300; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-13) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  // Continued fraction for Q(a, x) = 1 - P(a, x).
  const TINY = 1e-300;
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 300; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-13) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

// Inverse of gammaP in x for fixed shape a, via bisection (monotone in x).
function gammaPInv(p: number, a: number): number {
  let lo = 0;
  let hi = a + 10 * Math.sqrt(a) + 10;
  while (gammaP(a, hi) < p) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (gammaP(a, mid) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12 * (1 + hi)) break;
  }
  return (lo + hi) / 2;
}

function chi2Inv(p: number, df: number): number {
  return 2 * gammaPInv(p, df / 2);
}

export interface RateCI {
  lowerPct: number;
  upperPct: number;
}

/**
 * Exact 95% CI for an incidence rate, in percent of `exposure`.
 * Returns null when the exposure denominator is not usable.
 */
export function poissonRateCI95(count: number, exposure: number): RateCI | null {
  if (!Number.isFinite(exposure) || exposure <= 0 || count < 0) return null;
  const lowerCount = count === 0 ? 0 : chi2Inv(0.025, 2 * count) / 2;
  const upperCount = chi2Inv(0.975, 2 * (count + 1)) / 2;
  return {
    lowerPct: (lowerCount / exposure) * 100,
    upperPct: (upperCount / exposure) * 100,
  };
}

/** Formats a CI as e.g. "0.03–5.57%" with sensible precision. */
export function formatCI(ci: RateCI | null): string {
  if (!ci) return '—';
  const fmt = (v: number) => {
    if (v === 0) return '0';
    if (v < 0.01) return v.toFixed(3);
    if (v < 1) return v.toFixed(2);
    return v.toFixed(1);
  };
  return `${fmt(ci.lowerPct)}–${fmt(ci.upperPct)}%`;
}
