import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryLocalStorage } from './testStorage';
import { classifyFormSubmission, finalizeFormSubmission, DraftAutosaveCoordinator } from './aeSubmission';
import type { SubmitResult } from './aeApi';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('AE form submission draft-preservation contract', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('localStorage', memoryLocalStorage());
  });

  async function submitIn(mode: 'remote' | 'queue' | 'remote_5xx' | 'conflict' | 'storage_failure') {
    if (mode === 'remote') vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: 1 }), { status: 200 })));
    if (mode === 'queue' || mode === 'storage_failure') vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    if (mode === 'remote_5xx') vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    if (mode === 'conflict') vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 409 })));
    if (mode === 'storage_failure') vi.stubGlobal('localStorage', memoryLocalStorage({ failWrites: true }));
    const { emptyAEReport } = await import('./aeReport');
    const { submitAEReport } = await import('./aeApi');
    return submitAEReport(emptyAEReport('2026-09-29'));
  }

  it.each([
    ['confirmed remote delivery', 'remote', 'remote_delivered'],
    ['network failure durably queued pending', 'queue', 'queued_pending'],
    ['remote 5xx durably queued pending', 'remote_5xx', 'queued_pending'],
    ['HTTP 409 durably queued conflict', 'conflict', 'queued_conflict'],
  ] as const)('%s clears the form draft only after an alternate durable copy', async (_name, mode, state) => {
    const actual = await submitIn(mode);
    const removeDraft = vi.fn(async () => undefined);
    await expect(finalizeFormSubmission(actual, removeDraft)).resolves.toMatchObject({ state, mayClearDraft: true });
    expect(removeDraft).toHaveBeenCalledTimes(1);
  });

  it('network failure plus outbox storage failure stays unconfirmed and preserves the draft', async () => {
    const actual = await submitIn('storage_failure');
    expect(actual).toMatchObject({ ok: false, channel: 'unconfirmed' });
    expect(actual.message).toContain('佇列寫入失敗');
    const removeDraft = vi.fn(async () => undefined);
    await expect(finalizeFormSubmission(actual, removeDraft)).resolves.toMatchObject({ state: 'unconfirmed', mayClearDraft: false });
    expect(removeDraft).not.toHaveBeenCalled();
  });

  it('reports remote success when clearing the draft itself fails instead of reaching Done', async () => {
    const actual = await submitIn('remote');
    const removeDraft = vi.fn(async () => { throw new Error('storage delete failure'); });
    await expect(finalizeFormSubmission(actual, removeDraft)).rejects.toThrow('storage delete failure');
    expect(removeDraft).toHaveBeenCalledTimes(1);
  });

  it('treats an unknown channel as unconfirmed, never as success', () => {
    expect(classifyFormSubmission({ ok: true, channel: 'local' } as unknown as SubmitResult))
      .toEqual({ state: 'unconfirmed', mayClearDraft: false });
  });
});

describe('DraftAutosaveCoordinator', () => {
  beforeEach(() => vi.useFakeTimers());

  it('debounces: only the last scheduled save runs', async () => {
    const c = new DraftAutosaveCoordinator(600);
    const saves: string[] = [];
    c.scheduleSave(async () => { saves.push('first'); });
    c.scheduleSave(async () => { saves.push('second'); });
    await vi.advanceTimersByTimeAsync(600);
    expect(saves).toEqual(['second']);
  });

  it('a pending timer never rewrites a draft cleared by submit', async () => {
    const c = new DraftAutosaveCoordinator(600);
    const save = vi.fn(async () => undefined);
    c.scheduleSave(save);
    await c.invalidateAndSettle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
  });

  it('waits for an in-flight write to land before submit may delete the draft', async () => {
    const c = new DraftAutosaveCoordinator(600);
    let finishWrite!: () => void;
    const onSettled = vi.fn();
    c.scheduleSave(() => new Promise<void>(r => { finishWrite = r; }), onSettled);
    await vi.advanceTimersByTimeAsync(600);
    let settled = false;
    const p = c.invalidateAndSettle().then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    finishWrite();
    await p;
    expect(settled).toBe(true);
    // The write belonged to the invalidated generation, so the UI is not told "saved".
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('a failed in-flight write still lets submit proceed', async () => {
    const c = new DraftAutosaveCoordinator(600);
    c.scheduleSave(() => Promise.reject(new Error('quota')));
    await vi.advanceTimersByTimeAsync(600);
    await expect(c.invalidateAndSettle()).resolves.toBeUndefined();
  });

  it('reports saved / failed for writes that are still current', async () => {
    const c = new DraftAutosaveCoordinator(10);
    const outcomes: string[] = [];
    c.scheduleSave(async () => undefined, o => outcomes.push(o));
    await vi.advanceTimersByTimeAsync(10);
    c.scheduleSave(() => Promise.reject(new Error('x')), o => outcomes.push(o));
    await vi.advanceTimersByTimeAsync(10);
    expect(outcomes).toEqual(['saved', 'failed']);
  });
});
