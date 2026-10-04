import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryLocalStorage } from './testStorage';

let ls: ReturnType<typeof memoryLocalStorage>;
type Call = { url: string; init: RequestInit };
let calls: Call[];

beforeEach(() => {
  vi.resetModules();
  ls = memoryLocalStorage();
  calls = [];
  vi.stubGlobal('indexedDB', undefined);
  vi.stubGlobal('localStorage', ls);
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Stubs fetch with a sequence of replies (last one repeats); a thrown value simulates a network error. */
function replies(...rs: Array<Response | Error | (() => Response)>) {
  let i = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const r = rs[Math.min(i++, rs.length - 1)];
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r() : r.clone();
  }));
}

async function setup() {
  const api = await import('./aeApi');
  const { emptyAEReport } = await import('./aeReport');
  const outbox = () => JSON.parse(ls.getItem('ae_outbox') || '[]');
  return { ...api, report: (id = 'case-1') => ({ ...emptyAEReport('2026-10-04'), id }), outbox };
}

describe('submitAEReport', () => {
  it('POSTs to the same-origin collection with the Access cookie and no token header', async () => {
    replies(json({ ok: true, id: 'case-1', version: 0 }, 201));
    const { submitAEReport, report } = await setup();
    const r = report();
    expect(await submitAEReport(r)).toEqual({ ok: true, channel: 'remote' });
    expect(calls[0].url).toBe('/api/ae-reports');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.credentials).toBe('same-origin');
    expect(calls[0].init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(calls[0].init.body)).id).toBe('case-1');
    expect(r.version).toBe(0);
  });

  it('takes the case number the Worker assigned', async () => {
    replies(json({ ok: true, id: 'case-1', version: 0, caseNumber: 'PV-2026-0042' }, 201));
    const { submitAEReport, report } = await setup();
    const r = report();
    await submitAEReport(r);
    expect(r.caseNumber).toBe('PV-2026-0042');
  });

  it.each([
    ['a network error', new Error('network down')],
    ['a 5xx', new Response('', { status: 503 })],
    // Vite dev server, or an Access login page after the session expired: 200 but not the API.
    ['a 200 HTML page instead of the API', new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } })],
    ['a reply without a valid version', json({ ok: true })],
  ])('queues the report in the outbox on %s', async (_name, reply) => {
    replies(reply as Response | Error);
    const { submitAEReport, report, outbox, outboxCount } = await setup();
    const res = await submitAEReport(report());
    expect(res).toMatchObject({ ok: false, channel: 'outbox' });
    expect(outbox().map((c: any) => c.id)).toEqual(['case-1']);
    expect(await outboxCount()).toBe(1);
  });

  it('replaces, not duplicates, an outbox entry when the same case is resent', async () => {
    replies(new Error('offline'));
    const { submitAEReport, report, outbox } = await setup();
    await submitAEReport(report());
    await submitAEReport({ ...report(), reporterName: 'second try' } as any);
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0].reporterName).toBe('second try');
  });

  it('keeps a 409 as a flagged conflict in the outbox', async () => {
    replies(new Response('', { status: 409 }));
    const { submitAEReport, report, outbox } = await setup();
    expect(await submitAEReport(report())).toMatchObject({ ok: false, channel: 'outbox_conflict' });
    expect(outbox()[0].outboxConflict).toBe(true);
  });

  it('reports unconfirmed when the outbox cannot be written either', async () => {
    vi.stubGlobal('localStorage', memoryLocalStorage({ failWrites: true }));
    replies(new Error('offline'));
    const { submitAEReport, report } = await setup();
    const res = await submitAEReport(report());
    expect(res).toMatchObject({ ok: false, channel: 'unconfirmed' });
    expect(res.message).toContain('佇列寫入失敗');
  });
});

describe('flushOutbox', () => {
  async function queued(ids: string[]) {
    replies(new Error('offline'));
    const s = await setup();
    for (const id of ids) await s.submitAEReport(s.report(id));
    calls.length = 0;
    return s;
  }

  it('sends queued reports in order and empties the queue', async () => {
    const s = await queued(['a', 'b']);
    replies(json({ version: 0 }, 201));
    expect(await s.flushOutbox()).toEqual({ sent: 2, remaining: 0, conflicts: 0 });
    expect(calls.map(c => JSON.parse(String(c.init.body)).id)).toEqual(['a', 'b']);
    expect(s.outbox()).toEqual([]);
  });

  it('stops at the first failure and keeps the rest, in order', async () => {
    const s = await queued(['a', 'b', 'c']);
    replies(json({ version: 0 }, 201), new Error('dropped again'));
    expect(await s.flushOutbox()).toEqual({ sent: 1, remaining: 2, conflicts: 0 });
    expect(s.outbox().map((c: any) => c.id)).toEqual(['b', 'c']);
  });

  it('marks a 409 as a conflict and stops replay; a conflicted head blocks later flushes', async () => {
    const s = await queued(['a', 'b']);
    replies(new Response('', { status: 409 }));
    expect(await s.flushOutbox()).toEqual({ sent: 0, remaining: 2, conflicts: 1 });
    calls.length = 0;
    replies(json({ version: 0 }, 201));
    expect(await s.flushOutbox()).toEqual({ sent: 0, remaining: 2, conflicts: 1 });
    expect(calls).toHaveLength(0);
  });
});

