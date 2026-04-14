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
  ae_counts: { term: string; count: number }[];
}

export interface AnalysisOptions {
  includeAllMasterTerms?: boolean;
}

export interface AnalysisResultRow {
  soc: string;
  ae_term: string; // The matched split term or input term
  frequency_category: string;
  threshold_pct: number;
  count: number;
  exposure_display: string;
  incidence_rate_pct: number;
  status: 'alert' | 'warning' | 'normal' | 'unexpected';
  original_master?: AeMasterItem;
}

export interface AnalysisReport {
  rows: AnalysisResultRow[];
  unmatched: string[];
  alerts: AnalysisResultRow[];
  unexpected: AnalysisResultRow[];
}

// Normalize string for matching (lowercase, trim, remove extra spaces)
const normalize = (str: string) => str.toLowerCase().trim().replace(/\s+/g, ' ');

export function performAnalysis(
  masterData: { ae_master: AeMasterItem[] },
  input: QuarterlyInput,
  options: AnalysisOptions = {}
): AnalysisReport {
  const { exposure_value, exposure_unit, ae_counts } = input;
  const { includeAllMasterTerms } = options;
  
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

  // Tolerance margin (Buffer) as requested: 0.05%
  // This allows warnings to trigger slightly before the hard threshold is reached.
  const TOLERANCE_MARGIN = 0.05;

  // 2. Process each input count
  ae_counts.forEach(({ term, count }) => {
    const normalizedInput = normalize(term);
    const match = termMap.get(normalizedInput);

    if (!match) {
      unmatched.push(term);
      rows.push({
        soc: 'Unknown (未登載於仿單)',
        ae_term: term,
        frequency_category: 'N/A',
        threshold_pct: 0,
        count,
        exposure_display: `${exposure_value} ${exposure_unit}`,
        incidence_rate_pct: (count / exposure_value) * 100,
        status: 'unexpected' // Changed from 'unmatched' to 'unexpected'
      });
      return;
    }

    // Mark this term as used
    usedMasterTerms.add(normalizedInput);

    const { item, specificTerm } = match;
    const incidenceRate = (count / exposure_value) * 100;
    
    // 3. Determine Status based on rules
    let status: AnalysisResultRow['status'] = 'normal';

    // Rule 1: Ignore statistical noise (Count < 3 is typically considered insufficient for signal detection in this context)
    if (count < 3) {
      status = 'normal';
    } else {
      const threshold = item.label_threshold_upper_pct;
      
      // Rule 2: Alert if Rate enters the "Double Threshold" zone (2x - 0.05%)
      // Example: If threshold is 0.32%, 2x is 0.64%. Alert triggers at 0.59% or higher.
      if (incidenceRate >= (threshold * 2 - TOLERANCE_MARGIN)) {
        status = 'alert';
      } 
      // Rule 3: Warning if Rate enters the "Threshold" zone (1x - 0.05%)
      // Example: If threshold is 0.32%, Warning triggers at 0.27% or higher.
      else if (incidenceRate >= (threshold - TOLERANCE_MARGIN)) {
        status = 'warning';
      } 
      // Rule 4: Normal if well below the threshold buffer
      else {
        status = 'normal';
      }
    }

    rows.push({
      soc: item.soc,
      ae_term: specificTerm, // Use the official split term found
      frequency_category: item.label_frequency_text,
      threshold_pct: item.label_threshold_upper_pct,
      count,
      exposure_display: `${exposure_value} ${exposure_unit}`,
      incidence_rate_pct: incidenceRate,
      status,
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
            exposure_display: `${exposure_value} ${exposure_unit}`,
            incidence_rate_pct: 0,
            status: 'normal',
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
    // If status is same, sort by rate descending
    if (b.incidence_rate_pct !== a.incidence_rate_pct) {
      return b.incidence_rate_pct - a.incidence_rate_pct;
    }
    // Secondary sort by AE term name for stability (especially for 0 rate items)
    return a.ae_term.localeCompare(b.ae_term);
  });

  const alerts = rows.filter(r => r.status === 'alert');
  const unexpected = rows.filter(r => r.status === 'unexpected');

  return { rows, unmatched, alerts, unexpected };
}