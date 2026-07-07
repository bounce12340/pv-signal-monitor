import { describe, it, expect } from 'vitest';
import { SystemLog, logHashPayload, verifyLogChain } from './db';

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Builds a valid newest-first log array of n hashed entries.
async function buildChain(n: number, legacyFirst = 0): Promise<SystemLog[]> {
  const logs: SystemLog[] = []; // oldest-first while building
  for (let i = 0; i < legacyFirst; i++) {
    logs.push({
      id: `legacy-${i}`,
      timestamp: new Date(2026, 0, 1 + i).toISOString(),
      action_type: 'CREATE',
      module: 'SYSTEM',
      description: `legacy ${i}`,
    });
  }
  for (let i = 0; i < n; i++) {
    const entry: SystemLog = {
      id: `log-${i}`,
      timestamp: new Date(2026, 1, 1 + i).toISOString(),
      action_type: 'CREATE',
      module: 'PRODUCT',
      description: `entry ${i}`,
      user: 'System User',
      prev_hash: logs.length > 0 ? logs[logs.length - 1].hash || 'GENESIS' : 'GENESIS',
    };
    entry.hash = await sha256Hex(logHashPayload(entry));
    logs.push(entry);
  }
  return logs.reverse(); // stored newest-first
}

describe('verifyLogChain', () => {
  it('完整鏈 → valid', async () => {
    const logs = await buildChain(5);
    const s = await verifyLogChain(logs);
    expect(s).toEqual({ valid: true, checked: 5, legacy: 0 });
  });

  it('空日誌 → valid', async () => {
    expect(await verifyLogChain([])).toEqual({ valid: true, checked: 0, legacy: 0 });
  });

  it('竄改某筆 description → invalid 並指出該筆', async () => {
    const logs = await buildChain(5);
    logs[2].description = 'tampered!'; // newest-first index 2 = log-2
    const s = await verifyLogChain(logs);
    expect(s.valid).toBe(false);
    expect(s.brokenAtId).toBe(logs[2].id);
  });

  it('刪除中段一筆 → invalid（prev_hash 對不上）', async () => {
    const logs = await buildChain(5);
    logs.splice(2, 1); // remove middle entry
    const s = await verifyLogChain(logs);
    expect(s.valid).toBe(false);
  });

  it('鏈之前的舊格式紀錄可容忍，並回報 legacy 數', async () => {
    const logs = await buildChain(3, 2);
    const s = await verifyLogChain(logs);
    expect(s).toEqual({ valid: true, checked: 3, legacy: 2 });
  });

  it('鏈開始後出現無雜湊紀錄 → invalid', async () => {
    const logs = await buildChain(3);
    // Insert an unhashed entry as the newest record (after chain started)
    logs.unshift({
      id: 'injected',
      timestamp: new Date().toISOString(),
      action_type: 'DELETE',
      module: 'SYSTEM',
      description: 'injected without hash',
    });
    const s = await verifyLogChain(logs);
    expect(s.valid).toBe(false);
    expect(s.brokenAtId).toBe('injected');
  });
});
