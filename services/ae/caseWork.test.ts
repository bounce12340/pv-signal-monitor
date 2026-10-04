import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyWork } from './caseWorkModel.js';
import { getCaseWork, getWorkbench, readNotifications, saveCaseWork, workUsers } from './caseWork';

afterEach(() => vi.unstubAllGlobals());

function capture(reply: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return reply(); }));
  return calls;
}
const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });

describe('case work API service', () => {
  it('PUTs only the work body to the encoded case path with the Access cookie', async () => {
    const calls = capture(ok({ work: { ...emptyWork(), version: 1 }, audit: [] }));
    expect((await saveCaseWork('case / one', emptyWork())).work.version).toBe(1);
    expect(calls[0].url).toBe('/api/ae-reports/case%20%2F%20one/work');
    expect(calls[0].init.method).toBe('PUT');
    expect(calls[0].init.credentials).toBe('same-origin');
    expect(JSON.parse(String(calls[0].init.body))).toEqual(emptyWork());
  });

  it('strips server-owned lifecycle fields before sending', async () => {
    const calls = capture(ok({ work: emptyWork(), audit: [] }));
    const fromServer = { ...emptyWork(), version: 2, status: 'completed', completedAt: '2026-10-01T00:00:00Z', completedBy: 'pv@example.com' };
    await saveCaseWork('c1', fromServer);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).not.toHaveProperty('completedAt');
    expect(body).not.toHaveProperty('completedBy');
    expect(body.status).toBe('completed');
  });

  it('validates before any network write', async () => {
    const calls = capture(() => { throw new Error('network must not be used'); });
    await expect(saveCaseWork('demo', { ...emptyWork(), workDueDate: 'not-date' })).rejects.toThrow('INVALID_WORK');
    expect(calls).toHaveLength(0);
  });

  it('maps 409 to WORK_CONFLICT and 400 to INVALID_WORK, with no local fallback', async () => {
    capture(() => new Response('{}', { status: 409 }));
    await expect(saveCaseWork('demo', emptyWork())).rejects.toThrow('WORK_CONFLICT');
    capture(() => new Response('{}', { status: 400 }));
    await expect(getCaseWork('demo')).rejects.toThrow('INVALID_WORK');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(getCaseWork('demo')).rejects.toThrow('offline');
  });

  it('reads users, workbench and notifications from the Worker routes', async () => {
    const calls = capture(ok({ users: ['pv@example.com'] }));
    expect(await workUsers()).toEqual(['pv@example.com']);
    await getWorkbench('overdue');
    await readNotifications(['n1']);
    expect(calls.map(c => [c.init.method, c.url])).toEqual([
      ['GET', '/api/ae-reports/work-users'],
      ['GET', '/api/ae-reports/workbench?scope=overdue'],
      ['POST', '/api/ae-reports/notifications/read'],
    ]);
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ ids: ['n1'] });
  });
});
