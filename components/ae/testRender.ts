// Test-only helpers for rendering AE screens in jsdom with act(), shared by the component tests.
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

export async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) await act(async () => { await Promise.resolve(); });
}

export async function render(element: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  await act(async () => { root.render(element); });
  await settle();
  return {
    host,
    unmount: () => { act(() => root.unmount()); host.remove(); },
    button: (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text || b.getAttribute('aria-label') === text),
    click: async (el: Element | undefined | null) => {
      if (!el) throw new Error('element to click not found');
      await act(async () => { (el as HTMLElement).click(); });
      await settle();
    },
    text: () => host.textContent || '',
  };
}
