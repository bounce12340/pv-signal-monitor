import type { AeMasterItem } from './services/analysis';

export type AppMode = 'dashboard' | 'generator' | 'monitor' | 'library' | 'audit';

// Shape of an AI extraction result / editable master, before it is
// flattened into LabelAeMaster rows by db.saveExtractedMaster.
export interface ExtractedMaster {
  product_name: string;
  label_version_date: string;
  frequency_legend?: string;
  ae_master: AeMasterItem[];
}