describe('case reads and writes', () => {
  it('surfaces a failed list instead of returning an empty inbox', async () => {
    replies(new Response('', { status: 500 }));
    const { listAECases } = await setup();
    await expect(listAECases()).rejects.toThrow('HTTP 500');
  });

  it('returns the server-assigned number when creating a case (e.g. a follow-up)', async () => {
    replies(json({ ok: true, version: 0, caseNumber: 'PV-2026-0007-F1' }, 201));
    const { saveAECase, report } = await setup();
    expect((await saveAECase({ ...report('fu'), caseNumber: 'PV-2026-0007-F9' }, { create: true })).caseNumber).toBe('PV-2026-0007-F1');
  });

  it('creates with POST and updates with PATCH on the encoded id', async () => {
    replies(json({ ok: true, version: 0 }, 201));
    const { saveAECase, report } = await setup();
    await saveAECase(report('a/b'), { create: true });
    await saveAECase({ ...report('a/b'), version: 2 });
    expect(calls.map(c => [c.init.method, c.url])).toEqual([
      ['POST', '/api/ae-reports'],
      ['PATCH', '/api/ae-reports/a%2Fb'],
    ]);
  });

  it('deletes with an encoded id and reason', async () => {
    replies(json({ ok: true }));
    const { deleteAECase } = await setup();
    await deleteAECase('x y', '重複 建檔');
    expect(calls[0].url).toBe('/api/ae-reports/x%20y?reason=%E9%87%8D%E8%A4%87%20%E5%BB%BA%E6%AA%94');
    expect(calls[0].init.method).toBe('DELETE');
  });
});

describe('identity and profile', () => {
  it.each([
    ['pv', 'pv'],
    ['PV', 'rep'],
    ['admin', 'rep'],
    [undefined, 'rep'],
  ])('maps server role %s to %s', async (role, expected) => {
    replies(json({ email: 'someone@example.com', role, profile: {}, profileComplete: false }));
    const { fetchIdentity } = await setup();
    expect((await fetchIdentity()).role).toBe(expected);
    expect(calls[0].url).toBe('/api/me');
  });

  it('PUTs only the whitelisted profile fields, never a role', async () => {
    replies(json({ email: 'rep@example.com', role: 'rep', profile: { displayName: 'A' }, profileComplete: true }));
    const { saveProfile } = await setup();
    const profile = { displayName: 'A', employeeId: 'E1', phone: '0900', contactEmail: 'a@example.com', org: 'O', territory: 'T', role: 'pv' };
    await saveProfile(profile as any);
    expect(calls[0].init.method).toBe('PUT');
    expect(Object.keys(JSON.parse(String(calls[0].init.body))).sort()).toEqual(
      ['contact_email', 'display_name', 'employee_id', 'org', 'phone', 'territory'],
    );
  });

  it('maps a profile to the reporter fields of the report form', async () => {
    const { profileToReporterFields } = await setup();
    expect(profileToReporterFields({ displayName: 'A', employeeId: 'E1', phone: 'P', contactEmail: 'C', org: 'O', territory: 'T' }))
      .toEqual({ reporterName: 'A', reporterEmployeeId: 'E1', reporterPhone: 'P', reporterEmail: 'C', reporterOrg: 'O', reporterTerritory: 'T' });
  });
});

describe('attachmentSrc', () => {
  it.each([
    [{ dataUrl: 'data:image/jpeg;base64,AAAA' }, 'data:image/jpeg;base64,AAAA'],
    [{ dataUrl: 'data:image/png;base64,AAAA' }, 'data:image/png;base64,AAAA'],
    [{ url: '/api/ae-reports/case_1/attachments/att-2' }, '/api/ae-reports/case_1/attachments/att-2'],
    [{ dataUrl: 'data:image/svg+xml;base64,AAAA' }, ''],
    [{ dataUrl: 'javascript:alert(1)' }, ''],
    [{ url: 'https://evil.example/x.png' }, ''],
    [{ url: '/api/ae-reports/../sync/attachments/x' }, ''],
  ])('%j → %j', async (input, expected) => {
    const { attachmentSrc } = await setup();
    expect(attachmentSrc(input)).toBe(expected);
  });
});
