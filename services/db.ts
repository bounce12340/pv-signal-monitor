// Simple ID generator
const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

// 1. Products Table
export interface Product {
  product_id: string;
  product_name: string;
  label_version_date: string;
}

// 2. Label AE Master Table
export interface LabelAeMaster {
  id?: string; // Internal ID for management
  product_id: string;
  soc: string;
  ae_term: string; // This corresponds to the split term
  label_freq_text: string;
  threshold_upper_pct: number;
  created_at: string;
  group_id?: string; // ID to group split terms that belong to the same original entry
}

// 3. Quarterly AE Monitor Table
export interface QuarterlyAeMonitor {
  id?: string; // Internal ID
  product_id: string;
  quarter: string;
  exposure_value: number;
  exposure_unit: string;
  ae_term: string;
  count: number;
  rate_pct: number;
  threshold_pct: number;
  status: 'normal' | 'yellow' | 'red'; // Simplified status as per requirement (mapped from internal)
  generated_at: string;
}

// 4. System Logs (Audit Trail)
export interface SystemLog {
  id: string;
  timestamp: string;
  action_type: 'CREATE' | 'UPDATE' | 'DELETE' | 'EXPORT' | 'LOGIN' | 'ANALYSIS';
  module: 'PRODUCT' | 'MONITOR' | 'SYSTEM';
  description: string;
  user?: string; // Placeholder for future auth
}

// Helper interface for grouped batches
export interface MonitorBatch {
  generated_at: string;
  product_id: string;
  quarter: string;
  exposure_value: number;
  exposure_unit: string;
  record_count: number;
  alert_count: number;
  unexpected_count: number;
}

const DB_KEYS = {
  PRODUCTS: 'pv_db_products',
  MASTER: 'pv_db_label_ae_master',
  MONITOR: 'pv_db_quarterly_ae_monitor',
  LOGS: 'pv_db_system_logs'
};

// --- Memory Cache ---
const cache: Record<string, any> = {};

function getFromCacheOrStorage<T>(key: string): T[] {
  if (cache[key]) {
    return cache[key];
  }
  const str = localStorage.getItem(key);
  const data = str ? JSON.parse(str) : [];
  cache[key] = data;
  return data;
}

function saveToStorageAndCache<T>(key: string, data: T[]) {
  cache[key] = data;
  localStorage.setItem(key, JSON.stringify(data));
  if (key === DB_KEYS.MONITOR) {
    delete cache['monitor_batches'];
  }
}

// --- Data Access Layer ---

