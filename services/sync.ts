// Cross-device sync client. The Worker stores whole backup snapshots in D1
// (per Access-authenticated user); localStorage stays the working store and
// this module pushes/pulls snapshots against /api/sync.

import { db } from './db';

export interface SyncMeta {
  // updated_at of the last snapshot this browser pushed or pulled.
  server_updated_at: string | null;
  // Hash of local data at that moment (drift from it = unsynced changes).
  last_hash: string | null;
}

export interface ServerMeta {
  updated_at: string | null;
  device: string | null;
}

const META_KEY = 'pv_sync_meta';

export function getSyncMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) return { server_updated_at: null, last_hash: null, ...JSON.parse(raw) };
  } catch { /* fall through */ }
  return { server_updated_at: null, last_hash: null };
}

function saveSyncMeta(meta: SyncMeta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// exportAll() stamps exported_at on every call; strip it so identical data
// hashes identically.
function stableSnapshotString(): string {
  const snap = { ...db.exportAll() } as Record<string, unknown>;
  delete snap.exported_at;
  return JSON.stringify(snap);
}

export async function localDataHash(): Promise<string> {
  return sha256Hex(stableSnapshotString());
}

export function localIsEmpty(): boolean {
  return db.getProducts().length === 0 && db.getQuarterlyAeMonitors().length === 0;
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac')) return 'macOS';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  return 'Unknown';
}

/** null = API unreachable (local dev server or network trouble). */
export async function fetchServerMeta(): Promise<ServerMeta | null> {
  try {
    const res = await fetch('/api/sync/latest');
    if (!res.ok) return null;
    // The Vite dev server answers unknown paths with index.html — that is
    // "offline" as far as sync is concerned, not a JSON reply.
    if (!(res.headers.get('content-type') || '').includes('application/json')) return null;
    return (await res.json()) as ServerMeta;
  } catch {
    return null;
  }
}

export async function pushToCloud(): Promise<{ updated_at: string }> {
  const res = await fetch('/api/sync', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device: deviceName(), data: db.exportAll() }),
  });
  if (!res.ok) throw new Error(`同步上傳失敗 (HTTP ${res.status})`);
  const out = (await res.json()) as { updated_at: string };
  saveSyncMeta({ server_updated_at: out.updated_at, last_hash: await localDataHash() });
  return out;
}

export async function pullFromCloud(): Promise<{ updated_at: string; device: string }> {
  const res = await fetch('/api/sync/data');
  if (!res.ok) throw new Error(`下載雲端資料失敗 (HTTP ${res.status})`);
  const out = (await res.json()) as { updated_at: string; device: string; data: unknown };
  db.importAll(out.data);
  saveSyncMeta({ server_updated_at: out.updated_at, last_hash: await localDataHash() });
  return { updated_at: out.updated_at, device: out.device };
}
