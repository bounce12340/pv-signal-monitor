import type { LabelAeMaster } from './db';

// A frozen snapshot of a product's AE master rows, archived right before an
// update overwrites them.
export interface MasterVersion {
  version_id: string;
  product_id: string;
  product_name: string;
  label_version_date: string;
  archived_at: string;
  rows: LabelAeMaster[];
}

export interface MasterDiffEntry {
  term: string;
  soc: string;
  threshold: number;
}

export interface MasterDiff {
  added: MasterDiffEntry[];                              // in new, not in old
  removed: MasterDiffEntry[];                            // in old, not in new
  changed: { term: string; soc: string; from: number; to: number }[]; // threshold moved
  unchanged: number;
}

const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');

// Compare two master row sets by AE term (case/whitespace-insensitive).
export function diffMasters(oldRows: LabelAeMaster[], newRows: LabelAeMaster[]): MasterDiff {
  const oldMap = new Map<string, LabelAeMaster>();
  oldRows.forEach((r) => oldMap.set(normalize(r.ae_term), r));
  const newMap = new Map<string, LabelAeMaster>();
  newRows.forEach((r) => newMap.set(normalize(r.ae_term), r));

  const added: MasterDiffEntry[] = [];
  const removed: MasterDiffEntry[] = [];
  const changed: MasterDiff['changed'] = [];
  let unchanged = 0;

  newMap.forEach((n, key) => {
    const o = oldMap.get(key);
    if (!o) {
      added.push({ term: n.ae_term, soc: n.soc, threshold: n.threshold_upper_pct });
    } else if (o.threshold_upper_pct !== n.threshold_upper_pct) {
      changed.push({ term: n.ae_term, soc: n.soc, from: o.threshold_upper_pct, to: n.threshold_upper_pct });
    } else {
      unchanged++;
    }
  });

  oldMap.forEach((o, key) => {
    if (!newMap.has(key)) {
      removed.push({ term: o.ae_term, soc: o.soc, threshold: o.threshold_upper_pct });
    }
  });

  const byTerm = (a: { term: string }, b: { term: string }) => a.term.localeCompare(b.term);
  added.sort(byTerm);
  removed.sort(byTerm);
  changed.sort(byTerm);

  return { added, removed, changed, unchanged };
}
