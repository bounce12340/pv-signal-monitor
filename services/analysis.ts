import { SignalRuleConfig, DEFAULT_RULE_CONFIG } from './settings';

export interface AeMasterItem {
  soc: string;
  ae_term_raw: string;
  ae_terms_split: string[];
  label_frequency_text: string;
  label_threshold_upper_pct: number;
  mapping_rule_note: string;
}

export interface QuarterlyInput {
  quarter: string;
  exposure_value: number;
  exposure_unit: string;
  ae_counts: { term: string; count: number; serious?: boolean }[];
}

export interface AnalysisOptions {
  includeAllMasterTerms?: boolean;
  rules?: SignalRuleConfig;
}

export interface AnalysisResultRow {
  soc: string;
  ae_term: string; // The matched split term or input term
  frequency_category: string;
  threshold_pct: number;
  count: number;
  serious: boolean;
  exposure_display: string;
  incidence_rate_pct: number;
  status: 'alert' | 'warning' | 'normal' | 'unexpected';
  // True when the rate reached the warning zone but the count was below the
  // configured minimum case count, so the status was kept at normal.
  noise_suppressed: boolean;
  // Closest master term for an unexpected row (possible typo / synonym).
  suggestion?: { term: string; similarity: number };
  original_master?: AeMasterItem;
}

export interface AnalysisReport {
  rows: AnalysisResultRow[];
  unmatched: string[];
  alerts: AnalysisResultRow[];
  unexpected: AnalysisResultRow[];
  // Rule parameters this report was produced with (for audit traceability).
  rules: SignalRuleConfig;
}

// Normalize string for matching (lowercase, trim, remove extra spaces)
const normalize = (str: string) => str.toLowerCase().trim().replace(/\s+/g, ' ');

// Character-bigram Dice coefficient. Works for CJK and latin terms alike.
export function diceSimilarity(a: string, b: string): number {
  const bigrams = (s: string): Map<string, number> => {
    const n = normalize(s).replace(/\s+/g, '');
    const map = new Map<string, number>();
    if (n.length < 2) {
      if (n) map.set(n, 1);
      return map;
    }
    for (let i = 0; i < n.length - 1; i++) {
      const g = n.slice(i, i + 2);
      map.set(g, (map.get(g) || 0) + 1);
    }
    return map;
  };

  const A = bigrams(a);
  const B = bigrams(b);
  let sizeA = 0, sizeB = 0, overlap = 0;
  A.forEach((v) => { sizeA += v; });
  B.forEach((v) => { sizeB += v; });
  if (sizeA === 0 || sizeB === 0) return 0;
  A.forEach((v, g) => { overlap += Math.min(v, B.get(g) || 0); });
  return (2 * overlap) / (sizeA + sizeB);
}

// Minimum similarity for an "是否即為主檔的 X？" suggestion.
const SUGGESTION_MIN_SIMILARITY = 0.5;