export const db = {
  // --- LOGGING SYSTEM ---
  addLog: (action: SystemLog['action_type'], module: SystemLog['module'], description: string) => {
    const logs = db.getLogs();
    const newLog: SystemLog = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      action_type: action,
      module: module,
      description: description,
      user: 'System User' // In a real app, this would come from auth context
    };
    // Keep logs sorted desc (newest first)
    logs.unshift(newLog);
    saveToStorageAndCache(DB_KEYS.LOGS, logs);
  },

  getLogs: (): SystemLog[] => {
    return getFromCacheOrStorage<SystemLog>(DB_KEYS.LOGS);
  },

  clearLogs: () => {
     delete cache[DB_KEYS.LOGS];
     localStorage.removeItem(DB_KEYS.LOGS);
  },

  // Products
  getProducts: (): Product[] => {
    return getFromCacheOrStorage<Product>(DB_KEYS.PRODUCTS);
  },
  
  saveProduct: (product: Product) => {
    const products = db.getProducts();
    // Update if exists or add new
    const idx = products.findIndex(p => p.product_id === product.product_id);
    if (idx >= 0) {
      products[idx] = product;
    } else {
      products.push(product);
    }
    saveToStorageAndCache(DB_KEYS.PRODUCTS, products);
  },

  deleteProduct: (productId: string) => {
    const products = db.getProducts();
    const target = products.find(p => p.product_id === productId);
    const productName = target ? target.product_name : productId;

    const newProducts = products.filter(p => p.product_id !== productId);
    saveToStorageAndCache(DB_KEYS.PRODUCTS, newProducts);
    
    // Cascade delete master
    const masters = db.getLabelAeMasters().filter(m => m.product_id !== productId);
    saveToStorageAndCache(DB_KEYS.MASTER, masters);

    // Cascade delete monitor records
    const monitors = db.getQuarterlyAeMonitors().filter(m => m.product_id !== productId);
    saveToStorageAndCache(DB_KEYS.MONITOR, monitors);

    // LOGGING
    db.addLog('DELETE', 'PRODUCT', `Deleted product: ${productName} and all associated records.`);
  },

  // Master
  getLabelAeMasters: (productId?: string): LabelAeMaster[] => {
    const all = getFromCacheOrStorage<LabelAeMaster>(DB_KEYS.MASTER);
    if (productId) {
      return all.filter(m => m.product_id === productId);
    }
    return all;
  },

  saveLabelAeMasters: (masters: LabelAeMaster[]) => {
    const current = db.getLabelAeMasters();
    // If we are saving masters for a product, we should probably clear old ones for that product first to avoid duplicates if re-saved
    const productIds = new Set(masters.map(m => m.product_id));
    const filteredCurrent = current.filter(m => !productIds.has(m.product_id));
    
    const updated = [...filteredCurrent, ...masters];
    saveToStorageAndCache(DB_KEYS.MASTER, updated);
  },

  // Monitor
  getQuarterlyAeMonitors: (productId?: string): QuarterlyAeMonitor[] => {
    const all = getFromCacheOrStorage<QuarterlyAeMonitor>(DB_KEYS.MONITOR);
    if (productId) {
      return all.filter(m => m.product_id === productId);
    }
    return all;
  },

  // Get distinct batches (reports) for display in library
  getMonitorBatches: (): MonitorBatch[] => {
    if (cache['monitor_batches']) {
      return cache['monitor_batches'];
    }

    const all = db.getQuarterlyAeMonitors();
    const batches = new Map<string, MonitorBatch>();

    all.forEach(record => {
      // Group by generated_at as a batch ID
      const key = record.generated_at;
      
      if (!batches.has(key)) {
        batches.set(key, {
          generated_at: record.generated_at,
          product_id: record.product_id,
          quarter: record.quarter,
          exposure_value: record.exposure_value,
          exposure_unit: record.exposure_unit,
          record_count: 0,
          alert_count: 0,
          unexpected_count: 0
        });
      }

      const batch = batches.get(key)!;
      batch.record_count++;
      if (record.status === 'red') {
        batch.alert_count++;
      }
    });

    // Sort by date desc
    const result = Array.from(batches.values()).sort((a, b) => 
      new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime()
    );
    
    cache['monitor_batches'] = result;
    return result;
  },

  // Get records for a specific batch
  getMonitorRecordsByBatch: (generatedAt: string): QuarterlyAeMonitor[] => {
    const all = db.getQuarterlyAeMonitors();
    return all.filter(r => r.generated_at === generatedAt);
  },

  deleteMonitorBatch: (generatedAt: string) => {
    const current = db.getQuarterlyAeMonitors();
    // Find info for log before deleting
    const target = current.find(m => m.generated_at === generatedAt);
    const info = target ? `${target.quarter}` : 'Unknown Batch';

    const updated = current.filter(m => m.generated_at !== generatedAt);
    saveToStorageAndCache(DB_KEYS.MONITOR, updated);

    // LOGGING
    db.addLog('DELETE', 'MONITOR', `Deleted monitor report batch: ${info}`);
  },

  saveQuarterlyAeMonitors: (records: QuarterlyAeMonitor[]) => {
    if (records.length === 0) return;
    const current = db.getQuarterlyAeMonitors();
    const updated = [...current, ...records];
    saveToStorageAndCache(DB_KEYS.MONITOR, updated);

    // LOGGING
    const first = records[0];
    const alertCount = records.filter(r => r.status === 'red').length;
    db.addLog('CREATE', 'MONITOR', `Saved Analysis Report: ${first.quarter} (Alerts: ${alertCount})`);
  },

  deleteMonitorRecord: (recordId: string) => {
    const current = db.getQuarterlyAeMonitors();
    const updated = current.filter(m => m.id !== recordId);
    saveToStorageAndCache(DB_KEYS.MONITOR, updated);
  },

  // --- High Level Actions ---

  // Save a full master extraction result
  saveExtractedMaster: (data: any, existingProductId?: string) => {
    const productId = existingProductId || generateId();
    const now = new Date().toISOString();
    const isUpdate = !!existingProductId;

    const product: Product = {
      product_id: productId,
      product_name: data.product_name,
      label_version_date: data.label_version_date || ''
    };

    const masters: LabelAeMaster[] = [];
    data.ae_master.forEach((item: any) => {
      const groupId = generateId(); // Group terms that belong to the same entry
      item.ae_terms_split.forEach((term: string) => {
        masters.push({
          id: generateId(),
          product_id: productId,
          soc: item.soc,
          ae_term: term,
          label_freq_text: item.label_frequency_text,
          threshold_upper_pct: item.label_threshold_upper_pct,
          created_at: now,
          group_id: groupId
        });
      });
    });

    db.saveProduct(product);
    db.saveLabelAeMasters(masters);

    // LOGGING
    const action = isUpdate ? 'UPDATE' : 'CREATE';
    db.addLog(action, 'PRODUCT', `${isUpdate ? 'Updated' : 'Created'} AE Master for product: ${data.product_name}`);

    return productId;
  },

  // Convert DB master rows back to format needed for analysis
  getMasterForAnalysis: (productId: string) => {
    const rows = db.getLabelAeMasters(productId);
    
    // Group rows by group_id to reconstruct the master items
    const groupedMap = new Map<string, any>();
    
    rows.forEach(r => {
      // Use group_id if available. If not (legacy data), use id to keep them separate.
      const gid = r.group_id || r.id || generateId();
      
      if (!groupedMap.has(gid)) {
        groupedMap.set(gid, {
          soc: r.soc,
          ae_term_raw: "", // Reconstructed below
          ae_terms_split: [],
          label_frequency_text: r.label_freq_text,
          label_threshold_upper_pct: r.threshold_upper_pct,
          mapping_rule_note: "Loaded from DB"
        });
      }
      
      const group = groupedMap.get(gid);
      group.ae_terms_split.push(r.ae_term);
    });

    const ae_master = Array.from(groupedMap.values()).map(item => ({
      ...item,
      // Create a display string for raw term
      ae_term_raw: item.ae_terms_split.join(' / ')
    }));

    return { 
      product_name: "", // Not strictly needed for analysis logic
      ae_master 
    };
  }
};