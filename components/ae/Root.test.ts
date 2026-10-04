// @vitest-environment jsdom
// 依角色分流：業務只拿得到通報表單；PV 進主系統，#/report 才進表單；AE 畫面才包 .ae-theme。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from './testRender';

// 主系統很重（PDF、圖表、同步），這裡只需要知道「有沒有被渲染」。
vi.mock('../../App', () => ({ default: () => React.createElement('div', { 'data-testid': 'host-app' }, 'HOST APP') }));

const profile = { displayName: 'Chen', employeeId: 'S1', phone: '0912000000', contactEmail: 'c@example.com', org: 'O', territory: 'T' };
const me = (role: string, profileComplete = true) =>
  vi.fn(async () => new Response(JSON.stringify({ email: `${role}@example.com`, role, profile: profileComplete ? profile : {}, profileComplete })));

let ui: Awaited<ReturnType<typeof render>> | null = null;
async function mount(hash = '') {
  window.location.hash = hash;
  const { default: Root } = await import('./Root');
  ui = await render(React.createElement(Root));
  return ui;
}
const isHost = () => Boolean(ui!.host.querySelector('[data-testid="host-app"]'));
const inAeScope = () => Boolean(ui!.host.querySelector('.ae-theme'));
const isReportForm = () => ui!.text().includes('My reports') || Boolean(ui!.button('My reports'));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', undefined);
  Element.prototype.scrollTo = () => {};
  localStorage.clear();
  localStorage.setItem('ae_lang', JSON.stringify('en'));
});
afterEach(() => { ui?.unmount(); ui = null; window.location.hash = ''; vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('role routing', () => {
  it('shows a labelled loading state, and neither side, until the role is known', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    await mount();
    expect(ui!.host.querySelector('[role="status"]')?.textContent).toContain('Loading');
    expect(isHost()).toBe(false);
  });

  it('sends PV staff to the host app, outside the AE styling scope', async () => {
    vi.stubGlobal('fetch', me('pv'));
    await mount();
    expect(isHost()).toBe(true);
    expect(inAeScope()).toBe(false);
  });

  it('does not stop PV staff at profile setup just to use the host app', async () => {
    vi.stubGlobal('fetch', me('pv', false));
    await mount();
    expect(isHost()).toBe(true);
  });

  it('opens the report form for PV staff on #/report (query strings allowed)', async () => {
    vi.stubGlobal('fetch', me('pv'));
    await mount('#/report?src=qr');
    expect(isHost()).toBe(false);
    expect(isReportForm()).toBe(true);
    expect(inAeScope()).toBe(true);
  });

  it.each(['', '#/', '#/anything'])('gives a rep only the report form, whatever the hash (%s)', async (hash) => {
    vi.stubGlobal('fetch', me('rep'));
    await mount(hash);
    expect(isHost()).toBe(false);
    expect(isReportForm()).toBe(true);
  });

  it('asks a rep to set up their profile before the first report', async () => {
    vi.stubGlobal('fetch', me('rep', false));
    await mount();
    expect(isHost()).toBe(false);
    expect(isReportForm()).toBe(false);
    expect(inAeScope()).toBe(true);
    expect(ui!.text()).toContain('rep@example.com');
  });

  it('falls back to the report form, not profile setup or the host app, when /api/me fails in production', async () => {
    vi.stubEnv('DEV', false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await mount();
    expect(isHost()).toBe(false);
    expect(isReportForm()).toBe(true);
  });

  it('lets the Vite dev server (no Worker, no /api/me) into the host app', async () => {
    vi.stubEnv('DEV', true);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await mount();
    expect(isHost()).toBe(true);
  });
});

describe('AE scope', () => {
  it('carries the chosen language and theme on the AE wrapper only', async () => {
    localStorage.setItem('ae_theme', JSON.stringify('dark'));
    vi.stubGlobal('fetch', me('rep'));
    await mount();
    const scope = ui!.host.querySelector('.ae-theme')!;
    expect(scope.getAttribute('lang')).toBe('en');
    expect(scope.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