export function performAnalysis(
  masterData: { ae_master: AeMasterItem[] },
  input: QuarterlyInput,
  options: AnalysisOptions = {}
): AnalysisReport {
  const { exposure_value, exposure_unit, ae_counts } = input;
  const { includeAllMasterTerms } = options;
  const rules = options.rules || DEFAULT_RULE_CONFIG;

  // 1. Build lookup map from Master Data
  // Map normalized split term -> Master Item
  const termMap = new Map<string, { item: AeMasterItem; specificTerm: string }>();
  // Track used master terms to avoid duplicates when backfilling
  const usedMasterTerms = new Set<string>();

  masterData.ae_master.forEach(item => {
    item.ae_terms_split.forEach(splitTerm => {
      termMap.set(normalize(splitTerm), { item, specificTerm: splitTerm });
    });
  });

  const rows: AnalysisResultRow[] = [];
  const unmatched: string[] = [];

  // 2. Process each input count
  ae_counts.forEach(({ term, count, serious }) => {
    const normalizedInput = normalize(term);
    const match = termMap.get(normalizedInput);

    if (!match) {
      unmatched.push(term);

      // Fuzzy-suggest the closest master term (possible typo or synonym).
      let suggestion: AnalysisResultRow['suggestion'];
      termMap.forEach(({ specificTerm }) => {
        const similarity = diceSimilarity(term, specificTerm);
        if (similarity >= SUGGESTION_MIN_SIMILARITY &&
            (!suggestion || similarity > suggestion.similarity)) {
          suggestion = { term: specificTerm, similarity };
        }
      });

      rows.push({
        soc: 'Unknown (未登載於仿單)',
        ae_term: term,
        frequency_category: 'N/A',
        threshold_pct: 0,
        count,
        serious: !!serious,
        exposure_display: `${exposure_value} ${exposure_unit}`,
        incidence_rate_pct: (count / exposure_value) * 100,
        status: 'unexpected',
        noise_suppressed: false,
        suggestion,
      });
      return;
    }

    // Mark this term as used
    usedMasterTerms.add(normalizedInput);

    const { item, specificTerm } = match;
    const incidenceRate = (count / exposure_value) * 100;
    const threshold = item.label_threshold_upper_pct;

    // 3. Determine Status based on configured rules
    let status: AnalysisResultRow['status'] = 'normal';
    let noiseSuppressed = false;

    if (count < rules.minCaseCount) {
      // Below the statistical-noise floor: stay normal, but flag rows that
      // would otherwise have entered the warning zone so reviewers can see it.
      status = 'normal';
      noiseSuppressed =
        count > 0 && incidenceRate >= (threshold - rules.toleranceMarginPct);
    } else if (incidenceRate >= (threshold * rules.alertMultiplier - rules.toleranceMarginPct)) {
      status = 'alert';
    } else if (incidenceRate >= (threshold - rules.toleranceMarginPct)) {
      status = 'warning';
    }

    rows.push({
      soc: item.soc,
      ae_term: specificTerm, // Use the official split term found
      frequency_category: item.label_frequency_text,
      threshold_pct: item.label_threshold_upper_pct,
      count,
      serious: !!serious,
      exposure_display: `${exposure_value} ${exposure_unit}`,
      incidence_rate_pct: incidenceRate,
      status,
      noise_suppressed: noiseSuppressed,
      original_master: item
    });
  });

  // 3. (Optional) Backfill remaining master terms with 0 count
  if (includeAllMasterTerms) {
    masterData.ae_master.forEach(item => {
      item.ae_terms_split.forEach(splitTerm => {
        const normalized = normalize(splitTerm);
        if (!usedMasterTerms.has(normalized)) {
          // Add as normal row with 0 count
          rows.push({
            soc: item.soc,
            ae_term: splitTerm,
            frequency_category: item.label_frequency_text,
            threshold_pct: item.label_threshold_upper_pct,
            count: 0,
            serious: false,
            exposure_display: `${exposure_value} ${exposure_unit}`,
            incidence_rate_pct: 0,
            status: 'normal',
            noise_suppressed: false,
            original_master: item
          });
          // Mark used to prevent duplicates if term appears multiple times in master
          usedMasterTerms.add(normalized);
        }
      });
    });
  }

  // Sort rows: Unexpected (highest priority) -> Alerts -> Warnings -> Normal
  rows.sort((a, b) => {
    const priority = { unexpected: 0, alert: 1, warning: 2, normal: 3 };
    if (priority[a.status] !== priority[b.status]) {
      return priority[a.status] - priority[b.status];
    }
    // Serious cases float above non-serious within the same status
    if (a.serious !== b.serious) {
      return a.serious ? -1 : 1;
    }
    // If status is same, sort by rate descending
    if (b.incidence_rate_pct !== a.incidence_rate_pct) {
      return b.incidence_rate_pct - a.incidence_rate_pct;
    }
    // Secondary sort by AE term name for stability (especially for 0 rate items)
    return a.ae_term.localeCompare(b.ae_term);
  });

  const alerts = rows.filter(r => r.status === 'alert');
  const unexpected = rows.filter(r => r.status === 'unexpected');

  return { rows, unmatched, alerts, unexpected, rules };
}
